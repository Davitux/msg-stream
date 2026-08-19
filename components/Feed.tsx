"use client";

import { EventRow } from "./EventRow";
import type { Translator } from "@/lib/i18n";
import type { Locale, PlatformDisplay, StreamEvent } from "@/lib/types";

interface Props {
  events: StreamEvent[];
  readIds: Record<string, true>;
  locale: Locale;
  platformDisplay: PlatformDisplay;
  bandBackground: boolean;
  t: Translator;
  onToggleRead: (id: string, read: boolean) => void;
  anySourceOn: boolean;
  filtered: boolean;
  hasMore: boolean;
  loadingHistory: boolean;
  onLoadOlder: () => void;
}

export function Feed({
  events,
  readIds,
  locale,
  platformDisplay,
  bandBackground,
  t,
  onToggleRead,
  anySourceOn,
  filtered,
  hasMore,
  loadingHistory,
  onLoadOlder,
}: Props) {
  if (events.length === 0) {
    const [title, body] = !anySourceOn
      ? (["emptyNoSourcesTitle", "emptyNoSourcesBody"] as const)
      : filtered
        ? (["emptyFilteredTitle", "emptyFilteredBody"] as const)
        : (["emptyWaitingTitle", "emptyWaitingBody"] as const);

    return (
      <div className="empty">
        <div className="empty-title">{t(title)}</div>
        <p className="text-sm">{t(body)}</p>
      </div>
    );
  }

  return (
    <div>
      {events.map((event) => (
        <EventRow
          key={event.id}
          event={event}
          read={readIds[event.id] === true}
          locale={locale}
          platformDisplay={platformDisplay}
          bandBackground={bandBackground}
          t={t}
          onToggleRead={onToggleRead}
        />
      ))}

      {/* Older messages are on disk but not in the feed; this pulls the next
          page back rather than loading a whole stream's history up front. */}
      <div className="feed-foot">
        {hasMore ? (
          <button className="btn" onClick={onLoadOlder} disabled={loadingHistory}>
            {loadingHistory ? t("loadingOlder") : t("loadOlder")}
          </button>
        ) : (
          <span className="hint">{t("noOlder")}</span>
        )}
      </div>
    </div>
  );
}
