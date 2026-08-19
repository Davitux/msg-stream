"use client";

import { useMemo } from "react";
import { useStore } from "./store";
import { makeTranslator, resolveLocale, type Translator } from "./i18n";
import type { Locale } from "./types";

/**
 * The language actually in use, with "system" already resolved against the
 * browser. Everything that renders text or formats a number wants this rather
 * than the raw preference.
 */
export function useLocale(): Locale {
  const preference = useStore((s) => s.app.locale);
  return useMemo(() => resolveLocale(preference), [preference]);
}

/** Translator bound to the language in use. */
export function useT(): Translator {
  const locale = useLocale();
  return useMemo(() => makeTranslator(locale), [locale]);
}
