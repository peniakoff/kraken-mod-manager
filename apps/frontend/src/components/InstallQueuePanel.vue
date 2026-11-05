<script setup lang="ts">
import { computed } from "vue";
import type { JobResponse } from "@kraken/contracts";
import AppIcon from "./AppIcon.vue";

const props = defineProps<{
  jobs: JobResponse[];
}>();

const emit = defineEmits<{
  dismiss: [jobId: string];
  clearFinished: [];
}>();

const hasFinished = computed(() => props.jobs.some((job) => isTerminal(job)));

function isTerminal(job: JobResponse): boolean {
  return job.status === "succeeded" || job.status === "failed";
}

function percentage(job: JobResponse): number | undefined {
  if (job.bytesReceived === undefined || job.bytesTotal === undefined || job.bytesTotal <= 0) {
    return undefined;
  }
  return Math.min(100, Math.round((job.bytesReceived / job.bytesTotal) * 100));
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function progressText(job: JobResponse): string | undefined {
  if (job.bytesReceived === undefined) {
    return undefined;
  }
  const received = formatBytes(job.bytesReceived);
  return job.bytesTotal === undefined ? received : `${received} / ${formatBytes(job.bytesTotal)}`;
}

function statusLabel(job: JobResponse): string {
  if (job.status === "succeeded") {
    return "Installed";
  }
  if (job.status === "failed") {
    return "Failed";
  }
  if (job.status === "queued") {
    return "Queued";
  }
  return job.phase.charAt(0).toUpperCase() + job.phase.slice(1);
}
</script>

<template>
  <aside
    v-if="jobs.length > 0"
    class="fixed inset-x-0 bottom-0 z-30 border-t border-line-strong bg-hull/95 backdrop-blur md:left-60"
    aria-label="Install queue"
    data-testid="install-queue"
  >
    <div class="mx-auto max-w-6xl px-4 py-4 md:px-10">
      <div class="flex items-center justify-between gap-4">
        <h2 class="panel-title">Install queue <span class="readout text-[13px] text-muted">{{ jobs.length }}</span></h2>
        <button v-if="hasFinished" type="button" class="btn btn-secondary btn-sm" @click="emit('clearFinished')">
          Clear finished
        </button>
      </div>
      <ul class="mt-3 max-h-56 space-y-2 overflow-y-auto" aria-live="polite">
        <li
          v-for="job in jobs"
          :key="job.jobId"
          class="rounded-md border bg-panel px-4 py-3"
          :class="{
            'border-line': !isTerminal(job),
            'border-ok/40': job.status === 'succeeded',
            'border-danger/50': job.status === 'failed',
          }"
          :data-job-id="job.jobId"
        >
          <div class="flex items-start gap-3">
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <p class="font-medium">
                  {{ job.identifier }}
                  <span v-if="job.version" class="readout text-[13px] text-muted">{{ job.version }}</span>
                </p>
                <p
                  class="flex items-center gap-2 text-[13px] font-medium"
                  :class="job.status === 'failed' ? 'text-danger' : job.status === 'succeeded' ? 'text-ok' : 'text-accent'"
                >
                  <span class="status-light" aria-hidden="true" />
                  {{ statusLabel(job) }}
                </p>
              </div>
              <p class="mt-1 text-sm" :class="job.status === 'failed' ? 'text-danger' : 'text-muted'">
                {{ job.error ?? job.message ?? statusLabel(job) }}
              </p>
              <div v-if="!isTerminal(job)" class="mt-2 flex items-center gap-3">
                <progress
                  class="h-1.5 min-w-0 flex-1 accent-accent"
                  :value="percentage(job)"
                  :max="percentage(job) === undefined ? undefined : 100"
                  :aria-label="`Install progress for ${job.identifier}`"
                />
                <span v-if="percentage(job) !== undefined" class="readout text-[13px]">{{ percentage(job) }}%</span>
                <span v-else-if="progressText(job) !== undefined" class="readout text-[13px] text-muted">
                  {{ progressText(job) }}
                </span>
              </div>
            </div>
            <button
              v-if="isTerminal(job)"
              type="button"
              class="btn btn-icon btn-sm w-8"
              :aria-label="`Dismiss ${job.identifier} install`"
              @click="emit('dismiss', job.jobId)"
            >
              <AppIcon name="close" />
            </button>
          </div>
        </li>
      </ul>
    </div>
  </aside>
</template>
