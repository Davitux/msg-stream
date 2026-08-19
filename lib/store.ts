"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { getMessageStore, toEvent } from "./messages";
import {
  PLATFORMS,
  createProfile,
  type AppSettings,
  type CaptureMode,
  type ConnectionStatus,
  type PlatformDisplay,
  type Locale,
  type Platform,
  type Cursor,
  type Profile,
  type StreamEvent,
  type Theme,
} from "./types";

/**
 * How many live messages the feed holds before the oldest fall off. History is
 * safe on disk, so this only governs what's rendered — an eight-hour stream
 * can't grow the array without bound and take the tab down with it.
 */
export const MAX_EVENTS = 1000;

/** How many older messages one "Load older" press pulls back from the database. */
export const PAGE_SIZE = 200;

/** Chat older than this is pruned on startup. 0 keeps everything. */
export const DEFAULT_HISTORY_DAYS = 30;

export const STORAGE_KEY = "msg-stream";

export interface Filters {
  unreadOnly: boolean;
  tipsOnly: boolean;
  platforms: Record<Platform, boolean>;
}

export const DEFAULT_APP: AppSettings = {
  locale: "en",
  theme: "system",
  twitchClientId: "",
  capture: "paid",
  platformDisplay: "name",
  bandBackground: false,
  historyDays: DEFAULT_HISTORY_DAYS,
};

const defaultFilters: Filters = {
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

const defaultStatuses = () =>
  Object.fromEntries(
    PLATFORMS.map((p) => [p, { state: "disconnected" } as ConnectionStatus]),
  ) as Record<Platform, ConnectionStatus>;

interface StoreState {
  events: StreamEvent[];
  /**
   * Read ids for what's on screen. The database is the durable record — this is
   * the in-memory mirror, so a render can check read state without awaiting.
   */
  readIds: Record<string, true>;
  statuses: Record<Platform, ConnectionStatus>;
  filters: Filters;
  hydrated: boolean;
  /**
   * True once the durable message store is open. Adapters must not connect
   * before this: a message arriving while IndexedDB is still opening would be
   * written to the in-memory fallback and lost on reload.
   */
  historyReady: boolean;

  /** Grows as older pages are pulled in, so paging can't be undone by trimming. */
  eventCap: number;
  hasMore: boolean;
  loadingHistory: boolean;

  app: AppSettings;
  profiles: Profile[];
  activeProfileId: string;
  /** Per-profile, per-platform resume points. Small, so they live alongside settings. */
  cursors: Record<string, Partial<Record<Platform, Cursor | null>>>;

  setCursor: (platform: Platform, cursor: Cursor | null) => void;

  ingest: (event: StreamEvent) => void;
  markRead: (id: string, read: boolean) => void;
  markAllRead: () => void;
  clearEvents: () => void;
  setStatus: (platform: Platform, status: ConnectionStatus) => void;
  setFilters: (patch: Partial<Filters>) => void;
  setHydrated: () => void;
  setHistoryReady: () => void;

  setLocale: (locale: Locale) => void;
  setTheme: (theme: Theme) => void;
  setTwitchClientId: (clientId: string) => void;
  setCapture: (mode: CaptureMode) => void;
  setPlatformDisplay: (display: PlatformDisplay) => void;
  setBandBackground: (on: boolean) => void;
  setHistoryDays: (days: number) => void;

  updateProfile: (patch: Partial<Omit<Profile, "id">>) => void;
  addProfile: (name: string) => void;
  renameProfile: (id: string, name: string) => void;
  deleteProfile: (id: string) => void;
  setActiveProfile: (id: string) => void;

  /** Replaces the feed with the newest stored messages for a profile. */
  loadHistory: (profileId?: string) => Promise<void>;
  /** Appends the next older page. */
  loadOlder: () => Promise<void>;
  /** Deletes stored messages for the active profile and empties the feed. */
  clearHistory: () => Promise<void>;
}

/**
 * Ids currently in the feed, for dedupe. Kept outside the store because it is
 * derived cache, not state anyone renders. YouTube re-sends recent history on
 * connect, so this is load-bearing.
 */
let seen = new Set<string>();

/**
 * Incoming messages are batched to one commit per animation frame. A busy chat
 * delivers each message in its own tick, which would otherwise mean a React
 * render — and a database write — per message.
 */
let pending: StreamEvent[] = [];
let frame: number | null = null;

/** Test hook: drops the batching/dedupe caches that live outside the store. */
export function resetIngestBuffers() {
  seen = new Set();
  pending = [];
  if (frame !== null) frame = null;
}

/** Full reset: for a profile switch or an explicit clear. */
function primeSeen(events: StreamEvent[]) {
  resetIngestBuffers();
  for (const event of events) seen.add(event.id);
}

/**
 * Rebuilds the dedupe set around a new feed without touching `pending` — a
 * history load must not discard live messages that haven't flushed yet.
 */
function rebuildSeen(events: StreamEvent[]) {
  seen = new Set(events.map((event) => event.id));
  for (const event of pending) seen.add(event.id);
}

/** Fire-and-forget database work. A failed write must never break the feed. */
function background(work: Promise<unknown>) {
  void work.catch((error: unknown) => {
    console.warn("[msg-stream] history write failed", error);
  });
}

const firstProfile = createProfile("Main", "p_default");

export const useStore = create<StoreState>()(
  persist(
    (set, get) => ({
      events: [],
      readIds: {},
      statuses: defaultStatuses(),
      filters: defaultFilters,
      hydrated: false,
      historyReady: false,

      eventCap: MAX_EVENTS,
      hasMore: false,
      loadingHistory: false,

      app: DEFAULT_APP,
      profiles: [firstProfile],
      activeProfileId: firstProfile.id,
      cursors: {},

      setCursor: (platform, cursor) =>
        set((state) => ({
          cursors: {
            ...state.cursors,
            [state.activeProfileId]: {
              ...state.cursors[state.activeProfileId],
              [platform]: cursor,
            },
          },
        })),

      ingest: (event) => {
        // Dropped here rather than at render, so unwanted chat costs neither a
        // database write nor a place in the buffer.
        if (!shouldCapture(event, get().app.capture)) return;
        if (seen.has(event.id)) return;
        seen.add(event.id);
        pending.push(event);

        if (frame !== null) return;
        const flush = () => {
          frame = null;
          if (pending.length === 0) return;
          const batch = pending;
          pending = [];
          batch.reverse(); // newest first, matching the feed

          const { activeProfileId, readIds } = get();
          background(getMessageStore().save(batch, activeProfileId, readIds));

          set((state) => {
            const next = [...batch, ...state.events];
            if (next.length > state.eventCap) {
              // Only the on-screen copy is trimmed; the rows stay on disk.
              for (const dropped of next.slice(state.eventCap)) seen.delete(dropped.id);
              next.length = state.eventCap;
            }
            return { events: next };
          });
        };
        frame =
          typeof requestAnimationFrame === "function"
            ? requestAnimationFrame(flush)
            : (setTimeout(flush, 16) as unknown as number);
      },

      markRead: (id, read) => {
        background(getMessageStore().setRead([id], read));
        set((state) => {
          const readIds = { ...state.readIds };
          if (read) readIds[id] = true;
          else delete readIds[id];
          return { readIds };
        });
      },

      markAllRead: () => {
        const ids = get().events.map((event) => event.id);
        if (ids.length === 0) return;
        background(getMessageStore().setRead(ids, true));
        set((state) => {
          const readIds = { ...state.readIds };
          for (const id of ids) readIds[id] = true;
          return { readIds };
        });
      },

      clearEvents: () => {
        resetIngestBuffers();
        set({ events: [], eventCap: MAX_EVENTS, hasMore: false });
      },

      setStatus: (platform, status) =>
        set((state) => ({ statuses: { ...state.statuses, [platform]: status } })),

      setFilters: (patch) => set((state) => ({ filters: { ...state.filters, ...patch } })),

      setHydrated: () => set({ hydrated: true }),
      setHistoryReady: () => set({ historyReady: true }),

      setLocale: (locale) => set((state) => ({ app: { ...state.app, locale } })),
      setTheme: (theme) => set((state) => ({ app: { ...state.app, theme } })),
      setTwitchClientId: (twitchClientId) =>
        set((state) => ({ app: { ...state.app, twitchClientId } })),
      setCapture: (capture) => set((state) => ({ app: { ...state.app, capture } })),
      setPlatformDisplay: (platformDisplay) =>
        set((state) => ({ app: { ...state.app, platformDisplay } })),
      setBandBackground: (bandBackground) =>
        set((state) => ({ app: { ...state.app, bandBackground } })),
      setHistoryDays: (historyDays) =>
        set((state) => ({ app: { ...state.app, historyDays: Math.max(0, historyDays) } })),

      updateProfile: (patch) =>
        set((state) => ({
          profiles: state.profiles.map((p) =>
            p.id === state.activeProfileId ? { ...p, ...patch, id: p.id } : p,
          ),
        })),

      addProfile: (name) => {
        const profile = createProfile(name);
        primeSeen([]);
        set((state) => ({
          profiles: [...state.profiles, profile],
          activeProfileId: profile.id,
          events: [],
          readIds: {},
          eventCap: MAX_EVENTS,
          hasMore: false,
          statuses: defaultStatuses(),
        }));
      },

      renameProfile: (id, name) =>
        set((state) => ({
          profiles: state.profiles.map((p) => (p.id === id ? { ...p, name } : p)),
        })),

      deleteProfile: (id) => {
        const { profiles, activeProfileId } = get();
        // There is always something to switch to; deleting the last profile
        // would leave the app with no channels to configure at all.
        if (profiles.length <= 1) return;

        background(getMessageStore().clearProfile(id));

        const remaining = profiles.filter((p) => p.id !== id);
        const switching = activeProfileId === id;
        const target = switching ? remaining[0].id : activeProfileId;

        set({ profiles: remaining, activeProfileId: target });
        if (switching) {
          primeSeen([]);
          set({
            events: [],
            readIds: {},
            eventCap: MAX_EVENTS,
            hasMore: false,
            statuses: defaultStatuses(),
          });
          void get().loadHistory(target);
        }
      },

      setActiveProfile: (id) => {
        if (get().activeProfileId === id) return;
        if (!get().profiles.some((p) => p.id === id)) return;
        // Clear immediately rather than waiting on the database, so the feed and
        // the profile name on screen never disagree.
        primeSeen([]);
        set({
          activeProfileId: id,
          events: [],
          readIds: {},
          eventCap: MAX_EVENTS,
          hasMore: false,
          statuses: defaultStatuses(),
        });
        void get().loadHistory(id);
      },

      loadHistory: async (profileId) => {
        const target = profileId ?? get().activeProfileId;
        set({ loadingHistory: true });

        try {
          const { rows, hasMore } = await getMessageStore().page({
            profileId: target,
            limit: PAGE_SIZE,
          });

          // A profile switch may have landed while this was in flight.
          if (get().activeProfileId !== target) return;

          const stored = rows.map(toEvent);
          const storedIds = new Set(stored.map((event) => event.id));

          set((state) => {
            // Live messages can land while the read is in flight; keep them
            // rather than letting the stored page overwrite the feed.
            const live = state.events.filter((event) => !storedIds.has(event.id));
            const events = [...live, ...stored].sort((a, b) => b.timestamp - a.timestamp);

            const readIds = { ...state.readIds };
            for (const row of rows) {
              if (row.read === 1) readIds[row.id] = true;
              else delete readIds[row.id];
            }

            rebuildSeen(events);
            return {
              events,
              readIds,
              hasMore,
              eventCap: Math.max(MAX_EVENTS, events.length),
            };
          });
        } finally {
          set({ loadingHistory: false });
        }
      },

      loadOlder: async () => {
        const { events, activeProfileId, hasMore, loadingHistory } = get();
        if (!hasMore || loadingHistory) return;

        const oldest = events[events.length - 1]?.timestamp;
        set({ loadingHistory: true });

        try {
          const page = await getMessageStore().page({
            profileId: activeProfileId,
            limit: PAGE_SIZE,
            before: oldest,
          });
          if (get().activeProfileId !== activeProfileId) return;

          const older = page.rows.map(toEvent).filter((event) => !seen.has(event.id));
          for (const event of older) seen.add(event.id);

          set((state) => {
            const readIds = { ...state.readIds };
            for (const row of page.rows) if (row.read === 1) readIds[row.id] = true;
            const next = [...state.events, ...older];
            return {
              events: next,
              readIds,
              hasMore: page.hasMore,
              // Raise the ceiling so live messages can't trim away what was
              // just deliberately loaded.
              eventCap: Math.max(state.eventCap, next.length + PAGE_SIZE),
            };
          });
        } finally {
          set({ loadingHistory: false });
        }
      },

      clearHistory: async () => {
        const profileId = get().activeProfileId;
        await getMessageStore().clearProfile(profileId);
        resetIngestBuffers();
        set({ events: [], readIds: {}, hasMore: false, eventCap: MAX_EVENTS });
      },
    }),
    {
      name: STORAGE_KEY,
      version: 3,
      storage: createJSONStorage(() => localStorage),
      // Rehydrate on demand rather than at import time, so the client's first
      // render matches the prerendered HTML.
      skipHydration: true,
      // Messages and read marks live in IndexedDB now; only settings are here.
      partialize: (state) => ({
        filters: state.filters,
        app: state.app,
        profiles: state.profiles,
        activeProfileId: state.activeProfileId,
        cursors: state.cursors,
      }),
      migrate: (persisted, version) => {
        if (!persisted || typeof persisted !== "object") return persisted;
        const old = persisted as Record<string, unknown>;

        // v0 kept one flat `settings` object, before profiles existed.
        if (version === 0) {
          const settings = old.settings as Record<string, unknown> | undefined;
          if (settings) {
            const twitch = (settings.twitch ?? {}) as Record<string, unknown>;
            const { clientId, ...twitchRest } = twitch;
            const profile: Profile = {
              ...createProfile("Main", "p_default"),
              enabled: (settings.enabled as Profile["enabled"]) ?? firstProfile.enabled,
              twitch: { channel: "", ...twitchRest } as Profile["twitch"],
              youtube: (settings.youtube as Profile["youtube"]) ?? firstProfile.youtube,
              kick: (settings.kick as Profile["kick"]) ?? firstProfile.kick,
              ceneka: (settings.ceneka as Profile["ceneka"]) ?? firstProfile.ceneka,
            };
            old.app = {
              ...DEFAULT_APP,
              twitchClientId: typeof clientId === "string" ? clientId : "",
            };
            old.profiles = [profile];
            old.activeProfileId = profile.id;
            delete old.settings;
          }
        }

        // v1 kept saved tips and read marks in localStorage. Both moved to
        // IndexedDB; `importLegacyMessages` rescues the old rows before this
        // blob is rewritten without them.
        // v3 dropped the synthetic "mock" source. Strip it from stored profiles
        // so a leftover `enabled.mock: true` can't make the app think a source
        // is on when none is.
        if (version < 3 && Array.isArray(old.profiles)) {
          for (const profile of old.profiles as Array<Record<string, unknown>>) {
            delete profile.mock;
            const enabled = profile.enabled as Record<string, boolean> | undefined;
            if (enabled) delete enabled.mock;
          }
        }

        if (version < 2) {
          // Deleted, not set to undefined — `merge` spreads this object, and an
          // explicit undefined would overwrite the defaults it sits on top of.
          delete old.savedTips;
          delete old.readIds;
        }

        return old;
      },
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<StoreState>;
        const profiles =
          saved.profiles && saved.profiles.length > 0 ? saved.profiles : current.profiles;
        const activeProfileId = profiles.some((p) => p.id === saved.activeProfileId)
          ? saved.activeProfileId!
          : profiles[0].id;

        return {
          ...current,
          ...saved,
          // Deep-merge the leaves so fields added after a blob was written keep
          // their defaults instead of coming back undefined.
          app: { ...current.app, ...(saved.app ?? {}) },
          filters: { ...current.filters, ...(saved.filters ?? {}) },
          profiles,
          activeProfileId,
          // Runtime state is never restored from storage — history comes from
          // the database, and an older blob must not smuggle stale keys in.
          events: [],
          readIds: {},
          eventCap: MAX_EVENTS,
          hasMore: false,
          loadingHistory: false,
          historyReady: current.historyReady,
          cursors: saved.cursors ?? {},
        };
      },
      onRehydrateStorage: () => (state) => state?.setHydrated(),
    },
  ),
);

/* ------------------------------------------------------------------ */
/* Selectors — pure, so they can be tested without a store instance     */
/* ------------------------------------------------------------------ */

export function isTip(event: StreamEvent): boolean {
  return event.amount !== undefined;
}

/**
 * Whether an event is taken in at all.
 *
 * Gap markers always are: a notice that messages were missed is not itself a
 * message, and suppressing it would hide the very thing it exists to report.
 */
export function shouldCapture(event: StreamEvent, mode: CaptureMode): boolean {
  if (mode === "all") return true;
  if (event.kind === "system") return true;
  return isTip(event);
}

export function selectActiveProfile(state: {
  profiles: Profile[];
  activeProfileId: string;
}): Profile {
  return state.profiles.find((p) => p.id === state.activeProfileId) ?? state.profiles[0];
}

export function selectVisibleEvents(
  events: StreamEvent[],
  filters: Filters,
  readIds: Record<string, true>,
): StreamEvent[] {
  return events.filter((event) => {
    // A gap describes the feed itself rather than one platform's traffic, so a
    // platform filter shouldn't be able to hide the fact that messages are
    // missing.
    if (event.kind !== "system" && !filters.platforms[event.platform]) return false;
    if (filters.tipsOnly && !isTip(event)) return false;
    if (filters.unreadOnly && readIds[event.id]) return false;
    return true;
  });
}

export function countUnread(
  events: StreamEvent[],
  readIds: Record<string, true>,
  onlyTips = false,
): number {
  return events.reduce(
    (n, e) => (!readIds[e.id] && (!onlyTips || isTip(e)) ? n + 1 : n),
    0,
  );
}

/** Convenience hook: the profile whose channels are currently connected. */
export function useActiveProfile(): Profile {
  return useStore((s) => selectActiveProfile(s));
}
