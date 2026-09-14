<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import type {
  AvailableUpdate,
  CkanModule,
  DirectoryListingResponse,
  InstallPlanResponse,
  InstalledMod,
  JobProgressEvent,
  KspInstallation,
  RegistryResponse,
} from "@kraken/contracts";
import {
  getConfig,
  getDirectories,
  getHealth,
  getInstallations,
  getInstalledMods,
  getRegistry,
  getUpdates,
  installMod,
  planModInstall,
  refreshRegistry,
  saveInstallation,
  searchMods,
  uninstallMod,
  watchJobProgress,
} from "./api.js";
import AppShell from "./components/AppShell.vue";
import BrowseModsView from "./components/BrowseModsView.vue";
import DashboardView from "./components/DashboardView.vue";
import SetupView from "./components/SetupView.vue";
import { MOD_BROWSER_PAGE_SIZE } from "./modTags.js";

type AppView = "dashboard" | "browse";

const status = ref<"checking" | "ready" | "unavailable" | "error">("checking");
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
const availableUpdates = ref<AvailableUpdate[]>([]);
const installingIdentifier = ref<string>();
const uninstallingIdentifier = ref<string>();
const jobProgress = ref<JobProgressEvent>();
const dependencyPrompt = ref<{ mod: CkanModule; plan: InstallPlanResponse }>();
let stopWatchingJob: (() => void) | undefined;

const effectiveTag = computed(() => {
  // A typed custom tag takes precedence over the selected preset.
  const custom = customTag.value.trim();
  if (custom.length > 0) {
    return custom;
  }
  const selected = selectedTag.value.trim();
  return selected.length > 0 ? selected : undefined;
});

async function loadSetup(): Promise<void> {
  status.value = "checking";
  errorMessage.value = undefined;

  try {
    const health = await getHealth();
    version.value = health.version;
    const config = await getConfig();
    if (config.configured) {
      installation.value = config.installation;
      candidates.value = [];
      activeView.value = "dashboard";
      await loadConfiguredState(config.installation);
    } else {
      installation.value = undefined;
      candidates.value = (await getInstallations()).installations;
      registry.value = undefined;
      searchResults.value = [];
      searchTotal.value = 0;
      installedMods.value = [];
      availableUpdates.value = [];
    }
    status.value = "ready";
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "The local service is unavailable.";
    status.value = "unavailable";
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
    errorMessage.value = error instanceof Error ? error.message : "The installation could not be saved.";
    status.value = "error";
  } finally {
    isSaving.value = false;
  }
}

async function openBrowser(path?: string): Promise<void> {
  errorMessage.value = undefined;
  try {
    directoryListing.value = await getDirectories(path);
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "The directory browser could not be opened.";
    status.value = "error";
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
    errorMessage.value = error instanceof Error ? error.message : "The registry could not be refreshed.";
    status.value = "error";
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
    errorMessage.value = error instanceof Error ? error.message : "Mod search failed.";
    status.value = "error";
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

async function onInstall(mod: CkanModule): Promise<void> {
  if (mod.download === undefined) {
    return;
  }
  installingIdentifier.value = mod.identifier;
  errorMessage.value = undefined;
  jobProgress.value = undefined;
  dependencyPrompt.value = undefined;
  stopWatchingJob?.();
  try {
    const plan = await planModInstall(mod.identifier, mod.version);
    if (plan.status === "blocked") {
      const details = [
        ...plan.conflicts.map((entry) => entry.message),
        ...plan.unmet.map((entry) => entry.message),
      ].join(" ");
      errorMessage.value = details.length > 0 ? details : "Install plan is blocked by dependencies or conflicts.";
      status.value = "error";
      installingIdentifier.value = undefined;
      return;
    }

    const missing = plan.toInstall.filter((entry) => entry.identifier !== mod.identifier);
    if (missing.length > 0) {
      installingIdentifier.value = undefined;
      dependencyPrompt.value = { mod, plan };
      return;
    }

    await startInstallJob(mod, false);
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "Install could not be planned.";
    status.value = "error";
    installingIdentifier.value = undefined;
  }
}

async function confirmDependencyInstall(): Promise<void> {
  const prompt = dependencyPrompt.value;
  if (prompt === undefined) {
    return;
  }
  dependencyPrompt.value = undefined;
  await startInstallJob(prompt.mod, true);
}

function cancelDependencyInstall(): void {
  dependencyPrompt.value = undefined;
  installingIdentifier.value = undefined;
}

async function startInstallJob(mod: CkanModule, installDependencies: boolean): Promise<void> {
  installingIdentifier.value = mod.identifier;
  errorMessage.value = undefined;
  jobProgress.value = undefined;
  stopWatchingJob?.();
  try {
    const accepted = await installMod(mod.identifier, mod.version, installDependencies);
    stopWatchingJob = watchJobProgress(accepted.job.jobId, (event) => {
      jobProgress.value = event;
      if (event.status === "succeeded") {
        void loadInstalledMods();
        void loadUpdates();
        installingIdentifier.value = undefined;
      }
      if (event.status === "failed") {
        errorMessage.value = event.error ?? "Install failed.";
        status.value = "error";
        installingIdentifier.value = undefined;
      }
    });
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "Install could not be started.";
    status.value = "error";
    installingIdentifier.value = undefined;
  }
}

async function onUninstall(mod: InstalledMod): Promise<void> {
  if (mod.status !== "managed") {
    return;
  }
  uninstallingIdentifier.value = mod.identifier;
  errorMessage.value = undefined;
  try {
    await uninstallMod(mod.identifier);
    await loadInstalledMods();
    await loadUpdates();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "Uninstall failed.";
    status.value = "error";
  } finally {
    uninstallingIdentifier.value = undefined;
  }
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
onUnmounted(() => {
  stopWatchingJob?.();
});
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
    :status="status"
    :error-message="errorMessage"
    @navigate="activeView = $event"
  >
    <DashboardView
      v-if="activeView === 'dashboard'"
      :installation="installation"
      :installed-count="installedMods.length"
      :updates="availableUpdates"
      :registry="registry"
      :is-refreshing-registry="isRefreshingRegistry"
      @refresh-registry="onRefreshRegistry"
      @browse-mods="activeView = 'browse'"
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
      :installing-identifier="installingIdentifier"
      :uninstalling-identifier="uninstallingIdentifier"
      :job-progress="jobProgress"
      :dependency-prompt="dependencyPrompt"
      :ksp-version="installation.version"
      :page-size="pageSize"
      :current-page="currentPage"
      @refresh-registry="onRefreshRegistry"
      @install="onInstall"
      @uninstall="onUninstall"
      @update:page="onUpdateModPage"
      @reset-filters="resetModFilters"
      @confirm-dependency-install="confirmDependencyInstall"
      @cancel-dependency-install="cancelDependencyInstall"
    />
  </AppShell>
</template>
