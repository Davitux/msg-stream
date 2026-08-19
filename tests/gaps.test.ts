import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GapTracker,
  HEARTBEAT_KEY,
  MAX_GAP_MS,
  MIN_GAP_MS,
  clearHeartbeat,
  formatGapDuration,
  gapEvent,
  gapOf,
  gapSinceHeartbeat,
  markAlive,
  readHeartbeat,
} from "@/lib/gaps";
import { YouTubeAdapter, usableCursor } from "@/lib/adapters/youtube";
import type { ConnectionStatus, Cursor, StreamEvent } from "@/lib/types";

beforeEach(() => localStorage.clear());

describe("gap events", () => {
  it("round-trips through a StreamEvent", () => {
    const gap = { from: 1000, to: 61000, platform: "twitch" as const };
    const event = gapEvent(gap);

    expect(event.kind).toBe("system");
    // Placed where the feed resumes, so it sits in the right spot in time.
    expect(event.timestamp).toBe(61000);
    expect(gapOf(event)).toEqual(gap);
  });

  it("gives each gap a stable id, so a reload cannot duplicate it", () => {
    const gap = { from: 1000, to: 61000, platform: "kick" as const };
    expect(gapEvent(gap).id).toBe(gapEvent(gap).id);
    expect(gapEvent(gap).id).not.toBe(gapEvent({ ...gap, from: 2000 }).id);
  });

  it("is not a gap when it is an ordinary message", () => {
    const chat: StreamEvent = {
      id: "a",
      platform: "twitch",
      kind: "chat",
      author: { name: "x" },
      message: "hi",
      timestamp: 1,
      raw: {},
    };
    expect(gapOf(chat)).toBeNull();
  });

  it("rebuilds itself from the id and timestamp once raw is gone", () => {
    // This is what a gap looks like after being stored and read back: the
    // database drops `raw`, so the id and timestamp have to carry it.
    const original = { from: 1_700_000_000_000, to: 1_700_000_600_000, platform: "kick" as const };
    const restored = { ...gapEvent(original), raw: null };
    expect(gapOf(restored)).toEqual(original);
  });

  it("rebuilds an app-wide gap with no platform", () => {
    const original = { from: 1_700_000_000_000, to: 1_700_000_600_000 };
    expect(gapOf({ ...gapEvent(original), raw: null })).toEqual(original);
  });

  it("ignores a system event that carries nothing usable", () => {
    expect(gapOf({ ...gapEvent({ from: 1, to: 2 }), id: "system:nonsense", raw: null })).toBeNull();
  });

  it.each([
    [30_000, "<1m"],
    [90_000, "2m"],
    [45 * 60_000, "45m"],
    [60 * 60_000, "1h"],
    [95 * 60_000, "1h 35m"],
  ])("describes %ims as %s", (ms, expected) => {
    expect(formatGapDuration(ms)).toBe(expected);
  });
});

describe("surviving a reload", () => {
  it("records and reads back the moment capture was last alive", () => {
    markAlive(1_700_000_000_000);
    expect(readHeartbeat()).toBe(1_700_000_000_000);
    clearHeartbeat();
    expect(readHeartbeat()).toBeNull();
  });

  it("reports nothing when there was no previous session", () => {
    expect(gapSinceHeartbeat(null)).toBeNull();
  });

  it("reports nothing for a quick reload", () => {
    const now = 1_700_000_000_000;
    expect(gapSinceHeartbeat(now - 3_000, now)).toBeNull();
  });

  it("reports a real absence", () => {
    const now = 1_700_000_000_000;
    const gap = gapSinceHeartbeat(now - 10 * 60_000, now)!;
    expect(gap).toEqual({ from: now - 10 * 60_000, to: now });
    // App-wide, so no single platform is blamed.
    expect(gap.platform).toBeUndefined();
  });

  it("ignores a marker from some previous day", () => {
    // Coming back tomorrow shouldn't draw a 14-hour hole.
    const now = 1_700_000_000_000;
    expect(gapSinceHeartbeat(now - MAX_GAP_MS - 1, now)).toBeNull();
  });

  it("survives storage being unavailable", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("private browsing");
    });
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("private browsing");
    });

    expect(() => markAlive()).not.toThrow();
    expect(readHeartbeat()).toBeNull();

    setItem.mockRestore();
    getItem.mockRestore();
  });

  it("ignores a corrupt marker", () => {
    localStorage.setItem(HEARTBEAT_KEY, "not-a-number");
    expect(readHeartbeat()).toBeNull();
  });
});

describe("GapTracker", () => {
  let tracker: GapTracker;
  beforeEach(() => {
    tracker = new GapTracker();
  });

  it("reports nothing while a source stays live", () => {
    expect(tracker.observe("twitch", true, 1000)).toBeNull();
    expect(tracker.observe("twitch", true, 2000)).toBeNull();
  });

  it("reports the window once a source comes back", () => {
    tracker.observe("twitch", true, 0);
    tracker.observe("twitch", false, 1000);
    const gap = tracker.observe("twitch", true, 1000 + MIN_GAP_MS + 1)!;

    expect(gap).toEqual({ from: 1000, to: 1000 + MIN_GAP_MS + 1, platform: "twitch" });
  });

  it("times from the first drop, not the last retry", () => {
    tracker.observe("kick", false, 1000);
    tracker.observe("kick", false, 5000);
    tracker.observe("kick", false, 9000);
    const gap = tracker.observe("kick", true, 1000 + MIN_GAP_MS + 1)!;
    expect(gap.from).toBe(1000);
  });

  it("stays quiet about a brief reconnect", () => {
    tracker.observe("kick", false, 1000);
    expect(tracker.observe("kick", true, 1000 + MIN_GAP_MS - 1)).toBeNull();
  });

  it("keeps sources apart", () => {
    tracker.observe("twitch", false, 1000);
    tracker.observe("kick", false, 4000);

    const twitch = tracker.observe("twitch", true, 1000 + MIN_GAP_MS + 1)!;
    const kick = tracker.observe("kick", true, 4000 + MIN_GAP_MS + 1)!;
    expect(twitch.platform).toBe("twitch");
    expect(kick.platform).toBe("kick");
    expect(twitch.from).toBe(1000);
    expect(kick.from).toBe(4000);
  });

  it("does not treat a deliberate switch-off as an outage", () => {
    tracker.observe("twitch", false, 1000);
    tracker.forget("twitch");
    expect(tracker.observe("twitch", true, 1000 + MIN_GAP_MS + 1)).toBeNull();
  });

  it("reports nothing for a source that was never up", () => {
    expect(tracker.observe("youtube", true, 5000)).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* YouTube is the one source that can genuinely resume                  */
/* ------------------------------------------------------------------ */

describe("usableCursor", () => {
  const cursor: Cursor = { videoId: "vid1", liveChatId: "chat1", pageToken: "p2" };

  it("accepts a cursor for the video being watched", () => {
    expect(usableCursor(cursor, "vid1")).toEqual(cursor);
  });

  it("refuses a cursor from a different stream", () => {
    expect(usableCursor(cursor, "vid2")).toBeNull();
  });

  it.each([
    ["nothing stored", null],
    ["a cursor with no chat id", { videoId: "vid1" }],
  ])("refuses %s", (_label, value) => {
    expect(usableCursor(value as Cursor | null, "vid1")).toBeNull();
  });
});

describe("YouTubeAdapter resume", () => {
  let adapter: YouTubeAdapter;
  const sinks = () => {
    const events: StreamEvent[] = [];
    const statuses: ConnectionStatus[] = [];
    const cursors: Array<Cursor | null> = [];
    return {
      events,
      statuses,
      cursors,
      onEvent: (e: StreamEvent) => events.push(e),
      onStatus: (s: ConnectionStatus) => statuses.push(s),
      onCursor: (c: Cursor | null) => cursors.push(c),
      last: () => statuses.at(-1)!,
    };
  };

  beforeEach(() => {
    adapter = new YouTubeAdapter();
  });
  afterEach(() => {
    adapter.disconnect();
    vi.restoreAllMocks();
  });

  it("carries on from the stored page token without re-resolving the chat", async () => {
    const urls: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      urls.push(String(input));
      return { ok: true, status: 200, json: async () => ({ items: [] }) } as Response;
    });

    const s = sinks();
    await adapter.connect(
      { video: "dQw4w9WgXcQ", apiKey: "k" },
      s.onEvent,
      s.onStatus,
      s.onCursor,
      { videoId: "dQw4w9WgXcQ", liveChatId: "chat1", pageToken: "tok9" },
    );
    await vi.waitFor(() => expect(urls.length).toBeGreaterThan(0));

    // Straight to the chat, and from the exact page we stopped at.
    expect(urls[0]).toContain("/liveChat/messages");
    expect(urls[0]).toContain("pageToken=tok9");
    expect(urls.some((u) => u.includes("/videos"))).toBe(false);
    expect(s.statuses.some((x) => x.detailKey === "ytResumed")).toBe(true);
  });

  it("ignores a cursor belonging to a different video", async () => {
    const urls: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      urls.push(String(input));
      if (String(input).includes("/videos")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ items: [{ liveStreamingDetails: { activeLiveChatId: "c" } }] }),
        } as Response;
      }
      return { ok: true, status: 200, json: async () => ({ items: [] }) } as Response;
    });

    const s = sinks();
    await adapter.connect(
      { video: "dQw4w9WgXcQ", apiKey: "k" },
      s.onEvent,
      s.onStatus,
      s.onCursor,
      { videoId: "someOtherId", liveChatId: "old", pageToken: "stale" },
    );

    expect(urls[0]).toContain("/videos");
  });

  it("saves its place after every poll", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (String(input).includes("/videos")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ items: [{ liveStreamingDetails: { activeLiveChatId: "chat1" } }] }),
        } as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ nextPageToken: "next7", items: [] }),
      } as Response;
    });

    const s = sinks();
    await adapter.connect({ video: "dQw4w9WgXcQ", apiKey: "k" }, s.onEvent, s.onStatus, s.onCursor);
    await vi.waitFor(() => expect(s.cursors.length).toBeGreaterThan(0));

    expect(s.cursors[0]).toEqual({
      videoId: "dQw4w9WgXcQ",
      liveChatId: "chat1",
      pageToken: "next7",
    });
  });

  it("throws away a page token YouTube rejects", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: { message: "Invalid page token" } }),
    } as Response);

    const s = sinks();
    await adapter.connect(
      { video: "dQw4w9WgXcQ", apiKey: "k" },
      s.onEvent,
      s.onStatus,
      s.onCursor,
      { videoId: "dQw4w9WgXcQ", liveChatId: "chat1", pageToken: "stale" },
    );
    await vi.waitFor(() => expect(s.cursors.length).toBeGreaterThan(0));

    // Cleared, so the next attempt starts fresh instead of retrying a token
    // the API will keep refusing.
    expect(s.cursors.at(-1)).toBeNull();
  });
});
