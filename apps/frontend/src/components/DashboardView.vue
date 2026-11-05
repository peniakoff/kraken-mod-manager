<script setup lang="ts">
import { computed } from "vue";
import type { AvailableUpdate, KspInstallation, RegistryResponse } from "@kraken/contracts";
import AppIcon from "./AppIcon.vue";
import PathText from "./PathText.vue";
import ViewHeader from "./ViewHeader.vue";
import { formatCount, formatRelativeTime } from "../format.js";

const props = withDefaults(
  defineProps<{
    installation: KspInstallation;
    installedCount: number;
    updates: AvailableUpdate[];
    registry?: RegistryResponse;
    isRefreshingRegistry: boolean;
    installingIdentifiers?: string[];
    isUpdatingAll?: boolean;
  }>(),
  { installingIdentifiers: () => [], isUpdatingAll: false },
);

defineEmits<{
  refreshRegistry: [];
  update: [update: AvailableUpdate];
  updateAll: [];
}>();

function isBusy(identifier: string): boolean {
  return props.isUpdatingAll || props.installingIdentifiers.includes(identifier);
}

const registryUpdated = computed(() =>
  props.registry?.updatedAt === undefined ? undefined : formatRelativeTime(props.registry.updatedAt),
);

const updatesSummary = computed(() =>
  props.updates.length === 0
    ? "All managed mods are up to date."
    : `${props.updates.length} update${props.updates.length === 1 ? "" : "s"} available.`,
);
</script>

<template>
  <div>
    <ViewHeader title="Overview">
      Status of your Kerbal Space Program installation and its mods.
    </ViewHeader>

    <dl class="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Readouts">
      <div class="panel panel-instrument p-4">
        <dt class="label">KSP version</dt>
        <dd class="readout mt-2 text-[26px] leading-none">{{ installation.version ?? "Unknown" }}</dd>
        <dd class="mt-2 text-[13px] capitalize text-muted">{{ installation.platform }} · {{ installation.source }}</dd>
      </div>
      <div class="panel panel-instrument p-4">
        <dt class="label">Installed mods</dt>
        <dd class="readout mt-2 text-[26px] leading-none">{{ installedCount }}</dd>
        <dd class="mt-2 text-[13px] text-muted">Managed and detected</dd>
      </div>
      <div class="panel panel-instrument p-4">
        <dt class="label">Updates</dt>
        <dd class="readout mt-2 text-[26px] leading-none" :class="updates.length > 0 ? 'text-accent' : ''">
          {{ updates.length }}
        </dd>
        <dd class="mt-2 flex items-center gap-2 text-[13px]" :class="updates.length > 0 ? 'text-accent' : 'text-ok'">
          <span class="status-light" aria-hidden="true" />
          {{ updates.length > 0 ? "Ready to install" : "Up to date" }}
        </dd>
      </div>
      <div class="panel panel-instrument p-4">
        <dt class="label">Registry</dt>
        <dd class="readout mt-2 text-[26px] leading-none">
          {{ registry?.status === "ready" ? formatCount(registry.moduleCount) : "—" }}
        </dd>
        <dd class="mt-2 text-[13px] text-muted" :title="registry?.updatedAt">
          {{ registryUpdated !== undefined ? `Updated ${registryUpdated}` : "Not downloaded" }}
        </dd>
      </div>
    </dl>

    <div class="mt-6 grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <section class="panel self-start" aria-labelledby="updates-title">
        <div class="panel-header">
          <div>
            <h2 id="updates-title" class="panel-title">Available updates</h2>
            <p class="mt-1 text-[13px] text-muted">{{ updatesSummary }}</p>
          </div>
          <button
            v-if="updates.length > 0"
            class="btn btn-primary"
            type="button"
            :disabled="isUpdatingAll"
            @click="$emit('updateAll')"
          >
            <AppIcon name="update" />
            {{ isUpdatingAll ? "Updating…" : "Update all" }}
          </button>
        </div>
        <ul v-if="updates.length > 0">
          <li
            v-for="update in updates"
            :key="update.identifier"
            class="data-row flex flex-wrap items-center justify-between gap-3 px-5 py-3"
          >
            <div class="min-w-0">
              <p class="font-medium">{{ update.name }}</p>
              <p class="mt-0.5 text-[13px] text-muted">
                {{ update.identifier }} ·
                <span class="readout">{{ update.installedVersion }}</span>
                →
                <span class="readout text-accent">{{ update.availableVersion }}</span>
              </p>
            </div>
            <button
              class="btn btn-secondary btn-sm"
              type="button"
              :data-testid="`update-btn-${update.identifier}`"
              :aria-label="`Update ${update.name} to ${update.availableVersion}`"
              :disabled="isBusy(update.identifier)"
              @click="$emit('update', update)"
            >
              {{ installingIdentifiers.includes(update.identifier) ? "Updating…" : "Update" }}
            </button>
          </li>
        </ul>
        <div v-else class="flex items-center gap-3 px-5 py-8 text-muted">
          <AppIcon name="check" :size="20" class="text-ok" />
          <span>Every managed mod is on its latest compatible version.</span>
        </div>
      </section>

      <div class="space-y-6">
        <section class="panel" aria-labelledby="registry-title">
          <div class="panel-header">
            <h2 id="registry-title" class="panel-title">CKAN registry</h2>
            <button
              class="btn btn-secondary btn-sm"
              type="button"
              :disabled="isRefreshingRegistry"
              @click="$emit('refreshRegistry')"
            >
              <AppIcon name="refresh" :class="isRefreshingRegistry ? 'animate-spin' : ''" />
              {{ isRefreshingRegistry ? "Refreshing…" : "Refresh registry" }}
            </button>
          </div>
          <div class="px-5 py-4 text-sm">
            <p v-if="registry === undefined" class="text-muted">Loading registry status…</p>
            <p v-else-if="registry.status === 'missing'" class="text-muted">
              No local metadata cache yet. Refresh to download the official CKAN-meta archive.
            </p>
            <p v-else>
              <span class="readout">{{ formatCount(registry.moduleCount) }}</span>
              {{ registry.moduleCount === 1 ? "module" : "modules" }} indexed
              <span v-if="registryUpdated" class="text-muted" :title="registry.updatedAt"> · updated {{ registryUpdated }}</span>
              <span v-if="registry.parseErrors" class="text-warn"> · {{ registry.parseErrors }} parse errors</span>
            </p>
          </div>
        </section>

        <section class="panel" aria-labelledby="installation-title">
          <div class="panel-header">
            <h2 id="installation-title" class="panel-title">Active installation</h2>
            <span class="badge badge-ok"><span class="status-light" aria-hidden="true" />Linked</span>
          </div>
          <dl class="space-y-3 px-5 py-4 text-sm">
            <div>
              <dt class="label">Path</dt>
              <dd class="mt-1 text-[13px]"><PathText :path="installation.path" /></dd>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <dt class="label">Platform</dt>
                <dd class="mt-1 capitalize">{{ installation.platform }}</dd>
              </div>
              <div>
                <dt class="label">Source</dt>
                <dd class="mt-1 capitalize">{{ installation.source }}</dd>
              </div>
            </div>
          </dl>
        </section>
      </div>
    </div>
  </div>
</template>
