<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import type { AvailableUpdate, CkanModule, CkanRelationship, CkanResources, InstalledMod } from "@kraken/contracts";
import { formatDownloadSize, isCompatibleWithKsp } from "../compat.js";
import AppIcon from "./AppIcon.vue";

const props = withDefaults(defineProps<{
  mod: CkanModule;
  versions: CkanModule[];
  kspVersion?: string;
  installedMods: InstalledMod[];
  availableUpdates: AvailableUpdate[];
  installingIdentifiers?: string[];
  uninstallingIdentifier?: string;
  isLoadingVersions?: boolean;
}>(), {
  installingIdentifiers: () => [],
});

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

const updateTarget = computed(() => {
  const update = availableUpdate.value;
  return update === undefined ? undefined : props.versions.find((v) => v.version === update.availableVersion);
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

const isInstalling = computed(() => props.installingIdentifiers.includes(props.mod.identifier));
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

const provides = computed(() => currentVersionMod.value.provides ?? []);

const relationshipGroups = computed(() => {
  const r = relationships.value;
  if (!r) {
    return [];
  }
  return [
    { key: "depends", label: "Depends on:", items: r.depends, danger: false },
    { key: "conflicts", label: "Conflicts with:", items: r.conflicts, danger: true },
    { key: "recommends", label: "Recommends:", items: r.recommends, danger: false },
    { key: "suggests", label: "Suggests:", items: r.suggests, danger: false },
  ].filter((group) => group.items.length > 0);
});

const hasRelationships = computed(() => {
  const r = relationships.value;
  return Boolean(
    provides.value.length > 0 ||
      (r && (r.depends.length > 0 || r.conflicts.length > 0 || r.recommends.length > 0 || r.suggests.length > 0)),
  );
});

function formatRelationship(relation: CkanRelationship): string {
  switch (relation.kind) {
    case "single":
      return `${relation.name}${relation.minVersion ? ` >= ${relation.minVersion}` : ""}${relation.maxVersion ? ` <= ${relation.maxVersion}` : ""}`;
    case "anyOf":
      return `one of ${relation.alternatives.map((alternative) => alternative.name).join(", ")}`;
    case "unsupported":
      return "unsupported relationship";
    default: {
      const exhaustive: never = relation;
      throw new Error(`Unknown relationship kind: ${JSON.stringify(exhaustive)}`);
    }
  }
}

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
    class="fixed inset-0 z-40 flex justify-end bg-void/70 backdrop-blur-[2px]"
    role="dialog"
    aria-modal="true"
    aria-labelledby="mod-details-title"
    data-testid="mod-details-panel"
    @click.self="emit('close')"
  >
    <div
      ref="dialogContainerRef"
      class="flex h-full w-full max-w-2xl flex-col overflow-y-auto border-l border-line-strong bg-panel shadow-[0_0_64px_rgb(0_0_0/0.5)]"
    >
      <div class="flex items-start justify-between gap-4 border-b border-line px-6 py-5">
        <div class="min-w-0">
          <div class="flex flex-wrap items-center gap-2">
            <h2 id="mod-details-title" class="text-2xl font-semibold">{{ currentVersionMod.name }}</h2>
            <span v-if="currentVersionMod.license" class="badge">{{ currentVersionMod.license }}</span>
          </div>
          <p class="mt-1 text-[13px] text-muted">
            <span class="readout text-accent">{{ currentVersionMod.identifier }}</span>
            · by {{ currentVersionMod.authors.join(", ") || "Unknown author" }}
          </p>
        </div>
        <button
          ref="closeButtonRef"
          class="btn btn-icon -mr-2"
          type="button"
          aria-label="Close details"
          data-testid="close-details-btn"
          @click="emit('close')"
        >
          <AppIcon name="close" :size="18" />
        </button>
      </div>

      <div class="space-y-6 px-6 py-5">
        <div class="panel flex flex-wrap items-center justify-between gap-3 bg-hull p-4">
          <div class="flex flex-wrap items-center gap-2">
            <span v-if="isInstalled" class="badge badge-ok" data-testid="details-installed-badge">
              Installed{{ installedMod?.version ? ` ${installedMod.version}` : "" }}
            </span>
            <span v-if="availableUpdate !== undefined" class="badge badge-info" data-testid="details-update-badge">
              Update {{ availableUpdate.availableVersion }} available
            </span>
            <span :class="['badge', compat.ok ? '' : 'badge-warn']" data-testid="details-compat-flag">
              <AppIcon :name="compat.ok ? 'check' : 'alert'" :size="14" :class="compat.ok ? 'text-ok' : ''" />
              {{ compat.text }}
            </span>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <button
              v-if="isManaged"
              class="btn btn-danger btn-sm"
              type="button"
              :disabled="isUninstalling || isInstalling"
              data-testid="details-uninstall-btn"
              @click="installedMod && emit('uninstall', installedMod)"
            >
              {{ isUninstalling ? "Uninstalling…" : "Uninstall" }}
            </button>
            <button
              v-if="updateTarget !== undefined && updateTarget.download !== undefined"
              class="btn btn-secondary btn-sm"
              type="button"
              :disabled="isInstalling || isUninstalling"
              data-testid="details-update-btn"
              @click="emit('install', updateTarget)"
            >
              Update to {{ updateTarget.version }}
            </button>
            <button
              v-if="currentVersionMod.download !== undefined"
              class="btn btn-primary btn-sm"
              type="button"
              :aria-disabled="isInstalling || isUninstalling ? 'true' : undefined"
              data-testid="details-install-btn"
              @click="!isInstalling && !isUninstalling && emit('install', currentVersionMod)"
            >
              {{ isInstalling ? "Installing…" : isInstalled ? "Reinstall" : "Install" }}
            </button>
          </div>
        </div>

        <div class="flex flex-wrap items-end justify-between gap-3">
          <div>
            <label class="label block" for="version-select">Version</label>
            <div class="mt-1.5 flex items-center gap-3">
              <select
                id="version-select"
                class="field readout h-9 w-auto pr-8"
                :value="selectedVersionString"
                data-testid="version-select"
                @change="onVersionChange"
              >
                <option v-for="ver in versions.length > 0 ? versions : [mod]" :key="ver.version" :value="ver.version">
                  {{ ver.version }}{{ ver.version === mod.version ? " (latest)" : "" }}
                </option>
              </select>
              <span v-if="isLoadingVersions" class="text-[13px] text-muted">Loading versions…</span>
            </div>
          </div>
          <p v-if="formatDownloadSize(currentVersionMod.downloadSize)" class="text-[13px] text-muted">
            Download size <span class="readout text-ink">{{ formatDownloadSize(currentVersionMod.downloadSize) }}</span>
          </p>
        </div>

        <section>
          <h3 class="label">Description</h3>
          <p class="mt-2 whitespace-pre-line text-[15px] leading-relaxed">
            {{ currentVersionMod.description || currentVersionMod.abstract || "No description provided." }}
          </p>
        </section>

        <section v-if="safeResources.length > 0">
          <h3 class="label">Project links</h3>
          <div class="mt-2 flex flex-wrap gap-2">
            <a
              v-for="link in safeResources"
              :key="link.label"
              :href="link.url"
              target="_blank"
              rel="noopener noreferrer"
              class="btn btn-secondary btn-sm"
              :data-testid="`resource-link-${link.id}`"
            >
              {{ link.label }}
              <AppIcon name="external" :size="14" class="text-muted" />
            </a>
          </div>
        </section>

        <section>
          <h3 class="label">Relationships</h3>
          <div v-if="hasRelationships" class="mt-2 space-y-3">
            <div v-if="provides.length > 0">
              <span class="text-[13px] text-muted">Provides:</span>
              <ul class="mt-1.5 flex flex-wrap gap-1.5">
                <li v-for="name in provides" :key="name" class="badge readout text-ink">{{ name }}</li>
              </ul>
            </div>
            <div v-for="group in relationshipGroups" :key="group.key">
              <span class="text-[13px]" :class="group.danger ? 'text-danger' : 'text-muted'">{{ group.label }}</span>
              <ul class="mt-1.5 flex flex-wrap gap-1.5">
                <li
                  v-for="(relation, index) in group.items"
                  :key="`${index}-${formatRelationship(relation)}`"
                  :class="['badge readout', group.danger ? 'badge-danger' : 'text-ink']"
                >
                  {{ formatRelationship(relation) }}
                </li>
              </ul>
            </div>
          </div>
          <p v-else class="mt-2 text-sm text-muted">No dependencies declared.</p>
        </section>

        <section v-if="currentVersionMod.tags.length > 0">
          <h3 class="label">Tags</h3>
          <div class="mt-2 flex flex-wrap gap-1.5">
            <span v-for="tag in currentVersionMod.tags" :key="tag" class="badge">{{ tag }}</span>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>
