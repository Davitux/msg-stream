import { beforeEach, afterEach, describe, expect, it } from "vitest";
import "fake-indexeddb/auto";
import {
  DexieMessageStore,
  MemoryMessageStore,
  installMessageStore,
  getMessageStore,
  toEvent,
} from "@/lib/messages";
import type { MessageStore } from "@/lib/messages";
import { importLegacyMessages, startMessageHistory } from "@/lib/messages/startup";
import { MAX_EVENTS, PAGE_SIZE, STORAGE_KEY, useStore } from "@/lib/store";
import { flushFrames, makeEvent, resetStore } from "./helpers";
import type { StreamEvent } from "@/lib/types";

const tip = (id: string, over: Partial<StreamEvent> = {}) =>
  makeEvent({ id, kind: "tip", amount: { value: 5, currency: "USD", display: "$5.00" }, ...over });

const chat = (id: string, over: Partial<StreamEvent> = {}) => makeEvent({ id, ...over });

/* ------------------------------------------------------------------ */
/* Both implementations must behave the same                           */
/* ------------------------------------------------------------------ */

const implementations: Array<[string, () => MessageStore]> = [
  ["MemoryMessageStore", () => new MemoryMessageStore()],
  ["DexieMessageStore", () => new DexieMessageStore(`test-${Math.random().toString(36).slice(2)}`)],
];

describe.each(implementations)("%s", (_name, make) => {
  let store: MessageStore;

  beforeEach(async () => {
    store = make();
    await store.init();
  });

  it("stores a message and reads it back", async () => {
    await store.save([chat("a", { message: "hola", author: { name: "nadia" } })], "p1", {});
    const { rows } = await store.page({ profileId: "p1", limit: 10 });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "a",
      profileId: "p1",
      message: "hola",
      authorName: "nadia",
      paid: 0,
      read: 0,
    });
  });

  it("flattens an amount and marks the row paid", async () => {
    await store.save([tip("t1")], "p1", {});
    const { rows } = await store.page({ profileId: "p1", limit: 10 });

    expect(rows[0]).toMatchObject({
      paid: 1,
      amountValue: 5,
      amountCurrency: "USD",
      amountDisplay: "$5.00",
    });
  });

  it("returns newest first", async () => {
    await store.save(
      [chat("old", { timestamp: 100 }), chat("new", { timestamp: 300 }), chat("mid", { timestamp: 200 })],
      "p1",
      {},
    );
    const { rows } = await store.page({ profileId: "p1", limit: 10 });
    expect(rows.map((r) => r.id)).toEqual(["new", "mid", "old"]);
  });

  it("keeps profiles apart", async () => {
    await store.save([chat("a")], "p1", {});
    await store.save([chat("b")], "p2", {});

    expect((await store.page({ profileId: "p1", limit: 10 })).rows.map((r) => r.id)).toEqual(["a"]);
    expect((await store.page({ profileId: "p2", limit: 10 })).rows.map((r) => r.id)).toEqual(["b"]);
  });

  it("pages backwards through history without repeating", async () => {
    const many = Array.from({ length: 25 }, (_, i) => chat(`m${i}`, { timestamp: 1000 + i }));
    await store.save(many, "p1", {});

    const first = await store.page({ profileId: "p1", limit: 10 });
    expect(first.rows).toHaveLength(10);
    expect(first.hasMore).toBe(true);

    const second = await store.page({
      profileId: "p1",
      limit: 10,
      before: first.rows[first.rows.length - 1].timestamp,
    });
    expect(second.rows).toHaveLength(10);
    expect(second.rows.map((r) => r.id)).not.toContain(first.rows[0].id);

    const third = await store.page({
      profileId: "p1",
      limit: 10,
      before: second.rows[second.rows.length - 1].timestamp,
    });
    expect(third.rows).toHaveLength(5);
    expect(third.hasMore).toBe(false);
  });

  it("can return only the paid messages", async () => {
    await store.save([chat("c1"), tip("t1"), chat("c2"), tip("t2")], "p1", {});
    const { rows } = await store.page({ profileId: "p1", limit: 10, paidOnly: true });
    expect(rows.map((r) => r.id).sort()).toEqual(["t1", "t2"]);
  });

  it("records read marks, including ones set before the message was stored", async () => {
    await store.save([chat("a"), chat("b")], "p1", { a: true });
    let { rows } = await store.page({ profileId: "p1", limit: 10 });
    expect(rows.find((r) => r.id === "a")?.read).toBe(1);
    expect(rows.find((r) => r.id === "b")?.read).toBe(0);

    await store.setRead(["b"], true);
    await store.setRead(["a"], false);
    ({ rows } = await store.page({ profileId: "p1", limit: 10 }));
    expect(rows.find((r) => r.id === "a")?.read).toBe(0);
    expect(rows.find((r) => r.id === "b")?.read).toBe(1);
  });

  it("overwrites rather than duplicating when the same id is saved twice", async () => {
    await store.save([chat("a", { message: "first" })], "p1", {});
    await store.save([chat("a", { message: "second" })], "p1", {});

    const { rows } = await store.page({ profileId: "p1", limit: 10 });
    expect(rows).toHaveLength(1);
    expect(rows[0].message).toBe("second");
  });

  it("prunes old chat but never paid messages", async () => {
    await store.save(
      [
        chat("oldChat", { timestamp: 100 }),
        tip("oldTip", { timestamp: 100 }),
        chat("newChat", { timestamp: 900 }),
      ],
      "p1",
      {},
    );

    const removed = await store.pruneChat("p1", 500);
    expect(removed).toBe(1);

    const { rows } = await store.page({ profileId: "p1", limit: 10 });
    expect(rows.map((r) => r.id).sort()).toEqual(["newChat", "oldTip"]);
  });

  it("does not prune another profile's chat", async () => {
    await store.save([chat("a", { timestamp: 100 })], "p1", {});
    await store.save([chat("b", { timestamp: 100 })], "p2", {});

    await store.pruneChat("p1", 500);
    expect((await store.page({ profileId: "p2", limit: 10 })).rows).toHaveLength(1);
  });

  it("clears one profile without touching the other", async () => {
    await store.save([chat("a")], "p1", {});
    await store.save([chat("b")], "p2", {});

    await store.clearProfile("p1");
    expect(await store.countFor("p1")).toBe(0);
    expect(await store.countFor("p2")).toBe(1);

    await store.clearAll();
    expect(await store.countFor("p2")).toBe(0);
  });

  it("counts what it holds for a profile", async () => {
    await store.save([chat("a"), chat("b"), tip("t")], "p1", {});
    expect(await store.countFor("p1")).toBe(3);
    expect(await store.countFor("nope")).toBe(0);
  });

  it("keeps the band, so a restored row still shows its colour", async () => {
    // Regression: tier was dropped on write, so anything loaded from history
    // came back colourless while live messages were tinted.
    await store.save(
      [
        makeEvent({
          id: "banded",
          platform: "youtube",
          amount: { value: 50, currency: "USD", display: "$50.00", tier: 6, tierMax: 7 },
        }),
      ],
      "p1",
      {},
    );

    const { rows } = await store.page({ profileId: "p1", limit: 10 });
    expect(rows[0]).toMatchObject({ amountTier: 6, amountTierMax: 7 });
    expect(toEvent(rows[0]).amount).toEqual({
      value: 50,
      currency: "USD",
      display: "$50.00",
      tier: 6,
      tierMax: 7,
    });
  });

  it("drops the bulky raw payload", async () => {
    await store.save([chat("a", { raw: { huge: "x".repeat(1000) } })], "p1", {});
    const { rows } = await store.page({ profileId: "p1", limit: 10 });
    expect(JSON.stringify(rows[0])).not.toContain("huge");
  });

  it("saving nothing is a no-op", async () => {
    await store.save([], "p1", {});
    expect(await store.countFor("p1")).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* The store wired to the feed                                         */
/* ------------------------------------------------------------------ */

describe("history behind the feed", () => {
  beforeEach(async () => {
    resetStore();
    await installMessageStore(new DexieMessageStore(`feed-${Math.random().toString(36).slice(2)}`));
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("writes every message that arrives, chat included", async () => {
    useStore.getState().ingest(chat("c1", { message: "ordinary chat" }));
    useStore.getState().ingest(tip("t1"));
    await flushFrames();

    const profileId = useStore.getState().activeProfileId;
    expect(await getMessageStore().countFor(profileId)).toBe(2);
  });

  it("brings the feed back after a reload", async () => {
    useStore.getState().ingest(chat("c1", { message: "still here" }));
    useStore.getState().ingest(tip("t1"));
    await flushFrames();

    // Simulate a fresh page: memory gone, database intact.
    useStore.setState({ events: [], readIds: {} });
    await useStore.getState().loadHistory();

    const { events } = useStore.getState();
    expect(events.map((e) => e.id).sort()).toEqual(["c1", "t1"]);
    expect(events.find((e) => e.id === "c1")?.message).toBe("still here");
  });

  it("brings read marks back with the messages", async () => {
    useStore.getState().ingest(chat("c1"));
    useStore.getState().ingest(chat("c2"));
    await flushFrames();
    useStore.getState().markRead("c1", true);
    await flushFrames();

    useStore.setState({ events: [], readIds: {} });
    await useStore.getState().loadHistory();

    const { readIds } = useStore.getState();
    expect(readIds.c1).toBe(true);
    expect(readIds.c2).toBeUndefined();
  });

  it("persists mark-all-read", async () => {
    for (let i = 0; i < 4; i++) useStore.getState().ingest(chat(`m${i}`));
    await flushFrames();
    useStore.getState().markAllRead();
    await flushFrames();

    useStore.setState({ events: [], readIds: {} });
    await useStore.getState().loadHistory();
    expect(Object.keys(useStore.getState().readIds)).toHaveLength(4);
  });

  it("keeps a message that scrolled out of the feed", async () => {
    useStore.getState().ingest(chat("early", { message: "way back", timestamp: 1 }));
    for (let i = 0; i < MAX_EVENTS + 20; i++) {
      useStore.getState().ingest(chat(`flood${i}`, { timestamp: 1000 + i }));
    }
    await flushFrames();

    // Gone from the feed...
    expect(useStore.getState().events.some((e) => e.id === "early")).toBe(false);
    // ...but not from disk.
    const profileId = useStore.getState().activeProfileId;
    expect(await getMessageStore().countFor(profileId)).toBe(MAX_EVENTS + 21);
  });

  it("pulls older pages on demand and stops when there are none", async () => {
    const total = PAGE_SIZE + 30;
    for (let i = 0; i < total; i++) {
      useStore.getState().ingest(chat(`m${i}`, { timestamp: 1000 + i }));
    }
    await flushFrames();

    useStore.setState({ events: [], readIds: {} });
    await useStore.getState().loadHistory();
    expect(useStore.getState().events).toHaveLength(PAGE_SIZE);
    expect(useStore.getState().hasMore).toBe(true);

    await useStore.getState().loadOlder();
    expect(useStore.getState().events).toHaveLength(total);
    expect(useStore.getState().hasMore).toBe(false);

    // Nothing duplicated.
    const ids = useStore.getState().events.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("does not let live messages trim away a page just loaded", async () => {
    for (let i = 0; i < PAGE_SIZE + 30; i++) {
      useStore.getState().ingest(chat(`m${i}`, { timestamp: 1000 + i }));
    }
    await flushFrames();
    useStore.setState({ events: [], readIds: {} });
    await useStore.getState().loadHistory();
    await useStore.getState().loadOlder();

    const loaded = useStore.getState().events.length;
    useStore.getState().ingest(chat("live", { timestamp: 99_999 }));
    await flushFrames();

    expect(useStore.getState().events).toHaveLength(loaded + 1);
    expect(useStore.getState().events[0].id).toBe("live");
  });

  it("keeps a live message that lands while history is loading", async () => {
    useStore.getState().ingest(chat("stored", { timestamp: 100 }));
    await flushFrames();
    useStore.setState({ events: [], readIds: {} });

    const loading = useStore.getState().loadHistory();
    useStore.getState().ingest(chat("live", { timestamp: 5000 }));
    await loading;
    await flushFrames();

    const ids = useStore.getState().events.map((e) => e.id);
    expect(ids).toContain("stored");
    expect(ids).toContain("live");
  });

  it("gives each profile its own history", async () => {
    useStore.getState().ingest(chat("main-msg"));
    await flushFrames();

    useStore.getState().addProfile("Second");
    useStore.getState().ingest(chat("second-msg"));
    await flushFrames();
    expect(useStore.getState().events.map((e) => e.id)).toEqual(["second-msg"]);

    const mainId = useStore.getState().profiles[0].id;
    useStore.getState().setActiveProfile(mainId);
    // The feed empties at once rather than showing the old profile's messages.
    expect(useStore.getState().events).toEqual([]);

    await useStore.getState().loadHistory(mainId);
    expect(useStore.getState().events.map((e) => e.id)).toEqual(["main-msg"]);
  });

  it("forgets a deleted profile's history", async () => {
    useStore.getState().addProfile("Second");
    const secondId = useStore.getState().activeProfileId;
    useStore.getState().ingest(chat("second-msg"));
    await flushFrames();

    useStore.getState().deleteProfile(secondId);
    await flushFrames();
    expect(await getMessageStore().countFor(secondId)).toBe(0);
  });

  it("clearHistory empties both the feed and the database", async () => {
    useStore.getState().ingest(chat("a"));
    useStore.getState().ingest(tip("t"));
    await flushFrames();

    const profileId = useStore.getState().activeProfileId;
    await useStore.getState().clearHistory();

    expect(useStore.getState().events).toEqual([]);
    expect(await getMessageStore().countFor(profileId)).toBe(0);
  });

  it("is not ready until the durable store is open", async () => {
    // Adapters wait on this. Connecting earlier would write the first messages
    // of a session to the in-memory fallback, losing them on reload.
    resetStore();
    useStore.setState({ historyReady: false });
    expect(useStore.getState().historyReady).toBe(false);

    await startMessageHistory();
    expect(useStore.getState().historyReady).toBe(true);
  });

  it("keeps working when the database refuses to open", async () => {
    class BrokenStore extends MemoryMessageStore {
      async init() {
        throw new Error("IndexedDB unavailable");
      }
    }
    const durable = await installMessageStore(new BrokenStore());
    expect(durable).toBe(false);

    // The feed still works; it just won't outlive the tab.
    useStore.getState().ingest(chat("a"));
    await flushFrames();
    expect(useStore.getState().events.map((e) => e.id)).toEqual(["a"]);
  });
});

/* ------------------------------------------------------------------ */
/* Upgrading from the localStorage scheme                              */
/* ------------------------------------------------------------------ */

describe("importing the old localStorage tips", () => {
  beforeEach(() => {
    resetStore();
    localStorage.clear();
  });

  it("rescues saved tips into the database", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 1,
        state: {
          readIds: { t1: true },
          savedTips: {
            p_default: [
              { ...tip("t1", { message: "gracias" }), raw: null },
              { ...tip("t2"), raw: null },
            ],
            other: [{ ...tip("t3"), raw: null }],
          },
        },
      }),
    );

    const store = new MemoryMessageStore();
    const imported = await importLegacyMessages(store);
    expect(imported).toBe(3);

    const { rows } = await store.page({ profileId: "p_default", limit: 10 });
    expect(rows.map((r) => r.id).sort()).toEqual(["t1", "t2"]);
    expect(rows.find((r) => r.id === "t1")?.read).toBe(1);
    expect(await store.countFor("other")).toBe(1);
  });

  it("does nothing when there is no old blob", async () => {
    const store = new MemoryMessageStore();
    expect(await importLegacyMessages(store)).toBe(0);
  });

  it("does nothing when the blob is unreadable", async () => {
    localStorage.setItem(STORAGE_KEY, "{not json");
    const store = new MemoryMessageStore();
    expect(await importLegacyMessages(store)).toBe(0);
  });

  it("does nothing for a blob that has already moved on", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 2, state: { app: {} } }));
    const store = new MemoryMessageStore();
    expect(await importLegacyMessages(store)).toBe(0);
  });
});
