import {
  CkanIndex,
  compareCkanVersions,
  refreshRegistry,
  type ArchivePort,
  type CkanModule,
  type CkanSearchOptions,
  type CkanSearchResult,
  moduleIdentifierKey,
  parseCkanDocument,
  type HttpPort,
  type RegistrySnapshot,
} from "@kraken/core";
import { ImportedModpackStore } from "./adapters/imported-modpack-store.js";
import { RegistryCacheStore, RegistryCacheError } from "./adapters/registry-cache-store.js";

export const DEFAULT_CKAN_META_URL = "https://github.com/KSP-CKAN/CKAN-meta/archive/master.tar.gz";

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const MAX_IDENTIFIER_LENGTH = 128;

function providedNames(modules: readonly CkanModule[]): Set<string> {
  return new Set(modules.flatMap((module) => module.provides.map((name) => moduleIdentifierKey(name))));
}

export class RegistryServiceError extends Error {
  constructor(
    message: string,
    readonly code: "REGISTRY_REFRESH_FAILED" | "REGISTRY_CACHE_ERROR" | "INVALID_MODPACK",
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
    private readonly importedStore: ImportedModpackStore,
    private readonly sourceUrl: string = DEFAULT_CKAN_META_URL,
  ) {}

  async ensureLoaded(): Promise<void> {
    if (this.loadPromise === undefined) {
      const loading = this.loadFromCache();
      this.loadPromise = loading;
      // A failed read is not remembered, so the next call reads the file
      // again and picks up a cache that was fixed or rebuilt in the meantime.
      // The error itself still reaches every caller awaiting this read.
      loading.catch(() => {
        if (this.loadPromise === loading) {
          this.loadPromise = undefined;
        }
      });
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
    const matches = this.index.findByIdentifier(identifier);
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

  getLatestModule(identifier: string): CkanModule | undefined {
    return this.index.getLatest(identifier);
  }

  listVersions(identifier: string): CkanModule[] {
    return this.index.listVersions(identifier);
  }

  listModules(): readonly CkanModule[] {
    return this.index.allModules();
  }

  async refresh(): Promise<RegistryStatus> {
    try {
      const snapshot = await refreshRegistry(this.http, this.archive, this.sourceUrl);
      await this.cacheStore.write(snapshot);
      this.applySnapshot(snapshot, await this.readImports());
      // The registry in memory is now newer than anything a pending or later
      // cache read could load.
      this.loadPromise = Promise.resolve();
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

  /**
   * Parses a CKAN modpack file into a metapackage and adds it to the index.
   * Download information is dropped: an imported file must never decide what
   * gets downloaded, only which registry mods get installed.
   */
  async importModpack(contents: string): Promise<CkanModule> {
    await this.ensureLoaded();

    let raw: unknown;
    try {
      raw = JSON.parse(contents);
    } catch {
      throw new RegistryServiceError("The modpack file is not valid JSON.", "INVALID_MODPACK");
    }
    const parsed = parseCkanDocument(raw);
    if (parsed === undefined) {
      throw new RegistryServiceError(
        "The modpack file is missing an identifier, name or version.",
        "INVALID_MODPACK",
      );
    }
    if (parsed.kind !== "metapackage") {
      throw new RegistryServiceError("The modpack file is not a CKAN metapackage.", "INVALID_MODPACK");
    }
    if (!IDENTIFIER_PATTERN.test(parsed.identifier) || parsed.identifier.length > MAX_IDENTIFIER_LENGTH) {
      throw new RegistryServiceError(
        'The modpack identifier may only use letters, digits, "-" and "_" and must be at most 128 characters.',
        "INVALID_MODPACK",
      );
    }
    const key = moduleIdentifierKey(parsed.identifier);
    const registryModules = this.snapshot?.modules ?? [];
    if (registryModules.some((module) => moduleIdentifierKey(module.identifier) === key)) {
      throw new RegistryServiceError(
        `${parsed.identifier} is a mod in the CKAN registry and cannot be replaced by an imported file.`,
        "INVALID_MODPACK",
      );
    }
    if (providedNames(registryModules).has(key)) {
      throw new RegistryServiceError(
        `${parsed.identifier} is a name that mods in the CKAN registry provide and cannot be used by an imported file.`,
        "INVALID_MODPACK",
      );
    }

    // Download and install data is dropped as well as `provides`: a file must
    // neither decide what gets downloaded or written nor join dependency
    // resolution as an alternative to real mods.
    const {
      download: _download,
      downloadMirrors: _downloadMirrors,
      downloadSize: _downloadSize,
      downloadHash: _downloadHash,
      install: _install,
      provides: _provides,
      ...rest
    } = parsed;
    const module: CkanModule = { ...rest, provides: [], source: "imported" };
    const imports = await this.importedStore.save(module);
    this.applySnapshot(this.snapshot, imports);
    return module;
  }

  private async loadFromCache(): Promise<void> {
    try {
      const cache = await this.cacheStore.read();
      const imports = await this.readImports();
      // A refresh that finished while the files were being read has newer data.
      if (this.snapshot !== undefined) {
        return;
      }
      this.applySnapshot(
        cache === undefined
          ? undefined
          : {
              modules: cache.modules as CkanModule[],
              parseErrors: cache.parseErrors,
              sourceUrl: cache.sourceUrl,
              updatedAt: cache.updatedAt,
            },
        imports,
      );
    } catch (error: unknown) {
      if (error instanceof RegistryServiceError) {
        throw error;
      }
      throw new RegistryServiceError(
        error instanceof Error ? error.message : "Could not load registry cache.",
        "REGISTRY_CACHE_ERROR",
      );
    }
  }

  private async readImports(): Promise<CkanModule[]> {
    try {
      return await this.importedStore.read();
    } catch (error: unknown) {
      throw new RegistryServiceError(
        error instanceof Error ? error.message : "Could not load imported modpacks.",
        "REGISTRY_CACHE_ERROR",
      );
    }
  }

  /** Imports named like a registry mod or a name registry mods provide are hidden, never overriding a registry mod. */
  private applySnapshot(snapshot: RegistrySnapshot | undefined, imports: readonly CkanModule[]): void {
    this.snapshot = snapshot;
    const registryModules = snapshot?.modules ?? [];
    const registryIdentifiers = new Set(registryModules.map((module) => moduleIdentifierKey(module.identifier)));
    const virtualNames = providedNames(registryModules);
    const visibleImports = imports
      .filter((module) => {
        const key = moduleIdentifierKey(module.identifier);
        return !registryIdentifiers.has(key) && !virtualNames.has(key);
      })
      .map((module): CkanModule => ({ ...module, source: "imported" }));
    this.index = new CkanIndex([...registryModules, ...visibleImports]);
  }
}
