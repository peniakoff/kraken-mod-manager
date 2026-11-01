/**
 * Lookup of the registry modules that satisfy a relationship name, either by
 * identifier or through CKAN `provides` (virtual packages).
 */

import { compareCkanVersions, type CkanModule, type CkanSingleRelationship } from "./ckan.js";

export interface ProviderCandidate {
  module: CkanModule;
  via: "identifier" | "provides";
}

export class ProviderIndex {
  private readonly byName = new Map<string, CkanModule[]>();

  constructor(modules: readonly CkanModule[]) {
    for (const module of modules) {
      this.add(module.identifier, module);
      for (const name of module.provides) {
        this.add(name, module);
      }
    }
  }

  /** Latest version per providing identifier that satisfies the range, sorted by identifier. */
  candidates(relation: CkanSingleRelationship): ProviderCandidate[] {
    const latest = new Map<string, CkanModule>();
    for (const module of this.byName.get(relation.name) ?? []) {
      if (!versionInRange(module.version, relation.minVersion, relation.maxVersion)) {
        continue;
      }
      const best = latest.get(module.identifier);
      if (best === undefined || compareCkanVersions(module.version, best.version) > 0) {
        latest.set(module.identifier, module);
      }
    }
    return [...latest.values()]
      .sort((left, right) => left.identifier.localeCompare(right.identifier))
      .map((module) => ({ module, via: module.identifier === relation.name ? "identifier" : "provides" }));
  }

  /** True when `module` is `name` or provides it. */
  static satisfiesName(module: CkanModule, name: string): boolean {
    return module.identifier === name || module.provides.includes(name);
  }

  private add(name: string, module: CkanModule): void {
    const list = this.byName.get(name);
    if (list === undefined) {
      this.byName.set(name, [module]);
    } else {
      list.push(module);
    }
  }
}

export function versionInRange(version: string, minVersion?: string, maxVersion?: string): boolean {
  if (minVersion !== undefined && compareCkanVersions(version, minVersion) < 0) {
    return false;
  }
  if (maxVersion !== undefined && compareCkanVersions(version, maxVersion) > 0) {
    return false;
  }
  return true;
}
