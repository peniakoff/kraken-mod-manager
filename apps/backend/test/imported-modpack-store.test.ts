import type { CkanModule } from "@kraken/core";
import { ImportedModpackStore, ImportedModpackStoreError } from "../src/adapters/imported-modpack-store.js";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function pack(version: string, abstract = "A pack"): CkanModule {
  return {
    identifier: "MyPack",
    name: "My Pack",
    abstract,
    authors: ["me"],
    version,
    tags: ["metapackage"],
    kind: "metapackage",
    provides: [],
    source: "imported",
    relationships: { depends: [{ kind: "single", name: "ModuleManager" }], conflicts: [], recommends: [], suggests: [] },
  };
}

async function newFilePath(): Promise<string> {
  return join(await mkdtemp(join(tmpdir(), "kmm-modpacks-")), "imported-modpacks.json");
}

describe("ImportedModpackStore", () => {
  it("returns no modules when the file is missing", async () => {
    await expect(new ImportedModpackStore(await newFilePath()).read()).resolves.toEqual([]);
  });

  it("saves and reads back a metapackage", async () => {
    const filePath = await newFilePath();
    const saved = await new ImportedModpackStore(filePath).save(pack("1.0"));

    expect(saved).toEqual([pack("1.0")]);
    await expect(new ImportedModpackStore(filePath).read()).resolves.toEqual([pack("1.0")]);
  });

  it("replaces the same identifier and version, keeps a different version", async () => {
    const store = new ImportedModpackStore(await newFilePath());
    await store.save(pack("1.0"));
    await store.save(pack("2.0"));
    const saved = await store.save(pack("1.0", "Updated"));

    expect(saved).toHaveLength(2);
    expect(saved.find((module) => module.version === "1.0")?.abstract).toBe("Updated");
    expect(saved.find((module) => module.version === "2.0")?.abstract).toBe("A pack");
  });

  it("rejects a malformed file", async () => {
    const filePath = await newFilePath();
    const store = new ImportedModpackStore(filePath);

    await writeFile(filePath, JSON.stringify({ schemaVersion: 1, modules: [{ identifier: "" }] }));
    await expect(store.read()).rejects.toBeInstanceOf(ImportedModpackStoreError);

    await writeFile(filePath, "not json");
    await expect(store.read()).rejects.toBeInstanceOf(ImportedModpackStoreError);
    await expect(store.save(pack("1.0"))).rejects.toBeInstanceOf(ImportedModpackStoreError);
  });
});
