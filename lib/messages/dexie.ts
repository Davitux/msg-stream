import Dexie, { type Table } from "dexie";
import {
  toStored,
  type MessageStore,
  type PageQuery,
  type StorageEstimate,
  type StoredMessage,
  type StoredPage,
} from "./types";
import type { StreamEvent } from "../types";

class MessageDatabase extends Dexie {
  messages!: Table<StoredMessage, string>;

  constructor(name: string) {
    super(name);
    this.version(1).stores({
      // `id` is the primary key. The compound indexes match how the feed reads:
      // newest-first within a profile, and the same again filtered to paid.
      messages: "id, profileId, timestamp, [profileId+timestamp], [profileId+paid+timestamp]",
    });
  }
}

export const DB_NAME = "msg-stream-messages";

/**
 * Message history in IndexedDB.
 *
 * Chosen over localStorage for headroom (gigabytes rather than ~5MB) and over
 * SQLite-WASM for simplicity: no WebAssembly bundle, no single-connection lock,
 * and it works in every browser. The tradeoff is that there's no query language,
 * so searching message text means scanning rows — fine at these volumes.
 */
export class DexieMessageStore implements MessageStore {
  private db: MessageDatabase;

  constructor(name: string = DB_NAME) {
    this.db = new MessageDatabase(name);
  }

  async init() {
    await this.db.open();
  }

  async save(events: StreamEvent[], profileId: string, readIds: Record<string, true>) {
    if (events.length === 0) return;
    const rows = events.map((event) => toStored(event, profileId, readIds[event.id] === true));
    // One transaction for the whole batch — the feed already groups messages per
    // animation frame, so a busy chat costs one write, not one write per message.
    await this.db.messages.bulkPut(rows);
  }

  async page({ profileId, limit, before, paidOnly }: PageQuery): Promise<StoredPage> {
    const upper = before ?? Dexie.maxKey;

    const collection = paidOnly
      ? this.db.messages
          .where("[profileId+paid+timestamp]")
          .between([profileId, 1, Dexie.minKey], [profileId, 1, upper], true, false)
      : this.db.messages
          .where("[profileId+timestamp]")
          .between([profileId, Dexie.minKey], [profileId, upper], true, false);

    // Ask for one more than requested: if it comes back, there is another page.
    const rows = await collection.reverse().limit(limit + 1).toArray();

    return {
      rows: rows.slice(0, limit),
      hasMore: rows.length > limit,
    };
  }

  async setRead(ids: string[], read: boolean) {
    if (ids.length === 0) return;
    await this.db.messages.where("id").anyOf(ids).modify({ read: read ? 1 : 0 });
  }

  async pruneChat(profileId: string, before: number) {
    return this.db.messages
      .where("[profileId+paid+timestamp]")
      .between([profileId, 0, Dexie.minKey], [profileId, 0, before], true, false)
      .delete();
  }

  async clearProfile(profileId: string) {
    await this.db.messages.where("profileId").equals(profileId).delete();
  }

  async clearAll() {
    await this.db.messages.clear();
  }

  async countFor(profileId: string) {
    return this.db.messages.where("profileId").equals(profileId).count();
  }

  async estimate(): Promise<StorageEstimate> {
    const fallback = { usage: 0, quota: 0, persisted: false };
    if (typeof navigator === "undefined" || !navigator.storage?.estimate) return fallback;

    try {
      const { usage = 0, quota = 0 } = await navigator.storage.estimate();
      const persisted = navigator.storage.persisted ? await navigator.storage.persisted() : false;
      return { usage, quota, persisted };
    } catch {
      return fallback;
    }
  }
}

/**
 * Asks the browser not to evict this origin when disk runs low. Without it,
 * storage is treated as "best effort" and can be cleared under pressure — and
 * eviction takes an origin's data all at once, not the oldest slice of it.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.storage?.persist) return false;
  try {
    if (navigator.storage.persisted && (await navigator.storage.persisted())) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
