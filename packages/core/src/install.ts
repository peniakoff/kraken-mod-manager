/**
 * Install mapping, inventory merge, and download hash helpers.
 * File-system I/O stays in adapters; this module is pure policy.
 */

import type { CkanDownloadHash, CkanInstallStanza, CkanModule } from "./ckan.js";

export type InstalledModStatus = "managed" | "detected";

export interface ManagedModRecord {
  identifier: string;
  name: string;
  version: string;
  installationPath: string;
  files: string[];
}

export interface InstalledModSummary {
  identifier: string;
  name?: string;
  version?: string;
  status: InstalledModStatus;
  files?: string[];
}

export interface InstallMapping {
  /** Path inside the archive (forward slashes, no leading slash). */
  sourcePath: string;
  /** Destination relative to the KSP installation root. */
  destinationPath: string;
}

export class InstallPolicyError extends Error {
  constructor(
    message: string,
    readonly code: "INVALID_ARCHIVE_PATH" | "INVALID_DESTINATION" | "STANZA_NOT_FOUND" | "HASH_MISMATCH",
  ) {
    super(message);
    this.name = "InstallPolicyError";
  }
}

const ALLOWED_INSTALL_ROOTS = new Set([
  "GameData",
  "Ships",
  "Ships/VAB",
  "Ships/SPH",
  "Ships/@thumbs",
  "Ships/@thumbs/VAB",
  "Ships/@thumbs/SPH",
  "Tutorial",
  "Scenarios",
]);

export function normalizeSlashPath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\/+/, "").replace(/\/+/g, "/");
}

export function isSafeArchivePath(path: string): boolean {
  const trimmed = path.trim();
  if (trimmed.length === 0) {
    return false;
  }
  if (trimmed.startsWith("/") || trimmed.startsWith("\\") || /^[a-zA-Z]:[\\/]/.test(trimmed)) {
    return false;
  }
  const normalized = normalizeSlashPath(trimmed);
  if (normalized.length === 0) {
    return false;
  }
  const parts = normalized.split("/");
  return parts.every((part) => part !== ".." && part !== "" && part !== ".");
}

export function isAllowedDestination(destinationPath: string): boolean {
  const normalized = normalizeSlashPath(destinationPath);
  if (!isSafeArchivePath(normalized)) {
    return false;
  }
  for (const root of ALLOWED_INSTALL_ROOTS) {
    if (normalized === root || normalized.startsWith(`${root}/`)) {
      return true;
    }
  }
  return false;
}

export function resolveInstallMappings(
  module: Pick<CkanModule, "install">,
  archivePaths: readonly string[],
): InstallMapping[] {
  const files = archivePaths
    .map(normalizeSlashPath)
    .filter((path) => isSafeArchivePath(path) && !path.endsWith("/"))
    .filter((path) => !path.split("/").some((part) => part.startsWith("__MACOSX") || part === ".DS_Store"));

  for (const path of archivePaths.map(normalizeSlashPath)) {
    if (path.length > 0 && !isSafeArchivePath(path)) {
      throw new InstallPolicyError(`Unsafe archive path: ${path}`, "INVALID_ARCHIVE_PATH");
    }
  }

  const stanzas = module.install;
  if (stanzas === undefined || stanzas.length === 0) {
    return defaultInstallMappings(files);
  }

  const mappings: InstallMapping[] = [];
  for (const stanza of stanzas) {
    mappings.push(...resolveStanza(stanza, files));
  }
  return dedupeMappings(mappings);
}

export function buildInventory(
  gameDataDirectories: readonly string[],
  managed: readonly ManagedModRecord[],
  knownIdentifiers: ReadonlySet<string>,
  knownNames: ReadonlyMap<string, string> = new Map(),
): InstalledModSummary[] {
  const byIdentifier = new Map<string, InstalledModSummary>();

  for (const record of managed) {
    byIdentifier.set(record.identifier, {
      identifier: record.identifier,
      name: record.name,
      version: record.version,
      status: "managed",
      files: [...record.files],
    });
  }

  for (const directory of gameDataDirectories) {
    const identifier = directory.trim();
    if (identifier.length === 0 || byIdentifier.has(identifier)) {
      continue;
    }
    if (!knownIdentifiers.has(identifier)) {
      continue;
    }
    const name = knownNames.get(identifier);
    byIdentifier.set(identifier, name === undefined ? { identifier, status: "detected" } : { identifier, name, status: "detected" });
  }

  return [...byIdentifier.values()].sort((left, right) => left.identifier.localeCompare(right.identifier));
}

export function verifyDownloadHash(bytes: Uint8Array, expected: CkanDownloadHash | undefined, digests: {
  sha1?: string;
  sha256?: string;
}): void {
  if (expected === undefined) {
    return;
  }
  if (expected.sha256 !== undefined) {
    if (digests.sha256 === undefined || digests.sha256.toLowerCase() !== expected.sha256.toLowerCase()) {
      throw new InstallPolicyError("Download SHA-256 does not match metadata.", "HASH_MISMATCH");
    }
  }
  if (expected.sha1 !== undefined) {
    if (digests.sha1 === undefined || digests.sha1.toLowerCase() !== expected.sha1.toLowerCase()) {
      throw new InstallPolicyError("Download SHA-1 does not match metadata.", "HASH_MISMATCH");
    }
  }
  // bytes reserved for future streaming digests; currently digests are precomputed by adapters
  void bytes;
}

function defaultInstallMappings(files: readonly string[]): InstallMapping[] {
  const gameDataFiles = files.filter((path) => path === "GameData" || path.startsWith("GameData/"));
  if (gameDataFiles.length > 0) {
    return gameDataFiles
      .filter((path) => path.startsWith("GameData/"))
      .map((path) => ({
        sourcePath: path,
        destinationPath: path,
      }));
  }

  return files.map((path) => ({
    sourcePath: path,
    destinationPath: normalizeSlashPath(`GameData/${path}`),
  }));
}

function resolveStanza(stanza: CkanInstallStanza, files: readonly string[]): InstallMapping[] {
  const installTo = normalizeSlashPath(stanza.installTo ?? "GameData");
  if (!isAllowedDestination(installTo) && !ALLOWED_INSTALL_ROOTS.has(installTo)) {
    throw new InstallPolicyError(`install_to is not allowed: ${installTo}`, "INVALID_DESTINATION");
  }

  let matched: string[];
  if (stanza.file !== undefined) {
    const file = normalizeSlashPath(stanza.file);
    matched = files.filter((path) => path === file || path.startsWith(`${file}/`));
  } else if (stanza.find !== undefined) {
    matched = findByName(files, stanza.find);
  } else if (stanza.findRegexp !== undefined) {
    matched = findByRegexp(files, stanza.findRegexp);
  } else {
    matched = [...files];
  }

  if (matched.length === 0) {
    throw new InstallPolicyError("Install stanza matched no archive entries.", "STANZA_NOT_FOUND");
  }

  const sourceRoot = commonSourceRoot(matched, stanza);
  return matched.map((sourcePath) => {
    const relative = sourceRoot.length === 0 ? sourcePath : sourcePath.slice(sourceRoot.length).replace(/^\//, "");
    const renamed = applyAs(relative, stanza.as, sourceRoot);
    const destinationPath = normalizeSlashPath(`${installTo}/${renamed}`);
    if (!isAllowedDestination(destinationPath)) {
      throw new InstallPolicyError(`Destination escapes allowed roots: ${destinationPath}`, "INVALID_DESTINATION");
    }
    return { sourcePath, destinationPath };
  });
}

function findByName(files: readonly string[], find: string): string[] {
  const needle = find.replaceAll("\\", "/");
  const directories = new Set<string>();
  for (const path of files) {
    const parts = path.split("/");
    for (let index = 0; index < parts.length; index += 1) {
      if (parts[index] === needle) {
        directories.add(parts.slice(0, index + 1).join("/"));
      }
    }
  }
  if (directories.size === 0) {
    return files.filter((path) => path === needle || path.endsWith(`/${needle}`));
  }
  const roots = [...directories].sort((left, right) => left.length - right.length);
  const root = roots[0]!;
  return files.filter((path) => path === root || path.startsWith(`${root}/`));
}

function findByRegexp(files: readonly string[], pattern: string): string[] {
  let regexp: RegExp;
  try {
    regexp = new RegExp(pattern);
  } catch {
    throw new InstallPolicyError(`Invalid find_regexp: ${pattern}`, "STANZA_NOT_FOUND");
  }
  const matches = files.filter((path) => regexp.test(path));
  if (matches.length === 0) {
    return [];
  }
  // Prefer the shortest common directory among matches when possible.
  return matches;
}

function commonSourceRoot(matched: readonly string[], stanza: CkanInstallStanza): string {
  if (stanza.file !== undefined) {
    const file = normalizeSlashPath(stanza.file);
    if (matched.every((path) => path === file)) {
      // Single file: install under install_to using basename only.
      const slash = file.lastIndexOf("/");
      return slash === -1 ? "" : file.slice(0, slash);
    }
    if (matched.every((path) => path === file || path.startsWith(`${file}/`))) {
      // Directory (or prefix): preserve the final path component under install_to.
      const slash = file.lastIndexOf("/");
      return slash === -1 ? "" : file.slice(0, slash);
    }
  }
  if (stanza.find !== undefined) {
    const needle = stanza.find.replaceAll("\\", "/");
    for (const path of matched) {
      const parts = path.split("/");
      const index = parts.indexOf(needle);
      if (index >= 0) {
        // Parent of the found directory so the directory name is preserved under install_to.
        return parts.slice(0, index).join("/");
      }
    }
  }
  const first = matched[0]!;
  let prefix = first.includes("/") ? first.slice(0, first.lastIndexOf("/")) : "";
  for (const path of matched.slice(1)) {
    while (prefix.length > 0 && path !== prefix && !path.startsWith(`${prefix}/`)) {
      const slash = prefix.lastIndexOf("/");
      prefix = slash === -1 ? "" : prefix.slice(0, slash);
    }
  }
  return prefix;
}

function applyAs(relative: string, asName: string | undefined, sourceRoot: string): string {
  if (asName === undefined || asName.length === 0) {
    if (relative.length === 0) {
      return sourceRoot.split("/").at(-1) ?? sourceRoot;
    }
    return relative;
  }
  if (relative.length === 0) {
    return asName;
  }
  const parts = relative.split("/");
  parts[0] = asName;
  return parts.join("/");
}

function dedupeMappings(mappings: readonly InstallMapping[]): InstallMapping[] {
  const byDestination = new Map<string, InstallMapping>();
  for (const mapping of mappings) {
    byDestination.set(mapping.destinationPath, mapping);
  }
  return [...byDestination.values()];
}
