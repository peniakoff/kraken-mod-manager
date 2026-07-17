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
import type { HttpPort, PlatformPort } from "@kraken/core";
import { gzipSync } from "node:zlib";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { describe, expect, it } from "vitest";

function fixtureArchive(): Uint8Array {
  const tar = packUstar([
    {
      path: "CKAN-meta-master/ModuleManager/ModuleManager-4.2.3.ckan",
      content: JSON.stringify({
        identifier: "ModuleManager",
        name: "Module Manager",
        abstract: "Patching plugin",
        author: ["sarbian"],
        version: "4.2.3",
        tags: ["plugin"],
        ksp_version_min: "1.8.0",
        ksp_version_max: "1.12.99",
        download: "https://example.test/mm.zip",
      }),
    },
    {
      path: "CKAN-meta-master/MechJeb2/MechJeb2-2.14.ckan",
      content: JSON.stringify({
        identifier: "MechJeb2",
        name: "MechJeb 2",
        author: "sarbian",
        version: "2.14.0",
        tags: ["plugin"],
        ksp_version: "1.12",
      }),
    },
    {
      path: "CKAN-meta-master/MechJeb2/MechJeb2-2.15.ckan",
      content: JSON.stringify({
        identifier: "MechJeb2",
        name: "MechJeb 2",
        author: "sarbian",
        version: "2.15.0",
        tags: ["plugin"],
        ksp_version: "1.12",
      }),
    },
    {
      path: "CKAN-meta-master/Broken/broken.ckan",
      content: "{not-json",
    },
  ]);
  return new Uint8Array(gzipSync(tar));
}

async function createRegistryTestApp(http: HttpPort = { async get() { return fixtureArchive(); } }) {
  const home = await mkdtemp(join(tmpdir(), "kmm-registry-"));
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
    new StreamingHttp(),
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
  return { app, home, registryService };
}

function createInstallService(home: string, registryService: RegistryService): InstallService {
  return new InstallService(
    new NodeFileSystem(),
    registryService,
    new StreamingHttp(),
    new ZipArchive(),
    new InstallManifestStore(join(home, "data", "install-manifest.json")),
    new JobStore(),
    join(home, "cache", "downloads"),
  );
}

describe("CKAN registry API", () => {
  it("reports missing registry until refresh succeeds", async () => {
    const { app } = await createRegistryTestApp();

    const missing = await request(app).get("/api/v1/registry");
    expect(missing.status).toBe(200);
    expect(missing.body).toEqual({ status: "missing", moduleCount: 0 });

    const emptyMods = await request(app).get("/api/v1/mods");
    expect(emptyMods.status).toBe(200);
    expect(emptyMods.body).toEqual({ total: 0, mods: [] });
  });

  it("refreshes, caches, searches, and restores from disk", async () => {
    const { app, home } = await createRegistryTestApp();

    const refreshed = await request(app).post("/api/v1/registry/refresh");
    expect(refreshed.status).toBe(200);
    expect(refreshed.body).toMatchObject({
      status: "ready",
      moduleCount: 3,
      sourceUrl: "https://example.test/CKAN-meta.tar.gz",
      parseErrors: 1,
    });
    expect(refreshed.body.updatedAt).toEqual(expect.any(String));

    const search = await request(app).get("/api/v1/mods").query({ q: "mech" });
    expect(search.status).toBe(200);
    expect(search.body.total).toBe(1);
    expect(search.body.mods).toEqual([
      expect.objectContaining({ identifier: "MechJeb2", version: "2.15.0" }),
    ]);

    const byTag = await request(app).get("/api/v1/mods").query({ tag: "plugin", limit: 10 });
    expect(byTag.status).toBe(200);
    expect(byTag.body.total).toBe(2);

    const restoredRegistry = new RegistryService(
      {
        async get() {
          throw new Error("network should not be used when cache exists");
        },
      },
      new TarGzArchive(),
      new RegistryCacheStore(join(home, "cache", "registry.json")),
    );
    const restored = createApp("test", {
      fileSystem: new NodeFileSystem(),
      platform: { platform: "linux", homeDirectory: home, environment: {} },
      configStore: new ConfigStore(join(home, "config", "config.json")),
      directoryBrowser: new DirectoryBrowser([home]),
      registryService: restoredRegistry,
      installService: createInstallService(home, restoredRegistry),
    });

    const status = await request(restored).get("/api/v1/registry");
    expect(status.status).toBe(200);
    expect(status.body).toMatchObject({ status: "ready", moduleCount: 3, parseErrors: 1 });
  });

  it("returns 503 when metadata download fails", async () => {
    const { app } = await createRegistryTestApp({
      async get() {
        throw new Error("offline");
      },
    });

    const response = await request(app).post("/api/v1/registry/refresh");
    expect(response.status).toBe(503);
    expect(response.body.code).toBe("REGISTRY_REFRESH_FAILED");
  });

  it("rejects invalid mods query parameters", async () => {
    const { app } = await createRegistryTestApp();
    const response = await request(app).get("/api/v1/mods").query({ limit: 0 });
    expect(response.status).toBe(400);
    expect(response.body.code).toBe("INVALID_REQUEST");
  });
});

describe("tar.gz archive adapter", () => {
  it("extracts only .ckan files from a gzipped ustar archive", async () => {
    const archive = new TarGzArchive();
    const entries = await archive.extractCkanFiles(fixtureArchive());
    expect(entries.map((entry) => entry.path)).toEqual([
      "CKAN-meta-master/ModuleManager/ModuleManager-4.2.3.ckan",
      "CKAN-meta-master/MechJeb2/MechJeb2-2.14.ckan",
      "CKAN-meta-master/MechJeb2/MechJeb2-2.15.ckan",
      "CKAN-meta-master/Broken/broken.ckan",
    ]);
  });
});
