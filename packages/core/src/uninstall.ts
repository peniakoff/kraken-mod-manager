/**
 * Uninstall planning: which managed mods must go with the target, which
 * auto-installed dependencies nothing needs any more, and which unmanaged
 * mods will break. Pure policy; the caller removes files.
 */

import type { CkanAnyOfRelationship, CkanModule, CkanSingleRelationship } from "./ckan.js";
import { normalizeSlashPath, type InstalledModSummary, type ManagedModRecord } from "./install.js";
import { findInstalledMetadata, versionMatchesInstalled } from "./providers.js";

export const EMPTY_REGISTRY_UNINSTALL_WARNING =
  "The CKAN registry is not loaded, so Kraken cannot check which mods depend on this one.";

export interface UninstallModuleRef {
  identifier: string;
  name: string;
  version?: string;
}

export interface PlanUninstallOptions {
  targetIdentifier: string;
  /** Managed records of one installation. */
  managed: readonly ManagedModRecord[];
  /** Managed and detected mods of the same installation. */
  inventory: readonly InstalledModSummary[];
  registryModules: readonly CkanModule[];
}

export interface UninstallPlan {
  target: UninstallModuleRef;
  /** Managed mods that stop working without the target; removed with it. */
  dependents: UninstallModuleRef[];
  /** Auto-installed mods nothing needs after the removal; offered for removal. */
  orphans: UninstallModuleRef[];
  /** Detected mods that will stop working; reported, never removed. */
  brokenUnmanaged: UninstallModuleRef[];
  warnings: string[];
}

export type UninstallSelection = { ok: true; removeOrder: string[] } | { ok: false; problems: string[] };

type DependsRelation = CkanSingleRelationship | CkanAnyOfRelationship;

/** Computes what an uninstall of `targetIdentifier` would remove and break. */
export function planUninstall(options: PlanUninstallOptions): UninstallPlan {
  const graph = new InstalledGraph(options);
  const targetRecord = graph.managedRecord(options.targetIdentifier);
  const target: UninstallModuleRef = {
    identifier: targetRecord.identifier,
    name: targetRecord.name,
    version: targetRecord.version,
  };

  if (options.registryModules.length === 0) {
    return { target, dependents: [], orphans: [], brokenUnmanaged: [], warnings: [EMPTY_REGISTRY_UNINSTALL_WARNING] };
  }

  const removed = new Set([target.identifier]);
  const dependents: UninstallModuleRef[] = [];
  const brokenUnmanaged: UninstallModuleRef[] = [];
  const broken = new Set<string>();
  const nothingRemoved = new Set<string>();

  let changed = true;
  while (changed) {
    changed = false;
    for (const mod of graph.mods) {
      if (graph.isRemoved(mod, removed) || broken.has(mod.identifier)) {
        continue;
      }
      if (graph.lostProvider(mod, nothingRemoved, removed) === undefined) {
        continue;
      }
      if (graph.isManaged(mod.identifier)) {
        removed.add(mod.identifier);
        dependents.push(graph.ref(mod));
        changed = true;
      } else {
        // A detected mod stays on disk, so whatever depends on it keeps working.
        broken.add(mod.identifier);
        brokenUnmanaged.push(graph.ref(mod));
      }
    }
  }

  const orphans: UninstallModuleRef[] = [];
  const candidates = options.managed
    .filter((record) => record.autoInstalled && !removed.has(record.identifier))
    .map((record) => record.identifier)
    .sort((left, right) => left.localeCompare(right));
  changed = true;
  while (changed) {
    changed = false;
    for (const identifier of candidates) {
      if (removed.has(identifier)) {
        continue;
      }
      const trial = new Set([...removed, identifier]);
      // Compare against the state after the removals already decided, so a
      // mod the target breaks anyway does not block every orphan.
      const breaksSomething = graph.mods.some(
        (mod) => !graph.isRemoved(mod, trial) && graph.lostProvider(mod, removed, trial) !== undefined,
      );
      if (!breaksSomething) {
        removed.add(identifier);
        orphans.push(graph.ref(graph.inventoryEntry(identifier)));
        changed = true;
      }
    }
  }

  return { target, dependents, orphans, brokenUnmanaged, warnings: [] };
}

/**
 * Checks the removals a client chose against a freshly computed plan and
 * returns the removal order: dependents before what they depend on, then the
 * target, then the chosen orphans.
 */
export function validateUninstallSelection(
  plan: UninstallPlan,
  alsoRemove: readonly string[],
  options: PlanUninstallOptions,
): UninstallSelection {
  const selected = new Set(alsoRemove.filter((identifier) => identifier !== plan.target.identifier));
  const allowed = new Set([...plan.dependents, ...plan.orphans].map((ref) => ref.identifier));
  const problems: string[] = [];

  for (const dependent of plan.dependents) {
    if (!selected.has(dependent.identifier)) {
      problems.push(`${dependent.identifier} depends on ${plan.target.identifier} and must be removed too.`);
    }
  }
  for (const identifier of selected) {
    if (!allowed.has(identifier)) {
      problems.push(`${identifier} is not part of this uninstall.`);
    }
  }
  if (problems.length > 0) {
    return { ok: false, problems };
  }

  const graph = new InstalledGraph(options);
  const removed = new Set([plan.target.identifier, ...selected]);
  for (const mod of graph.mods) {
    if (!graph.isManaged(mod.identifier) || graph.isRemoved(mod, removed)) {
      continue;
    }
    const provider = graph.lostProvider(mod, new Set(), removed);
    if (provider !== undefined) {
      problems.push(`${mod.identifier} needs ${provider}.`);
    }
  }
  if (problems.length > 0) {
    return { ok: false, problems };
  }

  const dependents = plan.dependents.map((ref) => ref.identifier).reverse();
  const orphans = plan.orphans.map((ref) => ref.identifier).filter((identifier) => selected.has(identifier));
  return { ok: true, removeOrder: [...dependents, plan.target.identifier, ...orphans] };
}

/** Satisfaction checks over one installation's inventory and registry metadata. */
class InstalledGraph {
  readonly mods: readonly InstalledModSummary[];
  private readonly managedById = new Map<string, ManagedModRecord>();
  private readonly metadataById = new Map<string, CkanModule | undefined>();
  /** Detected folder identifier → managed mod whose files live in that folder. */
  private readonly folderOwner = new Map<string, string>();

  constructor(options: PlanUninstallOptions) {
    this.mods = options.inventory;
    for (const record of options.managed) {
      this.managedById.set(record.identifier, record);
    }

    const registryById = new Map<string, CkanModule[]>();
    for (const module of options.registryModules) {
      const list = registryById.get(module.identifier);
      if (list === undefined) {
        registryById.set(module.identifier, [module]);
      } else {
        list.push(module);
      }
    }
    for (const mod of this.mods) {
      this.metadataById.set(mod.identifier, findInstalledMetadata(registryById.get(mod.identifier) ?? [], mod));
    }

    for (const record of options.managed) {
      for (const file of record.files) {
        const [root, folder] = normalizeSlashPath(file).split("/");
        if (root === "GameData" && folder !== undefined) {
          this.folderOwner.set(folder, record.identifier);
        }
      }
    }
  }

  managedRecord(identifier: string): ManagedModRecord {
    const record = this.managedById.get(identifier);
    if (record === undefined) {
      throw new Error(`${identifier} is not managed in this installation.`);
    }
    return record;
  }

  isManaged(identifier: string): boolean {
    return this.managedById.has(identifier);
  }

  inventoryEntry(identifier: string): InstalledModSummary {
    const entry = this.mods.find((mod) => mod.identifier === identifier);
    if (entry !== undefined) {
      return entry;
    }
    const record = this.managedRecord(identifier);
    return { identifier, name: record.name, version: record.version, status: "managed" };
  }

  /**
   * A mod counts as removed when it is in the set, or when it is a detected
   * folder that a removed managed mod installed (its files go with it).
   */
  isRemoved(mod: InstalledModSummary, removed: ReadonlySet<string>): boolean {
    if (removed.has(mod.identifier)) {
      return true;
    }
    if (mod.status !== "detected") {
      return false;
    }
    const owner = this.folderOwner.get(mod.identifier);
    return owner !== undefined && removed.has(owner);
  }

  /**
   * For the first `depends` of `mod` that is satisfied with `before` removed
   * but not with `after` removed, the provider it loses. A relationship that
   * was already unsatisfied does not count.
   */
  lostProvider(mod: InstalledModSummary, before: ReadonlySet<string>, after: ReadonlySet<string>): string | undefined {
    for (const relation of this.metadataById.get(mod.identifier)?.relationships?.depends ?? []) {
      if (relation.kind === "unsupported") {
        continue;
      }
      const provider = this.satisfier(mod.identifier, relation, before);
      if (provider !== undefined && this.satisfier(mod.identifier, relation, after) === undefined) {
        return provider;
      }
    }
    return undefined;
  }

  /** Identifier of an installed mod other than `owner`, not removed, that satisfies `relation`. */
  satisfier(owner: string, relation: DependsRelation, removed: ReadonlySet<string>): string | undefined {
    const alternatives = relation.kind === "single" ? [relation] : relation.alternatives;
    for (const alternative of alternatives) {
      for (const mod of this.mods) {
        if (mod.identifier === owner || this.isRemoved(mod, removed)) {
          continue;
        }
        const satisfiesName =
          mod.identifier === alternative.name ||
          (this.metadataById.get(mod.identifier)?.provides.includes(alternative.name) ?? false);
        if (satisfiesName && versionMatchesInstalled(mod, alternative, "depends")) {
          return mod.identifier;
        }
      }
    }
    return undefined;
  }

  ref(mod: InstalledModSummary): UninstallModuleRef {
    const name = mod.name ?? this.metadataById.get(mod.identifier)?.name ?? mod.identifier;
    return { identifier: mod.identifier, name, ...(mod.version !== undefined ? { version: mod.version } : {}) };
  }
}
