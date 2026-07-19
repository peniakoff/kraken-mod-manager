import assert from "node:assert/strict";
import test from "node:test";
import { resolveInstallPlan } from "../dist/index.js";

function mod(partial) {
  return {
    authors: ["Tester"],
    tags: ["plugin"],
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
      depends: [{ name: "ModuleManager" }],
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
      depends: [{ name: "SharedLib" }],
      conflicts: [],
      recommends: [{ name: "Toolbar" }],
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
      depends: [{ name: "ModuleManager", minVersion: "4.0.0" }],
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
      depends: [{ name: "MissingLib" }],
      conflicts: [{ name: "OldFancy" }],
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
      depends: [{ name: "ModuleManager", minVersion: "4.0.0", maxVersion: "4.9.9" }],
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
