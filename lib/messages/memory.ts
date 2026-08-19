import { toStored, type MessageStore, type PageQuery, type StoredMessage, type StoredPage, type StorageEstimate } from "./types";
import type { StreamEvent } from "../types";

/**
 * A MessageStore that keeps everything in a Map and nothing on disk.
 *
 * This is the fallback, not a toy: Safari's private browsing and some locked-down
 * profiles refuse IndexedDB outright, and a feed that works for the session beats
 * an app that won't start. It's also what the unit tests run against, so the
 * store's own logic can be tested without a database.
 */
export class MemoryMessageStore implements MessageStore {
  private rows = new Map<string, StoredMessage>();

  async init() {}

  async save(events: StreamEvent[], profileId: string, readIds: Record<string, true>) {
    for (const event of events) {
      this.rows.set(event.id, toStored(event, profileId, readIds[event.id] === true));
    }
  }

  async page({ profileId, limit, before, paidOnly }: PageQuery): Promise<StoredPage> {
    const matching = [...this.rows.values()]
      .filter(
        (row) =>
          row.profileId === profileId &&
          (before === undefined || row.timestamp < before) &&
          (!paidOnly || row.paid === 1),
      )
      .sort((a, b) => b.timestamp - a.timestamp);

    return { rows: matching.slice(0, limit), hasMore: matching.length > limit };
  }

  async setRead(ids: string[], read: boolean) {
    for (const id of ids) {
      const row = this.rows.get(id);
      if (row) row.read = read ? 1 : 0;
    }
  }

  async pruneChat(profileId: string, before: number) {
    let removed = 0;
    for (const [id, row] of this.rows) {
      if (row.profileId === profileId && row.paid === 0 && row.timestamp < before) {
        this.rows.delete(id);
        removed += 1;
      }
    }
    return removed;
  }

  async clearProfile(profileId: string) {
    for (const [id, row] of this.rows) {
      if (row.profileId === profileId) this.rows.delete(id);
    }
  }

  async clearAll() {
    this.rows.clear();
  }

  async countFor(profileId: string) {
    let count = 0;
    for (const row of this.rows.values()) if (row.profileId === profileId) count += 1;
    return count;
  }

  async estimate(): Promise<StorageEstimate> {
    return { usage: 0, quota: 0, persisted: false };
  }
}
