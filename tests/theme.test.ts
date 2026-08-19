import { describe, expect, it, beforeEach, vi } from "vitest";
import { applyTheme, resolveTheme, systemPrefersDark, themeBootScript } from "@/lib/theme";
import { STORAGE_KEY } from "@/lib/store";

function mockPrefersDark(dark: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches: query.includes("dark") ? dark : false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

beforeEach(() => {
  vi.unstubAllGlobals();
  delete document.documentElement.dataset.theme;
});

describe("resolveTheme", () => {
  it("passes explicit choices through, ignoring the OS", () => {
    expect(resolveTheme("dark", false)).toBe("dark");
    expect(resolveTheme("light", true)).toBe("light");
  });

  it("follows the OS when set to system", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });
});

describe("systemPrefersDark", () => {
  it("reads the media query", () => {
    mockPrefersDark(true);
    expect(systemPrefersDark()).toBe(true);
    mockPrefersDark(false);
    expect(systemPrefersDark()).toBe(false);
  });
});

describe("applyTheme", () => {
  it("stamps the resolved theme on the document", () => {
    applyTheme("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    applyTheme("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });
});

describe("themeBootScript", () => {
  /** Runs the inline boot script the way the browser would. */
  const run = () => new Function(themeBootScript)();

  it("uses a stored explicit theme", () => {
    mockPrefersDark(true);
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: 1, state: { app: { theme: "light" } } }),
    );
    run();
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("resolves a stored 'system' against the OS", () => {
    mockPrefersDark(true);
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: 1, state: { app: { theme: "system" } } }),
    );
    run();
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("falls back to the OS with nothing stored", () => {
    mockPrefersDark(false);
    run();
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("survives a corrupt blob instead of leaving the page unthemed", () => {
    mockPrefersDark(false);
    localStorage.setItem(STORAGE_KEY, "{not json");
    run();
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("reads the same storage key the store writes", () => {
    expect(themeBootScript).toContain(JSON.stringify(STORAGE_KEY));
  });
});
