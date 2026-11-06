import type { CkanModule, RegistrySnapshot } from "@kraken/core";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface StoredRegistryCache {
  schemaVersion: 4;
  sourceUrl: string;
  updatedAt: string;
  parseErrors: number;
  modules: CkanModule[];
}

export class RegistryCacheError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RegistryCacheError";
  }
}

export class RegistryCacheStore {
  constructor(private readonly filePath: string) {}

  async read(): Promise<StoredRegistryCache | undefined> {
    let contents: string;
    try {
      contents = await readFile(this.filePath, "utf8");
    } catch (error: unknown) {
      if (isMissingFile(error)) {
        return undefined;
      }
      throw new RegistryCacheError(`Could not read registry cache: ${getErrorMessage(error)}`);
    }

    try {
      const cache: unknown = JSON.parse(contents);
      if (isOutdatedRegistryCache(cache)) {
        // v1 caches predate `provides` parsing and v2 caches predate download
        // mirrors, so their modules hide virtual packages or download URLs.
        console.warn(
          `Ignoring outdated registry cache (schema v${String(outdatedSchemaVersion(cache))}); refresh the registry to rebuild it.`,
        );
        return undefined;
      }
      if (!isStoredRegistryCache(cache)) {
        throw new Error("unsupported registry cache format");
      }
      return cache;
    } catch (error: unknown) {
      throw new RegistryCacheError(`Registry cache is malformed: ${getErrorMessage(error)}`);
    }
  }

  async write(snapshot: RegistrySnapshot): Promise<void> {
    const cache: StoredRegistryCache = {
      schemaVersion: 4,
      sourceUrl: snapshot.sourceUrl,
      updatedAt: snapshot.updatedAt,
      parseErrors: snapshot.parseErrors,
      modules: snapshot.modules,
    };
    const directory = dirname(this.filePath);
    const temporaryPath = join(directory, `.registry-${process.pid}-${globalThis.crypto.randomUUID()}.tmp`);

    try {
      await mkdir(directory, { recursive: true });
      await writeFile(temporaryPath, `${JSON.stringify(cache)}\n`, { encoding: "utf8", mode: 0o600 });
      await rename(temporaryPath, this.filePath);
    } catch (error: unknown) {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      throw new RegistryCacheError(`Could not save registry cache: ${getErrorMessage(error)}`);
    }
  }
}

function isMissingFile(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function outdatedSchemaVersion(value: unknown): number | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value) || !("schemaVersion" in value)) {
    return undefined;
  }
  // v3 caches predate the CKAN `kind` field, so metapackages in them would stay invisible until a manual refresh.
  return value.schemaVersion === 1 || value.schemaVersion === 2 || value.schemaVersion === 3
    ? value.schemaVersion
    : undefined;
}

function isOutdatedRegistryCache(value: unknown): boolean {
  return outdatedSchemaVersion(value) !== undefined;
}

function isStoredRegistryCache(value: unknown): value is StoredRegistryCache {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const cache = value as Partial<StoredRegistryCache>;
  return (
    cache.schemaVersion === 4 &&
    typeof cache.sourceUrl === "string" &&
    cache.sourceUrl.length > 0 &&
    typeof cache.updatedAt === "string" &&
    cache.updatedAt.length > 0 &&
    typeof cache.parseErrors === "number" &&
    Number.isInteger(cache.parseErrors) &&
    cache.parseErrors >= 0 &&
    Array.isArray(cache.modules)
  );
}
