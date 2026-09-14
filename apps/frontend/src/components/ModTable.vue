<script setup lang="ts">
import { computed } from "vue";
import type { AvailableUpdate, CkanModule, InstalledMod } from "@kraken/contracts";
import { formatDownloadSize, isCompatibleWithKsp } from "../compat.js";

const props = defineProps<{
  mods: CkanModule[];
  kspVersion?: string;
  compatibleOnly: boolean;
  installedMods: InstalledMod[];
  availableUpdates: AvailableUpdate[];
  installingIdentifier?: string;
}>();

const emit = defineEmits<{
  install: [mod: CkanModule];
}>();

const installedById = computed(() => new Map(props.installedMods.map((mod) => [mod.identifier, mod])));
const updatesById = computed(() => new Map(props.availableUpdates.map((update) => [update.identifier, update])));

function compatLabel(mod: CkanModule): { text: string; ok: boolean } {
  if (props.kspVersion === undefined) {
    return { text: "Unknown KSP version", ok: true };
  }
  if (props.compatibleOnly) {
    return { text: `✓ ${props.kspVersion}`, ok: true };
  }
  const ok = isCompatibleWithKsp(mod, props.kspVersion);
  return ok ? { text: `✓ ${props.kspVersion}`, ok: true } : { text: "May not be compatible", ok: false };
}
</script>

<template>
  <div>
    <ul v-if="mods.length > 0" class="mt-3 max-h-96 space-y-3 overflow-y-auto">
      <li
        v-for="mod in mods"
        :key="`${mod.identifier}@${mod.version}`"
        class="rounded-lg border border-slate-700 p-3"
        data-testid="mod-row"
      >
        <p class="font-semibold">
          {{ mod.name }} <span class="font-mono text-sm text-slate-400">{{ mod.version }}</span>
        </p>
        <p class="mt-1 text-sm text-slate-400">
          {{ mod.identifier }} · {{ mod.authors.join(", ") || "Unknown author" }}
        </p>
        <p v-if="mod.abstract" class="mt-2 line-clamp-2 text-sm text-slate-300">{{ mod.abstract }}</p>
        <div class="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <span
            :class="[
              'rounded-full border px-2 py-0.5 font-medium',
              compatLabel(mod).ok
                ? 'border-emerald-500/60 text-emerald-300'
                : 'border-amber-500/60 text-amber-300',
            ]"
            data-testid="compat-flag"
          >
            {{ compatLabel(mod).text }}
          </span>
          <span
            v-for="tag in mod.tags.slice(0, 4)"
            :key="tag"
            class="rounded-full border border-slate-600 px-2 py-0.5 text-slate-300"
          >
            {{ tag }}
          </span>
          <span v-if="formatDownloadSize(mod.downloadSize) !== undefined" class="text-slate-400">
            {{ formatDownloadSize(mod.downloadSize) }}
          </span>
          <span
            v-if="installedById.get(mod.identifier) !== undefined"
            class="rounded-full border border-sky-500/60 px-2 py-0.5 font-medium text-sky-300"
            data-testid="installed-badge"
          >
            Installed{{ installedById.get(mod.identifier)?.version ? ` ${installedById.get(mod.identifier)?.version}` : "" }}
          </span>
          <span
            v-if="updatesById.get(mod.identifier) !== undefined"
            class="rounded-full border border-violet-500/60 px-2 py-0.5 font-medium text-violet-300"
            data-testid="update-badge"
          >
            Update: {{ updatesById.get(mod.identifier)?.availableVersion }}
          </span>
        </div>
        <button
          v-if="mod.download !== undefined"
          class="mt-3 rounded-md bg-cyan-500 px-3 py-1 text-sm font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-60"
          type="button"
          :disabled="installingIdentifier === mod.identifier"
          @click="emit('install', mod)"
        >
          {{ installingIdentifier === mod.identifier ? "Installing…" : "Install" }}
        </button>
      </li>
    </ul>
    <p v-else class="mt-3 text-sm text-slate-400">No mods match the current search and filters.</p>
  </div>
</template>
