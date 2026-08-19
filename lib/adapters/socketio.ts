/**
 * A minimal Socket.IO client, spoken directly over a WebSocket.
 *
 * Streamlabs and StreamElements both run Socket.IO, and the official clients
 * are version-locked: a v4 client cannot talk to a v2 server. Rather than ship
 * a legacy dependency (and possibly two of them), this implements the framing,
 * which is small and stable — the same approach already used for Kick's Pusher
 * socket.
 *
 * Protocol, briefly. Each frame starts with an Engine.IO packet type digit:
 *
 *   0  open       server's handshake, followed by JSON
 *   1  close
 *   2  ping
 *   3  pong
 *   4  message    followed by a Socket.IO packet type digit:
 *                    0 connect   1 disconnect   2 event   3 ack   4 error
 *
 * So an event arrives as `42["event",{...}]` — 4 (message), 2 (event), then a
 * JSON array of [name, ...args].
 *
 * The versions differ in who keeps the connection alive: under EIO 3 the client
 * sends `2` on an interval and the server answers `3`; under EIO 4 the server
 * sends `2` and the client must answer `3`. Both are handled.
 */

export type EngineVersion = 3 | 4;

export interface OpenPayload {
  sid: string;
  pingInterval?: number;
  pingTimeout?: number;
}

export type SocketIoPacket =
  | { kind: "open"; payload: OpenPayload }
  | { kind: "connect" }
  | { kind: "disconnect" }
  | { kind: "event"; name: string; args: unknown[] }
  | { kind: "ping" }
  | { kind: "pong" }
  | { kind: "error"; detail: string }
  | { kind: "ignored" };

/** Frames an event for sending: `42["name",arg]`. */
export function encodeEvent(name: string, ...args: unknown[]): string {
  return `42${JSON.stringify([name, ...args])}`;
}

/** Parses one frame. Anything unrecognised comes back as `ignored`. */
export function decodePacket(raw: string): SocketIoPacket {
  if (!raw) return { kind: "ignored" };

  switch (raw[0]) {
    case "0":
      try {
        return { kind: "open", payload: JSON.parse(raw.slice(1)) as OpenPayload };
      } catch {
        return { kind: "ignored" };
      }
    case "1":
      return { kind: "disconnect" };
    case "2":
      return { kind: "ping" };
    case "3":
      return { kind: "pong" };
    case "4":
      break;
    default:
      return { kind: "ignored" };
  }

  // A message packet: the next digit is the Socket.IO type.
  const body = raw.slice(2);
  switch (raw[1]) {
    case "0":
      return { kind: "connect" };
    case "1":
      return { kind: "disconnect" };
    case "2": {
      try {
        const parsed = JSON.parse(body) as unknown[];
        if (!Array.isArray(parsed) || typeof parsed[0] !== "string") {
          return { kind: "ignored" };
        }
        return { kind: "event", name: parsed[0], args: parsed.slice(1) };
      } catch {
        return { kind: "ignored" };
      }
    }
    case "4":
      return { kind: "error", detail: body || "socket error" };
    default:
      return { kind: "ignored" };
  }
}

/** Builds the websocket URL, including the query Socket.IO expects. */
export function socketUrl(
  base: string,
  eio: EngineVersion,
  query: Record<string, string> = {},
): string {
  const url = new URL(base);
  url.protocol = url.protocol === "http:" ? "ws:" : url.protocol === "https:" ? "wss:" : url.protocol;
  if (!url.pathname.endsWith("/socket.io/")) {
    url.pathname = `${url.pathname.replace(/\/$/, "")}/socket.io/`;
  }
  url.searchParams.set("EIO", String(eio));
  url.searchParams.set("transport", "websocket");
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return url.toString();
}

export interface SocketIoHandlers {
  /** Fires once the Socket.IO layer has accepted the connection. */
  onConnect?: () => void;
  onEvent?: (name: string, args: unknown[]) => void;
  onError?: (detail: string) => void;
  /** Fires when the socket goes away for any reason other than `close()`. */
  onDropped?: () => void;
}

export class SocketIoClient {
  private ws: WebSocket | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private closed = false;

  constructor(
    private readonly url: string,
    private readonly eio: EngineVersion,
    private readonly handlers: SocketIoHandlers,
  ) {}

  connect() {
    this.closed = false;
    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.onmessage = (raw) => {
      const packet = decodePacket(String(raw.data));

      switch (packet.kind) {
        case "open":
          // EIO 3 expects the client to drive the heartbeat.
          if (this.eio === 3) {
            const interval = packet.payload.pingInterval ?? 25000;
            this.stopHeartbeat();
            this.heartbeat = setInterval(() => this.send("2"), interval);
          }
          // EIO 4 needs an explicit namespace connect; EIO 3 sends `40` itself.
          if (this.eio === 4) this.send("40");
          else this.handlers.onConnect?.();
          break;

        case "connect":
          this.handlers.onConnect?.();
          break;

        case "ping":
          // EIO 4: the server drives the heartbeat and we answer it.
          this.send("3");
          break;

        case "event":
          this.handlers.onEvent?.(packet.name, packet.args);
          break;

        case "error":
          this.handlers.onError?.(packet.detail);
          break;
      }
    };

    ws.onerror = () => {
      if (!this.closed) this.handlers.onError?.("socket error");
    };

    ws.onclose = () => {
      this.stopHeartbeat();
      if (!this.closed && this.ws === ws) this.handlers.onDropped?.();
    };
  }

  emit(name: string, ...args: unknown[]) {
    this.send(encodeEvent(name, ...args));
  }

  close() {
    this.closed = true;
    this.stopHeartbeat();
    this.ws?.close();
    this.ws = null;
  }

  private send(frame: string) {
    // readyState is checked because heartbeats can fire mid-teardown.
    if (this.ws && this.ws.readyState === 1) this.ws.send(frame);
  }

  private stopHeartbeat() {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
  }
}
