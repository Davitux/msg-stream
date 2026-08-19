import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_APP,
  MAX_EVENTS,
  STORAGE_KEY,
  countUnread,
  isTip,
  selectActiveProfile,
  selectVisibleEvents,
  shouldCapture,
  useStore,
} from "@/lib/store";
import type { Filters } from "@/lib/store";
import { flushFrames, makeEvent, resetStore } from "./helpers";

beforeEach(resetStore);

const baseFilters: Filters = {
  unreadOnly: false,
  tipsOnly: false,
  platforms: {
      youtube: true,
      twitch: true,
      kick: true,
      streamlabs: true,
      streamelements: true,
      ceneka: true,
    },
};

describe("ingest", () => {
  it("adds events newest first", async () => {
    const first = makeEvent({ id: "a", message: "first" });
    const second = makeEvent({ id: "b", message: "second" });
    useStore.getState().ingest(first);
    useStore.getState().ingest(second);
    await flushFrames();

    expect(useStore.getState().events.map((e) => e.id)).toEqual(["b", "a"]);
  });

  it("ignores an id it has already seen", async () => {
    const event = makeEvent({ id: "dupe" });
    useStore.getState().ingest(event);
    useStore.getState().ingest({ ...event, message: "changed" });
    await flushFrames();

    const { events } = useStore.getState();
    expect(events).toHaveLength(1);
    expect(events[0].message).toBe(event.message);
  });

  it("batches a burst into a single commit", async () => {
    let commits = 0;
    const unsubscribe = useStore.subscribe((state, prev) => {
      if (state.events !== prev.events) commits += 1;
    });

    for (let i = 0; i < 25; i++) useStore.getState().ingest(makeEvent({ id: `burst${i}` }));
    await flushFrames();
    unsubscribe();

    expect(useStore.getState().events).toHaveLength(25);
    expect(commits).toBe(1);
  });

  it("caps the buffer and drops the oldest", async () => {
    for (let i = 0; i < MAX_EVENTS + 50; i++) {
      useStore.getState().ingest(makeEvent({ id: `cap${i}`, message: String(i) }));
    }
    await flushFrames();

    const { events } = useStore.getState();
    expect(events).toHaveLength(MAX_EVENTS);
    // Newest first, so the head is the last one ingested.
    expect(events[0].id).toBe(`cap${MAX_EVENTS + 49}`);
    expect(events.some((e) => e.id === "cap0")).toBe(false);
  });

  it("lets an evicted id back in, since it is no longer on screen", async () => {
    for (let i = 0; i < MAX_EVENTS + 1; i++) {
      useStore.getState().ingest(makeEvent({ id: `roll${i}` }));
    }
    await flushFrames();
    expect(useStore.getState().events.some((e) => e.id === "roll0")).toBe(false);

    useStore.getState().ingest(makeEvent({ id: "roll0", message: "returned" }));
    await flushFrames();
    expect(useStore.getState().events[0].id).toBe("roll0");
  });

  it("clearEvents empties the feed and forgets what it has seen", async () => {
    useStore.getState().ingest(makeEvent({ id: "x" }));
    await flushFrames();
    useStore.getState().clearEvents();
    expect(useStore.getState().events).toEqual([]);

    useStore.getState().ingest(makeEvent({ id: "x", message: "again" }));
    await flushFrames();
    expect(useStore.getState().events).toHaveLength(1);
  });
});

describe("read state", () => {
  it("marks and unmarks a single event", () => {
    useStore.getState().markRead("e1", true);
    expect(useStore.getState().readIds.e1).toBe(true);
    useStore.getState().markRead("e1", false);
    expect(useStore.getState().readIds.e1).toBeUndefined();
  });

  it("marks everything currently in the feed", async () => {
    for (let i = 0; i < 5; i++) useStore.getState().ingest(makeEvent({ id: `m${i}` }));
    await flushFrames();
    useStore.getState().markAllRead();

    const { events, readIds } = useStore.getState();
    expect(countUnread(events, readIds)).toBe(0);
  });

  it("removes a mark when unmarking", () => {
    for (let i = 0; i < 10; i++) useStore.getState().markRead(`u${i}`, true);
    useStore.getState().markRead("u5", false);
    expect(Object.keys(useStore.getState().readIds)).toHaveLength(9);
  });
});

describe("selectors", () => {
  const chat = makeEvent({ id: "s1", platform: "twitch" });
  const tip = makeEvent({
    id: "s2",
    platform: "youtube",
    amount: { value: 5, currency: "USD" },
  });

  it("isTip keys off the presence of an amount", () => {
    expect(isTip(tip)).toBe(true);
    expect(isTip(chat)).toBe(false);
  });

  it("filters by platform", () => {
    const filters = { ...baseFilters, platforms: { ...baseFilters.platforms, twitch: false } };
    expect(selectVisibleEvents([chat, tip], filters, {}).map((e) => e.id)).toEqual(["s2"]);
  });

  it("filters to paid only", () => {
    const filters = { ...baseFilters, tipsOnly: true };
    expect(selectVisibleEvents([chat, tip], filters, {}).map((e) => e.id)).toEqual(["s2"]);
  });

  it("filters to unread only", () => {
    const filters = { ...baseFilters, unreadOnly: true };
    expect(selectVisibleEvents([chat, tip], filters, { s1: true }).map((e) => e.id)).toEqual(["s2"]);
  });

  it("never lets a platform filter hide a gap", () => {
    const gap = makeEvent({ id: "system:gap:twitch:1000", kind: "system", platform: "twitch" });
    const filters = { ...baseFilters, platforms: { ...baseFilters.platforms, twitch: false } };
    expect(selectVisibleEvents([gap, chat], filters, {}).map((e) => e.id)).toEqual([
      "system:gap:twitch:1000",
    ]);
  });

  it("applies filters together", () => {
    const filters = { ...baseFilters, unreadOnly: true, tipsOnly: true };
    expect(selectVisibleEvents([chat, tip], filters, { s2: true })).toEqual([]);
  });

  it("counts unread, optionally only paid ones", () => {
    expect(countUnread([chat, tip], {})).toBe(2);
    expect(countUnread([chat, tip], {}, true)).toBe(1);
    expect(countUnread([chat, tip], { s2: true }, true)).toBe(0);
  });
});

describe("profiles", () => {
  it("starts with one profile that is active", () => {
    const state = useStore.getState();
    expect(state.profiles).toHaveLength(1);
    expect(selectActiveProfile(state).id).toBe(state.activeProfileId);
  });

  it("adds a profile and switches to it", () => {
    useStore.getState().addProfile("Second channel");
    const state = useStore.getState();
    expect(state.profiles).toHaveLength(2);
    expect(selectActiveProfile(state).name).toBe("Second channel");
  });

  it("gives each profile its own channels", () => {
    useStore.getState().updateProfile({ twitch: { channel: "first" } });
    useStore.getState().addProfile("Second");
    useStore.getState().updateProfile({ twitch: { channel: "second" } });

    const [a, b] = useStore.getState().profiles;
    expect(a.twitch.channel).toBe("first");
    expect(b.twitch.channel).toBe("second");
  });

  it("updateProfile only touches the active profile and never its id", () => {
    const originalId = useStore.getState().activeProfileId;
    useStore.getState().addProfile("Second");
    useStore.getState().updateProfile({ kick: { channel: "onlyhere", chatroomId: "" } });

    const [first, second] = useStore.getState().profiles;
    expect(first.kick.channel).toBe("");
    expect(second.kick.channel).toBe("onlyhere");
    expect(first.id).toBe(originalId);
  });

  it("clears the feed when switching, since it belongs to other channels", async () => {
    useStore.getState().addProfile("Second");
    const firstId = useStore.getState().profiles[0].id;

    useStore.getState().ingest(makeEvent({ id: "keepme" }));
    await flushFrames();
    expect(useStore.getState().events).toHaveLength(1);

    useStore.getState().setActiveProfile(firstId);
    expect(useStore.getState().events).toEqual([]);
    expect(useStore.getState().statuses.twitch.state).toBe("disconnected");
  });

  it("re-accepts an event id after a profile switch", async () => {
    useStore.getState().addProfile("Second");
    useStore.getState().ingest(makeEvent({ id: "same" }));
    await flushFrames();

    useStore.getState().setActiveProfile(useStore.getState().profiles[0].id);
    useStore.getState().ingest(makeEvent({ id: "same" }));
    await flushFrames();
    expect(useStore.getState().events).toHaveLength(1);
  });

  it("ignores a switch to the current or an unknown profile", async () => {
    useStore.getState().ingest(makeEvent({ id: "stay" }));
    await flushFrames();

    useStore.getState().setActiveProfile(useStore.getState().activeProfileId);
    useStore.getState().setActiveProfile("does-not-exist");
    expect(useStore.getState().events).toHaveLength(1);
  });

  it("renames without switching", () => {
    const id = useStore.getState().activeProfileId;
    useStore.getState().addProfile("Second");
    useStore.getState().renameProfile(id, "Renamed");

    expect(useStore.getState().profiles[0].name).toBe("Renamed");
    expect(useStore.getState().profiles[1].name).toBe("Second");
    expect(selectActiveProfile(useStore.getState()).name).toBe("Second");
  });

  it("deletes a profile and moves off it when it was active", () => {
    const firstId = useStore.getState().activeProfileId;
    useStore.getState().addProfile("Second");
    const secondId = useStore.getState().activeProfileId;

    useStore.getState().deleteProfile(secondId);
    expect(useStore.getState().profiles.map((p) => p.id)).toEqual([firstId]);
    expect(useStore.getState().activeProfileId).toBe(firstId);
  });

  it("keeps the active profile when deleting a different one", () => {
    const firstId = useStore.getState().activeProfileId;
    useStore.getState().addProfile("Second");
    const secondId = useStore.getState().activeProfileId;

    useStore.getState().deleteProfile(firstId);
    expect(useStore.getState().activeProfileId).toBe(secondId);
  });

  it("refuses to delete the last profile", () => {
    const id = useStore.getState().activeProfileId;
    useStore.getState().deleteProfile(id);
    expect(useStore.getState().profiles).toHaveLength(1);
  });
});

describe("app settings", () => {
  it("sets language, theme and the shared Twitch client id", () => {
    useStore.getState().setLocale("es");
    useStore.getState().setTheme("light");
    useStore.getState().setTwitchClientId("abc123");

    expect(useStore.getState().app).toEqual({
      locale: "es",
      theme: "light",
      twitchClientId: "abc123",
      capture: "all",
      platformDisplay: "name",
      bandBackground: false,
      historyDays: 30,
    });
  });
});

describe("what gets taken in", () => {
  const chat = makeEvent({ id: "c1" });
  const tip = makeEvent({ id: "t1", amount: { value: 5, currency: "USD" } });
  const sub = makeEvent({
    id: "s1",
    kind: "subscription",
    amount: { value: 1, currency: "SUBS" },
  });
  const gap = makeEvent({ id: "system:gap:app:1000", kind: "system" });

  it("keeps only paid messages by default", () => {
    expect(shouldCapture(tip, "paid")).toBe(true);
    expect(shouldCapture(sub, "paid")).toBe(true);
    expect(shouldCapture(chat, "paid")).toBe(false);
  });

  it("always keeps a gap notice, which is not itself a message", () => {
    // Suppressing it would hide the very thing it exists to report.
    expect(shouldCapture(gap, "paid")).toBe(true);
  });

  it("keeps everything when asked to", () => {
    for (const event of [chat, tip, sub, gap]) {
      expect(shouldCapture(event, "all")).toBe(true);
    }
  });

  it("ships defaulting to paid only", () => {
    // Asserted against the shipped defaults directly: rehydrating would merge
    // over whatever the harness had already set, which is not a fresh install.
    expect(DEFAULT_APP.capture).toBe("paid");
  });

  it("never lets ignored chat reach the feed or the database", async () => {
    useStore.setState({ app: { ...useStore.getState().app, capture: "paid" } });

    useStore.getState().ingest(chat);
    useStore.getState().ingest(tip);
    useStore.getState().ingest(gap);
    await flushFrames();

    expect(useStore.getState().events.map((e) => e.id).sort()).toEqual([
      "system:gap:app:1000",
      "t1",
    ]);
  });

  it("takes chat again as soon as the setting changes", async () => {
    useStore.setState({ app: { ...useStore.getState().app, capture: "paid" } });
    useStore.getState().ingest(chat);
    await flushFrames();
    expect(useStore.getState().events).toHaveLength(0);

    useStore.getState().setCapture("all");
    useStore.getState().ingest(chat);
    await flushFrames();
    expect(useStore.getState().events.map((e) => e.id)).toEqual(["c1"]);
  });
});

describe("persistence", () => {
  it("saves settings to localStorage but never messages or read marks", async () => {
    useStore.getState().setLocale("es");
    useStore.getState().markRead("kept", true);
    useStore.getState().ingest(makeEvent({ id: "ephemeral", message: "secret" }));
    await flushFrames();

    const raw = localStorage.getItem(STORAGE_KEY)!;
    expect(raw).toBeTruthy();

    const saved = JSON.parse(raw).state;
    expect(saved.app.locale).toBe("es");
    // Messages and read marks live in IndexedDB now.
    expect(saved.events).toBeUndefined();
    expect(saved.readIds).toBeUndefined();
    expect(saved.savedTips).toBeUndefined();
    expect(raw).not.toContain("secret");
  });

  it("migrates a v0 blob into a single profile", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 0,
        state: {
          readIds: { old: true },
          settings: {
            enabled: { youtube: true, twitch: true, kick: false, ceneka: false },
            twitch: { channel: "oldchannel", clientId: "oldclient", accessToken: "tok" },
            youtube: { video: "vid", apiKey: "key" },
            kick: { channel: "kickchan" },
            ceneka: {},
          },
        },
      }),
    );

    await useStore.persist.rehydrate();
    const state = useStore.getState();
    const profile = selectActiveProfile(state);

    expect(state.profiles).toHaveLength(1);
    expect(profile.twitch.channel).toBe("oldchannel");
    expect(profile.twitch.accessToken).toBe("tok");
    expect(profile.youtube.apiKey).toBe("key");
    expect(profile.enabled.youtube).toBe(true);
    // The client id is app-level now, not part of any profile.
    expect(state.app.twitchClientId).toBe("oldclient");
    expect("clientId" in profile.twitch).toBe(false);
    // Read marks moved out of localStorage; the migration drops them from the blob.
    expect(state.readIds.old).toBeUndefined();
  });

  it("strips the removed mock source from an older blob", async () => {
    // A leftover `enabled.mock: true` would otherwise make the app believe a
    // source is on when none is.
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 2,
        state: {
          profiles: [
            {
              id: "p_default",
              name: "Main",
              enabled: { youtube: true, mock: true },
              twitch: { channel: "" },
              youtube: { video: "", apiKey: "" },
              kick: { channel: "", chatroomId: "" },
              ceneka: {},
              mock: { intervalMs: 1200 },
            },
          ],
          activeProfileId: "p_default",
        },
      }),
    );

    await useStore.persist.rehydrate();
    const profile = selectActiveProfile(useStore.getState());

    expect("mock" in profile).toBe(false);
    expect("mock" in profile.enabled).toBe(false);
    // Everything else survives.
    expect(profile.enabled.youtube).toBe(true);
  });

  it("keeps defaults for fields missing from a stored blob", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: 1, state: { app: { locale: "es" } } }),
    );

    await useStore.persist.rehydrate();
    const { app, profiles } = useStore.getState();
    expect(app.locale).toBe("es");
    expect(app.theme).toBe("system");
    expect(profiles).toHaveLength(1);
  });

  it("hands an older blob the new follow-the-browser default", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: 3, state: { app: { locale: "en", theme: "dark" } } }),
    );
    await useStore.persist.rehydrate();

    // "en" was the old default, not a choice, so it becomes "system".
    expect(useStore.getState().app.locale).toBe("system");
    // Everything else they did choose survives.
    expect(useStore.getState().app.theme).toBe("dark");
  });

  it("leaves a deliberately chosen language alone", async () => {
    // Nobody ends up on Spanish by accident, so that is a real preference.
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: 3, state: { app: { locale: "es" } } }),
    );
    await useStore.persist.rehydrate();
    expect(useStore.getState().app.locale).toBe("es");
  });

  it("falls back to a real profile when the stored active id is stale", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: 1, state: { activeProfileId: "gone" } }),
    );

    await useStore.persist.rehydrate();
    const state = useStore.getState();
    expect(state.profiles.some((p) => p.id === state.activeProfileId)).toBe(true);
    expect(selectActiveProfile(state)).toBeDefined();
  });

  it("marks itself hydrated so the UI can render", async () => {
    useStore.setState({ hydrated: false });
    await useStore.persist.rehydrate();
    expect(useStore.getState().hydrated).toBe(true);
  });
});
