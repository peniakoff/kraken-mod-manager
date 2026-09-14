import { computed, onUnmounted, ref } from "vue";
import type { JobProgressEvent, JobResponse } from "@kraken/contracts";
import { watchJobProgress } from "./api.js";

type InstallQueueOptions = {
  onSucceeded: (job: JobResponse) => void;
  onFailed: (job: JobResponse) => void;
};

function isTerminal(job: JobResponse): boolean {
  return job.status === "succeeded" || job.status === "failed";
}

export function useInstallQueue(options: InstallQueueOptions) {
  const jobs = ref<JobResponse[]>([]);
  const watchers = new Map<string, () => void>();

  const activeIdentifiers = computed(() =>
    jobs.value.filter((job) => !isTerminal(job)).map((job) => job.identifier),
  );

  function stopWatching(jobId: string): void {
    watchers.get(jobId)?.();
    watchers.delete(jobId);
  }

  function updateJob(event: JobProgressEvent): void {
    const index = jobs.value.findIndex((job) => job.jobId === event.jobId);
    if (index === -1) {
      return;
    }

    const current = jobs.value[index]!;
    const updated: JobResponse = { ...current, ...event };
    jobs.value[index] = updated;

    if (isTerminal(updated)) {
      stopWatching(updated.jobId);
      if (updated.status === "succeeded") {
        options.onSucceeded(updated);
      } else {
        options.onFailed(updated);
      }
    }
  }

  function add(job: JobResponse): void {
    if (jobs.value.some((item) => item.jobId === job.jobId)) {
      return;
    }

    jobs.value.push(job);
    if (isTerminal(job)) {
      if (job.status === "succeeded") {
        options.onSucceeded(job);
      } else {
        options.onFailed(job);
      }
      return;
    }

    watchers.set(job.jobId, watchJobProgress(job.jobId, updateJob));
  }

  function dismiss(jobId: string): void {
    const job = jobs.value.find((item) => item.jobId === jobId);
    if (job === undefined || !isTerminal(job)) {
      return;
    }
    stopWatching(jobId);
    jobs.value = jobs.value.filter((item) => item.jobId !== jobId);
  }

  function clearFinished(): void {
    for (const job of jobs.value) {
      if (isTerminal(job)) {
        stopWatching(job.jobId);
      }
    }
    jobs.value = jobs.value.filter((job) => !isTerminal(job));
  }

  onUnmounted(() => {
    for (const stop of watchers.values()) {
      stop();
    }
    watchers.clear();
  });

  return { jobs, activeIdentifiers, add, dismiss, clearFinished };
}
