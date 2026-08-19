"use client";

import { useMemo } from "react";
import { useStore } from "./store";
import { makeTranslator, type Translator } from "./i18n";

/** Translator bound to the currently selected language. */
export function useT(): Translator {
  const locale = useStore((s) => s.app.locale);
  return useMemo(() => makeTranslator(locale), [locale]);
}
