import { describe, expect, it } from "vitest";
import {
  describeTwitchError,
  tierName,
  twitchAuthorizeUrl,
  twitchNotificationToEvent,
} from "@/lib/adapters/twitch";
import { kickEventToStreamEvent } from "@/lib/adapters/kick";
import { describeError, parseVideoId } from "@/lib/adapters/youtube";
import { CenekaAdapter } from "@/lib/adapters/ceneka";
import type { ConnectionStatus } from "@/lib/types";

const notification = (type: string, event: Record<string, unknown>) => ({
  metadata: { message_timestamp: "2026-08-16T12:00:00Z", subscription_type: type },
  payload: { event },
});

describe("twitch — chat messages", () => {
  it("maps a plain message", () => {
    const result = twitchNotificationToEvent(
      notification("channel.chat.message", {
        message_id: "m1",
        chatter_user_name: "Nadia",
        chatter_user_login: "nadia",
        color: "#ff0000",
        message: { text: "  hola  " },
      }),
    )!;

    expect(result.id).toBe("twitch:m1");
    expect(result.platform).toBe("twitch");
    expect(result.kind).toBe("chat");
    expect(result.author).toEqual({ name: "Nadia", color: "#ff0000" });
    expect(result.message).toBe("hola");
    expect(result.amount).toBeUndefined();
    expect(result.timestamp).toBe(Date.parse("2026-08-16T12:00:00Z"));
  });

  it("falls back to the login when there is no display name", () => {
    const result = twitchNotificationToEvent(
      notification("channel.chat.message", {
        message_id: "m2",
        chatter_user_login: "nadia",
        message: { text: "hi" },
      }),
    )!;
    expect(result.author.name).toBe("nadia");
  });

  it("treats a message carrying bits as a tip, in bits", () => {
    const result = twitchNotificationToEvent(
      notification("channel.chat.message", {
        message_id: "m3",
        chatter_user_name: "elpepe",
        message: { text: "cheer100 nice" },
        cheer: { bits: 100 },
      }),
    )!;

    expect(result.kind).toBe("tip");
    // Banded from Twitch's own cheermote thresholds; still counted in bits.
    expect(result.amount).toEqual({ value: 100, currency: "BITS", tier: 2, tierMax: 5 });
  });
});

describe("twitch — monetary events", () => {
  it("maps a cheer", () => {
    const result = twitchNotificationToEvent(
      notification("channel.cheer", {
        user_id: "9",
        user_name: "tobias",
        message: "take my bits",
        bits: 500,
        is_anonymous: false,
      }),
    )!;
    expect(result.kind).toBe("tip");
    expect(result.amount).toEqual({ value: 500, currency: "BITS", tier: 2, tierMax: 5 });
    expect(result.author.name).toBe("tobias");
  });

  it("labels an anonymous cheer", () => {
    const result = twitchNotificationToEvent(
      notification("channel.cheer", { bits: 100, is_anonymous: true }),
    )!;
    expect(result.author.name).toBe("Anonymous");
    expect(result.id).toContain("anon");
  });

  it("maps a new subscription", () => {
    const result = twitchNotificationToEvent(
      notification("channel.subscribe", {
        user_id: "1",
        user_name: "pili",
        tier: "2000",
        is_gift: false,
      }),
    )!;
    expect(result.kind).toBe("subscription");
    expect(result.amount).toEqual({ value: 1, currency: "SUBS" });
    expect(result.message).toContain("tier 2");
  });

  it("drops the gifted-sub duplicate that channel.subscribe also fires", () => {
    expect(
      twitchNotificationToEvent(
        notification("channel.subscribe", { user_id: "1", tier: "1000", is_gift: true }),
      ),
    ).toBeNull();
  });

  it("maps a gift bundle with its count", () => {
    const result = twitchNotificationToEvent(
      notification("channel.subscription.gift", {
        user_id: "3",
        user_name: "quantumfrog",
        total: 5,
        tier: "1000",
        is_anonymous: false,
      }),
    )!;
    expect(result.amount).toEqual({ value: 5, currency: "SUBS" });
    expect(result.message).toBe("Gifted 5 tier 1 subs");
  });

  it("uses the singular for a single gift", () => {
    const result = twitchNotificationToEvent(
      notification("channel.subscription.gift", { user_id: "3", total: 1, tier: "1000" }),
    )!;
    expect(result.message).toBe("Gifted 1 tier 1 sub");
  });

  it("uses a resub's own message when there is one", () => {
    const result = twitchNotificationToEvent(
      notification("channel.subscription.message", {
        user_id: "4",
        user_name: "rocioo",
        message: { text: "18 months!" },
        cumulative_months: 18,
      }),
    )!;
    expect(result.message).toBe("18 months!");
  });

  it("describes a resub without a message", () => {
    const result = twitchNotificationToEvent(
      notification("channel.subscription.message", {
        user_id: "4",
        message: { text: "" },
        cumulative_months: 6,
      }),
    )!;
    expect(result.message).toBe("Resubscribed for 6 months");
  });

  it("ignores event types it does not handle", () => {
    expect(twitchNotificationToEvent(notification("channel.follow", {}))).toBeNull();
  });

  it("maps tiers to readable names", () => {
    expect(tierName("1000")).toBe("1");
    expect(tierName("2000")).toBe("2");
    expect(tierName("3000")).toBe("3");
  });
});

describe("twitch — auth and errors", () => {
  it("requests the scopes chat and money need", () => {
    const url = new URL(twitchAuthorizeUrl("cid", "https://example.com/"));
    expect(url.searchParams.get("response_type")).toBe("token");
    expect(url.searchParams.get("client_id")).toBe("cid");
    expect(url.searchParams.get("redirect_uri")).toBe("https://example.com/");
    expect(url.searchParams.get("scope")).toContain("user:read:chat");
    expect(url.searchParams.get("scope")).toContain("bits:read");
  });

  it("turns a 401 into actionable advice rather than a raw error", () => {
    const err = Object.assign(new Error("Twitch API 401: bad"), { status: 401 });
    expect(describeTwitchError(err)).toEqual({
      state: "error",
      detailKey: "twitchTokenRejected",
    });
  });

  it("passes other errors through verbatim", () => {
    const status = describeTwitchError(new Error("Twitch API 500: boom"));
    expect(status.state).toBe("error");
    expect(status.detail).toContain("500");
  });
});

describe("kick", () => {
  it("maps a chat message", () => {
    const result = kickEventToStreamEvent("App\\Events\\ChatMessageEvent", {
      id: "abc",
      content: "gg wp",
      created_at: "2026-08-16T12:00:00Z",
      sender: { id: 1, username: "braulio", identity: { color: "#53fc18" } },
    })!;

    expect(result.id).toBe("kick:abc");
    expect(result.platform).toBe("kick");
    expect(result.author).toEqual({ name: "braulio", color: "#53fc18" });
    expect(result.message).toBe("gg wp");
    expect(result.timestamp).toBe(Date.parse("2026-08-16T12:00:00Z"));
  });

  it("falls back to now when the timestamp is unusable", () => {
    const result = kickEventToStreamEvent(
      "App\\Events\\ChatMessageEvent",
      { id: "t", content: "x", created_at: "nonsense", sender: { id: 1, username: "a" } },
      1234,
    )!;
    expect(result.timestamp).toBe(1234);
  });

  it("ignores a chat event with no sender", () => {
    expect(kickEventToStreamEvent("App\\Events\\ChatMessageEvent", { id: "x" })).toBeNull();
  });

  it("maps a subscription and a resub", () => {
    const fresh = kickEventToStreamEvent(
      "App\\Events\\SubscriptionEvent",
      { username: "pili", months: 1 },
      100,
    )!;
    expect(fresh.message).toBe("Subscribed");
    expect(fresh.amount).toEqual({ value: 1, currency: "SUBS" });

    const resub = kickEventToStreamEvent(
      "App\\Events\\SubscriptionEvent",
      { username: "pili", months: 7 },
      100,
    )!;
    expect(resub.message).toBe("Resubscribed for 7 months");
  });

  it("counts gifted subs", () => {
    const result = kickEventToStreamEvent(
      "App\\Events\\GiftedSubscriptionsEvent",
      { gifter_username: "tobias", gifted_usernames: ["a", "b", "c"] },
      100,
    )!;
    expect(result.amount).toEqual({ value: 3, currency: "SUBS" });
    expect(result.message).toBe("Gifted 3 subs");
  });

  it("ignores unknown events rather than guessing at them", () => {
    // Kicks (Kick's paid currency) land here until we can verify the payload.
    expect(kickEventToStreamEvent("App\\Events\\SomethingNew", { amount: 999 })).toBeNull();
  });
});

describe("youtube — video ids", () => {
  it.each([
    ["bare id", "dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["watch url", "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1", "dQw4w9WgXcQ"],
    ["short link", "https://youtu.be/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["live url", "https://www.youtube.com/live/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["padded", "  dQw4w9WgXcQ  ", "dQw4w9WgXcQ"],
  ])("parses a %s", (_label, input, expected) => {
    expect(parseVideoId(input)).toBe(expected);
  });

  it.each([
    ["prose", "not a video"],
    ["blank", "   "],
    ["a channel url", "https://www.youtube.com/@somechannel"],
  ])("rejects %s", (_label, input) => {
    expect(parseVideoId(input)).toBeNull();
  });
});

describe("youtube — error messages", () => {
  const reason = (r: string) => ({ error: { errors: [{ reason: r }], message: "raw" } });

  it("explains quota exhaustion, which is the failure streamers actually hit", () => {
    expect(describeError(reason("quotaExceeded"), 403)).toEqual({
      state: "error",
      detailKey: "ytQuota",
    });
  });

  it("distinguishes rate limiting from quota", () => {
    expect(describeError(reason("rateLimitExceeded"), 403).detailKey).toBe("ytRateLimited");
  });

  it("explains a vanished chat", () => {
    expect(describeError({}, 404).detailKey).toBe("ytChatGone");
  });

  it("passes a specific API message through when there is one", () => {
    const status = describeError({ error: { message: "API key not valid" } }, 400);
    expect(status.detail).toBe("API key not valid");
  });

  it("always produces an error state", () => {
    for (const status of [400, 403, 404, 500]) {
      expect(describeError({}, status).state).toBe("error");
    }
  });
});

describe("ceneka", () => {
  it("reports itself unavailable rather than pretending to connect", async () => {
    const statuses: ConnectionStatus[] = [];
    const adapter = new CenekaAdapter();
    await adapter.connect({}, () => {}, (s) => statuses.push(s));

    expect(statuses).toEqual([{ state: "unavailable", detailKey: "cenekaUnavailable" }]);
    expect(() => adapter.disconnect()).not.toThrow();
  });
});
