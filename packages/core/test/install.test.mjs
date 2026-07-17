import assert from "node:assert/strict";
import test from "node:test";
import {
  buildInventory,
  isAllowedDestination,
  isSafeArchivePath,
  resolveInstallMappings,
  verifyDownloadHash,
  InstallPolicyError,
} from "../dist/index.js";

test("rejects unsafe archive paths and destinations", () => {
  assert.equal(isSafeArchivePath("../etc/passwd"), false);
  assert.equal(isSafeArchivePath("/GameData/x"), false);
  assert.equal(isSafeArchivePath("GameData/Foo/bar.cfg"), true);
  assert.equal(isAllowedDestination("GameData/Foo"), true);
  assert.equal(isAllowedDestination("Ships/VAB/craft"), true);
  assert.equal(isAllowedDestination("Plugins/x"), false);
});

test("default install maps GameData contents when present", () => {
  const mappings = resolveInstallMappings({}, [
    "GameData/Example/readme.txt",
    "GameData/Example/plugin.dll",
    "README.md",
  ]);
  assert.deepEqual(mappings, [
    { sourcePath: "GameData/Example/readme.txt", destinationPath: "GameData/Example/readme.txt" },
    { sourcePath: "GameData/Example/plugin.dll", destinationPath: "GameData/Example/plugin.dll" },
  ]);
});

test("default install places loose files under GameData", () => {
  const mappings = resolveInstallMappings({}, ["Example/plugin.dll"]);
  assert.deepEqual(mappings, [
    { sourcePath: "Example/plugin.dll", destinationPath: "GameData/Example/plugin.dll" },
  ]);
});

test("file stanza with as renames the installed folder", () => {
  const mappings = resolveInstallMappings(
    {
      install: [{ file: "GameData/Example", installTo: "GameData", as: "Renamed" }],
    },
    ["GameData/Example/a.cfg", "GameData/Example/b.dll"],
  );
  assert.deepEqual(mappings, [
    { sourcePath: "GameData/Example/a.cfg", destinationPath: "GameData/Renamed/a.cfg" },
    { sourcePath: "GameData/Example/b.dll", destinationPath: "GameData/Renamed/b.dll" },
  ]);
});

test("find stanza locates a named directory in the archive", () => {
  const mappings = resolveInstallMappings(
    { install: [{ find: "ExampleMod", installTo: "GameData" }] },
    ["pack/ExampleMod/Parts/wing.cfg", "pack/ExampleMod/plugin.dll"],
  );
  assert.deepEqual(mappings, [
    { sourcePath: "pack/ExampleMod/Parts/wing.cfg", destinationPath: "GameData/ExampleMod/Parts/wing.cfg" },
    { sourcePath: "pack/ExampleMod/plugin.dll", destinationPath: "GameData/ExampleMod/plugin.dll" },
  ]);
});

test("rejects path traversal in archive entries", () => {
  assert.throws(
    () => resolveInstallMappings({}, ["GameData/../evil.dll"]),
    (error) => error instanceof InstallPolicyError && error.code === "INVALID_ARCHIVE_PATH",
  );
});

test("rejects disallowed install_to", () => {
  assert.throws(
    () => resolveInstallMappings({ install: [{ file: "x.dll", installTo: "Plugins" }] }, ["x.dll"]),
    (error) => error instanceof InstallPolicyError && error.code === "INVALID_DESTINATION",
  );
});

test("merges managed and detected inventory", () => {
  const inventory = buildInventory(
    ["ModuleManager", "UnknownFolder", "MechJeb2"],
    [{ identifier: "ModuleManager", name: "Module Manager", version: "4.2.3", files: ["GameData/ModuleManager/mm.dll"] }],
    new Set(["ModuleManager", "MechJeb2"]),
    new Map([["MechJeb2", "MechJeb 2"]]),
  );
  assert.deepEqual(inventory, [
    {
      identifier: "MechJeb2",
      name: "MechJeb 2",
      status: "detected",
    },
    {
      identifier: "ModuleManager",
      name: "Module Manager",
      version: "4.2.3",
      status: "managed",
      files: ["GameData/ModuleManager/mm.dll"],
    },
  ]);
});

test("verifies download hashes", () => {
  assert.throws(
    () => verifyDownloadHash(new Uint8Array(), { sha256: "abc" }, { sha256: "def" }),
    (error) => error instanceof InstallPolicyError && error.code === "HASH_MISMATCH",
  );
  verifyDownloadHash(new Uint8Array(), { sha256: "abc" }, { sha256: "ABC" });
});
