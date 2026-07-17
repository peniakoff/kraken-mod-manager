import { ConfigStore } from "../src/adapters/config-store.js";
import { NodeFileSystem } from "../src/adapters/node-file-system.js";
import { RegistryCacheStore } from "../src/adapters/registry-cache-store.js";
import { TarGzArchive } from "../src/adapters/tar-gz-archive.js";
import { createApp } from "../src/app.js";
import { DirectoryBrowser } from "../src/directory-browser.js";
import { RegistryService } from "../src/registry-service.js";
import type { PlatformPort } from "@kraken/core";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { describe, expect, it } from "vitest";

async function createTestApp() {
  const home = await mkdtemp(join(tmpdir(), "kmm-setup-"));
  const ksp = join(home, ".steam", "steam", "steamapps", "common", "Kerbal Space Program");
  mkdirSync(ksp, { recursive: true });
  writeFileSync(join(ksp, "KSP.x86_64"), "");
  writeFileSync(join(ksp, "readme.txt"), "Version 1.12.5");
  const platform: PlatformPort = { platform: "linux", homeDirectory: home, environment: {} };
  const app = createApp("test", {
    fileSystem: new NodeFileSystem(),
    platform,
    configStore: new ConfigStore(join(home, "config", "config.json")),
    directoryBrowser: new DirectoryBrowser([home]),
    registryService: new RegistryService(
      {
        async get() {
          throw new Error("network unused in setup tests");
        },
      },
      new TarGzArchive(),
      new RegistryCacheStore(join(home, "cache", "registry.json")),
    ),
  });
  return { app, home, ksp };
}

describe("KSP setup API", () => {
  it("discovers, validates, persists, and restores an installation", async () => {
    const { app, ksp } = await createTestApp();

    const discoveries = await request(app).get("/api/v1/ksp/installations");
    expect(discoveries.status).toBe(200);
    expect(discoveries.body.installations).toEqual([
      expect.objectContaining({ path: ksp, source: "steam", version: "1.12.5" }),
    ]);

    const saved = await request(app).put("/api/v1/config").send({ installationPath: ksp });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ configured: true, installation: { path: ksp } });

    const restored = await request(app).get("/api/v1/config");
    expect(restored.status).toBe(200);
    expect(restored.body).toMatchObject({ configured: true, installation: { path: ksp } });
  });

  it("rejects invalid selections and browsing outside the configured root", async () => {
    const { app, home } = await createTestApp();
    const invalid = await request(app).put("/api/v1/config").send({ installationPath: home });
    expect(invalid.status).toBe(422);
    expect(invalid.body.code).toBe("INVALID_INSTALLATION");

    const outside = await request(app).get("/api/v1/fs/directories").query({ path: tmpdir() });
    expect(outside.status).toBe(403);
    expect(outside.body.code).toBe("OUTSIDE_ALLOWED_ROOT");
  });

  it("does not follow a symlink outside an allowed browsing root", async () => {
    const { app, home } = await createTestApp();
    const outside = await mkdtemp(join(tmpdir(), "kmm-outside-"));
    symlinkSync(outside, join(home, "escape"));

    const response = await request(app).get("/api/v1/fs/directories").query({ path: join(home, "escape") });
    expect(response.status).toBe(403);
  });

  it("returns unconfigured when the saved installation is no longer valid", async () => {
    const { app, ksp } = await createTestApp();
    await request(app).put("/api/v1/config").send({ installationPath: ksp });
    const { unlinkSync } = await import("node:fs");
    unlinkSync(join(ksp, "KSP.x86_64"));

    const response = await request(app).get("/api/v1/config");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ configured: false });
  });
});
