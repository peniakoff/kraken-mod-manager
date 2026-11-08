<script setup lang="ts">
import { computed, ref } from "vue";
import type { AvailableUpdate, InstalledMod } from "@kraken/contracts";
import AppIcon from "./AppIcon.vue";
import ViewHeader from "./ViewHeader.vue";
import { moduleIdentifierKey, type BusyState } from "../useJobQueue.js";

const props = withDefaults(
  defineProps<{
    installedMods: InstalledMod[];
    availableUpdates: AvailableUpdate[];
    busy?: Map<string, BusyState>;
  }>(),
  { busy: () => new Map() },
);

const emit = defineEmits<{
  uninstall: [mod: InstalledMod];
  update: [update: AvailableUpdate];
  importModpack: [file: File];
}>();

const importButton = ref<HTMLButtonElement>();
const modpackInput = ref<HTMLInputElement>();

function openModpackPicker(): void {
  modpackInput.value?.click();
}

function onModpackPicked(): void {
  const input = modpackInput.value;
  const file = input?.files?.[0];
  if (input !== undefined) {
    // Reset so picking the same file again still fires a change event.
    input.value = "";
  }
  importButton.value?.focus();
  if (file !== undefined) {
    emit("importModpack", file);
  }
}

function onModpackPickerCancelled(): void {
  importButton.value?.focus();
}

const filter = ref("");

const updatesById = computed(() => new Map(props.availableUpdates.map((update) => [update.identifier, update])));

const visibleMods = computed(() => {
  const query = filter.value.trim().toLowerCase();
  if (query.length === 0) {
    return props.installedMods;
  }
  return props.installedMods.filter(
    (mod) => mod.identifier.toLowerCase().includes(query) || (mod.name ?? "").toLowerCase().includes(query),
  );
});

const visibleRows = computed(() =>
  visibleMods.value.map((mod) => ({ mod, update: updatesById.value.get(mod.identifier) })),
);

const managedCount = computed(() => props.installedMods.filter((mod) => mod.status === "managed").length);

function busyState(identifier: string): BusyState | undefined {
  return props.busy.get(moduleIdentifierKey(identifier));
}

function updateLabel(identifier: string): string {
  const state = busyState(identifier);
  return state === "queued" ? "Queued" : state === "installing" ? "Updating…" : state === "uninstalling" ? "Uninstalling…" : "Update";
}

function uninstallLabel(identifier: string): string {
  const state = busyState(identifier);
  return state === "queued" ? "Queued" : state === "installing" ? "Installing…" : state === "uninstalling" ? "Uninstalling…" : "Uninstall";
}
</script>

<template>
  <div>
    <ViewHeader title="Installed">
      <span class="readout">{{ installedMods.length }}</span> {{ installedMods.length === 1 ? "mod" : "mods" }} in this
      installation ·
      <span class="readout">{{ managedCount }}</span> managed by Kraken
      <template #actions>
        <button ref="importButton" class="btn btn-secondary" type="button" @click="openModpackPicker">
          <AppIcon name="download" />
          Import modpack
        </button>
        <input
          ref="modpackInput"
          class="sr-only"
          type="file"
          tabindex="-1"
          accept=".ckan,application/json"
          aria-hidden="true"
          @change="onModpackPicked"
          @cancel="onModpackPickerCancelled"
        />
      </template>
    </ViewHeader>

    <section class="panel" aria-label="Installed mods">
      <div class="panel-header">
        <div class="relative w-full max-w-sm">
          <label class="sr-only" for="installed-filter">Filter installed mods</label>
          <AppIcon name="search" class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            id="installed-filter"
            v-model="filter"
            class="field pl-9"
            type="search"
            placeholder="Filter by name or identifier"
          />
        </div>
      </div>

      <p v-if="installedMods.length === 0" class="px-5 py-8 text-muted">No managed or detected mods yet.</p>
      <p v-else-if="visibleMods.length === 0" class="px-5 py-8 text-muted">No installed mods match “{{ filter }}”.</p>
      <table v-else class="w-full border-collapse text-left text-sm">
        <thead>
          <tr class="label border-b border-line">
            <th scope="col" class="w-full px-5 py-3 font-medium">Mod</th>
            <th scope="col" class="hidden whitespace-nowrap px-3 py-3 font-medium sm:table-cell">Version</th>
            <th scope="col" class="hidden whitespace-nowrap px-3 py-3 font-medium md:table-cell">Status</th>
            <th scope="col" class="px-5 py-3 text-right font-medium"><span class="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="{ mod, update } in visibleRows" :key="mod.identifier" class="data-row" data-testid="installed-row">
            <td class="w-full max-w-0 px-5 py-3">
              <p class="truncate font-medium">{{ mod.name ?? mod.identifier }}</p>
              <p class="truncate text-[13px] text-muted">
                {{ mod.identifier }}<span v-if="mod.version" class="readout sm:hidden"> · {{ mod.version }}</span>
              </p>
            </td>
            <td class="readout hidden whitespace-nowrap px-3 py-3 text-[13px] sm:table-cell">
              {{ mod.version ?? "—" }}
              <span v-if="update" class="text-accent">
                → {{ update.availableVersion }}
              </span>
            </td>
            <td class="hidden whitespace-nowrap px-3 py-3 md:table-cell">
              <span v-if="mod.status === 'managed'" class="badge"><span class="status-light text-ok" aria-hidden="true" />Managed</span>
              <span v-else class="badge" title="Installed outside Kraken; files are left alone">Detected</span>
            </td>
            <td class="whitespace-nowrap px-5 py-3">
              <div class="flex justify-end gap-2">
                <button
                  v-if="update !== undefined"
                  class="btn btn-primary btn-sm"
                  type="button"
                  data-testid="installed-update-btn"
                  :aria-label="`Update ${mod.name ?? mod.identifier} to ${update.availableVersion}`"
                  :aria-disabled="busyState(mod.identifier) !== undefined ? 'true' : undefined"
                  @click="busyState(mod.identifier) === undefined && emit('update', update)"
                >
                  {{ updateLabel(mod.identifier) }}
                </button>
                <button
                  v-if="mod.status === 'managed'"
                  class="btn btn-danger-quiet btn-sm"
                  type="button"
                  data-testid="installed-uninstall-btn"
                  :aria-label="`Uninstall ${mod.name ?? mod.identifier}`"
                  :aria-disabled="busyState(mod.identifier) !== undefined ? 'true' : undefined"
                  @click="busyState(mod.identifier) === undefined && emit('uninstall', mod)"
                >
                  <AppIcon name="trash" />
                  <span class="hidden sm:inline">{{ uninstallLabel(mod.identifier) }}</span>
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>
