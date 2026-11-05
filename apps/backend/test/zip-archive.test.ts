import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  MAX_ZIP_ENTRY_BYTES,
  MAX_ZIP_TOTAL_BYTES,
  ZipArchive,
  type ZipEntryInfo,
} from "../src/adapters/zip-archive.js";

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

function filesOfSize(count: number, bytes: number): Record<string, Uint8Array> {
  const files: Record<string, Uint8Array> = {};
  for (let index = 0; index < count; index += 1) {
    files[`GameData/Pack/file-${index}.bin`] = new Uint8Array(bytes).fill(index);
  }
  return files;
}

async function extractAll(zip: ZipArchive, archive: Uint8Array, entries: readonly ZipEntryInfo[], batchBytes?: number) {
  const seen: Array<{ path: string; data: Uint8Array }> = [];
  await zip.extractEntries(
    archive,
    entries,
    async (entry, data) => {
      seen.push({ path: entry.path, data });
    },
    batchBytes,
  );
  return seen;
}

describe("ZipArchive", () => {
  it("lists entries with their declared sizes without directories", () => {
    const zip = new ZipArchive();
    const archive = zipSync({ "GameData/Mod/": new Uint8Array(), "GameData/Mod/a.cfg": encode("abc") });

    expect(zip.listEntries(archive)).toEqual([{ path: "GameData/Mod/a.cfg", rawPath: "GameData/Mod/a.cfg", size: 3 }]);
  });

  it("rejects unsafe paths and oversized entries while listing", () => {
    const zip = new ZipArchive();
    expect(() => zip.listEntries(zipSync({ "../evil.txt": encode("nope") }))).toThrow(/unsafe/i);
    expect(() =>
      zip.listEntries(declareAllSizes(zipSync({ "GameData/Big/file.bin": encode("x") }), MAX_ZIP_ENTRY_BYTES + 1)),
    ).toThrow(/size limit/i);
  });

  it("accepts a single entry of several hundred MiB, such as a bundled Unity package", () => {
    const zip = new ZipArchive();
    const burst = declareAllSizes(zipSync({ "GameData/000_KSPBurst/com.unity.burst@1.7.4.zip": encode("x") }), 408_723_559);

    expect(zip.listEntries(burst)).toEqual([
      {
        path: "GameData/000_KSPBurst/com.unity.burst@1.7.4.zip",
        rawPath: "GameData/000_KSPBurst/com.unity.burst@1.7.4.zip",
        size: 408_723_559,
      },
    ]);
    expect(() =>
      zip.listEntries(declareAllSizes(zipSync({ "GameData/Big/file.bin": encode("x") }), 1024 * 1024 * 1024 + 1)),
    ).toThrow(/size limit/i);
  });

  it("accepts archives that declare more than 2 GiB in total", () => {
    const zip = new ZipArchive();
    const count = Math.floor((2 * 1024 * 1024 * 1024) / MAX_ZIP_ENTRY_BYTES) + 1;
    const archive = declareAllSizes(zipSync(filesOfSize(count, 1)), MAX_ZIP_ENTRY_BYTES);

    expect(zip.listEntries(archive)).toHaveLength(count);
  });

  it("rejects archives that declare more than the total limit", () => {
    const zip = new ZipArchive();
    const count = Math.floor(MAX_ZIP_TOTAL_BYTES / MAX_ZIP_ENTRY_BYTES) + 1;
    const archive = declareAllSizes(zipSync(filesOfSize(count, 1)), MAX_ZIP_ENTRY_BYTES);

    expect(() => zip.listEntries(archive)).toThrow(/total size limit/i);
  });

  it("extracts the selected entries in several batches", async () => {
    const zip = new ZipArchive();
    const files = filesOfSize(5, 1000);
    const archive = zipSync(files);
    const selected = zip.listEntries(archive).filter((entry) => !entry.path.endsWith("file-2.bin"));

    const seen = await extractAll(zip, archive, selected, 2500);

    expect(seen.map((entry) => entry.path)).toEqual(selected.map((entry) => entry.path));
    for (const entry of seen) {
      expect(entry.data).toEqual(files[entry.path]);
    }
  });

  it("extracts entries whose declared size is wrong by their real content", async () => {
    const zip = new ZipArchive();
    const archive = declareAllSizes(zipSync({ "GameData/Bundled/file.bin": encode("small") }), 250 * 1024 * 1024);

    const seen = await extractAll(zip, archive, zip.listEntries(archive));

    expect(seen).toEqual([{ path: "GameData/Bundled/file.bin", data: encode("small") }]);
  });

  it("fails loudly when a selected entry is not in the archive", async () => {
    const zip = new ZipArchive();
    const archive = zipSync({ "GameData/Mod/a.cfg": encode("abc") });

    await expect(
      extractAll(zip, archive, [{ path: "GameData/Mod/missing.cfg", rawPath: "GameData/Mod/missing.cfg", size: 1 }]),
    ).rejects.toThrow(/missing\.cfg/);
  });

  it("propagates errors from the entry callback unchanged", async () => {
    const zip = new ZipArchive();
    const archive = zipSync({ "GameData/Mod/a.cfg": encode("abc") });
    const failure = new Error("disk full");

    await expect(
      zip.extractEntries(archive, zip.listEntries(archive), async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
  });
});
