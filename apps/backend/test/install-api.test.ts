import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync } from "fflate";
import request from "supertest";
import { describe, expect, it } from "vitest";
import type { HttpPort, PlatformPort } from "@kraken/core";
import { ConfigStore } from "../src/adapters/config-store.js";
import { InstallManifestStore } from "../src/adapters/install-manifest-store.js";
import { NodeFileSystem } from "../src/adapters/node-file-system.js";
import { RegistryCacheStore } from "../src/adapters/registry-cache-store.js";
import { StreamingHttp } from "../src/adapters/streaming-http.js";
import { packUstar, TarGzArchive } from "../src/adapters/tar-gz-archive.js";
import { ZipArchive } from "../src/adapters/zip-archive.js";
import { createApp } from "../src/app.js";
import { DirectoryBrowser } from "../src/directory-browser.js";
import { InstallService } from "../src/install-service.js";
import { JobStore } from "../src/job-store.js";
import { RegistryService } from "../src/registry-service.js";
import { gzipSync } from "node:zlib";

function fixtureModZip(): Uint8Array {
  return zipSync({
    "GameData/ExampleMod/readme.txt": new TextEncoder().encode("hello from example mod\n"),
    "GameData/ExampleMod/plugin.dll": new TextEncoder().encode("fake-dll"),
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

function fixtureMetaArchive(sha256: string, sha1: string): Uint8Array {
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
        download_size: fixtureModZip().byteLength,
        download_hash: { sha256, sha1 },
        install: [{ file: "GameData/ExampleMod", install_to: "GameData" }],
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
        download_size: fixtureModZip().byteLength,
        download_hash: { sha256, sha1 },
        install: [{ file: "GameData/ExampleMod", install_to: "GameData", as: "AnotherMod" }],
      }),
    },
  ]);
  return new Uint8Array(gzipSync(tar));
}

async function createInstallTestApp() {
  const home = await mkdtemp(join(tmpdir(), "kmm-install-"));
  const ksp = join(home, "KSP");
  mkdirSync(join(ksp, "GameData"), { recursive: true });
  writeFileSync(join(ksp, "KSP.x86_64"), "");
  writeFileSync(join(ksp, "readme.txt"), "Version 1.12.5");

  const zipBytes = fixtureModZip();
  const sha256 = createHash("sha256").update(zipBytes).digest("hex");
  const sha1 = createHash("sha1").update(zipBytes).digest("hex");

  const http: HttpPort = {
    async get(url: string) {
      if (url.includes("CKAN-meta")) {
        return fixtureMetaArchive(sha256, sha1);
      }
      throw new Error(`unexpected metadata url: ${url}`);
    },
  };

  const streamingHttp = new StreamingHttp(async (url) => {
    if (url === "https://example.test/ExampleMod.zip" || url === "https://example.test/AnotherMod.zip") {
      return new Response(Buffer.from(zipBytes), {
        status: 200,
        headers: { "content-length": String(zipBytes.byteLength) },
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

  return { app, home, ksp, sha256 };
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
    expect(readme).toContain("hello from example mod");

    const inventory = await request(app).get("/api/v1/installed-mods");
    expect(inventory.status).toBe(200);
    expect(inventory.body.mods).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ identifier: "ExampleMod", status: "managed", version: "1.0.0" }),
        expect.objectContaining({ identifier: "DetectedOnly", status: "detected" }),
      ]),
    );

    const removed = await request(app).delete("/api/v1/mods/ExampleMod");
    expect(removed.status).toBe(204);
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
    const wrongUninstall = await request(app).delete("/api/v1/mods/ExampleMod");
    expect(wrongUninstall.status).toBe(422);

    await request(app).put("/api/v1/config").send({ installationPath: ksp });
    const removed = await request(app).delete("/api/v1/mods/ExampleMod");
    expect(removed.status).toBe(204);
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

    const removed = await request(app).delete("/api/v1/mods/ExampleMod");
    expect(removed.status).toBe(500);
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
          50 * 1024 * 1024 + 1,
        ),
      ),
    ).toThrow(/size limit/i);
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

    const goodZip = fixtureModZip();
    const sha256 = createHash("sha256").update(goodZip).digest("hex");
    const sha1 = createHash("sha1").update(goodZip).digest("hex");
    const registryService = new RegistryService(
      {
        async get() {
          return fixtureMetaArchive(sha256, sha1);
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
});
