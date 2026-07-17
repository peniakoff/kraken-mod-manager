import type { JobResponse, JobProgressEvent } from "@kraken/contracts";

type JobListener = (event: JobProgressEvent) => void;

export interface InstallJob extends JobResponse {
  listeners: Set<JobListener>;
}

export class JobStore {
  private readonly jobs = new Map<string, InstallJob>();

  create(identifier: string, version?: string): InstallJob {
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
