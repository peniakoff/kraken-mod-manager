<script setup lang="ts">
import { computed } from "vue";
import type { JobResponse } from "@kraken/contracts";

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
    class="fixed inset-x-0 bottom-0 z-30 border-t border-slate-700 bg-slate-950/95 shadow-2xl backdrop-blur"
    aria-label="Install queue"
    data-testid="install-queue"
  >
    <div class="mx-auto max-w-5xl px-6 py-4">
      <div class="flex items-center justify-between gap-4">
        <h2 class="font-semibold">Install queue <span class="text-sm text-slate-400">({{ jobs.length }})</span></h2>
        <button
          v-if="hasFinished"
          type="button"
          class="rounded-md border border-slate-600 px-3 py-1 text-xs font-semibold text-slate-300 hover:bg-slate-800"
          @click="emit('clearFinished')"
        >
          Clear finished
        </button>
      </div>
      <ul class="mt-3 max-h-56 space-y-2 overflow-y-auto" aria-live="polite">
        <li
          v-for="job in jobs"
          :key="job.jobId"
          class="rounded-lg border px-3 py-2"
          :class="{
            'border-slate-700 bg-slate-900': !isTerminal(job),
            'border-emerald-700 bg-emerald-950/40': job.status === 'succeeded',
            'border-rose-700 bg-rose-950/40': job.status === 'failed',
          }"
          :data-job-id="job.jobId"
        >
          <div class="flex items-start gap-3">
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <p class="font-semibold">
                  {{ job.identifier }}
                  <span v-if="job.version" class="font-mono text-xs text-slate-400">{{ job.version }}</span>
                </p>
                <p class="text-xs font-semibold uppercase tracking-wide" :class="job.status === 'failed' ? 'text-rose-300' : job.status === 'succeeded' ? 'text-emerald-300' : 'text-cyan-300'">
                  {{ statusLabel(job) }}
                </p>
              </div>
              <p class="mt-1 text-sm" :class="job.status === 'failed' ? 'text-rose-200' : 'text-slate-300'">
                {{ job.error ?? job.message ?? statusLabel(job) }}
              </p>
              <div v-if="!isTerminal(job)" class="mt-2 flex items-center gap-3">
                <progress
                  class="h-2 min-w-0 flex-1 accent-cyan-400"
                  :value="percentage(job)"
                  :max="percentage(job) === undefined ? undefined : 100"
                  :aria-label="`Install progress for ${job.identifier}`"
                />
                <span v-if="percentage(job) !== undefined" class="text-xs tabular-nums text-slate-300">
                  {{ percentage(job) }}%
                </span>
                <span v-else-if="progressText(job) !== undefined" class="text-xs tabular-nums text-slate-400">
                  {{ progressText(job) }}
                </span>
              </div>
              <p class="mt-1 font-mono text-[11px] text-slate-500">Job {{ job.jobId }}</p>
            </div>
            <button
              v-if="isTerminal(job)"
              type="button"
              class="rounded px-2 py-1 text-sm text-slate-400 hover:bg-slate-800 hover:text-slate-100"
              :aria-label="`Dismiss ${job.identifier} install`"
              @click="emit('dismiss', job.jobId)"
            >
              Dismiss
            </button>
          </div>
        </li>
      </ul>
    </div>
  </aside>
</template>
