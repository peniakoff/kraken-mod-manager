const countFormat = new Intl.NumberFormat("en-US");
const relativeFormat = new Intl.RelativeTimeFormat("en-US", { numeric: "auto" });

/** Formats a count with thousands separators ("31,209"). */
export function formatCount(value: number): string {
  return countFormat.format(value);
}

/**
 * Describes an ISO timestamp relative to `now` ("3 hours ago", "yesterday").
 * Returns undefined when the timestamp does not parse, so callers can fall
 * back to showing nothing instead of "Invalid Date".
 */
export function formatRelativeTime(isoTimestamp: string, now: Date = new Date()): string | undefined {
  const then = Date.parse(isoTimestamp);
  if (Number.isNaN(then)) {
    return undefined;
  }
  const seconds = Math.round((now.getTime() - then) / 1000);
  if (seconds < 60) {
    return "just now";
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return relativeFormat.format(-minutes, "minute");
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return relativeFormat.format(-hours, "hour");
  }
  return relativeFormat.format(-Math.floor(hours / 24), "day");
}
