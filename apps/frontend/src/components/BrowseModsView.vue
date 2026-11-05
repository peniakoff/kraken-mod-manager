<script setup lang="ts">
import { computed } from "vue";
import type {
  AvailableUpdate,
  CkanModule,
  InstalledMod,
  RegistryResponse,
} from "@kraken/contracts";
import ModFilterBar from "./ModFilterBar.vue";
import ModPagination from "./ModPagination.vue";
import ModTable from "./ModTable.vue";
import ModDetailsPanel from "./ModDetailsPanel.vue";
import DependencyPromptDialog, { type DependencyPrompt } from "./DependencyPromptDialog.vue";
import AppIcon from "./AppIcon.vue";
import ViewHeader from "./ViewHeader.vue";
import { formatCount, formatRelativeTime } from "../format.js";

const props = defineProps<{
  registry?: RegistryResponse;
  isRefreshingRegistry: boolean;
  searchQuery: string;
  searchResults: CkanModule[];
  searchTotal: number;
  isSearching: boolean;
  installedMods: InstalledMod[];
  availableUpdates: AvailableUpdate[];
  installingIdentifiers: string[];
  uninstallingIdentifier?: string;
  dependencyPrompt?: DependencyPrompt;
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
  continueWithChoices: [choices: Record<string, string>];
  selectMod: [mod: CkanModule | undefined];
  selectVersion: [mod: CkanModule];
}>();

const offset = computed(() => props.currentPage * props.pageSize);

const registryUpdated = computed(() =>
  props.registry?.updatedAt === undefined ? undefined : formatRelativeTime(props.registry.updatedAt),
);
</script>

<template>
  <div>
    <ViewHeader title="Browse mods">
      <template v-if="registry?.status === 'ready'">
        Search the CKAN registry: <span class="readout">{{ formatCount(registry.moduleCount) }}</span> modules indexed<span
          v-if="registryUpdated"
          :title="registry.updatedAt"
        >, updated {{ registryUpdated }}</span>.
      </template>
      <template v-else>Search the CKAN registry and install mods with their dependencies.</template>
      <template #actions>
        <button
          :class="['btn', registry?.status === 'missing' ? 'btn-primary' : 'btn-secondary']"
          type="button"
          :disabled="isRefreshingRegistry"
          @click="emit('refreshRegistry')"
        >
          <AppIcon name="refresh" :class="isRefreshingRegistry ? 'animate-spin' : ''" />
          {{ isRefreshingRegistry ? "Refreshing…" : "Refresh registry" }}
        </button>
      </template>
    </ViewHeader>

    <section v-if="registry?.status === 'missing'" class="panel px-5 py-8">
      <h2 class="panel-title">CKAN registry</h2>
      <p class="mt-2 text-muted">No local metadata cache yet. Refresh to download the official CKAN-meta archive.</p>
    </section>

    <template v-if="registry?.status === 'ready'">
      <section class="panel p-5" aria-label="Search and filters">
        <label class="sr-only" for="mod-search">Search mods</label>
        <div class="relative">
          <AppIcon
            name="search"
            :size="18"
            class="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted"
          />
          <input
            id="mod-search"
            class="field h-12 pl-11 text-[15px]"
            type="search"
            placeholder="Search by name, author or tag"
            :value="searchQuery"
            @input="emit('update:searchQuery', ($event.target as HTMLInputElement).value)"
          />
        </div>
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
      </section>

      <section class="panel mt-6" aria-labelledby="results-title">
        <div class="panel-header">
          <h2 id="results-title" class="panel-title">Results</h2>
          <p class="readout text-[13px] text-muted" aria-live="polite">
            <span v-if="isSearching">Searching…</span>
            <span v-else>{{ formatCount(searchTotal) }} result{{ searchTotal === 1 ? "" : "s" }}</span>
          </p>
        </div>
        <ModTable
          :mods="searchResults"
          :ksp-version="kspVersion"
          :compatible-only="compatibleOnly"
          :installed-mods="installedMods"
          :available-updates="availableUpdates"
          :installing-identifiers="installingIdentifiers"
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
      </section>
    </template>

    <DependencyPromptDialog
      v-if="dependencyPrompt !== undefined"
      :prompt="dependencyPrompt"
      @confirm="emit('confirmDependencyInstall')"
      @cancel="emit('cancelDependencyInstall')"
      @continue-with-choices="emit('continueWithChoices', $event)"
    />

    <ModDetailsPanel
      v-if="selectedMod !== undefined"
      :mod="selectedMod"
      :versions="selectedModVersions ?? [selectedMod]"
      :ksp-version="kspVersion"
      :installed-mods="installedMods"
      :available-updates="availableUpdates"
      :installing-identifiers="installingIdentifiers"
      :uninstalling-identifier="uninstallingIdentifier"
      :is-loading-versions="isLoadingVersions"
      @close="emit('selectMod', undefined)"
      @install="emit('install', $event)"
      @uninstall="emit('uninstall', $event)"
      @select-version="emit('selectVersion', $event)"
    />
  </div>
</template>
