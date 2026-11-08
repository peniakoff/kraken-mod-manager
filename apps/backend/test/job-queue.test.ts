import { describe, expect, it, vi } from "vitest";
import { JobQueue } from "../src/job-queue.js";

function deferred(): { promise: Promise<void>; resolve: () => void; reject: (error: Error) => void } {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("JobQueue", () => {
  it("runs jobs one at a time in order", async () => {
    const queue = new JobQueue();
    const order: string[] = [];
    const gates = { a: deferred(), b: deferred(), c: deferred() };
    for (const id of ["a", "b", "c"] as const) {
      queue.enqueue(id, async () => {
        order.push(id);
        await gates[id].promise;
      });
    }
    await Promise.resolve();
    expect(order).toEqual(["a"]);
    gates.a.resolve();
    await vi.waitFor(() => expect(order).toEqual(["a", "b"]));
    gates.b.resolve();
    await vi.waitFor(() => expect(order).toEqual(["a", "b", "c"]));
    gates.c.resolve();
    await queue.idle();
  });

  it("starts the next job after one rejects", async () => {
    const queue = new JobQueue();
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const ran: string[] = [];
    queue.enqueue("a", () => Promise.reject(new Error("boom")));
    queue.enqueue("b", async () => {
      ran.push("b");
    });
    await queue.idle();
    expect(ran).toEqual(["b"]);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it("cancels a waiting job but not a running one", async () => {
    const queue = new JobQueue();
    const gate = deferred();
    const waiting = vi.fn(async () => undefined);
    let finished = false;
    queue.enqueue("a", async () => {
      await gate.promise;
      finished = true;
    });
    queue.enqueue("b", waiting);
    await Promise.resolve();

    expect(queue.isRunning("a")).toBe(true);
    expect(queue.cancel("a")).toBe(false);
    expect(queue.cancel("b")).toBe(true);
    expect(queue.cancel("b")).toBe(false);
    gate.resolve();
    await queue.idle();
    expect(finished).toBe(true);
    expect(waiting).not.toHaveBeenCalled();
    expect(queue.isRunning("a")).toBe(false);
  });
});
