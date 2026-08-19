import type { Amount } from "./types";

/**
 * Native (non-ISO-4217) units that platforms denominate tips in. These are NOT
 * currencies and have no fixed exchange rate we can rely on, so they are only
 * ever displayed in their own unit.
 */
const NATIVE_UNITS: Record<string, { singular: string; plural: string }> = {
  BITS: { singular: "bit", plural: "bits" },
  KICKS: { singular: "Kick", plural: "Kicks" },
  SUBS: { singular: "sub", plural: "subs" },
};

export function isNativeUnit(currency: string): boolean {
  return currency.toUpperCase() in NATIVE_UNITS;
}

/**
 * Render an Amount in its own unit.
 *
 * Deliberately NOT a converter: there is no cross-currency arithmetic anywhere in
 * this app. A 1000-bit cheer renders as "1,000 bits", never as an invented "$10".
 * Guessing conversions would put quietly-wrong numbers in front of the user.
 */
export function formatAmount(amount: Amount, locale?: string): string {
  const currency = amount.currency.toUpperCase();
  const unit = NATIVE_UNITS[currency];

  if (unit) {
    const n = new Intl.NumberFormat(locale).format(amount.value);
    return `${n} ${amount.value === 1 ? unit.singular : unit.plural}`;
  }

  // Prefer the platform's own string for real currencies — it already carries the
  // correct symbol and locale conventions for that donation.
  if (amount.display) return amount.display;

  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
    }).format(amount.value);
  } catch {
    // Unknown/malformed currency code — show the raw pair rather than throwing.
    return `${amount.value} ${currency}`;
  }
}

/** YouTube reports Super Chat values in micros (1e6 = one unit of currency). */
export function fromMicros(amountMicros: number | string): number {
  const micros = typeof amountMicros === "string" ? Number(amountMicros) : amountMicros;
  if (!Number.isFinite(micros)) return 0;
  return micros / 1_000_000;
}
