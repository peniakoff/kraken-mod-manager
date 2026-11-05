import type { ManagedModRecord } from "@kraken/core";
import { mkdir, open, readFile, rm, utimes, type FileHandle } from "node:fs/promises";
import { dirname } from "node:path";
import { isManagedModRecord } from "./install-manifest-store.js";

/**
 * Append-only log of one install job, written next to its backups so that an
 * install the process never finished can be undone at the next start.
 *
 * Line order is the contract: a module line is written before that module's
 * previous files move into its backup folder, and a file line before the file
 * is created. Recovery can therefore delete every recorded file and move every
 * backed-up file back without touching anything the job did not write.
 */
export class InstallJournal {
  private handle: FileHandle | undefined;
  private heartbeat: NodeJS.Timeout | undefined;

  constructor(
    readonly path: string,
    private readonly heartbeatMs = JOURNAL_HEARTBEAT_MS,
  ) {}

  /** Records a module before any of its files move; creates the file on first use. */
  async beginModule(module: JournalModuleStart): Promise<void> {
    if (this.handle === undefined) {
      await mkdir(dirname(this.path), { recursive: true });
      this.handle = await open(this.path, "wx", 0o600);
      await this.append({ type: "journal", schemaVersion: JOURNAL_SCHEMA_VERSION, pid: process.pid });
      this.startHeartbeat();
    }
    await this.append({ type: "module", ...module });
    await this.handle.sync();
  }

  /** Records a destination before it is written. */
  async recordFile(relativePath: string): Promise<void> {
    await this.append({ type: "file", path: relativePath });
  }

  /** Marks the whole job as done; from here on recovery only deletes backups. */
  async commit(): Promise<void> {
    if (this.handle === undefined) {
      return;
    }
    await this.append({ type: "committed" });
    await this.handle.sync();
  }

  async close(): Promise<void> {
    clearInterval(this.heartbeat);
    this.heartbeat = undefined;
    const handle = this.handle;
    this.handle = undefined;
    await handle?.close();
  }

  async remove(): Promise<void> {
    await this.close();
    await rm(this.path, { force: true });
  }

  /**
   * Recovery treats a journal with a live pid as foreign only while its mtime
   * is fresh, so a reused pid cannot shield a dead job's journal forever.
   */
  private startHeartbeat(): void {
    this.heartbeat = setInterval(() => {
      const now = new Date();
      utimes(this.path, now, now).catch((error: unknown) => {
        console.warn(`Could not refresh the install journal ${this.path}: ${errorMessage(error)}`);
      });
    }, this.heartbeatMs);
    this.heartbeat.unref();
  }

  private async append(line: JournalLine): Promise<void> {
    if (this.handle === undefined) {
      throw new InstallJournalError(`Install journal ${this.path} is not open.`);
    }
    // One write per line, so a crash can only tear the last line.
    await this.handle.appendFile(`${JSON.stringify(line)}\n`, "utf8");
  }
}

export const JOURNAL_HEARTBEAT_MS = 30_000;

/** A journal untouched for this long is not owned by a running job, whatever its pid says. */
export const JOURNAL_STALE_MS = 120_000;

export interface JournalModuleStart {
  identifier: string;
  name: string;
  /** Name of the module's folder under the backup root. */
  backupId: string;
  /** The manifest record to put back, or null when the mod was not installed. */
  previousRecord: ManagedModRecord | null;
}

export interface JournalModule extends JournalModuleStart {
  /** Destinations the job wrote, in order, possibly with repeats. */
  files: string[];
}

export interface ParsedInstallJournal {
  /** Absent when the crash came before the header was written. */
  pid?: number;
  committed: boolean;
  modules: JournalModule[];
}

export class InstallJournalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InstallJournalError";
  }
}

export function journalFileName(jobId: string): string {
  return `job-${jobId}.jsonl`;
}

/** Matches journal file names and captures the job id. */
export const JOURNAL_FILE_NAME = /^job-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/;

export const BACKUP_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function readInstallJournal(path: string): Promise<ParsedInstallJournal> {
  let contents: string;
  try {
    contents = await readFile(path, "utf8");
  } catch (error: unknown) {
    throw new InstallJournalError(`Could not read install journal ${path}: ${errorMessage(error)}`);
  }
  return parseInstallJournal(contents, path);
}

/**
 * Parses a journal. A last line without its newline was cut off by the crash
 * and is ignored: its write never completed, so the step it announced never
 * started. Anything else that does not match the format rejects the journal.
 */
export function parseInstallJournal(contents: string, path: string): ParsedInstallJournal {
  const lines = contents.split("\n");
  lines.pop();

  const malformed = (index: number, reason: string): InstallJournalError =>
    new InstallJournalError(`Install journal ${path} is malformed at line ${index + 1}: ${reason}`);
  if (lines.length === 0) {
    return { committed: false, modules: [] };
  }
  const parsed: ParsedInstallJournal = { committed: false, modules: [] };

  for (const [index, text] of lines.entries()) {
    let line: unknown;
    try {
      line = JSON.parse(text);
    } catch {
      throw malformed(index, "not JSON");
    }
    if (typeof line !== "object" || line === null || Array.isArray(line)) {
      throw malformed(index, "not an object");
    }
    // Safe: only read through Partial and every field is checked below.
    const entry = line as Partial<Record<string, unknown>>;
    if (index === 0) {
      if (entry.type !== "journal" || entry.schemaVersion !== JOURNAL_SCHEMA_VERSION) {
        throw malformed(index, "unsupported journal header");
      }
      if (typeof entry.pid !== "number" || !Number.isInteger(entry.pid) || entry.pid <= 0) {
        throw malformed(index, "missing process id");
      }
      parsed.pid = entry.pid;
      continue;
    }
    if (parsed.committed) {
      throw malformed(index, "entry after commit");
    }
    switch (entry.type) {
      case "module": {
        const { identifier, name, backupId, previousRecord } = entry;
        if (typeof identifier !== "string" || identifier.length === 0) {
          throw malformed(index, "module without identifier");
        }
        if (typeof name !== "string" || name.length === 0) {
          throw malformed(index, "module without name");
        }
        if (typeof backupId !== "string" || !BACKUP_ID.test(backupId)) {
          throw malformed(index, "invalid backup folder");
        }
        if (previousRecord !== null && !isManagedModRecord(previousRecord)) {
          throw malformed(index, "invalid previous record");
        }
        parsed.modules.push({ identifier, name, backupId, previousRecord, files: [] });
        break;
      }
      case "file": {
        const current = parsed.modules.at(-1);
        if (current === undefined) {
          throw malformed(index, "file before any module");
        }
        if (typeof entry.path !== "string" || entry.path.length === 0) {
          throw malformed(index, "file without path");
        }
        current.files.push(entry.path);
        break;
      }
      case "committed":
        parsed.committed = true;
        break;
      default:
        throw malformed(index, "unknown entry type");
    }
  }
  return parsed;
}

const JOURNAL_SCHEMA_VERSION = 1;

type JournalLine =
  | { type: "journal"; schemaVersion: number; pid: number }
  | ({ type: "module" } & JournalModuleStart)
  | { type: "file"; path: string }
  | { type: "committed" };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
