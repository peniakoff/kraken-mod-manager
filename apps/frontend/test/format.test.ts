import { describe, expect, it } from "vitest";
import { formatCount, formatRelativeTime } from "../src/format.js";

describe("formatCount", () => {
  it("groups thousands", () => {
    expect(formatCount(31209)).toBe("31,209");
    expect(formatCount(7)).toBe("7");
  });
});

describe("formatRelativeTime", () => {
  const now = new Date("2026-11-05T12:00:00.000Z");

  it("describes recent times in minutes and hours", () => {
    expect(formatRelativeTime("2026-11-05T11:59:40.000Z", now)).toBe("just now");
    expect(formatRelativeTime("2026-11-05T11:15:00.000Z", now)).toBe("45 minutes ago");
    expect(formatRelativeTime("2026-11-05T09:00:00.000Z", now)).toBe("3 hours ago");
  });

  it("describes older times in days", () => {
    expect(formatRelativeTime("2026-11-03T22:00:54.700Z", now)).toBe("yesterday");
    expect(formatRelativeTime("2026-10-29T12:00:00.000Z", now)).toBe("7 days ago");
  });

  it("returns undefined for a timestamp it cannot parse", () => {
    expect(formatRelativeTime("not a date", now)).toBeUndefined();
  });
});
