import { STORAGE_KEY } from "./store";
import type { ResolvedTheme, Theme } from "./types";

/** Turns the stored preference into the theme actually painted. */
export function resolveTheme(theme: Theme, systemPrefersDark: boolean): ResolvedTheme {
  if (theme === "dark" || theme === "light") return theme;
  return systemPrefersDark ? "dark" : "light";
}

export function systemPrefersDark(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

/**
 * The CSS only ever reads an explicit `data-theme`, so "system" is resolved here
 * rather than with a media query in the stylesheet. That keeps one code path for
 * all three settings and lets the boot script below paint the right theme
 * before first paint.
 */
export function applyTheme(resolved: ResolvedTheme) {
  document.documentElement.dataset.theme = resolved;
}

/**
 * Runs before the app hydrates, so a dark-theme user never sees a white flash.
 * Inlined into the document head as a blocking script; keep it small and
 * defensive, since it executes before anything else is guaranteed to exist.
 */
export const themeBootScript = `
(function(){
  try {
    var stored = localStorage.getItem(${JSON.stringify(STORAGE_KEY)});
    var theme = stored ? (JSON.parse(stored).state || {}).app?.theme : null;
    if (theme !== "dark" && theme !== "light") {
      theme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    document.documentElement.dataset.theme = theme;
  } catch (e) {
    document.documentElement.dataset.theme = "dark";
  }
})();
`.trim();
