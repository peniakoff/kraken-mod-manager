import type { ArchiveEntry, ArchivePort } from "@kraken/core";
import { gunzipSync } from "node:zlib";

const USTAR_BLOCK_SIZE = 512;
const MAX_CKAN_FILE_BYTES = 2 * 1024 * 1024;
const MAX_CKAN_FILES = 100_000;

export class ArchiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArchiveError";
  }
}

export class TarGzArchive implements ArchivePort {
  async extractCkanFiles(archive: Uint8Array): Promise<ArchiveEntry[]> {
    let tarBytes: Buffer;
    try {
      tarBytes = gunzipSync(archive);
    } catch (error: unknown) {
      throw new ArchiveError(`Could not decompress metadata archive: ${error instanceof Error ? error.message : String(error)}`);
    }

    return extractCkanEntriesFromTar(tarBytes);
  }
}

export function extractCkanEntriesFromTar(tarBytes: Buffer): ArchiveEntry[] {
  const entries: ArchiveEntry[] = [];
  let offset = 0;

  while (offset + USTAR_BLOCK_SIZE <= tarBytes.length) {
    const header = tarBytes.subarray(offset, offset + USTAR_BLOCK_SIZE);
    offset += USTAR_BLOCK_SIZE;

    if (isZeroBlock(header)) {
      break;
    }

    const name = readTarString(header, 0, 100);
    const size = parseOctal(readTarString(header, 124, 12));
    const typeFlag = header[156] === 0 ? 0 : header[156]!;
    const prefix = readTarString(header, 345, 155);
    const path = prefix.length > 0 ? `${prefix}/${name}` : name;
    const dataBlocks = Math.ceil(size / USTAR_BLOCK_SIZE);
    const dataEnd = offset + dataBlocks * USTAR_BLOCK_SIZE;

    if (dataEnd > tarBytes.length) {
      throw new ArchiveError("Metadata archive is truncated.");
    }

    const isRegularFile = typeFlag === 0 || typeFlag === 48; /* '0' */
    if (isRegularFile && path.toLowerCase().endsWith(".ckan")) {
      if (size > MAX_CKAN_FILE_BYTES) {
        throw new ArchiveError(`CKAN metadata file is too large: ${path}`);
      }
      if (entries.length >= MAX_CKAN_FILES) {
        throw new ArchiveError("Metadata archive contains too many .ckan files.");
      }
      const content = tarBytes.subarray(offset, offset + size).toString("utf8");
      entries.push({ path, content });
    }

    offset = dataEnd;
  }

  return entries;
}

function isZeroBlock(block: Buffer): boolean {
  for (const byte of block) {
    if (byte !== 0) {
      return false;
    }
  }
  return true;
}

function readTarString(block: Buffer, start: number, length: number): string {
  const slice = block.subarray(start, start + length);
  const nullIndex = slice.indexOf(0);
  const end = nullIndex === -1 ? slice.length : nullIndex;
  return slice.subarray(0, end).toString("utf8").trim();
}

function parseOctal(value: string): number {
  const trimmed = value.replaceAll("\0", "").trim();
  if (trimmed.length === 0) {
    return 0;
  }
  const parsed = Number.parseInt(trimmed, 8);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new ArchiveError("Metadata archive contains an invalid tar header.");
  }
  return parsed;
}

/** Test helper: pack UTF-8 file entries into an uncompressed ustar archive. */
export function packUstar(files: Array<{ path: string; content: string }>): Buffer {
  const chunks: Buffer[] = [];
  for (const file of files) {
    const content = Buffer.from(file.content, "utf8");
    const header = Buffer.alloc(USTAR_BLOCK_SIZE, 0);
    const name = file.path.length <= 100 ? file.path : file.path.slice(-100);
    header.write(name, 0, 100, "utf8");
    header.write("0000644\0", 100, 8, "utf8");
    header.write("0000000\0", 108, 8, "utf8");
    header.write("0000000\0", 116, 8, "utf8");
    header.write(`${content.length.toString(8).padStart(11, "0")}\0`, 124, 12, "utf8");
    header.write("00000000000\0", 136, 12, "utf8");
    header[156] = 48; // '0' regular file
    header.write("ustar\0", 257, 6, "utf8");
    header.write("00", 263, 2, "utf8");

    let checksum = 0;
    for (let index = 0; index < USTAR_BLOCK_SIZE; index += 1) {
      checksum += index >= 148 && index < 156 ? 32 : header[index]!;
    }
    header.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148, 8, "utf8");

    chunks.push(header);
    chunks.push(content);
    const padding = (USTAR_BLOCK_SIZE - (content.length % USTAR_BLOCK_SIZE)) % USTAR_BLOCK_SIZE;
    if (padding > 0) {
      chunks.push(Buffer.alloc(padding, 0));
    }
  }
  chunks.push(Buffer.alloc(USTAR_BLOCK_SIZE * 2, 0));
  return Buffer.concat(chunks);
}
