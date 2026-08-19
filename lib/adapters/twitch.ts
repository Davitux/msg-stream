import { TWITCH_BIT_TIERS, tierFromThresholds } from "../tiers";
import type {
  ConnectionStatus,
  EventSink,
  Platform,
  SourceAdapter,
  StatusSink,
  StreamEvent,
  TwitchConnectConfig,
} from "../types";

const EVENTSUB_WS = "wss://eventsub.wss.twitch.tv/ws";
const HELIX = "https://api.twitch.tv/helix";
const OAUTH_AUTHORIZE = "https://id.twitch.tv/oauth2/authorize";
const OAUTH_VALIDATE = "https://id.twitch.tv/oauth2/validate";

/**
 * `user:read:chat` is what actually reads chat, and works for *any* channel using
 * the viewer's own token. The other two only matter when the signed-in user is
 * the broadcaster; Twitch simply won't grant them otherwise, which is fine.
 */
const SCOPES = ["user:read:chat", "bits:read", "channel:read:subscriptions"];

export function twitchRedirectUri(): string {
  return `${window.location.origin}/`;
}

export function twitchAuthorizeUrl(clientId: string, redirectUri: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "token",
    scope: SCOPES.join(" "),
  });
  return `${OAUTH_AUTHORIZE}?${params}`;
}

/**
 * Implicit grant — Twitch documents this flow for apps without a server, which
 * is exactly what this is. The token comes back in the URL fragment.
 */
export function beginTwitchLogin(clientId: string): void {
  // Full-page navigation to Twitch's consent screen — an external origin, so the
  // Next.js router is not involved.
  window.location.href = twitchAuthorizeUrl(clientId, twitchRedirectUri());
}

export interface TwitchIdentity {
  accessToken: string;
  userId: string;
  userLogin: string;
}

/**
 * Reads a token out of the URL fragment after the OAuth redirect and clears it
 * from the address bar so it isn't left sitting in history.
 */
export function consumeTwitchRedirect(): string | null {
  if (typeof window === "undefined") return null;
  const hash = window.location.hash;
  if (!hash.includes("access_token=")) return null;

  const token = new URLSearchParams(hash.slice(1)).get("access_token");
  window.history.replaceState(null, "", window.location.pathname + window.location.search);
  return token;
}

export async function validateTwitchToken(token: string): Promise<TwitchIdentity | null> {
  const res = await fetch(OAUTH_VALIDATE, {
    headers: { Authorization: `OAuth ${token}` },
  });
  if (!res.ok) return null;
  const data = await res.json();
  return { accessToken: token, userId: data.user_id, userLogin: data.login };
}

interface HelixUser {
  id: string;
  login: string;
  display_name: string;
  profile_image_url: string;
}

async function helix<T>(
  path: string,
  settings: TwitchConnectConfig,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${HELIX}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${settings.accessToken}`,
      "Client-Id": settings.clientId,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text();
    const error = new Error(`Twitch API ${res.status}: ${body.slice(0, 200)}`);
    (error as Error & { status?: number }).status = res.status;
    throw error;
  }
  return res.json() as Promise<T>;
}

/** Maps a thrown Helix error onto a status a streamer can act on. */
export function describeTwitchError(err: unknown): ConnectionStatus {
  const status = (err as { status?: number })?.status;
  const message = err instanceof Error ? err.message : String(err);
  if (status === 401 || message.includes("401")) {
    return { state: "error", detailKey: "twitchTokenRejected" };
  }
  return { state: "error", detail: message };
}

export class TwitchAdapter implements SourceAdapter<TwitchConnectConfig> {
  platform: Platform = "twitch";
  private ws: WebSocket | null = null;
  private closed = false;
  private onEvent: EventSink = () => {};
  private onStatus: StatusSink = () => {};
  private settings!: TwitchConnectConfig;
  private broadcasterId = "";
  private broadcasterAvatar?: string;

  async connect(settings: TwitchConnectConfig, onEvent: EventSink, onStatus: StatusSink) {
    this.settings = settings;
    this.onEvent = onEvent;
    this.onStatus = onStatus;
    this.closed = false;

    if (!settings.clientId) return onStatus({ state: "error", detailKey: "twitchNeedClientId" });
    if (!settings.accessToken) return onStatus({ state: "error", detailKey: "twitchNeedSignIn" });
    if (!settings.channel) return onStatus({ state: "error", detailKey: "twitchNeedChannel" });

    onStatus({ state: "connecting" });

    try {
      const users = await helix<{ data: HelixUser[] }>(
        `/users?login=${encodeURIComponent(settings.channel)}`,
        settings,
      );
      const broadcaster = users.data[0];
      if (!broadcaster) {
        return onStatus({
          state: "error",
          detailKey: "twitchNoSuchChannel",
          detailVars: { channel: settings.channel },
        });
      }
      this.broadcasterId = broadcaster.id;
      this.broadcasterAvatar = broadcaster.profile_image_url;
    } catch (err) {
      return onStatus(describeTwitchError(err));
    }

    this.openSocket(EVENTSUB_WS);
  }

  disconnect() {
    this.closed = true;
    this.ws?.close();
    this.ws = null;
  }

  private openSocket(url: string) {
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.onmessage = (raw) => {
      const frame = JSON.parse(raw.data as string);
      const type = frame.metadata?.message_type;

      switch (type) {
        case "session_welcome":
          void this.subscribeAll(frame.payload.session.id);
          break;

        case "notification":
          this.handleNotification(frame);
          break;

        // Twitch hands over a fresh URL before retiring the current socket.
        // Connect to the new one first so no messages are dropped in between.
        case "session_reconnect": {
          const next = frame.payload.session.reconnect_url;
          const old = this.ws;
          this.openSocket(next);
          old?.close();
          break;
        }

        case "revocation":
          this.onStatus({
            state: "error",
            detailKey: "twitchRevoked",
            detailVars: { type: frame.payload.subscription.type },
          });
          break;

        // session_keepalive needs no action; receiving it is the point.
      }
    };

    ws.onerror = () => {
      if (!this.closed) this.onStatus({ state: "error", detailKey: "twitchSocketError" });
    };

    ws.onclose = () => {
      if (this.closed || this.ws !== ws) return;
      this.onStatus({ state: "connecting", detailKey: "twitchReconnecting" });
      setTimeout(() => {
        if (!this.closed) this.openSocket(EVENTSUB_WS);
      }, 2000);
    };
  }

  private async subscribeAll(sessionId: string) {
    const isBroadcaster = this.settings.userId === this.broadcasterId;

    const subscribe = (type: string, version: string, condition: Record<string, string>) =>
      helix("/eventsub/subscriptions", this.settings, {
        method: "POST",
        body: JSON.stringify({
          type,
          version,
          condition,
          transport: { method: "websocket", session_id: sessionId },
        }),
      });

    try {
      await subscribe("channel.chat.message", "1", {
        broadcaster_user_id: this.broadcasterId,
        user_id: this.settings.userId!,
      });
    } catch (err) {
      return this.onStatus(describeTwitchError(err));
    }

    // Broadcaster-only events. Requested individually and allowed to fail, so a
    // viewer reading someone else's channel still gets chat.
    if (isBroadcaster) {
      const extras: Array<[string, string]> = [
        ["channel.cheer", "1"],
        ["channel.subscribe", "1"],
        ["channel.subscription.gift", "1"],
        ["channel.subscription.message", "1"],
      ];
      await Promise.allSettled(
        extras.map(([type, version]) =>
          subscribe(type, version, { broadcaster_user_id: this.broadcasterId }),
        ),
      );
    }

    this.onStatus({
      state: "live",
      detailKey: isBroadcaster ? "twitchReadingFull" : "twitchReadingChatOnly",
      detailVars: { channel: this.settings.channel },
    });
  }

  private handleNotification(frame: {
    metadata: { message_timestamp: string; subscription_type: string };
    payload: { event: Record<string, unknown> };
  }) {
    const event = twitchNotificationToEvent(frame, this.broadcasterAvatar);
    if (event) this.onEvent(event);
  }
}

/**
 * Pure mapping from an EventSub notification to a StreamEvent. Split out from
 * the socket plumbing so the payload shapes can be tested directly.
 */
export function twitchNotificationToEvent(
  frame: {
    metadata: { message_timestamp: string; subscription_type: string };
    payload: { event: Record<string, unknown> };
  },
  broadcasterAvatar?: string,
): StreamEvent | null {
  const type = frame.metadata.subscription_type;
  const e = frame.payload.event;
  const timestamp = Date.parse(frame.metadata.message_timestamp) || Date.now();

  switch (type) {
    case "channel.chat.message": {
      const cheer = e.cheer as { bits: number } | null | undefined;
      return {
        id: `twitch:${e.message_id}`,
        platform: "twitch",
        kind: cheer ? "tip" : "chat",
        author: {
          name: (e.chatter_user_name as string) || (e.chatter_user_login as string),
          color: (e.color as string) || undefined,
        },
        message: ((e.message as { text: string })?.text ?? "").trim(),
        amount: cheer ? bitsAmount(cheer.bits) : undefined,
        timestamp,
        raw: e,
      };
    }

    case "channel.cheer":
      return {
        id: `twitch:cheer:${e.user_id ?? "anon"}:${timestamp}`,
        platform: "twitch",
        kind: "tip",
        author: {
          name: (e.is_anonymous as boolean) ? "Anonymous" : (e.user_name as string),
          avatarUrl: broadcasterAvatar,
        },
        message: (e.message as string) ?? "",
        amount: bitsAmount(e.bits as number),
        timestamp,
        raw: e,
      };

    case "channel.subscribe":
      // Gifted subs also fire channel.subscription.gift; skip the duplicate here.
      if (e.is_gift) return null;
      return {
        id: `twitch:sub:${e.user_id}:${timestamp}`,
        platform: "twitch",
        kind: "subscription",
        author: { name: e.user_name as string },
        message: `Subscribed at tier ${tierName(e.tier as string)}`,
        amount: { value: 1, currency: "SUBS" },
        timestamp,
        raw: e,
      };

    case "channel.subscription.message":
      return {
        id: `twitch:resub:${e.user_id}:${timestamp}`,
        platform: "twitch",
        kind: "subscription",
        author: { name: e.user_name as string },
        message:
          ((e.message as { text: string })?.text ?? "") ||
          `Resubscribed for ${e.cumulative_months} months`,
        amount: { value: 1, currency: "SUBS" },
        timestamp,
        raw: e,
      };

    case "channel.subscription.gift":
      return {
        id: `twitch:gift:${e.user_id ?? "anon"}:${timestamp}`,
        platform: "twitch",
        kind: "subscription",
        author: {
          name: (e.is_anonymous as boolean) ? "Anonymous" : (e.user_name as string),
        },
        message: `Gifted ${e.total} tier ${tierName(e.tier as string)} sub${
          (e.total as number) === 1 ? "" : "s"
        }`,
        amount: { value: e.total as number, currency: "SUBS" },
        timestamp,
        raw: e,
      };

    default:
      return null;
  }
}

/**
 * Twitch sends a bit count and no band, so the band is derived from Twitch's
 * own cheermote thresholds — their cut-offs, not ours, and entirely within bits.
 */
function bitsAmount(bits: number) {
  return {
    value: bits,
    currency: "BITS",
    tier: tierFromThresholds(bits, TWITCH_BIT_TIERS),
    tierMax: TWITCH_BIT_TIERS.length,
  };
}

export function tierName(tier: string): string {
  return tier === "3000" ? "3" : tier === "2000" ? "2" : "1";
}
