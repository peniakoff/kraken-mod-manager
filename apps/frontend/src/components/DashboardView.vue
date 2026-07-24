<script setup lang="ts">
import type { AvailableUpdate, KspInstallation, RegistryResponse } from "@kraken/contracts";

defineProps<{
  installation: KspInstallation;
  installedCount: number;
  updates: AvailableUpdate[];
  registry?: RegistryResponse;
  isRefreshingRegistry: boolean;
}>();

defineEmits<{
  refreshRegistry: [];
  browseMods: [];
}>();
</script>

<template>
  <div class="space-y-6">
    <div>
      <h1 class="text-3xl font-bold">Dashboard</h1>
      <p class="mt-2 text-slate-300">Overview of your Kerbal Space Program installation and mod status.</p>
    </div>

    <section class="rounded-xl border border-emerald-800 bg-emerald-950/30 p-5">
      <h2 class="font-semibold text-emerald-300">Active installation</h2>
      <p class="mt-2 break-all font-mono text-sm">{{ installation.path }}</p>
      <dl class="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt class="text-slate-400">KSP version</dt>
          <dd class="mt-1 font-medium">{{ installation.version ?? "Unknown" }}</dd>
        </div>
        <div>
          <dt class="text-slate-400">Source</dt>
          <dd class="mt-1 font-medium capitalize">{{ installation.source }}</dd>
        </div>
        <div>
          <dt class="text-slate-400">Platform</dt>
          <dd class="mt-1 font-medium">{{ installation.platform }}</dd>
        </div>
        <div>
          <dt class="text-slate-400">Installed mods</dt>
          <dd class="mt-1 font-medium">{{ installedCount }}</dd>
        </div>
      </dl>
    </section>

    <section class="rounded-xl border border-slate-700 bg-slate-900/60 p-5">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 class="font-semibold">CKAN registry</h2>
          <p v-if="registry === undefined" class="mt-2 text-slate-300">Loading registry status…</p>
          <p v-else-if="registry.status === 'missing'" class="mt-2 text-slate-300">
            No local metadata cache yet. Refresh to download the official CKAN-meta archive.
          </p>
          <p v-else class="mt-2 text-slate-300">
            {{ registry.moduleCount }} modules indexed
            <span v-if="registry.updatedAt"> · updated {{ registry.updatedAt }}</span>
            <span v-if="registry.parseErrors"> · {{ registry.parseErrors }} parse errors</span>
          </p>
        </div>
        <button
          class="rounded-md bg-cyan-500 px-3 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-60"
          type="button"
          :disabled="isRefreshingRegistry"
          @click="$emit('refreshRegistry')"
        >
          {{ isRefreshingRegistry ? "Refreshing…" : "Refresh registry" }}
        </button>
      </div>
    </section>

    <section class="rounded-xl border border-slate-700 bg-slate-900/60 p-5">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 class="font-semibold">Available updates</h2>
          <p class="mt-2 text-slate-300">
            <span v-if="updates.length === 0">All managed mods are up to date.</span>
            <span v-else>{{ updates.length }} update{{ updates.length === 1 ? "" : "s" }} available.</span>
          </p>
        </div>
        <button
          class="rounded-md border border-cyan-400 px-3 py-2 text-sm font-semibold text-cyan-300 hover:bg-cyan-400/10"
          type="button"
          @click="$emit('browseMods')"
        >
          Browse mods
        </button>
      </div>
      <ul v-if="updates.length > 0" class="mt-4 space-y-3">
        <li
          v-for="update in updates"
          :key="update.identifier"
          class="rounded-lg border border-slate-700 bg-slate-950/50 p-3"
        >
          <p class="font-semibold">{{ update.name }}</p>
          <p class="mt-1 text-sm text-slate-400">
            {{ update.identifier }} ·
            <span class="font-mono">{{ update.installedVersion }}</span>
            →
            <span class="font-mono text-cyan-300">{{ update.availableVersion }}</span>
          </p>
        </li>
      </ul>
    </section>
  </div>
</template>
