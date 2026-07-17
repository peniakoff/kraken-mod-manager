import { unzipSync } from "fflate";
import { isSafeArchivePath, normalizeSlashPath } from "@kraken/core";

const MAX_ZIP_ENTRY_BYTES = 50 * 1024 * 1024;
const MAX_ZIP_TOTAL_BYTES = 200 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 50_000;

export interface ZipFileEntry {
  path: string;
  data: Uint8Array;
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
  extractFiles(archive: Uint8Array): ZipFileEntry[] {
    let raw: Record<string, Uint8Array>;
    let declaredEntries = 0;
    let declaredBytes = 0;
    try {
      raw = unzipSync(archive, {
        filter: (file) => {
          if (!Number.isSafeInteger(file.originalSize) || file.originalSize < 0) {
            throw new ZipArchiveError(`ZIP entry has an invalid size: ${file.name}`, "ZIP_TOO_LARGE");
          }
          if (file.originalSize > MAX_ZIP_ENTRY_BYTES) {
            throw new ZipArchiveError(`ZIP entry exceeds size limit: ${file.name}`, "ZIP_TOO_LARGE");
          }
          declaredEntries += 1;
          declaredBytes += file.originalSize;
          if (declaredEntries > MAX_ZIP_ENTRIES || declaredBytes > MAX_ZIP_TOTAL_BYTES) {
            throw new ZipArchiveError("ZIP archive exceeds extraction limits.", "ZIP_TOO_LARGE");
          }
          return true;
        },
      });
    } catch (error: unknown) {
      if (error instanceof ZipArchiveError) {
        throw error;
      }
      throw new ZipArchiveError(
        `Could not read ZIP archive: ${error instanceof Error ? error.message : String(error)}`,
        "INVALID_ZIP",
      );
    }

    const entries: ZipFileEntry[] = [];
    let totalBytes = 0;
    for (const [rawPath, data] of Object.entries(raw)) {
      const path = normalizeSlashPath(rawPath);
      if (path.length === 0 || path.endsWith("/")) {
        continue;
      }
      if (!isSafeArchivePath(rawPath) || !isSafeArchivePath(path)) {
        throw new ZipArchiveError(`ZIP entry path is unsafe: ${rawPath}`, "ZIP_SLIP");
      }
      if (data.byteLength > MAX_ZIP_ENTRY_BYTES) {
        throw new ZipArchiveError(`ZIP entry exceeds size limit: ${path}`, "ZIP_TOO_LARGE");
      }
      totalBytes += data.byteLength;
      if (totalBytes > MAX_ZIP_TOTAL_BYTES) {
        throw new ZipArchiveError("ZIP archive exceeds total extracted size limit.", "ZIP_TOO_LARGE");
      }
      entries.push({ path, data });
      if (entries.length > MAX_ZIP_ENTRIES) {
        throw new ZipArchiveError("ZIP archive has too many entries.", "ZIP_TOO_LARGE");
      }
    }
    return entries;
  }
}
