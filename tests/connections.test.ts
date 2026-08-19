import { describe, expect, it } from "vitest";
import { connectionConfig, connectionSignature, makeAdapter } from "@/lib/useConnections";
import { PLATFORMS, createProfile, type AppSettings, type Profile } from "@/lib/types";

const app: AppSettings = { locale: "en", theme: "system", twitchClientId: "client-1", capture: "all", platformDisplay: "name", bandBackground: false, historyDays: 30 };

function profileWith(patch: Partial<Profile> = {}): Profile {
  return { ...createProfile("Main", "p1"), ...patch };
}

describe("makeAdapter", () => {
  it("builds an adapter for every platform, tagged with that platform", () => {
    for (const platform of PLATFORMS) {
      expect(makeAdapter(platform).platform).toBe(platform);
    }
  });
});

describe("connectionSignature", () => {
  it("is stable when nothing relevant changed", () => {
    const profile = profileWith({ twitch: { channel: "abc" } });
    expect(connectionSignature("twitch", profile, app)).toBe(
      connectionSignature("twitch", profile, app),
    );
  });

  it("changes when that platform's own settings change", () => {
    const before = connectionSignature("twitch", profileWith({ twitch: { channel: "a" } }), app);
    const after = connectionSignature("twitch", profileWith({ twitch: { channel: "b" } }), app);
    expect(before).not.toBe(after);
  });

  it("does not change when an unrelated platform is edited", () => {
    // Typing in the YouTube field must not tear down a healthy Twitch socket.
    const before = connectionSignature("twitch", profileWith({ twitch: { channel: "a" } }), app);
    const after = connectionSignature(
      "twitch",
      profileWith({ twitch: { channel: "a" }, youtube: { video: "vid", apiKey: "key" } }),
      app,
    );
    expect(before).toBe(after);
  });

  it("changes for Twitch when the shared client id changes", () => {
    const profile = profileWith({ twitch: { channel: "a" } });
    expect(connectionSignature("twitch", profile, app)).not.toBe(
      connectionSignature("twitch", profile, { ...app, twitchClientId: "other" }),
    );
  });

  it("changes for Twitch when the signed-in user changes", () => {
    const before = connectionSignature(
      "twitch",
      profileWith({ twitch: { channel: "a", accessToken: "t1", userId: "1" } }),
      app,
    );
    const after = connectionSignature(
      "twitch",
      profileWith({ twitch: { channel: "a", accessToken: "t2", userId: "2" } }),
      app,
    );
    expect(before).not.toBe(after);
  });

  it("changes for every platform when the profile changes", () => {
    // A different profile means different channels, so everything reconnects.
    const first = createProfile("One", "p1");
    const second = { ...createProfile("Two", "p2") };
    for (const platform of PLATFORMS) {
      expect(connectionSignature(platform, first, app)).not.toBe(
        connectionSignature(platform, second, app),
      );
    }
  });

  it("tracks the settings each platform actually depends on", () => {
    const base = profileWith();
    const changes: Array<[Parameters<typeof connectionSignature>[0], Partial<Profile>]> = [
      ["youtube", { youtube: { video: "v", apiKey: "k" } }],
      ["kick", { kick: { channel: "slug", chatroomId: "999" } }],
      ["ceneka", { ceneka: { token: "tok" } }],
    ];
    for (const [platform, patch] of changes) {
      expect(connectionSignature(platform, base, app)).not.toBe(
        connectionSignature(platform, profileWith(patch), app),
      );
    }
  });
});

describe("connectionConfig", () => {
  it("merges the app-level client id into the Twitch config", () => {
    const profile = profileWith({ twitch: { channel: "abc", accessToken: "tok" } });
    expect(connectionConfig("twitch", profile, app)).toEqual({
      channel: "abc",
      accessToken: "tok",
      clientId: "client-1",
    });
  });

  it("passes other platforms their own slice untouched", () => {
    const profile = profileWith({ youtube: { video: "v", apiKey: "k" } });
    expect(connectionConfig("youtube", profile, app)).toEqual({ video: "v", apiKey: "k" });
    expect(connectionConfig("kick", profile, app)).toEqual(profile.kick);
  });
});
