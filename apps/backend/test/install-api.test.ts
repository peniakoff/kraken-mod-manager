import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
import {
  MAX_ZIP_ENTRY_BYTES,
  MAX_ZIP_TOTAL_BYTES,
  ZipArchive,
} from "../src/adapters/zip-archive.js";
import { createApp } from "../src/app.js";
import { DirectoryBrowser } from "../src/directory-browser.js";
import { InstallService } from "../src/install-service.js";
import { JobStore } from "../src/job-store.js";
import { RegistryService } from "../src/registry-service.js";
import { gzipSync } from "node:zlib";

function fixtureModZip(folder = "ExampleMod"): Uint8Array {
  return zipSync({
    [`GameData/${folder}/readme.txt`]: new TextEncoder().encode(`hello from ${folder}\n`),
    [`GameData/${folder}/plugin.dll`]: new TextEncoder().encode("fake-dll"),
  });
}

function setFirstDeclaredZipSize(archive: Uint8Array, size: number): Uint8Array {
  const copy = archive.slice();
  const view = new DataView(copy.buffer, copy.byteOffset, copy.byteLength);
  for (let offset = 0; offset <= copy.byteLength - 28; offset += 1) {
    if (view.getUint32(offset, true) === 0x02014b50) {
      view.setUint32(offset + 24, size, true);
      return copy;
    }
  }
  throw new Error("ZIP central directory was not found");
}

function setAllDeclaredZipSizes(archive: Uint8Array, size: number): Uint8Array {
  const copy = archive.slice();
  const view = new DataView(copy.buffer, copy.byteOffset, copy.byteLength);
  let found = 0;
  for (let offset = 0; offset <= copy.byteLength - 28; offset += 1) {
    if (view.getUint32(offset, true) === 0x02014b50) {
      view.setUint32(offset + 24, size, true);
      found += 1;
    }
  }
  if (found === 0) {
    throw new Error("ZIP central directory was not found");
  }
  return copy;
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
    if (
      url === "https://example.test/ExampleMod.zip" ||
      url === "https://example.test/AnotherMod.zip" ||
      url === "https://example.test/DependentMod.zip" ||
      url === "https://example.test/BrokenDependent.zip" ||
      url === "https://example.test/RealSolarSystem.zip" ||
      url === "https://example.test/RSSTextures4096.zip" ||
      url === "https://example.test/RSSTextures8192.zip"
    ) {
      return new Response(Buffer.from(zipBytes), {
        status: 200,
        headers: { "content-length": String(zipBytes.byteLength) },
      });
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
    new ZipArchive(),
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

  await request(app).put("/api/v1/config").send({ installationPath: ksp });
  await request(app).post("/api/v1/registry/refresh");

  return { app, home, ksp, sha256: exampleHash.sha256 };
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
  mods: Array<{ identifier: string; installationPath: string; autoInstalled?: boolean }>;
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

  it("rejects zip slip and hash mismatches", async () => {
    const zipArchive = new ZipArchive();
    expect(() =>
      zipArchive.extractFiles(
        zipSync({
          "../evil.txt": new TextEncoder().encode("nope"),
        }),
      ),
    ).toThrow(/unsafe/i);
    expect(() =>
      zipArchive.extractFiles(
        setFirstDeclaredZipSize(
          zipSync({ "GameData/TooLarge/file.bin": new TextEncoder().encode("small") }),
          MAX_ZIP_ENTRY_BYTES + 1,
        ),
      ),
    ).toThrow(/size limit/i);

    // Bundled KSP zips can declare ~226 MiB total (above the old 200 MiB cap).
    const bundledLike = setFirstDeclaredZipSize(
      zipSync({ "GameData/Bundled/file.bin": new TextEncoder().encode("small") }),
      250 * 1024 * 1024,
    );
    expect(zipArchive.extractFiles(bundledLike)).toEqual([
      { path: "GameData/Bundled/file.bin", data: new TextEncoder().encode("small") },
    ]);

    // Multiple entries whose declared sizes sum past the total archive cap.
    const manyFiles: Record<string, Uint8Array> = {};
    const filesNeeded = Math.floor(MAX_ZIP_TOTAL_BYTES / MAX_ZIP_ENTRY_BYTES) + 1;
    for (let index = 0; index < filesNeeded; index += 1) {
      manyFiles[`GameData/Huge/file-${index}.bin`] = new TextEncoder().encode(`f${index}`);
    }
    expect(() => zipArchive.extractFiles(setAllDeclaredZipSizes(zipSync(manyFiles), MAX_ZIP_ENTRY_BYTES))).toThrow(
      /total size limit/i,
    );

    expect(zipArchive.extractFiles(zipSync({ "GameData/Empty/file.txt": new Uint8Array() }))).toEqual([
      { path: "GameData/Empty/file.txt", data: new Uint8Array() },
    ]);

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
