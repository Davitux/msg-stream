import { describe, expect, it } from "vitest";
import { formatAmount, fromMicros, isNativeUnit } from "@/lib/money";

/** Intl inserts non-breaking spaces; compare on visible content. */
const norm = (s: string) => s.replace(/[  ]/g, " ");

describe("formatAmount — native units", () => {
  it("renders bits in their own unit, never as money", () => {
    expect(norm(formatAmount({ value: 1000, currency: "BITS" }, "en-US"))).toBe("1,000 bits");
  });

  it("uses the singular for one", () => {
    expect(formatAmount({ value: 1, currency: "BITS" }, "en-US")).toBe("1 bit");
    expect(formatAmount({ value: 1, currency: "SUBS" }, "en-US")).toBe("1 sub");
    expect(formatAmount({ value: 1, currency: "KICKS" }, "en-US")).toBe("1 Kick");
  });

  it("keeps Kick's brand casing", () => {
    expect(formatAmount({ value: 250, currency: "KICKS" }, "en-US")).toBe("250 Kicks");
  });

  it("ignores a display string for native units, since it would be a currency", () => {
    expect(formatAmount({ value: 5, currency: "BITS", display: "$0.05" }, "en-US")).toBe("5 bits");
  });

  it("is case-insensitive about the unit", () => {
    expect(isNativeUnit("bits")).toBe(true);
    expect(isNativeUnit("USD")).toBe(false);
  });
});

describe("formatAmount — real currencies", () => {
  it("prefers the platform's own display string", () => {
    expect(formatAmount({ value: 5, currency: "USD", display: "$5.00" }, "en-US")).toBe("$5.00");
  });

  it("falls back to Intl when the platform gives no string", () => {
    expect(formatAmount({ value: 5, currency: "USD" }, "en-US")).toBe("$5.00");
    expect(norm(formatAmount({ value: 2000, currency: "ARS" }, "en-US"))).toBe("ARS 2,000.00");
  });

  it("formats the same amount per locale", () => {
    const amount = { value: 1234.5, currency: "EUR" };
    expect(norm(formatAmount(amount, "en-US"))).toBe("€1,234.50");
    expect(norm(formatAmount(amount, "es"))).toContain("1234,50");
  });

  it("never converts between currencies", () => {
    // 1000 bits is ~$10 in the real world; we must not say so.
    const rendered = formatAmount({ value: 1000, currency: "BITS" }, "en-US");
    expect(rendered).not.toContain("$");
    expect(rendered).not.toContain("10");
  });

  it("shows the raw pair rather than throwing on a bad currency code", () => {
    expect(formatAmount({ value: 7, currency: "ZZZZ" }, "en-US")).toBe("7 ZZZZ");
  });
});

describe("fromMicros", () => {
  it("converts YouTube's micros to currency units", () => {
    expect(fromMicros("5000000")).toBe(5);
    expect(fromMicros(1_500_000)).toBe(1.5);
  });

  it("returns zero for unparseable input rather than NaN", () => {
    expect(fromMicros("abc")).toBe(0);
    expect(fromMicros(Number.NaN)).toBe(0);
  });
});
