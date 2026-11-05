import { existsSync, statSync, utimesSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InstallJournal, parseInstallJournal } from "../src/adapters/install-journal.js";

const TEN_MINUTES_MS = 10 * 60 * 1000;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function setMtimeBack(path: string): void {
  const past = new Date(Date.now() - TEN_MINUTES_MS);
  utimesSync(path, past, past);
}

describe("InstallJournal", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "kraken-journal-"));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("commits without writing when no module was begun", async () => {
    const path = join(directory, "job.jsonl");

    await new InstallJournal(path).commit();

    expect(existsSync(path)).toBe(false);
  });

  it("refreshes the journal's mtime while it is open and stops after close", async () => {
    const path = join(directory, "job.jsonl");
    const journal = new InstallJournal(path, 20);
    await journal.beginModule({
      identifier: "Mod",
      name: "Mod",
      backupId: "0b1c2d3e-0000-4000-8000-000000000001",
      previousRecord: null,
    });

    setMtimeBack(path);
    await wait(80);
    expect(Math.abs(statSync(path).mtimeMs - Date.now())).toBeLessThan(5000);

    await journal.close();
    // A refresh already in flight when close() ran may still land.
    await wait(20);
    setMtimeBack(path);
    const before = statSync(path).mtimeMs;
    await wait(80);
    expect(statSync(path).mtimeMs).toBe(before);
  });
});

describe("parseInstallJournal", () => {
  it.each([[""], ['{"type":"jour']])("parses content without a complete line (%j) as an empty journal", (contents) => {
    expect(parseInstallJournal(contents, "/p")).toEqual({ committed: false, modules: [] });
  });
});
