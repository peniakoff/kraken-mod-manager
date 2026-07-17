<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from "vue";
import type {
  CkanModule,
  DirectoryListingResponse,
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
  installMod,
  refreshRegistry,
  saveInstallation,
  searchMods,
  uninstallMod,
  watchJobProgress,
} from "./api.js";

const status = ref<"checking" | "ready" | "unavailable" | "error">("checking");
const version = ref<string>();
const installation = ref<KspInstallation>();
const candidates = ref<KspInstallation[]>([]);
const errorMessage = ref<string>();
const directoryListing = ref<DirectoryListingResponse>();
const isSaving = ref(false);

const registry = ref<RegistryResponse>();
const isRefreshingRegistry = ref(false);
const searchQuery = ref("");
const searchResults = ref<CkanModule[]>([]);
const searchTotal = ref(0);
const isSearching = ref(false);

const installedMods = ref<InstalledMod[]>([]);
const installingIdentifier = ref<string>();
const uninstallingIdentifier = ref<string>();
const jobProgress = ref<JobProgressEvent>();
let stopWatchingJob: (() => void) | undefined;

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
      await loadRegistryPanel(config.installation);
    } else {
      installation.value = undefined;
      candidates.value = (await getInstallations()).installations;
      registry.value = undefined;
      searchResults.value = [];
      searchTotal.value = 0;
      installedMods.value = [];
    }
    status.value = "ready";
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "The local service is unavailable.";
    status.value = "unavailable";
  }
}

async function loadRegistryPanel(active: KspInstallation): Promise<void> {
  registry.value = await getRegistry();
  await loadInstalledMods();
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

async function selectInstallation(path: string): Promise<void> {
  isSaving.value = true;
  errorMessage.value = undefined;
  try {
    const config = await saveInstallation(path);
    if (config.configured) {
      installation.value = config.installation;
      candidates.value = [];
      directoryListing.value = undefined;
      await loadRegistryPanel(config.installation);
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
  try {
    registry.value = await refreshRegistry();
    await runSearch(installation.value);
    await loadInstalledMods();
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
      compatibleWith: target.version,
      limit: 50,
      offset: 0,
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

async function onInstall(mod: CkanModule): Promise<void> {
  if (mod.download === undefined) {
    return;
  }
  installingIdentifier.value = mod.identifier;
  errorMessage.value = undefined;
  jobProgress.value = undefined;
  stopWatchingJob?.();
  try {
    const accepted = await installMod(mod.identifier, mod.version);
    stopWatchingJob = watchJobProgress(accepted.job.jobId, (event) => {
      jobProgress.value = event;
      if (event.status === "succeeded") {
        void loadInstalledMods();
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
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "Uninstall failed.";
    status.value = "error";
  } finally {
    uninstallingIdentifier.value = undefined;
  }
}

function progressLabel(event: JobProgressEvent | undefined): string {
  if (event === undefined) {
    return "";
  }
  if (event.phase === "downloading" && event.bytesReceived !== undefined) {
    const total = event.bytesTotal;
    if (total !== undefined && total > 0) {
      return `Downloading… ${Math.min(100, Math.round((event.bytesReceived / total) * 100))}%`;
    }
    return `Downloading… ${event.bytesReceived} bytes`;
  }
  return event.message ?? event.phase;
}

let searchTimer: ReturnType<typeof setTimeout> | undefined;
watch(searchQuery, () => {
  if (installation.value === undefined || registry.value?.status !== "ready") {
    return;
  }
  if (searchTimer !== undefined) {
    clearTimeout(searchTimer);
  }
  searchTimer = setTimeout(() => {
    void runSearch();
  }, 250);
});

onMounted(loadSetup);
onUnmounted(() => {
  stopWatchingJob?.();
});
</script>

<template>
  <main class="min-h-screen bg-slate-950 p-8 text-slate-100">
    <section class="mx-auto max-w-2xl rounded-xl border border-slate-700 bg-slate-900 p-8 shadow-xl">
      <p class="text-sm font-semibold uppercase tracking-widest text-cyan-400">Kraken Mod Manager</p>
      <h1 class="mt-3 text-3xl font-bold">Choose your Kerbal Space Program installation.</h1>
      <p class="mt-4 text-slate-300">
        Kraken needs one validated KSP installation before it can manage mods.
      </p>
      <div class="mt-6 flex items-center gap-3" aria-live="polite">
        <span
          class="h-3 w-3 rounded-full"
          :class="{
            'bg-amber-400': status === 'checking',
            'bg-emerald-400': status === 'ready',
            'bg-rose-400': status === 'unavailable' || status === 'error',
          }"
        />
        <span v-if="status === 'checking'">Checking local service…</span>
        <span v-else-if="status === 'ready'">Service connected ({{ version }})</span>
        <span v-else>{{ errorMessage ?? "Local service is unavailable." }}</span>
      </div>

      <section v-if="installation !== undefined" class="mt-8 rounded-lg border border-emerald-800 bg-emerald-950/30 p-5">
        <h2 class="font-semibold text-emerald-300">Active installation</h2>
        <p class="mt-2 break-all font-mono text-sm">{{ installation.path }}</p>
        <p class="mt-2 text-sm text-slate-300">KSP version: {{ installation.version ?? "Unknown" }}</p>
      </section>

      <section v-if="installation !== undefined" class="mt-8 rounded-lg border border-slate-700 p-5">
        <h2 class="font-semibold">Installed mods</h2>
        <p v-if="installedMods.length === 0" class="mt-2 text-slate-300">No managed or detected mods yet.</p>
        <ul v-else class="mt-3 space-y-3">
          <li v-for="mod in installedMods" :key="mod.identifier" class="rounded-lg border border-slate-700 p-3">
            <p class="font-semibold">
              {{ mod.name ?? mod.identifier }}
              <span v-if="mod.version" class="font-mono text-sm text-slate-400">{{ mod.version }}</span>
            </p>
            <p class="mt-1 text-sm text-slate-400">{{ mod.identifier }} · {{ mod.status }}</p>
            <button
              v-if="mod.status === 'managed'"
              class="mt-3 rounded-md border border-rose-400 px-3 py-1 text-sm font-semibold text-rose-300 hover:bg-rose-400/10 disabled:opacity-60"
              type="button"
              :disabled="uninstallingIdentifier === mod.identifier"
              @click="onUninstall(mod)"
            >
              {{ uninstallingIdentifier === mod.identifier ? "Uninstalling…" : "Uninstall" }}
            </button>
          </li>
        </ul>
        <p v-if="jobProgress !== undefined" class="mt-4 text-sm text-cyan-300" aria-live="polite">
          {{ progressLabel(jobProgress) }}
        </p>
      </section>

      <section v-if="installation !== undefined && registry !== undefined" class="mt-8 rounded-lg border border-slate-700 p-5">
        <h2 class="font-semibold">CKAN registry</h2>
        <p v-if="registry.status === 'missing'" class="mt-2 text-slate-300">
          No local metadata cache yet. Refresh to download the official CKAN-meta archive.
        </p>
        <p v-else class="mt-2 text-slate-300">
          {{ registry.moduleCount }} modules indexed
          <span v-if="registry.updatedAt"> · updated {{ registry.updatedAt }}</span>
          <span v-if="registry.parseErrors"> · {{ registry.parseErrors }} parse errors</span>
        </p>
        <button
          class="mt-4 rounded-md bg-cyan-500 px-3 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-60"
          type="button"
          :disabled="isRefreshingRegistry"
          @click="onRefreshRegistry"
        >
          {{ isRefreshingRegistry ? "Refreshing…" : "Refresh registry" }}
        </button>

        <div v-if="registry.status === 'ready'" class="mt-6">
          <label class="block text-sm font-medium text-slate-300" for="mod-search">Search mods</label>
          <input
            id="mod-search"
            v-model="searchQuery"
            class="mt-2 w-full rounded-md border border-slate-600 bg-slate-950 px-3 py-2 text-sm"
            type="search"
            placeholder="Name, author, or tag"
          />
          <p class="mt-2 text-sm text-slate-400">
            <span v-if="isSearching">Searching…</span>
            <span v-else>{{ searchTotal }} result{{ searchTotal === 1 ? "" : "s" }}</span>
          </p>
          <ul class="mt-3 max-h-80 space-y-3 overflow-y-auto">
            <li v-for="mod in searchResults" :key="`${mod.identifier}@${mod.version}`" class="rounded-lg border border-slate-700 p-3">
              <p class="font-semibold">{{ mod.name }} <span class="font-mono text-sm text-slate-400">{{ mod.version }}</span></p>
              <p class="mt-1 text-sm text-slate-400">{{ mod.identifier }} · {{ mod.authors.join(", ") || "Unknown author" }}</p>
              <p v-if="mod.abstract" class="mt-2 line-clamp-2 text-sm text-slate-300">{{ mod.abstract }}</p>
              <button
                v-if="mod.download !== undefined"
                class="mt-3 rounded-md bg-cyan-500 px-3 py-1 text-sm font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-60"
                type="button"
                :disabled="installingIdentifier === mod.identifier"
                @click="onInstall(mod)"
              >
                {{ installingIdentifier === mod.identifier ? "Installing…" : "Install" }}
              </button>
            </li>
          </ul>
        </div>
      </section>

      <section v-else-if="installation === undefined && status === 'ready'" class="mt-8">
        <h2 class="font-semibold">Detected installations</h2>
        <p v-if="candidates.length === 0" class="mt-2 text-slate-300">No supported installation was found automatically.</p>
        <ul v-else class="mt-3 space-y-3">
          <li v-for="candidate in candidates" :key="candidate.path" class="rounded-lg border border-slate-700 p-4">
            <p class="break-all font-mono text-sm">{{ candidate.path }}</p>
            <p class="mt-1 text-sm text-slate-300">{{ candidate.source }} · {{ candidate.version ?? "Unknown version" }}</p>
            <button class="mt-3 rounded-md bg-cyan-500 px-3 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400" type="button" :disabled="isSaving" @click="selectInstallation(candidate.path)">
              Use this installation
            </button>
          </li>
        </ul>
        <button class="mt-6 rounded-md border border-cyan-400 px-4 py-2 font-semibold text-cyan-300 hover:bg-cyan-400/10" type="button" @click="openBrowser()">
          Browse folders manually
        </button>
      </section>

      <section v-if="directoryListing !== undefined && installation === undefined" class="mt-8 rounded-lg border border-slate-700 p-5">
        <h2 class="font-semibold">Select a KSP folder</h2>
        <p class="mt-2 break-all font-mono text-sm text-slate-300">{{ directoryListing.currentPath }}</p>
        <div class="mt-4 flex flex-wrap gap-2">
          <button v-if="directoryListing.parentPath !== null" class="rounded border border-slate-600 px-3 py-1 text-sm" type="button" @click="openBrowser(directoryListing.parentPath)">Up</button>
          <button class="rounded bg-cyan-500 px-3 py-1 text-sm font-semibold text-slate-950" type="button" :disabled="isSaving" @click="selectInstallation(directoryListing.currentPath)">Use this folder</button>
        </div>
        <ul class="mt-4 max-h-64 overflow-y-auto rounded border border-slate-800">
          <li v-for="directory in directoryListing.directories" :key="directory">
            <button class="block w-full px-3 py-2 text-left font-mono text-sm hover:bg-slate-800" type="button" @click="openChild(directory)">{{ directory }}/</button>
          </li>
        </ul>
      </section>

      <button class="mt-6 rounded-md bg-cyan-500 px-4 py-2 font-semibold text-slate-950 hover:bg-cyan-400" type="button" @click="loadSetup">
        Check again
      </button>
    </section>
  </main>
</template>
