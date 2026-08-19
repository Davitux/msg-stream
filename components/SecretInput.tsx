"use client";

import { useEffect, useState } from "react";
import type { Translator } from "@/lib/i18n";

/**
 * How long a revealed value stays visible.
 *
 * Long enough to read a token off the screen and compare it, short enough that
 * one cannot be left exposed by walking away — which matters here, because the
 * person using this is often live on camera.
 */
export const REVEAL_MS = 10_000;

interface Props {
  label: string;
  value: string;
  placeholder?: string;
  t: Translator;
  onChange: (value: string) => void;
}

/**
 * A credential field: masked by default, revealable on purpose, and never left
 * revealed. It hides again on a timer, and because the settings drawer unmounts
 * when it closes, it also starts masked every time it is reopened.
 *
 * Masking is shoulder-surfing protection, not security — the value is still in
 * localStorage. That is exactly the threat worth covering for a streamer whose
 * screen may be on air.
 */
export function SecretInput({ label, value, placeholder, t, onChange }: Props) {
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    if (!revealed) return;
    const timer = setTimeout(() => setRevealed(false), REVEAL_MS);
    return () => clearTimeout(timer);
  }, [revealed]);

  return (
    <div className="field">
      <label className="secret">
        <span className="field-label">{label}</span>
        <input
          className="input"
          type={revealed ? "text" : "password"}
          placeholder={placeholder}
          value={value}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => onChange(event.target.value.trim())}
        />
      </label>
      <button
        type="button"
        className="secret-toggle"
        aria-pressed={revealed}
        aria-label={revealed ? t("hideValue") : t("showValue")}
        title={revealed ? t("hideValue") : t("showValue")}
        onClick={() => setRevealed((on) => !on)}
      >
        {revealed ? t("hideValue") : t("showValue")}
      </button>
    </div>
  );
}
