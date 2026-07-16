import { ConfigStore, ConfigStoreError } from "../src/adapters/config-store.js";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("ConfigStore", () => {
  it("reads a saved selection through a new store instance", async () => {
    const directory = await mkdtemp(join(tmpdir(), "kmm-config-"));
    const filePath = join(directory, "config.json");
    await new ConfigStore(filePath).write({
      schemaVersion: 1,
      activeInstallationPath: "/games/KSP",
      preferences: {},
    });

    await expect(new ConfigStore(filePath).read()).resolves.toEqual({
      schemaVersion: 1,
      activeInstallationPath: "/games/KSP",
      preferences: {},
    });
  });

  it("reports malformed and unsupported configuration files without overwriting them", async () => {
    const directory = await mkdtemp(join(tmpdir(), "kmm-config-"));
    const filePath = join(directory, "config.json");
    await writeFile(filePath, JSON.stringify({ schemaVersion: 1, activeInstallationPath: "/KSP", preferences: [] }));

    await expect(new ConfigStore(filePath).read()).rejects.toBeInstanceOf(ConfigStoreError);
  });
});
