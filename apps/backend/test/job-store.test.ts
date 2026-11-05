import { describe, expect, it } from "vitest";
import { JobStore, MAX_FINISHED_JOBS } from "../src/job-store.js";

describe("JobStore", () => {
  it("keeps only the most recent finished jobs and never drops active ones", () => {
    expect(MAX_FINISHED_JOBS).toBe(50);
    const store = new JobStore();
    const active = store.create("Active");
    store.update(active.jobId, { status: "running" });
    const finished: string[] = [];
    for (let index = 0; index < 55; index += 1) {
      const job = store.create(`Mod${index}`);
      store.update(job.jobId, { status: index % 2 === 0 ? "succeeded" : "failed" });
      finished.push(job.jobId);
    }
    store.create("Queued");

    expect(store.get(active.jobId)).toBeDefined();
    for (const jobId of finished.slice(0, 5)) {
      expect(store.get(jobId)).toBeUndefined();
    }
    expect(finished.slice(5).every((jobId) => store.get(jobId) !== undefined)).toBe(true);
  });
});
