import { MAX_EVENTS, useStore, resetIngestBuffers } from "@/lib/store";
import { resetMessageStore } from "@/lib/messages";
import { PLATFORMS, createProfile, type ConnectionStatus, type Platform, type StreamEvent } from "@/lib/types";

/** Ingest batches on an animation frame, so assertions need to wait for one. */
export async function flushFrames(count = 3): Promise<void> {
  for (let i = 0; i < count; i++) {
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
  }
}

export const allStatuses = (state: ConnectionStatus["state"] = "disconnected") =>
  Object.fromEntries(PLATFORMS.map((p) => [p, { state }])) as Record<Platform, ConnectionStatus>;

/** Puts the module-level store singleton back to a known state between tests. */
export function resetStore() {
  resetIngestBuffers();
  // Each test gets a fresh in-memory history, or rows leak between them.
  resetMessageStore();
  const profile = createProfile("Main", "p_default");
  useStore.setState({
    events: [],
    readIds: {},
    statuses: allStatuses(),
    filters: {
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
    },
    hydrated: true,
    historyReady: true,
    app: { locale: "en", theme: "system", twitchClientId: "", capture: "all", platformDisplay: "name", bandBackground: false, historyDays: 30 } /* tests exercise chat, so they opt in */,
    profiles: [profile],
    activeProfileId: profile.id,
    eventCap: MAX_EVENTS,
    hasMore: false,
    loadingHistory: false,
  });
}

let counter = 0;

export function makeEvent(overrides: Partial<StreamEvent> = {}): StreamEvent {
  counter += 1;
  return {
    id: `mock:e${counter}`,
    platform: "twitch",
    kind: "chat",
    author: { name: "someone" },
    message: "hello",
    timestamp: 1_700_000_000_000 + counter,
    raw: {},
    ...overrides,
  };
}
