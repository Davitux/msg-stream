import type { TranslationKey, TranslationVars } from "./i18n";

export const PLATFORMS = [
  "youtube",
  "twitch",
  "kick",
  "streamlabs",
  "streamelements",
  "ceneka",
] as const;

export type Platform = (typeof PLATFORMS)[number];

export type EventKind = "chat" | "tip" | "subscription" | "system";

/** The languages the interface is actually written in. */
export const LOCALES = ["en", "es"] as const;
export type Locale = (typeof LOCALES)[number];

/**
 * What the user picked. "system" follows the browser and keeps following it,
 * the same way the theme setting follows the OS.
 */
export const LOCALE_PREFERENCES = ["system", ...LOCALES] as const;
export type LocalePreference = (typeof LOCALE_PREFERENCES)[number];

/**
 * What the app takes in. "paid" drops ordinary chat at the door — it is never
 * rendered and never stored — which is the default because the messages worth
 * acting on are the ones carrying money.
 */
/**
 * How a message row names its source. "name" spells it out; "mark" uses a
 * compact colour-coded badge, which is denser once you know the colours.
 *
 * Deliberately not the platforms' own logos: those are trademarks, each with
 * brand guidelines attached, and a redrawn approximation would be both a
 * derivative of the mark and visibly wrong. See README.md for how to drop in
 * official assets if you want them.
 */
export const PLATFORM_DISPLAYS = ["name", "mark"] as const;
export type PlatformDisplay = (typeof PLATFORM_DISPLAYS)[number];

/** Short codes for the compact mark. Distinct at a glance, two letters each. */
export const PLATFORM_MARKS: Record<Platform, string> = {
  youtube: "YT",
  twitch: "TW",
  kick: "KI",
  streamlabs: "SL",
  streamelements: "SE",
  ceneka: "CE",
};

export const CAPTURE_MODES = ["paid", "all"] as const;
export type CaptureMode = (typeof CAPTURE_MODES)[number];

export const THEMES = ["system", "dark", "light"] as const;
export type Theme = (typeof THEMES)[number];
/** What actually gets painted, once "system" has been resolved. */
export type ResolvedTheme = "dark" | "light";

/**
 * A monetary value in its *native* unit. Bits stay bits, Kicks stay Kicks,
 * ARS stays ARS. See lib/money.ts — we format, we never convert.
 */
export interface Amount {
  /** 5.00 for a $5 Super Chat, 1000 for a 1000-bit cheer. */
  value: number;
  /** ISO 4217 ("USD", "ARS") or a native unit ("BITS", "KICKS", "SUBS"). */
  currency: string;
  /** The platform's own rendering, when it supplies one (e.g. "$5.00"). */
  display?: string;
  /**
   * The source's own significance band, 1 being the smallest — YouTube's Super
   * Chat colour, for instance. Absent when a source reports none.
   */
  tier?: number;
  /**
   * How many bands that source has, when known — informational, and the hook
   * for normalising across sources should that ever be needed.
   */
  tierMax?: number;
}

export interface Author {
  name: string;
  avatarUrl?: string;
  /** Platform-supplied display colour, e.g. Twitch's per-user chat colour. */
  color?: string;
}

export interface StreamEvent {
  /** `${platform}:${nativeId}` — stable across reconnects; dedupe + read-state key. */
  id: string;
  platform: Platform;
  kind: EventKind;
  author: Author;
  message: string;
  /** Present on tips / Super Chats / cheers / gifted subs. */
  amount?: Amount;
  /** Epoch millis. */
  timestamp: number;
  /** Original payload, kept for debugging and for features we haven't built yet. */
  raw: unknown;
}

export type ConnectionState =
  | "disconnected"
  | "connecting"
  | "live"
  | "error"
  | "unavailable";

export interface ConnectionStatus {
  state: ConnectionState;
  /**
   * Adapters report *why* through a translation key so the message follows the
   * chosen language. `detail` is the escape hatch for text that comes back from
   * a platform's API, which we can't translate and shouldn't invent.
   */
  detailKey?: TranslationKey;
  detailVars?: TranslationVars;
  detail?: string;
}

export type EventSink = (event: StreamEvent) => void;
export type StatusSink = (status: ConnectionStatus) => void;

/**
 * Where an adapter left off, so it can pick up again after a reload.
 * Opaque to everything except the adapter that wrote it.
 */
export type Cursor = Record<string, unknown>;
export type CursorSink = (cursor: Cursor | null) => void;

/**
 * Every platform integration implements this. Adapters own all platform-specific
 * mess (auth, transports, payload shapes) and emit normalized StreamEvents.
 */
export interface SourceAdapter<TConfig = unknown> {
  platform: Platform;
  /**
   * `resume` is whatever this adapter last reported through `onCursor`, or null
   * on a first run. Adapters that cannot resume ignore both — see the resume
   * table in README.md for which can.
   */
  connect(
    config: TConfig,
    onEvent: EventSink,
    onStatus: StatusSink,
    onCursor?: CursorSink,
    resume?: Cursor | null,
  ): Promise<void>;
  disconnect(): void;
}

/* ------------------------------------------------------------------ */
/* Per-platform settings                                                */
/* ------------------------------------------------------------------ */

export interface TwitchSettings {
  /** Channel login name to read, e.g. "somestreamer". */
  channel: string;
  /** Implicit-grant access token. Short-lived, no refresh token. */
  accessToken?: string;
  /** The authenticated user, resolved after login. */
  userId?: string;
  userLogin?: string;
}

/** The client ID lives at app level, so the adapter gets it merged in. */
export type TwitchConnectConfig = TwitchSettings & { clientId: string };

export interface YouTubeSettings {
  /** Video id or full URL of the live broadcast. */
  video: string;
  /** The streamer's own YouTube Data API v3 key (quota is per-key). */
  apiKey: string;
}

export interface KickSettings {
  /** Channel slug, e.g. "somestreamer". Used for display only. */
  channel: string;
  /**
   * The numeric chatroom id the chat socket subscribes to.
   *
   * Entered by hand because it cannot be looked up: the only endpoint that
   * returns it refuses browser requests (no CORS) and server requests (bot
   * protection). It is stable per channel, so this is a one-time paste.
   */
  chatroomId: string;
  /**
   * Optional channel id, which carries subscription and gift events. Chat
   * arrives without it.
   */
  channelId?: string;
}

export interface StreamlabsSettings {
  /** Account Settings → API Settings → API Tokens → "Your Socket API Token". */
  socketToken: string;
}

export interface StreamElementsSettings {
  /** A JWT from the dashboard, or an overlay token when using `apikey`. */
  token: string;
  method: "jwt" | "apikey";
}

export interface CenekaSettings {
  /**
   * Nothing to configure. Ceneka has no realtime API of its own and delivers
   * donations through Streamlabs or StreamElements, so the panel is a signpost
   * to those sources rather than a channel that can connect.
   */
  token?: string;
}

/* ------------------------------------------------------------------ */
/* Profiles                                                             */
/* ------------------------------------------------------------------ */

/**
 * One set of channels a streamer switches between. Everything tied to a
 * particular channel lives here; anything tied to the deployment or the person
 * using it lives in AppSettings.
 */
export interface Profile {
  id: string;
  name: string;
  enabled: Record<Platform, boolean>;
  twitch: TwitchSettings;
  youtube: YouTubeSettings;
  kick: KickSettings;
  streamlabs: StreamlabsSettings;
  streamelements: StreamElementsSettings;
  ceneka: CenekaSettings;
}

export interface AppSettings {
  locale: LocalePreference;
  theme: Theme;
  /**
   * A property of the deployment's Twitch app registration rather than of any
   * one channel, so it is shared by every profile.
   */
  twitchClientId: string;
  /** Whether ordinary chat is taken in at all. */
  capture: CaptureMode;
  /** How a message row names its source. */
  platformDisplay: PlatformDisplay;
  /**
   * Whether a banded donation also tints its whole row. Off by default: the
   * amount already carries the colour, and tinting every row as well makes a
   * busy feed loud.
   */
  bandBackground: boolean;
  /**
   * How many days of ordinary chat to keep. Paid messages are never pruned.
   * 0 keeps everything. Only bites when `capture` is "all".
   */
  historyDays: number;
}

export const PLATFORM_LABELS: Record<Platform, string> = {
  youtube: "YouTube",
  twitch: "Twitch",
  kick: "Kick",
  streamlabs: "Streamlabs",
  streamelements: "StreamElements",
  ceneka: "Ceneka",
};

export function createProfile(name: string, id?: string): Profile {
  return {
    id: id ?? `p_${Math.random().toString(36).slice(2, 10)}`,
    name,
    enabled: {
      youtube: false,
      twitch: false,
      kick: false,
      streamlabs: false,
      streamelements: false,
      ceneka: false,
    },
    twitch: { channel: "" },
    youtube: { video: "", apiKey: "" },
    kick: { channel: "", chatroomId: "" },
    streamlabs: { socketToken: "" },
    streamelements: { token: "", method: "jwt" },
    ceneka: {},
  };
}
