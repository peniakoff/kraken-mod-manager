import {
  CkanIndex,
  compareCkanVersions,
  refreshRegistry,
  type ArchivePort,
  type CkanModule,
  type CkanSearchOptions,
  type CkanSearchResult,
  type HttpPort,
  type RegistrySnapshot,
} from "@kraken/core";
import { RegistryCacheStore, RegistryCacheError } from "./adapters/registry-cache-store.js";

export const DEFAULT_CKAN_META_URL = "https://github.com/KSP-CKAN/CKAN-meta/archive/master.tar.gz";

export class RegistryServiceError extends Error {
  constructor(
    message: string,
    readonly code: "REGISTRY_REFRESH_FAILED" | "REGISTRY_CACHE_ERROR",
  ) {
    super(message);
    this.name = "RegistryServiceError";
  }
}

export interface RegistryStatus {
  status: "missing" | "ready";
  moduleCount: number;
  updatedAt?: string;
  sourceUrl?: string;
  parseErrors?: number;
}

export class RegistryService {
  private index = new CkanIndex([]);
  private snapshot: RegistrySnapshot | undefined;
  private loadPromise: Promise<void> | undefined;

  constructor(
    private readonly http: HttpPort,
    private readonly archive: ArchivePort,
    private readonly cacheStore: RegistryCacheStore,
    private readonly sourceUrl: string = DEFAULT_CKAN_META_URL,
  ) {}

  async ensureLoaded(): Promise<void> {
    if (this.loadPromise === undefined) {
      this.loadPromise = this.loadFromCache();
    }
    await this.loadPromise;
  }

  getStatus(): RegistryStatus {
    if (this.snapshot === undefined) {
      return { status: "missing", moduleCount: 0 };
    }
    return {
      status: "ready",
      moduleCount: this.index.size,
      updatedAt: this.snapshot.updatedAt,
      sourceUrl: this.snapshot.sourceUrl,
      parseErrors: this.snapshot.parseErrors,
    };
  }

  search(options: CkanSearchOptions): CkanSearchResult {
    return this.index.search(options);
  }

  findModule(identifier: string, version?: string): CkanModule | undefined {
    const matches = this.index.search({ latestOnly: false, limit: 200_000, offset: 0 }).mods.filter(
      (module) => module.identifier === identifier,
    );
    if (matches.length === 0) {
      return undefined;
    }
    if (version !== undefined) {
      return matches.find((module) => module.version === version);
    }
    return matches.reduce((best, current) =>
      compareCkanVersions(current.version, best.version) > 0 ? current : best,
    );
  }

  async refresh(): Promise<RegistryStatus> {
    try {
      const snapshot = await refreshRegistry(this.http, this.archive, this.sourceUrl);
      await this.cacheStore.write(snapshot);
      this.applySnapshot(snapshot);
      return this.getStatus();
    } catch (error: unknown) {
      if (error instanceof RegistryServiceError || error instanceof RegistryCacheError) {
        throw error;
      }
      throw new RegistryServiceError(
        error instanceof Error ? error.message : "Registry refresh failed.",
        "REGISTRY_REFRESH_FAILED",
      );
    }
  }

  private async loadFromCache(): Promise<void> {
    try {
      const cache = await this.cacheStore.read();
      if (cache === undefined) {
        return;
      }
      this.applySnapshot({
        modules: cache.modules as CkanModule[],
        parseErrors: cache.parseErrors,
        sourceUrl: cache.sourceUrl,
        updatedAt: cache.updatedAt,
      });
    } catch (error: unknown) {
      throw new RegistryServiceError(
        error instanceof Error ? error.message : "Could not load registry cache.",
        "REGISTRY_CACHE_ERROR",
      );
    }
  }

  private applySnapshot(snapshot: RegistrySnapshot): void {
    this.snapshot = snapshot;
    this.index = new CkanIndex(snapshot.modules);
  }
}
