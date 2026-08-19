"use client";

import {
  PLATFORMS,
  PLATFORM_LABELS,
  type ConnectionStatus,
  type ConnectionState,
  type Platform,
} from "@/lib/types";
import type { TranslationKey, Translator } from "@/lib/i18n";

const STATE_LABELS: Record<ConnectionState, TranslationKey> = {
  disconnected: "stateDisconnected",
  connecting: "stateConnecting",
  live: "stateLive",
  error: "stateError",
  unavailable: "stateUnavailable",
};

/** Renders whatever an adapter said about itself, translated when it's a key. */
export function statusDetail(status: ConnectionStatus, t: Translator): string | undefined {
  if (status.detailKey) return t(status.detailKey, status.detailVars);
  return status.detail;
}

interface Props {
  statuses: Record<Platform, ConnectionStatus>;
  enabled: Record<Platform, boolean>;
  t: Translator;
  onToggle: (platform: Platform) => void;
}

/**
 * The channel strip. One LED per platform, showing whether that source is
 * actually delivering. Clicking a channel arms or disarms it.
 */
export function StatusBar({ statuses, enabled, t, onToggle }: Props) {
  return (
    <div className="led-strip">
      {PLATFORMS.map((platform) => {
        const status = statuses[platform];
        const state: ConnectionState = enabled[platform] ? status.state : "disconnected";
        const stateLabel = enabled[platform] ? t(STATE_LABELS[state]) : t("stateOff");

        return (
          <button
            key={platform}
            className="led"
            data-state={state}
            data-platform={platform}
            style={{ ["--ch" as string]: `var(--${platform})` }}
            onClick={() => onToggle(platform)}
            title={(enabled[platform] ? statusDetail(status, t) : undefined) ?? stateLabel}
            aria-label={t("toggleChannel", {
              platform: PLATFORM_LABELS[platform],
              state: stateLabel,
              action: enabled[platform] ? t("off") : t("on"),
            })}
          >
            <span className="led-dot" />
            {PLATFORM_LABELS[platform]}
          </button>
        );
      })}
    </div>
  );
}
