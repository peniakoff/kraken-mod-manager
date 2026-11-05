import { isSafeArchivePath, normalizeSlashPath } from "@kraken/core";
import { Transform, type Readable } from "node:stream";
import { openPromise, type Entry, type ZipFile } from "yauzl";

/**
 * Whole-archive uncompressed cap. Entries are streamed to disk, so this
 * bounds disk use against zip bombs, not memory.
 */
export const MAX_ZIP_TOTAL_BYTES = 8 * 1024 * 1024 * 1024;
export const MAX_ZIP_ENTRIES = 50_000;

export interface ZipEntryInfo {
  /** Normalized path used for install mapping. */
  path: string;
  /** Name as yauzl decodes it from the archive. */
  rawPath: string;
  /** Uncompressed size from the central directory. */
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
  /** Lists file entries and enforces path, count and declared-size limits without decompressing anything. */
  async listEntries(archivePath: string): Promise<ZipEntryInfo[]> {
    const byRawPath = new Map<string, ZipEntryInfo>();
    let count = 0;
    let declaredBytes = 0;
    await forEachEntry(archivePath, async (entry) => {
      count += 1;
      if (count > MAX_ZIP_ENTRIES) {
        throw new ZipArchiveError(`ZIP archive has too many entries (${count} > ${MAX_ZIP_ENTRIES}).`, "ZIP_TOO_LARGE");
      }
      declaredBytes += entry.uncompressedSize;
      checkTotalSize(declaredBytes);

      const rawPath = entry.fileName;
      const path = normalizeSlashPath(rawPath);
      if (path.length === 0 || path.endsWith("/")) {
        return;
      }
      if (!isSafeArchivePath(rawPath) || !isSafeArchivePath(path)) {
        throw new ZipArchiveError(`ZIP entry path is unsafe: ${rawPath}`, "ZIP_SLIP");
      }
      // A duplicated name keeps its last record, as extraction overwrites it.
      byRawPath.set(rawPath, { path, rawPath, size: entry.uncompressedSize });
    });
    return [...byRawPath.values()];
  }

  /**
   * Streams each selected entry, in archive order, to `onEntry`, which must
   * consume the stream fully before it resolves. Memory use does not depend
   * on entry size. Real sizes are checked against the declared ones (yauzl)
   * and against the total cap, and such failures surface as ZipArchiveError.
   * Errors thrown by `onEntry` itself propagate unchanged.
   */
  async extractEntries(
    archivePath: string,
    entries: readonly ZipEntryInfo[],
    onEntry: (entry: ZipEntryInfo, source: Readable) => Promise<void>,
  ): Promise<void> {
    const wanted = new Map(entries.map((entry) => [entry.rawPath, entry]));
    const extracted = new Set<string>();
    let extractedBytes = 0;

    await forEachEntry(archivePath, async (entry, zipFile) => {
      const info = wanted.get(entry.fileName);
      if (info === undefined) {
        return;
      }
      let raw: Readable;
      try {
        raw = await zipFile.openReadStreamPromise(entry);
      } catch (error: unknown) {
        throw new ZipArchiveError(`Could not read ZIP entry ${info.rawPath}: ${getErrorMessage(error)}`, "INVALID_ZIP");
      }

      const counted = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          extractedBytes += chunk.byteLength;
          if (extractedBytes > MAX_ZIP_TOTAL_BYTES) {
            callback(
              new ZipArchiveError(
                `ZIP archive exceeds total extracted size limit (${extractedBytes} bytes > ${MAX_ZIP_TOTAL_BYTES} bytes).`,
                "ZIP_TOO_LARGE",
              ),
            );
            return;
          }
          callback(null, chunk);
        },
      });
      // pipe() does not forward source errors; yauzl reports size mismatches
      // and corrupt data on the raw stream, so pass them on as ZIP errors.
      raw.on("error", (error: unknown) => {
        counted.destroy(
          new ZipArchiveError(`Could not read ZIP entry ${info.rawPath}: ${getErrorMessage(error)}`, "INVALID_ZIP"),
        );
      });
      raw.pipe(counted);

      try {
        await onEntry(info, counted);
      } finally {
        raw.destroy();
      }
      extracted.add(info.rawPath);
    });

    const missing = entries.filter((entry) => !extracted.has(entry.rawPath));
    if (missing.length > 0) {
      throw new ZipArchiveError(
        `ZIP archive has no entry ${missing.map((entry) => entry.rawPath).join(", ")}.`,
        "INVALID_ZIP",
      );
    }
  }
}

async function forEachEntry(
  archivePath: string,
  visit: (entry: Entry, zipFile: ZipFile) => Promise<void>,
): Promise<void> {
  let zipFile: ZipFile;
  try {
    zipFile = await openPromise(archivePath, {
      lazyEntries: true,
      autoClose: false,
      validateEntrySizes: true,
      strictFileNames: false,
    });
  } catch (error: unknown) {
    throw toZipError(error);
  }

  try {
    const iterator = zipFile.eachEntry();
    for (;;) {
      let next: IteratorResult<Entry>;
      try {
        next = await iterator.next();
      } catch (error: unknown) {
        throw toZipError(error);
      }
      if (next.done === true) {
        break;
      }
      await visit(next.value, zipFile);
    }
  } finally {
    zipFile.close();
  }
}

/** Maps yauzl's errors; its own file-name validation rejects the same paths as the Zip Slip check. */
function toZipError(error: unknown): ZipArchiveError {
  if (error instanceof ZipArchiveError) {
    return error;
  }
  const message = getErrorMessage(error);
  if (/^(invalid relative path|absolute path|invalid characters in fileName):/.test(message)) {
    return new ZipArchiveError(`ZIP entry path is unsafe: ${message}`, "ZIP_SLIP");
  }
  return new ZipArchiveError(`Could not read ZIP archive: ${message}`, "INVALID_ZIP");
}

function checkTotalSize(bytes: number): void {
  if (bytes > MAX_ZIP_TOTAL_BYTES) {
    throw new ZipArchiveError(
      `ZIP archive exceeds total size limit (${bytes} bytes > ${MAX_ZIP_TOTAL_BYTES} bytes).`,
      "ZIP_TOO_LARGE",
    );
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
