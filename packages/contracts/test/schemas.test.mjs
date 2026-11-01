import assert from "node:assert/strict";
import test from "node:test";
import {
  apiErrorSchema,
  configResponseSchema,
  directoryListingResponseSchema,
  ckanRelationshipSchema,
  installModRequestSchema,
  installPlanResponseSchema,
  installedModsResponseSchema,
  jobProgressEventSchema,
  jobResponseSchema,
  modDetailsResponseSchema,
  modVersionsResponseSchema,
  modsQuerySchema,
  uninstallPlanResponseSchema,
  uninstallRequestSchema,
  uninstallResponseSchema,
  modsResponseSchema,
  planModRequestSchema,
  registryResponseSchema,
  updateConfigRequestSchema,
} from "../dist/index.js";

test("accepts configured and unconfigured responses", () => {
  assert.equal(configResponseSchema.parse({ configured: false }).configured, false);
  assert.equal(
    configResponseSchema.parse({
      configured: true,
      installation: { path: "/games/KSP", platform: "linux", source: "manual" },
    }).configured,
    true,
  );
});

test("rejects malformed requests and directory responses", () => {
  assert.equal(updateConfigRequestSchema.safeParse({ installationPath: "" }).success, false);
  assert.equal(
    directoryListingResponseSchema.safeParse({ roots: [], currentPath: "", parentPath: null, directories: [] }).success,
    false,
  );
  assert.equal(apiErrorSchema.safeParse({ code: "", message: "Problem" }).success, false);
});

test("accepts registry status and mods responses", () => {
  assert.deepEqual(
    registryResponseSchema.parse({ status: "missing", moduleCount: 0 }),
    { status: "missing", moduleCount: 0 },
  );
  assert.equal(
    registryResponseSchema.parse({
      status: "ready",
      moduleCount: 2,
      updatedAt: "2026-07-17T12:00:00.000Z",
      sourceUrl: "https://example.test/meta.tar.gz",
      parseErrors: 1,
    }).moduleCount,
    2,
  );
  assert.equal(
    modsResponseSchema.parse({
      total: 1,
      mods: [
        {
          identifier: "ModuleManager",
          name: "Module Manager",
          authors: ["sarbian"],
          version: "4.2.3",
          tags: ["plugin"],
          downloadHash: { sha256: "abc" },
          install: [{ file: "GameData/ModuleManager", installTo: "GameData" }],
        },
      ],
    }).total,
    1,
  );
});

test("accepts installed mods and job responses", () => {
  assert.deepEqual(
    installedModsResponseSchema.parse({
      mods: [{ identifier: "ModuleManager", status: "managed", version: "4.2.3", name: "Module Manager" }],
    }).mods[0]?.status,
    "managed",
  );
  assert.equal(installModRequestSchema.parse({}).version, undefined);
  assert.equal(installModRequestSchema.parse({}).installDependencies, false);
  assert.equal(installModRequestSchema.parse({ version: "1.0.0", installDependencies: true }).installDependencies, true);
  assert.equal(
    installPlanResponseSchema.parse({
      status: "ok",
      target: { identifier: "FancyMod", name: "Fancy Mod", version: "1.0.0" },
      toInstall: [
        { identifier: "ModuleManager", name: "Module Manager", version: "4.2.3" },
        { identifier: "FancyMod", name: "Fancy Mod", version: "1.0.0" },
      ],
      alreadySatisfied: [],
      conflicts: [],
      unmet: [],
      optional: [{ kind: "recommends", name: "Toolbar", requiredBy: "FancyMod" }],
    }).status,
    "ok",
  );
  assert.equal(
    jobResponseSchema.parse({
      jobId: "job-1",
      kind: "install",
      identifier: "ModuleManager",
      status: "running",
      phase: "downloading",
      bytesReceived: 10,
      bytesTotal: 100,
    }).phase,
    "downloading",
  );
  assert.equal(
    jobProgressEventSchema.parse({
      jobId: "job-1",
      phase: "extracting",
      status: "running",
    }).phase,
    "extracting",
  );
});

test("applies mods query defaults and rejects invalid limits", () => {
  assert.deepEqual(modsQuerySchema.parse({}), { limit: 50, offset: 0 });
  assert.equal(modsQuerySchema.parse({ q: "mech", limit: "10", offset: "5" }).limit, 10);
  assert.equal(modsQuerySchema.safeParse({ limit: 0 }).success, false);
  assert.equal(modsQuerySchema.safeParse({ limit: 201 }).success, false);
});

test("accepts mod details and mod versions responses with resources, description and license", () => {
  const modData = {
    identifier: "ModuleManager",
    name: "Module Manager",
    abstract: "Modifies game configs",
    description: "Detailed description of Module Manager and what it does.",
    license: "CC-BY-SA",
    authors: ["sarbian", "ialdabaoth"],
    version: "4.2.3",
    tags: ["plugin"],
    resources: {
      homepage: "https://forum.kerbalspaceprogram.com/topic/50533-module-manager/",
      repository: "https://github.com/sarbian/ModuleManager",
      bugtracker: "https://github.com/sarbian/ModuleManager/issues",
    },
  };

  const details = modDetailsResponseSchema.parse({ mod: modData });
  assert.equal(details.mod.identifier, "ModuleManager");
  assert.equal(details.mod.description, "Detailed description of Module Manager and what it does.");
  assert.equal(details.mod.license, "CC-BY-SA");
  assert.equal(details.mod.resources?.homepage, "https://forum.kerbalspaceprogram.com/topic/50533-module-manager/");

  const versions = modVersionsResponseSchema.parse({
    identifier: "ModuleManager",
    versions: [modData, { ...modData, version: "4.2.2" }],
  });
  assert.equal(versions.identifier, "ModuleManager");
  assert.equal(versions.versions.length, 2);
});

test("accepts bounded install choices and rejects oversized ones", () => {
  const valid = { RSSTextures: "RSSTextures8192" };
  assert.deepEqual(planModRequestSchema.parse({ choices: valid }).choices, valid);
  assert.deepEqual(installModRequestSchema.parse({ installDependencies: true, choices: valid }).choices, valid);

  const tooMany = Object.fromEntries(Array.from({ length: 65 }, (_, index) => [`key${index}`, "value"]));
  assert.equal(planModRequestSchema.safeParse({ choices: tooMany }).success, false);
  assert.equal(installModRequestSchema.safeParse({ choices: tooMany }).success, false);
  assert.equal(planModRequestSchema.safeParse({ choices: { RSSTextures: "" } }).success, false);
  assert.equal(planModRequestSchema.safeParse({ choices: { ["k".repeat(257)]: "value" } }).success, false);
  assert.equal(planModRequestSchema.safeParse({ choices: { RSSTextures: "v".repeat(257) } }).success, false);
});

test("accepts a choice-required plan response", () => {
  const plan = installPlanResponseSchema.parse({
    status: "choice-required",
    target: { identifier: "RealSolarSystem", name: "Real Solar System", version: "1.0.0" },
    toInstall: [{ identifier: "RealSolarSystem", name: "Real Solar System", version: "1.0.0" }],
    alreadySatisfied: [],
    conflicts: [],
    unmet: [],
    optional: [],
    choices: [
      {
        key: "RSSTextures",
        label: "RSSTextures",
        requiredBy: ["RealSolarSystem"],
        candidates: [
          { identifier: "RSSTextures4096", name: "RSS Textures 4096", version: "1.0.0", via: "provides" },
          { identifier: "RSSTextures8192", name: "RSS Textures 8192", version: "1.0.0", via: "provides" },
        ],
      },
    ],
  });

  assert.equal(plan.choices[0]?.candidates.length, 2);
});

test("accepts the relationship union and rejects untagged relationships", () => {
  assert.equal(ckanRelationshipSchema.safeParse({ kind: "single", name: "A", minVersion: "1.0" }).success, true);
  assert.equal(
    ckanRelationshipSchema.safeParse({ kind: "anyOf", alternatives: [{ kind: "single", name: "A" }] }).success,
    true,
  );
  assert.equal(ckanRelationshipSchema.safeParse({ kind: "unsupported", reason: "nested array" }).success, true);
  assert.equal(ckanRelationshipSchema.safeParse({ name: "A" }).success, false);
});

test("defaults uninstall alsoRemove to an empty list and bounds it", () => {
  assert.deepEqual(uninstallRequestSchema.parse({}), { alsoRemove: [] });
  assert.deepEqual(uninstallRequestSchema.parse({ alsoRemove: ["A"] }), { alsoRemove: ["A"] });
  assert.equal(uninstallRequestSchema.safeParse({ alsoRemove: Array.from({ length: 256 }, (_, i) => `M${i}`) }).success, true);
  assert.equal(uninstallRequestSchema.safeParse({ alsoRemove: Array.from({ length: 257 }, (_, i) => `M${i}`) }).success, false);
  assert.equal(uninstallRequestSchema.safeParse({ alsoRemove: [""] }).success, false);
  assert.equal(uninstallRequestSchema.safeParse({ alsoRemove: ["x".repeat(257)] }).success, false);
});

test("accepts an uninstall plan and an uninstall result", () => {
  const plan = uninstallPlanResponseSchema.parse({
    target: { identifier: "ModuleManager", name: "Module Manager", version: "4.2.3" },
    dependents: [{ identifier: "DependentMod", name: "Dependent Mod", version: "1.0.0" }],
    orphans: [{ identifier: "Lib", name: "Lib" }],
    brokenUnmanaged: [{ identifier: "Detected", name: "Detected" }],
    warnings: ["something"],
  });
  assert.equal(plan.dependents[0]?.identifier, "DependentMod");
  assert.equal(uninstallPlanResponseSchema.safeParse({ target: { identifier: "A", name: "A" } }).success, false);
  assert.deepEqual(uninstallResponseSchema.parse({ removed: ["A", "B"] }), { removed: ["A", "B"] });
});
