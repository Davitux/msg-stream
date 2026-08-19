import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  StreamlabsAdapter,
  streamlabsEventToStreamEvents,
} from "@/lib/adapters/streamlabs";
import {
  StreamElementsAdapter,
  streamElementsEventToStreamEvent,
} from "@/lib/adapters/streamelements";
import { formatAmount } from "@/lib/money";
import type { ConnectionStatus, StreamEvent } from "@/lib/types";

/* ------------------------------------------------------------------ */
/* Payload mapping                                                     */
/* ------------------------------------------------------------------ */

describe("Streamlabs donations", () => {
  // The exact payload Streamlabs publishes in its Socket API docs.
  const documented = {
    type: "donation",
    message: [
      {
        id: 96164121,
        name: "test",
        amount: "13.37",
        formatted_amount: "$13.37",
        formattedAmount: "$13.37",
        message: "test donation",
        currency: "USD",
        from: "test",
        _id: "0820c9d5bafd768c9843f5e35c885e71",
      },
    ],
    event_id: "evt_17e5f4dc6888767ed9799f78dfa2cabc",
  };

  it("maps the documented payload", () => {
    const [event] = streamlabsEventToStreamEvents(documented);
    expect(event).toMatchObject({
      id: "streamlabs:0820c9d5bafd768c9843f5e35c885e71",
      platform: "streamlabs",
      kind: "tip",
      author: { name: "test" },
      message: "test donation",
      amount: { value: 13.37, currency: "USD", display: "$13.37" },
    });
  });

  it("uses the currency the platform sends, never a guess", () => {
    const [event] = streamlabsEventToStreamEvents({
      type: "donation",
      message: [{ _id: "a", name: "n", amount: "2000", currency: "ars", message: "" }],
    });
    expect(event.amount).toMatchObject({ value: 2000, currency: "ARS" });
    // And it renders as ARS, not converted to anything.
    expect(formatAmount(event.amount!, "en-US")).toContain("ARS");
  });

  it("handles several donations in one frame", () => {
    const events = streamlabsEventToStreamEvents({
      type: "donation",
      message: [
        { _id: "a", name: "one", amount: "1", currency: "USD" },
        { _id: "b", name: "two", amount: "2", currency: "USD" },
      ],
    });
    expect(events.map((e) => e.id)).toEqual(["streamlabs:a", "streamlabs:b"]);
  });

  it("falls back to `from` when there is no name", () => {
    const [event] = streamlabsEventToStreamEvents({
      type: "donation",
      message: [{ _id: "a", from: "someone", amount: "1", currency: "USD" }],
    });
    expect(event.author.name).toBe("someone");
  });

  it("labels a donation with neither name nor sender", () => {
    const [event] = streamlabsEventToStreamEvents({
      type: "donation",
      message: [{ _id: "a", amount: "1", currency: "USD" }],
    });
    expect(event.author.name).toBe("Anonymous");
  });

  it("drops a donation whose amount cannot be read, rather than inventing one", () => {
    expect(
      streamlabsEventToStreamEvents({
        type: "donation",
        message: [{ _id: "a", name: "n", amount: "not-a-number", currency: "USD" }],
      }),
    ).toEqual([]);
  });

  it("defaults to USD only when no currency is given at all", () => {
    const [event] = streamlabsEventToStreamEvents({
      type: "donation",
      message: [{ _id: "a", name: "n", amount: "5" }],
    });
    expect(event.amount?.currency).toBe("USD");
  });

  it.each([
    ["a follow", { type: "follow", message: [{ name: "x" }] }],
    ["a subscription", { type: "subscription", message: [{ name: "x" }] }],
    ["an empty frame", {}],
    ["nothing at all", undefined],
  ])("ignores %s", (_label, frame) => {
    // Subs and follows already arrive first-hand from Twitch and YouTube.
    expect(streamlabsEventToStreamEvents(frame)).toEqual([]);
  });

  it("copes with a single object instead of a list", () => {
    const events = streamlabsEventToStreamEvents({
      type: "donation",
      message: { _id: "a", name: "n", amount: "1", currency: "USD" },
    });
    expect(events).toHaveLength(1);
  });
});

describe("StreamElements tips", () => {
  const tip = {
    _id: "abc123",
    type: "tip",
    createdAt: "2026-08-17T12:00:00Z",
    data: {
      username: "nadia",
      displayName: "Nadia",
      amount: 5,
      currency: "ARS",
      message: "gracias!",
      tipId: "tip_1",
    },
  };

  it("maps a tip", () => {
    const event = streamElementsEventToStreamEvent(tip)!;
    expect(event).toMatchObject({
      id: "streamelements:tip_1",
      platform: "streamelements",
      kind: "tip",
      author: { name: "Nadia" },
      message: "gracias!",
      amount: { value: 5, currency: "ARS" },
    });
    expect(event.timestamp).toBe(Date.parse("2026-08-17T12:00:00Z"));
  });

  it("falls back to the username when there is no display name", () => {
    const event = streamElementsEventToStreamEvent({
      ...tip,
      data: { ...tip.data, displayName: undefined },
    })!;
    expect(event.author.name).toBe("nadia");
  });

  it("falls back to the record id when there is no tip id", () => {
    const event = streamElementsEventToStreamEvent({
      ...tip,
      data: { ...tip.data, tipId: undefined },
    })!;
    expect(event.id).toBe("streamelements:abc123");
  });

  it("uses now when the timestamp is unusable", () => {
    const event = streamElementsEventToStreamEvent({ ...tip, createdAt: "nonsense" })!;
    expect(event.timestamp).toBeGreaterThan(0);
  });

  it("drops a tip with an unreadable amount", () => {
    expect(
      streamElementsEventToStreamEvent({ ...tip, data: { ...tip.data, amount: undefined } }),
    ).toBeNull();
  });

  it.each([
    ["a follow", { type: "follow", data: {} }],
    ["a subscriber", { type: "subscriber", data: {} }],
    ["nothing at all", undefined],
  ])("ignores %s", (_label, frame) => {
    expect(streamElementsEventToStreamEvent(frame)).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* Connecting                                                          */
/* ------------------------------------------------------------------ */

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  sent: string[] = [];
  readyState = 1;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  closed = false;

  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.closed = true;
    this.readyState = 3;
  }
  deliver(frame: string) {
    this.onmessage?.({ data: frame });
  }
  /** The handshake both services send on connect. */
  handshake() {
    this.deliver('0{"sid":"s1","pingInterval":25000,"pingTimeout":60000}');
  }
}

function sinks() {
  const events: StreamEvent[] = [];
  const statuses: ConnectionStatus[] = [];
  return {
    events,
    statuses,
    onEvent: (e: StreamEvent) => events.push(e),
    onStatus: (s: ConnectionStatus) => statuses.push(s),
    last: () => statuses.at(-1)!,
  };
}

beforeEach(() => {
  FakeWebSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeWebSocket);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("StreamlabsAdapter", () => {
  it("asks for a token before opening anything", async () => {
    const s = sinks();
    const adapter = new StreamlabsAdapter();
    await adapter.connect({ socketToken: "  " }, s.onEvent, s.onStatus);

    expect(s.last()).toEqual({ state: "error", detailKey: "slNeedToken" });
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it("connects with the token in the query and no server in between", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const s = sinks();
    const adapter = new StreamlabsAdapter();
    await adapter.connect({ socketToken: "tok123" }, s.onEvent, s.onStatus);

    const url = new URL(FakeWebSocket.instances[0].url);
    expect(url.host).toBe("sockets.streamlabs.com");
    expect(url.searchParams.get("token")).toBe("tok123");
    expect(url.searchParams.get("transport")).toBe("websocket");
    expect(fetchSpy).not.toHaveBeenCalled();
    adapter.disconnect();
  });

  it("goes live on handshake and emits the donations that follow", async () => {
    const s = sinks();
    const adapter = new StreamlabsAdapter();
    await adapter.connect({ socketToken: "t" }, s.onEvent, s.onStatus);

    const socket = FakeWebSocket.instances[0];
    socket.handshake();
    expect(s.last()).toEqual({ state: "live", detailKey: "slReading" });

    socket.deliver(
      '42["event",{"type":"donation","message":[{"_id":"d1","name":"pili","amount":"500","currency":"ARS","message":"un cafecito"}]}]',
    );
    expect(s.events).toHaveLength(1);
    expect(s.events[0]).toMatchObject({
      id: "streamlabs:d1",
      amount: { value: 500, currency: "ARS" },
    });
    adapter.disconnect();
  });

  it("keeps the connection alive on its own, as engine version 3 requires", async () => {
    vi.useFakeTimers();
    const s = sinks();
    const adapter = new StreamlabsAdapter();
    await adapter.connect({ socketToken: "t" }, s.onEvent, s.onStatus);

    const socket = FakeWebSocket.instances[0];
    socket.handshake();
    expect(socket.sent).not.toContain("2");

    vi.advanceTimersByTime(25_000);
    expect(socket.sent).toContain("2");
    adapter.disconnect();
  });

  it("stops the heartbeat when disconnected", async () => {
    vi.useFakeTimers();
    const s = sinks();
    const adapter = new StreamlabsAdapter();
    await adapter.connect({ socketToken: "t" }, s.onEvent, s.onStatus);

    const socket = FakeWebSocket.instances[0];
    socket.handshake();
    adapter.disconnect();
    const settled = socket.sent.length;

    vi.advanceTimersByTime(120_000);
    expect(socket.sent).toHaveLength(settled);
  });

  it("does not reconnect after an intentional disconnect", async () => {
    const s = sinks();
    const adapter = new StreamlabsAdapter();
    await adapter.connect({ socketToken: "t" }, s.onEvent, s.onStatus);

    const socket = FakeWebSocket.instances[0];
    adapter.disconnect();
    socket.onclose?.();
    expect(FakeWebSocket.instances).toHaveLength(1);
  });
});

describe("StreamElementsAdapter", () => {
  it("asks for a token before opening anything", async () => {
    const s = sinks();
    const adapter = new StreamElementsAdapter();
    await adapter.connect({ token: "", method: "jwt" }, s.onEvent, s.onStatus);

    expect(s.last()).toEqual({ state: "error", detailKey: "seNeedToken" });
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it("keeps the token out of the URL and authenticates after connecting", async () => {
    const s = sinks();
    const adapter = new StreamElementsAdapter();
    await adapter.connect({ token: "jwt-abc", method: "jwt" }, s.onEvent, s.onStatus);

    const socket = FakeWebSocket.instances[0];
    expect(socket.url).not.toContain("jwt-abc");

    socket.handshake();
    expect(JSON.parse(socket.sent[0].slice(2))).toEqual([
      "authenticate",
      { method: "jwt", token: "jwt-abc" },
    ]);
    adapter.disconnect();
  });

  it("passes the overlay method through when chosen", async () => {
    const s = sinks();
    const adapter = new StreamElementsAdapter();
    await adapter.connect({ token: "ov", method: "apikey" }, s.onEvent, s.onStatus);

    FakeWebSocket.instances[0].handshake();
    expect(JSON.parse(FakeWebSocket.instances[0].sent[0].slice(2))[1]).toEqual({
      method: "apikey",
      token: "ov",
    });
    adapter.disconnect();
  });

  it("is not live until authentication succeeds", async () => {
    const s = sinks();
    const adapter = new StreamElementsAdapter();
    await adapter.connect({ token: "t", method: "jwt" }, s.onEvent, s.onStatus);

    const socket = FakeWebSocket.instances[0];
    socket.handshake();
    // Connected, but nothing flows yet.
    expect(s.last().state).toBe("connecting");

    socket.deliver('42["authenticated",{"channelId":"c1"}]');
    expect(s.last()).toEqual({ state: "live", detailKey: "seReading" });
    adapter.disconnect();
  });

  it("reports a rejected token clearly", async () => {
    const s = sinks();
    const adapter = new StreamElementsAdapter();
    await adapter.connect({ token: "bad", method: "jwt" }, s.onEvent, s.onStatus);

    FakeWebSocket.instances[0].handshake();
    FakeWebSocket.instances[0].deliver('42["unauthorized",{}]');
    expect(s.last()).toEqual({ state: "error", detailKey: "seUnauthorized" });
    adapter.disconnect();
  });

  it("emits tips once authenticated", async () => {
    const s = sinks();
    const adapter = new StreamElementsAdapter();
    await adapter.connect({ token: "t", method: "jwt" }, s.onEvent, s.onStatus);

    const socket = FakeWebSocket.instances[0];
    socket.handshake();
    socket.deliver('42["authenticated",{}]');
    socket.deliver(
      '42["event",{"_id":"e1","type":"tip","createdAt":"2026-08-17T12:00:00Z","data":{"username":"rocioo","amount":250,"currency":"ARS","message":"grande"}}]',
    );

    expect(s.events).toHaveLength(1);
    expect(s.events[0]).toMatchObject({
      id: "streamelements:e1",
      amount: { value: 250, currency: "ARS" },
      author: { name: "rocioo" },
    });
    adapter.disconnect();
  });
});
