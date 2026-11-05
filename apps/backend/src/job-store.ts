import type { JobResponse, JobProgressEvent } from "@kraken/contracts";

type JobListener = (event: JobProgressEvent) => void;

export interface InstallJob extends JobResponse {
  listeners: Set<JobListener>;
}

/** Finished jobs kept for status lookups; older ones are dropped so memory stays bounded. */
export const MAX_FINISHED_JOBS = 50;

export class JobStore {
  private readonly jobs = new Map<string, InstallJob>();

  create(identifier: string, version?: string): InstallJob {
    this.pruneFinishedJobs();
    const jobId = globalThis.crypto.randomUUID();
    const job: InstallJob = {
      jobId,
      kind: "install",
      identifier,
      status: "queued",
      phase: "queued",
      listeners: new Set(),
    };
    if (version !== undefined) {
      job.version = version;
    }
    this.jobs.set(jobId, job);
    return job;
  }

  /** True while any job is queued or running. */
  hasActiveJobs(): boolean {
    return [...this.jobs.values()].some((job) => job.status === "queued" || job.status === "running");
  }

  /** Drops the oldest finished jobs beyond the cap; Map order is creation order. */
  private pruneFinishedJobs(): void {
    const finished = [...this.jobs.values()].filter((job) => job.status === "succeeded" || job.status === "failed");
    for (const job of finished.slice(0, Math.max(0, finished.length - MAX_FINISHED_JOBS))) {
      this.jobs.delete(job.jobId);
    }
  }

  get(jobId: string): InstallJob | undefined {
    return this.jobs.get(jobId);
  }

  update(
    jobId: string,
    patch: Partial<Pick<JobResponse, "status" | "phase" | "message" | "bytesReceived" | "bytesTotal" | "error" | "version">>,
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
    return response;
  }
}
