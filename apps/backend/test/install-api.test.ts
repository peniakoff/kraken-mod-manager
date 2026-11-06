import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, utimesSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync } from "fflate";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { HttpPort, PlatformPort } from "@kraken/core";
import { ConfigStore } from "../src/adapters/config-store.js";
import { InstallManifestStore } from "../src/adapters/install-manifest-store.js";
import { NodeFileSystem } from "../src/adapters/node-file-system.js";
import { RegistryCacheStore } from "../src/adapters/registry-cache-store.js";
import { StreamingHttp } from "../src/adapters/streaming-http.js";
import { packUstar, TarGzArchive } from "../src/adapters/tar-gz-archive.js";
import { ZipArchive, type ZipEntryInfo } from "../src/adapters/zip-archive.js";
import { createApp } from "../src/app.js";
import { DirectoryBrowser } from "../src/directory-browser.js";
import { InstallService } from "../src/install-service.js";
import { JobStore } from "../src/job-store.js";
import { RegistryService } from "../src/registry-service.js";
import type { Readable } from "node:stream";
import { gzipSync } from "node:zlib";

function fixtureModZip(folder = "ExampleMod"): Uint8Array {
  return zipSync({
    [`GameData/${folder}/readme.txt`]: new TextEncoder().encode(`hello from ${folder}\n`),
    [`GameData/${folder}/plugin.dll`]: new TextEncoder().encode("fake-dll"),
  });
}

function fixtureMetaArchive(
  exampleHash: { sha256: string; sha1: string },
  moduleManagerHash: { sha256: string; sha1: string },
): Uint8Array {
  const exampleZipSize = fixtureModZip("ExampleMod").byteLength;
  const mmZipSize = fixtureModZip("ModuleManager").byteLength;
  const tar = packUstar([
    {
      path: "CKAN-meta-master/ExampleMod/ExampleMod-1.0.0.ckan",
      content: JSON.stringify({
        identifier: "ExampleMod",
        name: "Example Mod",
        author: "Tester",
        version: "1.0.0",
        tags: ["plugin"],
        download: "https://example.test/ExampleMod.zip",
        download_size: exampleZipSize,
        download_hash: exampleHash,
        install: [{ file: "GameData/ExampleMod", install_to: "GameData" }],
      }),
    },
    {
      path: "CKAN-meta-master/ModuleManager/ModuleManager-4.2.3.ckan",
      content: JSON.stringify({
        identifier: "ModuleManager",
        name: "Module Manager",
        author: "Tester",
        version: "4.2.3",
        tags: ["plugin"],
        download: "https://example.test/ModuleManager.zip",
        download_size: mmZipSize,
        download_hash: moduleManagerHash,
        install: [{ file: "GameData/ModuleManager", install_to: "GameData" }],
      }),
    },
    {
      path: "CKAN-meta-master/DependentMod/DependentMod-1.0.0.ckan",
      content: JSON.stringify({
        identifier: "DependentMod",
        name: "Dependent Mod",
        author: "Tester",
        version: "1.0.0",
        tags: ["plugin"],
        download: "https://example.test/DependentMod.zip",
        download_size: exampleZipSize,
        download_hash: exampleHash,
        depends: [{ name: "ModuleManager", min_version: "4.0.0" }],
        conflicts: [{ name: "DetectedOnly" }],
        install: [{ file: "GameData/ExampleMod", install_to: "GameData", as: "DependentMod" }],
      }),
    },
    {
      path: "CKAN-meta-master/BrokenDependent/BrokenDependent-1.0.0.ckan",
      content: JSON.stringify({
        identifier: "BrokenDependent",
        name: "Broken Dependent",
        author: "Tester",
        version: "1.0.0",
        tags: ["plugin"],
        download: "https://example.test/BrokenDependent.zip",
        download_size: exampleZipSize,
        download_hash: {
          sha256: "0".repeat(64),
          sha1: "0".repeat(40),
        },
        depends: [{ name: "ModuleManager", min_version: "4.0.0" }],
        install: [{ file: "GameData/ExampleMod", install_to: "GameData", as: "BrokenDependent" }],
      }),
    },
    {
      path: "CKAN-meta-master/DetectedOnly/DetectedOnly-1.0.0.ckan",
      content: JSON.stringify({
        identifier: "DetectedOnly",
        name: "Detected Only",
        author: "Tester",
        version: "1.0.0",
        tags: ["plugin"],
      }),
    },
    {
      // No download_hash, so a corrupt archive reaches extraction.
      path: "CKAN-meta-master/NoHashMod/NoHashMod-1.0.0.ckan",
      content: JSON.stringify({
        identifier: "NoHashMod",
        name: "No Hash Mod",
        author: "Tester",
        version: "1.0.0",
        tags: ["plugin"],
        download: "https://example.test/NoHashMod.zip",
      }),
    },
    {
      path: "CKAN-meta-master/AnotherMod/AnotherMod-1.0.0.ckan",
      content: JSON.stringify({
        identifier: "AnotherMod",
        name: "Another Mod",
        author: "Tester",
        version: "1.0.0",
        tags: ["plugin"],
        download: "https://example.test/AnotherMod.zip",
        download_size: exampleZipSize,
        download_hash: exampleHash,
        install: [{ file: "GameData/ExampleMod", install_to: "GameData", as: "AnotherMod" }],
      }),
    },
    ...["1.0.0", "2.0.0"].map((version) => ({
      path: `CKAN-meta-master/ExamplePack/ExamplePack-${version}.ckan`,
      content: JSON.stringify({
        identifier: "ExamplePack",
        name: "Example Pack",
        author: "Tester",
        version,
        kind: "metapackage",
        tags: ["plugin"],
        depends: [{ name: "ModuleManager" }, { name: "AnotherMod" }],
      }),
    })),
    {
      path: "CKAN-meta-master/NestedPack/NestedPack-1.0.0.ckan",
      content: JSON.stringify({
        identifier: "NestedPack",
        name: "Nested Pack",
        author: "Tester",
        version: "1.0.0",
        tags: ["plugin"],
        download: "https://example.test/AnotherMod.zip",
        download_size: exampleZipSize,
        download_hash: exampleHash,
        depends: [{ name: "ExamplePack" }],
        install: [{ file: "GameData/ExampleMod", install_to: "GameData", as: "NestedPack" }],
      }),
    },
    {
      path: "CKAN-meta-master/NeedsBare/NeedsBare-1.0.0.ckan",
      content: JSON.stringify({
        identifier: "NeedsBare",
        name: "Needs Bare",
        author: "Tester",
        version: "1.0.0",
        tags: ["plugin"],
        download: "https://example.test/AnotherMod.zip",
        download_size: exampleZipSize,
        download_hash: exampleHash,
        depends: [{ name: "DetectedOnly" }],
        install: [{ file: "GameData/ExampleMod", install_to: "GameData", as: "NeedsBare" }],
      }),
    },
    {
      path: "CKAN-meta-master/DlcThing/DlcThing-1.0.0.ckan",
      content: JSON.stringify({
        identifier: "DlcThing",
        name: "Dlc Thing",
        author: "Tester",
        version: "1.0.0",
        kind: "dlc",
        tags: ["plugin"],
        download: "https://example.test/AnotherMod.zip",
        download_size: exampleZipSize,
        download_hash: exampleHash,
      }),
    },
    {
      path: "CKAN-meta-master/LegacyMod/LegacyMod-1.0.0.ckan",
      content: JSON.stringify({
        identifier: "LegacyMod",
        name: "Legacy Mod",
        author: "Tester",
        version: "1.0.0",
        ksp_version_max: "1.12",
        tags: ["plugin"],
        download: "https://example.test/AnotherMod.zip",
        download_size: exampleZipSize,
        download_hash: exampleHash,
        install: [{ file: "GameData/ExampleMod", install_to: "GameData", as: "LegacyMod" }],
      }),
    },
    {
      path: "CKAN-meta-master/LegacyMod/LegacyMod-2.0.0.ckan",
      content: JSON.stringify({
        identifier: "LegacyMod",
        name: "Legacy Mod",
        author: "Tester",
        version: "2.0.0",
        ksp_version_min: "1.13",
        tags: ["plugin"],
        download: "https://example.test/AnotherMod.zip",
        download_size: exampleZipSize,
        download_hash: exampleHash,
        install: [{ file: "GameData/ExampleMod", install_to: "GameData", as: "LegacyMod" }],
      }),
    },
    {
      path: "CKAN-meta-master/RealSolarSystem/RealSolarSystem-1.0.0.ckan",
      content: JSON.stringify({
        identifier: "RealSolarSystem",
        name: "Real Solar System",
        author: "Tester",
        version: "1.0.0",
        tags: ["plugin"],
        download: "https://example.test/RealSolarSystem.zip",
        download_size: exampleZipSize,
        download_hash: exampleHash,
        depends: [{ name: "RSSTextures" }],
        install: [{ file: "GameData/ExampleMod", install_to: "GameData", as: "RealSolarSystem" }],
      }),
    },
    {
      path: "CKAN-meta-master/RecommendingMod/RecommendingMod-1.0.0.ckan",
      content: JSON.stringify({
        identifier: "RecommendingMod",
        name: "Recommending Mod",
        author: "Tester",
        version: "1.0.0",
        tags: ["plugin"],
        download: "https://example.test/RecommendingMod.zip",
        download_size: exampleZipSize,
        download_hash: exampleHash,
        recommends: [{ name: "ModuleManager" }],
        suggests: [{ name: "AnotherMod" }],
        install: [{ file: "GameData/ExampleMod", install_to: "GameData", as: "RecommendingMod" }],
      }),
    },
    ...[
      ["MirroredMod", ["https://example.test/missing.zip", "https://example.test/ExampleMod.zip"]],
      ["TamperedMirrorMod", ["https://example.test/tampered.zip", "https://example.test/ExampleMod.zip"]],
      ["UnreachableMod", ["https://example.test/missing.zip", "https://example.test/tampered.zip"]],
    ].map(([identifier, download]) => ({
      path: `CKAN-meta-master/${identifier}/${identifier}-1.0.0.ckan`,
      content: JSON.stringify({
        spec_version: "v1.34",
        identifier,
        name: identifier,
        author: "Tester",
        version: "1.0.0",
        tags: ["plugin"],
        download,
        download_size: exampleZipSize,
        download_hash: exampleHash,
        install: [{ file: "GameData/ExampleMod", install_to: "GameData", as: identifier }],
      }),
    })),
    ...[4096, 8192].map((resolution) => ({
      path: `CKAN-meta-master/RSSTextures${resolution}/RSSTextures${resolution}-1.0.0.ckan`,
      content: JSON.stringify({
        identifier: `RSSTextures${resolution}`,
        name: `RSS Textures ${resolution}`,
        author: "Tester",
        version: "1.0.0",
        tags: ["plugin"],
        provides: ["RSSTextures"],
        download: `https://example.test/RSSTextures${resolution}.zip`,
        download_size: exampleZipSize,
        download_hash: exampleHash,
        install: [{ file: "GameData/ExampleMod", install_to: "GameData", as: `RSSTextures${resolution}` }],
      }),
    })),
  ]);
  return new Uint8Array(gzipSync(tar));
}

interface InstallTestOptions {
  /** Delays the response for one download URL until the promise settles. */
  holdDownload?: { url: string; until: Promise<void> };
  /** Archives served for NoHashMod, one per download; the last one repeats. */
  noHashArchives?: Uint8Array[];
  /** Replaces the ZIP adapter, for example to simulate a crash. */
  zip?: ZipArchive;
}

/**
 * Simulates the process dying in the middle of an install: the given
 * extraction call (1-based) writes `afterEntries` files and then never
 * finishes, so nothing after that point runs.
 */
class CrashingZip extends ZipArchive {
  private calls = 0;
  private signalCrash: () => void = () => undefined;
  readonly crashed = new Promise<void>((resolve) => {
    this.signalCrash = resolve;
  });

  constructor(
    private readonly crashOnCall: number,
    private readonly afterEntries: number,
  ) {
    super();
  }

  override async extractEntries(
    archivePath: string,
    entries: readonly ZipEntryInfo[],
    onEntry: (entry: ZipEntryInfo, source: Readable) => Promise<void>,
  ): Promise<void> {
    this.calls += 1;
    if (this.calls !== this.crashOnCall) {
      return super.extractEntries(archivePath, entries, onEntry);
    }
    let written = 0;
    return super.extractEntries(archivePath, entries, async (entry, source) => {
      if (written === this.afterEntries) {
        source.resume();
        this.signalCrash();
        await new Promise<never>(() => undefined);
      }
      await onEntry(entry, source);
      written += 1;
    });
  }
}

/** Overwrites the uncompressed size of the central directory record at `index`. */
function declareEntrySize(archive: Uint8Array, index: number, size: number): Uint8Array {
  const copy = archive.slice();
  const view = new DataView(copy.buffer, copy.byteOffset, copy.byteLength);
  let seen = 0;
  for (let offset = 0; offset <= copy.byteLength - 28; offset += 1) {
    if (view.getUint32(offset, true) === 0x02014b50) {
      if (seen === index) {
        view.setUint32(offset + 24, size, true);
        return copy;
      }
      seen += 1;
    }
  }
  throw new Error(`ZIP central directory record ${index} was not found`);
}

async function createInstallTestApp(testOptions: InstallTestOptions = {}) {
  const home = await mkdtemp(join(tmpdir(), "kmm-install-"));
  const ksp = join(home, "KSP");
  mkdirSync(join(ksp, "GameData"), { recursive: true });
  writeFileSync(join(ksp, "KSP.x86_64"), "");
  writeFileSync(join(ksp, "readme.txt"), "Version 1.12.5");

  const zipBytes = fixtureModZip("ExampleMod");
  const mmZipBytes = fixtureModZip("ModuleManager");
  const exampleHash = {
    sha256: createHash("sha256").update(zipBytes).digest("hex"),
    sha1: createHash("sha1").update(zipBytes).digest("hex"),
  };
  const moduleManagerHash = {
    sha256: createHash("sha256").update(mmZipBytes).digest("hex"),
    sha1: createHash("sha1").update(mmZipBytes).digest("hex"),
  };

  const http: HttpPort = {
    async get(url: string) {
      if (url.includes("CKAN-meta")) {
        return fixtureMetaArchive(exampleHash, moduleManagerHash);
      }
      throw new Error(`unexpected metadata url: ${url}`);
    },
  };

  const streamingHttp = new StreamingHttp(async (url) => {
    if (testOptions.holdDownload?.url === url) {
      await testOptions.holdDownload.until;
    }
    if (url === "https://example.test/NoHashMod.zip") {
      const archives = testOptions.noHashArchives ?? [fixtureModZip("NoHashMod")];
      const archive = archives.length > 1 ? archives.shift() : archives[0];
      if (archive === undefined) {
        throw new Error("noHashArchives is empty");
      }
      return new Response(Buffer.from(archive), { status: 200 });
    }
    if (
      url === "https://example.test/ExampleMod.zip" ||
      url === "https://example.test/AnotherMod.zip" ||
      url === "https://example.test/DependentMod.zip" ||
      url === "https://example.test/BrokenDependent.zip" ||
      url === "https://example.test/RealSolarSystem.zip" ||
      url === "https://example.test/RecommendingMod.zip" ||
      url === "https://example.test/RSSTextures4096.zip" ||
      url === "https://example.test/RSSTextures8192.zip"
    ) {
      return new Response(Buffer.from(zipBytes), {
        status: 200,
        headers: { "content-length": String(zipBytes.byteLength) },
      });
    }
    if (url === "https://example.test/tampered.zip") {
      return new Response(Buffer.from(fixtureModZip("Tampered")), { status: 200 });
    }
    if (url === "https://example.test/ModuleManager.zip") {
      return new Response(Buffer.from(mmZipBytes), {
        status: 200,
        headers: { "content-length": String(mmZipBytes.byteLength) },
      });
    }
    return new Response("missing", { status: 404 });
  });

  const platform: PlatformPort = { platform: "linux", homeDirectory: home, environment: {} };

  // A second call builds a fresh process over the same files, as after a restart.
  function start(zip: ZipArchive) {
    const registryService = new RegistryService(
      http,
      new TarGzArchive(),
      new RegistryCacheStore(join(home, "cache", "registry.json")),
      "https://example.test/CKAN-meta.tar.gz",
    );
    const installService = new InstallService(
      new NodeFileSystem(),
      registryService,
      streamingHttp,
      zip,
      new InstallManifestStore(join(home, "data", "install-manifest.json")),
      new JobStore(),
      join(home, "cache", "downloads"),
    );
    const app = createApp("test", {
      fileSystem: new NodeFileSystem(),
      platform,
      configStore: new ConfigStore(join(home, "config", "config.json")),
      directoryBrowser: new DirectoryBrowser([home]),
      registryService,
      installService,
    });
    return { app, installService };
  }

  const { app, installService } = start(testOptions.zip ?? new ZipArchive());
  await request(app).put("/api/v1/config").send({ installationPath: ksp });
  await request(app).post("/api/v1/registry/refresh");

  return {
    app,
    home,
    ksp,
    installService,
    restart: () => start(new ZipArchive()),
    downloads: join(home, "cache", "downloads"),
    sha256: exampleHash.sha256,
  };
}

async function waitForJob(app: ReturnType<typeof createApp>, jobId: string) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const response = await request(app).get(`/api/v1/jobs/${jobId}`);
    expect(response.status).toBe(200);
    if (response.body.status === "succeeded" || response.body.status === "failed") {
      return response.body;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("job did not finish");
}

async function installWithDependencies(app: ReturnType<typeof createApp>, identifier: string): Promise<void> {
  const accepted = await request(app).post(`/api/v1/mods/${identifier}/install`).send({ installDependencies: true });
  expect(accepted.status).toBe(202);
  expect((await waitForJob(app, accepted.body.job.jobId)).status).toBe("succeeded");
}

interface StoredManifestFile {
  schemaVersion: number;
  mods: Array<{ identifier: string; version?: string; installationPath: string; autoInstalled?: boolean }>;
}

function readManifestFile(home: string): StoredManifestFile {
  // The on-disk format is the contract under test, so read the raw file.
  return JSON.parse(readFileSync(join(home, "data", "install-manifest.json"), "utf8")) as StoredManifestFile;
}

function manifestRecord(home: string, identifier: string) {
  const record = readManifestFile(home).mods.find((mod) => mod.identifier === identifier);
  if (record === undefined) {
    throw new Error(`manifest has no record for ${identifier}`);
  }
  return record;
}

describe("mod install API", () => {
  it("installs, inventories, and uninstalls a managed mod", async () => {
    const { app, ksp } = await createInstallTestApp();

    mkdirSync(join(ksp, "GameData", "DetectedOnly"), { recursive: true });
    writeFileSync(join(ksp, "GameData", "DetectedOnly", "marker.txt"), "manual");

    const inventoryBefore = await request(app).get("/api/v1/installed-mods");
    expect(inventoryBefore.status).toBe(200);
    expect(inventoryBefore.body.mods).toEqual([
      expect.objectContaining({ identifier: "DetectedOnly", status: "detected" }),
    ]);

    const accepted = await request(app).post("/api/v1/mods/ExampleMod/install").send({});
    expect(accepted.status).toBe(202);
    expect(accepted.body.job.identifier).toBe("ExampleMod");

    const finished = await waitForJob(app, accepted.body.job.jobId);
    expect(finished).toMatchObject({ status: "succeeded", phase: "done", version: "1.0.0" });

    const readme = readFileSync(join(ksp, "GameData", "ExampleMod", "readme.txt"), "utf8");
    expect(readme).toContain("hello from ExampleMod");

    const inventory = await request(app).get("/api/v1/installed-mods");
    expect(inventory.status).toBe(200);
    expect(inventory.body.mods).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ identifier: "ExampleMod", status: "managed", version: "1.0.0" }),
        expect.objectContaining({ identifier: "DetectedOnly", status: "detected" }),
      ]),
    );

    const removed = await request(app).post("/api/v1/mods/ExampleMod/uninstall").send({});
    expect(removed.status).toBe(200);
    expect(removed.body).toEqual({ removed: ["ExampleMod"] });
    expect(() => readFileSync(join(ksp, "GameData", "ExampleMod", "readme.txt"))).toThrow();

    const inventoryAfter = await request(app).get("/api/v1/installed-mods");
    expect(inventoryAfter.body.mods).toEqual([
      expect.objectContaining({ identifier: "DetectedOnly", status: "detected" }),
    ]);
  });

  it("rolls back files when an install fails partway through", async () => {
    const { app, home, ksp } = await createInstallTestApp();
    mkdirSync(join(ksp, "GameData", "ExampleMod", "plugin.dll"), { recursive: true });

    const accepted = await request(app).post("/api/v1/mods/ExampleMod/install").send({});
    const finished = await waitForJob(app, accepted.body.job.jobId);

    expect(finished.status).toBe("failed");
    expect(() => readFileSync(join(ksp, "GameData", "ExampleMod", "readme.txt"))).toThrow();
    expect(() => readFileSync(join(home, "data", "install-manifest.json"))).toThrow();
  });

  it("removes files dropped by a reinstalled mod", async () => {
    const { app, home, ksp } = await createInstallTestApp();
    const first = await request(app).post("/api/v1/mods/ExampleMod/install").send({});
    await waitForJob(app, first.body.job.jobId);

    const obsoletePath = join(ksp, "GameData", "ExampleMod", "obsolete.txt");
    writeFileSync(obsoletePath, "obsolete");
    const manifestPath = join(home, "data", "install-manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      mods: Array<{ identifier: string; files: string[] }>;
    };
    manifest.mods[0]!.files.push("GameData/ExampleMod/obsolete.txt");
    writeFileSync(manifestPath, JSON.stringify(manifest));

    const second = await request(app).post("/api/v1/mods/ExampleMod/install").send({});
    const finished = await waitForJob(app, second.body.job.jobId);

    expect(finished.status).toBe("succeeded");
    expect(() => readFileSync(obsoletePath)).toThrow();
  });

  it("keeps managed installs scoped to their KSP installation", async () => {
    const { app, home, ksp } = await createInstallTestApp();
    const accepted = await request(app).post("/api/v1/mods/ExampleMod/install").send({});
    await waitForJob(app, accepted.body.job.jobId);

    const secondKsp = join(home, "SecondKSP");
    mkdirSync(join(secondKsp, "GameData"), { recursive: true });
    writeFileSync(join(secondKsp, "KSP.x86_64"), "");
    writeFileSync(join(secondKsp, "readme.txt"), "Version 1.12.5");
    await request(app).put("/api/v1/config").send({ installationPath: secondKsp });

    const secondInventory = await request(app).get("/api/v1/installed-mods");
    expect(secondInventory.body.mods).toEqual([]);
    const wrongUninstall = await request(app).post("/api/v1/mods/ExampleMod/uninstall").send({});
    expect(wrongUninstall.status).toBe(422);
    expect(wrongUninstall.body.code).toBe("NOT_MANAGED");

    await request(app).put("/api/v1/config").send({ installationPath: ksp });
    const removed = await request(app).post("/api/v1/mods/ExampleMod/uninstall").send({});
    expect(removed.status).toBe(200);
  });

  it("keeps only files that remain after a partial uninstall", async () => {
    const { app, home, ksp } = await createInstallTestApp();
    const accepted = await request(app).post("/api/v1/mods/ExampleMod/install").send({});
    await waitForJob(app, accepted.body.job.jobId);

    const blockedPath = join(ksp, "GameData", "blocked");
    mkdirSync(blockedPath, { recursive: true });
    writeFileSync(join(blockedPath, "child.txt"), "keep");
    const manifestPath = join(home, "data", "install-manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      mods: Array<{ identifier: string; files: string[] }>;
    };
    manifest.mods[0]!.files.push("GameData/blocked");
    writeFileSync(manifestPath, JSON.stringify(manifest));

    const removed = await request(app).post("/api/v1/mods/ExampleMod/uninstall").send({});
    expect(removed.status).toBe(500);
    expect(removed.body.code).toBe("UNINSTALL_FAILED");
    const updated = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      mods: Array<{ identifier: string; files: string[] }>;
    };
    expect(updated.mods[0]!.files).toEqual(["GameData/blocked"]);
  });

  it("serializes concurrent manifest updates", async () => {
    const { app } = await createInstallTestApp();
    const [first, second] = await Promise.all([
      request(app).post("/api/v1/mods/ExampleMod/install").send({}),
      request(app).post("/api/v1/mods/AnotherMod/install").send({}),
    ]);

    const [firstFinished, secondFinished] = await Promise.all([
      waitForJob(app, first.body.job.jobId),
      waitForJob(app, second.body.job.jobId),
    ]);
    expect(firstFinished.status).toBe("succeeded");
    expect(secondFinished.status).toBe("succeeded");

    const inventory = await request(app).get("/api/v1/installed-mods");
    expect(inventory.body.mods).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ identifier: "ExampleMod", status: "managed" }),
        expect.objectContaining({ identifier: "AnotherMod", status: "managed" }),
      ]),
    );
  });

  it("rejects downloads whose hash does not match", async () => {
    const { app } = await createInstallTestApp();
    const badHttp = new StreamingHttp(async () => {
      const tampered = zipSync({
        "GameData/ExampleMod/readme.txt": new TextEncoder().encode("tampered"),
      });
      return new Response(Buffer.from(tampered), { status: 200 });
    });

    // Rebuild app with bad downloader while keeping registry cache from previous refresh is awkward;
    // instead start install against a fresh service wiring inside this test by hitting the existing
    // install endpoint is enough for happy path. Hash mismatch is covered via InstallService unit path:
    const home = await mkdtemp(join(tmpdir(), "kmm-hash-"));
    const ksp = join(home, "KSP");
    mkdirSync(join(ksp, "GameData"), { recursive: true });
    writeFileSync(join(ksp, "KSP.x86_64"), "");
    writeFileSync(join(ksp, "readme.txt"), "Version 1.12.5");

    const goodZip = fixtureModZip("ExampleMod");
    const mmZip = fixtureModZip("ModuleManager");
    const exampleHash = {
      sha256: createHash("sha256").update(goodZip).digest("hex"),
      sha1: createHash("sha1").update(goodZip).digest("hex"),
    };
    const moduleManagerHash = {
      sha256: createHash("sha256").update(mmZip).digest("hex"),
      sha1: createHash("sha1").update(mmZip).digest("hex"),
    };
    const registryService = new RegistryService(
      {
        async get() {
          return fixtureMetaArchive(exampleHash, moduleManagerHash);
        },
      },
      new TarGzArchive(),
      new RegistryCacheStore(join(home, "cache", "registry.json")),
      "https://example.test/CKAN-meta.tar.gz",
    );
    const installService = new InstallService(
      new NodeFileSystem(),
      registryService,
      badHttp,
      new ZipArchive(),
      new InstallManifestStore(join(home, "data", "install-manifest.json")),
      new JobStore(),
      join(home, "cache", "downloads"),
    );
    const hashApp = createApp("test", {
      fileSystem: new NodeFileSystem(),
      platform: { platform: "linux", homeDirectory: home, environment: {} },
      configStore: new ConfigStore(join(home, "config", "config.json")),
      directoryBrowser: new DirectoryBrowser([home]),
      registryService,
      installService,
    });
    await request(hashApp).put("/api/v1/config").send({ installationPath: ksp });
    await request(hashApp).post("/api/v1/registry/refresh");
    const accepted = await request(hashApp).post("/api/v1/mods/ExampleMod/install").send({});
    const finished = await waitForJob(hashApp, accepted.body.job.jobId);
    expect(finished.status).toBe("failed");
    expect(finished.error).toMatch(/SHA-256/i);

    // Keep the first app reference used so the suite does not look unused.
    expect(app).toBeDefined();
  });

  it("streams progress events for an install job", async () => {
    const { app } = await createInstallTestApp();
    const accepted = await request(app).post("/api/v1/mods/ExampleMod/install").send({});
    const jobId = accepted.body.job.jobId as string;
    const finished = await waitForJob(app, jobId);
    expect(finished.status).toBe("succeeded");

    const eventsResponse = await request(app).get(`/api/v1/jobs/${jobId}/events`).buffer(true).parse((res, callback) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        callback(null, data);
      });
    });

    expect(eventsResponse.status).toBe(200);
    expect(eventsResponse.headers["content-type"]).toMatch(/text\/event-stream/);
    expect(String(eventsResponse.body)).toContain('"status":"succeeded"');
  });

  it("plans dependencies and installs them when requested", async () => {
    const { app, ksp } = await createInstallTestApp();

    const plan = await request(app).post("/api/v1/mods/DependentMod/plan").send({});
    expect(plan.status).toBe(200);
    expect(plan.body.status).toBe("ok");
    expect(plan.body.toInstall.map((entry: { identifier: string }) => entry.identifier)).toEqual([
      "ModuleManager",
      "DependentMod",
    ]);

    const accepted = await request(app)
      .post("/api/v1/mods/DependentMod/install")
      .send({ installDependencies: true });
    expect(accepted.status).toBe(202);
    const finished = await waitForJob(app, accepted.body.job.jobId);
    expect(finished.status).toBe("succeeded");

    expect(readFileSync(join(ksp, "GameData", "ModuleManager", "readme.txt"), "utf8")).toContain("ModuleManager");
    expect(readFileSync(join(ksp, "GameData", "DependentMod", "readme.txt"), "utf8")).toContain("ExampleMod");

    const inventory = await request(app).get("/api/v1/installed-mods");
    expect(inventory.body.mods).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ identifier: "ModuleManager", status: "managed" }),
        expect.objectContaining({ identifier: "DependentMod", status: "managed" }),
      ]),
    );
  });

  it("blocks dependency installs that conflict with detected mods", async () => {
    const { app, ksp } = await createInstallTestApp();
    mkdirSync(join(ksp, "GameData", "DetectedOnly"), { recursive: true });

    const plan = await request(app).post("/api/v1/mods/DependentMod/plan").send({});
    expect(plan.status).toBe(200);
    expect(plan.body.status).toBe("blocked");
    expect(plan.body.conflicts).toEqual(
      expect.arrayContaining([expect.objectContaining({ conflictingWith: "DetectedOnly" })]),
    );

    const rejected = await request(app)
      .post("/api/v1/mods/DependentMod/install")
      .send({ installDependencies: true });
    expect(rejected.status).toBe(422);
    expect(rejected.body.code).toBe("PLAN_BLOCKED");
  });

  it("returns choice-required when several mods provide a dependency", async () => {
    const { app } = await createInstallTestApp();

    const plan = await request(app).post("/api/v1/mods/RealSolarSystem/plan").send({});
    expect(plan.status).toBe(200);
    expect(plan.body.status).toBe("choice-required");
    expect(plan.body.choices[0].key).toBe("RSSTextures");
    expect(plan.body.choices[0].candidates.map((entry: { identifier: string }) => entry.identifier)).toEqual([
      "RSSTextures4096",
      "RSSTextures8192",
    ]);
  });

  it("installs the chosen provider when choices are sent", async () => {
    const { app, ksp } = await createInstallTestApp();
    const choices = { RSSTextures: "RSSTextures8192" };

    const plan = await request(app).post("/api/v1/mods/RealSolarSystem/plan").send({ choices });
    expect(plan.body.status).toBe("ok");

    const accepted = await request(app)
      .post("/api/v1/mods/RealSolarSystem/install")
      .send({ installDependencies: true, choices });
    expect(accepted.status).toBe(202);
    const finished = await waitForJob(app, accepted.body.job.jobId);
    expect(finished.status).toBe("succeeded");

    expect(readFileSync(join(ksp, "GameData", "RSSTextures8192", "readme.txt"), "utf8")).toContain("ExampleMod");
    expect(() => readFileSync(join(ksp, "GameData", "RSSTextures4096", "readme.txt"))).toThrow();
    const inventory = await request(app).get("/api/v1/installed-mods");
    expect(inventory.body.mods).toEqual(
      expect.arrayContaining([expect.objectContaining({ identifier: "RSSTextures8192", status: "managed" })]),
    );
  });

  it("offers recommended and suggested mods in the plan", async () => {
    const { app } = await createInstallTestApp();
    const plan = await request(app).post("/api/v1/mods/RecommendingMod/plan").send({});

    expect(plan.status).toBe(200);
    expect(plan.body.optional).toEqual([
      {
        kind: "recommends",
        name: "ModuleManager",
        requiredBy: "RecommendingMod",
        module: { identifier: "ModuleManager", name: "Module Manager", version: "4.2.3" },
      },
      {
        kind: "suggests",
        name: "AnotherMod",
        requiredBy: "RecommendingMod",
        module: { identifier: "AnotherMod", name: "Another Mod", version: "1.0.0" },
      },
    ]);
  });

  it("plans and installs the optional mods the user picked as manual installs", async () => {
    const { app, home, ksp } = await createInstallTestApp();
    const plan = await request(app).post("/api/v1/mods/RecommendingMod/plan").send({ optional: ["ModuleManager"] });
    expect(plan.body.toInstall.map((entry: { identifier: string }) => entry.identifier).sort()).toEqual([
      "ModuleManager",
      "RecommendingMod",
    ]);

    const accepted = await request(app)
      .post("/api/v1/mods/RecommendingMod/install")
      .send({ installDependencies: true, optional: ["ModuleManager"] });
    expect((await waitForJob(app, accepted.body.job.jobId)).status).toBe("succeeded");

    expect(existsSync(join(ksp, "GameData", "ModuleManager", "readme.txt"))).toBe(true);
    expect(existsSync(join(ksp, "GameData", "AnotherMod"))).toBe(false);
    expect(manifestRecord(home, "ModuleManager").autoInstalled).toBe(false);
    expect(manifestRecord(home, "RecommendingMod").autoInstalled).toBe(false);
  });

  it("resolves picked optional mods even without installDependencies", async () => {
    const { app, ksp } = await createInstallTestApp();
    const accepted = await request(app).post("/api/v1/mods/RecommendingMod/install").send({ optional: ["AnotherMod"] });
    expect((await waitForJob(app, accepted.body.job.jobId)).status).toBe("succeeded");

    expect(existsSync(join(ksp, "GameData", "AnotherMod", "readme.txt"))).toBe(true);
  });

  it("rejects oversized optional selections", async () => {
    const { app } = await createInstallTestApp();
    const optional = Array.from({ length: 65 }, (_value, index) => `Mod${index}`);

    const plan = await request(app).post("/api/v1/mods/RecommendingMod/plan").send({ optional });
    const install = await request(app).post("/api/v1/mods/RecommendingMod/install").send({ optional });

    expect(plan.status).toBe(400);
    expect(install.status).toBe(400);
  });

  it.each(["MirroredMod", "TamperedMirrorMod"])(
    "falls back to the next download mirror for %s",
    async (identifier) => {
      const { app, ksp, downloads } = await createInstallTestApp();
      const accepted = await request(app).post(`/api/v1/mods/${identifier}/install`).send({});

      expect((await waitForJob(app, accepted.body.job.jobId)).status).toBe("succeeded");
      expect(readFileSync(join(ksp, "GameData", identifier, "readme.txt"), "utf8")).toContain("hello from ExampleMod");
      expect(readdirSync(downloads)).toEqual([]);
    },
  );

  it("names every mirror when none of them works", async () => {
    const { app, ksp } = await createInstallTestApp();
    const accepted = await request(app).post("/api/v1/mods/UnreachableMod/install").send({});
    const finished = await waitForJob(app, accepted.body.job.jobId);

    expect(finished.status).toBe("failed");
    expect(finished.error).toContain("https://example.test/missing.zip: Archive download failed with HTTP 404.");
    expect(finished.error).toContain("https://example.test/tampered.zip: Download SHA-256 does not match metadata.");
    expect(existsSync(join(ksp, "GameData", "UnreachableMod"))).toBe(false);
  });

  it("rejects dependency installs with pending choices", async () => {
    const { app } = await createInstallTestApp();

    const rejected = await request(app)
      .post("/api/v1/mods/RealSolarSystem/install")
      .send({ installDependencies: true });
    expect(rejected.status).toBe(409);
    expect(rejected.body.code).toBe("PLAN_NOT_READY");
    expect(rejected.body.message).toContain("RSSTextures");
  });

  it("rejects oversized choices", async () => {
    const { app } = await createInstallTestApp();
    const choices = Object.fromEntries(Array.from({ length: 65 }, (_, index) => [`key${index}`, "value"]));

    const plan = await request(app).post("/api/v1/mods/RealSolarSystem/plan").send({ choices });
    expect(plan.status).toBe(400);
    expect(plan.body.code).toBe("INVALID_REQUEST");
    const install = await request(app)
      .post("/api/v1/mods/RealSolarSystem/install")
      .send({ installDependencies: true, choices });
    expect(install.status).toBe(400);
    expect(install.body.code).toBe("INVALID_REQUEST");
  });

  it("keeps Phase 4 install behavior when installDependencies is false", async () => {
    const { app, ksp } = await createInstallTestApp();
    const accepted = await request(app).post("/api/v1/mods/DependentMod/install").send({});
    expect(accepted.status).toBe(202);
    const finished = await waitForJob(app, accepted.body.job.jobId);
    expect(finished.status).toBe("succeeded");
    expect(readFileSync(join(ksp, "GameData", "DependentMod", "readme.txt"), "utf8")).toContain("ExampleMod");
    expect(() => readFileSync(join(ksp, "GameData", "ModuleManager", "readme.txt"))).toThrow();
  });

  it("rolls back earlier modules when a later dependency install fails", async () => {
    const { app, ksp } = await createInstallTestApp();

    const accepted = await request(app)
      .post("/api/v1/mods/BrokenDependent/install")
      .send({ installDependencies: true });
    expect(accepted.status).toBe(202);
    const finished = await waitForJob(app, accepted.body.job.jobId);
    expect(finished.status).toBe("failed");

    expect(() => readFileSync(join(ksp, "GameData", "ModuleManager", "readme.txt"))).toThrow();
    expect(() => readFileSync(join(ksp, "GameData", "BrokenDependent", "readme.txt"))).toThrow();

    const inventory = await request(app).get("/api/v1/installed-mods");
    expect(inventory.body.mods.some((mod: { identifier: string }) => mod.identifier === "ModuleManager")).toBe(
      false,
    );
    expect(inventory.body.mods.some((mod: { identifier: string }) => mod.identifier === "BrokenDependent")).toBe(
      false,
    );
  });

  it("marks dependencies as auto-installed and the target as manual", async () => {
    const { app, home } = await createInstallTestApp();
    const accepted = await request(app)
      .post("/api/v1/mods/DependentMod/install")
      .send({ installDependencies: true });
    expect((await waitForJob(app, accepted.body.job.jobId)).status).toBe("succeeded");

    expect(readManifestFile(home).schemaVersion).toBe(2);
    expect(manifestRecord(home, "ModuleManager").autoInstalled).toBe(true);
    expect(manifestRecord(home, "DependentMod").autoInstalled).toBe(false);
  });

  it("keeps the auto-installed flag when a dependency is reinstalled directly", async () => {
    const { app, home } = await createInstallTestApp();
    const withDependencies = await request(app)
      .post("/api/v1/mods/DependentMod/install")
      .send({ installDependencies: true });
    expect((await waitForJob(app, withDependencies.body.job.jobId)).status).toBe("succeeded");

    const direct = await request(app).post("/api/v1/mods/ModuleManager/install").send({});
    expect((await waitForJob(app, direct.body.job.jobId)).status).toBe("succeeded");

    expect(manifestRecord(home, "ModuleManager").autoInstalled).toBe(true);
  });

  it("migrates a v1 install manifest without losing records", async () => {
    const { app, home } = await createInstallTestApp();
    const first = await request(app).post("/api/v1/mods/ExampleMod/install").send({});
    expect((await waitForJob(app, first.body.job.jobId)).status).toBe("succeeded");

    const v1Mods = readManifestFile(home).mods.map(({ autoInstalled: _autoInstalled, ...record }) => record);
    writeFileSync(join(home, "data", "install-manifest.json"), JSON.stringify({ schemaVersion: 1, mods: v1Mods }));

    const inventory = await request(app).get("/api/v1/installed-mods");
    expect(inventory.status).toBe(200);
    expect(inventory.body.mods).toEqual([
      expect.objectContaining({ identifier: "ExampleMod", status: "managed" }),
    ]);

    const second = await request(app).post("/api/v1/mods/AnotherMod/install").send({});
    expect((await waitForJob(app, second.body.job.jobId)).status).toBe("succeeded");

    expect(readManifestFile(home).schemaVersion).toBe(2);
    expect(manifestRecord(home, "ExampleMod").autoInstalled).toBe(false);
    expect(manifestRecord(home, "AnotherMod").autoInstalled).toBe(false);
  });

  it("previews an uninstall with dependents and orphans", async () => {
    const { app } = await createInstallTestApp();
    await installWithDependencies(app, "DependentMod");

    const mmPlan = await request(app).post("/api/v1/mods/ModuleManager/uninstall-plan").send({});
    expect(mmPlan.status).toBe(200);
    expect(mmPlan.body).toMatchObject({
      target: { identifier: "ModuleManager", version: "4.2.3" },
      dependents: [expect.objectContaining({ identifier: "DependentMod" })],
      orphans: [],
      brokenUnmanaged: [],
      warnings: [],
    });

    const dependentPlan = await request(app).post("/api/v1/mods/DependentMod/uninstall-plan").send({});
    expect(dependentPlan.status).toBe(200);
    expect(dependentPlan.body.dependents).toEqual([]);
    expect(dependentPlan.body.orphans).toEqual([expect.objectContaining({ identifier: "ModuleManager" })]);
  });

  it("removes dependents together with the target", async () => {
    const { app, home, ksp } = await createInstallTestApp();
    await installWithDependencies(app, "DependentMod");

    const mismatch = await request(app).post("/api/v1/mods/ModuleManager/uninstall").send({ alsoRemove: [] });
    expect(mismatch.status).toBe(409);
    expect(mismatch.body.code).toBe("UNINSTALL_PLAN_MISMATCH");
    expect(mismatch.body.message).toContain("DependentMod depends on ModuleManager");
    expect(readFileSync(join(ksp, "GameData", "ModuleManager", "readme.txt"), "utf8")).toContain("ModuleManager");
    expect(readFileSync(join(ksp, "GameData", "DependentMod", "readme.txt"), "utf8")).toContain("ExampleMod");

    const removed = await request(app)
      .post("/api/v1/mods/ModuleManager/uninstall")
      .send({ alsoRemove: ["DependentMod"] });
    expect(removed.status).toBe(200);
    expect(removed.body).toEqual({ removed: ["DependentMod", "ModuleManager"] });
    expect(() => readFileSync(join(ksp, "GameData", "ModuleManager", "readme.txt"))).toThrow();
    expect(() => readFileSync(join(ksp, "GameData", "DependentMod", "readme.txt"))).toThrow();
    expect(readManifestFile(home).mods).toEqual([]);
  });

  it("removes selected orphans and keeps deselected ones", async () => {
    const kept = await createInstallTestApp();
    await installWithDependencies(kept.app, "DependentMod");
    const keepOrphan = await request(kept.app).post("/api/v1/mods/DependentMod/uninstall").send({ alsoRemove: [] });
    expect(keepOrphan.status).toBe(200);
    expect(keepOrphan.body).toEqual({ removed: ["DependentMod"] });
    expect(readFileSync(join(kept.ksp, "GameData", "ModuleManager", "readme.txt"), "utf8")).toContain(
      "ModuleManager",
    );
    expect(readManifestFile(kept.home).mods.map((mod) => mod.identifier)).toEqual(["ModuleManager"]);

    const cleaned = await createInstallTestApp();
    await installWithDependencies(cleaned.app, "DependentMod");
    const removeOrphan = await request(cleaned.app)
      .post("/api/v1/mods/DependentMod/uninstall")
      .send({ alsoRemove: ["ModuleManager"] });
    expect(removeOrphan.status).toBe(200);
    expect(removeOrphan.body).toEqual({ removed: ["DependentMod", "ModuleManager"] });
    expect(() => readFileSync(join(cleaned.ksp, "GameData", "ModuleManager", "readme.txt"))).toThrow();
    expect(readManifestFile(cleaned.home).mods).toEqual([]);
  });

  it("keeps other installations out of the uninstall plan", async () => {
    const { app, home, ksp } = await createInstallTestApp();
    await installWithDependencies(app, "DependentMod");

    const secondKsp = join(home, "SecondKSP");
    mkdirSync(join(secondKsp, "GameData"), { recursive: true });
    writeFileSync(join(secondKsp, "KSP.x86_64"), "");
    writeFileSync(join(secondKsp, "readme.txt"), "Version 1.12.5");
    await request(app).put("/api/v1/config").send({ installationPath: secondKsp });
    const direct = await request(app).post("/api/v1/mods/ModuleManager/install").send({});
    expect((await waitForJob(app, direct.body.job.jobId)).status).toBe("succeeded");

    const plan = await request(app).post("/api/v1/mods/ModuleManager/uninstall-plan").send({});
    expect(plan.status).toBe(200);
    expect(plan.body.dependents).toEqual([]);
    expect(plan.body.orphans).toEqual([]);

    const removed = await request(app).post("/api/v1/mods/ModuleManager/uninstall").send({});
    expect(removed.status).toBe(200);
    expect(removed.body).toEqual({ removed: ["ModuleManager"] });
    expect(() => readFileSync(join(secondKsp, "GameData", "ModuleManager", "readme.txt"))).toThrow();
    expect(readFileSync(join(ksp, "GameData", "ModuleManager", "readme.txt"), "utf8")).toContain("ModuleManager");
    expect(readManifestFile(home).mods.map((mod) => mod.identifier).sort()).toEqual(["DependentMod", "ModuleManager"]);
  });

  it("refuses to plan or run an uninstall while an install is in progress", async () => {
    let release: () => void = () => undefined;
    const until = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { app, home } = await createInstallTestApp({
      holdDownload: { url: "https://example.test/DependentMod.zip", until },
    });
    const example = await request(app).post("/api/v1/mods/ExampleMod/install").send({});
    expect((await waitForJob(app, example.body.job.jobId)).status).toBe("succeeded");

    const pending = await request(app).post("/api/v1/mods/DependentMod/install").send({ installDependencies: true });
    expect(pending.status).toBe(202);
    await vi.waitFor(() => expect(readManifestFile(home).mods.map((mod) => mod.identifier)).toContain("ModuleManager"));

    const plan = await request(app).post("/api/v1/mods/ExampleMod/uninstall-plan").send({});
    expect(plan.status).toBe(409);
    expect(plan.body.code).toBe("INSTALL_IN_PROGRESS");
    const removed = await request(app).post("/api/v1/mods/ExampleMod/uninstall").send({ alsoRemove: ["ModuleManager"] });
    expect(removed.status).toBe(409);
    expect(removed.body.code).toBe("INSTALL_IN_PROGRESS");

    release();
    expect((await waitForJob(app, pending.body.job.jobId)).status).toBe("succeeded");
    expect(manifestRecord(home, "ModuleManager").autoInstalled).toBe(true);
    const after = await request(app).post("/api/v1/mods/ExampleMod/uninstall").send({});
    expect(after.status).toBe(200);
  });

  it("no longer removes mods through DELETE", async () => {
    const { app, ksp } = await createInstallTestApp();
    const accepted = await request(app).post("/api/v1/mods/ExampleMod/install").send({});
    expect((await waitForJob(app, accepted.body.job.jobId)).status).toBe("succeeded");

    const removed = await request(app).delete("/api/v1/mods/ExampleMod");
    expect(removed.status).toBe(404);
    expect(readFileSync(join(ksp, "GameData", "ExampleMod", "readme.txt"), "utf8")).toContain("hello from ExampleMod");
  });

  it("rejects uninstall plans for unmanaged mods", async () => {
    const { app, ksp } = await createInstallTestApp();
    mkdirSync(join(ksp, "GameData", "DetectedOnly"), { recursive: true });

    const plan = await request(app).post("/api/v1/mods/DetectedOnly/uninstall-plan").send({});
    expect(plan.status).toBe(422);
    expect(plan.body.code).toBe("NOT_MANAGED");
  });

  it("rejects oversized uninstall selections", async () => {
    const { app } = await createInstallTestApp();
    const response = await request(app)
      .post("/api/v1/mods/ExampleMod/uninstall")
      .send({ alsoRemove: Array.from({ length: 257 }, (_, index) => `Mod${index}`) });
    expect(response.status).toBe(400);
    expect(response.body.code).toBe("INVALID_REQUEST");
  });

  it("does not offer updates that need a newer KSP", async () => {
    const { app } = await createInstallTestApp();
    const accepted = await request(app).post("/api/v1/mods/LegacyMod/install").send({ version: "1.0.0" });
    expect((await waitForJob(app, accepted.body.job.jobId)).status).toBe("succeeded");

    const updates = await request(app).get("/api/v1/updates");
    expect(updates.status).toBe(200);
    expect(updates.body.updates).toEqual([]);
  });

  it("restores the previous version from the disk backup when a reinstall fails", async () => {
    const first = fixtureModZip("NoHashMod");
    const corrupt = declareEntrySize(
      zipSync({
        "GameData/NoHashMod/readme.txt": new TextEncoder().encode("version two\n"),
        "GameData/NoHashMod/plugin.dll": new TextEncoder().encode("new-dll-content"),
      }),
      1,
      3,
    );
    const { app, home, ksp, downloads } = await createInstallTestApp({ noHashArchives: [first, corrupt] });
    const installed = await request(app).post("/api/v1/mods/NoHashMod/install").send({});
    expect((await waitForJob(app, installed.body.job.jobId)).status).toBe("succeeded");
    writeFileSync(join(ksp, "GameData", "NoHashMod", "readme.txt"), "edited by the user");
    const recordBefore = manifestRecord(home, "NoHashMod");

    const reinstall = await request(app).post("/api/v1/mods/NoHashMod/install").send({});
    const finished = await waitForJob(app, reinstall.body.job.jobId);

    expect(finished.status).toBe("failed");
    expect(readFileSync(join(ksp, "GameData", "NoHashMod", "readme.txt"), "utf8")).toBe("edited by the user");
    expect(readFileSync(join(ksp, "GameData", "NoHashMod", "plugin.dll"), "utf8")).toBe("fake-dll");
    expect(manifestRecord(home, "NoHashMod")).toEqual(recordBefore);
    expect(existsSync(join(ksp, ".kraken-backup"))).toBe(false);
    expect(readdirSync(downloads)).toEqual([]);
  });

  it("leaves no backup or downloaded archive behind after a successful update", async () => {
    const { app, ksp, downloads } = await createInstallTestApp();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const accepted = await request(app).post("/api/v1/mods/ExampleMod/install").send({});
      expect((await waitForJob(app, accepted.body.job.jobId)).status).toBe("succeeded");
    }

    expect(readFileSync(join(ksp, "GameData", "ExampleMod", "readme.txt"), "utf8")).toContain("hello from ExampleMod");
    expect(existsSync(join(ksp, ".kraken-backup"))).toBe(false);
    expect(readdirSync(downloads)).toEqual([]);
  });

  it("removes leftover downloads at startup and keeps interrupted backups", async () => {
    const { installService, ksp, downloads } = await createInstallTestApp();
    mkdirSync(downloads, { recursive: true });
    const hash = "a".repeat(64);
    writeFileSync(join(downloads, `${hash}.zip`), "old cached archive");
    writeFileSync(join(downloads, `${hash}.zip.0b1c2d3e-0000-4000-8000-000000000000.partial`), "half");
    writeFileSync(join(downloads, `${hash}.zip.0b1c2d3e-0000-4000-8000-000000000001.download`), "half");
    writeFileSync(join(downloads, "notes.txt"), "not ours");
    const backup = join(ksp, ".kraken-backup", "0b1c2d3e-0000-4000-8000-000000000002", "GameData", "Mod");
    mkdirSync(backup, { recursive: true });
    writeFileSync(join(backup, "file.cfg"), "user data");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    try {
      await installService.cleanupTemporaryFiles([ksp]);

      expect(readdirSync(downloads)).toEqual(["notes.txt"]);
      expect(readFileSync(join(backup, "file.cfg"), "utf8")).toBe("user data");
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("without an install journal"));
      expect(installService.getRecoveryReport().untrackedBackups).toEqual([
        { installationPath: realpathSync(ksp), count: 1, directory: join(ksp, ".kraken-backup") },
      ]);
    } finally {
      warn.mockRestore();
    }
  });

  it("lists available updates for managed mods with older versions", async () => {
    const { app, home } = await createInstallTestApp();
    const accepted = await request(app).post("/api/v1/mods/ExampleMod/install").send({});
    await waitForJob(app, accepted.body.job.jobId);

    const manifestPath = join(home, "data", "install-manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      mods: Array<{ identifier: string; version: string }>;
    };
    const example = manifest.mods.find((mod) => mod.identifier === "ExampleMod");
    expect(example).toBeDefined();
    example!.version = "0.9.0";
    writeFileSync(manifestPath, JSON.stringify(manifest));

    const updates = await request(app).get("/api/v1/updates");
    expect(updates.status).toBe(200);
    expect(updates.body.updates).toEqual([
      {
        identifier: "ExampleMod",
        name: "Example Mod",
        installedVersion: "0.9.0",
        availableVersion: "1.0.0",
      },
    ]);
  });
});

async function startCrashingInstall(
  app: ReturnType<typeof createApp>,
  zip: CrashingZip,
  identifier: string,
  body: object = {},
): Promise<string> {
  const accepted = await request(app).post(`/api/v1/mods/${identifier}/install`).send(body);
  expect(accepted.status).toBe(202);
  await zip.crashed;
  return accepted.body.job.jobId;
}

function createKspFolder(home: string, name: string): string {
  const path = join(home, name);
  mkdirSync(join(path, "GameData"), { recursive: true });
  writeFileSync(join(path, "KSP.x86_64"), "");
  writeFileSync(join(path, "readme.txt"), "Version 1.12.5");
  return path;
}

function writeJournal(ksp: string, jobId: string, lines: readonly object[]): string {
  const backupRoot = join(ksp, ".kraken-backup");
  mkdirSync(backupRoot, { recursive: true });
  const path = join(backupRoot, `job-${jobId}.jsonl`);
  writeFileSync(path, lines.map((line) => `${JSON.stringify(line)}\n`).join(""));
  return path;
}

// A process id that cannot exist, so the journal reads as left by a dead process.
const JOURNAL_HEADER = { type: "journal", schemaVersion: 1, pid: 99_999_999 };

function ageJournal(path: string): void {
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
  utimesSync(path, tenMinutesAgo, tenMinutesAgo);
}

describe("interrupted install recovery", () => {
  it("reports nothing when no install was interrupted", async () => {
    const { app, installService, ksp } = await createInstallTestApp();
    await installService.cleanupTemporaryFiles([ksp]);

    const report = await request(app).get("/api/v1/install-recovery");
    expect(report.status).toBe(200);
    expect(report.body).toEqual({ rolledBack: [], failed: [], activeInstallationPath: realpathSync(ksp) });
  });

  it("removes the files of an interrupted first install at the next start", async () => {
    const zip = new CrashingZip(1, 1);
    const { app, home, ksp, restart } = await createInstallTestApp({ zip });
    const jobId = await startCrashingInstall(app, zip, "ExampleMod");
    expect(readdirSync(join(ksp, "GameData", "ExampleMod"))).toHaveLength(1);

    const restarted = restart();
    await restarted.installService.cleanupTemporaryFiles([ksp]);

    expect(existsSync(join(ksp, "GameData", "ExampleMod"))).toBe(false);
    expect(existsSync(join(ksp, ".kraken-backup"))).toBe(false);
    expect(readManifestFile(home).mods).toEqual([]);
    const report = await request(restarted.app).get("/api/v1/install-recovery");
    expect(report.body).toEqual({
      rolledBack: [
        { jobId, installationPath: realpathSync(ksp), modules: [{ identifier: "ExampleMod", name: "Example Mod" }] },
      ],
      failed: [],
      activeInstallationPath: realpathSync(ksp),
    });
  });

  it("undoes an interrupted install in an installation that is not active", async () => {
    const zip = new CrashingZip(1, 1);
    const { app, home, ksp, restart } = await createInstallTestApp({ zip });
    const jobId = await startCrashingInstall(app, zip, "ExampleMod");
    const otherKsp = createKspFolder(home, "OtherKSP");
    await request(app).put("/api/v1/config").send({ installationPath: otherKsp });

    const restarted = restart();
    await restarted.installService.cleanupTemporaryFiles([otherKsp, ksp]);

    expect(existsSync(join(ksp, "GameData", "ExampleMod"))).toBe(false);
    expect(existsSync(join(ksp, ".kraken-backup"))).toBe(false);
    expect(restarted.installService.getRecoveryReport()).toEqual({
      rolledBack: [
        { jobId, installationPath: realpathSync(ksp), modules: [{ identifier: "ExampleMod", name: "Example Mod" }] },
      ],
      failed: [],
      activeInstallationPath: realpathSync(otherKsp),
    });
  });

  it("recovers an installation listed in two spellings once", async () => {
    const zip = new CrashingZip(1, 1);
    const { app, ksp, restart } = await createInstallTestApp({ zip });
    await startCrashingInstall(app, zip, "ExampleMod");

    const restarted = restart();
    await restarted.installService.cleanupTemporaryFiles([`${ksp}/`, ksp, realpathSync(ksp)]);

    const report = restarted.installService.getRecoveryReport();
    expect(report.rolledBack).toHaveLength(1);
    expect(report.failed).toEqual([]);
    expect(report.activeInstallationPath).toBe(realpathSync(ksp));
  });

  it("skips an installation folder that no longer exists", async () => {
    const { installService, home, ksp } = await createInstallTestApp();
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    try {
      await installService.cleanupTemporaryFiles([ksp, join(home, "Gone")]);

      expect(info).toHaveBeenCalledWith(expect.stringContaining(join(home, "Gone")));
    } finally {
      info.mockRestore();
    }
    expect(installService.getRecoveryReport()).toEqual({
      rolledBack: [],
      failed: [],
      activeInstallationPath: realpathSync(ksp),
    });
  });

  it("keeps recovering other installations when one fails", async () => {
    const zip = new CrashingZip(1, 1);
    const { app, home, ksp, restart } = await createInstallTestApp({ zip });
    const jobId = await startCrashingInstall(app, zip, "ExampleMod");
    const brokenKsp = createKspFolder(home, "BrokenKSP");
    writeFileSync(join(brokenKsp, ".kraken-backup"), "not a directory");

    const restarted = restart();
    await restarted.installService.cleanupTemporaryFiles([brokenKsp, ksp]);

    expect(existsSync(join(ksp, "GameData", "ExampleMod"))).toBe(false);
    const report = restarted.installService.getRecoveryReport();
    expect(report.rolledBack.map((entry) => entry.jobId)).toEqual([jobId]);
    expect(report.failed).toEqual([{ installationPath: brokenKsp, message: expect.any(String) }]);
    expect(report.activeInstallationPath).toBe(realpathSync(brokenKsp));
  });

  it("brings back the previous version after an interrupted update", async () => {
    const zip = new CrashingZip(2, 1);
    const second = zipSync({
      "GameData/NoHashMod/readme.txt": new TextEncoder().encode("version two\n"),
      "GameData/NoHashMod/plugin.dll": new TextEncoder().encode("new-dll"),
    });
    const { app, home, ksp, restart } = await createInstallTestApp({
      zip,
      noHashArchives: [fixtureModZip("NoHashMod"), second],
    });
    const first = await request(app).post("/api/v1/mods/NoHashMod/install").send({});
    expect((await waitForJob(app, first.body.job.jobId)).status).toBe("succeeded");
    writeFileSync(join(ksp, "GameData", "NoHashMod", "readme.txt"), "edited by the user");
    const recordBefore = manifestRecord(home, "NoHashMod");

    const jobId = await startCrashingInstall(app, zip, "NoHashMod");
    const restarted = restart();
    await restarted.installService.cleanupTemporaryFiles([ksp]);

    expect(readFileSync(join(ksp, "GameData", "NoHashMod", "readme.txt"), "utf8")).toBe("edited by the user");
    expect(readFileSync(join(ksp, "GameData", "NoHashMod", "plugin.dll"), "utf8")).toBe("fake-dll");
    expect(manifestRecord(home, "NoHashMod")).toEqual(recordBefore);
    expect(existsSync(join(ksp, ".kraken-backup"))).toBe(false);
    expect(restarted.installService.getRecoveryReport().rolledBack).toEqual([
      {
        jobId,
        installationPath: realpathSync(ksp),
        modules: [{ identifier: "NoHashMod", name: "No Hash Mod", restoredVersion: "1.0.0" }],
      },
    ]);
  });

  it("restores moved files when the interruption came before any new file was written", async () => {
    const zip = new CrashingZip(2, 0);
    const { app, home, ksp, restart } = await createInstallTestApp({ zip });
    const first = await request(app).post("/api/v1/mods/ExampleMod/install").send({});
    expect((await waitForJob(app, first.body.job.jobId)).status).toBe("succeeded");
    const recordBefore = manifestRecord(home, "ExampleMod");

    await startCrashingInstall(app, zip, "ExampleMod");
    expect(existsSync(join(ksp, "GameData", "ExampleMod", "readme.txt"))).toBe(false);
    const restarted = restart();
    await restarted.installService.cleanupTemporaryFiles([ksp]);

    expect(readFileSync(join(ksp, "GameData", "ExampleMod", "readme.txt"), "utf8")).toContain("hello from ExampleMod");
    expect(readFileSync(join(ksp, "GameData", "ExampleMod", "plugin.dll"), "utf8")).toBe("fake-dll");
    expect(manifestRecord(home, "ExampleMod")).toEqual(recordBefore);
  });

  it("rolls back every module of an interrupted dependency install", async () => {
    const zip = new CrashingZip(2, 1);
    const { app, home, ksp, restart } = await createInstallTestApp({ zip });
    const jobId = await startCrashingInstall(app, zip, "DependentMod", { installDependencies: true });
    expect(manifestRecord(home, "ModuleManager").version).toBe("4.2.3");

    const restarted = restart();
    await restarted.installService.cleanupTemporaryFiles([ksp]);

    expect(existsSync(join(ksp, "GameData", "ModuleManager"))).toBe(false);
    expect(existsSync(join(ksp, "GameData", "DependentMod"))).toBe(false);
    expect(readManifestFile(home).mods).toEqual([]);
    expect(restarted.installService.getRecoveryReport().rolledBack).toEqual([
      {
        jobId,
        installationPath: realpathSync(ksp),
        modules: [
          { identifier: "ModuleManager", name: "Module Manager" },
          { identifier: "DependentMod", name: "Dependent Mod" },
        ],
      },
    ]);
  });

  it("finishes the cleanup of an install that had already completed", async () => {
    const { app, installService, ksp, home } = await createInstallTestApp();
    const installed = await request(app).post("/api/v1/mods/ExampleMod/install").send({});
    expect((await waitForJob(app, installed.body.job.jobId)).status).toBe("succeeded");
    const backupId = "0b1c2d3e-0000-4000-8000-000000000003";
    mkdirSync(join(ksp, ".kraken-backup", backupId, "GameData", "ExampleMod"), { recursive: true });
    writeFileSync(join(ksp, ".kraken-backup", backupId, "GameData", "ExampleMod", "readme.txt"), "old version");
    writeJournal(ksp, "0b1c2d3e-0000-4000-8000-000000000004", [
      JOURNAL_HEADER,
      { type: "module", identifier: "ExampleMod", name: "Example Mod", backupId, previousRecord: null },
      { type: "file", path: "GameData/ExampleMod/readme.txt" },
      { type: "committed" },
    ]);
    const recordBefore = manifestRecord(home, "ExampleMod");

    await installService.cleanupTemporaryFiles([ksp]);

    expect(existsSync(join(ksp, ".kraken-backup"))).toBe(false);
    expect(readFileSync(join(ksp, "GameData", "ExampleMod", "readme.txt"), "utf8")).toContain("hello from ExampleMod");
    expect(manifestRecord(home, "ExampleMod")).toEqual(recordBefore);
    expect(installService.getRecoveryReport()).toEqual({
      rolledBack: [],
      failed: [],
      activeInstallationPath: realpathSync(ksp),
    });
  });

  it("leaves a journal it cannot read untouched and reports it", async () => {
    const { installService, ksp } = await createInstallTestApp();
    const backupRoot = join(ksp, ".kraken-backup");
    mkdirSync(join(backupRoot, "0b1c2d3e-0000-4000-8000-000000000005"), { recursive: true });
    const journal = join(backupRoot, "job-0b1c2d3e-0000-4000-8000-000000000006.jsonl");
    writeFileSync(journal, "not json\n{}\n");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    try {
      await installService.cleanupTemporaryFiles([ksp]);
    } finally {
      warn.mockRestore();
    }

    expect(readFileSync(journal, "utf8")).toBe("not json\n{}\n");
    expect(existsSync(join(backupRoot, "0b1c2d3e-0000-4000-8000-000000000005"))).toBe(true);
    expect(installService.getRecoveryReport().failed).toEqual([
      { jobId: "0b1c2d3e-0000-4000-8000-000000000006", installationPath: realpathSync(ksp), message: expect.stringContaining("journal") },
    ]);
  });

  it.each([
    ["a file path outside the allowed roots", "../outside.txt", "0b1c2d3e-0000-4000-8000-000000000007"],
    ["a backup folder outside the backup root", "GameData/Mod/file.cfg", "../../outside"],
  ])("refuses a journal with %s", async (_label, filePath, backupId) => {
    const { installService, ksp, home } = await createInstallTestApp();
    writeFileSync(join(home, "outside.txt"), "keep me");
    const journal = writeJournal(ksp, "0b1c2d3e-0000-4000-8000-000000000008", [
      JOURNAL_HEADER,
      { type: "module", identifier: "Mod", name: "Mod", backupId, previousRecord: null },
      { type: "file", path: filePath },
    ]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    try {
      await installService.cleanupTemporaryFiles([ksp]);
    } finally {
      warn.mockRestore();
    }

    expect(readFileSync(join(home, "outside.txt"), "utf8")).toBe("keep me");
    expect(existsSync(journal)).toBe(true);
    expect(installService.getRecoveryReport().failed).toHaveLength(1);
  });

  it("leaves the journal of a Kraken process that is still running alone", async () => {
    const { installService, ksp } = await createInstallTestApp();
    const journal = writeJournal(ksp, "0b1c2d3e-0000-4000-8000-000000000009", [
      { ...JOURNAL_HEADER, pid: process.ppid },
      { type: "module", identifier: "Mod", name: "Mod", backupId: "0b1c2d3e-0000-4000-8000-00000000000a", previousRecord: null },
      { type: "file", path: "GameData/Mod/file.cfg" },
    ]);
    mkdirSync(join(ksp, "GameData", "Mod"), { recursive: true });
    writeFileSync(join(ksp, "GameData", "Mod", "file.cfg"), "being installed");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    try {
      await installService.cleanupTemporaryFiles([ksp]);
    } finally {
      warn.mockRestore();
    }

    expect(readFileSync(join(ksp, "GameData", "Mod", "file.cfg"), "utf8")).toBe("being installed");
    expect(existsSync(journal)).toBe(true);
    expect(installService.getRecoveryReport().failed).toEqual([
      { jobId: "0b1c2d3e-0000-4000-8000-000000000009", installationPath: realpathSync(ksp), message: expect.stringContaining("still running") },
    ]);
  });

  it("removes an empty journal left by a crash while it was created", async () => {
    const { installService, ksp } = await createInstallTestApp();
    const journal = writeJournal(ksp, "0b1c2d3e-0000-4000-8000-00000000000b", []);
    ageJournal(journal);
    expect(readFileSync(journal, "utf8")).toBe("");
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

    try {
      await installService.cleanupTemporaryFiles([ksp]);
    } finally {
      info.mockRestore();
    }

    expect(existsSync(journal)).toBe(false);
    expect(existsSync(join(ksp, ".kraken-backup"))).toBe(false);
    expect(installService.getRecoveryReport()).toEqual({
      rolledBack: [],
      failed: [],
      activeInstallationPath: realpathSync(ksp),
    });
  });

  it("removes a header-only journal of a process that is gone", async () => {
    const { installService, ksp } = await createInstallTestApp();
    const journal = writeJournal(ksp, "0b1c2d3e-0000-4000-8000-00000000000c", [JOURNAL_HEADER]);
    ageJournal(journal);
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

    try {
      await installService.cleanupTemporaryFiles([ksp]);
    } finally {
      info.mockRestore();
    }

    expect(existsSync(journal)).toBe(false);
    expect(installService.getRecoveryReport()).toEqual({
      rolledBack: [],
      failed: [],
      activeInstallationPath: realpathSync(ksp),
    });
  });

  it("recovers a journal whose process id is reused by another live process", async () => {
    const { installService, ksp } = await createInstallTestApp();
    const journal = writeJournal(ksp, "0b1c2d3e-0000-4000-8000-00000000000d", [
      { ...JOURNAL_HEADER, pid: process.ppid },
      { type: "module", identifier: "Mod", name: "Mod", backupId: "0b1c2d3e-0000-4000-8000-00000000000e", previousRecord: null },
      { type: "file", path: "GameData/Mod/file.cfg" },
    ]);
    ageJournal(journal);
    mkdirSync(join(ksp, "GameData", "Mod"), { recursive: true });
    writeFileSync(join(ksp, "GameData", "Mod", "file.cfg"), "left by the dead job");

    await installService.cleanupTemporaryFiles([ksp], { recheckDelayMs: 50 });

    expect(existsSync(join(ksp, "GameData", "Mod", "file.cfg"))).toBe(false);
    expect(existsSync(journal)).toBe(false);
    expect(installService.getRecoveryReport().rolledBack).toHaveLength(1);
  });

  it("leaves a live process's journal alone when its heartbeat resumes during the recheck", async () => {
    const { installService, ksp } = await createInstallTestApp();
    const journal = writeJournal(ksp, "0b1c2d3e-0000-4000-8000-000000000010", [
      { ...JOURNAL_HEADER, pid: process.ppid },
      { type: "module", identifier: "Mod", name: "Mod", backupId: "0b1c2d3e-0000-4000-8000-000000000011", previousRecord: null },
      { type: "file", path: "GameData/Mod/file.cfg" },
    ]);
    ageJournal(journal);
    mkdirSync(join(ksp, "GameData", "Mod"), { recursive: true });
    writeFileSync(join(ksp, "GameData", "Mod", "file.cfg"), "being installed");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const heartbeat = setTimeout(() => {
      const now = new Date();
      utimesSync(journal, now, now);
    }, 20);

    try {
      await installService.cleanupTemporaryFiles([ksp], { recheckDelayMs: 150 });
    } finally {
      clearTimeout(heartbeat);
      warn.mockRestore();
    }

    expect(readFileSync(join(ksp, "GameData", "Mod", "file.cfg"), "utf8")).toBe("being installed");
    expect(existsSync(journal)).toBe(true);
    expect(installService.getRecoveryReport().failed).toEqual([
      { jobId: "0b1c2d3e-0000-4000-8000-000000000010", installationPath: realpathSync(ksp), message: expect.stringContaining("still running") },
    ]);
  });

  it("keeps a module-less journal that was touched recently", async () => {
    const { installService, ksp } = await createInstallTestApp();
    const journal = writeJournal(ksp, "0b1c2d3e-0000-4000-8000-000000000012", [JOURNAL_HEADER]);

    await installService.cleanupTemporaryFiles([ksp]);

    expect(existsSync(journal)).toBe(true);
    expect(installService.getRecoveryReport()).toEqual({
      rolledBack: [],
      failed: [],
      activeInstallationPath: realpathSync(ksp),
    });
  });

  it("keeps no journal after an install that fails and rolls back", async () => {
    const { app, ksp } = await createInstallTestApp();
    const accepted = await request(app)
      .post("/api/v1/mods/BrokenDependent/install")
      .send({ installDependencies: true });
    expect((await waitForJob(app, accepted.body.job.jobId)).status).toBe("failed");

    expect(existsSync(join(ksp, ".kraken-backup"))).toBe(false);
  });
});

describe("metapackages", () => {
  it("installs a metapackage as a file-less record with automatic dependencies", async () => {
    const { app, home, ksp } = await createInstallTestApp();
    const accepted = await request(app).post("/api/v1/mods/ExamplePack/install").send({});
    expect(accepted.status).toBe(202);
    expect((await waitForJob(app, accepted.body.job.jobId)).status).toBe("succeeded");

    expect(existsSync(join(ksp, "GameData", "ModuleManager"))).toBe(true);
    expect(existsSync(join(ksp, "GameData", "AnotherMod"))).toBe(true);
    expect(manifestRecord(home, "ExamplePack")).toMatchObject({ files: [], autoInstalled: false });
    expect(manifestRecord(home, "ModuleManager")).toMatchObject({ autoInstalled: true });
    expect(manifestRecord(home, "AnotherMod")).toMatchObject({ autoInstalled: true });
    const inventory = await request(app).get("/api/v1/installed-mods");
    expect(inventory.body.mods).toContainEqual(
      expect.objectContaining({ identifier: "ExamplePack", status: "managed" }),
    );
  });

  it("installs a mod that depends on a metapackage", async () => {
    const { app, home } = await createInstallTestApp();
    await installWithDependencies(app, "NestedPack");

    expect(manifestRecord(home, "ExamplePack")).toMatchObject({ files: [], autoInstalled: true });
    expect(manifestRecord(home, "NestedPack")).toMatchObject({ autoInstalled: false });
  });

  it("offers a newer metapackage as an update", async () => {
    const { app } = await createInstallTestApp();
    const accepted = await request(app).post("/api/v1/mods/ExamplePack/install").send({ version: "1.0.0" });
    expect((await waitForJob(app, accepted.body.job.jobId)).status).toBe("succeeded");

    const updates = await request(app).get("/api/v1/updates");
    expect(updates.body.updates).toContainEqual(
      expect.objectContaining({ identifier: "ExamplePack", installedVersion: "1.0.0", availableVersion: "2.0.0" }),
    );
  });

  it("offers a metapackage's dependencies as orphans when it is uninstalled", async () => {
    const { app } = await createInstallTestApp();
    const accepted = await request(app).post("/api/v1/mods/ExamplePack/install").send({});
    expect((await waitForJob(app, accepted.body.job.jobId)).status).toBe("succeeded");

    const plan = await request(app).post("/api/v1/mods/ExamplePack/uninstall-plan").send({});
    expect(plan.status).toBe(200);
    expect(plan.body.orphans).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ identifier: "ModuleManager" }),
        expect.objectContaining({ identifier: "AnotherMod" }),
      ]),
    );
  });

  it("rolls back an interrupted install after a metapackage was recorded", async () => {
    // Install order: ModuleManager (extract 1), AnotherMod (2), ExamplePack
    // (recorded, no extraction), NestedPack (3, crashes).
    const zip = new CrashingZip(3, 1);
    const { app, home, ksp, restart } = await createInstallTestApp({ zip });
    await startCrashingInstall(app, zip, "NestedPack", { installDependencies: true });
    expect(manifestRecord(home, "ExamplePack")).toMatchObject({ files: [] });

    const restarted = restart();
    await restarted.installService.cleanupTemporaryFiles([ksp]);

    expect(readManifestFile(home).mods).toEqual([]);
    expect(existsSync(join(ksp, "GameData", "ModuleManager"))).toBe(false);
    expect(existsSync(join(ksp, "GameData", "AnotherMod"))).toBe(false);
    expect(existsSync(join(ksp, "GameData", "NestedPack"))).toBe(false);
  });

  it("still rejects a regular dependency without a download", async () => {
    const { app } = await createInstallTestApp();
    const response = await request(app).post("/api/v1/mods/NeedsBare/install").send({ installDependencies: true });
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
    expect(response.body.code).toBe("NO_DOWNLOAD");
  });

  it("does not install DLC", async () => {
    const { app } = await createInstallTestApp();
    const response = await request(app).post("/api/v1/mods/DlcThing/install").send({});
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
    expect(response.body.code).toBe("NO_DOWNLOAD");
  });
});
