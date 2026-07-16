import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface StoredConfig {
  schemaVersion: 1;
  activeInstallationPath: string;
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
      if (!isStoredConfig(config)) {
        throw new Error("unsupported configuration format");
      }
      return config;
    } catch (error: unknown) {
      throw new ConfigStoreError(`Configuration is malformed: ${getErrorMessage(error)}`);
    }
  }

  async write(config: StoredConfig): Promise<void> {
    const directory = dirname(this.filePath);
    const temporaryPath = join(directory, `.config-${process.pid}-${Date.now()}.tmp`);

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

function isStoredConfig(value: unknown): value is StoredConfig {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const config = value as Partial<StoredConfig>;
  return (
    config.schemaVersion === 1 &&
    typeof config.activeInstallationPath === "string" &&
    config.activeInstallationPath.length > 0 &&
    typeof config.preferences === "object" &&
    config.preferences !== null
  );
}
