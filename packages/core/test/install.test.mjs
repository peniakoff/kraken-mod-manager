import assert from "node:assert/strict";
import test from "node:test";
import {
  buildInventory,
  findAvailableUpdates,
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

test("file stanza matches archive paths case-insensitively", () => {
  const mappings = resolveInstallMappings(
    { install: [{ file: "GameData/Example", installTo: "GameData" }] },
    ["gamedata/Example/a.cfg", "gamedata/Example/b.dll"],
  );
  assert.deepEqual(mappings, [
    { sourcePath: "gamedata/Example/a.cfg", destinationPath: "GameData/Example/a.cfg" },
    { sourcePath: "gamedata/Example/b.dll", destinationPath: "GameData/Example/b.dll" },
  ]);
});

test("find stanza matches directory names case-insensitively", () => {
  const mappings = resolveInstallMappings(
    { install: [{ find: "ExampleMod", installTo: "GameData" }] },
    ["Pack/examplemod/Parts/wing.cfg", "Pack/examplemod/plugin.dll"],
  );
  assert.deepEqual(mappings, [
    { sourcePath: "Pack/examplemod/Parts/wing.cfg", destinationPath: "GameData/examplemod/Parts/wing.cfg" },
    { sourcePath: "Pack/examplemod/plugin.dll", destinationPath: "GameData/examplemod/plugin.dll" },
  ]);
});

test("find_regexp matches archive paths case-insensitively", () => {
  const mappings = resolveInstallMappings(
    { install: [{ findRegexp: "gamedata/example/.*\\.dll$", installTo: "GameData" }] },
    ["GameData/Example/plugin.DLL", "GameData/Example/readme.txt"],
  );
  assert.deepEqual(mappings, [
    { sourcePath: "GameData/Example/plugin.DLL", destinationPath: "GameData/plugin.DLL" },
  ]);
});

test("throws STANZA_NOT_FOUND with stanza description when nothing matches", () => {
  assert.throws(
    () =>
      resolveInstallMappings(
        { install: [{ file: "GameData/Missing", installTo: "GameData" }] },
        ["GameData/Other/a.cfg"],
      ),
    (error) =>
      error instanceof InstallPolicyError &&
      error.code === "STANZA_NOT_FOUND" &&
      error.message.includes('file="GameData/Missing"'),
  );
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

test("findAvailableUpdates reports newer registry versions only", () => {
  const updates = findAvailableUpdates(
    [
      { identifier: "MechJeb2", name: "MechJeb 2", version: "2.14.0", status: "managed" },
      { identifier: "ModuleManager", name: "Module Manager", version: "4.2.3", status: "managed" },
      { identifier: "DetectedOnly", status: "detected" },
      { identifier: "UnknownMod", version: "1.0.0", status: "managed" },
    ],
    [
      {
        identifier: "MechJeb2",
        name: "MechJeb 2",
        authors: ["sarbian"],
        version: "2.14.0",
        tags: ["plugin"],
      },
      {
        identifier: "MechJeb2",
        name: "MechJeb 2",
        authors: ["sarbian"],
        version: "2.15.0",
        tags: ["plugin"],
      },
      {
        identifier: "ModuleManager",
        name: "Module Manager",
        authors: ["sarbian"],
        version: "4.2.3",
        tags: ["plugin"],
      },
    ],
  );

  assert.deepEqual(updates, [
    {
      identifier: "MechJeb2",
      name: "MechJeb 2",
      installedVersion: "2.14.0",
      availableVersion: "2.15.0",
    },
  ]);
});
