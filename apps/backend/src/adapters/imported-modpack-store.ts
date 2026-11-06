import type { CkanModule } from "@kraken/core";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

interface StoredImportedModpacks {
  schemaVersion: 1;
  modules: CkanModule[];
}

export class ImportedModpackStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportedModpackStoreError";
  }
}

/** Persists metapackages created from imported modpacks, one entry per identifier and version. */
export class ImportedModpackStore {
  constructor(private readonly filePath: string) {}

  async read(): Promise<CkanModule[]> {
    let contents: string;
    try {
      contents = await readFile(this.filePath, "utf8");
    } catch (error: unknown) {
      if (isMissingFile(error)) {
        return [];
      }
      throw new ImportedModpackStoreError(`Could not read ${this.filePath}: ${getErrorMessage(error)}`);
    }

    let stored: unknown;
    try {
      stored = JSON.parse(contents);
    } catch (error: unknown) {
      throw new ImportedModpackStoreError(`Imported modpacks file ${this.filePath} is malformed: ${getErrorMessage(error)}`);
    }
    if (!isStoredImportedModpacks(stored)) {
      throw new ImportedModpackStoreError(
        `Imported modpacks file ${this.filePath} is malformed: unsupported format`,
      );
    }
    return stored.modules;
  }

  /** Replaces the entry with the same identifier and version, otherwise appends; returns the stored list. */
  async save(module: CkanModule): Promise<CkanModule[]> {
    const existing = await this.read();
    const index = existing.findIndex((entry) => entry.identifier === module.identifier && entry.version === module.version);
    const modules = index === -1 ? [...existing, module] : existing.map((entry, i) => (i === index ? module : entry));
    await this.write({ schemaVersion: 1, modules });
    return modules;
  }

  private async write(stored: StoredImportedModpacks): Promise<void> {
    const directory = dirname(this.filePath);
    const temporaryPath = join(directory, `.imported-modpacks-${process.pid}-${globalThis.crypto.randomUUID()}.tmp`);

    try {
      await mkdir(directory, { recursive: true });
      await writeFile(temporaryPath, `${JSON.stringify(stored)}\n`, { encoding: "utf8", mode: 0o600 });
      await rename(temporaryPath, this.filePath);
    } catch (error: unknown) {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      throw new ImportedModpackStoreError(`Could not save ${this.filePath}: ${getErrorMessage(error)}`);
    }
  }
}

function isMissingFile(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isStoredImportedModpacks(value: unknown): value is StoredImportedModpacks {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  // Safe: only read through a loose shape and every field is checked below.
  const stored = value as { schemaVersion?: unknown; modules?: unknown };
  return stored.schemaVersion === 1 && Array.isArray(stored.modules) && stored.modules.every(isImportedMetapackage);
}

/**
 * Checks only the fields the registry relies on. Deeper fields (relationships,
 * install stanzas, ...) are trusted because `save` is the only writer and
 * callers pass modules already validated by the modpack importer.
 */
function isImportedMetapackage(value: unknown): value is CkanModule {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  // Safe: only read through Partial and every field is checked below.
  const module = value as Partial<CkanModule>;
  return (
    typeof module.identifier === "string" &&
    module.identifier.length > 0 &&
    typeof module.name === "string" &&
    module.name.length > 0 &&
    typeof module.version === "string" &&
    module.version.length > 0 &&
    module.kind === "metapackage" &&
    Array.isArray(module.authors) &&
    Array.isArray(module.tags) &&
    Array.isArray(module.provides)
  );
}
