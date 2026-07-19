import assert from "node:assert/strict";
import test from "node:test";
import {
  buildModulesFromEntries,
  CkanIndex,
  compareCkanVersions,
  isCompatibleWithKsp,
  parseCkanDocument,
  parseCkanText,
  refreshRegistry,
} from "../dist/index.js";

test("parses a valid .ckan document and normalizes authors", () => {
  const module = parseCkanDocument({
    identifier: "ModuleManager",
    name: "Module Manager",
    abstract: "Patching plugin",
    author: "sarbian",
    version: "4.2.3",
    ksp_version_min: "1.8.0",
    ksp_version_max: "1.12.99",
    tags: ["plugin"],
    download: "https://example.test/mm.zip",
    download_size: 42,
    depends: [{ name: "Something" }],
  });

  assert.deepEqual(module, {
    identifier: "ModuleManager",
    name: "Module Manager",
    abstract: "Patching plugin",
    authors: ["sarbian"],
    version: "4.2.3",
    kspVersionMin: "1.8.0",
    kspVersionMax: "1.12.99",
    tags: ["plugin"],
    download: "https://example.test/mm.zip",
    downloadSize: 42,
    relationships: {
      depends: [{ name: "Something" }],
      conflicts: [],
      recommends: [],
      suggests: [],
    },
  });
});

test("parses depends, conflicts, recommends, and suggests with version bounds", () => {
  const module = parseCkanDocument({
    identifier: "FancyMod",
    name: "Fancy Mod",
    author: "Author",
    version: "2.0.0",
    depends: [
      { name: "ModuleManager", min_version: "4.0.0", max_version: "4.2.3" },
      "LegacyDep",
    ],
    conflicts: [{ name: "OldFancyMod" }],
    recommends: [{ name: "ToolbarController", min_version: "1.0" }],
    suggests: [{ name: "ClickThroughBlocker" }],
  });

  assert.deepEqual(module?.relationships, {
    depends: [
      { name: "ModuleManager", minVersion: "4.0.0", maxVersion: "4.2.3" },
      { name: "LegacyDep" },
    ],
    conflicts: [{ name: "OldFancyMod" }],
    recommends: [{ name: "ToolbarController", minVersion: "1.0" }],
    suggests: [{ name: "ClickThroughBlocker" }],
  });
});

test("parses install stanzas and download hashes", () => {
  const module = parseCkanDocument({
    identifier: "ExampleMod",
    name: "Example",
    author: "Author",
    version: "1.0.0",
    download_hash: { sha256: "ABC", sha1: "def" },
    install: [
      {
        file: "GameData/Example",
        install_to: "GameData",
        as: "ExampleRenamed",
      },
      {
        find: "Plugins",
        find_regexp: ".*\\.dll$",
        install_to: "GameData",
      },
    ],
  });

  assert.deepEqual(module?.downloadHash, { sha256: "abc", sha1: "def" });
  assert.deepEqual(module?.install, [
    { file: "GameData/Example", installTo: "GameData", as: "ExampleRenamed" },
    { find: "Plugins", findRegexp: ".*\\.dll$", installTo: "GameData" },
  ]);
});

test("rejects invalid .ckan payloads", () => {
  assert.equal(parseCkanDocument(null), undefined);
  assert.equal(parseCkanDocument({ name: "Only name" }), undefined);
  assert.equal(parseCkanText("{not-json"), undefined);
});

test("skips bad archive entries while counting parse errors", () => {
  const result = buildModulesFromEntries([
    {
      path: "CKAN-meta-master/ModuleManager/ModuleManager-4.2.3.ckan",
      content: JSON.stringify({
        identifier: "ModuleManager",
        name: "Module Manager",
        author: ["sarbian"],
        version: "4.2.3",
        tags: ["plugin"],
      }),
    },
    { path: "CKAN-meta-master/Broken/broken.ckan", content: "{bad" },
    { path: "CKAN-meta-master/README.md", content: "ignore me" },
  ]);

  assert.equal(result.modules.length, 1);
  assert.equal(result.parseErrors, 1);
});

test("indexes latest version per identifier and supports search filters", () => {
  const index = new CkanIndex([
    {
      identifier: "MechJeb2",
      name: "MechJeb 2",
      authors: ["sarbian"],
      version: "2.14.0",
      tags: ["plugin"],
      kspVersionMin: "1.10.0",
      kspVersionMax: "1.12.99",
    },
    {
      identifier: "MechJeb2",
      name: "MechJeb 2",
      authors: ["sarbian"],
      version: "2.15.0",
      tags: ["plugin"],
      kspVersionMin: "1.12.0",
      kspVersionMax: "1.12.99",
      abstract: "autopilot",
    },
    {
      identifier: "TextureReplacer",
      name: "Texture Replacer",
      authors: ["shaw"],
      version: "3.0",
      tags: ["graphics"],
      kspVersion: "1.12",
    },
  ]);

  const byQuery = index.search({ query: "mech", limit: 10, offset: 0 });
  assert.equal(byQuery.total, 1);
  assert.equal(byQuery.mods[0]?.version, "2.15.0");

  const byTag = index.search({ tag: "graphics", limit: 10, offset: 0 });
  assert.equal(byTag.total, 1);
  assert.equal(byTag.mods[0]?.identifier, "TextureReplacer");

  const compatible = index.search({ compatibleWith: "1.12.5", limit: 10, offset: 0 });
  assert.equal(compatible.total, 2);

  assert.deepEqual(
    index.findByIdentifier("MechJeb2").map((module) => module.version),
    ["2.14.0", "2.15.0"],
  );
});

test("compares CKAN versions with epochs", () => {
  assert.ok(compareCkanVersions("2.15.0", "2.14.0") > 0);
  assert.ok(compareCkanVersions("1:1.0", "2.0") > 0);
  assert.equal(compareCkanVersions("1.0.0", "1.0.0"), 0);
});

test("compares CKAN versions with alphanumeric parts", () => {
  assert.ok(compareCkanVersions("1.0.1", "1.0.0beta") > 0);
  assert.ok(compareCkanVersions("1.0a", "1.0") > 0);
  assert.ok(compareCkanVersions("1.10", "1.9") > 0);
  // Long digit runs must stay linear-time (no polynomial ReDoS).
  const longDigits = "9".repeat(10_000);
  assert.equal(compareCkanVersions(longDigits, longDigits), 0);
  assert.ok(compareCkanVersions(`${longDigits}a`, longDigits) > 0);
});

test("checks KSP compatibility ranges", () => {
  assert.equal(
    isCompatibleWithKsp(
      {
        identifier: "A",
        name: "A",
        authors: [],
        version: "1",
        tags: [],
        kspVersion: "1.12",
      },
      "1.12.5",
    ),
    true,
  );
  assert.equal(
    isCompatibleWithKsp(
      {
        identifier: "B",
        name: "B",
        authors: [],
        version: "1",
        tags: [],
        kspVersionMin: "1.10.0",
        kspVersionMax: "1.11.99",
      },
      "1.12.5",
    ),
    false,
  );
});

test("refreshRegistry downloads, extracts, and parses modules", async () => {
  const snapshot = await refreshRegistry(
    {
      async get(url) {
        assert.equal(url, "https://example.test/meta.tar.gz");
        return new Uint8Array([1, 2, 3]);
      },
    },
    {
      async extractCkanFiles(archive) {
        assert.deepEqual([...archive], [1, 2, 3]);
        return [
          {
            path: "mod.ckan",
            content: JSON.stringify({
              identifier: "Hello",
              name: "Hello Mod",
              author: ["dev"],
              version: "1.0.0",
              tags: [],
            }),
          },
        ];
      },
    },
    "https://example.test/meta.tar.gz",
    () => new Date("2026-07-17T12:00:00.000Z"),
  );

  assert.equal(snapshot.modules.length, 1);
  assert.equal(snapshot.parseErrors, 0);
  assert.equal(snapshot.updatedAt, "2026-07-17T12:00:00.000Z");
});
