import { describe, expect, it, vi } from "vitest";
import {
  LOCALE_LABELS,
  detectLocale,
  dictionaries,
  makeTranslator,
  resolveLocale,
  translate,
} from "@/lib/i18n";
import { DEFAULT_APP } from "@/lib/store";
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

describe("following the browser's language", () => {
  it("picks a supported language from the browser's order", () => {
    expect(detectLocale(["es", "en"])).toBe("es");
    expect(detectLocale(["en", "es"])).toBe("en");
  });

  it("matches on the primary subtag, so regional Spanish still counts", () => {
    // An Argentine browser sends es-AR; falling back to English on that
    // technicality would be the whole feature failing for its main audience.
    for (const tag of ["es-AR", "es-419", "es-ES", "ES-ar"]) {
      expect(detectLocale([tag]), tag).toBe("es");
    }
  });

  it("skips languages the interface does not have", () => {
    expect(detectLocale(["pt-BR", "fr", "es-AR"])).toBe("es");
  });

  it("falls back to English when nothing matches", () => {
    expect(detectLocale(["ja", "ko"])).toBe("en");
    expect(detectLocale([])).toBe("en");
  });

  it("passes an explicit choice straight through", () => {
    expect(resolveLocale("es")).toBe("es");
    expect(resolveLocale("en")).toBe("en");
  });

  it("resolves 'system' against the browser", () => {
    vi.stubGlobal("navigator", { languages: ["es-AR", "en"] });
    expect(resolveLocale("system")).toBe("es");

    vi.stubGlobal("navigator", { languages: ["fr"] });
    expect(resolveLocale("system")).toBe("en");
    vi.unstubAllGlobals();
  });

  it("falls back to `language` when `languages` is absent", () => {
    vi.stubGlobal("navigator", { language: "es-ES" });
    expect(resolveLocale("system")).toBe("es");
    vi.unstubAllGlobals();
  });

  it("ships following the browser", () => {
    expect(DEFAULT_APP.locale).toBe("system");
  });
});
