import { fromMicros } from "../money";
import type {
  ConnectionStatus,
  Cursor,
  CursorSink,
  EventSink,
  Platform,
  SourceAdapter,
  StatusSink,
  StreamEvent,
  YouTubeSettings,
} from "../types";

const API = "https://www.googleapis.com/youtube/v3";

/**
 * Note the path: the resource is `liveChatMessages` but the endpoint is
 * `liveChat/messages`. Getting this wrong returns a 404 with an HTML body,
 * which then fails to parse as JSON and looks like a network outage rather
 * than a bad URL.
 */
const LIVE_CHAT_MESSAGES = `${API}/liveChat/messages`;

/**
 * Never poll faster than this regardless of what the API suggests. The daily
 * quota is 10,000 units per key and each poll costs several, so an aggressive
 * interval burns a streamer's whole day in a couple of hours.
 */
const MIN_POLL_MS = 4000;

/** Accepts a bare video id, a watch URL, a youtu.be link, or a /live/ URL. */
export function parseVideoId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (/^[\w-]{11}$/.test(trimmed)) return trimmed;

  try {
    const url = new URL(trimmed);
    const v = url.searchParams.get("v");
    if (v) return v;
    const parts = url.pathname.split("/").filter(Boolean);
    const last = parts[parts.length - 1];
    if (last && /^[\w-]{11}$/.test(last)) return last;
  } catch {
    // Not a URL; fall through.
  }
  return null;
}

interface VideosResponse {
  items?: Array<{ liveStreamingDetails?: { activeLiveChatId?: string } }>;
}

interface ChatResponse {
  items?: LiveChatMessage[];
  nextPageToken?: string;
  pollingIntervalMillis?: number | string;
}

interface LiveChatMessage {
  id: string;
  snippet: {
    type: string;
    publishedAt: string;
    displayMessage?: string;
    textMessageDetails?: { messageText: string };
    superChatDetails?: {
      amountMicros: string;
      currency: string;
      amountDisplayString: string;
      userComment?: string;
      /** YouTube's colour band. It publishes no maximum, so none is claimed. */
      tier?: number;
    };
    superStickerDetails?: {
      amountMicros: string;
      currency: string;
      amountDisplayString: string;
      superStickerMetadata?: { altText?: string };
      tier?: number;
    };
    membershipGiftingDetails?: { giftMembershipsCount?: number; giftMembershipsLevelName?: string };
    newSponsorDetails?: { memberLevelName?: string };
  };
  authorDetails: {
    displayName: string;
    profileImageUrl: string;
  };
}

/** What YouTube needs to carry on from where it stopped. */
export interface YouTubeCursor extends Cursor {
  videoId: string;
  liveChatId: string;
  pageToken?: string;
}

/** A stored cursor is only usable if it belongs to the video being watched. */
export function usableCursor(
  resume: Cursor | null | undefined,
  videoId: string,
): YouTubeCursor | null {
  const cursor = resume as YouTubeCursor | null | undefined;
  if (!cursor?.liveChatId || cursor.videoId !== videoId) return null;
  return cursor;
}

export class YouTubeAdapter implements SourceAdapter<YouTubeSettings> {
  platform: Platform = "youtube";
  private timer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  private pageToken: string | undefined;
  private onCursor: CursorSink = () => {};

  async connect(
    settings: YouTubeSettings,
    onEvent: EventSink,
    onStatus: StatusSink,
    onCursor?: CursorSink,
    resume?: Cursor | null,
  ) {
    this.closed = false;
    this.pageToken = undefined;
    this.onCursor = onCursor ?? (() => {});

    const videoId = parseVideoId(settings.video);
    if (!settings.apiKey) {
      return onStatus({ state: "error", detailKey: "ytNeedApiKey" });
    }
    if (!videoId) {
      return onStatus({ state: "error", detailKey: "ytBadVideo" });
    }

    onStatus({ state: "connecting" });

    // Picking the stored page token back up is what makes a reload lossless:
    // YouTube replays from exactly where the last poll stopped.
    const carried = usableCursor(resume, videoId);
    if (carried) {
      this.pageToken = carried.pageToken;
      onStatus({ state: "live", detailKey: "ytResumed" });
      void this.poll(carried.liveChatId, videoId, settings, onEvent, onStatus);
      return;
    }

    let liveChatId: string;
    try {
      const res = await fetch(
        `${API}/videos?part=liveStreamingDetails&id=${videoId}&key=${settings.apiKey}`,
      );
      const body = await readJson<VideosResponse>(res);
      if (!res.ok) return onStatus(describeError(body, res.status));

      // These three failures look identical in a 200 response but mean very
      // different things, and telling them apart is the difference between
      // "fix your key" and "wait for the stream to start".
      const video = body.items?.[0];
      if (!video) {
        // No such video, or it is private — YouTube returns an empty list for
        // both rather than a 404.
        return onStatus({ state: "error", detailKey: "ytNoSuchVideo" });
      }
      if (!video.liveStreamingDetails) {
        return onStatus({ state: "error", detailKey: "ytNotLive" });
      }
      const id = video.liveStreamingDetails.activeLiveChatId;
      if (!id) {
        return onStatus({ state: "error", detailKey: "ytNoLiveChat" });
      }
      liveChatId = id;
    } catch {
      return onStatus({ state: "error", detailKey: "ytUnreachable" });
    }

    onStatus({ state: "live", detailKey: "ytReading" });
    void this.poll(liveChatId, videoId, settings, onEvent, onStatus);
  }

  disconnect() {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private async poll(
    liveChatId: string,
    videoId: string,
    settings: YouTubeSettings,
    onEvent: EventSink,
    onStatus: StatusSink,
  ) {
    if (this.closed) return;

    const params = new URLSearchParams({
      liveChatId,
      part: "snippet,authorDetails",
      maxResults: "200",
      key: settings.apiKey,
    });
    if (this.pageToken) params.set("pageToken", this.pageToken);

    let nextDelay = MIN_POLL_MS;

    try {
      const res = await fetch(`${LIVE_CHAT_MESSAGES}?${params}`);
      const body = await readJson<ChatResponse>(res);

      if (!res.ok) {
        onStatus(describeError(body, res.status));
        // A rejected page token means the resume point is stale; drop it and
        // start clean rather than retrying something YouTube won't accept.
        if (res.status === 400 && this.pageToken) {
          this.pageToken = undefined;
          this.onCursor(null);
        }
        // Back off hard on quota errors — retrying fast makes it strictly worse.
        nextDelay = isQuotaError(body) ? 60_000 : 15_000;
      } else {
        this.pageToken = body.nextPageToken;
        this.onCursor({ videoId, liveChatId, pageToken: this.pageToken });
        for (const item of body.items ?? []) {
          const event = toStreamEvent(item);
          if (event) onEvent(event);
        }
        // Honour YouTube's own pacing hint; it knows the chat's rate.
        nextDelay = Math.max(MIN_POLL_MS, Number(body.pollingIntervalMillis) || MIN_POLL_MS);
        onStatus({ state: "live", detailKey: "ytReading" });
      }
    } catch {
      onStatus({ state: "error", detailKey: "ytLostContact" });
      nextDelay = 15_000;
    }

    if (this.closed) return;
    this.timer = setTimeout(
      () => void this.poll(liveChatId, videoId, settings, onEvent, onStatus),
      nextDelay,
    );
  }
}

function toStreamEvent(item: LiveChatMessage): StreamEvent | null {
  const s = item.snippet;
  const base = {
    id: `youtube:${item.id}`,
    platform: "youtube" as const,
    author: {
      name: item.authorDetails.displayName,
      avatarUrl: item.authorDetails.profileImageUrl,
    },
    timestamp: Date.parse(s.publishedAt) || Date.now(),
    raw: item,
  };

  switch (s.type) {
    case "textMessageEvent":
      return {
        ...base,
        kind: "chat",
        message: s.textMessageDetails?.messageText ?? s.displayMessage ?? "",
      };

    case "superChatEvent": {
      const d = s.superChatDetails;
      if (!d) return null;
      return {
        ...base,
        kind: "tip",
        message: d.userComment ?? "",
        amount: {
          value: fromMicros(d.amountMicros),
          currency: d.currency,
          display: d.amountDisplayString,
          tier: d.tier,
        },
      };
    }

    case "superStickerEvent": {
      const d = s.superStickerDetails;
      if (!d) return null;
      return {
        ...base,
        kind: "tip",
        message: d.superStickerMetadata?.altText ?? "Super Sticker",
        amount: {
          value: fromMicros(d.amountMicros),
          currency: d.currency,
          display: d.amountDisplayString,
          tier: d.tier,
        },
      };
    }

    case "newSponsorEvent":
      return {
        ...base,
        kind: "subscription",
        message: `Became a member${
          s.newSponsorDetails?.memberLevelName ? ` (${s.newSponsorDetails.memberLevelName})` : ""
        }`,
        amount: { value: 1, currency: "SUBS" },
      };

    case "membershipGiftingEvent": {
      const count = s.membershipGiftingDetails?.giftMembershipsCount ?? 1;
      return {
        ...base,
        kind: "subscription",
        message: `Gifted ${count} membership${count === 1 ? "" : "s"}`,
        amount: { value: count, currency: "SUBS" },
      };
    }

    default:
      // Deletions, bans, poll updates and the like — nothing to show in an inbox.
      return null;
  }
}

/**
 * Reads a response as JSON without letting a non-JSON body throw.
 *
 * Google serves HTML for some failures — a wrong path 404s with a web page —
 * and a parse error thrown from here would surface as a network outage,
 * pointing at the wrong problem entirely.
 */
async function readJson<T>(res: Response): Promise<T> {
  try {
    return await res.json();
  } catch {
    return {
      error: { message: `YouTube returned ${res.status} (unreadable response).` },
    } as T;
  }
}

function isQuotaError(body: unknown): boolean {
  const reason = (body as { error?: { errors?: Array<{ reason?: string }> } })?.error?.errors?.[0]
    ?.reason;
  return reason === "quotaExceeded" || reason === "rateLimitExceeded";
}

export function describeError(body: unknown, status: number): ConnectionStatus {
  const err = (body as { error?: { message?: string; errors?: Array<{ reason?: string }> } })?.error;
  const reason = err?.errors?.[0]?.reason;

  // Quota exhaustion is the failure a streamer will actually hit, and the raw
  // message ("quota exceeded") gives no hint of what to do about it.
  if (reason === "quotaExceeded") return { state: "error", detailKey: "ytQuota" };
  if (reason === "rateLimitExceeded") return { state: "error", detailKey: "ytRateLimited" };
  if (reason === "forbidden" || status === 403) {
    return err?.message
      ? { state: "error", detail: err.message }
      : { state: "error", detailKey: "ytForbidden" };
  }
  if (status === 400) {
    return err?.message
      ? { state: "error", detail: err.message }
      : { state: "error", detailKey: "ytRejected" };
  }
  if (status === 404) return { state: "error", detailKey: "ytChatGone" };
  return { state: "error", detail: err?.message ?? `YouTube returned ${status}.` };
}
