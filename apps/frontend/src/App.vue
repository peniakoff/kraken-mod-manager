<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import type {
  AvailableUpdate,
  CkanModule,
  DirectoryListingResponse,
  InstallPlanResponse,
  InstallRecoveryReport,
  InstalledMod,
  KspInstallation,
  RegistryResponse,
  UninstallPlanResponse,
} from "@kraken/contracts";
import {
  getConfig,
  getDirectories,
  getHealth,
  getInstallRecovery,
  getInstallations,
  getInstalledMods,
  getModDetails,
  getModVersions,
  getRegistry,
  getUpdates,
  importModpack,
  installMod,
  planModInstall,
  refreshRegistry,
  saveInstallation,
  planUninstall,
  searchMods,
  serviceReachable,
  uninstallMod,
} from "./api.js";
import AppShell, { type AppView } from "./components/AppShell.vue";
import BrowseModsView from "./components/BrowseModsView.vue";
import type { DependencyPrompt } from "./components/DependencyPromptDialog.vue";
import DashboardView from "./components/DashboardView.vue";
import InstalledModsView from "./components/InstalledModsView.vue";
import RecoveryNotice from "./components/RecoveryNotice.vue";
import SetupView from "./components/SetupView.vue";
import UninstallDialog from "./components/UninstallDialog.vue";
import { canInstall } from "./installable.js";
import { MOD_BROWSER_PAGE_SIZE } from "./modTags.js";
import { useInstallQueue } from "./useInstallQueue.js";

/** Matches the 1 MB body limit of POST /api/v1/modpacks. */
const MAX_MODPACK_BYTES = 1_048_576;

const status = ref<"checking" | "ready" | "unavailable">("checking");
// The shell's status light shows the connection only. A failed operation
// (a blocked plan, a rejected uninstall) is reported in errorMessage alone.
const serviceStatus = computed(() =>
  status.value === "ready" && !serviceReachable.value ? "unavailable" : status.value,
);
const version = ref<string>();
const installation = ref<KspInstallation>();
const candidates = ref<KspInstallation[]>([]);
const errorMessage = ref<string>();
const directoryListing = ref<DirectoryListingResponse>();
const isSaving = ref(false);
const activeView = ref<AppView>("dashboard");

const registry = ref<RegistryResponse>();
const isRefreshingRegistry = ref(false);
const searchQuery = ref("");
const selectedTag = ref("");
const customTag = ref("");
const compatibleOnly = ref(true);
const currentPage = ref(0);
const pageSize = MOD_BROWSER_PAGE_SIZE;
const searchResults = ref<CkanModule[]>([]);
const searchTotal = ref(0);
const isSearching = ref(false);

const installedMods = ref<InstalledMod[]>([]);
/** What the service undid at startup; cleared once the user dismisses it. */
const recoveryReport = ref<InstallRecoveryReport>();
const availableUpdates = ref<AvailableUpdate[]>([]);
const pendingInstallIdentifiers = ref<string[]>([]);
const isUpdatingAll = ref(false);
const uninstallingIdentifier = ref<string>();
const uninstallPrompt = ref<{ mod: InstalledMod; plan: UninstallPlanResponse; error?: string }>();
const dependencyPrompt = ref<DependencyPrompt>();
const selectedMod = ref<CkanModule>();
const selectedModVersions = ref<CkanModule[]>([]);
const isLoadingVersions = ref(false);

const installQueue = useInstallQueue({
  onSucceeded: () => {
    void refreshInstalledState();
  },
  onFailed: (job) => {
    errorMessage.value = job.error ?? "Install failed.";
  },
});
const {
  jobs: installJobs,
  activeIdentifiers: activeInstallIdentifiers,
  add: addInstallJob,
  dismiss: dismissInstall,
  clearFinished: clearFinishedInstalls,
} = installQueue;

const installingIdentifiers = computed(() => [
  ...new Set([...pendingInstallIdentifiers.value, ...activeInstallIdentifiers.value]),
]);

const effectiveTag = computed(() => {
  // A typed custom tag takes precedence over the selected preset.
  const custom = customTag.value.trim();
  if (custom.length > 0) {
    return custom;
  }
  const selected = selectedTag.value.trim();
  return selected.length > 0 ? selected : undefined;
});

function reportError(error: unknown, fallback: string): void {
  errorMessage.value = error instanceof Error ? error.message : fallback;
}

async function loadSetup(): Promise<void> {
  status.value = "checking";
  errorMessage.value = undefined;

  let config: Awaited<ReturnType<typeof getConfig>>;
  try {
    version.value = (await getHealth()).version;
    // Without a readable config the setup picker would offer to overwrite it.
    config = await getConfig();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "The local service is unavailable.";
    status.value = "unavailable";
    return;
  }

  // The service answered and the config is known, so a failure from here on
  // (an unreadable registry cache, for example) is an error to report, not a
  // dead service.
  try {
    if (config.configured) {
      installation.value = config.installation;
      candidates.value = [];
      activeView.value = "dashboard";
      await loadRecoveryReport();
      await loadConfiguredState(config.installation);
    } else {
      installation.value = undefined;
      candidates.value = (await getInstallations()).installations;
      registry.value = undefined;
      searchResults.value = [];
      searchTotal.value = 0;
      installedMods.value = [];
      availableUpdates.value = [];
      selectedMod.value = undefined;
      selectedModVersions.value = [];
    }
  } catch (error) {
    reportError(error, "The installation could not be loaded.");
  } finally {
    status.value = "ready";
  }
}

async function loadConfiguredState(active: KspInstallation): Promise<void> {
  currentPage.value = 0;
  registry.value = await getRegistry();
  await loadInstalledMods();
  await loadUpdates();
  if (registry.value.status === "ready") {
    await runSearch(active);
  } else {
    searchResults.value = [];
    searchTotal.value = 0;
  }
}

// The report only changes when the service restarts, so it is read once per page load.
async function loadRecoveryReport(): Promise<void> {
  try {
    recoveryReport.value = await getInstallRecovery();
  } catch (error) {
    reportError(error, "Could not check for interrupted installs.");
  }
}

async function loadInstalledMods(): Promise<void> {
  installedMods.value = (await getInstalledMods()).mods;
}

async function loadUpdates(): Promise<void> {
  try {
    availableUpdates.value = (await getUpdates()).updates;
  } catch {
    availableUpdates.value = [];
  }
}

async function refreshInstalledState(): Promise<void> {
  try {
    await Promise.all([loadInstalledMods(), loadUpdates()]);
  } catch (error) {
    reportError(error, "Installed mods could not be refreshed.");
  }
}

function setInstallPending(identifier: string, pending: boolean): void {
  pendingInstallIdentifiers.value = pending
    ? [...new Set([...pendingInstallIdentifiers.value, identifier])]
    : pendingInstallIdentifiers.value.filter((item) => item !== identifier);
}

async function selectInstallation(path: string): Promise<void> {
  isSaving.value = true;
  errorMessage.value = undefined;
  try {
    const config = await saveInstallation(path);
    if (config.configured) {
      installation.value = config.installation;
      candidates.value = [];
      directoryListing.value = undefined;
      activeView.value = "dashboard";
      await loadConfiguredState(config.installation);
    }
  } catch (error) {
    reportError(error, "The installation could not be saved.");
  } finally {
    isSaving.value = false;
  }
}

async function openBrowser(path?: string): Promise<void> {
  errorMessage.value = undefined;
  try {
    directoryListing.value = await getDirectories(path);
  } catch (error) {
    reportError(error, "The directory browser could not be opened.");
  }
}

async function openChild(name: string): Promise<void> {
  if (directoryListing.value === undefined) {
    return;
  }
  await openBrowser(`${directoryListing.value.currentPath}/${name}`);
}

async function onRefreshRegistry(): Promise<void> {
  if (installation.value === undefined) {
    return;
  }
  isRefreshingRegistry.value = true;
  errorMessage.value = undefined;
  currentPage.value = 0;
  try {
    registry.value = await refreshRegistry();
    await runSearch(installation.value);
    await loadInstalledMods();
    await loadUpdates();
  } catch (error) {
    reportError(error, "The registry could not be refreshed.");
  } finally {
    isRefreshingRegistry.value = false;
  }
}

async function runSearch(active?: KspInstallation): Promise<void> {
  const target = active ?? installation.value;
  if (target === undefined) {
    return;
  }
  isSearching.value = true;
  try {
    const result = await searchMods({
      q: searchQuery.value.trim() || undefined,
      tag: effectiveTag.value,
      compatibleWith: compatibleOnly.value ? target.version : undefined,
      limit: pageSize,
      offset: currentPage.value * pageSize,
    });
    searchResults.value = result.mods;
    searchTotal.value = result.total;
  } catch (error) {
    reportError(error, "Mod search failed.");
  } finally {
    isSearching.value = false;
  }
}

function resetModFilters(): void {
  // Changing a filter already schedules a debounced search via watcher,
  // so only search immediately when nothing changed (e.g. page reset).
  const filtersChanged = selectedTag.value !== "" || customTag.value !== "" || compatibleOnly.value !== true;
  selectedTag.value = "";
  customTag.value = "";
  compatibleOnly.value = true;
  currentPage.value = 0;
  if (!filtersChanged && installation.value !== undefined && registry.value?.status === "ready") {
    void runSearch();
  }
}

function onUpdateModPage(page: number): void {
  if (page < 0) {
    return;
  }
  currentPage.value = page;
  void runSearch();
}

let selectModRequestId = 0;

async function onSelectMod(mod: CkanModule | undefined): Promise<void> {
  const currentRequestId = ++selectModRequestId;
  selectedMod.value = mod;

  if (mod === undefined) {
    selectedModVersions.value = [];
    isLoadingVersions.value = false;
    return;
  }

  isLoadingVersions.value = true;
  try {
    const versionsResult = await getModVersions(mod.identifier).catch(() => undefined);
    if (selectModRequestId !== currentRequestId) {
      return;
    }
    if (versionsResult !== undefined && versionsResult.versions.length > 0) {
      selectedModVersions.value = versionsResult.versions;
      const currentVersion = selectedMod.value?.version;
      const matched = versionsResult.versions.find((v) => v.version === currentVersion);
      selectedMod.value = matched ?? versionsResult.versions[0];
    } else {
      selectedModVersions.value = [mod];
    }
  } finally {
    if (selectModRequestId === currentRequestId) {
      isLoadingVersions.value = false;
    }
  }
}

function onSelectModVersion(versionMod: CkanModule): void {
  selectedMod.value = versionMod;
}

async function onImportModpack(file: File): Promise<void> {
  errorMessage.value = undefined;
  if (file.size > MAX_MODPACK_BYTES) {
    errorMessage.value = "The modpack file is larger than 1 MB.";
    return;
  }
  try {
    const { mod } = await importModpack(await file.text());
    await onInstall(mod);
  } catch (error) {
    reportError(error, "The modpack could not be imported.");
  }
}

async function onInstall(mod: CkanModule): Promise<void> {
  if (!canInstall(mod)) {
    return;
  }
  setInstallPending(mod.identifier, true);
  errorMessage.value = undefined;
  dependencyPrompt.value = undefined;
  await planAndApply(mod, {});
}

/** Optional mods offered for one install, carried across re-plans. */
type OptionalState = Pick<DependencyPrompt, "offered" | "selected" | "confirmed" | "seen">;

async function planAndApply(mod: CkanModule, choices: Record<string, string>, optional: OptionalState = {}): Promise<void> {
  try {
    const picked = optional.confirmed === true ? optional.selected : undefined;
    const plan = await planModInstall(mod.identifier, mod.version, choices, picked);
    await applyPlan(mod, plan, choices, optional);
  } catch (error) {
    reportError(error, "Install could not be planned.");
    setInstallPending(mod.identifier, false);
  }
}

async function applyPlan(
  mod: CkanModule,
  plan: InstallPlanResponse,
  choices: Record<string, string>,
  optional: OptionalState,
): Promise<void> {
  if (plan.status === "blocked") {
    const details = [
      ...plan.conflicts.map((entry) => entry.message),
      ...plan.unmet.map((entry) => entry.message),
    ].join(" ");
    errorMessage.value = details.length > 0 ? details : "Install plan is blocked by dependencies or conflicts.";
    setInstallPending(mod.identifier, false);
    return;
  }

  // The first plan decides what is offered; later plans include the picked
  // mods and no longer list them. An installed mod was offered them already.
  const isInstalled = installedMods.value.some((entry) => entry.identifier === mod.identifier);
  const offered =
    optional.offered ?? (isInstalled ? [] : plan.optional.filter((entry) => entry.module !== undefined));
  const selected =
    optional.selected ??
    offered.flatMap((entry) => (entry.kind === "recommends" && entry.module !== undefined ? [entry.module.identifier] : []));
  const confirmed = optional.confirmed === true;

  const missing = plan.toInstall.filter((entry) => entry.identifier !== mod.identifier);
  const isMetapackage = mod.kind === "metapackage";
  const planned = plan.toInstall.map((entry) => entry.identifier);
  // After the optional mods are confirmed, dependencies the user was never
  // shown (brought in by the picked mods) need their own confirmation.
  const unseen = confirmed
    ? missing.filter((entry) => !(optional.seen ?? []).includes(entry.identifier) && !selected.includes(entry.identifier))
    : [];
  if (plan.status === "choice-required" || (!confirmed && (missing.length > 0 || offered.length > 0 || (isMetapackage && optional.offered === undefined))) || unseen.length > 0) {
    setInstallPending(mod.identifier, false);
    const seen = confirmed && plan.status === "choice-required" ? (optional.seen ?? []) : planned;
    dependencyPrompt.value = { mod, plan, choices, offered, selected, confirmed, seen };
    // The dependency dialog lives in the browse view; an update started from
    // the overview or the installed list has to switch there to be seen.
    activeView.value = "browse";
    return;
  }

  const picked = confirmed ? selected : [];
  await startInstallJob(mod, missing.length > 0 || picked.length > 0 || isMetapackage, choices, picked);
}

async function continueWithChoices(choices: Record<string, string>): Promise<void> {
  const prompt = dependencyPrompt.value;
  if (prompt === undefined) {
    return;
  }
  dependencyPrompt.value = undefined;
  setInstallPending(prompt.mod.identifier, true);
  errorMessage.value = undefined;
  await planAndApply(prompt.mod, choices, prompt);
}

async function confirmDependencyInstall(picked: string[]): Promise<void> {
  const prompt = dependencyPrompt.value;
  if (prompt === undefined) {
    return;
  }
  dependencyPrompt.value = undefined;
  if (prompt.confirmed === true) {
    // The user has now seen every mod in this plan.
    await startInstallJob(prompt.mod, true, prompt.choices, prompt.selected ?? []);
    return;
  }
  if (picked.length === 0) {
    const missing = prompt.plan.toInstall.some((entry) => entry.identifier !== prompt.mod.identifier);
    await startInstallJob(prompt.mod, missing || prompt.mod.kind === "metapackage", prompt.choices);
    return;
  }
  // Picked mods can bring dependencies, provider choices or conflicts of
  // their own, so the plan is checked again with them before installing.
  setInstallPending(prompt.mod.identifier, true);
  errorMessage.value = undefined;
  await planAndApply(prompt.mod, prompt.choices, {
    ...(prompt.offered === undefined ? {} : { offered: prompt.offered }),
    selected: picked,
    confirmed: true,
    seen: prompt.seen ?? prompt.plan.toInstall.map((entry) => entry.identifier),
  });
}

function cancelDependencyInstall(): void {
  const identifier = dependencyPrompt.value?.mod.identifier;
  dependencyPrompt.value = undefined;
  if (identifier !== undefined) {
    setInstallPending(identifier, false);
  }
}

async function startInstallJob(
  mod: CkanModule,
  installDependencies: boolean,
  choices: Record<string, string> = {},
  optional: readonly string[] = [],
): Promise<void> {
  setInstallPending(mod.identifier, true);
  errorMessage.value = undefined;
  try {
    const accepted = await installMod(mod.identifier, mod.version, installDependencies, choices, optional);
    addInstallJob(accepted.job);
  } catch (error) {
    reportError(error, "Install could not be started.");
  } finally {
    setInstallPending(mod.identifier, false);
  }
}

async function findUpdateModule(update: AvailableUpdate): Promise<CkanModule> {
  const { versions } = await getModVersions(update.identifier);
  const module = versions.find((candidate) => candidate.version === update.availableVersion);
  if (module === undefined) {
    throw new Error(`${update.name} ${update.availableVersion} is no longer in the registry.`);
  }
  return module;
}

async function onUpdate(update: AvailableUpdate): Promise<void> {
  errorMessage.value = undefined;
  try {
    await onInstall(await findUpdateModule(update));
  } catch (error) {
    reportError(error, "Update could not be started.");
  }
}

/**
 * Queues every update that can run unattended. Updates that need a provider
 * choice or are blocked are skipped and listed, instead of stopping the run.
 */
async function onUpdateAll(): Promise<void> {
  isUpdatingAll.value = true;
  errorMessage.value = undefined;
  const skipped: string[] = [];
  try {
    for (const update of availableUpdates.value) {
      try {
        const mod = await findUpdateModule(update);
        const plan = await planModInstall(mod.identifier, mod.version);
        if (plan.status === "choice-required") {
          skipped.push(`${update.name} (needs a provider choice)`);
          continue;
        }
        if (plan.status === "blocked") {
          const details = [...plan.conflicts, ...plan.unmet].map((entry) => entry.message).join(" ");
          skipped.push(`${update.name} (${details.length > 0 ? details : "blocked"})`);
          continue;
        }
        const needsDependencies =
          mod.kind === "metapackage" || plan.toInstall.some((entry) => entry.identifier !== mod.identifier);
        await startInstallJob(mod, needsDependencies);
      } catch (error) {
        skipped.push(`${update.name} (${error instanceof Error ? error.message : "could not be planned"})`);
      }
    }
  } finally {
    isUpdatingAll.value = false;
  }
  if (skipped.length > 0) {
    errorMessage.value = `Some updates were skipped: ${skipped.join("; ")}`;
  }
}

async function onUninstall(mod: InstalledMod): Promise<void> {
  if (mod.status !== "managed") {
    return;
  }
  uninstallingIdentifier.value = mod.identifier;
  errorMessage.value = undefined;
  try {
    uninstallPrompt.value = { mod, plan: await planUninstall(mod.identifier) };
  } catch (error) {
    reportError(error, "Uninstall could not be planned.");
  } finally {
    uninstallingIdentifier.value = undefined;
  }
}

async function confirmUninstall(alsoRemove: string[]): Promise<void> {
  const prompt = uninstallPrompt.value;
  if (prompt === undefined) {
    return;
  }
  uninstallingIdentifier.value = prompt.mod.identifier;
  try {
    await uninstallMod(prompt.mod.identifier, alsoRemove);
    uninstallPrompt.value = undefined;
    await loadInstalledMods();
    await loadUpdates();
  } catch (error) {
    // Keep the dialog open with the reason. The server state moved (a
    // rejected selection) or some mods were already removed (a partial
    // failure), so refresh the inventory and the plan the user confirms.
    const message = error instanceof Error ? error.message : "Uninstall failed.";
    uninstallPrompt.value = { ...prompt, error: message };
    await refreshInstalledState();
    try {
      const plan = await planUninstall(prompt.mod.identifier);
      if (uninstallPrompt.value !== undefined) {
        uninstallPrompt.value = { ...prompt, plan, error: message };
      }
    } catch (planError) {
      const planMessage = planError instanceof Error ? planError.message : "The uninstall could not be planned again.";
      uninstallPrompt.value = { ...prompt, error: `${message} ${planMessage}` };
    }
  } finally {
    uninstallingIdentifier.value = undefined;
  }
}

function cancelUninstall(): void {
  uninstallPrompt.value = undefined;
}

let searchTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleSearch(): void {
  if (installation.value === undefined || registry.value?.status !== "ready") {
    return;
  }
  if (searchTimer !== undefined) {
    clearTimeout(searchTimer);
  }
  searchTimer = setTimeout(() => {
    currentPage.value = 0;
    void runSearch();
  }, 250);
}
watch(searchQuery, scheduleSearch);
watch([selectedTag, customTag, compatibleOnly], scheduleSearch);

onMounted(loadSetup);
</script>

<template>
  <SetupView
    v-if="installation === undefined"
    :status="status"
    :service-version="version"
    :error-message="errorMessage"
    :candidates="candidates"
    :directory-listing="directoryListing"
    :is-saving="isSaving"
    @select-installation="selectInstallation"
    @open-browser="openBrowser"
    @open-child="openChild"
    @reload="loadSetup"
  />

  <AppShell
    v-else
    :active-view="activeView"
    :service-version="version"
    :status="serviceStatus"
    :error-message="errorMessage"
    :install-jobs="installJobs"
    :installed-count="installedMods.length"
    :ksp-version="installation.version"
    :registry="registry"
    @navigate="activeView = $event"
    @dismiss-install="dismissInstall"
    @clear-finished-installs="clearFinishedInstalls"
  >
    <RecoveryNotice v-if="recoveryReport !== undefined" :report="recoveryReport" @dismiss="recoveryReport = undefined" />
    <DashboardView
      v-if="activeView === 'dashboard'"
      :installation="installation"
      :installed-count="installedMods.length"
      :updates="availableUpdates"
      :registry="registry"
      :is-refreshing-registry="isRefreshingRegistry"
      :installing-identifiers="installingIdentifiers"
      :is-updating-all="isUpdatingAll"
      @refresh-registry="onRefreshRegistry"
      @update="onUpdate"
      @update-all="onUpdateAll"
    />
    <InstalledModsView
      v-else-if="activeView === 'installed'"
      :installed-mods="installedMods"
      :available-updates="availableUpdates"
      :installing-identifiers="installingIdentifiers"
      :uninstalling-identifier="uninstallingIdentifier"
      @uninstall="onUninstall"
      @update="onUpdate"
      @import-modpack="onImportModpack"
    />
    <BrowseModsView
      v-else
      v-model:search-query="searchQuery"
      v-model:selected-tag="selectedTag"
      v-model:custom-tag="customTag"
      v-model:compatible-only="compatibleOnly"
      :registry="registry"
      :is-refreshing-registry="isRefreshingRegistry"
      :search-results="searchResults"
      :search-total="searchTotal"
      :is-searching="isSearching"
      :installed-mods="installedMods"
      :available-updates="availableUpdates"
      :installing-identifiers="installingIdentifiers"
      :uninstalling-identifier="uninstallingIdentifier"
      :dependency-prompt="dependencyPrompt"
      :ksp-version="installation.version"
      :page-size="pageSize"
      :current-page="currentPage"
      :selected-mod="selectedMod"
      :selected-mod-versions="selectedModVersions"
      :is-loading-versions="isLoadingVersions"
      @refresh-registry="onRefreshRegistry"
      @install="onInstall"
      @uninstall="onUninstall"
      @select-mod="onSelectMod"
      @select-version="onSelectModVersion"
      @update:page="onUpdateModPage"
      @reset-filters="resetModFilters"
      @confirm-dependency-install="confirmDependencyInstall"
      @continue-with-choices="continueWithChoices"
      @cancel-dependency-install="cancelDependencyInstall"
    />
    <UninstallDialog
      v-if="uninstallPrompt !== undefined"
      :plan="uninstallPrompt.plan"
      :error="uninstallPrompt.error"
      :busy="uninstallingIdentifier === uninstallPrompt.mod.identifier"
      @confirm="confirmUninstall"
      @cancel="cancelUninstall"
    />
  </AppShell>
</template>
