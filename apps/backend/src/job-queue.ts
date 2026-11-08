interface QueuedJob {
  jobId: string;
  run: () => Promise<void>;
}

/** FIFO queue that runs one job at a time. */
export class JobQueue {
  private readonly waiting: QueuedJob[] = [];
  private runningJobId: string | undefined;
  private idleWaiters: Array<() => void> = [];

  enqueue(jobId: string, run: () => Promise<void>): void {
    this.waiting.push({ jobId, run });
    this.pump();
  }

  /** Removes a job that has not started yet; returns false for running or unknown jobs. */
  cancel(jobId: string): boolean {
    const index = this.waiting.findIndex((entry) => entry.jobId === jobId);
    if (index === -1) {
      return false;
    }
    this.waiting.splice(index, 1);
    return true;
  }

  isRunning(jobId: string): boolean {
    return this.runningJobId === jobId;
  }

  /** Resolves when nothing is running or waiting. */
  idle(): Promise<void> {
    if (this.runningJobId === undefined && this.waiting.length === 0) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.idleWaiters.push(resolve);
    });
  }

  private pump(): void {
    if (this.runningJobId !== undefined) {
      return;
    }
    // Shift and mark running in one synchronous step so cancel() sees either
    // a waiting job or a running one, never a gap.
    const next = this.waiting.shift();
    if (next === undefined) {
      const waiters = this.idleWaiters;
      this.idleWaiters = [];
      for (const resolve of waiters) {
        resolve();
      }
      return;
    }
    this.runningJobId = next.jobId;
    void this.execute(next);
  }

  private async execute(entry: QueuedJob): Promise<void> {
    try {
      await entry.run();
    } catch (error) {
      console.error(`Job ${entry.jobId} failed unexpectedly.`, error);
    } finally {
      this.runningJobId = undefined;
      this.pump();
    }
  }
}
