import { describe, expect, it } from "vitest";
import { formatDownloadSize, isCompatibleWithKsp } from "../src/compat.js";

describe("isCompatibleWithKsp", () => {
  it("treats modules without constraints as compatible", () => {
    expect(isCompatibleWithKsp({}, "1.12.5")).toBe(true);
  });

  it("matches an exact version with reduced precision", () => {
    expect(isCompatibleWithKsp({ kspVersion: "1.12" }, "1.12.5")).toBe(true);
    expect(isCompatibleWithKsp({ kspVersion: "1.12.5" }, "1.12.5")).toBe(true);
    expect(isCompatibleWithKsp({ kspVersion: "1.11" }, "1.12.5")).toBe(false);
  });

  it("respects min/max ranges", () => {
    expect(isCompatibleWithKsp({ kspVersionMin: "1.10", kspVersionMax: "1.12.5" }, "1.12.5")).toBe(true);
    expect(isCompatibleWithKsp({ kspVersionMin: "1.12" }, "1.11.0")).toBe(false);
    expect(isCompatibleWithKsp({ kspVersionMax: "1.11" }, "1.12.5")).toBe(false);
  });

  it("returns true without a KSP version and false for invalid versions", () => {
    expect(isCompatibleWithKsp({ kspVersion: "1.12" }, undefined)).toBe(true);
    expect(isCompatibleWithKsp({}, "not-a-version")).toBe(false);
    expect(isCompatibleWithKsp({ kspVersion: "bogus" }, "1.12.5")).toBe(false);
  });
});

describe("formatDownloadSize", () => {
  it("formats bytes, kilobytes and megabytes", () => {
    expect(formatDownloadSize(undefined)).toBeUndefined();
    expect(formatDownloadSize(512)).toBe("512 B");
    expect(formatDownloadSize(2048)).toBe("2 KB");
    expect(formatDownloadSize(2_621_440)).toBe("2.5 MB");
  });

  it("rejects invalid input", () => {
    expect(formatDownloadSize(-1)).toBeUndefined();
    expect(formatDownloadSize(Number.NaN)).toBeUndefined();
  });
});
