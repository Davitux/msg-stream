import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { YouTubeAdapter } from "@/lib/adapters/youtube";
import { KickAdapter } from "@/lib/adapters/kick";
import type { ConnectionStatus, StreamEvent } from "@/lib/types";

/** Collects what an adapter reports, so tests can assert on the sequence. */
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

const jsonResponse = (body: unknown, ok = true, status = 200) =>
  ({ ok, status, json: async () => body }) as Response;

/* ------------------------------------------------------------------ */
/* YouTube                                                             */
/* ------------------------------------------------------------------ */

describe("YouTubeAdapter.connect", () => {
  let adapter: YouTubeAdapter;

  beforeEach(() => {
    adapter = new YouTubeAdapter();
  });
  afterEach(() => {
    adapter.disconnect();
    vi.restoreAllMocks();
  });

  it("asks for a key before making any request", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const s = sinks();
    await adapter.connect({ video: "dQw4w9WgXcQ", apiKey: "" }, s.onEvent, s.onStatus);

    expect(s.last()).toEqual({ state: "error", detailKey: "ytNeedApiKey" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects an unparseable video before making any request", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const s = sinks();
    await adapter.connect({ video: "not a video", apiKey: "k" }, s.onEvent, s.onStatus);

    expect(s.last()).toEqual({ state: "error", detailKey: "ytBadVideo" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([
    // All three arrive as a 200 with a body, so they have to be told apart by
    // shape rather than status.
    ["an unknown or private video", { items: [] }, "ytNoSuchVideo"],
    ["a video that is not a stream", { items: [{ id: "x" }] }, "ytNotLive"],
    ["a stream whose chat is not active", { items: [{ liveStreamingDetails: {} }] }, "ytNoLiveChat"],
  ])("distinguishes %s", async (_label, body, detailKey) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(body));
    const s = sinks();
    await adapter.connect({ video: "dQw4w9WgXcQ", apiKey: "k" }, s.onEvent, s.onStatus);

    expect(s.last()).toEqual({ state: "error", detailKey });
  });

  it("reports a network failure rather than throwing", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    const s = sinks();
    await adapter.connect({ video: "dQw4w9WgXcQ", apiKey: "k" }, s.onEvent, s.onStatus);

    expect(s.last()).toEqual({ state: "error", detailKey: "ytUnreachable" });
  });

  it("surfaces a bad key from the first call", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ error: { message: "API key not valid" } }, false, 400),
    );
    const s = sinks();
    await adapter.connect({ video: "dQw4w9WgXcQ", apiKey: "bad" }, s.onEvent, s.onStatus);

    expect(s.last().detail).toBe("API key not valid");
  });

  it("resolves the chat then emits the messages it polls", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/videos")) {
        return jsonResponse({ items: [{ liveStreamingDetails: { activeLiveChatId: "chat1" } }] });
      }
      return jsonResponse({
        nextPageToken: "page2",
        pollingIntervalMillis: 5000,
        items: [
          {
            id: "msg1",
            snippet: {
              type: "textMessageEvent",
              publishedAt: "2026-08-16T12:00:00Z",
              textMessageDetails: { messageText: "hola" },
            },
            authorDetails: { displayName: "nadia", profileImageUrl: "http://img" },
          },
          {
            id: "msg2",
            snippet: {
              type: "superChatEvent",
              publishedAt: "2026-08-16T12:00:01Z",
              superChatDetails: {
                amountMicros: "5000000",
                currency: "USD",
                amountDisplayString: "$5.00",
                userComment: "gracias!",
                tier: 3,
              },
            },
            authorDetails: { displayName: "elpepe", profileImageUrl: "http://img2" },
          },
        ],
      });
    });

    const s = sinks();
    await adapter.connect({ video: "dQw4w9WgXcQ", apiKey: "k" }, s.onEvent, s.onStatus);
    await vi.waitFor(() => expect(s.events.length).toBe(2));

    expect(s.events[0]).toMatchObject({
      id: "youtube:msg1",
      kind: "chat",
      message: "hola",
      author: { name: "nadia" },
    });
    expect(s.events[1]).toMatchObject({
      id: "youtube:msg2",
      kind: "tip",
      message: "gracias!",
      // YouTube's own colour band, carried through untouched.
      amount: { value: 5, currency: "USD", display: "$5.00", tier: 3 },
    });
    expect(s.last()).toEqual({ state: "live", detailKey: "ytReading" });
  });

  it("passes the live chat id and page token back on the next poll", async () => {
    const urls: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      urls.push(url);
      if (url.includes("/videos")) {
        return jsonResponse({ items: [{ liveStreamingDetails: { activeLiveChatId: "chat1" } }] });
      }
      return jsonResponse({ nextPageToken: "page2", items: [] });
    });

    const s = sinks();
    await adapter.connect({ video: "dQw4w9WgXcQ", apiKey: "k" }, s.onEvent, s.onStatus);
    await vi.waitFor(() => expect(urls.some((u) => u.includes("/liveChat/messages"))).toBe(true));

    const chatUrl = urls.find((u) => u.includes("/liveChat/messages"))!;
    expect(chatUrl).toContain("liveChatId=chat1");
    expect(chatUrl).toContain("key=k");
  });

  it("calls the endpoints YouTube actually documents", async () => {
    // Regression: the resource is `liveChatMessages` but the path is
    // `liveChat/messages`. The wrong path 404s with an HTML body, which then
    // fails to parse and masquerades as a network outage. Pinned exactly,
    // because substring matching is what let it through before.
    const urls: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      urls.push(String(input));
      if (String(input).includes("/videos")) {
        return jsonResponse({
          items: [{ liveStreamingDetails: { activeLiveChatId: "chat1" } }],
        });
      }
      return jsonResponse({ items: [] });
    });

    const s = sinks();
    await adapter.connect({ video: "dQw4w9WgXcQ", apiKey: "k" }, s.onEvent, s.onStatus);
    await vi.waitFor(() => expect(urls.length).toBeGreaterThan(1));

    expect(new URL(urls[0]).pathname).toBe("/youtube/v3/videos");
    expect(new URL(urls[1]).pathname).toBe("/youtube/v3/liveChat/messages");
  });

  it("reports a non-JSON body as an error, not as a lost connection", async () => {
    // A wrong path or an outage page returns HTML; `res.json()` throwing there
    // used to surface as "Lost contact with YouTube", pointing at the network
    // when the real fault was the request.
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (String(input).includes("/videos")) {
        return jsonResponse({ items: [{ liveStreamingDetails: { activeLiveChatId: "c" } }] });
      }
      return {
        ok: false,
        status: 404,
        json: async () => {
          throw new SyntaxError("Unexpected token < in JSON");
        },
      } as unknown as Response;
    });

    const s = sinks();
    await adapter.connect({ video: "dQw4w9WgXcQ", apiKey: "k" }, s.onEvent, s.onStatus);
    await vi.waitFor(() => expect(s.last().state).toBe("error"));

    // The status still drives the message; the point is that an unparseable
    // body no longer gets blamed on the network.
    expect(s.last().detailKey).not.toBe("ytLostContact");
    expect(s.last().detailKey).toBe("ytChatGone");
  });

  it("keeps a genuine network failure reported as one", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (String(input).includes("/videos")) {
        return jsonResponse({ items: [{ liveStreamingDetails: { activeLiveChatId: "c" } }] });
      }
      throw new TypeError("Failed to fetch");
    });

    const s = sinks();
    await adapter.connect({ video: "dQw4w9WgXcQ", apiKey: "k" }, s.onEvent, s.onStatus);
    await vi.waitFor(() => expect(s.last().detailKey).toBe("ytLostContact"));
  });

  it("explains an exhausted quota instead of showing a raw API error", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (String(input).includes("/videos")) {
        return jsonResponse({ items: [{ liveStreamingDetails: { activeLiveChatId: "c" } }] });
      }
      return jsonResponse(
        { error: { errors: [{ reason: "quotaExceeded" }], message: "quota" } },
        false,
        403,
      );
    });

    const s = sinks();
    await adapter.connect({ video: "dQw4w9WgXcQ", apiKey: "k" }, s.onEvent, s.onStatus);
    await vi.waitFor(() => expect(s.last().detailKey).toBe("ytQuota"));
  });

  it("stops polling once disconnected", async () => {
    let chatCalls = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (String(input).includes("/videos")) {
        return jsonResponse({ items: [{ liveStreamingDetails: { activeLiveChatId: "c" } }] });
      }
      chatCalls += 1;
      return jsonResponse({ items: [], pollingIntervalMillis: 1 });
    });

    const s = sinks();
    await adapter.connect({ video: "dQw4w9WgXcQ", apiKey: "k" }, s.onEvent, s.onStatus);
    await vi.waitFor(() => expect(chatCalls).toBeGreaterThan(0));

    adapter.disconnect();
    const settled = chatCalls;
    await new Promise((r) => setTimeout(r, 60));
    expect(chatCalls).toBe(settled);
  });
});

/* ------------------------------------------------------------------ */
/* Kick                                                                */
/* ------------------------------------------------------------------ */

/** Minimal stand-in for the Pusher socket. */
class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  sent: string[] = [];
  onopen: (() => void) | null = null;
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
  }
  /** Delivers a Pusher frame, whose payload is a JSON string inside the frame. */
  deliver(event: string, data?: unknown) {
    this.onmessage?.({
      data: JSON.stringify(data === undefined ? { event } : { event, data: JSON.stringify(data) }),
    });
  }
}

describe("KickAdapter.connect", () => {
  let adapter: KickAdapter;

  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.stubGlobal("WebSocket", FakeWebSocket);
    adapter = new KickAdapter();
  });
  afterEach(() => {
    adapter.disconnect();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each([
    ["nothing", ""],
    ["a blank string", "   "],
    ["something that isn't a number", "abc"],
    ["a negative number", "-5"],
    ["a decimal", "12.5"],
  ])("asks for a chatroom id when given %s", async (_label, chatroomId) => {
    const s = sinks();
    await adapter.connect({ channel: "somestreamer", chatroomId }, s.onEvent, s.onStatus);

    expect(s.last()).toEqual({ state: "error", detailKey: "kickNeedChatroomId" });
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it("connects straight to Pusher with no server in between", async () => {
    // WebSockets aren't subject to CORS, so the browser reaches Kick directly.
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const s = sinks();
    await adapter.connect({ channel: "somestreamer", chatroomId: "111" }, s.onEvent, s.onStatus);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(FakeWebSocket.instances[0].url).toContain("ws-us2.pusher.com");
  });

  it("tolerates whitespace around a pasted id", async () => {
    const s = sinks();
    await adapter.connect({ channel: "x", chatroomId: "  111  " }, s.onEvent, s.onStatus);

    const socket = FakeWebSocket.instances[0];
    socket.onopen?.();
    expect(JSON.parse(socket.sent[0]).data.channel).toBe("chatrooms.111.v2");
  });

  it("subscribes to chat only when no channel id is given", async () => {
    const s = sinks();
    await adapter.connect({ channel: "x", chatroomId: "111" }, s.onEvent, s.onStatus);

    const socket = FakeWebSocket.instances[0];
    socket.onopen?.();
    expect(socket.sent.map((m) => JSON.parse(m).data.channel)).toEqual(["chatrooms.111.v2"]);
  });

  it("also subscribes to the channel feed when a channel id is given", async () => {
    const s = sinks();
    await adapter.connect(
      { channel: "x", chatroomId: "111", channelId: "222" },
      s.onEvent,
      s.onStatus,
    );

    const socket = FakeWebSocket.instances[0];
    socket.onopen?.();
    expect(socket.sent.map((m) => JSON.parse(m).data.channel)).toEqual([
      "chatrooms.111.v2",
      "channel.222",
    ]);
  });

  it("ignores an unusable channel id rather than refusing to start", async () => {
    const s = sinks();
    await adapter.connect(
      { channel: "x", chatroomId: "111", channelId: "not-a-number" },
      s.onEvent,
      s.onStatus,
    );

    const socket = FakeWebSocket.instances[0];
    socket.onopen?.();
    expect(socket.sent.map((m) => JSON.parse(m).data.channel)).toEqual(["chatrooms.111.v2"]);
  });

  it("answers Pusher's ping so the socket is not dropped", async () => {
    const s = sinks();
    await adapter.connect({ channel: "x", chatroomId: "1" }, s.onEvent, s.onStatus);

    const socket = FakeWebSocket.instances[0];
    socket.deliver("pusher:ping");
    expect(socket.sent.map((m) => JSON.parse(m).event)).toContain("pusher:pong");
  });

  it("goes live on subscription and emits the chat that follows", async () => {
    const s = sinks();
    await adapter.connect({ channel: "somestreamer", chatroomId: "1" }, s.onEvent, s.onStatus);

    const socket = FakeWebSocket.instances[0];
    socket.deliver("pusher_internal:subscription_succeeded", {});
    expect(s.last()).toEqual({
      state: "live",
      detailKey: "kickReading",
      detailVars: { channel: "somestreamer" },
    });

    socket.deliver("App\\Events\\ChatMessageEvent", {
      id: "k1",
      content: "vamos",
      created_at: "2026-08-17T12:00:00Z",
      sender: { id: 3, username: "braulio" },
    });

    expect(s.events).toHaveLength(1);
    expect(s.events[0]).toMatchObject({ id: "kick:k1", message: "vamos" });
  });

  it("falls back to a label when no slug was entered", async () => {
    const s = sinks();
    await adapter.connect({ channel: "", chatroomId: "1" }, s.onEvent, s.onStatus);
    FakeWebSocket.instances[0].deliver("pusher_internal:subscription_succeeded", {});
    expect(s.last().detailVars).toEqual({ channel: "Kick" });
  });

  it("ignores a frame whose payload is not valid JSON", async () => {
    const s = sinks();
    await adapter.connect({ channel: "x", chatroomId: "1" }, s.onEvent, s.onStatus);

    const socket = FakeWebSocket.instances[0];
    expect(() =>
      socket.onmessage?.({ data: JSON.stringify({ event: "whatever", data: "{broken" }) }),
    ).not.toThrow();
    expect(s.events).toHaveLength(0);
  });

  it("does not reconnect after an intentional disconnect", async () => {
    const s = sinks();
    await adapter.connect({ channel: "x", chatroomId: "1" }, s.onEvent, s.onStatus);

    const socket = FakeWebSocket.instances[0];
    adapter.disconnect();
    socket.onclose?.();

    expect(socket.closed).toBe(true);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });
});
