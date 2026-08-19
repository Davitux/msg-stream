/**
 * Turns message text into renderable segments, so links can be clicked without
 * selecting and copying them.
 *
 * Chat messages are untrusted input from strangers, so this never produces HTML:
 * it returns data that the UI renders as React elements, which escape text by
 * construction. There is deliberately no `dangerouslySetInnerHTML` anywhere in
 * this path.
 */

export type MessageSegment =
  | { type: "text"; value: string }
  /** `text` is what the reader sees; `href` is where it goes. */
  | { type: "link"; value: string; href: string };

/**
 * Bare domains are only linked when they end in one of these. Matching any
 * `word.word` would turn "node.js", "index.php" and "etc." into links, so the
 * list is explicit — extend it when a real link gets missed.
 */
const TLDS = [
  // generic
  "com", "net", "org", "info", "biz", "app", "dev", "io", "ai", "gg", "tv",
  "live", "link", "page", "site", "online", "shop", "store", "blog", "news",
  "art", "xyz", "me", "co", "ly", "fm", "to", "cc", "so", "sh", "gl",
  // country codes that actually show up in these chats
  "ar", "es", "mx", "cl", "uy", "py", "bo", "pe", "br", "us", "uk", "ca",
  "de", "fr", "it", "nl", "pt", "pl", "se", "jp", "kr", "au", "nz", "tw",
];

/** A DNS label: 1–63 chars, no leading or trailing hyphen. */
const LABEL = String.raw`[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?`;

const URL_PATTERN = new RegExp(
  [
    // An explicit scheme wins — anything after it is part of the link.
    String.raw`\bhttps?:\/\/[^\s<>"']+`,
    // The classic "www." prefix, with no scheme typed.
    String.raw`\bwww\.[^\s<>"']+`,
    // A bare domain, but only for a known TLD.
    String.raw`\b(?:${LABEL}\.)+(?:${TLDS.join("|")})\b(?:[/?#][^\s<>"']*)?`,
  ].join("|"),
  "gi",
);

/** Messages are short; anything past this is not worth scanning. */
const MAX_SCAN_LENGTH = 4000;

/**
 * Trailing punctuation usually belongs to the sentence, not the URL:
 * "see https://x.com/a." should link without the full stop. Brackets only count
 * as part of the link when they're balanced, which keeps wiki-style URLs intact.
 */
function trimTrailingPunctuation(match: string): string {
  let end = match.length;

  while (end > 0) {
    const char = match[end - 1];

    if (".,;:!?'\"".includes(char)) {
      end -= 1;
      continue;
    }

    if (char === ")" || char === "]") {
      const open = char === ")" ? "(" : "[";
      const slice = match.slice(0, end);
      const opens = slice.split(open).length - 1;
      const closes = slice.split(char).length - 1;
      if (closes > opens) {
        end -= 1;
        continue;
      }
    }

    break;
  }

  return match.slice(0, end);
}

/**
 * Builds the href for a matched string, or null if it isn't safely linkable.
 *
 * Only http and https ever come back. The pattern above can't match a
 * `javascript:` or `data:` URL in the first place, and this is the second lock
 * on that door.
 */
export function toSafeHref(match: string): string | null {
  const candidate = /^https?:\/\//i.test(match) ? match : `https://${match}`;

  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!url.hostname) return null;
    return url.href;
  } catch {
    return null;
  }
}

/**
 * Splits `text` into plain and linkable segments, in order. Text with no links
 * comes back as a single segment, so the common case allocates almost nothing.
 */
export function parseMessageSegments(text: string): MessageSegment[] {
  if (!text) return [];
  if (text.length > MAX_SCAN_LENGTH) return [{ type: "text", value: text }];

  const segments: MessageSegment[] = [];
  let cursor = 0;

  for (const match of text.matchAll(URL_PATTERN)) {
    const raw = match[0];
    const start = match.index ?? 0;

    const trimmed = trimTrailingPunctuation(raw);
    const href = trimmed ? toSafeHref(trimmed) : null;
    if (!trimmed || !href) continue;

    if (start > cursor) {
      segments.push({ type: "text", value: text.slice(cursor, start) });
    }

    // The visible text is the URL exactly as it was typed. Because the label and
    // the destination are the same string, a message can't display one address
    // while pointing somewhere else.
    segments.push({ type: "link", value: trimmed, href });
    cursor = start + trimmed.length;
  }

  if (cursor < text.length) {
    segments.push({ type: "text", value: text.slice(cursor) });
  }

  return segments;
}

/** True when the message contains at least one linkable URL. */
export function hasLink(text: string): boolean {
  return parseMessageSegments(text).some((segment) => segment.type === "link");
}
