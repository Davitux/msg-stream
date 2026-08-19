import { SocketIoClient, socketUrl } from "./socketio";
import type {
  EventSink,
  Platform,
  SourceAdapter,
  StatusSink,
  StreamElementsSettings,
  StreamEvent,
} from "../types";

const STREAMELEMENTS_SOCKET = "https://realtime.streamelements.com";

/**
 * StreamElements' realtime socket. Same role as the Streamlabs adapter — and
 * the other half of where Ceneka delivers donations.
 *
 * Unlike Streamlabs, the token isn't in the URL: you connect first, then emit
 * an `authenticate` frame and wait for `authenticated` before events flow.
 *
 * Two auth methods are accepted. A JWT comes from the dashboard (profile menu →
 * Channels → Show secrets); an overlay token is the `apikey` method. Which one
 * a streamer has to hand varies, so both are offered.
 */
export class StreamElementsAdapter implements SourceAdapter<StreamElementsSettings> {
  platform: Platform = "streamelements";
  private client: SocketIoClient | null = null;
  private closed = false;

  async connect(settings: StreamElementsSettings, onEvent: EventSink, onStatus: StatusSink) {
    this.closed = false;

    const token = settings.token.trim();
    if (!token) return onStatus({ state: "error", detailKey: "seNeedToken" });

    const method = settings.method === "apikey" ? "apikey" : "jwt";
    onStatus({ state: "connecting" });

    this.client = new SocketIoClient(socketUrl(STREAMELEMENTS_SOCKET, 3), 3, {
      // Connecting isn't enough here — nothing arrives until we authenticate.
      onConnect: () => this.client?.emit("authenticate", { method, token }),
      onEvent: (name, args) => {
        if (name === "authenticated") {
          return onStatus({ state: "live", detailKey: "seReading" });
        }
        if (name === "unauthorized") {
          return onStatus({ state: "error", detailKey: "seUnauthorized" });
        }
        if (name !== "event") return;
        const event = streamElementsEventToStreamEvent(args[0]);
        if (event) onEvent(event);
      },
      onError: () => {
        if (!this.closed) onStatus({ state: "error", detailKey: "seSocketError" });
      },
      onDropped: () => {
        if (this.closed) return;
        onStatus({ state: "connecting", detailKey: "seReconnecting" });
        setTimeout(() => {
          if (!this.closed) this.client?.connect();
        }, 2000);
      },
    });

    this.client.connect();
  }

  disconnect() {
    this.closed = true;
    this.client?.close();
    this.client = null;
  }
}

interface StreamElementsTip {
  _id?: string;
  type?: string;
  createdAt?: string;
  data?: {
    username?: string;
    displayName?: string;
    amount?: number | string;
    currency?: string;
    message?: string;
    tipId?: string;
  };
}

/**
 * Maps a StreamElements activity payload to a StreamEvent.
 *
 * Only tips are mapped, for the same reason as Streamlabs: follows and subs
 * already arrive first-hand through the Twitch and YouTube adapters.
 *
 * StreamElements does not publish this payload's field names as precisely as
 * Streamlabs does, so the mapping is defensive: anything without a readable
 * numeric amount is dropped rather than shown as money.
 */
export function streamElementsEventToStreamEvent(raw: unknown): StreamEvent | null {
  const frame = raw as StreamElementsTip | undefined;
  if (!frame || frame.type !== "tip") return null;

  const data = frame.data ?? {};
  const value = Number(data.amount);
  if (!Number.isFinite(value)) return null;

  const id = data.tipId ?? frame._id;
  const timestamp = frame.createdAt ? Date.parse(frame.createdAt) : Number.NaN;

  return {
    id: `streamelements:${id ?? `${data.username ?? "anon"}:${value}:${Date.now()}`}`,
    platform: "streamelements",
    kind: "tip",
    author: { name: data.displayName ?? data.username ?? "Anonymous" },
    message: data.message ?? "",
    amount: {
      value,
      currency: (data.currency ?? "USD").toUpperCase(),
    },
    timestamp: Number.isFinite(timestamp) ? timestamp : Date.now(),
    raw: frame,
  };
}
