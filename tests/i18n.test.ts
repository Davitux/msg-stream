import { describe, expect, it } from "vitest";
import { LOCALE_LABELS, dictionaries, makeTranslator, translate } from "@/lib/i18n";
import { LOCALES } from "@/lib/types";

describe("dictionaries", () => {
  it("covers every locale listed as selectable", () => {
    for (const locale of LOCALES) {
      expect(dictionaries[locale]).toBeDefined();
      expect(LOCALE_LABELS[locale]).toBeTruthy();
    }
  });

  it("has the same keys in every language", () => {
    const english = Object.keys(dictionaries.en).sort();
    for (const locale of LOCALES) {
      expect(Object.keys(dictionaries[locale]).sort()).toEqual(english);
    }
  });

  it("has no empty strings", () => {
    for (const locale of LOCALES) {
      for (const [key, value] of Object.entries(dictionaries[locale])) {
        expect(value.trim(), `${locale}.${key}`).not.toBe("");
      }
    }
  });

  it("keeps the same placeholders across languages", () => {
    const placeholders = (s: string) => (s.match(/\{(\w+)\}/g) ?? []).sort();
    for (const key of Object.keys(dictionaries.en) as Array<keyof typeof dictionaries.en>) {
      const expected = placeholders(dictionaries.en[key]);
      for (const locale of LOCALES) {
        expect(placeholders(dictionaries[locale][key]), `${locale}.${key}`).toEqual(expected);
      }
    }
  });

  it("actually translates rather than copying English", () => {
    // A handful of shared tokens legitimately match (e.g. "Client ID", "sub").
    const identical = (Object.keys(dictionaries.en) as Array<keyof typeof dictionaries.en>).filter(
      (key) => dictionaries.en[key] === dictionaries.es[key],
    );
    expect(identical.length).toBeLessThan(8);
  });
});

describe("translate", () => {
  it("returns the string for the requested locale", () => {
    expect(translate("en", "settings")).toBe("Settings");
    expect(translate("es", "settings")).toBe("Ajustes");
  });

  it("substitutes named variables", () => {
    expect(translate("en", "signedInAs", { user: "nadia" })).toBe("Signed in as nadia");
    expect(translate("es", "signedInAs", { user: "nadia" })).toBe("Sesión iniciada como nadia");
  });

  it("substitutes several variables in one string", () => {
    const result = translate("en", "toggleChannel", {
      platform: "Twitch",
      state: "Live",
      action: "off",
    });
    expect(result).toBe("Twitch: Live. Click to turn off.");
  });

  it("accepts numbers as variables", () => {
    expect(translate("en", "switchProfile", { name: 2 })).toBe("Switch to 2");
  });

  it("leaves an unsupplied placeholder visible rather than blanking it", () => {
    expect(translate("en", "signedInAs")).toBe("Signed in as {user}");
    expect(translate("en", "signedInAs", { other: "x" })).toBe("Signed in as {user}");
  });

  it("falls back to English for an unknown locale", () => {
    // @ts-expect-error deliberately outside the Locale union
    expect(translate("de", "settings")).toBe("Settings");
  });

  it("makeTranslator binds the locale", () => {
    const t = makeTranslator("es");
    expect(t("done")).toBe("Listo");
    expect(t("switchProfile", { name: "Segundo" })).toBe("Cambiar a Segundo");
  });
});
