"use client";

import { PLATFORM_LABELS, PLATFORM_MARKS, type Platform, type PlatformDisplay } from "@/lib/types";

/**
 * Names the source of a message.
 *
 * The compact form is a colour-coded two-letter badge rather than the platform's
 * own logo. Those logos are trademarks with brand guidelines attached, and a
 * redrawn approximation would be a derivative of the mark *and* visibly wrong —
 * worse on both counts. To use official artwork instead, see README.md.
 *
 * The full name stays as the accessible label either way, so switching to marks
 * never costs a screen reader the source.
 */
export function PlatformTag({
  platform,
  display,
}: {
  platform: Platform;
  display: PlatformDisplay;
}) {
  const label = PLATFORM_LABELS[platform];

  if (display === "mark") {
    return (
      <span className="row-mark" title={label} aria-label={label}>
        {PLATFORM_MARKS[platform]}
      </span>
    );
  }

  return <span className="row-platform">{label}</span>;
}
