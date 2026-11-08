import type { JobKind, JobProgressEvent, JobResponse } from "@kraken/contracts";
import { moduleIdentifierKey } from "@kraken/core";

type JobListener = (event: JobProgressEvent) => void;

export interface InstallJob extends JobResponse {
  listeners: Set<JobListener>;
  /** Finished jobs the user dismissed; they stay stored (and count towards pruning) but are not listed. */
  hidden: boolean;
}

/** Finished jobs kept for status lookups; older ones are dropped so memory stays bounded. */
export const MAX_FINISHED_JOBS = 50;

export class JobStore {
  private readonly jobs = new Map<string, InstallJob>();

  create(kind: JobKind, identifier: string, options: { version?: string; alsoRemove?: string[] } = {}): InstallJob {
    this.pruneFinishedJobs();
    const jobId = globalThis.crypto.randomUUID();
    const job: InstallJob = {
      jobId,
      kind,
      identifier,
      status: "queued",
      phase: "queued",
      listeners: new Set(),
      hidden: false,
    };
    if (options.version !== undefined) {
      job.version = options.version;
    }
    if (options.alsoRemove !== undefined) {
      job.alsoRemove = options.alsoRemove;
    }
    this.jobs.set(jobId, job);
    return job;
  }

  /** Visible jobs in creation order. */
  list(): JobResponse[] {
    return [...this.jobs.values()].filter((job) => !job.hidden).map((job) => this.toResponse(job));
  }

  /** Hides a finished job from the list; the caller must check that it is finished. */
  hide(jobId: string): void {
    const job = this.jobs.get(jobId);
    if (job === undefined) {
      throw new Error(`Unknown job: ${jobId}`);
    }
    job.hidden = true;
  }

  delete(jobId: string): void {
    this.jobs.delete(jobId);
  }

  hideFinished(): void {
    for (const job of this.jobs.values()) {
      if (isFinished(job)) {
        job.hidden = true;
      }
    }
  }

  /** Normalized identifiers (targets and alsoRemove) of queued or running jobs. */
  activeIdentifiers(): Set<string> {
    const keys = new Set<string>();
    for (const job of this.jobs.values()) {
      if (isFinished(job)) {
        continue;
      }
      keys.add(moduleIdentifierKey(job.identifier));
      for (const identifier of job.alsoRemove ?? []) {
        keys.add(moduleIdentifierKey(identifier));
      }
    }
    return keys;
  }

  /** Drops the oldest finished jobs beyond the cap; Map order is creation order. */
  private pruneFinishedJobs(): void {
    const finished = [...this.jobs.values()].filter(isFinished);
    for (const job of finished.slice(0, Math.max(0, finished.length - MAX_FINISHED_JOBS))) {
      this.jobs.delete(job.jobId);
    }
  }

  get(jobId: string): InstallJob | undefined {
    return this.jobs.get(jobId);
  }

  update(
    jobId: string,
    patch: Partial<Pick<JobResponse, "status" | "phase" | "message" | "bytesReceived" | "bytesTotal" | "error" | "version" | "removed">>,
  ): InstallJob {
    const job = this.jobs.get(jobId);
    if (job === undefined) {
      throw new Error(`Unknown job: ${jobId}`);
    }
    Object.assign(job, patch);
    const event: JobProgressEvent = {
      jobId: job.jobId,
      phase: job.phase,
      status: job.status,
    };
    if (job.message !== undefined) {
      event.message = job.message;
    }
    if (job.bytesReceived !== undefined) {
      event.bytesReceived = job.bytesReceived;
    }
    if (job.bytesTotal !== undefined) {
      event.bytesTotal = job.bytesTotal;
    }
    if (job.error !== undefined) {
      event.error = job.error;
    }
    for (const listener of job.listeners) {
      listener(event);
    }
    return job;
  }

  subscribe(jobId: string, listener: JobListener): () => void {
    const job = this.jobs.get(jobId);
    if (job === undefined) {
      throw new Error(`Unknown job: ${jobId}`);
    }
    job.listeners.add(listener);
    return () => {
      job.listeners.delete(listener);
    };
  }

  toResponse(job: InstallJob): JobResponse {
    const response: JobResponse = {
      jobId: job.jobId,
      kind: job.kind,
      identifier: job.identifier,
      status: job.status,
      phase: job.phase,
    };
    if (job.version !== undefined) {
      response.version = job.version;
    }
    if (job.message !== undefined) {
      response.message = job.message;
    }
    if (job.bytesReceived !== undefined) {
      response.bytesReceived = job.bytesReceived;
    }
    if (job.bytesTotal !== undefined) {
      response.bytesTotal = job.bytesTotal;
    }
    if (job.error !== undefined) {
      response.error = job.error;
    }
    if (job.alsoRemove !== undefined) {
      response.alsoRemove = job.alsoRemove;
    }
    if (job.removed !== undefined) {
      response.removed = job.removed;
    }
    return response;
  }
}

function isFinished(job: InstallJob): boolean {
  return job.status === "succeeded" || job.status === "failed";
}
