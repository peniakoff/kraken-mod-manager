import { computed, onUnmounted, ref } from "vue";
import type { JobProgressEvent, JobResponse } from "@kraken/contracts";
import { clearFinishedJobs, listJobs, removeJob, watchJobProgress } from "./api.js";

export type BusyState = "queued" | "installing" | "uninstalling";

type JobQueueOptions = {
  onSucceeded: (job: JobResponse) => void;
  onFailed: (job: JobResponse) => void;
  /** Called when the job list cannot be reloaded after a stream error. */
  onLoadError?: (error: unknown) => void;
};

/** Frontend mirror of `moduleIdentifierKey` from `@kraken/core`. */
export function moduleIdentifierKey(identifier: string): string {
  return identifier.trim().toLowerCase();
}

function isTerminal(job: JobResponse): boolean {
  return job.status === "succeeded" || job.status === "failed";
}

/** Mirrors the server job queue: it survives reloads because `load()` restores it. */
export function useJobQueue(options: JobQueueOptions) {
  const jobs = ref<JobResponse[]>([]);
  const watchers = new Map<string, () => void>();

  const busy = computed(() => {
    const result = new Map<string, BusyState>();
    const mark = (identifier: string, state: BusyState): void => {
      const key = moduleIdentifierKey(identifier);
      // A running job outranks a queued one for the same module.
      if (result.get(key) === undefined || state !== "queued") {
        result.set(key, state);
      }
    };
    for (const job of jobs.value) {
      if (isTerminal(job)) {
        continue;
      }
      const state: BusyState =
        job.status === "queued" ? "queued" : job.kind === "uninstall" ? "uninstalling" : "installing";
      mark(job.identifier, state);
      if (job.kind === "uninstall") {
        for (const identifier of job.alsoRemove ?? []) {
          mark(identifier, state);
        }
      }
    }
    return result;
  });

  function stopWatching(jobId: string): void {
    watchers.get(jobId)?.();
    watchers.delete(jobId);
  }

  function notifyFinished(job: JobResponse): void {
    if (job.status === "succeeded") {
      options.onSucceeded(job);
    } else {
      options.onFailed(job);
    }
  }

  function updateJob(event: JobProgressEvent): void {
    const index = jobs.value.findIndex((job) => job.jobId === event.jobId);
    const current = jobs.value[index];
    if (current === undefined) {
      return;
    }

    const updated: JobResponse = { ...current, ...event };
    jobs.value[index] = updated;

    if (isTerminal(updated)) {
      stopWatching(updated.jobId);
      notifyFinished(updated);
    }
  }

  function watch(job: JobResponse): void {
    watchers.set(
      job.jobId,
      watchJobProgress(job.jobId, updateJob, () => {
        void reloadAfterStreamError();
      }),
    );
  }

  async function reloadAfterStreamError(): Promise<void> {
    try {
      await load();
    } catch (error) {
      options.onLoadError?.(error);
    }
  }

  async function load(): Promise<void> {
    const { jobs: loaded } = await listJobs();
    const previous = new Map(jobs.value.map((job) => [job.jobId, job]));

    for (const jobId of watchers.keys()) {
      stopWatching(jobId);
    }
    jobs.value = loaded;

    for (const job of loaded) {
      const before = previous.get(job.jobId);
      if (!isTerminal(job)) {
        watch(job);
      } else if (before !== undefined && !isTerminal(before)) {
        // Finished while its stream was down; jobs that were already finished
        // when first loaded are not announced.
        notifyFinished(job);
      }
    }
  }

  function add(job: JobResponse): void {
    if (jobs.value.some((item) => item.jobId === job.jobId)) {
      return;
    }

    jobs.value.push(job);
    if (isTerminal(job)) {
      notifyFinished(job);
      return;
    }

    watch(job);
  }

  async function remove(jobId: string): Promise<void> {
    await removeJob(jobId);
    stopWatching(jobId);
    jobs.value = jobs.value.filter((item) => item.jobId !== jobId);
  }

  async function clearFinished(): Promise<void> {
    await clearFinishedJobs();
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

  return { jobs, busy, load, add, remove, clearFinished };
}
