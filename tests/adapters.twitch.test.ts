import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TwitchAdapter,
  consumeTwitchRedirect,
  validateTwitchToken,
} from "@/lib/adapters/twitch";
import type { ConnectionStatus, StreamEvent, TwitchConnectConfig } from "@/lib/types";

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  closed = false;

  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }
  close() {
    this.closed = true;
  }
  /** EventSub frames are plain JSON, unlike Pusher's nested strings. */
  deliver(messageType: string, payload: unknown, subscriptionType = "") {
    this.onmessage?.({
      data: JSON.stringify({
        metadata: {
          message_type: messageType,
          message_timestamp: "2026-08-16T12:00:00Z",
          subscription_type: subscriptionType,
        },
        payload,
      }),
    });
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

const config = (over: Partial<TwitchConnectConfig> = {}): TwitchConnectConfig => ({
  clientId: "cid",
  channel: "somestreamer",
  accessToken: "tok",
  userId: "viewer-1",
  ...over,
});

/** Answers the Helix calls the adapter makes, and records the subscriptions. */
function mockHelix({ broadcasterId = "bc-1" }: { broadcasterId?: string } = {}) {
  const subscribed: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.includes("/users")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: [{ id: broadcasterId, login: "somestreamer", profile_image_url: "http://a" }],
        }),
      } as Response;
    }
    if (url.includes("/eventsub/subscriptions")) {
      subscribed.push(JSON.parse(String(init?.body)).type);
      return { ok: true, status: 200, json: async () => ({}) } as Response;
    }
    throw new Error(`unexpected ${url}`);
  });
  return { subscribed };
}

let adapter: TwitchAdapter;

beforeEach(() => {
  FakeWebSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeWebSocket);
  adapter = new TwitchAdapter();
});

afterEach(() => {
  adapter.disconnect();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("TwitchAdapter — refusing to start", () => {
  it.each([
    ["no client id", { clientId: "" }, "twitchNeedClientId"],
    ["no token", { accessToken: undefined }, "twitchNeedSignIn"],
    ["no channel", { channel: "" }, "twitchNeedChannel"],
  ])("says what is missing when there is %s", async (_label, over, key) => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const s = sinks();
    await adapter.connect(config(over), s.onEvent, s.onStatus);

    expect(s.last()).toEqual({ state: "error", detailKey: key });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it("reports an unknown channel by name", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: [] }),
    } as Response);

    const s = sinks();
    await adapter.connect(config({ channel: "ghost" }), s.onEvent, s.onStatus);

    expect(s.last()).toEqual({
      state: "error",
      detailKey: "twitchNoSuchChannel",
      detailVars: { channel: "ghost" },
    });
  });

  it("tells the user to sign in again when the token is rejected", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "unauthorized",
    } as Response);

    const s = sinks();
    await adapter.connect(config(), s.onEvent, s.onStatus);
    expect(s.last()).toEqual({ state: "error", detailKey: "twitchTokenRejected" });
  });
});

describe("TwitchAdapter — subscribing", () => {
  it("subscribes to chat only when reading someone else's channel", async () => {
    const { subscribed } = mockHelix({ broadcasterId: "bc-1" });
    const s = sinks();
    await adapter.connect(config({ userId: "viewer-1" }), s.onEvent, s.onStatus);

    FakeWebSocket.instances[0].deliver("session_welcome", { session: { id: "sess-1" } });
    await vi.waitFor(() => expect(s.last().state).toBe("live"));

    expect(subscribed).toEqual(["channel.chat.message"]);
    expect(s.last()).toEqual({
      state: "live",
      detailKey: "twitchReadingChatOnly",
      detailVars: { channel: "somestreamer" },
    });
  });

  it("also subscribes to the money events on your own channel", async () => {
    const { subscribed } = mockHelix({ broadcasterId: "me" });
    const s = sinks();
    await adapter.connect(config({ userId: "me" }), s.onEvent, s.onStatus);

    FakeWebSocket.instances[0].deliver("session_welcome", { session: { id: "sess-1" } });
    await vi.waitFor(() => expect(s.last().state).toBe("live"));

    expect(subscribed).toContain("channel.chat.message");
    expect(subscribed).toContain("channel.cheer");
    expect(subscribed).toContain("channel.subscription.gift");
    expect(s.last().detailKey).toBe("twitchReadingFull");
  });

  it("sends the session id so events arrive on this socket", async () => {
    const bodies: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("/users")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: [{ id: "bc-1", login: "s", profile_image_url: "" }] }),
        } as Response;
      }
      bodies.push(String(init?.body));
      return { ok: true, status: 200, json: async () => ({}) } as Response;
    });

    const s = sinks();
    await adapter.connect(config(), s.onEvent, s.onStatus);
    FakeWebSocket.instances[0].deliver("session_welcome", { session: { id: "sess-9" } });
    await vi.waitFor(() => expect(bodies.length).toBeGreaterThan(0));

    const body = JSON.parse(bodies[0]);
    expect(body.transport).toEqual({ method: "websocket", session_id: "sess-9" });
    expect(body.condition).toEqual({ broadcaster_user_id: "bc-1", user_id: "viewer-1" });
  });

  it("reports a failure to subscribe to chat", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (String(input).includes("/users")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: [{ id: "bc-1", login: "s", profile_image_url: "" }] }),
        } as Response;
      }
      return { ok: false, status: 403, text: async () => "missing scope" } as Response;
    });

    const s = sinks();
    await adapter.connect(config(), s.onEvent, s.onStatus);
    FakeWebSocket.instances[0].deliver("session_welcome", { session: { id: "sess-1" } });
    await vi.waitFor(() => expect(s.last().state).toBe("error"));

    expect(s.last().detail).toContain("403");
  });
});

describe("TwitchAdapter — receiving", () => {
  async function connected(userId = "viewer-1") {
    mockHelix();
    const s = sinks();
    await adapter.connect(config({ userId }), s.onEvent, s.onStatus);
    const socket = FakeWebSocket.instances[0];
    socket.deliver("session_welcome", { session: { id: "sess-1" } });
    await vi.waitFor(() => expect(s.last().state).toBe("live"));
    return { s, socket };
  }

  it("emits a chat message", async () => {
    const { s, socket } = await connected();
    socket.deliver(
      "notification",
      {
        event: {
          message_id: "m1",
          chatter_user_name: "nadia",
          message: { text: "hola" },
        },
      },
      "channel.chat.message",
    );

    expect(s.events).toHaveLength(1);
    expect(s.events[0]).toMatchObject({ id: "twitch:m1", message: "hola", kind: "chat" });
  });

  it("emits a cheer as a tip denominated in bits", async () => {
    const { s, socket } = await connected("me");
    socket.deliver(
      "notification",
      { event: { user_id: "7", user_name: "tobias", bits: 500, message: "take it" } },
      "channel.cheer",
    );

    expect(s.events[0]).toMatchObject({
      kind: "tip",
      amount: { value: 500, currency: "BITS" },
    });
  });

  it("ignores keepalives", async () => {
    const { s, socket } = await connected();
    socket.deliver("session_keepalive", {});
    expect(s.events).toHaveLength(0);
    expect(s.last().state).toBe("live");
  });

  it("reports a revoked subscription", async () => {
    const { s, socket } = await connected();
    socket.deliver("revocation", { subscription: { type: "channel.chat.message" } });

    expect(s.last()).toEqual({
      state: "error",
      detailKey: "twitchRevoked",
      detailVars: { type: "channel.chat.message" },
    });
  });

  it("migrates to the new socket Twitch hands over, then drops the old one", async () => {
    const { socket } = await connected();
    socket.deliver("session_reconnect", {
      session: { reconnect_url: "wss://eventsub.wss.twitch.tv/ws?reconnect=1" },
    });

    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(FakeWebSocket.instances[1].url).toContain("reconnect=1");
    // The replacement is connected before the old one is retired, so no gap.
    expect(socket.closed).toBe(true);
  });

  it("reports a socket error", async () => {
    const { s, socket } = await connected();
    socket.onerror?.();
    expect(s.last()).toEqual({ state: "error", detailKey: "twitchSocketError" });
  });

  it("does not reconnect after an intentional disconnect", async () => {
    const { socket } = await connected();
    adapter.disconnect();
    socket.onclose?.();
    expect(FakeWebSocket.instances).toHaveLength(1);
  });
});

describe("twitch OAuth redirect", () => {
  const original = window.location.hash;
  afterEach(() => {
    window.location.hash = original;
  });

  it("returns nothing when there is no token in the URL", () => {
    window.location.hash = "";
    expect(consumeTwitchRedirect()).toBeNull();
  });

  it("takes the token out of the fragment and clears it from the address bar", () => {
    window.location.hash = "#access_token=abc123&scope=user%3Aread%3Achat&token_type=bearer";
    expect(consumeTwitchRedirect()).toBe("abc123");
    // Leaving a token in history would expose it to anything reading the URL.
    expect(window.location.hash).toBe("");
  });

  it("resolves the signed-in user from a valid token", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ user_id: "42", login: "nadia" }),
    } as Response);

    await expect(validateTwitchToken("tok")).resolves.toEqual({
      accessToken: "tok",
      userId: "42",
      userLogin: "nadia",
    });
  });

  it("returns null for a token Twitch rejects", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: false, status: 401 } as Response);
    await expect(validateTwitchToken("bad")).resolves.toBeNull();
  });
});
