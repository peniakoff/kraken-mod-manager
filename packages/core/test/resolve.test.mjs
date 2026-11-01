import assert from "node:assert/strict";
import test from "node:test";
import { resolveInstallPlan } from "../dist/index.js";

function mod(partial) {
  return {
    authors: ["Tester"],
    tags: ["plugin"],
    provides: [],
    ...partial,
  };
}

test("plans transitive depends with deps before target", () => {
  const moduleManager = mod({
    identifier: "ModuleManager",
    name: "Module Manager",
    version: "4.2.3",
    download: "https://example.test/mm.zip",
  });
  const library = mod({
    identifier: "SharedLib",
    name: "Shared Lib",
    version: "1.1.0",
    download: "https://example.test/lib.zip",
    relationships: {
      depends: [{ kind: "single", name: "ModuleManager" }],
      conflicts: [],
      recommends: [],
      suggests: [],
    },
  });
  const target = mod({
    identifier: "FancyMod",
    name: "Fancy Mod",
    version: "2.0.0",
    download: "https://example.test/fancy.zip",
    relationships: {
      depends: [{ kind: "single", name: "SharedLib" }],
      conflicts: [],
      recommends: [{ kind: "single", name: "Toolbar" }],
      suggests: [],
    },
  });

  const plan = resolveInstallPlan({
    target,
    registryModules: [moduleManager, library, target],
    inventory: [],
  });

  assert.equal(plan.status, "ok");
  assert.deepEqual(
    plan.toInstall.map((entry) => entry.identifier),
    ["ModuleManager", "SharedLib", "FancyMod"],
  );
  assert.equal(plan.alreadySatisfied.length, 0);
  assert.equal(plan.unmet.length, 0);
  assert.equal(plan.optional.length, 1);
  assert.equal(plan.optional[0]?.name, "Toolbar");
});

test("marks already installed depends as satisfied", () => {
  const moduleManager = mod({
    identifier: "ModuleManager",
    name: "Module Manager",
    version: "4.2.3",
  });
  const target = mod({
    identifier: "FancyMod",
    name: "Fancy Mod",
    version: "2.0.0",
    relationships: {
      depends: [{ kind: "single", name: "ModuleManager", minVersion: "4.0.0" }],
      conflicts: [],
      recommends: [],
      suggests: [],
    },
  });

  const plan = resolveInstallPlan({
    target,
    registryModules: [moduleManager, target],
    inventory: [{ identifier: "ModuleManager", name: "Module Manager", version: "4.2.3", status: "managed" }],
  });

  assert.equal(plan.status, "ok");
  assert.deepEqual(
    plan.toInstall.map((entry) => entry.identifier),
    ["FancyMod"],
  );
  assert.equal(plan.alreadySatisfied[0]?.identifier, "ModuleManager");
});

test("blocks on conflicts and unmet dependencies", () => {
  const target = mod({
    identifier: "FancyMod",
    name: "Fancy Mod",
    version: "2.0.0",
    relationships: {
      depends: [{ kind: "single", name: "MissingLib" }],
      conflicts: [{ kind: "single", name: "OldFancy" }],
      recommends: [],
      suggests: [],
    },
  });

  const plan = resolveInstallPlan({
    target,
    registryModules: [target],
    inventory: [{ identifier: "OldFancy", status: "detected" }],
  });

  assert.equal(plan.status, "blocked");
  assert.equal(plan.unmet.length, 1);
  assert.equal(plan.unmet[0]?.name, "MissingLib");
  assert.equal(plan.conflicts.length, 1);
  assert.equal(plan.conflicts[0]?.conflictingWith, "OldFancy");
});

test("picks the latest compatible dependency version", () => {
  const oldMm = mod({ identifier: "ModuleManager", name: "Module Manager", version: "3.0.0" });
  const midMm = mod({ identifier: "ModuleManager", name: "Module Manager", version: "4.1.0" });
  const newMm = mod({ identifier: "ModuleManager", name: "Module Manager", version: "5.0.0" });
  const target = mod({
    identifier: "FancyMod",
    name: "Fancy Mod",
    version: "1.0.0",
    relationships: {
      depends: [{ kind: "single", name: "ModuleManager", minVersion: "4.0.0", maxVersion: "4.9.9" }],
      conflicts: [],
      recommends: [],
      suggests: [],
    },
  });

  const plan = resolveInstallPlan({
    target,
    registryModules: [oldMm, midMm, newMm, target],
    inventory: [],
  });

  assert.equal(plan.status, "ok");
  assert.equal(plan.toInstall[0]?.identifier, "ModuleManager");
  assert.equal(plan.toInstall[0]?.version, "4.1.0");
});

test("blocks unsupported depends instead of ignoring them", () => {
  const target = mod({
    identifier: "FancyMod",
    name: "Fancy Mod",
    version: "1.0.0",
    relationships: {
      depends: [{ kind: "unsupported", reason: "nested array" }],
      conflicts: [],
      recommends: [],
      suggests: [],
    },
  });

  const plan = resolveInstallPlan({
    target,
    registryModules: [target],
    inventory: [],
  });

  assert.equal(plan.status, "blocked");
  assert.equal(plan.unmet.length, 1);
  assert.match(plan.unmet[0]?.message ?? "", /unsupported dependency/);
});

test("does not treat versionless detected mods as satisfying ranged depends", () => {
  const moduleManager = mod({
    identifier: "ModuleManager",
    name: "Module Manager",
    version: "4.2.3",
    download: "https://example.test/mm.zip",
  });
  const target = mod({
    identifier: "FancyMod",
    name: "Fancy Mod",
    version: "1.0.0",
    relationships: {
      depends: [{ kind: "single", name: "ModuleManager", minVersion: "4.0.0" }],
      conflicts: [],
      recommends: [],
      suggests: [],
    },
  });

  const plan = resolveInstallPlan({
    target,
    registryModules: [moduleManager, target],
    inventory: [{ identifier: "ModuleManager", status: "detected" }],
  });

  assert.equal(plan.status, "ok");
  assert.deepEqual(
    plan.toInstall.map((entry) => entry.identifier),
    ["ModuleManager", "FancyMod"],
  );
});

test("blocks when an installed mod declares a conflict with the target", () => {
  const installedMeta = mod({
    identifier: "OldPack",
    name: "Old Pack",
    version: "1.0.0",
    relationships: {
      depends: [],
      conflicts: [{ kind: "single", name: "FancyMod" }],
      recommends: [],
      suggests: [],
    },
  });
  const target = mod({
    identifier: "FancyMod",
    name: "Fancy Mod",
    version: "2.0.0",
    relationships: {
      depends: [],
      conflicts: [],
      recommends: [],
      suggests: [],
    },
  });

  const plan = resolveInstallPlan({
    target,
    registryModules: [installedMeta, target],
    inventory: [{ identifier: "OldPack", version: "1.0.0", status: "managed" }],
  });

  assert.equal(plan.status, "blocked");
  assert.equal(plan.conflicts.length, 1);
  assert.equal(plan.conflicts[0]?.identifier, "OldPack");
  assert.equal(plan.conflicts[0]?.conflictingWith, "FancyMod");
});

function rels(partial) {
  return { depends: [], conflicts: [], recommends: [], suggests: [], ...partial };
}

function dep(name, range = {}) {
  return { kind: "single", name, ...range };
}

function ids(refs) {
  return refs.map((entry) => entry.identifier);
}

const rssTarget = mod({
  identifier: "RealSolarSystem",
  name: "Real Solar System",
  version: "1.0.0",
  relationships: rels({ depends: [dep("RSSTextures")] }),
});

function rssTextures(resolution, extra = {}) {
  return mod({
    identifier: `RSSTextures${resolution}`,
    name: `RSS Textures ${resolution}`,
    version: "1.0.0",
    provides: ["RSSTextures"],
    ...extra,
  });
}

test("auto-picks the only provider of a virtual dependency", () => {
  const provider = rssTextures(8192);
  const plan = resolveInstallPlan({ target: rssTarget, registryModules: [rssTarget, provider], inventory: [] });

  assert.equal(plan.status, "ok");
  assert.deepEqual(ids(plan.toInstall), ["RSSTextures8192", "RealSolarSystem"]);
  assert.deepEqual(plan.choices, []);
});

test("treats an installed provider as satisfying a virtual dependency", () => {
  const provider = rssTextures(8192);
  const plan = resolveInstallPlan({
    target: rssTarget,
    registryModules: [rssTarget, provider, rssTextures(4096)],
    inventory: [{ identifier: "RSSTextures8192", version: "1.0.0", status: "managed" }],
  });

  assert.equal(plan.status, "ok");
  assert.deepEqual(ids(plan.toInstall), ["RealSolarSystem"]);
  assert.equal(plan.alreadySatisfied[0]?.identifier, "RSSTextures8192");
});

test("asks for a choice when several modules provide a dependency", () => {
  const plan = resolveInstallPlan({
    target: rssTarget,
    registryModules: [rssTarget, rssTextures(8192), rssTextures(4096)],
    inventory: [],
  });

  assert.equal(plan.status, "choice-required");
  assert.deepEqual(plan.choices, [
    {
      key: "RSSTextures",
      label: "RSSTextures",
      requiredBy: ["RealSolarSystem"],
      candidates: [
        { identifier: "RSSTextures4096", name: "RSS Textures 4096", version: "1.0.0", via: "provides" },
        { identifier: "RSSTextures8192", name: "RSS Textures 8192", version: "1.0.0", via: "provides" },
      ],
    },
  ]);
  assert.deepEqual(ids(plan.toInstall), ["RealSolarSystem"]);
});

test("honours a valid choice and resolves its dependencies", () => {
  const kopernicus = mod({ identifier: "Kopernicus", name: "Kopernicus", version: "2.0.0" });
  const chosen = rssTextures(8192, { relationships: rels({ depends: [dep("Kopernicus")] }) });
  const plan = resolveInstallPlan({
    target: rssTarget,
    registryModules: [rssTarget, chosen, rssTextures(4096), kopernicus],
    inventory: [],
    choices: { RSSTextures: "RSSTextures8192" },
  });

  assert.equal(plan.status, "ok");
  assert.deepEqual(ids(plan.toInstall), ["Kopernicus", "RSSTextures8192", "RealSolarSystem"]);
  assert.deepEqual(plan.choices, []);
});

test("reports an invalid choice as unmet", () => {
  const plan = resolveInstallPlan({
    target: rssTarget,
    registryModules: [rssTarget, rssTextures(8192), rssTextures(4096)],
    inventory: [],
    choices: { RSSTextures: "SomethingElse" },
  });

  assert.equal(plan.status, "blocked");
  assert.match(plan.unmet[0]?.message ?? "", /SomethingElse is not a provider of RSSTextures/);
});

test("merges requiredBy for the same choice key", () => {
  const scatterer = mod({
    identifier: "Scatterer",
    name: "Scatterer",
    version: "1.0.0",
    relationships: rels({ depends: [dep("RSSTextures")] }),
  });
  const target = mod({
    identifier: "RSSVisuals",
    name: "RSS Visuals",
    version: "1.0.0",
    relationships: rels({ depends: [dep("Scatterer"), dep("RSSTextures")] }),
  });
  const plan = resolveInstallPlan({
    target,
    registryModules: [target, scatterer, rssTextures(8192), rssTextures(4096)],
    inventory: [],
  });

  assert.equal(plan.status, "choice-required");
  assert.equal(plan.choices.length, 1);
  assert.deepEqual(plan.choices[0]?.requiredBy, ["RSSVisuals", "Scatterer"]);
});

test("terminates on a cycle through provides", () => {
  const target = mod({
    identifier: "A",
    name: "A",
    version: "1.0.0",
    relationships: rels({ depends: [dep("VirtualX")] }),
  });
  const provider = mod({
    identifier: "B",
    name: "B",
    version: "1.0.0",
    provides: ["VirtualX"],
    relationships: rels({ depends: [dep("A")] }),
  });
  const plan = resolveInstallPlan({ target, registryModules: [target, provider], inventory: [] });

  assert.equal(plan.status, "ok");
  assert.deepEqual(new Set(ids(plan.toInstall)), new Set(["A", "B"]));
});

test("lets the target satisfy a virtual name it provides", () => {
  const library = mod({
    identifier: "ConfigLib",
    name: "Config Lib",
    version: "1.0.0",
    relationships: rels({ depends: [dep("EVE-Config")] }),
  });
  const target = mod({
    identifier: "MyVisualPack",
    name: "My Visual Pack",
    version: "1.0.0",
    provides: ["EVE-Config"],
    relationships: rels({ depends: [dep("ConfigLib")] }),
  });
  const otherPack = mod({ identifier: "OtherPack", name: "Other Pack", version: "1.0.0", provides: ["EVE-Config"] });
  const plan = resolveInstallPlan({ target, registryModules: [target, library, otherPack], inventory: [] });

  assert.equal(plan.status, "ok");
  assert.deepEqual(plan.choices, []);
  assert.deepEqual(ids(plan.toInstall), ["ConfigLib", "MyVisualPack"]);
});

test("ignores choices for keys the plan does not ask about", () => {
  const provider = rssTextures(8192);
  const plan = resolveInstallPlan({
    target: rssTarget,
    registryModules: [rssTarget, provider],
    inventory: [],
    choices: { Unrelated: "X" },
  });

  assert.equal(plan.status, "ok");
  assert.deepEqual(plan.unmet, []);
});

test("lets a versionless detected provider satisfy only unranged dependencies", () => {
  const provider = rssTextures(8192, { version: "2.0.0" });
  const registryModules = [provider, rssTextures(4096)];
  const inventory = [{ identifier: "RSSTextures8192", status: "detected" }];
  const unranged = resolveInstallPlan({ target: rssTarget, registryModules: [rssTarget, ...registryModules], inventory });
  const rangedTarget = mod({
    identifier: "RealSolarSystem",
    name: "Real Solar System",
    version: "1.0.0",
    relationships: rels({ depends: [dep("RSSTextures", { minVersion: "1.5.0" })] }),
  });
  const ranged = resolveInstallPlan({ target: rangedTarget, registryModules: [rangedTarget, ...registryModules], inventory });

  assert.equal(unranged.status, "ok");
  assert.equal(unranged.alreadySatisfied[0]?.identifier, "RSSTextures8192");
  assert.equal(ranged.status, "ok");
  assert.deepEqual(ids(ranged.toInstall), ["RSSTextures8192", "RealSolarSystem"]);
  assert.equal(ranged.toInstall[0]?.version, "2.0.0");
});

test("limits candidates to provider versions inside the range", () => {
  const target = mod({
    identifier: "Consumer",
    name: "Consumer",
    version: "1.0.0",
    relationships: rels({ depends: [dep("X", { minVersion: "2.0" })] }),
  });
  const providerA1 = mod({ identifier: "ProviderA", name: "Provider A", version: "1.0", provides: ["X"] });
  const providerA2 = mod({ identifier: "ProviderA", name: "Provider A", version: "2.0", provides: ["X"] });
  const providerB1 = mod({ identifier: "ProviderB", name: "Provider B", version: "1.0", provides: ["X"] });
  const plan = resolveInstallPlan({
    target,
    registryModules: [target, providerA1, providerA2, providerB1],
    inventory: [],
  });

  assert.equal(plan.status, "ok");
  assert.deepEqual(plan.toInstall, [
    { identifier: "ProviderA", name: "Provider A", version: "2.0" },
    { identifier: "Consumer", name: "Consumer", version: "1.0.0" },
  ]);
});
