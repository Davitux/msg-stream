"use client";

import { useEffect, useState } from "react";
import { selectActiveProfile, useStore } from "@/lib/store";
import { getMessageStore, type StorageEstimate } from "@/lib/messages";
import { LOCALE_LABELS } from "@/lib/i18n";
import { useT } from "@/lib/useT";
import { beginTwitchLogin } from "@/lib/adapters/twitch";
import { statusDetail } from "./StatusBar";
import { SecretInput } from "./SecretInput";
import {
  LOCALE_PREFERENCES,
  PLATFORM_LABELS,
  THEMES,
  type CaptureMode,
  type ConnectionStatus,
  type LocalePreference,
  type Platform,
  type PlatformDisplay,
  type Theme,
} from "@/lib/types";
import type { TranslationKey, Translator } from "@/lib/i18n";

interface Props {
  open: boolean;
  onClose: () => void;
  statuses: Record<Platform, ConnectionStatus>;
}

const THEME_LABELS: Record<Theme, TranslationKey> = {
  system: "themeSystem",
  dark: "themeDark",
  light: "themeLight",
};

function Segment<T extends string | number | boolean>({
  value,
  options,
  label,
  onChange,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  label: string;
  onChange: (value: T) => void;
}) {
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <div className="segment" role="group" aria-label={label}>
        {options.map((option) => (
          <button
            key={String(option.value)}
            type="button"
            aria-pressed={value === option.value}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Panel({
  platform,
  enabled,
  onToggle,
  status,
  t,
  children,
}: {
  platform: Platform;
  enabled: boolean;
  onToggle: () => void;
  status: ConnectionStatus;
  t: Translator;
  children: React.ReactNode;
}) {
  const detail = statusDetail(status, t);
  return (
    <section
      className="panel-card"
      data-platform={platform}
      style={{ ["--ch" as string]: `var(--${platform})` }}
    >
      <div className="panel-head">
        <h3 className="panel-title">{PLATFORM_LABELS[platform]}</h3>
        <button
          className="switch"
          aria-pressed={enabled}
          aria-label={t("toggleChannel", {
            platform: PLATFORM_LABELS[platform],
            state: "",
            action: enabled ? t("off") : t("on"),
          })}
          onClick={onToggle}
        />
      </div>
      {children}
      {enabled && status.state === "error" && detail && (
        <p className="hint" style={{ color: "var(--danger)" }}>
          {detail}
        </p>
      )}
    </section>
  );
}

const RETENTION_CHOICES = [7, 30, 90, 0];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

/**
 * Everything about what's kept on disk: how long, how much room it takes, and
 * how to throw it away.
 */
function HistoryPanel({ t, profileName }: { t: Translator; profileName: string }) {
  const capture = useStore((s) => s.app.capture);
  const setCapture = useStore((s) => s.setCapture);
  const historyDays = useStore((s) => s.app.historyDays);
  const setHistoryDays = useStore((s) => s.setHistoryDays);
  const activeProfileId = useStore((s) => s.activeProfileId);
  const clearHistory = useStore((s) => s.clearHistory);

  const [estimate, setEstimate] = useState<StorageEstimate | null>(null);
  const [stored, setStored] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const store = getMessageStore();
      const [usage, count] = await Promise.all([
        store.estimate(),
        store.countFor(activeProfileId),
      ]);
      if (!cancelled) {
        setEstimate(usage);
        setStored(count);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeProfileId]);

  return (
    <section className="panel-card">
      <div className="panel-head">
        <h3 className="panel-title">{t("history")}</h3>
      </div>

      <Segment<CaptureMode>
        label={t("capture")}
        value={capture}
        options={[
          { value: "paid", label: t("capturePaid") },
          { value: "all", label: t("captureAll") },
        ]}
        onChange={setCapture}
      />
      <p className="hint">{capture === "paid" ? t("capturePaidNote") : t("captureAllNote")}</p>

      {/* Retention only governs chat, so it has nothing to do while chat is
          being ignored outright. */}
      {capture === "all" && (
        <>
          <Segment<number>
            label={t("historyKept")}
            value={historyDays}
            options={RETENTION_CHOICES.map((days) => ({
              value: days,
              label: days === 0 ? t("historyForever") : t("historyDaysValue", { days }),
            }))}
            onChange={setHistoryDays}
          />
          <p className="hint">{t("historyPaidNote")}</p>
        </>
      )}

      <p className="hint">
        {stored !== null && <>{t("storedMessages", { count: stored })}. </>}
        {estimate && estimate.quota > 0
          ? t("storageUsed", {
              used: formatBytes(estimate.usage),
              total: formatBytes(estimate.quota),
            })
          : t("storageUnknown")}
      </p>
      <p className="hint">
        {estimate?.persisted ? t("storagePersisted") : t("storageBestEffort")}
      </p>

      <button
        className="btn mt-2"
        style={confirming ? { color: "var(--danger)" } : undefined}
        onClick={() => {
          if (!confirming) return setConfirming(true);
          void clearHistory().then(() => {
            setConfirming(false);
            setStored(0);
          });
        }}
      >
        {confirming ? t("clearHistoryConfirm", { name: profileName }) : t("clearHistory")}
      </button>
    </section>
  );
}

export function SettingsDrawer({ open, onClose, statuses }: Props) {
  const t = useT();
  const app = useStore((s) => s.app);
  const profiles = useStore((s) => s.profiles);
  const profile = useStore(selectActiveProfile);
  const setLocale = useStore((s) => s.setLocale);
  const setTheme = useStore((s) => s.setTheme);
  const setPlatformDisplay = useStore((s) => s.setPlatformDisplay);
  const setBandBackground = useStore((s) => s.setBandBackground);
  const setTwitchClientId = useStore((s) => s.setTwitchClientId);
  const updateProfile = useStore((s) => s.updateProfile);
  const addProfile = useStore((s) => s.addProfile);
  const renameProfile = useStore((s) => s.renameProfile);
  const deleteProfile = useStore((s) => s.deleteProfile);
  const setActiveProfile = useStore((s) => s.setActiveProfile);

  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const toggle = (platform: Platform) =>
    updateProfile({ enabled: { ...profile.enabled, [platform]: !profile.enabled[platform] } });

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        className="absolute inset-0 bg-black/60"
        aria-label={t("closeSettings")}
        onClick={onClose}
      />
      <aside
        className="relative w-full max-w-md overflow-y-auto border-l p-5"
        style={{ background: "var(--ink)", borderColor: "var(--line)" }}
        aria-label={t("settings")}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="wordmark">{t("settings")}</h2>
          <button className="btn" onClick={onClose}>
            {t("done")}
          </button>
        </div>

        {/* --- Appearance --- */}
        <section className="panel-card">
          <div className="panel-head">
            <h3 className="panel-title">{t("appearance")}</h3>
          </div>
          <Segment<LocalePreference>
            label={t("language")}
            value={app.locale}
            options={LOCALE_PREFERENCES.map((l) => ({
              value: l,
              label: l === "system" ? t("localeSystem") : LOCALE_LABELS[l],
            }))}
            onChange={setLocale}
          />
          <Segment<Theme>
            label={t("theme")}
            value={app.theme}
            options={THEMES.map((th) => ({ value: th, label: t(THEME_LABELS[th]) }))}
            onChange={setTheme}
          />
          <Segment<PlatformDisplay>
            label={t("sourceLabel")}
            value={app.platformDisplay}
            options={[
              { value: "name", label: t("sourceLabelName") },
              { value: "mark", label: t("sourceLabelMark") },
            ]}
            onChange={setPlatformDisplay}
          />
          <p className="hint">{t("sourceLabelNote")}</p>
          <Segment<boolean>
            label={t("bandBackground")}
            value={app.bandBackground}
            options={[
              { value: false, label: t("bandBackgroundOff") },
              { value: true, label: t("bandBackgroundOn") },
            ]}
            onChange={setBandBackground}
          />
          <p className="hint">{t("bandBackgroundNote")}</p>
        </section>

        {/* --- Profiles --- */}
        <section className="panel-card">
          <div className="panel-head">
            <h3 className="panel-title">{t("profiles")}</h3>
          </div>

          {profiles.map((p) => (
            <div className="profile-row" key={p.id}>
              <button
                className="profile-pick"
                aria-current={p.id === profile.id}
                aria-label={t("switchProfile", { name: p.name })}
                onClick={() => {
                  setActiveProfile(p.id);
                  setConfirmingDelete(false);
                }}
              >
                {p.name}
              </button>
            </div>
          ))}

          <button
            className="btn mb-3"
            onClick={() => {
              addProfile(t("newProfileName"));
              setConfirmingDelete(false);
            }}
          >
            + {t("addProfile")}
          </button>

          <label className="field">
            <span className="field-label">{t("profileName")}</span>
            <input
              className="input"
              value={profile.name}
              aria-label={t("profileName")}
              onChange={(e) => renameProfile(profile.id, e.target.value)}
            />
          </label>

          {profiles.length > 1 ? (
            <button
              className="btn"
              style={confirmingDelete ? { color: "var(--danger)" } : undefined}
              onClick={() => {
                if (confirmingDelete) {
                  deleteProfile(profile.id);
                  setConfirmingDelete(false);
                } else {
                  setConfirmingDelete(true);
                }
              }}
            >
              {confirmingDelete
                ? t("deleteProfileConfirm", { name: profile.name })
                : t("deleteProfile")}
            </button>
          ) : (
            <p className="hint">{t("lastProfile")}</p>
          )}
        </section>

        <HistoryPanel t={t} profileName={profile.name} />

        {/* --- Twitch --- */}
        <Panel
          platform="twitch"
          enabled={profile.enabled.twitch}
          onToggle={() => toggle("twitch")}
          status={statuses.twitch}
          t={t}
        >
          <label className="field">
            <span className="field-label">{t("channelToRead")}</span>
            <input
              className="input"
              placeholder={t("channelPlaceholder")}
              value={profile.twitch.channel}
              onChange={(e) =>
                updateProfile({ twitch: { ...profile.twitch, channel: e.target.value.trim() } })
              }
            />
          </label>
          <label className="field">
            <span className="field-label">{t("clientId")}</span>
            <input
              className="input"
              placeholder={t("clientIdPlaceholder")}
              value={app.twitchClientId}
              onChange={(e) => setTwitchClientId(e.target.value.trim())}
            />
          </label>
          {/* Outside the <label>: a hint is not part of the field's name. */}
          <p className="hint mb-3">{t("twitchClientIdShared")}</p>
          {profile.twitch.accessToken ? (
            <div className="flex flex-wrap items-center gap-3">
              <span className="hint" style={{ marginTop: 0 }}>
                {t("signedInAs", { user: profile.twitch.userLogin ?? "" })}
              </span>
              <button
                className="btn"
                onClick={() =>
                  updateProfile({
                    twitch: {
                      ...profile.twitch,
                      accessToken: undefined,
                      userId: undefined,
                      userLogin: undefined,
                    },
                  })
                }
              >
                {t("signOut")}
              </button>
            </div>
          ) : (
            <button
              className="btn btn-primary"
              disabled={!app.twitchClientId}
              onClick={() => beginTwitchLogin(app.twitchClientId)}
            >
              {t("signInWithTwitch")}
            </button>
          )}
          <p className="hint">{t("twitchHint")}</p>
        </Panel>

        {/* --- YouTube --- */}
        <Panel
          platform="youtube"
          enabled={profile.enabled.youtube}
          onToggle={() => toggle("youtube")}
          status={statuses.youtube}
          t={t}
        >
          <label className="field">
            <span className="field-label">{t("videoIdOrUrl")}</span>
            <input
              className="input"
              placeholder={t("videoPlaceholder")}
              value={profile.youtube.video}
              onChange={(e) =>
                updateProfile({ youtube: { ...profile.youtube, video: e.target.value.trim() } })
              }
            />
          </label>
          <SecretInput
            label={t("apiKey")}
            placeholder={t("apiKeyPlaceholder")}
            value={profile.youtube.apiKey}
            t={t}
            onChange={(apiKey) => updateProfile({ youtube: { ...profile.youtube, apiKey } })}
          />
          <p className="hint">{t("youtubeHint")}</p>
        </Panel>

        {/* --- Kick --- */}
        <Panel
          platform="kick"
          enabled={profile.enabled.kick}
          onToggle={() => toggle("kick")}
          status={statuses.kick}
          t={t}
        >
          <label className="field">
            <span className="field-label">{t("channelSlug")}</span>
            <input
              className="input"
              placeholder={t("channelPlaceholder")}
              value={profile.kick.channel}
              onChange={(e) =>
                updateProfile({ kick: { ...profile.kick, channel: e.target.value.trim() } })
              }
            />
          </label>
          <label className="field">
            <span className="field-label">{t("chatroomId")}</span>
            <input
              className="input"
              inputMode="numeric"
              placeholder="123456"
              value={profile.kick.chatroomId}
              onChange={(e) =>
                updateProfile({ kick: { ...profile.kick, chatroomId: e.target.value.trim() } })
              }
            />
          </label>
          <label className="field">
            <span className="field-label">{t("kickChannelId")}</span>
            <input
              className="input"
              inputMode="numeric"
              placeholder="123456"
              value={profile.kick.channelId ?? ""}
              onChange={(e) =>
                updateProfile({ kick: { ...profile.kick, channelId: e.target.value.trim() } })
              }
            />
          </label>
          <p className="hint">{t("kickChannelIdHint")}</p>
          <p className="hint">{t("kickHint")}</p>
          {/* The lookup only works as a real navigation, so this is a link the
              user clicks rather than something the app can fetch. */}
          <p className="hint">
            {profile.kick.channel ? (
              <a
                href={`https://kick.com/api/v2/channels/${encodeURIComponent(profile.kick.channel)}`}
                target="_blank"
                rel="noreferrer"
              >
                {t("kickOpenLookup", { slug: profile.kick.channel })}
              </a>
            ) : (
              t("kickNeedSlugFirst")
            )}
          </p>
        </Panel>

        {/* --- Streamlabs --- */}
        <Panel
          platform="streamlabs"
          enabled={profile.enabled.streamlabs}
          onToggle={() => toggle("streamlabs")}
          status={statuses.streamlabs}
          t={t}
        >
          <SecretInput
            label={t("slSocketToken")}
            placeholder={t("slTokenPlaceholder")}
            value={profile.streamlabs.socketToken}
            t={t}
            onChange={(socketToken) => updateProfile({ streamlabs: { socketToken } })}
          />
          <p className="hint">{t("slHint")}</p>
        </Panel>

        {/* --- StreamElements --- */}
        <Panel
          platform="streamelements"
          enabled={profile.enabled.streamelements}
          onToggle={() => toggle("streamelements")}
          status={statuses.streamelements}
          t={t}
        >
          <SecretInput
            label={t("seToken")}
            placeholder={t("seTokenPlaceholder")}
            value={profile.streamelements.token}
            t={t}
            onChange={(token) =>
              updateProfile({ streamelements: { ...profile.streamelements, token } })
            }
          />
          <Segment<"jwt" | "apikey">
            label={t("seMethod")}
            value={profile.streamelements.method}
            options={[
              { value: "jwt", label: t("seMethodJwt") },
              { value: "apikey", label: t("seMethodApikey") },
            ]}
            onChange={(method) =>
              updateProfile({ streamelements: { ...profile.streamelements, method } })
            }
          />
          <p className="hint">{t("seHint")}</p>
        </Panel>

        {/* --- Ceneka --- */}
        <Panel
          platform="ceneka"
          enabled={profile.enabled.ceneka}
          onToggle={() => toggle("ceneka")}
          status={statuses.ceneka}
          t={t}
        >
          <p className="hint" style={{ marginTop: 0 }}>
            {t("cenekaHint")}
          </p>
        </Panel>

      </aside>
    </div>
  );
}
