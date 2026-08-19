"use client";

import { useEffect, useRef } from "react";
import { selectActiveProfile, useStore } from "./store";
import { startMessageHistory } from "./messages/startup";
import {
  GapTracker,
  HEARTBEAT_MS,
  clearHeartbeat,
  gapEvent,
  gapSinceHeartbeat,
  markAlive,
  readHeartbeat,
} from "./gaps";
import {
  PLATFORMS,
  type AppSettings,
  type Platform,
  type Profile,
  type SourceAdapter,
} from "./types";
import { TwitchAdapter, consumeTwitchRedirect, validateTwitchToken } from "./adapters/twitch";
import { KickAdapter } from "./adapters/kick";
import { YouTubeAdapter } from "./adapters/youtube";
import { CenekaAdapter } from "./adapters/ceneka";
import { StreamlabsAdapter } from "./adapters/streamlabs";
import { StreamElementsAdapter } from "./adapters/streamelements";

export function makeAdapter(platform: Platform): SourceAdapter<never> {
  switch (platform) {
    case "twitch":
      return new TwitchAdapter() as SourceAdapter<never>;
    case "youtube":
      return new YouTubeAdapter() as SourceAdapter<never>;
    case "kick":
      return new KickAdapter() as SourceAdapter<never>;
    case "streamlabs":
      return new StreamlabsAdapter() as SourceAdapter<never>;
    case "streamelements":
      return new StreamElementsAdapter() as SourceAdapter<never>;
    case "ceneka":
      return new CenekaAdapter() as SourceAdapter<never>;
  }
}

/**
 * A string that changes exactly when a platform needs reconnecting. Comparing
 * these instead of object identity keeps an unrelated settings edit (say, typing
 * in the YouTube field) from tearing down a healthy Twitch socket.
 *
 * The profile id is part of every signature: switching profiles points at
 * different channels, so everything must reconnect.
 */
export function connectionSignature(
  platform: Platform,
  profile: Profile,
  app: AppSettings,
): string {
  const scope = profile.id;
  switch (platform) {
    case "twitch": {
      const t = profile.twitch;
      return [scope, t.channel, app.twitchClientId, t.accessToken ?? "", t.userId ?? ""].join("|");
    }
    case "youtube":
      return [scope, profile.youtube.video, profile.youtube.apiKey].join("|");
    case "kick":
      return [scope, profile.kick.chatroomId, profile.kick.channelId ?? ""].join("|");
    case "streamlabs":
      return [scope, profile.streamlabs.socketToken].join("|");
    case "streamelements":
      return [scope, profile.streamelements.token, profile.streamelements.method].join("|");
    case "ceneka":
      return [scope, profile.ceneka.token ?? ""].join("|");
  }
}

/** The config object each adapter's `connect` expects. */
export function connectionConfig(
  platform: Platform,
  profile: Profile,
  app: AppSettings,
): unknown {
  if (platform === "twitch") {
    // The client ID is app-level, so it's merged in here rather than duplicated
    // into every profile.
    return { ...profile.twitch, clientId: app.twitchClientId };
  }
  return profile[platform];
}

/**
 * Owns the lifecycle of every source adapter, reconciling live connections
 * against the active profile.
 */
export function useConnections() {
  const hydrated = useStore((s) => s.hydrated);
  const historyReady = useStore((s) => s.historyReady);
  const statuses = useStore((s) => s.statuses);
  const app = useStore((s) => s.app);
  const profile = useStore(selectActiveProfile);
  const ingest = useStore((s) => s.ingest);
  const setStatus = useStore((s) => s.setStatus);
  const updateProfile = useStore((s) => s.updateProfile);
  const setTwitchClientId = useStore((s) => s.setTwitchClientId);

  const active = useRef(new Map<Platform, { adapter: SourceAdapter<never>; sig: string }>());
  const gaps = useRef(new GapTracker());

  // The store is created with `skipHydration`, so localStorage is read here —
  // after mount — keeping the first client render identical to the server HTML.
  // Message history follows from IndexedDB once settings are in place.
  useEffect(() => {
    void (async () => {
      // Read the heartbeat before anything can overwrite it: it says roughly
      // when this app last had sources listening.
      const lastAlive = readHeartbeat();
      clearHeartbeat();

      await useStore.persist.rehydrate();
      await startMessageHistory();

      const gap = gapSinceHeartbeat(lastAlive);
      if (gap) useStore.getState().ingest(gapEvent(gap));
    })();
  }, []);

  // Finish the Twitch implicit-grant redirect: the token arrives in the URL
  // fragment, so this has to run on the client after navigation.
  useEffect(() => {
    if (!hydrated) return;
    const token = consumeTwitchRedirect();
    if (!token) return;

    void validateTwitchToken(token).then((identity) => {
      if (!identity) {
        return setStatus("twitch", { state: "error", detailKey: "twitchSignInFailed" });
      }
      const state = useStore.getState();
      const current = selectActiveProfile(state);
      state.updateProfile({
        twitch: {
          ...current.twitch,
          accessToken: identity.accessToken,
          userId: identity.userId,
          userLogin: identity.userLogin,
        },
        enabled: { ...current.enabled, twitch: true },
      });
    });
    // updateProfile / setTwitchClientId are referenced so lint sees the full
    // dependency set; the effect itself reads fresh state via getState().
  }, [hydrated, setStatus, updateProfile, setTwitchClientId]);

  useEffect(() => {
    // Waiting for the store as well as the settings: connecting earlier would
    // drop the first messages of a session on the floor.
    if (!hydrated || !historyReady) return;

    for (const platform of PLATFORMS) {
      const wanted = profile.enabled[platform]
        ? connectionSignature(platform, profile, app)
        : null;
      const running = active.current.get(platform);

      if (running && running.sig === wanted) continue;

      if (running) {
        running.adapter.disconnect();
        active.current.delete(platform);
        // Switching a source off on purpose is not an outage.
        gaps.current.forget(platform);
        setStatus(platform, { state: "disconnected" });
      }

      if (wanted === null) continue;

      const adapter = makeAdapter(platform);
      active.current.set(platform, { adapter, sig: wanted });
      void adapter
        .connect(
          connectionConfig(platform, profile, app) as never,
          ingest,
          (status) => {
            // A source coming back after being down leaves a hole that only
            // YouTube can refill; the rest get a marker saying so.
            const gap = gaps.current.observe(platform, status.state === "live");
            if (gap) ingest(gapEvent(gap));
            setStatus(platform, status);
          },
          (cursor) => useStore.getState().setCursor(platform, cursor),
          useStore.getState().cursors[profile.id]?.[platform] ?? null,
        )
        .catch((err: unknown) =>
          setStatus(platform, {
            state: "error",
            detail: err instanceof Error ? err.message : String(err),
          }),
        );
    }
  }, [hydrated, historyReady, profile, app, ingest, setStatus]);

  const anyLive = Object.values(statuses).some((status) => status.state === "live");

  // While something is actually listening, leave a mark on a timer. If the tab
  // dies or is reloaded, that mark is how the next run knows when capture
  // stopped — and warn before an accidental reload throws it away.
  useEffect(() => {
    if (!anyLive) return;

    markAlive();
    const timer = setInterval(markAlive, HEARTBEAT_MS);

    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);

    return () => {
      clearInterval(timer);
      window.removeEventListener("beforeunload", warn);
    };
  }, [anyLive]);

  // Tear everything down on unmount so sockets don't outlive the page.
  useEffect(() => {
    const connections = active.current;
    return () => {
      for (const { adapter } of connections.values()) adapter.disconnect();
      connections.clear();
    };
  }, []);
}
