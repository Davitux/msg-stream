import { SocketIoClient, socketUrl } from "./socketio";
import type {
  EventSink,
  Platform,
  SourceAdapter,
  StatusSink,
  StreamEvent,
  StreamlabsSettings,
} from "../types";

const STREAMLABS_SOCKET = "https://sockets.streamlabs.com";

/**
 * Streamlabs' Socket API — the documented realtime feed for a channel's own
 * events, designed for browser overlays. Because it runs over the websocket
 * transport there is no polling handshake and therefore no CORS involved, so
 * this connects straight from the page with no server anywhere.
 *
 * This is also how Ceneka donations arrive: Ceneka has no realtime channel of
 * its own and pushes into whichever of Streamlabs or StreamElements the
 * streamer linked, so reading Streamlabs reads Ceneka too — along with every
 * other source routed through the same account.
 *
 * The token is the "Socket API Token" from Streamlabs' dashboard, under
 * Account Settings → API Settings → API Tokens.
 */
export class StreamlabsAdapter implements SourceAdapter<StreamlabsSettings> {
  platform: Platform = "streamlabs";
  private client: SocketIoClient | null = null;
  private closed = false;

  async connect(settings: StreamlabsSettings, onEvent: EventSink, onStatus: StatusSink) {
    this.closed = false;

    const token = settings.socketToken.trim();
    if (!token) return onStatus({ state: "error", detailKey: "slNeedToken" });

    onStatus({ state: "connecting" });

    // Streamlabs runs Socket.IO v2, i.e. Engine.IO 3.
    this.client = new SocketIoClient(socketUrl(STREAMLABS_SOCKET, 3, { token }), 3, {
      onConnect: () => onStatus({ state: "live", detailKey: "slReading" }),
      onEvent: (name, args) => {
        if (name !== "event") return;
        for (const event of streamlabsEventToStreamEvents(args[0])) onEvent(event);
      },
      onError: () => {
        if (!this.closed) onStatus({ state: "error", detailKey: "slSocketError" });
      },
      onDropped: () => {
        if (this.closed) return;
        onStatus({ state: "connecting", detailKey: "slReconnecting" });
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

interface StreamlabsDonation {
  id?: number | string;
  _id?: string;
  name?: string;
  from?: string;
  amount?: string | number;
  formatted_amount?: string;
  formattedAmount?: string;
  currency?: string;
  message?: string;
}

/**
 * Maps one Streamlabs socket payload to StreamEvents.
 *
 * Returns an array because Streamlabs batches: `message` is always a list, and
 * a single frame can carry several donations.
 *
 * Only donations are mapped. Follows, subscriptions and host events also arrive
 * on this socket, but this app's Twitch and YouTube adapters already report
 * those first-hand — taking them here as well would double them up.
 */
export function streamlabsEventToStreamEvents(raw: unknown): StreamEvent[] {
  const frame = raw as { type?: string; message?: unknown } | undefined;
  if (!frame || frame.type !== "donation") return [];

  const items = Array.isArray(frame.message) ? frame.message : [frame.message];
  const events: StreamEvent[] = [];

  for (const item of items as StreamlabsDonation[]) {
    if (!item) continue;

    const value = Number(item.amount);
    // A donation with no readable amount is not something to put on screen as
    // money; skipping beats inventing a figure.
    if (!Number.isFinite(value)) continue;

    const id = item._id ?? item.id;
    events.push({
      id: `streamlabs:${id ?? `${item.name ?? "anon"}:${value}:${Date.now()}`}`,
      platform: "streamlabs",
      kind: "tip",
      author: { name: item.name ?? item.from ?? "Anonymous" },
      message: item.message ?? "",
      amount: {
        value,
        // Streamlabs sends the real currency code, so nothing is inferred here.
        currency: (item.currency ?? "USD").toUpperCase(),
        display: item.formatted_amount ?? item.formattedAmount,
      },
      timestamp: Date.now(),
      raw: item,
    });
  }

  return events;
}
