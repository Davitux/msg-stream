"use client";

import { useMemo, useState } from "react";
import { Feed } from "@/components/Feed";
import { StatusBar } from "@/components/StatusBar";
import { SettingsDrawer } from "@/components/SettingsDrawer";
import { countUnread, selectActiveProfile, selectVisibleEvents, useStore } from "@/lib/store";
import { useConnections } from "@/lib/useConnections";
import { useTheme } from "@/lib/useTheme";
import { useT } from "@/lib/useT";
import type { Platform } from "@/lib/types";

export default function Page() {
  const [settingsOpen, setSettingsOpen] = useState(false);

  const hydrated = useStore((s) => s.hydrated);
  const events = useStore((s) => s.events);
  const readIds = useStore((s) => s.readIds);
  const statuses = useStore((s) => s.statuses);
  const filters = useStore((s) => s.filters);
  const locale = useStore((s) => s.app.locale);
  const capture = useStore((s) => s.app.capture);
  const platformDisplay = useStore((s) => s.app.platformDisplay);
  const bandBackground = useStore((s) => s.app.bandBackground);
  const profile = useStore(selectActiveProfile);
  const hasMore = useStore((s) => s.hasMore);
  const loadingHistory = useStore((s) => s.loadingHistory);
  const loadOlder = useStore((s) => s.loadOlder);
  const markRead = useStore((s) => s.markRead);
  const markAllRead = useStore((s) => s.markAllRead);
  const setFilters = useStore((s) => s.setFilters);
  const updateProfile = useStore((s) => s.updateProfile);

  useConnections();
  useTheme();
  const t = useT();

  // Taking in paid only means paid only — including chat already in history
  // from before the setting changed. Otherwise old chat reappears on reload
  // and contradicts the setting.
  const paidOnlyCapture = capture === "paid";
  const effectiveFilters = useMemo(
    () => (paidOnlyCapture ? { ...filters, tipsOnly: true } : filters),
    [filters, paidOnlyCapture],
  );

  const visible = useMemo(
    () => selectVisibleEvents(events, effectiveFilters, readIds),
    [events, effectiveFilters, readIds],
  );

  const unreadCount = useMemo(() => countUnread(events, readIds), [events, readIds]);
  const unreadTips = useMemo(() => countUnread(events, readIds, true), [events, readIds]);

  const anySourceOn = Object.values(profile.enabled).some(Boolean);
  const filtering =
    filters.unreadOnly || filters.tipsOnly || Object.values(filters.platforms).some((v) => !v);

  const toggleSource = (platform: Platform) =>
    updateProfile({ enabled: { ...profile.enabled, [platform]: !profile.enabled[platform] } });

  // Settings and read state come from localStorage, which is only read after
  // mount, so the first paint would otherwise disagree with the server HTML.
  if (!hydrated) {
    return (
      <main className="flex flex-1 items-center justify-center">
        <span className="eyebrow">{t("loading")}</span>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col">
      <header
        className="sticky top-0 z-20 border-b px-4 py-3 backdrop-blur"
        style={{
          background: "color-mix(in srgb, var(--ink) 88%, transparent)",
          borderColor: "var(--line)",
        }}
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <h1 className="wordmark">
            msg<span>·</span>stream
          </h1>
          <div className="flex items-center gap-3">
            <span className="eyebrow" data-testid="active-profile">
              {profile.name}
            </span>
            <button className="btn" onClick={() => setSettingsOpen(true)}>
              {t("settings")}
            </button>
          </div>
        </div>

        <StatusBar
          statuses={statuses}
          enabled={profile.enabled}
          t={t}
          onToggle={toggleSource}
        />

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="counter">
            <b>{unreadCount}</b> {t("unread")}
            {/* With paid-only capture every message is paid, so a count of them
                would just repeat the number to its left. Naming the mode instead
                explains why no chat is arriving. */}
            {paidOnlyCapture ? (
              <>
                {" · "}
                <span className="cash">{t("capturePaid")}</span>
              </>
            ) : (
              unreadTips > 0 && (
                <>
                  {" · "}
                  <span className="cash">
                    {unreadTips} {t("paid")}
                  </span>
                </>
              )
            )}
          </span>

          <div className="ml-auto flex flex-wrap gap-2">
            <button
              className="chip"
              aria-pressed={filters.unreadOnly}
              onClick={() => setFilters({ unreadOnly: !filters.unreadOnly })}
            >
              {t("unreadOnly")}
            </button>
            {/* A dead control is worse than none: with paid-only capture there
                is nothing for this to filter out. */}
            {!paidOnlyCapture && (
              <button
                className="chip"
                aria-pressed={filters.tipsOnly}
                onClick={() => setFilters({ tipsOnly: !filters.tipsOnly })}
              >
                {t("paidOnly")}
              </button>
            )}
            <button className="chip" onClick={markAllRead} disabled={unreadCount === 0}>
              {t("markAllRead")}
            </button>
          </div>
        </div>
      </header>

      <Feed
        events={visible}
        readIds={readIds}
        locale={locale}
        platformDisplay={platformDisplay}
        bandBackground={bandBackground}
        t={t}
        onToggleRead={markRead}
        anySourceOn={anySourceOn}
        filtered={filtering}
        hasMore={hasMore}
        loadingHistory={loadingHistory}
        onLoadOlder={() => void loadOlder()}
      />

      <SettingsDrawer
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        statuses={statuses}
      />
    </main>
  );
}
