import { describe, expect, it } from "vitest";
import {
  BAND_INKS,
  TIER_COLORS,
  contrastInk,
  contrastRatio,
  TWITCH_BIT_TIERS,
  tierColor,
  tierFromThresholds,
} from "@/lib/tiers";
import { twitchNotificationToEvent } from "@/lib/adapters/twitch";

describe("tierFromThresholds", () => {
  it.each([
    [1, 1],
    [99, 1],
    [100, 2],
    [999, 2],
    [1000, 3],
    [5000, 4],
    [9999, 4],
    [10_000, 5],
    [250_000, 5],
  ])("puts %i bits in band %i", (bits, band) => {
    expect(tierFromThresholds(bits, TWITCH_BIT_TIERS)).toBe(band);
  });

  it("never returns less than the first band", () => {
    expect(tierFromThresholds(0, TWITCH_BIT_TIERS)).toBe(1);
  });

  it("works for any source that documents its own cut-offs", () => {
    expect(tierFromThresholds(7, [1, 5, 10])).toBe(2);
    expect(tierFromThresholds(10, [1, 5, 10])).toBe(3);
  });
});

describe("Twitch cheers carry a band", () => {
  const cheer = (bits: number) =>
    twitchNotificationToEvent({
      metadata: {
        message_timestamp: "2026-08-18T12:00:00Z",
        subscription_type: "channel.cheer",
      },
      payload: { event: { user_id: "1", user_name: "x", bits, message: "" } },
    })!;

  it("bands a small cheer low and a large one high", () => {
    expect(cheer(50).amount?.tier).toBe(1);
    expect(cheer(10_000).amount?.tier).toBe(5);
    // And those map onto Twitch's own grey and red.
    expect(tierColor("twitch", cheer(50).amount)).toBe("#979797");
    expect(tierColor("twitch", cheer(10_000).amount)).toBe("#f43021");
  });

  it("keeps the amount in bits, unconverted", () => {
    expect(cheer(1000).amount).toMatchObject({ value: 1000, currency: "BITS" });
  });
});

describe("tierColor", () => {
  const amount = (tier?: number) => ({ value: 1, currency: "USD", tier });

  it("uses YouTube's own ladder, lowest band first", () => {
    // Blue at the bottom, red at the top — the order YouTube shows.
    expect(tierColor("youtube", amount(1))).toBe("#1e88e5");
    expect(tierColor("youtube", amount(7))).toBe("#e62117");
  });

  it("keeps every band legible with the ink chosen for it", () => {
    // The amount sits on the band as a solid block, so each colour has to
    // carry text at the WCAG floor for normal-sized text.
    for (const platform of ["youtube", "twitch"] as const) {
      for (const color of TIER_COLORS[platform]!) {
        expect(contrastRatio(color, contrastInk(color)), color).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("measures against the ink actually used, not idealised black", () => {
    // Treating the dark ink as pure black overstates contrast and picks the
    // wrong ink for mid-luminance colours.
    expect(BAND_INKS).toContain(contrastInk("#ffca28"));
    expect(contrastInk("#ffca28")).toBe("#101216");
    expect(contrastInk("#9c3ee8")).toBe("#ffffff");
    expect(contrastRatio("#ffffff", "#101216")).toBeGreaterThan(15);
  });

  it("uses Twitch's cheermote colours", () => {
    expect(tierColor("twitch", amount(1))).toBe("#979797");
    expect(tierColor("twitch", amount(5))).toBe("#f43021");
  });

  it("clamps a band beyond the ladder to its top colour", () => {
    expect(tierColor("youtube", amount(99))).toBe("#e62117");
  });

  it("gives no colour to a platform that publishes no ladder", () => {
    // Better a plain row than one tinted a colour nobody chose.
    for (const platform of ["kick", "streamlabs", "streamelements", "ceneka"] as const) {
      expect(tierColor(platform, amount(3))).toBeNull();
    }
  });

  it.each([
    ["no band at all", undefined],
    ["a zero band", 0],
    ["a negative band", -1],
  ])("gives no colour for %s", (_label, tier) => {
    expect(tierColor("youtube", amount(tier))).toBeNull();
  });

  it("gives every YouTube band a distinct colour", () => {
    const colors = [1, 2, 3, 4, 5, 6, 7].map((t) => tierColor("youtube", amount(t)));
    expect(new Set(colors).size).toBe(7);
  });
});
