import type { InstallPlanResponse, JobProgressEvent, JobResponse } from "@kraken/contracts";
import {
  buildInventory,
  InstallPolicyError,
  isAllowedDestination,
  normalizeSlashPath,
  resolveInstallMappings,
  resolveInstallPlan,
  verifyDownloadHash,
  type CkanModule,
  type FileSystemPort,
  type InstalledModSummary,
  type ManagedModRecord,
} from "@kraken/core";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { InstallManifestStore, InstallManifestError } from "./adapters/install-manifest-store.js";
import { StreamingHttp, StreamingHttpError } from "./adapters/streaming-http.js";
import { ZipArchive, ZipArchiveError } from "./adapters/zip-archive.js";
import { JobStore } from "./job-store.js";
import type { RegistryService } from "./registry-service.js";

export class InstallServiceError extends Error {
  constructor(
    message: string,
    readonly code:
      | "NOT_CONFIGURED"
      | "MOD_NOT_FOUND"
      | "NO_DOWNLOAD"
      | "INSTALL_FAILED"
      | "UNINSTALL_FAILED"
      | "JOB_NOT_FOUND"
      | "NOT_MANAGED"
      | "PLAN_BLOCKED",
  ) {
    super(message);
    this.name = "InstallServiceError";
  }
}

export class InstallService {
  private manifestMutation: Promise<void> = Promise.resolve();

  constructor(
    private readonly fileSystem: FileSystemPort,
    private readonly registryService: RegistryService,
    private readonly http: StreamingHttp,
    private readonly zip: ZipArchive,
    private readonly manifestStore: InstallManifestStore,
    private readonly jobStore: JobStore,
    private readonly downloadCacheDirectory: string,
  ) {}

  async listInstalled(kspPath: string): Promise<InstalledModSummary[]> {
    await this.registryService.ensureLoaded();
    const canonicalRoot = await this.fileSystem.realpath(kspPath);
    const manifest = await this.manifestStore.read();
    const gameDataPath = join(canonicalRoot, "GameData");
    let directories: string[] = [];
    try {
      const entries = await readdir(gameDataPath, { withFileTypes: true });
      directories = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    } catch {
      directories = [];
    }

    const knownIdentifiers = new Set<string>();
    const knownNames = new Map<string, string>();
    const search = this.registryService.search({ latestOnly: true, limit: 200_000, offset: 0 });
    for (const mod of search.mods) {
      knownIdentifiers.add(mod.identifier);
      knownNames.set(mod.identifier, mod.name);
    }

    const managed = manifest.mods.filter((mod) => mod.installationPath === canonicalRoot);
    return buildInventory(directories, managed, knownIdentifiers, knownNames);
  }

  async planInstall(kspPath: string, identifier: string, version?: string): Promise<InstallPlanResponse> {
    await this.registryService.ensureLoaded();
    const target = this.findModule(identifier, version);
    const inventory = await this.listInstalled(kspPath);
    return resolveInstallPlan({
      target,
      registryModules: this.registryService.listModules(),
      inventory,
    });
  }

  async startInstall(
    kspPath: string,
    identifier: string,
    version?: string,
    installDependencies = false,
  ): Promise<JobResponse> {
    await this.registryService.ensureLoaded();
    const target = this.findModule(identifier, version);
    // Validate the plan before accepting the job so blocked dependency
    // installs fail the HTTP request instead of a queued job.
    await this.resolveModulesForInstall(kspPath, target, installDependencies);

    const job = this.jobStore.create(identifier, version);
    void this.runInstall(job.jobId, kspPath, identifier, version, installDependencies);
    return this.jobStore.toResponse(job);
  }

  getJob(jobId: string): JobResponse {
    const job = this.jobStore.get(jobId);
    if (job === undefined) {
      throw new InstallServiceError("Unknown job.", "JOB_NOT_FOUND");
    }
    return this.jobStore.toResponse(job);
  }

  subscribe(jobId: string, listener: (event: JobProgressEvent) => void): () => void {
    try {
      return this.jobStore.subscribe(jobId, listener);
    } catch {
      throw new InstallServiceError("Unknown job.", "JOB_NOT_FOUND");
    }
  }

  async uninstall(kspPath: string, identifier: string): Promise<void> {
    try {
      await this.withManifestMutation(async () => {
        const canonicalRoot = await this.fileSystem.realpath(kspPath);
        const manifest = await this.manifestStore.read();
        const record = manifest.mods.find(
          (mod) => mod.identifier === identifier && mod.installationPath === canonicalRoot,
        );
        if (record === undefined) {
          throw new InstallServiceError("Only managed mods can be uninstalled.", "NOT_MANAGED");
        }

        const remaining = new Set(record.files);
        try {
          for (const relativePath of [...record.files].sort((left, right) => right.length - left.length)) {
            await this.removeInstalledPath(canonicalRoot, relativePath);
            remaining.delete(relativePath);
          }
          await this.pruneEmptyParents(canonicalRoot, record.files);
        } catch (error: unknown) {
          const remainingFiles = record.files.filter((file) => remaining.has(file));
          await this.manifestStore.write({
            schemaVersion: 1,
            mods:
              remainingFiles.length === 0
                ? manifest.mods.filter((mod) => mod !== record)
                : manifest.mods.map((mod) => (mod === record ? { ...record, files: remainingFiles } : mod)),
          });
          throw error;
        }

        await this.manifestStore.write({
          schemaVersion: 1,
          mods: manifest.mods.filter((mod) => mod !== record),
        });
      });
    } catch (error: unknown) {
      if (error instanceof InstallServiceError) {
        throw error;
      }
      throw new InstallServiceError(
        error instanceof Error ? error.message : "Uninstall failed.",
        "UNINSTALL_FAILED",
      );
    }
  }

  private async runInstall(
    jobId: string,
    kspPath: string,
    identifier: string,
    version?: string,
    installDependencies = false,
  ): Promise<void> {
    try {
      this.jobStore.update(jobId, { status: "running", phase: "downloading", message: "Resolving module metadata." });
      await this.registryService.ensureLoaded();
      const target = this.findModule(identifier, version);
      const modulesToInstall = await this.resolveModulesForInstall(kspPath, target, installDependencies);

      for (const [index, module] of modulesToInstall.entries()) {
        const stepLabel =
          modulesToInstall.length > 1
            ? ` (${index + 1}/${modulesToInstall.length}: ${module.identifier})`
            : "";
        await this.installSingleModule(jobId, kspPath, module, stepLabel);
      }

      this.jobStore.update(jobId, {
        status: "succeeded",
        phase: "done",
        message: "Install completed.",
        version: target.version,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Install failed.";
      this.jobStore.update(jobId, {
        status: "failed",
        phase: "failed",
        error: message,
        message,
      });
    }
  }

  private async resolveModulesForInstall(
    kspPath: string,
    target: CkanModule,
    installDependencies: boolean,
  ): Promise<CkanModule[]> {
    if (!installDependencies) {
      if (target.download === undefined || target.download.length === 0) {
        throw new InstallServiceError("This mod does not declare a download URL.", "NO_DOWNLOAD");
      }
      return [target];
    }

    const inventory = await this.listInstalled(kspPath);
    const plan = resolveInstallPlan({
      target,
      registryModules: this.registryService.listModules(),
      inventory,
    });
    if (plan.status === "blocked") {
      const details = [
        ...plan.conflicts.map((entry) => entry.message),
        ...plan.unmet.map((entry) => entry.message),
      ].join(" ");
      throw new InstallServiceError(
        details.length > 0 ? `Install plan blocked. ${details}` : "Install plan blocked.",
        "PLAN_BLOCKED",
      );
    }

    const modules: CkanModule[] = [];
    for (const ref of plan.toInstall) {
      const module = this.findModule(ref.identifier, ref.version);
      if (module.download === undefined || module.download.length === 0) {
        throw new InstallServiceError(
          `Dependency ${module.identifier} does not declare a download URL.`,
          "NO_DOWNLOAD",
        );
      }
      modules.push(module);
    }
    return modules;
  }

  private async installSingleModule(
    jobId: string,
    kspPath: string,
    module: CkanModule,
    stepLabel: string,
  ): Promise<void> {
    if (module.download === undefined || module.download.length === 0) {
      throw new InstallServiceError("This mod does not declare a download URL.", "NO_DOWNLOAD");
    }

    this.jobStore.update(jobId, {
      status: "running",
      phase: "downloading",
      message: `Downloading archive${stepLabel}.`,
      version: module.version,
      bytesReceived: 0,
      ...(module.downloadSize !== undefined ? { bytesTotal: module.downloadSize } : {}),
    });

    const download = await this.http.get(module.download, (progress) => {
      this.jobStore.update(jobId, {
        phase: "downloading",
        bytesReceived: progress.bytesReceived,
        ...(progress.bytesTotal !== undefined ? { bytesTotal: progress.bytesTotal } : {}),
      });
    });

    this.jobStore.update(jobId, { phase: "verifying", message: `Verifying download hash${stepLabel}.` });
    verifyDownloadHash(download.bytes, module.downloadHash, {
      sha1: download.sha1,
      sha256: download.sha256,
    });

    await mkdir(this.downloadCacheDirectory, { recursive: true });
    const cachePath = join(this.downloadCacheDirectory, `${module.identifier}-${module.version}.zip`);
    await writeFile(cachePath, download.bytes);

    this.jobStore.update(jobId, { phase: "extracting", message: `Extracting archive${stepLabel}.` });
    const zipEntries = this.zip.extractFiles(download.bytes);
    const mappings = resolveInstallMappings(
      module,
      zipEntries.map((entry) => entry.path),
    );
    const bySource = new Map(zipEntries.map((entry) => [entry.path, entry.data]));

    this.jobStore.update(jobId, { phase: "installing", message: `Copying files into GameData${stepLabel}.` });
    await this.withManifestMutation(async () => {
      const canonicalRoot = await this.fileSystem.realpath(kspPath);
      const manifest = await this.manifestStore.read();
      const previous = manifest.mods.find(
        (mod) => mod.identifier === module.identifier && mod.installationPath === canonicalRoot,
      );
      const previousFiles = await this.readInstalledFiles(canonicalRoot, previous?.files ?? []);
      const installedFiles: string[] = [];

      try {
        for (const mapping of mappings) {
          if (!isAllowedDestination(mapping.destinationPath)) {
            throw new InstallPolicyError(
              `Destination escapes allowed roots: ${mapping.destinationPath}`,
              "INVALID_DESTINATION",
            );
          }
          const data = bySource.get(mapping.sourcePath);
          if (data === undefined) {
            throw new InstallServiceError(`Missing archive entry: ${mapping.sourcePath}`, "INSTALL_FAILED");
          }
          const relativeDestination = normalizeSlashPath(mapping.destinationPath);
          const absoluteDestination = await this.resolveDestination(canonicalRoot, relativeDestination);
          installedFiles.push(relativeDestination);
          await mkdir(dirname(absoluteDestination), { recursive: true });
          await writeFile(absoluteDestination, data);
        }

        const installedSet = new Set(installedFiles);
        const staleFiles = previous?.files.filter((file) => !installedSet.has(file)) ?? [];
        for (const staleFile of [...staleFiles].sort((left, right) => right.length - left.length)) {
          await this.removeInstalledPath(canonicalRoot, staleFile);
        }
        await this.pruneEmptyParents(canonicalRoot, staleFiles);

        const record: ManagedModRecord = {
          identifier: module.identifier,
          name: module.name,
          version: module.version,
          installationPath: canonicalRoot,
          files: installedFiles,
        };
        const nextMods = manifest.mods.filter(
          (mod) => mod.identifier !== module.identifier || mod.installationPath !== canonicalRoot,
        );
        nextMods.push(record);
        await this.manifestStore.write({ schemaVersion: 1, mods: nextMods });
      } catch (error: unknown) {
        await this.rollbackInstall(canonicalRoot, installedFiles, previousFiles);
        throw error;
      }
    });
  }

  private findModule(identifier: string, version?: string): CkanModule {
    const module = this.registryService.findModule(identifier, version);
    if (module === undefined) {
      throw new InstallServiceError(
        version === undefined
          ? `Mod not found in registry: ${identifier}`
          : `Mod version not found: ${identifier} ${version}`,
        "MOD_NOT_FOUND",
      );
    }
    return module;
  }

  private async resolveDestination(kspRoot: string, relativeDestination: string): Promise<string> {
    const normalized = normalizeSlashPath(relativeDestination);
    if (!isAllowedDestination(normalized)) {
      throw new InstallPolicyError(`Destination escapes allowed roots: ${normalized}`, "INVALID_DESTINATION");
    }
    let current = kspRoot;
    for (const segment of normalized.split("/")) {
      if (segment === "" || segment === "." || segment === "..") {
        throw new InstallPolicyError(`Unsafe destination segment in ${normalized}`, "INVALID_DESTINATION");
      }
      current = join(current, segment);
    }
    const resolved = resolve(current);
    if (!containsPath(kspRoot, resolved)) {
      throw new InstallPolicyError(`Destination escapes KSP root: ${normalized}`, "INVALID_DESTINATION");
    }
    return resolved;
  }

  private async removeInstalledPath(kspRoot: string, relativePath: string): Promise<void> {
    const absolute = await this.resolveDestination(kspRoot, relativePath);
    await rm(absolute, { force: true });
  }

  private async readInstalledFiles(kspRoot: string, files: readonly string[]): Promise<Map<string, Uint8Array>> {
    const contents = new Map<string, Uint8Array>();
    for (const relativePath of files) {
      const absolute = await this.resolveDestination(kspRoot, relativePath);
      try {
        contents.set(relativePath, await readFile(absolute));
      } catch (error: unknown) {
        if (!isMissingFile(error)) {
          throw error;
        }
      }
    }
    return contents;
  }

  private async rollbackInstall(
    kspRoot: string,
    installedFiles: readonly string[],
    previousFiles: ReadonlyMap<string, Uint8Array>,
  ): Promise<void> {
    let rollbackError: unknown;
    for (const relativePath of [...new Set(installedFiles)].sort((left, right) => right.length - left.length)) {
      try {
        await this.removeInstalledPath(kspRoot, relativePath);
      } catch (error: unknown) {
        rollbackError ??= error;
      }
    }
    for (const [relativePath, data] of previousFiles) {
      try {
        const absolute = await this.resolveDestination(kspRoot, relativePath);
        await mkdir(dirname(absolute), { recursive: true });
        await writeFile(absolute, data);
      } catch (error: unknown) {
        rollbackError ??= error;
      }
    }
    await this.pruneEmptyParents(kspRoot, installedFiles);
    if (rollbackError !== undefined) {
      throw rollbackError;
    }
  }

  private withManifestMutation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.manifestMutation.then(operation);
    this.manifestMutation = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async pruneEmptyParents(kspRoot: string, files: readonly string[]): Promise<void> {
    const directories = new Set<string>();
    for (const file of files) {
      let current = dirname(normalizeSlashPath(file));
      while (current !== "." && current.length > 0) {
        directories.add(current);
        const parent = dirname(current);
        if (parent === current) {
          break;
        }
        current = parent;
      }
    }
    const ordered = [...directories].sort((left, right) => right.length - left.length);
    for (const directory of ordered) {
      if (directory === "GameData") {
        continue;
      }
      const absolute = await this.resolveDestination(kspRoot, directory);
      try {
        const entries = await readdir(absolute);
        if (entries.length === 0) {
          await rm(absolute, { recursive: true, force: true });
        }
      } catch {
        // Directory may already be gone.
      }
    }
  }
}

function containsPath(root: string, candidate: string): boolean {
  const pathRelative = relative(root, candidate);
  return pathRelative === "" || (!pathRelative.startsWith("..") && !isAbsolute(pathRelative));
}

function isMissingFile(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

// Re-export for error mapping convenience
export { InstallManifestError, StreamingHttpError, ZipArchiveError, InstallPolicyError };
