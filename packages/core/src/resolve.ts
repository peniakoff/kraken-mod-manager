/**
 * Pragmatic install-plan resolver for CKAN depends/conflicts.
 * Not a full SAT solver — transitive BFS with latest-compatible version picks.
 */

import {
  compareCkanVersions,
  type CkanModule,
  type CkanAnyOfRelationship,
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
  alternatives: CkanSingleRelationship[];
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

  function installedSatisfiesName(mod: InstalledModSummary, name: string): boolean {
    return mod.identifier === name || (installedMetadata(mod)?.provides.includes(name) ?? false);
  }

  function findInstalledSatisfier(relation: CkanSingleRelationship): InstalledModSummary | undefined {
    const direct = installed.get(relation.name);
    if (direct !== undefined && versionMatchesInstalled(direct, relation, "depends")) {
      return direct;
    }
    for (const mod of installed.values()) {
      if (mod !== direct && installedSatisfiesName(mod, relation.name) && versionMatchesInstalled(mod, relation, "depends")) {
        return mod;
      }
    }
    return undefined;
  }

  function isSatisfiedByPlan(relation: CkanSingleRelationship): boolean {
    return [...planned.values(), target].some(
      (module) => ProviderIndex.satisfiesName(module, relation.name) && versionMatchesModule(module, relation),
    );
  }

  function collectOptional(module: CkanModule): void {
    const relationships = module.relationships;
    if (relationships === undefined) {
      return;
    }
    for (const kind of ["recommends", "suggests"] as const) {
      for (const relation of relationships[kind]) {
        if (relation.kind === "single") {
          optional.push({ kind, name: relation.name, ...rangeOf(relation), requiredBy: module.identifier });
        } else if (relation.kind === "anyOf") {
          optional.push({ kind, name: anyOfKey(relation.alternatives), requiredBy: module.identifier });
        }
      }
    }
  }

  function checkConflicts(module: CkanModule): void {
    for (const relation of module.relationships?.conflicts ?? []) {
      if (relation.kind === "unsupported") {
        conflicts.push({
          identifier: module.identifier,
          conflictingWith: relation.reason,
          message: `${module.identifier} declares an unsupported conflict relationship (${relation.reason}) that Kraken cannot evaluate yet.`,
        });
        continue;
      }
      const alternatives = relationAlternatives(relation);
      for (const installedMod of installed.values()) {
        // A module never conflicts with itself; this also covers reinstalls and upgrades.
        if (installedMod.identifier === module.identifier) {
          continue;
        }
        const matches = alternatives.some(
          (alternative) =>
            installedSatisfiesName(installedMod, alternative.name) &&
            versionMatchesInstalled(installedMod, alternative, "conflicts"),
        );
        if (matches) {
          conflicts.push({
            identifier: module.identifier,
            conflictingWith: installedMod.identifier,
            message: `${module.identifier} conflicts with installed ${installedMod.identifier}.`,
          });
        }
      }
      for (const other of [...planned.values(), target]) {
        if (other.identifier === module.identifier) {
          continue;
        }
        const matches = alternatives.some(
          (alternative) =>
            ProviderIndex.satisfiesName(other, alternative.name) && versionMatchesModule(other, alternative),
        );
        if (matches) {
          conflicts.push({
            identifier: module.identifier,
            conflictingWith: other.identifier,
            message:
              other === target
                ? `${module.identifier} conflicts with target ${target.identifier}.`
                : `${module.identifier} conflicts with planned ${other.identifier} ${other.version}.`,
          });
        }
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
        if (relation.kind === "unsupported") {
          continue;
        }
        const alternatives = relationAlternatives(relation);
        for (const other of [...planned.values(), target]) {
          if (other.identifier === meta.identifier) {
            continue;
          }
          const matches = alternatives.some(
            (alternative) =>
              ProviderIndex.satisfiesName(other, alternative.name) && versionMatchesModule(other, alternative),
          );
          if (matches) {
            conflicts.push({
              identifier: meta.identifier,
              conflictingWith: other.identifier,
              message:
                other === target
                  ? `Installed ${meta.identifier} conflicts with target ${target.identifier}.`
                  : `Installed ${meta.identifier} conflicts with planned ${other.identifier} ${other.version}.`,
            });
          }
        }
      }
    }
  }

  /**
   * Plans `module` for `requiredBy`, unless another version of the same
   * identifier is already the target or planned. Replacing it would break the
   * constraint that chose the first version, so that is reported as unmet.
   */
  function planModule(module: CkanModule, requiredBy: CkanModule, label: string, range: VersionRange): void {
    const existing = module.identifier === target.identifier ? target : planned.get(module.identifier);
    if (existing !== undefined && existing.version !== module.version) {
      const role = existing === target ? "Target" : "Planned";
      unmet.push({
        name: label,
        ...range,
        requiredBy: requiredBy.identifier,
        message: `${role} ${existing.identifier} ${existing.version} does not satisfy ${label} required by ${requiredBy.identifier}.`,
      });
      return;
    }
    planned.set(module.identifier, module);
    resolveDepends(module);
  }

  /**
   * Resolves one dependency expressed as alternatives: a single relationship
   * is a group of one, an any_of group is a group of many.
   */
  function resolveAlternatives(
    module: CkanModule,
    alternatives: CkanSingleRelationship[],
    key: string,
    label: string,
  ): void {
    if (alternatives.some((alternative) => ProviderIndex.satisfiesName(module, alternative.name))) {
      return;
    }

    for (const alternative of alternatives) {
      const installedMatch = findInstalledSatisfier(alternative);
      if (installedMatch !== undefined) {
        noteSatisfied(installedMatch, installedMatch.status);
        return;
      }
    }

    const [single] = alternatives;
    if (alternatives.length === 1 && single !== undefined) {
      const plannedByName = planned.get(single.name);
      if (plannedByName !== undefined && !versionMatchesModule(plannedByName, single)) {
        unmet.push({
          name: single.name,
          ...rangeOf(single),
          requiredBy: module.identifier,
          message: `Planned ${single.name} ${plannedByName.version} does not satisfy constraints required by ${module.identifier}.`,
        });
        return;
      }
    }
    if (alternatives.some(isSatisfiedByPlan)) {
      return;
    }

    const candidates = unionCandidates(alternatives.map((alternative) => providers.candidates(alternative)));
    const range = alternatives.length === 1 && single !== undefined ? rangeOf(single) : {};
    // Object.hasOwn keeps keys like "constructor" from resolving to prototype members.
    const chosen = Object.hasOwn(choices, key) ? choices[key] : undefined;
    if (chosen !== undefined) {
      const pick = candidates.find((candidate) => candidate.module.identifier === chosen);
      if (pick === undefined) {
        unmet.push({
          name: key,
          ...range,
          requiredBy: module.identifier,
          message: `${chosen} is not a provider of ${key} compatible with ${module.identifier}.`,
        });
        return;
      }
      planModule(pick.module, module, label, range);
      return;
    }

    const [only, ...others] = candidates;
    if (only === undefined) {
      unmet.push({
        name: key,
        ...range,
        requiredBy: module.identifier,
        message: `No compatible version of ${label} found in the registry for ${module.identifier}.`,
      });
      return;
    }
    if (others.length === 0) {
      planModule(only.module, module, label, range);
      return;
    }

    const existing = pendingChoices.get(key);
    if (existing !== undefined) {
      existing.requiredBy.add(module.identifier);
      return;
    }
    pendingChoices.set(key, {
      alternatives,
      requiredBy: new Set([module.identifier]),
      choice: {
        key,
        label,
        requiredBy: [],
        candidates: candidates.map((candidate) => ({ ...toRef(candidate.module), via: candidate.via })),
      },
    });
  }

  function resolveDepends(module: CkanModule): void {
    if (visiting.has(module.identifier)) {
      return;
    }
    visiting.add(module.identifier);
    collectOptional(module);

    for (const relation of module.relationships?.depends ?? []) {
      switch (relation.kind) {
        case "single":
          resolveAlternatives(module, [relation], relation.name, relation.name);
          break;
        case "anyOf":
          resolveAlternatives(module, relation.alternatives, anyOfKey(relation.alternatives), anyOfLabel(relation.alternatives));
          break;
        case "unsupported":
          unmet.push({
            name: relation.reason,
            requiredBy: module.identifier,
            message: `${module.identifier} has an unsupported dependency relationship (${relation.reason}) that Kraken cannot resolve yet.`,
          });
          break;
        default: {
          const exhaustive: never = relation;
          throw new Error(`Unknown relationship kind: ${JSON.stringify(exhaustive)}`);
        }
      }
    }

    visiting.delete(module.identifier);
  }

  resolveDepends(target);
  // Conflicts are checked once the plan is complete, so a module resolved early
  // still sees providers planned later in the walk.
  for (const module of [...planned.values(), target]) {
    checkConflicts(module);
  }
  checkInstalledModuleConflicts();

  // A choice raised early can be settled by a provider planned later in the walk.
  const choicesOut: InstallPlanChoice[] = [];
  for (const pending of pendingChoices.values()) {
    if (!pending.alternatives.some(isSatisfiedByPlan)) {
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

function relationAlternatives(relation: CkanSingleRelationship | CkanAnyOfRelationship): CkanSingleRelationship[] {
  return relation.kind === "single" ? [relation] : relation.alternatives;
}

function sortedNames(alternatives: readonly CkanSingleRelationship[]): string[] {
  return [...new Set(alternatives.map((alternative) => alternative.name))].sort((left, right) => left.localeCompare(right));
}

function anyOfKey(alternatives: readonly CkanSingleRelationship[]): string {
  return `any_of:${sortedNames(alternatives).join("|")}`;
}

function anyOfLabel(alternatives: readonly CkanSingleRelationship[]): string {
  return `one of ${sortedNames(alternatives).join(", ")}`;
}

/** Merges per-alternative candidates, keeping the first `via` seen per identifier. */
function unionCandidates(groups: readonly ProviderCandidate[][]): ProviderCandidate[] {
  const byIdentifier = new Map<string, ProviderCandidate>();
  for (const group of groups) {
    for (const candidate of group) {
      if (!byIdentifier.has(candidate.module.identifier)) {
        byIdentifier.set(candidate.module.identifier, candidate);
      }
    }
  }
  return [...byIdentifier.values()].sort((left, right) => left.module.identifier.localeCompare(right.module.identifier));
}

type VersionRange = { minVersion?: string; maxVersion?: string };

function rangeOf(relation: CkanSingleRelationship): VersionRange {
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
