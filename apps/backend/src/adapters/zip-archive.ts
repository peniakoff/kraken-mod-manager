import { unzipSync } from "fflate";
import { isSafeArchivePath, normalizeSlashPath } from "@kraken/core";

/** Per-file uncompressed cap (headroom for large texture atlases). */
export const MAX_ZIP_ENTRY_BYTES = 256 * 1024 * 1024;
/**
 * Whole-archive uncompressed cap. Entries are extracted in batches, so this
 * bounds disk use against zip bombs, not memory; texture packs such as
 * Parallax-StockTextures exceed 2 GiB.
 */
export const MAX_ZIP_TOTAL_BYTES = 8 * 1024 * 1024 * 1024;
export const MAX_ZIP_ENTRIES = 50_000;
/** Uncompressed bytes decompressed into memory at once during extraction. */
export const ZIP_EXTRACT_BATCH_BYTES = MAX_ZIP_ENTRY_BYTES;

export interface ZipEntryInfo {
  /** Normalized path used for install mapping. */
  path: string;
  /** Name exactly as stored in the archive. */
  rawPath: string;
  /** Uncompressed size declared by the archive; not trusted for limits on real data. */
  size: number;
}

export class ZipArchiveError extends Error {
  constructor(
    message: string,
    readonly code: "INVALID_ZIP" | "ZIP_SLIP" | "ZIP_TOO_LARGE",
  ) {
    super(message);
    this.name = "ZipArchiveError";
  }
}

export class ZipArchive {
  /** Lists file entries and enforces path and declared-size limits without decompressing anything. */
  listEntries(archive: Uint8Array): ZipEntryInfo[] {
    const declared: Array<{ rawPath: string; size: number }> = [];
    let declaredBytes = 0;
    readArchive(archive, (file) => {
      if (!Number.isSafeInteger(file.originalSize) || file.originalSize < 0) {
        throw new ZipArchiveError(`ZIP entry has an invalid size: ${file.name}`, "ZIP_TOO_LARGE");
      }
      checkEntrySize(file.name, file.originalSize);
      declaredBytes += file.originalSize;
      if (declared.length + 1 > MAX_ZIP_ENTRIES) {
        throw new ZipArchiveError(
          `ZIP archive has too many entries (${declared.length + 1} > ${MAX_ZIP_ENTRIES}).`,
          "ZIP_TOO_LARGE",
        );
      }
      checkTotalSize(declaredBytes);
      declared.push({ rawPath: file.name, size: file.originalSize });
      return false;
    });

    // A duplicated name keeps its last record, as decompression does.
    const byRawPath = new Map<string, ZipEntryInfo>();
    for (const { rawPath, size } of declared) {
      const path = normalizeSlashPath(rawPath);
      if (path.length === 0 || path.endsWith("/")) {
        continue;
      }
      if (!isSafeArchivePath(rawPath) || !isSafeArchivePath(path)) {
        throw new ZipArchiveError(`ZIP entry path is unsafe: ${rawPath}`, "ZIP_SLIP");
      }
      byRawPath.set(rawPath, { path, rawPath, size });
    }
    return [...byRawPath.values()];
  }

  /**
   * Decompresses `entries` a batch at a time and hands each one to `onEntry`
   * before the next batch, so memory holds the archive plus one batch rather
   * than the whole uncompressed archive. Limits are re-checked on the real
   * data, since declared sizes can lie. Errors from `onEntry` propagate as is.
   */
  async extractEntries(
    archive: Uint8Array,
    entries: readonly ZipEntryInfo[],
    onEntry: (entry: ZipEntryInfo, data: Uint8Array) => Promise<void>,
    batchBytes: number = ZIP_EXTRACT_BATCH_BYTES,
  ): Promise<void> {
    let extractedBytes = 0;
    for (const batch of toBatches(entries, batchBytes)) {
      const wanted = new Set(batch.map((entry) => entry.rawPath));
      const data = readArchive(archive, (file) => wanted.has(file.name));
      for (const entry of batch) {
        const content = data[entry.rawPath];
        if (content === undefined) {
          throw new ZipArchiveError(`ZIP archive has no entry ${entry.rawPath}.`, "INVALID_ZIP");
        }
        checkEntrySize(entry.rawPath, content.byteLength);
        extractedBytes += content.byteLength;
        checkTotalSize(extractedBytes);
        await onEntry(entry, content);
        // Drop the reference so the batch can be collected as it is written out.
        delete data[entry.rawPath];
      }
    }
  }
}

function readArchive(
  archive: Uint8Array,
  filter: (file: { name: string; originalSize: number }) => boolean,
): Record<string, Uint8Array> {
  try {
    return unzipSync(archive, { filter });
  } catch (error: unknown) {
    if (error instanceof ZipArchiveError) {
      throw error;
    }
    throw new ZipArchiveError(
      `Could not read ZIP archive: ${error instanceof Error ? error.message : String(error)}`,
      "INVALID_ZIP",
    );
  }
}

function checkEntrySize(name: string, bytes: number): void {
  if (bytes > MAX_ZIP_ENTRY_BYTES) {
    throw new ZipArchiveError(
      `ZIP entry exceeds size limit: ${name} (${bytes} bytes > ${MAX_ZIP_ENTRY_BYTES} bytes).`,
      "ZIP_TOO_LARGE",
    );
  }
}

function checkTotalSize(bytes: number): void {
  if (bytes > MAX_ZIP_TOTAL_BYTES) {
    throw new ZipArchiveError(
      `ZIP archive exceeds total size limit (${bytes} bytes > ${MAX_ZIP_TOTAL_BYTES} bytes).`,
      "ZIP_TOO_LARGE",
    );
  }
}

/** Groups entries so each batch declares at most `batchBytes`; a larger single entry gets its own batch. */
function toBatches(entries: readonly ZipEntryInfo[], batchBytes: number): ZipEntryInfo[][] {
  const batches: ZipEntryInfo[][] = [];
  let current: ZipEntryInfo[] = [];
  let currentBytes = 0;
  for (const entry of entries) {
    if (current.length > 0 && currentBytes + entry.size > batchBytes) {
      batches.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(entry);
    currentBytes += entry.size;
  }
  if (current.length > 0) {
    batches.push(current);
  }
  return batches;
}
