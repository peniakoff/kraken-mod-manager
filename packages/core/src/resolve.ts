/**
 * Pragmatic install-plan resolver for CKAN depends/conflicts.
 * Not a full SAT solver — transitive BFS with latest-compatible version picks.
 */

import {
  compareCkanVersions,
  type CkanModule,
  type CkanRelationship,
} from "./ckan.js";
import type { InstalledModSummary } from "./install.js";

export type InstallPlanStatus = "ok" | "blocked";

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

export interface InstallPlan {
  status: InstallPlanStatus;
  target: InstallPlanModuleRef;
  toInstall: InstallPlanModuleRef[];
  alreadySatisfied: InstallPlanSatisfied[];
  conflicts: InstallPlanConflict[];
  unmet: InstallPlanUnmet[];
  optional: InstallPlanOptional[];
}

export interface ResolveInstallPlanOptions {
  target: CkanModule;
  /** All known registry modules (all versions). */
  registryModules: readonly CkanModule[];
  inventory: readonly InstalledModSummary[];
}

export function resolveInstallPlan(options: ResolveInstallPlanOptions): InstallPlan {
  const { target, registryModules, inventory } = options;
  const byIdentifier = indexByIdentifier(registryModules);
  const installed = new Map(inventory.map((mod) => [mod.identifier, mod]));

  const planned = new Map<string, CkanModule>();
  const alreadySatisfied: InstallPlanSatisfied[] = [];
  const conflicts: InstallPlanConflict[] = [];
  const unmet: InstallPlanUnmet[] = [];
  const optional: InstallPlanOptional[] = [];
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

  function collectOptional(module: CkanModule): void {
    const relationships = module.relationships;
    if (relationships === undefined) {
      return;
    }
    for (const relation of relationships.recommends) {
      if (relation.unsupported) {
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
      if (relation.unsupported) {
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
      if (relation.unsupported) {
        conflicts.push({
          identifier: module.identifier,
          conflictingWith: relation.name,
          message: `${module.identifier} declares an unsupported conflict relationship (${relation.name}) that Kraken cannot evaluate yet.`,
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
    for (const [identifier, installedMod] of installed) {
      const meta = findInstalledMetadata(byIdentifier.get(identifier) ?? [], installedMod);
      if (meta === undefined) {
        continue;
      }
      for (const relation of meta.relationships?.conflicts ?? []) {
        if (relation.unsupported) {
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

  function resolveDepends(module: CkanModule): void {
    if (visiting.has(module.identifier)) {
      return;
    }
    visiting.add(module.identifier);
    collectOptional(module);
    checkConflicts(module);

    const depends = module.relationships?.depends ?? [];
    for (const relation of depends) {
      if (relation.unsupported) {
        unmet.push({
          name: relation.name,
          requiredBy: module.identifier,
          message: `${module.identifier} has an unsupported dependency relationship (${relation.name}) that Kraken cannot resolve yet.`,
        });
        continue;
      }

      if (relation.name === module.identifier) {
        continue;
      }

      const installedMatch = installed.get(relation.name);
      if (installedMatch !== undefined && versionMatchesInstalled(installedMatch, relation, "depends")) {
        noteSatisfied(installedMatch, installedMatch.status);
        continue;
      }

      const plannedMatch = planned.get(relation.name);
      if (plannedMatch !== undefined) {
        if (!versionMatchesModule(plannedMatch, relation)) {
          unmet.push({
            name: relation.name,
            ...(relation.minVersion !== undefined ? { minVersion: relation.minVersion } : {}),
            ...(relation.maxVersion !== undefined ? { maxVersion: relation.maxVersion } : {}),
            requiredBy: module.identifier,
            message: `Planned ${relation.name} ${plannedMatch.version} does not satisfy constraints required by ${module.identifier}.`,
          });
        }
        continue;
      }

      if (relation.name === target.identifier && versionMatchesModule(target, relation)) {
        continue;
      }

      const candidate = pickLatestCompatible(byIdentifier.get(relation.name) ?? [], relation);
      if (candidate === undefined) {
        unmet.push({
          name: relation.name,
          ...(relation.minVersion !== undefined ? { minVersion: relation.minVersion } : {}),
          ...(relation.maxVersion !== undefined ? { maxVersion: relation.maxVersion } : {}),
          requiredBy: module.identifier,
          message: `No compatible version of ${relation.name} found in the registry for ${module.identifier}.`,
        });
        continue;
      }

      planned.set(candidate.identifier, candidate);
      resolveDepends(candidate);
    }

    visiting.delete(module.identifier);
  }

  resolveDepends(target);
  checkInstalledModuleConflicts();

  // Target is always part of the install set (reinstall / primary install).
  const toInstallModules = [...planned.values(), target];
  const toInstall = topologicalInstallOrder(toInstallModules);

  const status: InstallPlanStatus = conflicts.length > 0 || unmet.length > 0 ? "blocked" : "ok";

  return {
    status,
    target: toRef(target),
    toInstall,
    alreadySatisfied,
    conflicts,
    unmet,
    optional,
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

function pickLatestCompatible(candidates: readonly CkanModule[], relation: CkanRelationship): CkanModule | undefined {
  const matching = candidates.filter((module) => versionMatchesModule(module, relation));
  if (matching.length === 0) {
    return undefined;
  }
  return matching.reduce((best, current) =>
    compareCkanVersions(current.version, best.version) > 0 ? current : best,
  );
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

function versionMatchesModule(module: CkanModule, relation: CkanRelationship): boolean {
  return versionInRange(module.version, relation.minVersion, relation.maxVersion);
}

function versionMatchesInstalled(
  mod: InstalledModSummary,
  relation: CkanRelationship,
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

function versionInRange(version: string, minVersion?: string, maxVersion?: string): boolean {
  if (minVersion !== undefined && compareCkanVersions(version, minVersion) < 0) {
    return false;
  }
  if (maxVersion !== undefined && compareCkanVersions(version, maxVersion) > 0) {
    return false;
  }
  return true;
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
    for (const dep of module.relationships?.depends ?? []) {
      if (dep.unsupported || !ids.has(dep.name) || dep.name === module.identifier) {
        continue;
      }
      edges.get(dep.name)?.push(module.identifier);
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
