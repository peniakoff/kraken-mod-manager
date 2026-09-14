<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import type { AvailableUpdate, CkanModule, CkanResources, InstalledMod } from "@kraken/contracts";
import { formatDownloadSize, isCompatibleWithKsp } from "../compat.js";

const props = defineProps<{
  mod: CkanModule;
  versions: CkanModule[];
  kspVersion?: string;
  installedMods: InstalledMod[];
  availableUpdates: AvailableUpdate[];
  installingIdentifier?: string;
  uninstallingIdentifier?: string;
  isLoadingVersions?: boolean;
}>();

const emit = defineEmits<{
  close: [];
  install: [mod: CkanModule];
  uninstall: [mod: InstalledMod];
  selectVersion: [mod: CkanModule];
}>();

const selectedVersionString = ref(props.mod.version);
const dialogContainerRef = ref<HTMLDivElement>();
const closeButtonRef = ref<HTMLButtonElement>();
let previousActiveElement: HTMLElement | null = null;

watch(
  () => props.mod.version,
  (newVersion) => {
    selectedVersionString.value = newVersion;
  },
);

const currentVersionMod = computed(() => {
  return props.versions.find((v) => v.version === selectedVersionString.value) ?? props.mod;
});

const installedMod = computed(() => {
  return props.installedMods.find((m) => m.identifier === props.mod.identifier);
});

const availableUpdate = computed(() => {
  return props.availableUpdates.find((u) => u.identifier === props.mod.identifier);
});

const isInstalled = computed(() => installedMod.value !== undefined);
const isManaged = computed(() => installedMod.value?.status === "managed");

const compat = computed(() => {
  const m = currentVersionMod.value;
  if (props.kspVersion === undefined) {
    return { text: "Unknown KSP version", ok: true };
  }
  const ok = isCompatibleWithKsp(m, props.kspVersion);
  return ok ? { text: `Compatible with KSP ${props.kspVersion}`, ok: true } : { text: "May not be compatible", ok: false };
});

const isInstalling = computed(() => props.installingIdentifier === props.mod.identifier);
const isUninstalling = computed(() => props.uninstallingIdentifier === props.mod.identifier);

function isSafeUrl(url: string | undefined): boolean {
  if (typeof url !== "string" || url.trim().length === 0) {
    return false;
  }
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

const RESOURCE_CONFIG: Array<{ key: keyof CkanResources; label: string; id: string }> = [
  { key: "homepage", label: "Homepage", id: "homepage" },
  { key: "repository", label: "Repository", id: "repository" },
  { key: "bugtracker", label: "Bug tracker", id: "bugtracker" },
  { key: "spacedock", label: "SpaceDock", id: "spacedock" },
  { key: "curse", label: "CurseForge", id: "curse" },
  { key: "manual", label: "Manual", id: "manual" },
  { key: "metanet", label: "MetaNet", id: "metanet" },
];

const safeResources = computed(() => {
  const res = currentVersionMod.value.resources ?? props.mod.resources;
  if (!res) {
    return [];
  }
  return RESOURCE_CONFIG.flatMap((item) => {
    const url = res[item.key];
    return isSafeUrl(url) ? [{ label: item.label, id: item.id, url: url! }] : [];
  });
});

const relationships = computed(() => {
  return currentVersionMod.value.relationships ?? props.mod.relationships;
});

const hasRelationships = computed(() => {
  const r = relationships.value;
  return Boolean(
    r && (r.depends.length > 0 || r.conflicts.length > 0 || r.recommends.length > 0 || r.suggests.length > 0),
  );
});

function onVersionChange(event: Event): void {
  const select = event.target as HTMLSelectElement;
  selectedVersionString.value = select.value;
  const match = props.versions.find((v) => v.version === select.value);
  if (match !== undefined) {
    emit("selectVersion", match);
  }
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    emit("close");
    return;
  }
  if (event.key === "Tab" && dialogContainerRef.value) {
    const focusableElements = dialogContainerRef.value.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (focusableElements.length === 0) return;
    const firstElement = focusableElements[0]!;
    const lastElement = focusableElements[focusableElements.length - 1]!;
    if (event.shiftKey && document.activeElement === firstElement) {
      lastElement.focus();
      event.preventDefault();
    } else if (!event.shiftKey && document.activeElement === lastElement) {
      firstElement.focus();
      event.preventDefault();
    }
  }
}

onMounted(() => {
  previousActiveElement = document.activeElement as HTMLElement | null;
  window.addEventListener("keydown", handleKeydown);
  closeButtonRef.value?.focus();
});

onUnmounted(() => {
  window.removeEventListener("keydown", handleKeydown);
  previousActiveElement?.focus();
});
</script>

<template>
  <div
    class="fixed inset-0 z-40 flex justify-end bg-slate-950/70"
    role="dialog"
    aria-modal="true"
    aria-labelledby="mod-details-title"
    data-testid="mod-details-panel"
    @click.self="emit('close')"
  >
    <div
      ref="dialogContainerRef"
      class="flex h-full w-full max-w-2xl flex-col border-l border-slate-700 bg-slate-900 p-6 shadow-2xl overflow-y-auto"
    >
      <!-- Header -->
      <div class="flex items-start justify-between border-b border-slate-800 pb-4">
        <div>
          <div class="flex flex-wrap items-center gap-2">
            <h2 id="mod-details-title" class="text-2xl font-bold text-slate-100">{{ currentVersionMod.name }}</h2>
            <span v-if="currentVersionMod.license" class="rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-300">
              {{ currentVersionMod.license }}
            </span>
          </div>
          <p class="mt-1 font-mono text-sm text-cyan-400">
            {{ currentVersionMod.identifier }}
            <span class="text-slate-400">· by {{ currentVersionMod.authors.join(", ") || "Unknown author" }}</span>
          </p>
        </div>
        <button
          ref="closeButtonRef"
          class="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
          type="button"
          aria-label="Close details"
          data-testid="close-details-btn"
          @click="emit('close')"
        >
          ✕
        </button>
      </div>

      <!-- Actions & Status Banner -->
      <div class="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950/60 p-4">
        <div class="flex flex-wrap items-center gap-2">
          <!-- Installed status -->
          <span
            v-if="isInstalled"
            class="rounded-full border border-sky-500/60 bg-sky-950/40 px-2.5 py-0.5 text-xs font-semibold text-sky-300"
            data-testid="details-installed-badge"
          >
            Installed{{ installedMod?.version ? ` (v${installedMod.version})` : "" }}
          </span>
          <!-- Update status -->
          <span
            v-if="availableUpdate !== undefined"
            class="rounded-full border border-violet-500/60 bg-violet-950/40 px-2.5 py-0.5 text-xs font-semibold text-violet-300"
            data-testid="details-update-badge"
          >
            Update to v{{ availableUpdate.availableVersion }} available
          </span>
          <!-- Compatibility -->
          <span
            :class="[
              'rounded-full border px-2.5 py-0.5 text-xs font-medium',
              compat.ok
                ? 'border-emerald-500/60 bg-emerald-950/40 text-emerald-300'
                : 'border-amber-500/60 bg-amber-950/40 text-amber-300',
            ]"
            data-testid="details-compat-flag"
          >
            {{ compat.text }}
          </span>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <button
            v-if="isManaged"
            class="rounded-md border border-rose-500/60 bg-rose-950/30 px-3 py-1.5 text-sm font-semibold text-rose-300 hover:bg-rose-900/50 disabled:opacity-50"
            type="button"
            :disabled="isUninstalling || isInstalling"
            data-testid="details-uninstall-btn"
            @click="installedMod && emit('uninstall', installedMod)"
          >
            {{ isUninstalling ? "Uninstalling…" : "Uninstall" }}
          </button>
          <button
            v-if="currentVersionMod.download !== undefined"
            class="rounded-md bg-cyan-500 px-4 py-1.5 text-sm font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-50"
            type="button"
            :disabled="isInstalling || isUninstalling"
            data-testid="details-install-btn"
            @click="emit('install', currentVersionMod)"
          >
            {{ isInstalling ? "Installing…" : isInstalled ? "Reinstall" : "Install" }}
          </button>
        </div>
      </div>

      <!-- Versions selector & Download size -->
      <div class="mt-4 flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-4">
        <div class="flex items-center gap-2">
          <label class="text-xs font-medium uppercase tracking-wider text-slate-400" for="version-select">
            Version:
          </label>
          <select
            id="version-select"
            class="rounded-md border border-slate-700 bg-slate-950 px-3 py-1 text-sm font-mono text-slate-200"
            :value="selectedVersionString"
            data-testid="version-select"
            @change="onVersionChange"
          >
            <option
              v-for="ver in (versions.length > 0 ? versions : [mod])"
              :key="ver.version"
              :value="ver.version"
            >
              {{ ver.version }}{{ ver.version === mod.version ? " (latest)" : "" }}
            </option>
          </select>
          <span v-if="isLoadingVersions" class="text-xs text-slate-500">Loading versions…</span>
        </div>
        <div v-if="formatDownloadSize(currentVersionMod.downloadSize)" class="text-xs text-slate-400">
          Download size: {{ formatDownloadSize(currentVersionMod.downloadSize) }}
        </div>
      </div>

      <!-- Description / Abstract -->
      <div class="mt-4 border-b border-slate-800 pb-4">
        <h3 class="text-xs font-semibold uppercase tracking-wider text-slate-400">Description</h3>
        <p class="mt-2 whitespace-pre-line text-sm leading-relaxed text-slate-300">
          {{ currentVersionMod.description || currentVersionMod.abstract || "No description provided." }}
        </p>
      </div>

      <!-- Project Links -->
      <div v-if="safeResources.length > 0" class="mt-4 border-b border-slate-800 pb-4">
        <h3 class="text-xs font-semibold uppercase tracking-wider text-slate-400">Project Links</h3>
        <div class="mt-2 flex flex-wrap gap-2">
          <a
            v-for="link in safeResources"
            :key="link.label"
            :href="link.url"
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800/80 px-3 py-1 text-xs text-cyan-400 hover:border-cyan-500/60 hover:text-cyan-300"
            :data-testid="`resource-link-${link.id}`"
          >
            {{ link.label }} ↗
          </a>
        </div>
      </div>

      <!-- Dependencies & Relationships -->
      <div class="mt-4 border-b border-slate-800 pb-4">
        <h3 class="text-xs font-semibold uppercase tracking-wider text-slate-400">Relationships</h3>
        <div v-if="hasRelationships" class="mt-2 space-y-3">
          <!-- Depends -->
          <div v-if="relationships && relationships.depends.length > 0">
            <span class="text-xs font-medium text-slate-400">Depends on:</span>
            <ul class="mt-1 flex flex-wrap gap-1.5">
              <li
                v-for="dep in relationships.depends"
                :key="dep.name"
                class="rounded border border-slate-700 bg-slate-800/60 px-2 py-0.5 text-xs text-slate-300 font-mono"
              >
                {{ dep.name }}{{ dep.minVersion ? ` >= ${dep.minVersion}` : "" }}{{ dep.maxVersion ? ` <= ${dep.maxVersion}` : "" }}
              </li>
            </ul>
          </div>

          <!-- Conflicts -->
          <div v-if="relationships && relationships.conflicts.length > 0">
            <span class="text-xs font-medium text-rose-400">Conflicts with:</span>
            <ul class="mt-1 flex flex-wrap gap-1.5">
              <li
                v-for="conf in relationships.conflicts"
                :key="conf.name"
                class="rounded border border-rose-900/60 bg-rose-950/40 px-2 py-0.5 text-xs text-rose-300 font-mono"
              >
                {{ conf.name }}
              </li>
            </ul>
          </div>

          <!-- Recommends -->
          <div v-if="relationships && relationships.recommends.length > 0">
            <span class="text-xs font-medium text-slate-400">Recommends:</span>
            <ul class="mt-1 flex flex-wrap gap-1.5">
              <li
                v-for="rec in relationships.recommends"
                :key="rec.name"
                class="rounded border border-slate-700 bg-slate-800/60 px-2 py-0.5 text-xs text-slate-300 font-mono"
              >
                {{ rec.name }}
              </li>
            </ul>
          </div>

          <!-- Suggests -->
          <div v-if="relationships && relationships.suggests.length > 0">
            <span class="text-xs font-medium text-slate-400">Suggests:</span>
            <ul class="mt-1 flex flex-wrap gap-1.5">
              <li
                v-for="sug in relationships.suggests"
                :key="sug.name"
                class="rounded border border-slate-700 bg-slate-800/60 px-2 py-0.5 text-xs text-slate-300 font-mono"
              >
                {{ sug.name }}
              </li>
            </ul>
          </div>
        </div>
        <p v-else class="mt-1 text-xs text-slate-500">No dependencies declared.</p>
      </div>

      <!-- Tags -->
      <div v-if="currentVersionMod.tags.length > 0" class="mt-4">
        <h3 class="text-xs font-semibold uppercase tracking-wider text-slate-400">Tags</h3>
        <div class="mt-2 flex flex-wrap gap-1.5">
          <span
            v-for="tag in currentVersionMod.tags"
            :key="tag"
            class="rounded-full border border-slate-700 px-2.5 py-0.5 text-xs text-slate-300"
          >
            {{ tag }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>
