import { describe, expect, it } from "vitest";
import { decodePacket, encodeEvent, socketUrl } from "@/lib/adapters/socketio";

describe("decodePacket", () => {
  it("reads the handshake and its timings", () => {
    const packet = decodePacket('0{"sid":"abc","pingInterval":25000,"pingTimeout":60000}');
    expect(packet).toEqual({
      kind: "open",
      payload: { sid: "abc", pingInterval: 25000, pingTimeout: 60000 },
    });
  });

  it("reads a namespace connect", () => {
    expect(decodePacket("40")).toEqual({ kind: "connect" });
  });

  it("reads an event with its arguments", () => {
    const packet = decodePacket('42["event",{"type":"donation"}]');
    expect(packet).toEqual({
      kind: "event",
      name: "event",
      args: [{ type: "donation" }],
    });
  });

  it("reads an event with several arguments", () => {
    const packet = decodePacket('42["authenticate",{"a":1},"second"]');
    expect(packet).toEqual({
      kind: "event",
      name: "authenticate",
      args: [{ a: 1 }, "second"],
    });
  });

  it("reads heartbeats in both directions", () => {
    expect(decodePacket("2")).toEqual({ kind: "ping" });
    expect(decodePacket("3")).toEqual({ kind: "pong" });
  });

  it("reads a socket error", () => {
    expect(decodePacket('44"not authorized"')).toEqual({
      kind: "error",
      detail: '"not authorized"',
    });
  });

  it.each([
    ["empty", ""],
    ["an unknown engine type", "9abc"],
    ["a message with no payload type", "4"],
    ["malformed event JSON", "42[not json"],
    ["an event that is not an array", '42{"a":1}'],
    ["an event whose name is not a string", "42[5,{}]"],
    ["a malformed handshake", "0{broken"],
  ])("ignores %s rather than throwing", (_label, raw) => {
    expect(() => decodePacket(raw)).not.toThrow();
    expect(decodePacket(raw).kind).toBe("ignored");
  });
});

describe("encodeEvent", () => {
  it("frames an event the way Socket.IO expects", () => {
    expect(encodeEvent("authenticate", { method: "jwt", token: "t" })).toBe(
      '42["authenticate",{"method":"jwt","token":"t"}]',
    );
  });

  it("round-trips through the decoder", () => {
    const frame = encodeEvent("event", { type: "tip" }, 42);
    expect(decodePacket(frame)).toEqual({
      kind: "event",
      name: "event",
      args: [{ type: "tip" }, 42],
    });
  });
});

describe("socketUrl", () => {
  it("builds a Streamlabs URL with the token and engine version", () => {
    const url = new URL(socketUrl("https://sockets.streamlabs.com", 3, { token: "abc" }));
    expect(url.protocol).toBe("wss:");
    expect(url.pathname).toBe("/socket.io/");
    expect(url.searchParams.get("EIO")).toBe("3");
    expect(url.searchParams.get("transport")).toBe("websocket");
    expect(url.searchParams.get("token")).toBe("abc");
  });

  it("builds a StreamElements URL with no token in the query", () => {
    const url = new URL(socketUrl("https://realtime.streamelements.com", 3));
    expect(url.host).toBe("realtime.streamelements.com");
    expect(url.searchParams.get("token")).toBeNull();
  });

  it("supports engine version 4", () => {
    expect(new URL(socketUrl("https://x.test", 4)).searchParams.get("EIO")).toBe("4");
  });

  it("uses the websocket transport, so no CORS preflight is involved", () => {
    // Polling transport would issue an XHR and hit CORS; websocket does not.
    expect(socketUrl("https://x.test", 3)).toContain("transport=websocket");
    expect(socketUrl("https://x.test", 3).startsWith("wss://")).toBe(true);
  });

  it("does not double up the socket.io path", () => {
    const url = new URL(socketUrl("https://x.test/socket.io/", 3));
    expect(url.pathname).toBe("/socket.io/");
  });
});
