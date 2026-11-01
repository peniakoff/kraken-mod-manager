/**
 * Pragmatic install-plan resolver for CKAN depends/conflicts.
 * Not a full SAT solver — transitive BFS with latest-compatible version picks.
 */

import {
  compareCkanVersions,
  type CkanModule,
  type CkanRelationship,
  type CkanSingleRelationship,
} from "./ckan.js";
import type { InstalledModSummary } from "./install.js";
import { ProviderIndex, versionInRange, type ProviderCandidate } from "./providers.js";

export type InstallPlanStatus = "ok" | "choice-required" | "blocked";

export interface InstallPlanModuleRef {
  identifier: string;
  name: string;
  version: string;
}

export interface InstallPlanSatisfied {
  identifier: string;
  name?: string;
  version?: string;
  reason: "managed" | "detected" | "planned";
}

export interface InstallPlanConflict {
  identifier: string;
  conflictingWith: string;
  message: string;
}

export interface InstallPlanUnmet {
  name: string;
  minVersion?: string;
  maxVersion?: string;
  requiredBy: string;
  message: string;
}

export interface InstallPlanOptional {
  kind: "recommends" | "suggests";
  name: string;
  minVersion?: string;
  maxVersion?: string;
  requiredBy: string;
}

export interface InstallPlanChoiceCandidate extends InstallPlanModuleRef {
  via: "identifier" | "provides";
}

/** A dependency several modules can satisfy; the user picks one by `key`. */
export interface InstallPlanChoice {
  key: string;
  label: string;
  requiredBy: string[];
  candidates: InstallPlanChoiceCandidate[];
}

export interface InstallPlan {
  status: InstallPlanStatus;
  target: InstallPlanModuleRef;
  toInstall: InstallPlanModuleRef[];
  alreadySatisfied: InstallPlanSatisfied[];
  conflicts: InstallPlanConflict[];
  unmet: InstallPlanUnmet[];
  optional: InstallPlanOptional[];
  choices: InstallPlanChoice[];
}

export interface ResolveInstallPlanOptions {
  target: CkanModule;
  /** All known registry modules (all versions). */
  registryModules: readonly CkanModule[];
  inventory: readonly InstalledModSummary[];
  /** User-selected provider identifiers keyed by `InstallPlanChoice.key`. */
  choices?: Readonly<Record<string, string>>;
}

interface PendingChoice {
  choice: InstallPlanChoice;
  relation: CkanSingleRelationship;
  requiredBy: Set<string>;
}

export function resolveInstallPlan(options: ResolveInstallPlanOptions): InstallPlan {
  const { target, registryModules, inventory, choices = {} } = options;
  const byIdentifier = indexByIdentifier(registryModules);
  const providers = new ProviderIndex(registryModules);
  const installed = new Map(inventory.map((mod) => [mod.identifier, mod]));

  const planned = new Map<string, CkanModule>();
  const alreadySatisfied: InstallPlanSatisfied[] = [];
  const conflicts: InstallPlanConflict[] = [];
  const unmet: InstallPlanUnmet[] = [];
  const optional: InstallPlanOptional[] = [];
  const pendingChoices = new Map<string, PendingChoice>();
  const satisfiedNames = new Set<string>();
  const visiting = new Set<string>();

  function noteSatisfied(mod: InstalledModSummary, reason: "managed" | "detected"): void {
    if (satisfiedNames.has(mod.identifier)) {
      return;
    }
    satisfiedNames.add(mod.identifier);
    alreadySatisfied.push({
      identifier: mod.identifier,
      ...(mod.name !== undefined ? { name: mod.name } : {}),
      ...(mod.version !== undefined ? { version: mod.version } : {}),
      reason,
    });
  }

  function installedMetadata(mod: InstalledModSummary): CkanModule | undefined {
    return findInstalledMetadata(byIdentifier.get(mod.identifier) ?? [], mod);
  }

  function findInstalledSatisfier(relation: CkanSingleRelationship): InstalledModSummary | undefined {
    const direct = installed.get(relation.name);
    if (direct !== undefined && versionMatchesInstalled(direct, relation, "depends")) {
      return direct;
    }
    for (const mod of installed.values()) {
      if (mod === direct) {
        continue;
      }
      const meta = installedMetadata(mod);
      if (meta !== undefined && meta.provides.includes(relation.name) && versionMatchesInstalled(mod, relation, "depends")) {
        return mod;
      }
    }
    return undefined;
  }

  function collectOptional(module: CkanModule): void {
    const relationships = module.relationships;
    if (relationships === undefined) {
      return;
    }
    for (const relation of relationships.recommends) {
      if (relation.kind !== "single") {
        continue;
      }
      optional.push({
        kind: "recommends",
        name: relation.name,
        ...(relation.minVersion !== undefined ? { minVersion: relation.minVersion } : {}),
        ...(relation.maxVersion !== undefined ? { maxVersion: relation.maxVersion } : {}),
        requiredBy: module.identifier,
      });
    }
    for (const relation of relationships.suggests) {
      if (relation.kind !== "single") {
        continue;
      }
      optional.push({
        kind: "suggests",
        name: relation.name,
        ...(relation.minVersion !== undefined ? { minVersion: relation.minVersion } : {}),
        ...(relation.maxVersion !== undefined ? { maxVersion: relation.maxVersion } : {}),
        requiredBy: module.identifier,
      });
    }
  }

  function checkConflicts(module: CkanModule): void {
    const relationships = module.relationships;
    if (relationships === undefined) {
      return;
    }
    for (const relation of relationships.conflicts) {
      if (relation.kind !== "single") {
        const reason = describeUnresolvable(relation);
        conflicts.push({
          identifier: module.identifier,
          conflictingWith: reason,
          message: `${module.identifier} declares an unsupported conflict relationship (${reason}) that Kraken cannot evaluate yet.`,
        });
        continue;
      }
      const installedMatch = installed.get(relation.name);
      if (installedMatch !== undefined && versionMatchesInstalled(installedMatch, relation, "conflicts")) {
        conflicts.push({
          identifier: module.identifier,
          conflictingWith: relation.name,
          message: `${module.identifier} conflicts with installed ${relation.name}.`,
        });
      }
      const plannedMatch = planned.get(relation.name);
      if (plannedMatch !== undefined && versionMatchesModule(plannedMatch, relation)) {
        conflicts.push({
          identifier: module.identifier,
          conflictingWith: relation.name,
          message: `${module.identifier} conflicts with planned ${relation.name} ${plannedMatch.version}.`,
        });
      }
      if (relation.name === target.identifier && versionMatchesModule(target, relation)) {
        conflicts.push({
          identifier: module.identifier,
          conflictingWith: target.identifier,
          message: `${module.identifier} conflicts with target ${target.identifier}.`,
        });
      }
    }
  }

  function checkInstalledModuleConflicts(): void {
    for (const installedMod of installed.values()) {
      const meta = installedMetadata(installedMod);
      if (meta === undefined) {
        continue;
      }
      for (const relation of meta.relationships?.conflicts ?? []) {
        if (relation.kind !== "single") {
          continue;
        }
        if (relation.name === target.identifier && versionMatchesModule(target, relation)) {
          conflicts.push({
            identifier: meta.identifier,
            conflictingWith: target.identifier,
            message: `Installed ${meta.identifier} conflicts with target ${target.identifier}.`,
          });
        }
        const plannedMatch = planned.get(relation.name);
        if (plannedMatch !== undefined && versionMatchesModule(plannedMatch, relation)) {
          conflicts.push({
            identifier: meta.identifier,
            conflictingWith: relation.name,
            message: `Installed ${meta.identifier} conflicts with planned ${relation.name} ${plannedMatch.version}.`,
          });
        }
      }
    }
  }

  function planModule(module: CkanModule): void {
    planned.set(module.identifier, module);
    resolveDepends(module);
  }

  function addPendingChoice(
    key: string,
    label: string,
    relation: CkanSingleRelationship,
    requiredBy: string,
    candidates: readonly ProviderCandidate[],
  ): void {
    const existing = pendingChoices.get(key);
    if (existing !== undefined) {
      existing.requiredBy.add(requiredBy);
      return;
    }
    pendingChoices.set(key, {
      relation,
      requiredBy: new Set([requiredBy]),
      choice: {
        key,
        label,
        requiredBy: [],
        candidates: candidates.map((candidate) => ({ ...toRef(candidate.module), via: candidate.via })),
      },
    });
  }

  function resolveSingle(module: CkanModule, relation: CkanSingleRelationship): void {
    if (ProviderIndex.satisfiesName(module, relation.name)) {
      return;
    }

    const installedMatch = findInstalledSatisfier(relation);
    if (installedMatch !== undefined) {
      noteSatisfied(installedMatch, installedMatch.status);
      return;
    }

    const plannedByName = planned.get(relation.name);
    if (plannedByName !== undefined && !versionMatchesModule(plannedByName, relation)) {
      unmet.push({
        name: relation.name,
        ...rangeOf(relation),
        requiredBy: module.identifier,
        message: `Planned ${relation.name} ${plannedByName.version} does not satisfy constraints required by ${module.identifier}.`,
      });
      return;
    }
    for (const candidate of [...planned.values(), target]) {
      if (ProviderIndex.satisfiesName(candidate, relation.name) && versionMatchesModule(candidate, relation)) {
        return;
      }
    }

    const key = relation.name;
    const candidates = providers.candidates(relation);
    // Object.hasOwn keeps keys like "constructor" from resolving to prototype members.
    const chosen = Object.hasOwn(choices, key) ? choices[key] : undefined;
    if (chosen !== undefined) {
      const pick = candidates.find((candidate) => candidate.module.identifier === chosen);
      if (pick === undefined) {
        unmet.push({
          name: relation.name,
          ...rangeOf(relation),
          requiredBy: module.identifier,
          message: `${chosen} is not a provider of ${key} compatible with ${module.identifier}.`,
        });
        return;
      }
      planModule(pick.module);
      return;
    }

    const [only, ...others] = candidates;
    if (only === undefined) {
      unmet.push({
        name: relation.name,
        ...rangeOf(relation),
        requiredBy: module.identifier,
        message: `No compatible version of ${relation.name} found in the registry for ${module.identifier}.`,
      });
      return;
    }
    if (others.length === 0) {
      planModule(only.module);
      return;
    }
    addPendingChoice(key, key, relation, module.identifier, candidates);
  }

  function resolveDepends(module: CkanModule): void {
    if (visiting.has(module.identifier)) {
      return;
    }
    visiting.add(module.identifier);
    collectOptional(module);
    checkConflicts(module);

    for (const relation of module.relationships?.depends ?? []) {
      switch (relation.kind) {
        case "single":
          resolveSingle(module, relation);
          break;
        case "anyOf":
        case "unsupported": {
          const reason = describeUnresolvable(relation);
          unmet.push({
            name: reason,
            requiredBy: module.identifier,
            message: `${module.identifier} has an unsupported dependency relationship (${reason}) that Kraken cannot resolve yet.`,
          });
          break;
        }
        default: {
          const exhaustive: never = relation;
          throw new Error(`Unknown relationship kind: ${JSON.stringify(exhaustive)}`);
        }
      }
    }

    visiting.delete(module.identifier);
  }

  resolveDepends(target);
  checkInstalledModuleConflicts();

  // A choice raised early can be settled by a provider planned later in the walk.
  const choicesOut: InstallPlanChoice[] = [];
  for (const pending of pendingChoices.values()) {
    const settled = [...planned.values(), target].some(
      (module) => ProviderIndex.satisfiesName(module, pending.relation.name) && versionMatchesModule(module, pending.relation),
    );
    if (!settled) {
      choicesOut.push({ ...pending.choice, requiredBy: [...pending.requiredBy].sort((left, right) => left.localeCompare(right)) });
    }
  }

  // Target is always part of the install set (reinstall / primary install).
  const toInstall = topologicalInstallOrder([...planned.values(), target]);

  const status: InstallPlanStatus =
    conflicts.length > 0 || unmet.length > 0 ? "blocked" : choicesOut.length > 0 ? "choice-required" : "ok";

  return {
    status,
    target: toRef(target),
    toInstall,
    alreadySatisfied,
    conflicts,
    unmet,
    optional,
    choices: choicesOut,
  };
}

function rangeOf(relation: CkanSingleRelationship): { minVersion?: string; maxVersion?: string } {
  return {
    ...(relation.minVersion !== undefined ? { minVersion: relation.minVersion } : {}),
    ...(relation.maxVersion !== undefined ? { maxVersion: relation.maxVersion } : {}),
  };
}

function indexByIdentifier(modules: readonly CkanModule[]): Map<string, CkanModule[]> {
  const map = new Map<string, CkanModule[]>();
  for (const module of modules) {
    const list = map.get(module.identifier);
    if (list === undefined) {
      map.set(module.identifier, [module]);
    } else {
      list.push(module);
    }
  }
  return map;
}

function findInstalledMetadata(
  candidates: readonly CkanModule[],
  installedMod: InstalledModSummary,
): CkanModule | undefined {
  if (candidates.length === 0) {
    return undefined;
  }
  if (installedMod.version !== undefined) {
    const exact = candidates.find((module) => module.version === installedMod.version);
    if (exact !== undefined) {
      return exact;
    }
  }
  return candidates.reduce((best, current) =>
    compareCkanVersions(current.version, best.version) > 0 ? current : best,
  );
}

function versionMatchesModule(module: CkanModule, relation: CkanSingleRelationship): boolean {
  return versionInRange(module.version, relation.minVersion, relation.maxVersion);
}

function versionMatchesInstalled(
  mod: InstalledModSummary,
  relation: CkanSingleRelationship,
  mode: "depends" | "conflicts",
): boolean {
  if (mod.version === undefined) {
    if (mode === "conflicts") {
      // No version on a detected mod: treat presence as enough to block.
      return true;
    }
    // Detected without version cannot satisfy ranged depends.
    return relation.minVersion === undefined && relation.maxVersion === undefined;
  }
  return versionInRange(mod.version, relation.minVersion, relation.maxVersion);
}

function describeUnresolvable(relation: Exclude<CkanRelationship, CkanSingleRelationship>): string {
  switch (relation.kind) {
    case "anyOf":
      return "any_of";
    case "unsupported":
      return relation.reason;
    default: {
      const exhaustive: never = relation;
      throw new Error(`Unknown relationship kind: ${JSON.stringify(exhaustive)}`);
    }
  }
}

function dependencyNames(module: CkanModule): string[] {
  const names: string[] = [];
  for (const relation of module.relationships?.depends ?? []) {
    if (relation.kind === "single") {
      names.push(relation.name);
    } else if (relation.kind === "anyOf") {
      names.push(...relation.alternatives.map((alternative) => alternative.name));
    }
  }
  return names;
}

function toRef(module: CkanModule): InstallPlanModuleRef {
  return {
    identifier: module.identifier,
    name: module.name,
    version: module.version,
  };
}

/**
 * Dependencies before dependents. Falls back to input order when cycles exist
 * (cycles are already skipped via `visiting` during resolution).
 */
function topologicalInstallOrder(modules: readonly CkanModule[]): InstallPlanModuleRef[] {
  const byId = new Map(modules.map((module) => [module.identifier, module]));
  const ids = new Set(byId.keys());
  const indegree = new Map<string, number>();
  const edges = new Map<string, string[]>();

  for (const id of ids) {
    indegree.set(id, 0);
    edges.set(id, []);
  }

  for (const module of modules) {
    const providerIds = new Set<string>();
    for (const name of dependencyNames(module)) {
      for (const candidate of modules) {
        if (candidate.identifier !== module.identifier && ProviderIndex.satisfiesName(candidate, name)) {
          providerIds.add(candidate.identifier);
        }
      }
    }
    for (const providerId of providerIds) {
      edges.get(providerId)?.push(module.identifier);
      indegree.set(module.identifier, (indegree.get(module.identifier) ?? 0) + 1);
    }
  }

  const queue = [...ids].filter((id) => (indegree.get(id) ?? 0) === 0).sort((left, right) => left.localeCompare(right));
  const ordered: InstallPlanModuleRef[] = [];

  while (queue.length > 0) {
    const id = queue.shift()!;
    const module = byId.get(id);
    if (module !== undefined) {
      ordered.push(toRef(module));
    }
    for (const next of edges.get(id) ?? []) {
      const nextDegree = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, nextDegree);
      if (nextDegree === 0) {
        queue.push(next);
        queue.sort((left, right) => left.localeCompare(right));
      }
    }
  }

  if (ordered.length !== modules.length) {
    for (const module of modules) {
      if (!ordered.some((entry) => entry.identifier === module.identifier)) {
        ordered.push(toRef(module));
      }
    }
  }

  return ordered;
}
