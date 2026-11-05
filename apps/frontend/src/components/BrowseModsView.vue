<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type {
  AvailableUpdate,
  CkanModule,
  InstallPlanResponse,
  InstalledMod,
  RegistryResponse,
} from "@kraken/contracts";
import ModFilterBar from "./ModFilterBar.vue";
import ModPagination from "./ModPagination.vue";
import ModTable from "./ModTable.vue";
import ModDetailsPanel from "./ModDetailsPanel.vue";
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
  dependencyPrompt?: { mod: CkanModule; plan: InstallPlanResponse; choices: Record<string, string> };
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

const missingDependencies = computed(() => {
  const prompt = props.dependencyPrompt;
  if (prompt === undefined) {
    return [];
  }
  return prompt.plan.toInstall.filter((entry) => entry.identifier !== prompt.mod.identifier);
});

const pendingChoices = computed(() => {
  const prompt = props.dependencyPrompt;
  return prompt !== undefined && prompt.plan.status === "choice-required" ? prompt.plan.choices : [];
});

const selectedChoices = ref<Record<string, string>>({});
watch(
  () => props.dependencyPrompt,
  () => {
    selectedChoices.value = {};
  },
);

const allChoicesSelected = computed(() =>
  pendingChoices.value.every((choice) => selectedChoices.value[choice.key] !== undefined),
);

function requiredByLabel(identifiers: string[]): string {
  const plan = props.dependencyPrompt?.plan;
  const names = new Map([plan?.target, ...(plan?.toInstall ?? [])].flatMap((ref) => (ref ? [[ref.identifier, ref.name]] : [])));
  return identifiers.map((identifier) => names.get(identifier) ?? identifier).join(", ");
}

function choiceInputId(key: string, identifier: string): string {
  return `choice-${encodeURIComponent(key)}-${encodeURIComponent(identifier)}`;
}

function continueWithChoices(): void {
  const prompt = props.dependencyPrompt;
  if (prompt === undefined || !allChoicesSelected.value) {
    return;
  }
  emit("continueWithChoices", { ...prompt.choices, ...selectedChoices.value });
}

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

    <div
      v-if="dependencyPrompt !== undefined"
      class="dialog-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="dependency-prompt-title"
    >
      <div v-if="pendingChoices.length > 0" class="dialog">
        <h2 id="dependency-prompt-title" class="text-xl font-semibold">Choose a provider</h2>
        <p class="mt-2 text-muted">
          {{ dependencyPrompt.mod.name }} needs one of several mods. Pick the one to install.
        </p>
        <div class="mt-5 max-h-[60vh] space-y-4 overflow-y-auto pr-1">
          <fieldset v-for="choice in pendingChoices" :key="choice.key" class="rounded-md border border-line p-4">
            <legend class="px-1 text-sm font-medium">{{ choice.label }}, required by {{ requiredByLabel(choice.requiredBy) }}</legend>
            <div class="mt-1 space-y-1">
              <div
                v-for="candidate in choice.candidates"
                :key="candidate.identifier"
                class="flex items-center gap-3 rounded-sm px-1 py-1.5 hover:bg-raised"
              >
                <input
                  :id="choiceInputId(choice.key, candidate.identifier)"
                  v-model="selectedChoices[choice.key]"
                  type="radio"
                  class="h-4 w-4 accent-accent"
                  :name="`choice-${choice.key}`"
                  :value="candidate.identifier"
                />
                <label :for="choiceInputId(choice.key, candidate.identifier)" class="text-sm">
                  {{ candidate.name }}
                  <span class="readout text-muted">{{ candidate.version }}</span>
                  <span v-if="candidate.via === 'provides'" class="ml-1 text-[13px] text-muted">provides {{ choice.label }}</span>
                </label>
              </div>
            </div>
          </fieldset>
        </div>
        <div class="mt-6 flex flex-wrap gap-3">
          <button class="btn btn-primary" type="button" :disabled="!allChoicesSelected" @click="continueWithChoices">
            Continue
          </button>
          <button class="btn btn-secondary" type="button" @click="emit('cancelDependencyInstall')">Cancel</button>
        </div>
      </div>
      <div v-else class="dialog">
        <h2 id="dependency-prompt-title" class="text-xl font-semibold">Install required dependencies?</h2>
        <p class="mt-2 text-muted">
          {{ dependencyPrompt.mod.name }} requires
          {{ missingDependencies.map((entry) => entry.name).join(", ") }}. Install them automatically?
        </p>
        <ul class="mt-4 divide-y divide-line rounded-md border border-line text-sm">
          <li v-for="entry in missingDependencies" :key="entry.identifier" class="flex justify-between gap-3 px-3 py-2">
            <span>{{ entry.name }}</span>
            <span class="readout text-muted">{{ entry.version }}</span>
          </li>
        </ul>
        <div class="mt-6 flex flex-wrap gap-3">
          <button class="btn btn-primary" type="button" @click="emit('confirmDependencyInstall')">
            Install automatically
          </button>
          <button class="btn btn-secondary" type="button" @click="emit('cancelDependencyInstall')">Cancel</button>
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
