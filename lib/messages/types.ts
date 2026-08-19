import type { EventKind, Platform, StreamEvent } from "../types";

/**
 * How a message is laid out on disk.
 *
 * Flattened rather than nested, because IndexedDB can only index top-level
 * scalar fields — `paid` and `read` are 0/1 for the same reason (booleans are
 * not indexable). `raw` is dropped entirely: it's the whole original API
 * payload, useful live for debugging but by far the biggest part of an event.
 */
export interface StoredMessage {
  id: string;
  profileId: string;
  platform: Platform;
  kind: EventKind;
  authorName: string;
  authorColor?: string;
  message: string;
  amountValue?: number;
  amountCurrency?: string;
  amountDisplay?: string;
  /** The platform's significance band — without it a restored row loses its colour. */
  amountTier?: number;
  amountTierMax?: number;
  timestamp: number;
  /** 1 when the message carries money. Indexed, so "paid only" is a lookup. */
  paid: 0 | 1;
  read: 0 | 1;
}

export function toStored(event: StreamEvent, profileId: string, read = false): StoredMessage {
  return {
    id: event.id,
    profileId,
    platform: event.platform,
    kind: event.kind,
    authorName: event.author.name,
    authorColor: event.author.color,
    message: event.message,
    amountValue: event.amount?.value,
    amountCurrency: event.amount?.currency,
    amountDisplay: event.amount?.display,
    amountTier: event.amount?.tier,
    amountTierMax: event.amount?.tierMax,
    timestamp: event.timestamp,
    paid: event.amount ? 1 : 0,
    read: read ? 1 : 0,
  };
}

export function toEvent(row: StoredMessage): StreamEvent {
  return {
    id: row.id,
    platform: row.platform,
    kind: row.kind,
    author: { name: row.authorName, color: row.authorColor },
    message: row.message,
    amount:
      row.amountValue === undefined || row.amountCurrency === undefined
        ? undefined
        : {
            value: row.amountValue,
            currency: row.amountCurrency,
            display: row.amountDisplay,
            tier: row.amountTier,
            tierMax: row.amountTierMax,
          },
    timestamp: row.timestamp,
    // Not persisted — see StoredMessage.
    raw: null,
  };
}

export interface PageQuery {
  profileId: string;
  limit: number;
  /** Return messages strictly older than this timestamp. Omit for the newest. */
  before?: number;
  /** Restrict to messages carrying money. */
  paidOnly?: boolean;
}

export interface StoredPage {
  rows: StoredMessage[];
  /** False once the query has reached the oldest message it can return. */
  hasMore: boolean;
}

export interface StorageEstimate {
  usage: number;
  quota: number;
  /** Whether the browser has agreed not to evict this origin automatically. */
  persisted: boolean;
}

/**
 * Durable message history.
 *
 * Mirrors the SourceAdapter pattern: one interface, swappable implementations.
 * Today that means IndexedDB in the browser and an in-memory stand-in
 * everywhere else, but it is also the seam a native SQLite build would slot
 * into without the rest of the app noticing.
 */
export interface MessageStore {
  /** Resolves once the store is usable. Must be safe to call more than once. */
  init(): Promise<void>;
  save(events: StreamEvent[], profileId: string, readIds: Record<string, true>): Promise<void>;
  page(query: PageQuery): Promise<StoredPage>;
  setRead(ids: string[], read: boolean): Promise<void>;
  /** Deletes unpaid messages older than `before`. Returns how many went. */
  pruneChat(profileId: string, before: number): Promise<number>;
  /** Removes everything belonging to one profile. */
  clearProfile(profileId: string): Promise<void>;
  /** Removes everything, for every profile. */
  clearAll(): Promise<void>;
  countFor(profileId: string): Promise<number>;
  estimate(): Promise<StorageEstimate>;
}
