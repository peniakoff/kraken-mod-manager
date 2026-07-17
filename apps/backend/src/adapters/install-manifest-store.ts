import type { ManagedModRecord } from "@kraken/core";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface StoredInstallManifest {
  schemaVersion: 1;
  mods: ManagedModRecord[];
}

export class InstallManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InstallManifestError";
  }
}

export class InstallManifestStore {
  constructor(private readonly filePath: string) {}

  async read(): Promise<StoredInstallManifest> {
    let contents: string;
    try {
      contents = await readFile(this.filePath, "utf8");
    } catch (error: unknown) {
      if (isMissingFile(error)) {
        return { schemaVersion: 1, mods: [] };
      }
      throw new InstallManifestError(`Could not read install manifest: ${getErrorMessage(error)}`);
    }

    try {
      const manifest: unknown = JSON.parse(contents);
      if (!isStoredInstallManifest(manifest)) {
        throw new Error("unsupported install manifest format");
      }
      return manifest;
    } catch (error: unknown) {
      throw new InstallManifestError(`Install manifest is malformed: ${getErrorMessage(error)}`);
    }
  }

  async write(manifest: StoredInstallManifest): Promise<void> {
    const directory = dirname(this.filePath);
    const temporaryPath = join(directory, `.install-manifest-${process.pid}-${globalThis.crypto.randomUUID()}.tmp`);

    try {
      await mkdir(directory, { recursive: true });
      await writeFile(temporaryPath, `${JSON.stringify(manifest)}\n`, { encoding: "utf8", mode: 0o600 });
      await rename(temporaryPath, this.filePath);
    } catch (error: unknown) {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      throw new InstallManifestError(`Could not save install manifest: ${getErrorMessage(error)}`);
    }
  }
}

function isMissingFile(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isStoredInstallManifest(value: unknown): value is StoredInstallManifest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const manifest = value as Partial<StoredInstallManifest>;
  return (
    manifest.schemaVersion === 1 &&
    Array.isArray(manifest.mods) &&
    manifest.mods.every(isManagedModRecord)
  );
}

function isManagedModRecord(value: unknown): value is ManagedModRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Partial<ManagedModRecord>;
  return (
    typeof record.identifier === "string" &&
    record.identifier.length > 0 &&
    typeof record.name === "string" &&
    record.name.length > 0 &&
    typeof record.version === "string" &&
    record.version.length > 0 &&
    Array.isArray(record.files) &&
    record.files.every((file) => typeof file === "string" && file.length > 0)
  );
}
