import type {
  EventSink,
  KickSettings,
  Platform,
  SourceAdapter,
  StatusSink,
  StreamEvent,
} from "../types";

/** Accepts a pasted id, ignoring stray whitespace. Returns null if unusable. */
function parseId(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

/**
 * Kick's chat runs on public Pusher channels — no auth handshake, so we speak the
 * protocol directly over a WebSocket rather than pulling in pusher-js for it.
 * WebSockets are not subject to CORS, so this connects straight from the page.
 *
 * These are Kick's own app credentials, observed from their web client. They are
 * public by construction (any browser on kick.com sends them), but they are also
 * undocumented and can change without notice.
 */
const PUSHER_APP_KEY = "32cbd69e4b950bf97679";
const PUSHER_URL = `wss://ws-us2.pusher.com/app/${PUSHER_APP_KEY}?protocol=7&client=js&version=8.4.0-rc2&flash=false`;

interface KickSender {
  id: number;
  username: string;
  identity?: { color?: string };
}

export class KickAdapter implements SourceAdapter<KickSettings> {
  platform: Platform = "kick";
  private ws: WebSocket | null = null;
  private closed = false;
  private onEvent: EventSink = () => {};
  private onStatus: StatusSink = () => {};
  private channel = "";

  async connect(settings: KickSettings, onEvent: EventSink, onStatus: StatusSink) {
    this.onEvent = onEvent;
    this.onStatus = onStatus;
    this.closed = false;
    this.channel = settings.channel || "Kick";

    const chatroomId = parseId(settings.chatroomId);
    if (chatroomId === null) {
      return onStatus({ state: "error", detailKey: "kickNeedChatroomId" });
    }
    const channelId = parseId(settings.channelId ?? "");

    onStatus({ state: "connecting" });
    this.openSocket(chatroomId, channelId);
  }

  disconnect() {
    this.closed = true;
    this.ws?.close();
    this.ws = null;
  }

  private openSocket(chatroomId: number, channelId: number | null) {
    const ws = new WebSocket(PUSHER_URL);
    this.ws = ws;

    ws.onopen = () => {
      // Chat lives on the chatroom channel. Subscription and gift events are
      // announced on the channel one, which is optional — without it you still
      // get chat.
      const channels = [`chatrooms.${chatroomId}.v2`];
      if (channelId !== null) channels.push(`channel.${channelId}`);
      for (const name of channels) {
        ws.send(JSON.stringify({ event: "pusher:subscribe", data: { auth: "", channel: name } }));
      }
    };

    ws.onmessage = (raw) => {
      const frame = JSON.parse(raw.data as string) as { event: string; data?: string };

      if (frame.event === "pusher:ping") {
        ws.send(JSON.stringify({ event: "pusher:pong", data: {} }));
        return;
      }

      if (frame.event === "pusher_internal:subscription_succeeded") {
        this.onStatus({ state: "live", detailKey: "kickReading", detailVars: { channel: this.channel } });
        return;
      }

      if (!frame.data) return;
      let data: Record<string, unknown>;
      try {
        // Pusher nests the payload as a JSON string inside the frame.
        data = JSON.parse(frame.data);
      } catch {
        return;
      }

      this.handle(frame.event, data);
    };

    ws.onerror = () => {
      if (!this.closed) this.onStatus({ state: "error", detailKey: "kickSocketError" });
    };

    ws.onclose = () => {
      if (this.closed || this.ws !== ws) return;
      this.onStatus({ state: "connecting", detailKey: "kickReconnecting" });
      setTimeout(() => {
        if (!this.closed) this.openSocket(chatroomId, channelId);
      }, 2000);
    };
  }

  private handle(eventName: string, data: Record<string, unknown>) {
    const event = kickEventToStreamEvent(eventName, data);
    if (event) this.onEvent(event);
  }
}

/**
 * Pure mapping from a Pusher event to a StreamEvent, split out from the socket
 * plumbing so the payload shapes can be tested directly.
 */
export function kickEventToStreamEvent(
  eventName: string,
  data: Record<string, unknown>,
  now: number = Date.now(),
): StreamEvent | null {
  switch (eventName) {
    case "App\\Events\\ChatMessageEvent": {
      const sender = data.sender as KickSender | undefined;
      if (!sender) return null;
      return {
        id: `kick:${data.id}`,
        platform: "kick",
        kind: "chat",
        author: { name: sender.username, color: sender.identity?.color },
        message: String(data.content ?? ""),
        timestamp: Date.parse(String(data.created_at ?? "")) || now,
        raw: data,
      };
    }

    case "App\\Events\\SubscriptionEvent": {
      const months = Number(data.months ?? 1);
      return {
        id: `kick:sub:${data.username}:${now}`,
        platform: "kick",
        kind: "subscription",
        author: { name: String(data.username ?? "Someone") },
        message: months > 1 ? `Resubscribed for ${months} months` : "Subscribed",
        amount: { value: 1, currency: "SUBS" },
        timestamp: now,
        raw: data,
      };
    }

    case "App\\Events\\GiftedSubscriptionsEvent": {
      const gifted = (data.gifted_usernames as string[] | undefined) ?? [];
      return {
        id: `kick:gift:${data.gifter_username}:${now}`,
        platform: "kick",
        kind: "subscription",
        author: { name: String(data.gifter_username ?? "Anonymous") },
        message: `Gifted ${gifted.length} sub${gifted.length === 1 ? "" : "s"}`,
        amount: { value: gifted.length, currency: "SUBS" },
        timestamp: now,
        raw: data,
      };
    }

    // Kicks (Kick's paid gifting currency) are not mapped yet: the event name
    // and payload aren't documented anywhere we could verify, and guessing at
    // the field would put invented amounts on screen. Capture a sample from
    // `raw` on a live channel, then add the case here.
    default:
      return null;
  }
}
