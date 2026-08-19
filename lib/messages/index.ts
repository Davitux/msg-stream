import { MemoryMessageStore } from "./memory";
import type { MessageStore } from "./types";

export * from "./types";
export { MemoryMessageStore } from "./memory";
export { DexieMessageStore, requestPersistentStorage, DB_NAME } from "./dexie";

/**
 * The store the app writes through. Defaults to the in-memory implementation so
 * that server rendering and unit tests never touch a database; the browser swaps
 * in IndexedDB during startup via `installMessageStore`.
 */
let current: MessageStore = new MemoryMessageStore();

export function getMessageStore(): MessageStore {
  return current;
}

/** Replaces the active store. Returns whether `init` succeeded. */
export async function installMessageStore(store: MessageStore): Promise<boolean> {
  try {
    await store.init();
    current = store;
    return true;
  } catch {
    // A refused IndexedDB (Safari private browsing, locked-down profiles) must
    // not stop the app starting — the session just won't outlive the tab.
    current = new MemoryMessageStore();
    return false;
  }
}

/** Test hook: drops back to a clean in-memory store. */
export function resetMessageStore() {
  current = new MemoryMessageStore();
}
