import type { Amount, Platform } from "./types";

/**
 * Significance bands.
 *
 * Some platforms bucket a donation into a visible band — YouTube's Super Chat
 * colours are the obvious case. That band is worth carrying, because it is the
 * only honest way to compare donations across currencies: a ¥1,000 Super Chat
 * and a $5 one cannot be ranked without an exchange rate, and this app never
 * invents one. YouTube has already done the bucketing with its own per-currency
 * thresholds, so using its answer adds information without inventing any.
 *
 * `Amount.tier` is whatever the source calls it, 1 being the smallest.
 * `Amount.tierMax` says how many bands that source has, when we know — which
 * lets the UI normalise without hardcoding per-platform knowledge.
 */

/**
 * The colour ladders the platforms themselves show.
 *
 * These are *our* mapping of the reported `tier` integer onto each platform's
 * published palette: YouTube sends the tier number but never says which number
 * is which colour, so tier 1 is taken to be the lowest band. Ascending is the
 * obvious reading and matches the amounts, but it is an inference — if a $1
 * Super Chat ever shows up red, this array is inverted.
 *
 * A platform with no published ladder gets no entry, and its rows stay plain
 * rather than being tinted a colour nobody chose.
 */
export const TIER_COLORS: Partial<Record<Platform, string[]>> = {
  // $1–1.99, $2–4.99, $5–9.99, $10–19.99, $20–49.99, $50–99.99, $100+
  // The magenta band is one step darker than YouTube's own #e91e63: at that
  // exact value the amount sitting on it reads 4.35 against either ink, under
  // the 4.5 contrast floor. Same hue, legible.
  youtube: ["#1e88e5", "#00d3e0", "#1de9b6", "#ffca28", "#f57c00", "#d81b60", "#e62117"],
  // Twitch cheermote tiers: 1, 100, 1000, 5000, 10000 bits.
  twitch: ["#979797", "#9c3ee8", "#1db2a5", "#0099fe", "#f43021"],
};

/**
 * The colour a platform would show for this donation, or null when it publishes
 * no ladder. Never guesses a colour for a platform that has none.
 */
export function tierColor(platform: Platform, amount: Amount | undefined): string | null {
  const ladder = TIER_COLORS[platform];
  const tier = amount?.tier;
  if (!ladder || typeof tier !== "number" || !Number.isFinite(tier) || tier < 1) return null;
  return ladder[Math.min(ladder.length, Math.round(tier)) - 1] ?? null;
}

/** The two inks a band chip can use. Neither is pure black or white. */
export const BAND_INKS = ["#ffffff", "#101216"] as const;

/** WCAG relative luminance. */
export function luminance(hex: string): number {
  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * channel(parseInt(hex.slice(1, 3), 16)) +
    0.7152 * channel(parseInt(hex.slice(3, 5), 16)) +
    0.0722 * channel(parseInt(hex.slice(5, 7), 16))
  );
}

/** WCAG contrast ratio between two colours. */
export function contrastRatio(a: string, b: string): number {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Picks whichever ink reads better on `hex`.
 *
 * The ladder runs from pale yellow to deep red, so no single ink works across
 * it — dark text vanishes on red, white text vanishes on yellow. Measured
 * against the inks actually used: treating the dark one as pure black
 * overstates its contrast and picks the wrong ink near the middle of the range.
 */
export function contrastInk(hex: string): string {
  const [best] = [...BAND_INKS].sort((a, b) => contrastRatio(hex, b) - contrastRatio(hex, a));
  return best;
}

/**
 * Twitch's standard cheermote thresholds. Derived rather than reported: the
 * cheer payload carries a bit count and no band, but these are Twitch's own
 * cut-offs, so the banding is theirs and not our invention. All within bits, so
 * nothing is converted.
 */
export const TWITCH_BIT_TIERS = [1, 100, 1000, 5000, 10000];

/**
 * Maps a value onto a 1-based band using ascending thresholds in the *same*
 * unit. Any source that documents its own cut-offs can be mapped this way.
 */
export function tierFromThresholds(value: number, thresholds: number[]): number {
  let tier = 1;
  for (let i = 0; i < thresholds.length; i += 1) {
    if (value >= thresholds[i]) tier = i + 1;
  }
  return tier;
}
