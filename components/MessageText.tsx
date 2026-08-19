"use client";

import { useMemo } from "react";
import { parseMessageSegments } from "@/lib/linkify";

/**
 * Renders a chat message with its URLs clickable.
 *
 * Everything here goes through React's normal text escaping — the message is
 * never treated as markup — so a hostile message can't inject anything. Links
 * open in a new tab with `noopener`, which keeps the opened page from reaching
 * back into this one via `window.opener`.
 */
export function MessageText({ text }: { text: string }) {
  const segments = useMemo(() => parseMessageSegments(text), [text]);

  return (
    <>
      {segments.map((segment, index) =>
        segment.type === "link" ? (
          <a
            key={index}
            href={segment.href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="msg-link"
          >
            {segment.value}
          </a>
        ) : (
          <span key={index}>{segment.value}</span>
        ),
      )}
    </>
  );
}
