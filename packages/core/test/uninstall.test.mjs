import assert from "node:assert/strict";
import test from "node:test";
import { planUninstall, validateUninstallSelection } from "../dist/index.js";

const EMPTY_REGISTRY_WARNING =
  "The CKAN registry is not loaded, so Kraken cannot check which mods depend on this one.";

function mod(identifier, partial = {}) {
  return {
    identifier,
    name: identifier,
    version: "1.0.0",
    authors: ["Tester"],
    tags: [],
    provides: [],
    ...partial,
  };
}

function dep(name, range = {}) {
  return { kind: "single", name, ...range };
}

function rels(depends) {
  return { depends, conflicts: [], recommends: [], suggests: [] };
}

function managedRecord(identifier, autoInstalled = false, files = [`GameData/${identifier}/plugin.dll`]) {
  return { identifier, name: identifier, version: "1.0.0", installationPath: "/ksp", files, autoInstalled };
}

/** Builds options from managed records and detected identifiers, with every mod in the registry. */
function options(targetIdentifier, { managed = [], detected = [], registry }) {
  const inventory = [
    ...managed.map((record) => ({
      identifier: record.identifier,
      name: record.name,
      version: record.version,
      status: "managed",
      files: record.files,
    })),
    ...detected.map((identifier) => ({ identifier, name: identifier, status: "detected" })),
  ].sort((left, right) => left.identifier.localeCompare(right.identifier));
  return { targetIdentifier, managed, inventory, registryModules: registry };
}

const ids = (refs) => refs.map((ref) => ref.identifier);

test("removes transitive dependents", () => {
  const plan = planUninstall(
    options("MM", {
      managed: [managedRecord("MM"), managedRecord("A"), managedRecord("B")],
      registry: [mod("MM"), mod("A", { relationships: rels([dep("MM")]) }), mod("B", { relationships: rels([dep("A")]) })],
    }),
  );

  assert.deepEqual(plan.target, { identifier: "MM", name: "MM", version: "1.0.0" });
  assert.deepEqual(ids(plan.dependents), ["A", "B"]);
  assert.deepEqual(plan.orphans, []);
  assert.deepEqual(plan.brokenUnmanaged, []);
  assert.deepEqual(plan.warnings, []);
});

test("keeps a mod whose dependency another installed provider still satisfies", () => {
  const plan = planUninstall(
    options("P1", {
      managed: [managedRecord("A"), managedRecord("P1"), managedRecord("P2")],
      registry: [
        mod("A", { relationships: rels([dep("X")]) }),
        mod("P1", { provides: ["X"] }),
        mod("P2", { provides: ["X"] }),
      ],
    }),
  );

  assert.deepEqual(plan.dependents, []);
});

test("treats any_of as satisfied by a remaining alternative", () => {
  const plan = planUninstall(
    options("EVE", {
      managed: [managedRecord("A"), managedRecord("EVE"), managedRecord("SVE")],
      registry: [
        mod("A", { relationships: rels([{ kind: "anyOf", alternatives: [dep("EVE"), dep("SVE")] }]) }),
        mod("EVE"),
        mod("SVE"),
      ],
    }),
  );

  assert.deepEqual(plan.dependents, []);
});

test("removes a dependent whose any_of loses its last alternative", () => {
  const plan = planUninstall(
    options("EVE", {
      managed: [managedRecord("A"), managedRecord("EVE")],
      registry: [
        mod("A", { relationships: rels([{ kind: "anyOf", alternatives: [dep("EVE"), dep("SVE")] }]) }),
        mod("EVE"),
        mod("SVE"),
      ],
    }),
  );

  assert.deepEqual(ids(plan.dependents), ["A"]);
});

test("ignores a relationship that was already broken", () => {
  const plan = planUninstall(
    options("MM", {
      managed: [managedRecord("A"), managedRecord("MM")],
      registry: [mod("A", { relationships: rels([dep("Missing")]) }), mod("MM")],
    }),
  );

  assert.deepEqual(plan.dependents, []);
});

test("ignores a provider whose version is outside the range", () => {
  const plan = planUninstall(
    options("MM", {
      managed: [managedRecord("A"), managedRecord("MM")],
      registry: [mod("A", { relationships: rels([dep("MM", { minVersion: "2.0.0" })]) }), mod("MM")],
    }),
  );

  assert.deepEqual(plan.dependents, []);
});

test("reports detected dependents as broken without following them", () => {
  const plan = planUninstall(
    options("MM", {
      managed: [managedRecord("E"), managedRecord("MM")],
      detected: ["D"],
      registry: [mod("D", { relationships: rels([dep("MM")]) }), mod("E", { relationships: rels([dep("D")]) }), mod("MM")],
    }),
  );

  assert.deepEqual(ids(plan.brokenUnmanaged), ["D"]);
  assert.deepEqual(plan.dependents, []);
});

test("offers an orphan chain of auto-installed dependencies", () => {
  const plan = planUninstall(
    options("T", {
      managed: [managedRecord("L1", true), managedRecord("L2", true), managedRecord("T")],
      registry: [mod("L1", { relationships: rels([dep("L2")]) }), mod("L2"), mod("T", { relationships: rels([dep("L1")]) })],
    }),
  );

  assert.deepEqual(ids(plan.orphans), ["L1", "L2"]);
});

test("finds orphans whose dependent sorts after them", () => {
  const plan = planUninstall(
    options("T", {
      managed: [managedRecord("A2", true), managedRecord("Z1", true), managedRecord("T")],
      registry: [mod("A2"), mod("Z1", { relationships: rels([dep("A2")]) }), mod("T", { relationships: rels([dep("Z1")]) })],
    }),
  );

  assert.deepEqual(ids(plan.orphans), ["Z1", "A2"]);
});

test("never offers manually installed dependencies as orphans", () => {
  const plan = planUninstall(
    options("T", {
      managed: [managedRecord("L1", false), managedRecord("T")],
      registry: [mod("L1"), mod("T", { relationships: rels([dep("L1")]) })],
    }),
  );

  assert.deepEqual(plan.orphans, []);
});

test("offers only one of two redundant auto-installed providers", () => {
  const plan = planUninstall(
    options("T", {
      managed: [managedRecord("A"), managedRecord("P1", true), managedRecord("P2", true), managedRecord("T")],
      registry: [
        mod("A", { relationships: rels([dep("X")]) }),
        mod("P1", { provides: ["X"] }),
        mod("P2", { provides: ["X"] }),
        mod("T"),
      ],
    }),
  );

  assert.deepEqual(ids(plan.orphans), ["P1"]);
});

test("does not offer an orphan whose removal breaks a detected mod", () => {
  const plan = planUninstall(
    options("T", {
      managed: [managedRecord("L1", true), managedRecord("T")],
      detected: ["D"],
      registry: [mod("D", { relationships: rels([dep("L1")]) }), mod("L1"), mod("T", { relationships: rels([dep("L1")]) })],
    }),
  );

  assert.deepEqual(plan.orphans, []);
  assert.deepEqual(plan.brokenUnmanaged, []);
});

test("still offers orphans when the target breaks a detected mod", () => {
  const plan = planUninstall(
    options("T", {
      managed: [managedRecord("L1", true), managedRecord("T")],
      detected: ["D"],
      registry: [mod("D", { relationships: rels([dep("T")]) }), mod("L1"), mod("T", { relationships: rels([dep("L1")]) })],
    }),
  );

  assert.deepEqual(ids(plan.brokenUnmanaged), ["D"]);
  assert.deepEqual(ids(plan.orphans), ["L1"]);
});

test("does not let a mod satisfy its own dependency through provides", () => {
  const plan = planUninstall(
    options("P", {
      managed: [managedRecord("A"), managedRecord("P")],
      registry: [mod("A", { provides: ["X"], relationships: rels([dep("X")]) }), mod("P", { provides: ["X"] })],
    }),
  );

  assert.deepEqual(ids(plan.dependents), ["A"]);
});

test("does not report the target's own folder as broken", () => {
  const plan = planUninstall(
    options("T", {
      managed: [managedRecord("T", false, ["GameData/T/plugin.dll", "GameData/TExtra/extra.cfg"])],
      detected: ["TExtra"],
      registry: [mod("T"), mod("TExtra", { relationships: rels([dep("T")]) })],
    }),
  );

  assert.deepEqual(plan.brokenUnmanaged, []);
  assert.deepEqual(plan.dependents, []);
});

test("skips dependents without registry metadata", () => {
  const plan = planUninstall(
    options("MM", {
      managed: [managedRecord("Gone"), managedRecord("MM")],
      registry: [mod("MM")],
    }),
  );

  assert.deepEqual(plan.dependents, []);
});

test("warns when the registry is empty", () => {
  const plan = planUninstall(
    options("MM", {
      managed: [managedRecord("A", true), managedRecord("MM")],
      registry: [],
    }),
  );

  assert.deepEqual(plan.warnings, [EMPTY_REGISTRY_WARNING]);
  assert.deepEqual(plan.dependents, []);
  assert.deepEqual(plan.orphans, []);
  assert.deepEqual(plan.brokenUnmanaged, []);
});

test("throws when the target is not managed", () => {
  assert.throws(
    () => planUninstall(options("Nope", { managed: [managedRecord("MM")], registry: [mod("MM")] })),
    /Nope is not managed/,
  );
});

function chainOptions() {
  return options("MM", {
    managed: [managedRecord("A"), managedRecord("B"), managedRecord("MM"), managedRecord("O", true)],
    registry: [
      mod("A", { relationships: rels([dep("MM")]) }),
      mod("B", { relationships: rels([dep("A")]) }),
      mod("MM"),
      mod("O"),
    ],
  });
}

test("rejects a selection missing a dependent", () => {
  const chain = chainOptions();
  const result = validateUninstallSelection(planUninstall(chain), ["B"], chain);

  assert.equal(result.ok, false);
  assert.match(result.problems[0], /A depends on MM and must be removed too/);
});

test("rejects identifiers that are neither dependents nor orphans", () => {
  const chain = chainOptions();
  const result = validateUninstallSelection(planUninstall(chain), ["A", "B", "Foreign"], chain);

  assert.equal(result.ok, false);
  assert.match(result.problems.join(" "), /Foreign is not part of this uninstall/);
});

test("rejects deselecting an orphan another removal still needs", () => {
  const chain = options("T", {
    managed: [managedRecord("L1", true), managedRecord("L2", true), managedRecord("T")],
    registry: [mod("L1", { relationships: rels([dep("L2")]) }), mod("L2"), mod("T", { relationships: rels([dep("L1")]) })],
  });
  const result = validateUninstallSelection(planUninstall(chain), ["L2"], chain);

  assert.equal(result.ok, false);
  assert.match(result.problems.join(" "), /L1 needs L2/);
});

test("accepts repeated identifiers and the target", () => {
  const chain = chainOptions();
  const result = validateUninstallSelection(planUninstall(chain), ["A", "B", "A", "MM", "O", "O"], chain);

  assert.equal(result.ok, true);
  assert.deepEqual(result.removeOrder, ["B", "A", "MM", "O"]);
});

test("orders removals dependents first", () => {
  const chain = chainOptions();
  const result = validateUninstallSelection(planUninstall(chain), ["O", "B", "A"], chain);

  assert.equal(result.ok, true);
  assert.deepEqual(result.removeOrder, ["B", "A", "MM", "O"]);
});

test("keeps deselected orphans out of the removal order", () => {
  const chain = chainOptions();
  const result = validateUninstallSelection(planUninstall(chain), ["A", "B"], chain);

  assert.equal(result.ok, true);
  assert.deepEqual(result.removeOrder, ["B", "A", "MM"]);
});
