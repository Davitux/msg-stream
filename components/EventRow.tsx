"use client";

import { memo } from "react";
import { MessageText } from "./MessageText";
import { PlatformTag } from "./PlatformTag";
import { formatGapDuration, gapOf } from "@/lib/gaps";
import { formatAmount } from "@/lib/money";
import { contrastInk, tierColor } from "@/lib/tiers";
import { PLATFORM_LABELS, type Locale, type PlatformDisplay, type StreamEvent } from "@/lib/types";
import type { Translator } from "@/lib/i18n";

/** Locale-aware clock, memoized per locale rather than rebuilt on every row. */
const timeFormatters = new Map<string, Intl.DateTimeFormat>();
function timeFormatter(locale: Locale) {
  let formatter = timeFormatters.get(locale);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    timeFormatters.set(locale, formatter);
  }
  return formatter;
}

interface Props {
  event: StreamEvent;
  read: boolean;
  locale: Locale;
  platformDisplay: PlatformDisplay;
  bandBackground: boolean;
  t: Translator;
  onToggleRead: (id: string, read: boolean) => void;
}

function EventRowImpl({
  event,
  read,
  locale,
  platformDisplay,
  bandBackground,
  t,
  onToggleRead,
}: Props) {
  const gap = gapOf(event);
  if (gap) {
    const clock = timeFormatter(locale);
    return (
      <div className="row" data-kind="system">
        <div>
          <span className="gap-title">
            {t("gapTitle", { duration: formatGapDuration(gap.to - gap.from) })}
          </span>
          <div className="gap-body">
            {t(gap.platform ? "gapBodyPlatform" : "gapBody", {
              platform: gap.platform ? PLATFORM_LABELS[gap.platform] : "",
              from: clock.format(gap.from),
              to: clock.format(gap.to),
            })}
          </div>
        </div>
      </div>
    );
  }

  const tip = event.amount !== undefined;
  // 0 when the source reports no band, which keeps those rows neutral rather
  // than showing them as if they were the smallest possible donation.
  // The platform's own colour for this band, where it publishes one. Sources
  // that don't stay plain rather than being tinted a colour nobody chose.
  const bandColor = tierColor(event.platform, event.amount);

  return (
    <div
      className="row"
      data-read={read}
      data-tip={tip}
      data-banded={bandColor ? "true" : undefined}
      data-band-bg={bandColor && bandBackground ? "true" : undefined}
      data-platform={event.platform}
      style={{
        ["--ch" as string]: `var(--${event.platform})`,
        ...(bandColor
          ? {
              ["--band" as string]: bandColor,
              // Ink is derived per colour: no single one reads on both the
              // pale yellow band and the deep red one.
              ["--band-ink" as string]: contrastInk(bandColor),
            }
          : {}),
      }}
    >
      <div className="row-rail" />

      <div className="min-w-0">
        <div className="row-head">
          <PlatformTag platform={event.platform} display={platformDisplay} />
          <span className="row-author">{event.author.name}</span>
          {/* Only when there's no amount — otherwise "1 sub" already says it. */}
          {event.kind === "subscription" && !event.amount && (
            <span className="kind-tag">{t("subTag")}</span>
          )}
          {/* Beside the name rather than on its own line: with paid-only capture
              every row carries an amount, so a dedicated line for it costs a
              line on every message in the feed. */}
          {event.amount && (
            <span className="amount">{formatAmount(event.amount, locale)}</span>
          )}
          <span className="row-time">{timeFormatter(locale).format(event.timestamp)}</span>
        </div>

        {event.message && (
          <div className="row-message">
            <MessageText text={event.message} />
          </div>
        )}
      </div>

      <button
        className="readbtn"
        aria-pressed={read}
        aria-label={read ? t("markUnread") : t("markRead")}
        title={read ? t("markUnread") : t("markRead")}
        onClick={() => onToggleRead(event.id, !read)}
      >
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path
            d="M3.5 8.5l3 3 6-7"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  );
}

/**
 * Memoized on identity: a busy chat re-renders the list often, and rows only
 * change when their own read state flips.
 */
export const EventRow = memo(EventRowImpl);
