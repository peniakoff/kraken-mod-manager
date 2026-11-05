import { zipSync } from "fflate";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { MAX_ZIP_TOTAL_BYTES, ZipArchive, ZipArchiveError, type ZipEntryInfo } from "../src/adapters/zip-archive.js";

const encode = (text: string) => new TextEncoder().encode(text);

/** Overwrites the uncompressed size in every central directory record. */
function declareAllSizes(archive: Uint8Array, size: number): Uint8Array {
  const copy = archive.slice();
  const view = new DataView(copy.buffer, copy.byteOffset, copy.byteLength);
  for (let offset = 0; offset <= copy.byteLength - 28; offset += 1) {
    if (view.getUint32(offset, true) === 0x02014b50) {
      view.setUint32(offset + 24, size, true);
    }
  }
  return copy;
}

async function archiveFile(archive: Uint8Array): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "kmm-zip-"));
  const path = join(directory, "archive.zip");
  await writeFile(path, archive);
  return path;
}

async function readAll(source: Readable): Promise<{ data: Uint8Array; chunks: number }> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of source) {
    // Safe: entry streams are byte streams without an encoding, so chunks are Buffers.
    chunks.push(chunk as Uint8Array);
  }
  return { data: new Uint8Array(Buffer.concat(chunks)), chunks: chunks.length };
}

async function extractAll(zip: ZipArchive, path: string, entries: readonly ZipEntryInfo[]) {
  const seen: Array<{ path: string; data: Uint8Array; chunks: number }> = [];
  await zip.extractEntries(path, entries, async (entry, source) => {
    seen.push({ path: entry.path, ...(await readAll(source)) });
  });
  return seen;
}

describe("ZipArchive", () => {
  it("lists file entries with their declared sizes and skips directories", async () => {
    const zip = new ZipArchive();
    const path = await archiveFile(zipSync({ "GameData/Mod/": new Uint8Array(), "GameData/Mod/a.cfg": encode("abc") }));

    expect(await zip.listEntries(path)).toEqual([{ path: "GameData/Mod/a.cfg", rawPath: "GameData/Mod/a.cfg", size: 3 }]);
  });

  it("rejects unsafe paths while listing", async () => {
    const zip = new ZipArchive();
    const path = await archiveFile(zipSync({ "../evil.txt": encode("nope") }));

    await expect(zip.listEntries(path)).rejects.toThrow(/unsafe/i);
    await expect(zip.listEntries(path)).rejects.toMatchObject({ code: "ZIP_SLIP" });
  });

  it("accepts a single entry of about 2 GB, such as a Parallax terrain texture bundle", async () => {
    const zip = new ZipArchive();
    const name = "GameData/Parallax_StockTerrainTextures/parallax-stock-terrain-textures.unity3d";
    const path = await archiveFile(declareAllSizes(zipSync({ [name]: encode("x") }), 2_077_215_939));

    expect(await zip.listEntries(path)).toEqual([{ path: name, rawPath: name, size: 2_077_215_939 }]);
  });

  it("rejects archives that declare more than the total limit", async () => {
    const zip = new ZipArchive();
    const files: Record<string, Uint8Array> = {};
    for (let index = 0; index < 3; index += 1) {
      files[`GameData/Pack/file-${index}.bin`] = encode(`f${index}`);
    }
    // Three entries of almost 4 GiB each exceed the 8 GiB cap.
    const path = await archiveFile(declareAllSizes(zipSync(files), 0xfffffffe));

    expect(MAX_ZIP_TOTAL_BYTES).toBe(8 * 1024 * 1024 * 1024);
    await expect(zip.listEntries(path)).rejects.toThrow(/total size limit/i);
  });

  it("streams the selected entries in archive order", async () => {
    const zip = new ZipArchive();
    const big = new Uint8Array(3 * 1024 * 1024).map((_, index) => index % 251);
    const files = { "GameData/Mod/a.cfg": encode("abc"), "GameData/Mod/big.bin": big, "GameData/Mod/skip.cfg": encode("no") };
    const path = await archiveFile(zipSync(files));
    const selected = (await zip.listEntries(path)).filter((entry) => !entry.path.endsWith("skip.cfg"));

    const seen = await extractAll(zip, path, selected);

    expect(seen.map((entry) => entry.path)).toEqual(["GameData/Mod/a.cfg", "GameData/Mod/big.bin"]);
    expect(seen[0]?.data).toEqual(files["GameData/Mod/a.cfg"]);
    // Buffer.equals: a deep toEqual over 3 million elements takes seconds.
    expect(Buffer.from(seen[1]?.data ?? []).equals(Buffer.from(big))).toBe(true);
    // A multi-megabyte entry arrives in pieces instead of one buffer.
    expect(seen[1]?.chunks).toBeGreaterThan(1);
  });

  it("rejects an entry whose content is larger than it declares", async () => {
    const zip = new ZipArchive();
    const path = await archiveFile(declareAllSizes(zipSync({ "GameData/Mod/a.cfg": encode("hello world") }), 1));

    const result = extractAll(zip, path, await zip.listEntries(path));

    await expect(result).rejects.toBeInstanceOf(ZipArchiveError);
    await expect(extractAll(zip, path, await zip.listEntries(path))).rejects.toThrow(/GameData\/Mod\/a\.cfg/);
  });

  it("reports a corrupt entry to a consumer that starts reading late", async () => {
    const zip = new ZipArchive();
    const path = await archiveFile(declareAllSizes(zipSync({ "GameData/Mod/a.cfg": encode("hello world") }), 1));

    const result = zip.extractEntries(path, await zip.listEntries(path), async (_entry, source) => {
      // Mimics a consumer that prepares the destination folder first.
      await new Promise((resolve) => setTimeout(resolve, 50));
      await readAll(source);
    });

    await expect(result).rejects.toMatchObject({ name: "ZipArchiveError", code: "INVALID_ZIP" });
  });

  it("fails loudly when a selected entry is not in the archive", async () => {
    const zip = new ZipArchive();
    const path = await archiveFile(zipSync({ "GameData/Mod/a.cfg": encode("abc") }));

    await expect(
      extractAll(zip, path, [{ path: "GameData/Mod/missing.cfg", rawPath: "GameData/Mod/missing.cfg", size: 1 }]),
    ).rejects.toThrow(/missing\.cfg/);
  });

  it("propagates errors from the entry callback unchanged", async () => {
    const zip = new ZipArchive();
    const path = await archiveFile(zipSync({ "GameData/Mod/a.cfg": encode("abc") }));
    const failure = new Error("disk full");

    await expect(
      zip.extractEntries(path, await zip.listEntries(path), async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
  });

  it("reports a file that is not a ZIP archive", async () => {
    const zip = new ZipArchive();
    const path = await archiveFile(encode("not a zip"));

    await expect(zip.listEntries(path)).rejects.toMatchObject({ code: "INVALID_ZIP" });
  });
});
