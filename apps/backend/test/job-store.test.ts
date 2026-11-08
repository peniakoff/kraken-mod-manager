import { describe, expect, it } from "vitest";
import { JobStore, MAX_FINISHED_JOBS } from "../src/job-store.js";

describe("JobStore", () => {
  it("keeps only the most recent finished jobs and never drops active ones", () => {
    expect(MAX_FINISHED_JOBS).toBe(50);
    const store = new JobStore();
    const active = store.create("install", "Active");
    store.update(active.jobId, { status: "running" });
    const finished: string[] = [];
    for (let index = 0; index < 55; index += 1) {
      const job = store.create("install", `Mod${index}`);
      store.update(job.jobId, { status: index % 2 === 0 ? "succeeded" : "failed" });
      finished.push(job.jobId);
    }
    store.create("install", "Queued");

    expect(store.get(active.jobId)).toBeDefined();
    for (const jobId of finished.slice(0, 5)) {
      expect(store.get(jobId)).toBeUndefined();
    }
    expect(finished.slice(5).every((jobId) => store.get(jobId) !== undefined)).toBe(true);
  });

  it("lists jobs in order without hidden ones", () => {
    const store = new JobStore();
    const a = store.create("install", "A", { version: "1.0" });
    const b = store.create("uninstall", "B", { alsoRemove: ["C"] });
    const c = store.create("install", "C");
    store.update(b.jobId, { status: "succeeded", removed: ["B", "C"] });
    store.hide(b.jobId);

    const listed = store.list();
    expect(listed.map((job) => job.jobId)).toEqual([a.jobId, c.jobId]);
    expect(listed[0]).toMatchObject({ kind: "install", version: "1.0" });
    expect(store.get(b.jobId)).toBeDefined();
    expect(store.toResponse(b)).toMatchObject({ kind: "uninstall", alsoRemove: ["C"], removed: ["B", "C"] });
  });

  it("hides all finished jobs", () => {
    const store = new JobStore();
    const done = store.create("install", "Done");
    const failed = store.create("install", "Failed");
    const running = store.create("install", "Running");
    const queued = store.create("uninstall", "Queued");
    store.update(done.jobId, { status: "succeeded" });
    store.update(failed.jobId, { status: "failed" });
    store.update(running.jobId, { status: "running" });

    store.hideFinished();

    expect(store.list().map((job) => job.jobId)).toEqual([running.jobId, queued.jobId]);
  });

  it("reports active identifiers including alsoRemove, case-insensitively", () => {
    const store = new JobStore();
    store.create("install", " Alpha ");
    const running = store.create("uninstall", "Beta", { alsoRemove: ["GAMMA"] });
    store.update(running.jobId, { status: "running" });
    const done = store.create("install", "Delta");
    store.update(done.jobId, { status: "succeeded" });

    expect(store.activeIdentifiers()).toEqual(new Set(["alpha", "beta", "gamma"]));
  });

  it("deletes a job", () => {
    const store = new JobStore();
    const job = store.create("install", "A");
    store.delete(job.jobId);
    expect(store.get(job.jobId)).toBeUndefined();
  });
});
