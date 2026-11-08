<script setup lang="ts">
import { computed } from "vue";
import type { AvailableUpdate, CkanModule, InstalledMod } from "@kraken/contracts";
import AppIcon from "./AppIcon.vue";
import { formatDownloadSize, isCompatibleWithKsp } from "../compat.js";
import { canInstall } from "../installable.js";
import { moduleIdentifierKey, type BusyState } from "../useJobQueue.js";

const props = defineProps<{
  mods: CkanModule[];
  kspVersion?: string;
  compatibleOnly: boolean;
  installedMods: InstalledMod[];
  availableUpdates: AvailableUpdate[];
  busy: Map<string, BusyState>;
}>();

const emit = defineEmits<{
  install: [mod: CkanModule];
  select: [mod: CkanModule];
}>();

const installedById = computed(() => new Map(props.installedMods.map((mod) => [mod.identifier, mod])));
const updatesById = computed(() => new Map(props.availableUpdates.map((update) => [update.identifier, update])));

function installLabel(mod: CkanModule): string {
  const state = props.busy.get(moduleIdentifierKey(mod.identifier));
  return state === "queued" ? "Queued" : state === "installing" ? "Installing…" : state === "uninstalling" ? "Uninstalling…" : "Install";
}

function isBusy(mod: CkanModule): boolean {
  return props.busy.has(moduleIdentifierKey(mod.identifier));
}

function compatLabel(mod: CkanModule): { text: string; ok: boolean } {
  if (props.kspVersion === undefined) {
    return { text: "Unknown KSP version", ok: true };
  }
  if (props.compatibleOnly || isCompatibleWithKsp(mod, props.kspVersion)) {
    return { text: props.kspVersion, ok: true };
  }
  return { text: "May not be compatible", ok: false };
}
</script>

<template>
  <ul v-if="mods.length > 0">
    <li
      v-for="mod in mods"
      :key="`${mod.identifier}@${mod.version}`"
      class="data-row grid gap-3 px-5 py-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:gap-6"
      data-testid="mod-row"
    >
      <div class="min-w-0">
        <p class="flex flex-wrap items-baseline gap-x-2">
          <span class="text-[15px] font-medium">{{ mod.name }}</span>
          <span class="readout text-[13px] text-muted">{{ mod.version }}</span>
        </p>
        <p class="mt-0.5 truncate text-[13px] text-muted">
          {{ mod.identifier }} · {{ mod.authors.join(", ") || "Unknown author" }}
        </p>
        <p v-if="mod.abstract" class="mt-1.5 line-clamp-2 text-sm leading-relaxed">{{ mod.abstract }}</p>
        <div class="mt-2.5 flex flex-wrap items-center gap-1.5">
          <span :class="['badge', compatLabel(mod).ok ? '' : 'badge-warn']" data-testid="compat-flag">
            <AppIcon
              :name="compatLabel(mod).ok ? 'check' : 'alert'"
              :size="14"
              :class="compatLabel(mod).ok ? 'text-ok' : ''"
            />
            {{ compatLabel(mod).text }}
          </span>
          <span v-for="tag in mod.tags.slice(0, 4)" :key="tag" class="badge">{{ tag }}</span>
          <span v-if="mod.kind === 'metapackage'" class="badge" data-testid="metapackage-badge">Metapackage</span>
          <span v-if="mod.source === 'imported'" class="badge" data-testid="imported-badge">Imported</span>
          <span v-if="mod.kind !== 'metapackage' && formatDownloadSize(mod.downloadSize) !== undefined" class="readout px-1 text-[13px] text-muted">
            {{ formatDownloadSize(mod.downloadSize) }}
          </span>
          <span
            v-if="installedById.get(mod.identifier) !== undefined"
            class="badge badge-ok"
            data-testid="installed-badge"
          >
            Installed{{ installedById.get(mod.identifier)?.version ? ` ${installedById.get(mod.identifier)?.version}` : "" }}
          </span>
          <span v-if="updatesById.get(mod.identifier) !== undefined" class="badge badge-info" data-testid="update-badge">
            <AppIcon name="update" :size="14" />
            Update: {{ updatesById.get(mod.identifier)?.availableVersion }}
          </span>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <button
          class="btn btn-secondary btn-sm"
          type="button"
          :aria-label="`View details for ${mod.name}`"
          data-testid="mod-details-btn"
          @click="emit('select', mod)"
        >
          Details
        </button>
        <button
          v-if="canInstall(mod)"
          class="btn btn-primary btn-sm"
          type="button"
          :aria-label="isBusy(mod) ? `Install ${mod.name}` : undefined"
          :aria-disabled="isBusy(mod) ? 'true' : undefined"
          @click="!isBusy(mod) && emit('install', mod)"
        >
          <AppIcon name="download" />
          {{ installLabel(mod) }}
        </button>
      </div>
    </li>
  </ul>
  <p v-else class="px-5 py-10 text-center text-muted">No mods match the current search and filters.</p>
</template>
