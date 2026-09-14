import type { CkanModule } from "@kraken/contracts";

type CompatInput = Pick<CkanModule, "kspVersion" | "kspVersionMin" | "kspVersionMax">;

/**
 * Frontend mirror of `isCompatibleWithKsp` from `@kraken/core`.
 * Kept local on purpose: domain code must not be coupled to Vue
 * (see docs/ARCHITECTURE.md), and the search list is already filtered
 * server-side — this helper only renders per-row flags when the
 * "compatible only" filter is disabled.
 */
export function isCompatibleWithKsp(mod: CompatInput, kspVersion: string | undefined): boolean {
  if (kspVersion === undefined) {
    return true;
  }
  const target = normalizeVersionComponents(kspVersion);
  if (target === undefined) {
    return false;
  }

  if (mod.kspVersion !== undefined) {
    const exact = normalizeVersionComponents(mod.kspVersion);
    if (exact === undefined) {
      return false;
    }
    return versionsEqual(target, exact, Math.min(target.length, exact.length));
  }

  if (mod.kspVersionMin !== undefined) {
    const min = normalizeVersionComponents(mod.kspVersionMin);
    if (min === undefined || compareVersionComponents(target, min) < 0) {
      return false;
    }
  }

  if (mod.kspVersionMax !== undefined) {
    const max = normalizeVersionComponents(mod.kspVersionMax);
    if (max === undefined || compareVersionComponents(target, max) > 0) {
      return false;
    }
  }

  return true;
}

export function formatDownloadSize(bytes: number | undefined): string | undefined {
  if (bytes === undefined || !Number.isFinite(bytes) || bytes < 0) {
    return undefined;
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const rounded = value >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[unitIndex]}`;
}

function normalizeVersionComponents(version: string): number[] | undefined {
  const trimmed = version.trim().replace(/^v/i, "");
  if (trimmed.length === 0) {
    return undefined;
  }
  const parts = trimmed.split(".").map((part) => {
    const match = /^(\d+)/.exec(part);
    return match === null ? Number.NaN : Number(match[1]);
  });
  if (parts.some((part) => Number.isNaN(part))) {
    return undefined;
  }
  return parts;
}

function compareVersionComponents(left: number[], right: number[]): number {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    if (leftValue !== rightValue) {
      return leftValue - rightValue;
    }
  }
  return 0;
}

function versionsEqual(left: number[], right: number[], significant: number): boolean {
  for (let index = 0; index < significant; index += 1) {
    if ((left[index] ?? 0) !== (right[index] ?? 0)) {
      return false;
    }
  }
  return true;
}
