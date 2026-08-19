import { DexieMessageStore, getMessageStore, installMessageStore, requestPersistentStorage } from ".";
import type { MessageStore } from "./types";
import { STORAGE_KEY, useStore } from "../store";
import type { StreamEvent } from "../types";

/**
 * Pulls the paid messages that older versions kept in localStorage into the
 * database, so upgrading doesn't throw away what a streamer had already
 * collected. Reads the raw blob directly because zustand rewrites it (without
 * these keys) as soon as anything calls `set`.
 */
export async function importLegacyMessages(store: MessageStore): Promise<number> {
  if (typeof localStorage === "undefined") return 0;

  let parsed: { state?: { savedTips?: Record<string, StreamEvent[]>; readIds?: Record<string, true> } };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return 0;
    parsed = JSON.parse(raw);
  } catch {
    return 0;
  }

  const savedTips = parsed.state?.savedTips;
  if (!savedTips || typeof savedTips !== "object") return 0;

  const readIds = parsed.state?.readIds ?? {};
  let imported = 0;

  for (const [profileId, tips] of Object.entries(savedTips)) {
    if (!Array.isArray(tips) || tips.length === 0) continue;
    await store.save(tips, profileId, readIds);
    imported += tips.length;
  }

  return imported;
}

/**
 * Brings message history up before the first render's worth of data is needed:
 * open IndexedDB, rescue anything from the previous storage scheme, drop chat
 * that has aged out, then fill the feed.
 *
 * Every step is allowed to fail without stopping the app — a browser that
 * refuses IndexedDB (Safari private browsing) falls back to memory, and the
 * session simply doesn't outlive the tab.
 */
export async function startMessageHistory(): Promise<{ durable: boolean }> {
  const durable = await installMessageStore(new DexieMessageStore());
  const store = getMessageStore();

  if (durable) {
    try {
      await importLegacyMessages(store);
    } catch {
      // Nothing to rescue, or the old blob was unreadable. Not worth blocking on.
    }

    // Asking is cheap and only matters once; without it the browser may evict
    // this origin's data wholesale when disk runs low.
    void requestPersistentStorage();

    const { app, profiles } = useStore.getState();
    if (app.historyDays > 0) {
      const cutoff = Date.now() - app.historyDays * 24 * 60 * 60 * 1000;
      for (const profile of profiles) {
        try {
          await store.pruneChat(profile.id, cutoff);
        } catch {
          // A failed prune costs disk space, not correctness.
        }
      }
    }
  }

  // Only now may adapters connect: anything ingested before this point would
  // land in the in-memory fallback rather than the database.
  useStore.getState().setHistoryReady();
  await useStore.getState().loadHistory();
  return { durable };
}
