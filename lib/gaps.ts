import type { Platform, StreamEvent } from "./types";

/**
 * Only YouTube can replay what it missed. Twitch's EventSub and Kick's Pusher
 * socket deliver from the moment you subscribe and publish no history, and
 * Streamlabs' realtime feed is the same. So for those, the honest thing is not
 * to pretend nothing happened — it's to say plainly that there is a hole.
 *
 * A gap becomes a `system` event in the feed: it sits in the timeline where the
 * missing messages would have been, so a streamer scrolling back can see they
 * were offline rather than believing it was simply quiet.
 */

/** Shorter breaks than this are reconnect noise, not something worth a row. */
export const MIN_GAP_MS = 20_000;

/** How often the "still running" marker is written while sources are live. */
export const HEARTBEAT_MS = 10_000;

/**
 * A heartbeat older than this is treated as a different session rather than a
 * gap — coming back the next day shouldn't draw a 14-hour hole.
 */
export const MAX_GAP_MS = 6 * 60 * 60 * 1000;

export const HEARTBEAT_KEY = "msg-stream:alive";

export interface Gap {
  from: number;
  to: number;
  /** Absent when the whole app was down rather than one source. */
  platform?: Platform;
}

export function gapEvent(gap: Gap): StreamEvent {
  return {
    id: `system:gap:${gap.platform ?? "app"}:${gap.from}`,
    platform: gap.platform ?? "youtube",
    kind: "system",
    author: { name: "" },
    message: "",
    // Placed at the end of the gap, which is where the feed resumes.
    timestamp: gap.to,
    raw: gap,
  };
}

/**
 * Reads a gap back off a system event.
 *
 * `raw` is not persisted — it's the bulky original payload for real messages —
 * so a gap restored from history has none. That's fine: the id and timestamp
 * carry everything a gap is, so it can be rebuilt from them and survives a
 * reload without needing its own columns.
 */
export function gapOf(event: StreamEvent): Gap | null {
  if (event.kind !== "system") return null;

  const stored = event.raw as Gap | null;
  if (stored && typeof stored.from === "number" && typeof stored.to === "number") {
    return stored;
  }

  const match = /^system:gap:([a-z]+):(\d+)$/.exec(event.id);
  if (!match) return null;

  const from = Number(match[2]);
  if (!Number.isFinite(from) || !Number.isFinite(event.timestamp)) return null;

  return {
    from,
    to: event.timestamp,
    platform: match[1] === "app" ? undefined : (match[1] as Gap["platform"]),
  };
}

export function formatGapDuration(ms: number): string {
  // Checked before rounding: 30s rounds to 1 minute, and claiming a whole
  // minute of lost messages when it was half that is the wrong way to be wrong.
  if (ms < 60_000) return "<1m";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

/* ------------------------------------------------------------------ */
/* Surviving a reload                                                   */
/* ------------------------------------------------------------------ */

/**
 * Records that the app is alive and listening. Written on a timer while any
 * source is live, so that after a crash or an accidental reload the last mark
 * says roughly when messages stopped being captured.
 */
export function markAlive(now: number = Date.now()) {
  try {
    localStorage.setItem(HEARTBEAT_KEY, String(now));
  } catch {
    // Storage can be unavailable (private browsing); losing the marker only
    // costs us the gap notice, so it must never throw.
  }
}

export function readHeartbeat(): number | null {
  try {
    const raw = localStorage.getItem(HEARTBEAT_KEY);
    if (!raw) return null;
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

export function clearHeartbeat() {
  try {
    localStorage.removeItem(HEARTBEAT_KEY);
  } catch {
    // Same as above.
  }
}

/**
 * Works out whether the time since the last heartbeat is worth reporting.
 * Returns null for a normal restart, a quick reload, or a stale marker from
 * some previous day.
 */
export function gapSinceHeartbeat(
  lastAlive: number | null,
  now: number = Date.now(),
): Gap | null {
  if (lastAlive === null) return null;
  const elapsed = now - lastAlive;
  if (elapsed < MIN_GAP_MS || elapsed > MAX_GAP_MS) return null;
  return { from: lastAlive, to: now };
}

/* ------------------------------------------------------------------ */
/* Gaps within a session                                                */
/* ------------------------------------------------------------------ */

/**
 * Tracks when each source drops and comes back, so a mid-stream outage is
 * reported the same way a reload is.
 */
export class GapTracker {
  private downSince = new Map<Platform, number>();

  /** Call on every status change. Returns a gap when one just closed. */
  observe(platform: Platform, live: boolean, now: number = Date.now()): Gap | null {
    if (!live) {
      // Keep the first moment it went down, not the latest retry.
      if (!this.downSince.has(platform)) this.downSince.set(platform, now);
      return null;
    }

    const from = this.downSince.get(platform);
    this.downSince.delete(platform);
    if (from === undefined) return null;

    const elapsed = now - from;
    if (elapsed < MIN_GAP_MS) return null;
    return { from, to: now, platform };
  }

  /** Forgets a source entirely, e.g. when it is switched off on purpose. */
  forget(platform: Platform) {
    this.downSince.delete(platform);
  }

  reset() {
    this.downSince.clear();
  }
}
