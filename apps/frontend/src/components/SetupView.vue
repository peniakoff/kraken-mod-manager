<script setup lang="ts">
import AppIcon from "./AppIcon.vue";
import PathText from "./PathText.vue";
import type { DirectoryListingResponse, KspInstallation } from "@kraken/contracts";

defineProps<{
  status: "checking" | "ready" | "unavailable";
  serviceVersion?: string;
  errorMessage?: string;
  candidates: KspInstallation[];
  directoryListing?: DirectoryListingResponse;
  isSaving: boolean;
}>();

defineEmits<{
  selectInstallation: [path: string];
  openBrowser: [path?: string];
  openChild: [name: string];
  reload: [];
}>();
</script>

<template>
  <main class="cockpit-ground flex min-h-screen items-start justify-center px-4 py-10 text-ink md:items-center md:py-16">
    <section class="panel w-full max-w-2xl p-6 md:p-8">
      <div class="flex items-center gap-3">
        <img src="/kraken-mark.svg" alt="" width="44" height="44" class="h-11 w-11" />
        <div class="leading-tight">
          <p class="text-[15px] font-semibold">Kraken</p>
          <p class="text-[13px] text-muted">Mod Manager</p>
        </div>
      </div>
      <h1 class="mt-8 text-[28px] font-semibold leading-tight md:text-[32px]">Choose your Kerbal Space Program installation.</h1>
      <p class="mt-3 text-muted">Kraken needs one validated KSP installation before it can manage mods.</p>
      <div
        class="mt-6 flex items-center gap-3 rounded-md border border-line bg-hull px-4 py-3 text-sm"
        aria-live="polite"
      >
        <span
          class="status-light"
          :class="{
            'text-warn': status === 'checking',
            'text-ok': status === 'ready',
            'text-danger': status === 'unavailable',
          }"
          aria-hidden="true"
        />
        <span v-if="status === 'checking'">Checking local service…</span>
        <span v-else-if="status === 'ready'">Service connected ({{ serviceVersion }})</span>
        <span v-else>Local service is unavailable.</span>
      </div>
      <p
        v-if="errorMessage !== undefined"
        class="mt-3 flex items-start gap-3 rounded-md border border-danger/40 px-4 py-3 text-sm text-danger"
        role="alert"
      >
        <AppIcon name="alert" :size="18" class="mt-0.5" />
        <span>{{ errorMessage }}</span>
      </p>

      <section v-if="status === 'ready'" class="mt-8">
        <h2 class="panel-title">Detected installations</h2>
        <p v-if="candidates.length === 0" class="mt-2 text-muted">No supported installation was found automatically.</p>
        <ul v-else class="mt-3 space-y-3">
          <li
            v-for="candidate in candidates"
            :key="candidate.path"
            class="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line p-4"
          >
            <div class="min-w-0">
              <p class="text-[13px]"><PathText :path="candidate.path" /></p>
              <p class="mt-1 text-[13px] capitalize text-muted">
                {{ candidate.source }} · {{ candidate.version ?? "Unknown version" }}
              </p>
            </div>
            <button
              class="btn btn-primary btn-sm"
              type="button"
              :disabled="isSaving"
              @click="$emit('selectInstallation', candidate.path)"
            >
              Use this installation
            </button>
          </li>
        </ul>
        <button class="btn btn-secondary mt-6" type="button" @click="$emit('openBrowser')">
          <AppIcon name="folder" />
          Browse folders manually
        </button>
      </section>

      <section v-if="directoryListing !== undefined" class="mt-8 rounded-md border border-line">
        <div class="panel-header">
          <div class="min-w-0">
            <h2 class="panel-title">Select a KSP folder</h2>
            <p class="mt-1 text-[13px] text-muted"><PathText :path="directoryListing.currentPath" /></p>
          </div>
          <div class="flex flex-wrap gap-2">
            <button
              v-if="directoryListing.parentPath !== null"
              class="btn btn-secondary btn-sm"
              type="button"
              @click="$emit('openBrowser', directoryListing.parentPath)"
            >
              <AppIcon name="arrow-up" />
              Up
            </button>
            <button
              class="btn btn-primary btn-sm"
              type="button"
              :disabled="isSaving"
              @click="$emit('selectInstallation', directoryListing.currentPath)"
            >
              Use this folder
            </button>
          </div>
        </div>
        <ul class="max-h-64 overflow-y-auto">
          <li v-for="directory in directoryListing.directories" :key="directory" class="data-row">
            <button
              class="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm"
              type="button"
              @click="$emit('openChild', directory)"
            >
              <AppIcon name="folder" class="text-muted" />
              <span class="readout">{{ directory }}/</span>
            </button>
          </li>
        </ul>
      </section>

      <button class="btn btn-secondary mt-6" type="button" @click="$emit('reload')">
        <AppIcon name="refresh" />
        Check again
      </button>
    </section>
  </main>
</template>
