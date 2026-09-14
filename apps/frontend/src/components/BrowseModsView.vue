<script setup lang="ts">
import { computed } from "vue";
import type {
  AvailableUpdate,
  CkanModule,
  InstallPlanResponse,
  InstalledMod,
  JobProgressEvent,
  RegistryResponse,
} from "@kraken/contracts";
import ModFilterBar from "./ModFilterBar.vue";
import ModPagination from "./ModPagination.vue";
import ModTable from "./ModTable.vue";
import ModDetailsPanel from "./ModDetailsPanel.vue";

const props = defineProps<{
  registry?: RegistryResponse;
  isRefreshingRegistry: boolean;
  searchQuery: string;
  searchResults: CkanModule[];
  searchTotal: number;
  isSearching: boolean;
  installedMods: InstalledMod[];
  availableUpdates: AvailableUpdate[];
  installingIdentifier?: string;
  uninstallingIdentifier?: string;
  jobProgress?: JobProgressEvent;
  dependencyPrompt?: { mod: CkanModule; plan: InstallPlanResponse };
  selectedTag: string;
  customTag: string;
  compatibleOnly: boolean;
  kspVersion?: string;
  pageSize: number;
  currentPage: number;
  selectedMod?: CkanModule;
  selectedModVersions?: CkanModule[];
  isLoadingVersions?: boolean;
}>();

const emit = defineEmits<{
  "update:searchQuery": [value: string];
  "update:selectedTag": [value: string];
  "update:customTag": [value: string];
  "update:compatibleOnly": [value: boolean];
  "update:page": [page: number];
  resetFilters: [];
  refreshRegistry: [];
  install: [mod: CkanModule];
  uninstall: [mod: InstalledMod];
  confirmDependencyInstall: [];
  cancelDependencyInstall: [];
  selectMod: [mod: CkanModule | undefined];
  selectVersion: [mod: CkanModule];
}>();

const missingDependencies = computed(() => {
  const prompt = props.dependencyPrompt;
  if (prompt === undefined) {
    return [];
  }
  return prompt.plan.toInstall.filter((entry) => entry.identifier !== prompt.mod.identifier);
});

const offset = computed(() => props.currentPage * props.pageSize);

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
</script>

<template>
  <div class="space-y-6">
    <div>
      <h1 class="text-3xl font-bold">Browse mods</h1>
      <p class="mt-2 text-slate-300">Search the CKAN registry and manage installed mods.</p>
    </div>

    <section class="rounded-xl border border-slate-700 bg-slate-900/60 p-5">
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
            @click="emit('uninstall', mod)"
          >
            {{ uninstallingIdentifier === mod.identifier ? "Uninstalling…" : "Uninstall" }}
          </button>
        </li>
      </ul>
      <p v-if="jobProgress !== undefined" class="mt-4 text-sm text-cyan-300" aria-live="polite">
        {{ progressLabel(jobProgress) }}
      </p>
    </section>

    <section v-if="registry !== undefined" class="rounded-xl border border-slate-700 bg-slate-900/60 p-5">
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
        @click="emit('refreshRegistry')"
      >
        {{ isRefreshingRegistry ? "Refreshing…" : "Refresh registry" }}
      </button>

      <div v-if="registry.status === 'ready'" class="mt-6">
        <label class="block text-sm font-medium text-slate-300" for="mod-search">Search mods</label>
        <input
          id="mod-search"
          class="mt-2 w-full rounded-md border border-slate-600 bg-slate-950 px-3 py-2 text-sm"
          type="search"
          placeholder="Name, author, or tag"
          :value="searchQuery"
          @input="emit('update:searchQuery', ($event.target as HTMLInputElement).value)"
        />
        <ModFilterBar
          :selected-tag="selectedTag"
          :custom-tag="customTag"
          :compatible-only="compatibleOnly"
          :ksp-version="kspVersion"
          :disabled="isSearching || isRefreshingRegistry"
          @update:selected-tag="emit('update:selectedTag', $event)"
          @update:custom-tag="emit('update:customTag', $event)"
          @update:compatible-only="emit('update:compatibleOnly', $event)"
          @reset-filters="emit('resetFilters')"
        />
        <p class="mt-2 text-sm text-slate-400">
          <span v-if="isSearching">Searching…</span>
          <span v-else>{{ searchTotal }} result{{ searchTotal === 1 ? "" : "s" }}</span>
        </p>
        <ModTable
          :mods="searchResults"
          :ksp-version="kspVersion"
          :compatible-only="compatibleOnly"
          :installed-mods="installedMods"
          :available-updates="availableUpdates"
          :installing-identifier="installingIdentifier"
          @install="emit('install', $event)"
          @select="emit('selectMod', $event)"
        />
        <ModPagination
          :total="searchTotal"
          :limit="pageSize"
          :offset="offset"
          :disabled="isSearching || isRefreshingRegistry"
          @update:page="emit('update:page', $event)"
        />
      </div>
    </section>

    <div
      v-if="dependencyPrompt !== undefined"
      class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="dependency-prompt-title"
    >
      <div class="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
        <h2 id="dependency-prompt-title" class="text-xl font-semibold">Install required dependencies?</h2>
        <p class="mt-3 text-slate-300">
          {{ dependencyPrompt.mod.name }} requires
          {{ missingDependencies.map((entry) => entry.name).join(", ") }}. Install them automatically?
        </p>
        <ul class="mt-4 space-y-2 text-sm text-slate-400">
          <li v-for="entry in missingDependencies" :key="entry.identifier">
            {{ entry.name }}
            <span class="font-mono">{{ entry.version }}</span>
          </li>
        </ul>
        <div class="mt-6 flex flex-wrap gap-3">
          <button
            class="rounded-md bg-cyan-500 px-4 py-2 font-semibold text-slate-950 hover:bg-cyan-400"
            type="button"
            @click="emit('confirmDependencyInstall')"
          >
            Install automatically
          </button>
          <button
            class="rounded-md border border-slate-600 px-4 py-2 font-semibold text-slate-200 hover:bg-slate-800"
            type="button"
            @click="emit('cancelDependencyInstall')"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>

    <ModDetailsPanel
      v-if="selectedMod !== undefined"
      :mod="selectedMod"
      :versions="selectedModVersions ?? [selectedMod]"
      :ksp-version="kspVersion"
      :installed-mods="installedMods"
      :available-updates="availableUpdates"
      :installing-identifier="installingIdentifier"
      :uninstalling-identifier="uninstallingIdentifier"
      :is-loading-versions="isLoadingVersions"
      @close="emit('selectMod', undefined)"
      @install="emit('install', $event)"
      @uninstall="emit('uninstall', $event)"
      @select-version="emit('selectVersion', $event)"
    />
  </div>
</template>
