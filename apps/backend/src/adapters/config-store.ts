import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface StoredConfig {
  schemaVersion: 2;
  activeInstallationPath: string;
  knownInstallationPaths: string[];
  preferences: Record<string, never>;
}

export class ConfigStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigStoreError";
  }
}

export class ConfigStore {
  constructor(private readonly filePath: string) {}

  async read(): Promise<StoredConfig | undefined> {
    let contents: string;
    try {
      contents = await readFile(this.filePath, "utf8");
    } catch (error: unknown) {
      if (isMissingFile(error)) {
        return undefined;
      }
      throw new ConfigStoreError(`Could not read configuration: ${getErrorMessage(error)}`);
    }

    try {
      const config: unknown = JSON.parse(contents);
      if (isStoredConfig(config)) {
        return config;
      }
      if (isStoredConfigV1(config)) {
        return {
          schemaVersion: 2,
          activeInstallationPath: config.activeInstallationPath,
          knownInstallationPaths: [config.activeInstallationPath],
          preferences: {},
        };
      }
      throw new Error("unsupported configuration format");
    } catch (error: unknown) {
      throw new ConfigStoreError(`Configuration is malformed: ${getErrorMessage(error)}`);
    }
  }

  async write(config: StoredConfig): Promise<void> {
    const directory = dirname(this.filePath);
    const temporaryPath = join(directory, `.config-${process.pid}-${globalThis.crypto.randomUUID()}.tmp`);

    try {
      await mkdir(directory, { recursive: true });
      await writeFile(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
      await rename(temporaryPath, this.filePath);
    } catch (error: unknown) {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      throw new ConfigStoreError(`Could not save configuration: ${getErrorMessage(error)}`);
    }
  }
}

function isMissingFile(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface StoredConfigV1 {
  schemaVersion: 1;
  activeInstallationPath: string;
  preferences: Record<string, never>;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function hasEmptyPreferences(value: unknown): boolean {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.keys(value).length === 0;
}

function hasOnlyKeys(config: object, allowed: readonly string[]): boolean {
  const keys = Object.keys(config);
  return keys.length === allowed.length && keys.every((key) => allowed.includes(key));
}

function isStoredConfigV1(value: unknown): value is StoredConfigV1 {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  // Shape is verified field by field below, so the partial view is safe.
  const config = value as Partial<StoredConfigV1>;
  return (
    hasOnlyKeys(config, ["schemaVersion", "activeInstallationPath", "preferences"]) &&
    config.schemaVersion === 1 &&
    isNonEmptyString(config.activeInstallationPath) &&
    hasEmptyPreferences(config.preferences)
  );
}

function isStoredConfig(value: unknown): value is StoredConfig {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  // Shape is verified field by field below, so the partial view is safe.
  const config = value as Partial<StoredConfig>;
  return (
    hasOnlyKeys(config, ["schemaVersion", "activeInstallationPath", "knownInstallationPaths", "preferences"]) &&
    config.schemaVersion === 2 &&
    isNonEmptyString(config.activeInstallationPath) &&
    Array.isArray(config.knownInstallationPaths) &&
    config.knownInstallationPaths.every(isNonEmptyString) &&
    hasEmptyPreferences(config.preferences)
  );
}
