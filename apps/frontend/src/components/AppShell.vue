<script setup lang="ts">
import { computed } from "vue";
import type { JobResponse, RegistryResponse } from "@kraken/contracts";
import AppIcon, { type IconName } from "./AppIcon.vue";
import InstallQueuePanel from "./InstallQueuePanel.vue";
import { formatCount } from "../format.js";

export type AppView = "dashboard" | "installed" | "browse";

const props = defineProps<{
  activeView: AppView;
  serviceVersion?: string;
  status: "checking" | "ready" | "unavailable";
  errorMessage?: string;
  jobs: JobResponse[];
  installedCount: number;
  kspVersion?: string;
  registry?: RegistryResponse;
}>();

defineEmits<{
  navigate: [view: AppView];
  removeJob: [jobId: string];
  clearFinishedJobs: [];
}>();

const NAV_ITEMS: Array<{ view: AppView; label: string; icon: IconName }> = [
  { view: "dashboard", label: "Overview", icon: "overview" },
  { view: "installed", label: "Installed", icon: "installed" },
  { view: "browse", label: "Browse mods", icon: "browse" },
];

const serviceLight = computed(() => {
  if (props.status === "ready") {
    return "text-ok";
  }
  return props.status === "checking" ? "text-warn" : "text-danger";
});

const serviceText = computed(() => {
  // The shell only renders once the service answered, so "checking" here means
  // the installation data (mods, registry, updates) is still loading.
  if (props.status === "checking") {
    return "Syncing installation…";
  }
  if (props.status === "ready") {
    return `Service connected${props.serviceVersion ? ` (${props.serviceVersion})` : ""}`;
  }
  return "Local service is unavailable.";
});

const registryText = computed(() => {
  if (props.registry === undefined) {
    return "Loading…";
  }
  return props.registry.status === "ready" ? `${formatCount(props.registry.moduleCount)} mods` : "Not downloaded";
});
</script>

<template>
  <div
    class="cockpit-ground min-h-screen text-ink md:grid md:grid-cols-[15rem_minmax(0,1fr)]"
    :class="jobs.length > 0 ? 'pb-72' : ''"
  >
    <a
      href="#main"
      class="btn btn-primary absolute left-4 top-4 z-50 -translate-y-24 focus:translate-y-0"
    >
      Skip to content
    </a>

    <aside
      class="border-b border-line bg-hull/90 md:sticky md:top-0 md:flex md:h-screen md:flex-col md:border-b-0 md:border-r"
    >
      <div class="flex items-center justify-between gap-3 px-4 pt-4 md:px-5 md:pt-6">
        <div class="flex items-center gap-3">
          <img src="/kraken-mark.svg" alt="" width="36" height="36" class="h-9 w-9" />
          <div class="leading-tight">
            <p class="text-[15px] font-semibold tracking-tight">Kraken</p>
            <p class="text-[13px] text-muted">Mod Manager</p>
          </div>
        </div>
        <span class="flex items-center gap-2 md:hidden" :class="serviceLight" :title="serviceText">
          <span class="status-light" aria-hidden="true" />
          <span class="sr-only">{{ serviceText }}</span>
        </span>
      </div>

      <nav class="px-2 py-3 md:px-3 md:py-6" aria-label="Primary">
        <ul class="flex gap-1 md:flex-col">
          <li v-for="item in NAV_ITEMS" :key="item.view" class="flex-1 md:flex-none">
            <button
              type="button"
              class="flex h-10 w-full items-center justify-center gap-2.5 whitespace-nowrap rounded-md px-2 text-sm font-medium transition-colors md:justify-start md:px-3"
              :class="
                activeView === item.view
                  ? 'bg-accent/12 text-accent shadow-[inset_2px_0_0_var(--color-accent)]'
                  : 'text-muted hover:bg-raised hover:text-ink'
              "
              :aria-current="activeView === item.view ? 'page' : undefined"
              @click="$emit('navigate', item.view)"
            >
              <AppIcon :name="item.icon" :size="18" class="hidden sm:block" />
              <span>{{ item.label }}</span>
              <span
                v-if="item.view === 'installed'"
                class="readout ml-auto hidden text-[13px] md:inline"
              >{{ installedCount }}</span>
            </button>
          </li>
        </ul>
      </nav>

      <section class="mx-3 mb-5 mt-auto hidden rounded-lg border border-line p-4 md:block" aria-label="Systems">
        <h2 class="label">Systems</h2>
        <dl class="mt-3 space-y-3 text-[13px]">
          <div>
            <dt class="sr-only">Local service</dt>
            <dd class="flex items-start gap-2" aria-live="polite">
              <span class="status-light mt-1.5" :class="serviceLight" aria-hidden="true" />
              <span class="text-ink">{{ serviceText }}</span>
            </dd>
          </div>
          <div class="flex justify-between gap-3">
            <dt class="text-muted">KSP</dt>
            <dd class="readout">{{ kspVersion ?? "Unknown" }}</dd>
          </div>
          <div class="flex justify-between gap-3">
            <dt class="text-muted">Registry</dt>
            <dd class="readout">{{ registryText }}</dd>
          </div>
        </dl>
      </section>
    </aside>

    <main id="main" tabindex="-1" class="min-w-0 px-4 py-6 outline-none md:px-10 md:py-10">
      <div class="mx-auto max-w-6xl">
        <p
          v-if="errorMessage !== undefined"
          class="panel mb-6 flex items-start gap-3 border-danger/40 px-4 py-3 text-sm text-danger"
          role="alert"
        >
          <AppIcon name="alert" :size="18" class="mt-0.5" />
          <span>{{ errorMessage }}</span>
        </p>
        <slot />
      </div>
    </main>

    <InstallQueuePanel
      :jobs="jobs"
      @remove="$emit('removeJob', $event)"
      @clear-finished="$emit('clearFinishedJobs')"
    />
  </div>
</template>
