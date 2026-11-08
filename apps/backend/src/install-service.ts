import type { InstallPlanResponse, InstallRecoveryReport, JobProgressEvent, JobResponse } from "@kraken/contracts";
import {
  buildInventory,
  InstallPolicyError,
  isAllowedDestination,
  isInstallable,
  moduleIdentifierKey,
  normalizeSlashPath,
  planUninstall,
  resolveInstallMappings,
  resolveInstallPlan,
  validateUninstallSelection,
  verifyDownloadHash,
  type CkanModule,
  type FileSystemPort,
  type InstalledModSummary,
  type ManagedModRecord,
  type PlanUninstallOptions,
  type UninstallPlan,
} from "@kraken/core";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { copyFile, mkdir, readdir, rename, rm, rmdir, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { setTimeout as delay } from "node:timers/promises";
import {
  InstallJournal,
  JOURNAL_FILE_NAME,
  JOURNAL_HEARTBEAT_MS,
  JOURNAL_STALE_MS,
  journalFileName,
  readInstallJournal,
  type ParsedInstallJournal,
} from "./adapters/install-journal.js";
import {
  InstallManifestError,
  InstallManifestStore,
  type StoredInstallManifest,
} from "./adapters/install-manifest-store.js";
import { StreamingHttp, StreamingHttpError } from "./adapters/streaming-http.js";
import { ZipArchive, ZipArchiveError, type ZipEntryInfo } from "./adapters/zip-archive.js";
import type { JobQueue } from "./job-queue.js";
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
      | "JOB_ALREADY_QUEUED"
      | "JOB_RUNNING"
      | "NOT_MANAGED"
      | "PLAN_BLOCKED"
      | "PLAN_NOT_READY"
      | "UNINSTALL_PLAN_MISMATCH",
  ) {
    super(message);
    this.name = "InstallServiceError";
  }
}

export class InstallService {
  private manifestMutation: Promise<void> = Promise.resolve();
  private recoveryReport: InstallRecoveryReport = { rolledBack: [], failed: [] };

  constructor(
    private readonly fileSystem: FileSystemPort,
    private readonly registryService: RegistryService,
    private readonly http: StreamingHttp,
    private readonly zip: ZipArchive,
    private readonly manifestStore: InstallManifestStore,
    private readonly jobStore: JobStore,
    private readonly jobQueue: JobQueue,
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

  async planInstall(
    kspPath: string,
    identifier: string,
    version?: string,
    choices?: Readonly<Record<string, string>>,
    optional?: readonly string[],
  ): Promise<InstallPlanResponse> {
    await this.registryService.ensureLoaded();
    const target = this.findModule(identifier, version);
    const inventory = await this.listInstalled(kspPath);
    return resolveInstallPlan({
      target,
      registryModules: this.registryService.listModules(),
      inventory,
      ...(choices !== undefined ? { choices } : {}),
      ...(optional !== undefined ? { optional } : {}),
    });
  }

  async startInstall(
    kspPath: string,
    identifier: string,
    version?: string,
    installDependencies = false,
    choices?: Readonly<Record<string, string>>,
    optional: readonly string[] = [],
  ): Promise<JobResponse> {
    await this.registryService.ensureLoaded();
    const target = this.findModule(identifier, version);
    this.assertNoActiveJob([target.identifier]);
    // Resolve and pin the module list before accepting the job so the worker
    // installs exactly what was validated (no second inventory replan).
    // Picked optional mods and metapackages (which are nothing but their
    // dependencies) need the resolver, so they imply dependency resolution.
    const withDependencies = installDependencies || optional.length > 0 || target.kind === "metapackage";
    const modulesToInstall = await this.resolveModulesForInstall(kspPath, target, withDependencies, choices, optional);

    // Resolving awaits, so a concurrent request may have queued this mod meanwhile.
    // Check again with no await before the create so the two cannot interleave.
    this.assertNoActiveJob([target.identifier]);
    const job = this.jobStore.create("install", identifier, version === undefined ? {} : { version });
    // The user chose the target and each optional mod by name, so none of them
    // is offered for orphan cleanup later.
    const manualIdentifiers = new Set([target.identifier, ...optional]);
    const resolveArguments: ResolveArguments = { withDependencies, choices, optional };
    this.jobQueue.enqueue(job.jobId, () =>
      this.runInstall(job.jobId, kspPath, target, modulesToInstall, manualIdentifiers, resolveArguments),
    );
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

  async planUninstall(kspPath: string, identifier: string): Promise<UninstallPlan> {
    return planUninstall(await this.uninstallOptions(kspPath, identifier));
  }

  /**
   * Validates the selection against the current plan, then queues the removal.
   * The queued run validates again because earlier jobs may change the plan.
   */
  async startUninstall(kspPath: string, identifier: string, alsoRemove: readonly string[]): Promise<JobResponse> {
    this.assertNoActiveJob([identifier, ...alsoRemove]);
    await this.validateUninstall(kspPath, identifier, alsoRemove);

    // Validation awaits, so a concurrent request may have queued the same mods meanwhile.
    // Check again with no await before the create so the two cannot interleave.
    this.assertNoActiveJob([identifier, ...alsoRemove]);
    const job = this.jobStore.create("uninstall", identifier, { alsoRemove: [...alsoRemove] });
    this.jobQueue.enqueue(job.jobId, () => this.runUninstall(job.jobId, kspPath, identifier, alsoRemove));
    return this.jobStore.toResponse(job);
  }

  listJobs(): JobResponse[] {
    return this.jobStore.list();
  }

  /** Cancels a queued job, hides a finished one, and refuses a running one. */
  removeJob(jobId: string): void {
    const job = this.jobStore.get(jobId);
    if (job === undefined) {
      throw new InstallServiceError("Unknown job.", "JOB_NOT_FOUND");
    }
    if (job.status === "succeeded" || job.status === "failed") {
      this.jobStore.hide(jobId);
      return;
    }
    // cancel() is false when the queue picked the job in the meantime.
    if (job.status === "queued" && this.jobQueue.cancel(jobId)) {
      this.jobStore.delete(jobId);
      return;
    }
    throw new InstallServiceError("This job is running and cannot be removed.", "JOB_RUNNING");
  }

  clearFinishedJobs(): void {
    this.jobStore.hideFinished();
  }

  private async validateUninstall(
    kspPath: string,
    identifier: string,
    alsoRemove: readonly string[],
  ): Promise<string[]> {
    const options = await this.uninstallOptions(kspPath, identifier);
    const selection = validateUninstallSelection(planUninstall(options), alsoRemove, options);
    if (!selection.ok) {
      throw new InstallServiceError(selection.problems.join(" "), "UNINSTALL_PLAN_MISMATCH");
    }
    return selection.removeOrder;
  }

  private async runUninstall(
    jobId: string,
    kspPath: string,
    identifier: string,
    alsoRemove: readonly string[],
  ): Promise<void> {
    this.jobStore.update(jobId, {
      status: "running",
      phase: "installing",
      message: `Removing ${this.displayName(identifier)}.`,
    });
    try {
      const removed = await this.withManifestMutation(async () => {
        const removeOrder = await this.validateUninstall(kspPath, identifier, alsoRemove);
        const canonicalRoot = await this.fileSystem.realpath(kspPath);
        let manifest = await this.manifestStore.read();
        for (const removedIdentifier of removeOrder) {
          manifest = await this.removeManagedMod(canonicalRoot, manifest, removedIdentifier);
        }
        return removeOrder;
      });
      this.jobStore.update(jobId, { status: "succeeded", phase: "done", removed });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Uninstall failed.";
      this.jobStore.update(jobId, { status: "failed", phase: "failed", error: message, message });
    }
  }

  private displayName(identifier: string): string {
    return this.registryService.findModule(identifier)?.name ?? identifier;
  }

  private assertNoActiveJob(identifiers: readonly string[]): void {
    const active = this.jobStore.activeIdentifiers();
    const busy = identifiers.find((identifier) => active.has(moduleIdentifierKey(identifier)));
    if (busy !== undefined) {
      throw new InstallServiceError(
        `${this.displayName(busy)} already has a queued or running job.`,
        "JOB_ALREADY_QUEUED",
      );
    }
  }

  private async uninstallOptions(kspPath: string, identifier: string): Promise<PlanUninstallOptions> {
    const inventory = await this.listInstalled(kspPath);
    const canonicalRoot = await this.fileSystem.realpath(kspPath);
    const manifest = await this.manifestStore.read();
    const managed = manifest.mods.filter((mod) => mod.installationPath === canonicalRoot);
    if (!managed.some((mod) => mod.identifier === identifier)) {
      throw new InstallServiceError("Only managed mods can be uninstalled.", "NOT_MANAGED");
    }
    return {
      targetIdentifier: identifier,
      managed,
      inventory,
      registryModules: this.registryService.listModules(),
    };
  }

  /**
   * Deletes one managed mod's files and drops its record. If a file cannot be
   * removed, the record keeps only the files still on disk and the error
   * propagates, so mods removed earlier in the same uninstall stay removed.
   */
  private async removeManagedMod(
    canonicalRoot: string,
    manifest: StoredInstallManifest,
    identifier: string,
  ): Promise<StoredInstallManifest> {
    const record = manifest.mods.find(
      (mod) => mod.identifier === identifier && mod.installationPath === canonicalRoot,
    );
    if (record === undefined) {
      throw new InstallServiceError(`${identifier} is not managed in this installation.`, "NOT_MANAGED");
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
        schemaVersion: 2,
        mods:
          remainingFiles.length === 0
            ? manifest.mods.filter((mod) => mod !== record)
            : manifest.mods.map((mod) => (mod === record ? { ...record, files: remainingFiles } : mod)),
      });
      throw error;
    }

    const next: StoredInstallManifest = { schemaVersion: 2, mods: manifest.mods.filter((mod) => mod !== record) };
    await this.manifestStore.write(next);
    return next;
  }

  private async runInstall(
    jobId: string,
    kspPath: string,
    target: CkanModule,
    acceptedModules: readonly CkanModule[],
    manualIdentifiers: ReadonlySet<string>,
    resolveArguments: ResolveArguments,
  ): Promise<void> {
    const completed: ModuleInstallSnapshot[] = [];
    let journal: InstallJournal | undefined;
    let modulesToInstall: readonly CkanModule[];
    try {
      this.jobStore.update(jobId, { status: "running", phase: "downloading", message: "Resolving module metadata." });
      // The queue may have waited while other jobs changed the installation,
      // so the plan accepted earlier is checked again before any file is touched.
      modulesToInstall = await this.recheckPlan(kspPath, target, acceptedModules, resolveArguments);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Install failed.";
      this.jobStore.update(jobId, { status: "failed", phase: "failed", error: message, message });
      return;
    }
    try {
      const canonicalRoot = await this.fileSystem.realpath(kspPath);
      journal = new InstallJournal(join(canonicalRoot, BACKUP_DIRECTORY, journalFileName(jobId)));

      for (const [index, module] of modulesToInstall.entries()) {
        const stepLabel =
          modulesToInstall.length > 1
            ? ` (${index + 1}/${modulesToInstall.length}: ${module.identifier})`
            : "";
        const isManual = manualIdentifiers.has(module.identifier);
        const snapshot = await this.installSingleModule(jobId, kspPath, module, stepLabel, isManual, journal);
        completed.push(snapshot);
      }
      await journal.commit();
    } catch (error: unknown) {
      await this.failInstall(jobId, kspPath, completed, journal, error);
      return;
    }

    // The install is complete from here on; cleanup problems never undo it.
    if (await this.discardBackups(completed)) {
      await this.deleteJournal(journal);
    } else {
      // The committed journal lets the next start finish deleting the backups.
      await journal.close().catch((error: unknown) => {
        console.warn(`Could not close install journal ${journal?.path}: ${errorMessage(error)}`);
      });
    }
    this.jobStore.update(jobId, {
      status: "succeeded",
      phase: "done",
      message: "Install completed.",
      version: target.version,
    });
  }

  /**
   * Resolves the plan again at start. Modules that were not part of the
   * accepted plan fail the job rather than being installed unreviewed; accepted
   * modules that are no longer needed are simply skipped.
   */
  private async recheckPlan(
    kspPath: string,
    target: CkanModule,
    accepted: readonly CkanModule[],
    resolveArguments: ResolveArguments,
  ): Promise<CkanModule[]> {
    const current = await this.resolveModulesForInstall(
      kspPath,
      target,
      resolveArguments.withDependencies,
      resolveArguments.choices,
      resolveArguments.optional,
    );
    const acceptedKeys = new Set(accepted.map(planKey));
    const added = current.filter((module) => !acceptedKeys.has(planKey(module)));
    if (added.length > 0) {
      throw new InstallServiceError(
        `The install plan changed after it was queued: it now also needs ${added.map((module) => module.name).join(", ")}.`,
        "PLAN_NOT_READY",
      );
    }
    return current;
  }

  private async failInstall(
    jobId: string,
    kspPath: string,
    completed: readonly ModuleInstallSnapshot[],
    journal: InstallJournal | undefined,
    error: unknown,
  ): Promise<void> {
    const installError = error instanceof ModuleRollbackError ? error.installError : error;
    let rollbackError = error instanceof ModuleRollbackError ? error.rollbackError : undefined;
    if (completed.length > 0) {
      try {
        await this.rollbackCompletedModules(kspPath, completed);
      } catch (completedRollbackError: unknown) {
        rollbackError ??= completedRollbackError;
      }
    }
    // A journal is kept only for a job the process never finished. One left by
    // a finished job would undo a later install of the same mod at the next start.
    await this.deleteJournal(journal);

    const message = installError instanceof Error ? installError.message : "Install failed.";
    const fullMessage =
      rollbackError === undefined
        ? message
        : `${message} Rollback also failed: ${rollbackError instanceof Error ? rollbackError.message : "Job rollback failed."}`;
    this.jobStore.update(jobId, { status: "failed", phase: "failed", error: fullMessage, message: fullMessage });
  }

  private async deleteJournal(journal: InstallJournal | undefined): Promise<void> {
    if (journal === undefined) {
      return;
    }
    try {
      await journal.remove();
      await removeDirectoryIfEmpty(dirname(journal.path));
    } catch (error: unknown) {
      console.warn(`Could not delete install journal ${journal.path}: ${errorMessage(error)}`);
    }
  }

  /**
   * Backups stay until the whole job succeeds, because a later module's
   * failure rolls earlier ones back. A backup that cannot be deleted does not
   * fail a finished install; it is reported and found again at startup.
   */
  private async discardBackups(completed: readonly ModuleInstallSnapshot[]): Promise<boolean> {
    let allDeleted = true;
    for (const snapshot of completed) {
      try {
        await this.discardBackup(snapshot.installationPath, snapshot.backup);
      } catch (error: unknown) {
        allDeleted = false;
        console.warn(`Could not delete install backup ${snapshot.backup.directory}: ${errorMessage(error)}`);
      }
    }
    return allDeleted;
  }

  private async resolveModulesForInstall(
    kspPath: string,
    target: CkanModule,
    installDependencies: boolean,
    choices: Readonly<Record<string, string>> | undefined,
    optional: readonly string[],
  ): Promise<CkanModule[]> {
    if (!installDependencies) {
      if (!hasInstallSource(target)) {
        throw new InstallServiceError("This mod does not declare a download URL.", "NO_DOWNLOAD");
      }
      return [target];
    }

    const inventory = await this.listInstalled(kspPath);
    const plan = resolveInstallPlan({
      target,
      registryModules: this.registryService.listModules(),
      inventory,
      ...(choices !== undefined ? { choices } : {}),
      optional,
    });
    if (plan.status === "choice-required") {
      throw new InstallServiceError(
        `Install plan needs a choice for: ${plan.choices.map((choice) => choice.label).join(", ")}.`,
        "PLAN_NOT_READY",
      );
    }
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
      if (!hasInstallSource(module)) {
        throw new InstallServiceError(
          module.kind === "dlc"
            ? `Dependency ${module.identifier} is a DLC that Kraken cannot install.`
            : `Dependency ${module.identifier} does not declare a download URL.`,
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
    isManual: boolean,
    journal: InstallJournal,
  ): Promise<ModuleInstallSnapshot> {
    if (module.kind === "metapackage") {
      return await this.installMetapackage(jobId, kspPath, module, stepLabel, isManual, journal);
    }
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

    await mkdir(this.downloadCacheDirectory, { recursive: true });
    // Each download gets its own name, so concurrent jobs never share a file,
    // and it is deleted once this module is installed or has failed.
    const downloadPath = `${resolveDownloadCachePath(this.downloadCacheDirectory, module.identifier, module.version)}.${globalThis.crypto.randomUUID()}.download`;
    try {
      return await this.installFromDownload(jobId, kspPath, module, stepLabel, isManual, downloadPath, journal);
    } finally {
      await rm(downloadPath, { force: true });
    }
  }

  /**
   * A metapackage has no archive: it is recorded with no files so the mods it
   * depends on are tracked as its dependencies, and it can be updated and
   * uninstalled like any managed mod.
   */
  private async installMetapackage(
    jobId: string,
    kspPath: string,
    module: CkanModule,
    stepLabel: string,
    isManual: boolean,
    journal: InstallJournal,
  ): Promise<ModuleInstallSnapshot> {
    this.jobStore.update(jobId, {
      status: "running",
      phase: "installing",
      message: `Recording metapackage${stepLabel}.`,
      version: module.version,
    });
    return await this.withManifestMutation(async () => {
      const canonicalRoot = await this.fileSystem.realpath(kspPath);
      const manifest = await this.manifestStore.read();
      const previous = manifest.mods.find(
        (mod) => mod.identifier === module.identifier && mod.installationPath === canonicalRoot,
      );
      const previousRecord = previous === undefined ? undefined : { ...previous, files: [...previous.files] };
      const backupId = globalThis.crypto.randomUUID();
      await journal.beginModule({
        identifier: module.identifier,
        name: module.name,
        backupId,
        previousRecord: previousRecord ?? null,
      });
      const record: ManagedModRecord = {
        identifier: module.identifier,
        name: module.name,
        version: module.version,
        installationPath: canonicalRoot,
        files: [],
        autoInstalled: previous?.autoInstalled ?? !isManual,
      };
      const nextMods = manifest.mods.filter(
        (mod) => mod.identifier !== module.identifier || mod.installationPath !== canonicalRoot,
      );
      nextMods.push(record);
      await this.manifestStore.write({ schemaVersion: 2, mods: nextMods });
      return {
        identifier: module.identifier,
        installationPath: canonicalRoot,
        installedFiles: [],
        ...(previousRecord !== undefined ? { previousRecord } : {}),
        backup: { directory: join(canonicalRoot, BACKUP_DIRECTORY, backupId), files: [] },
      };
    });
  }

  private async installFromDownload(
    jobId: string,
    kspPath: string,
    module: CkanModule,
    stepLabel: string,
    isManual: boolean,
    downloadPath: string,
    journal: InstallJournal,
  ): Promise<ModuleInstallSnapshot> {
    if (module.download === undefined || module.download.length === 0) {
      throw new InstallServiceError("This mod does not declare a download URL.", "NO_DOWNLOAD");
    }
    await this.downloadVerifiedArchive(jobId, module, [module.download, ...(module.downloadMirrors ?? [])], stepLabel, downloadPath);

    this.jobStore.update(jobId, { phase: "extracting", message: `Extracting archive${stepLabel}.` });
    const zipEntries = await this.zip.listEntries(downloadPath);
    const mappings = resolveInstallMappings(
      module,
      zipEntries.map((entry) => entry.path),
    );
    const entriesByPath = new Map(zipEntries.map((entry) => [entry.path, entry]));

    this.jobStore.update(jobId, { phase: "installing", message: `Copying files into GameData${stepLabel}.` });
    return await this.withManifestMutation(async () => {
      const canonicalRoot = await this.fileSystem.realpath(kspPath);
      const manifest = await this.manifestStore.read();
      const previous = manifest.mods.find(
        (mod) => mod.identifier === module.identifier && mod.installationPath === canonicalRoot,
      );
      const previousRecord = previous === undefined ? undefined : { ...previous, files: [...previous.files] };

      // Validate every mapping before touching any file.
      const destinationsBySource = new Map<string, string[]>();
      const selectedEntries: ZipEntryInfo[] = [];
      for (const mapping of mappings) {
        if (!isAllowedDestination(mapping.destinationPath)) {
          throw new InstallPolicyError(
            `Destination escapes allowed roots: ${mapping.destinationPath}`,
            "INVALID_DESTINATION",
          );
        }
        const entry = entriesByPath.get(mapping.sourcePath);
        if (entry === undefined) {
          throw new InstallServiceError(`Missing archive entry: ${mapping.sourcePath}`, "INSTALL_FAILED");
        }
        const destinations = destinationsBySource.get(entry.path);
        const relativeDestination = normalizeSlashPath(mapping.destinationPath);
        if (destinations === undefined) {
          destinationsBySource.set(entry.path, [relativeDestination]);
          selectedEntries.push(entry);
        } else {
          destinations.push(relativeDestination);
        }
      }

      // The previous version moves out of the way instead of being read into
      // memory; it comes back if anything below fails, or at the next start
      // if the process dies first.
      const backupId = globalThis.crypto.randomUUID();
      await journal.beginModule({
        identifier: module.identifier,
        name: module.name,
        backupId,
        previousRecord: previousRecord ?? null,
      });
      const backup = await this.backUpFiles(canonicalRoot, previous?.files ?? [], backupId);
      const installedFiles: string[] = [];

      try {
        await this.zip.extractEntries(downloadPath, selectedEntries, async (entry, source) => {
          const [first, ...copies] = destinationsBySource.get(entry.path) ?? [];
          if (first === undefined) {
            throw new InstallServiceError(`No destination for archive entry: ${entry.path}`, "INSTALL_FAILED");
          }
          const firstDestination = await this.resolveDestination(canonicalRoot, first);
          installedFiles.push(first);
          await journal.recordFile(first);
          await mkdir(dirname(firstDestination), { recursive: true });
          await pipeline(source, createWriteStream(firstDestination));
          // The entry stream can be read once; further mappings copy the file.
          for (const relativeDestination of copies) {
            const absoluteDestination = await this.resolveDestination(canonicalRoot, relativeDestination);
            installedFiles.push(relativeDestination);
            await journal.recordFile(relativeDestination);
            await mkdir(dirname(absoluteDestination), { recursive: true });
            await copyFile(firstDestination, absoluteDestination);
          }
        });

        // Folders that only the previous version used are empty now.
        await this.pruneEmptyParents(canonicalRoot, previous?.files ?? []);

        const record: ManagedModRecord = {
          identifier: module.identifier,
          name: module.name,
          version: module.version,
          installationPath: canonicalRoot,
          files: installedFiles,
          // A reinstall or update keeps the flag, so updating an auto-installed
          // dependency does not turn it into a manual install.
          autoInstalled: previous?.autoInstalled ?? !isManual,
        };
        const nextMods = manifest.mods.filter(
          (mod) => mod.identifier !== module.identifier || mod.installationPath !== canonicalRoot,
        );
        nextMods.push(record);
        await this.manifestStore.write({ schemaVersion: 2, mods: nextMods });
        return {
          identifier: module.identifier,
          installationPath: canonicalRoot,
          installedFiles: [...installedFiles],
          ...(previousRecord !== undefined ? { previousRecord } : {}),
          backup,
        };
      } catch (error: unknown) {
        try {
          await this.rollbackInstall(canonicalRoot, installedFiles, backup);
        } catch (rollbackError: unknown) {
          throw new ModuleRollbackError(error, rollbackError);
        }
        throw error;
      }
    });
  }

  /**
   * Downloads the archive from the first URL that answers with a file whose
   * hash matches, trying mirrors in order. Every attempt is verified, so a
   * mirror serving a different file is skipped rather than installed.
   */
  private async downloadVerifiedArchive(
    jobId: string,
    module: CkanModule,
    urls: readonly string[],
    stepLabel: string,
    downloadPath: string,
  ): Promise<void> {
    const failures: string[] = [];
    for (const [index, url] of urls.entries()) {
      const source = urls.length > 1 ? ` from source ${index + 1} of ${urls.length}` : "";
      this.jobStore.update(jobId, {
        phase: "downloading",
        message: `Downloading archive${stepLabel}${source}.`,
        bytesReceived: 0,
      });
      try {
        const download = await this.http.download(url, downloadPath, (progress) => {
          this.jobStore.update(jobId, {
            phase: "downloading",
            bytesReceived: progress.bytesReceived,
            ...(progress.bytesTotal !== undefined ? { bytesTotal: progress.bytesTotal } : {}),
          });
        });
        this.jobStore.update(jobId, { phase: "verifying", message: `Verifying download hash${stepLabel}.` });
        verifyDownloadHash(module.downloadHash, { sha1: download.sha1, sha256: download.sha256 });
        return;
      } catch (error: unknown) {
        const retryable =
          error instanceof StreamingHttpError || (error instanceof InstallPolicyError && error.code === "HASH_MISMATCH");
        if (!retryable || urls.length === 1) {
          throw error;
        }
        await rm(downloadPath, { force: true });
        failures.push(`${url}: ${errorMessage(error)}`);
      }
    }
    throw new InstallServiceError(
      `Could not download ${module.identifier} from any of its ${urls.length} sources. ${failures.join(" ")}`,
      "INSTALL_FAILED",
    );
  }

  private async rollbackCompletedModules(
    kspPath: string,
    completed: readonly ModuleInstallSnapshot[],
  ): Promise<void> {
    await this.withManifestMutation(async () => {
      const canonicalRoot = await this.fileSystem.realpath(kspPath);
      let manifest = await this.manifestStore.read();

      for (const snapshot of [...completed].reverse()) {
        if (snapshot.installationPath !== canonicalRoot) {
          continue;
        }
        await this.rollbackInstall(canonicalRoot, snapshot.installedFiles, snapshot.backup);
        if (snapshot.previousRecord === undefined) {
          manifest = {
            schemaVersion: 2,
            mods: manifest.mods.filter(
              (mod) =>
                mod.identifier !== snapshot.identifier || mod.installationPath !== snapshot.installationPath,
            ),
          };
        } else {
          const restored = snapshot.previousRecord;
          const without = manifest.mods.filter(
            (mod) => mod.identifier !== restored.identifier || mod.installationPath !== restored.installationPath,
          );
          without.push(restored);
          manifest = { schemaVersion: 2, mods: without };
        }
        await this.manifestStore.write(manifest);
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

  /**
   * Moves `files` into a new backup folder under the KSP root, on the same
   * file system as GameData, so the move is a rename rather than a copy.
   * Files already missing are skipped. If a move fails, the files moved so
   * far go back before the error propagates.
   */
  private async backUpFiles(kspRoot: string, files: readonly string[], backupId: string): Promise<InstallBackup> {
    const backup: InstallBackup = {
      directory: join(kspRoot, BACKUP_DIRECTORY, backupId),
      files: [],
    };
    try {
      for (const relativePath of files) {
        const source = await this.resolveDestination(kspRoot, relativePath);
        if (await moveFile(source, resolveBackupPath(backup.directory, relativePath))) {
          backup.files.push(relativePath);
        }
      }
    } catch (error: unknown) {
      await this.restoreBackup(kspRoot, backup);
      throw error;
    }
    return backup;
  }

  /** Moves backed-up files back into place and deletes the backup folder once it is empty. */
  private async restoreBackup(kspRoot: string, backup: InstallBackup): Promise<void> {
    let restoreError: unknown;
    for (const relativePath of backup.files) {
      try {
        const destination = await this.resolveDestination(kspRoot, relativePath);
        await moveFile(resolveBackupPath(backup.directory, relativePath), destination);
      } catch (error: unknown) {
        restoreError ??= error;
      }
    }
    if (restoreError !== undefined) {
      throw new InstallServiceError(
        `Could not restore the previous version from ${backup.directory}: ${errorMessage(restoreError)}`,
        "INSTALL_FAILED",
      );
    }
    await this.discardBackup(kspRoot, backup);
  }

  /** Deletes a backup folder, and the backup root once nothing else is in it. */
  private async discardBackup(kspRoot: string, backup: InstallBackup): Promise<void> {
    await rm(backup.directory, { recursive: true, force: true });
    // Another job's backup or journal may still live there.
    await removeDirectoryIfEmpty(join(kspRoot, BACKUP_DIRECTORY));
  }

  /**
   * Startup housekeeping: deletes leftover downloads from earlier runs and
   * undoes installs a previous run never finished, using their journals.
   * Backups without a journal (from versions before 0.6.0) can hold the only
   * copy of a previous mod version, so they are only reported. Must not run
   * while an install is active. `recheckDelayMs` is how long to wait before
   * trusting a stale heartbeat of a live process; tests shorten it.
   */
  async cleanupTemporaryFiles(
    kspPaths: readonly string[],
    { recheckDelayMs = JOURNAL_HEARTBEAT_MS + 5_000 }: { recheckDelayMs?: number } = {},
  ): Promise<void> {
    let names: string[] = [];
    try {
      names = await readdir(this.downloadCacheDirectory);
    } catch (error: unknown) {
      if (!isMissingFile(error)) {
        throw error;
      }
    }
    for (const name of names) {
      if (TEMPORARY_DOWNLOAD.test(name)) {
        await rm(join(this.downloadCacheDirectory, name), { force: true });
      }
    }

    // Paths are canonicalised before deduplicating, so one installation written
    // in two forms is recovered once. The first path is the active installation.
    const seen = new Set<string>();
    for (const [index, kspPath] of kspPaths.entries()) {
      let canonicalRoot: string;
      try {
        canonicalRoot = await this.fileSystem.realpath(kspPath);
      } catch (error: unknown) {
        if (isMissingFile(error)) {
          console.info(`Skipping startup recovery for ${kspPath}: the folder no longer exists.`);
        } else {
          this.recoveryReport.failed.push({ installationPath: kspPath, message: errorMessage(error) });
          console.warn(`Could not recover installation ${kspPath}: ${errorMessage(error)}`);
        }
        continue;
      }
      if (index === 0) {
        this.recoveryReport.activeInstallationPath = canonicalRoot;
      }
      if (seen.has(canonicalRoot)) {
        continue;
      }
      seen.add(canonicalRoot);
      try {
        await this.recoverInstallation(canonicalRoot, recheckDelayMs);
      } catch (error: unknown) {
        this.recoveryReport.failed.push({ installationPath: canonicalRoot, message: errorMessage(error) });
        console.warn(`Could not recover installation ${canonicalRoot}: ${errorMessage(error)}`);
      }
    }
  }

  /** Journal recovery and the untracked-backup check for one canonical installation root. */
  private async recoverInstallation(canonicalRoot: string, recheckDelayMs: number): Promise<void> {
    const backupRoot = join(canonicalRoot, BACKUP_DIRECTORY);
    const tracked = new Set<string>();
    for (const name of await readDirectoryNames(backupRoot)) {
      const jobId = JOURNAL_FILE_NAME.exec(name)?.[1];
      if (jobId !== undefined) {
        await this.recoverJob(canonicalRoot, jobId, join(backupRoot, name), tracked, recheckDelayMs);
      }
    }

    const untracked = (await readDirectoryNames(backupRoot)).filter(
      (name) => !tracked.has(name) && !JOURNAL_FILE_NAME.test(name),
    );
    if (untracked.length === 0) {
      await removeDirectoryIfEmpty(backupRoot);
      return;
    }
    (this.recoveryReport.untrackedBackups ??= []).push({
      installationPath: canonicalRoot,
      count: untracked.length,
      directory: backupRoot,
    });
    console.warn(
      `Found ${untracked.length} backup folder(s) without an install journal in ${backupRoot}. ` +
        "Kraken cannot restore them automatically. They may hold the only copy of a previous mod version, " +
        "so check them before deleting anything.",
    );
  }

  /** What the last startup cleanup did with interrupted installs. */
  getRecoveryReport(): InstallRecoveryReport {
    return structuredClone(this.recoveryReport);
  }

  /**
   * Undoes one interrupted job, or finishes deleting the backups of one that
   * had committed. A journal that cannot be read or applied stays in place
   * with its backups, so nothing is lost and the next start tries again.
   */
  private async recoverJob(
    canonicalRoot: string,
    jobId: string,
    journalPath: string,
    tracked: Set<string>,
    recheckDelayMs: number,
  ): Promise<void> {
    const reportFailure = (message: string): void => {
      this.recoveryReport.failed.push({ jobId, installationPath: canonicalRoot, message });
      console.warn(message);
    };

    let journal: ParsedInstallJournal;
    try {
      journal = await readInstallJournal(journalPath);
    } catch (error: unknown) {
      reportFailure(errorMessage(error));
      return;
    }
    for (const module of journal.modules) {
      tracked.add(module.backupId);
    }
    // A live pid alone is not proof: pids get reused, so the journal must also
    // have been touched recently by the owner's heartbeat.
    let mtimeMs: number;
    try {
      mtimeMs = (await stat(journalPath)).mtimeMs;
    } catch (error: unknown) {
      reportFailure(`Could not inspect the install journal ${journalPath}: ${errorMessage(error)}`);
      return;
    }
    const isFresh = Date.now() - mtimeMs < JOURNAL_STALE_MS;
    const ownerAlive = journal.pid !== undefined && journal.pid !== process.pid && isProcessAlive(journal.pid);
    let stillRunning = ownerAlive && isFresh;
    if (ownerAlive && !isFresh) {
      // A suspended machine stops the owner's timers, so its heartbeat can be
      // late while the mtime already looks old. Give it one more beat.
      await delay(recheckDelayMs);
      try {
        stillRunning = (await stat(journalPath)).mtimeMs !== mtimeMs;
      } catch (error: unknown) {
        reportFailure(`Could not inspect the install journal ${journalPath}: ${errorMessage(error)}`);
        return;
      }
    }
    if (stillRunning) {
      reportFailure(
        `Kraken process ${journal.pid}, which started an unfinished install, is still running, so its journal ${journalPath} was left alone.`,
      );
      return;
    }

    if (journal.modules.length === 0) {
      // A fresh file may be a journal being created right now.
      if (isFresh) {
        return;
      }
      try {
        await rm(journalPath, { force: true });
      } catch (error: unknown) {
        reportFailure(`Could not remove the empty install journal ${journalPath}: ${errorMessage(error)}`);
        return;
      }
      console.info(`Removed the empty install journal ${journalPath}.`);
      return;
    }

    try {
      const backupRoot = dirname(journalPath);
      if (journal.committed) {
        for (const module of journal.modules) {
          await rm(join(backupRoot, module.backupId), { recursive: true, force: true });
        }
      } else {
        await this.withManifestMutation(() => this.rollBackJournal(canonicalRoot, backupRoot, journal));
        this.recoveryReport.rolledBack.push({
          jobId,
          installationPath: canonicalRoot,
          modules: journal.modules.map((module) => ({
            identifier: module.identifier,
            name: module.name,
            ...(module.previousRecord === null ? {} : { restoredVersion: module.previousRecord.version }),
          })),
        });
      }
      await rm(journalPath, { force: true });
    } catch (error: unknown) {
      reportFailure(
        `Could not undo the interrupted install recorded in ${journalPath}: ${errorMessage(error)} Its backups were kept.`,
      );
    }
  }

  /**
   * Validates every path in the journal before touching a file, then undoes
   * the modules newest first: deletes what the job wrote, moves the backup
   * back and restores the manifest record.
   */
  private async rollBackJournal(
    canonicalRoot: string,
    backupRoot: string,
    journal: ParsedInstallJournal,
  ): Promise<void> {
    const steps: Array<{ files: string[]; backup: InstallBackup; identifier: string; previous: ManagedModRecord | null }> =
      [];
    for (const module of journal.modules) {
      if (module.previousRecord !== null && module.previousRecord.installationPath !== canonicalRoot) {
        throw new InstallServiceError(
          `The journal entry for ${module.identifier} belongs to another installation.`,
          "INSTALL_FAILED",
        );
      }
      const files = [...new Set(module.files)];
      for (const file of files) {
        await this.resolveDestination(canonicalRoot, file);
      }
      const directory = join(backupRoot, module.backupId);
      const backedUp = await listFilesRecursively(directory);
      for (const file of backedUp) {
        await this.resolveDestination(canonicalRoot, file);
        resolveBackupPath(directory, file);
      }
      steps.push({
        files,
        backup: { directory, files: backedUp },
        identifier: module.identifier,
        previous: module.previousRecord,
      });
    }

    let manifest = await this.manifestStore.read();
    for (const step of steps.reverse()) {
      await this.rollbackInstall(canonicalRoot, step.files, step.backup);
      const others = manifest.mods.filter(
        (mod) => mod.identifier !== step.identifier || mod.installationPath !== canonicalRoot,
      );
      manifest = { schemaVersion: 2, mods: step.previous === null ? others : [...others, step.previous] };
      await this.manifestStore.write(manifest);
    }
  }

  private async rollbackInstall(
    kspRoot: string,
    installedFiles: readonly string[],
    backup: InstallBackup,
  ): Promise<void> {
    let rollbackError: unknown;
    for (const relativePath of [...new Set(installedFiles)].sort((left, right) => right.length - left.length)) {
      try {
        await this.removeInstalledPath(kspRoot, relativePath);
      } catch (error: unknown) {
        rollbackError ??= error;
      }
    }
    try {
      await this.restoreBackup(kspRoot, backup);
    } catch (error: unknown) {
      rollbackError ??= error;
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

/** Stable, path-safe cache filename derived from identifier+version (not from raw strings). */
export function resolveDownloadCachePath(cacheDirectory: string, identifier: string, version: string): string {
  const digest = createHash("sha256").update(`${identifier}\0${version}`, "utf8").digest("hex");
  const cachePath = resolve(cacheDirectory, `${digest}.zip`);
  if (!containsPath(resolve(cacheDirectory), cachePath)) {
    throw new InstallServiceError("Download cache path escapes cache directory.", "INSTALL_FAILED");
  }
  return cachePath;
}

interface ModuleInstallSnapshot {
  identifier: string;
  installationPath: string;
  installedFiles: string[];
  previousRecord?: ManagedModRecord;
  backup: InstallBackup;
}

interface InstallBackup {
  /** Absolute folder holding the moved files under their relative paths. */
  directory: string;
  /** Relative paths that were moved and must go back on rollback. */
  files: string[];
}

/** Metapackages install without a download; everything else needs a non-empty URL and not be DLC. */
function hasInstallSource(module: CkanModule): boolean {
  return isInstallable(module) && (module.kind === "metapackage" || (module.download?.length ?? 0) > 0);
}

/** Hidden folder in the KSP root; KSP only loads GameData, so it is ignored. */
interface ResolveArguments {
  withDependencies: boolean;
  choices: Readonly<Record<string, string>> | undefined;
  optional: readonly string[];
}

function planKey(module: CkanModule): string {
  return `${moduleIdentifierKey(module.identifier)}@${module.version}`;
}

const BACKUP_DIRECTORY = ".kraken-backup";

/** Names this service gives downloads, including those of older versions. */
const TEMPORARY_DOWNLOAD = /^[0-9a-f]{64}\.zip(\.[0-9a-f-]{36}\.(download|partial))?$/;

function resolveBackupPath(backupDirectory: string, relativePath: string): string {
  const segments = normalizeSlashPath(relativePath).split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new InstallPolicyError(`Unsafe backup path: ${relativePath}`, "INVALID_DESTINATION");
  }
  const resolved = resolve(backupDirectory, ...segments);
  if (!containsPath(backupDirectory, resolved)) {
    throw new InstallPolicyError(`Backup path escapes its folder: ${relativePath}`, "INVALID_DESTINATION");
  }
  return resolved;
}

/**
 * Moves a file, copying when source and target are on different file
 * systems. Returns false when the source does not exist.
 */
async function moveFile(source: string, target: string): Promise<boolean> {
  await mkdir(dirname(target), { recursive: true });
  try {
    await rename(source, target);
    return true;
  } catch (error: unknown) {
    if (isMissingFile(error)) {
      return false;
    }
    if (!hasErrorCode(error, "EXDEV")) {
      throw error;
    }
  }
  await copyFile(source, target);
  await rm(source, { force: true });
  return true;
}

function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

function isDirectoryNotEmpty(error: unknown): boolean {
  return hasErrorCode(error, "ENOTEMPTY") || hasErrorCode(error, "EEXIST");
}

/** Removes a directory if nothing is left in it; a missing directory is fine. */
async function removeDirectoryIfEmpty(directory: string): Promise<void> {
  try {
    await rmdir(directory);
  } catch (error: unknown) {
    if (!isMissingFile(error) && !isDirectoryNotEmpty(error)) {
      throw error;
    }
  }
}

async function readDirectoryNames(directory: string): Promise<string[]> {
  try {
    return await readdir(directory);
  } catch (error: unknown) {
    if (isMissingFile(error)) {
      return [];
    }
    throw error;
  }
}

/** Files under `directory` as slash-separated relative paths; none when it is missing. */
async function listFilesRecursively(directory: string): Promise<string[]> {
  try {
    const entries = await readdir(directory, { recursive: true, withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile())
      .map((entry) => relative(directory, join(entry.parentPath, entry.name)).split(sep).join("/"));
  } catch (error: unknown) {
    if (isMissingFile(error)) {
      return [];
    }
    throw error;
  }
}

/** Signal 0 only checks that the process exists; EPERM means it exists under another user. */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    return hasErrorCode(error, "EPERM");
  }
}

/** A module failed and putting its previous version back failed too. */
class ModuleRollbackError extends Error {
  constructor(
    readonly installError: unknown,
    readonly rollbackError: unknown,
  ) {
    super(errorMessage(installError));
    this.name = "ModuleRollbackError";
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isMissingFile(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

// Re-export for error mapping convenience
export { InstallManifestError, StreamingHttpError, ZipArchiveError, InstallPolicyError };
