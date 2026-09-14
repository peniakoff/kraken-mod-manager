import { createApp, createDefaultDependencies } from "../src/app.js";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { Buffer } from "node:buffer";

describe("SPA fallback", () => {
  const previousFrontendDirectory = process.env.KMM_FRONTEND_DIR;

  afterEach(() => {
    if (previousFrontendDirectory === undefined) {
      delete process.env.KMM_FRONTEND_DIR;
    } else {
      process.env.KMM_FRONTEND_DIR = previousFrontendDirectory;
    }
  });

  it("serves index.html for client routes and 404s missing assets", async () => {
    const frontendDirectory = mkdtempSync(join(tmpdir(), "kmm-frontend-"));
    writeFileSync(join(frontendDirectory, "index.html"), "<html>kraken</html>");
    process.env.KMM_FRONTEND_DIR = frontendDirectory;

    const app = createApp();

    const page = await request(app).get("/mods").set("Accept", "text/html");
    expect(page.status).toBe(200);
    expect(page.text).toContain("kraken");

    const asset = await request(app).get("/assets/missing.js").set("Accept", "*/*");
    expect(asset.status).toBe(404);
    expect(asset.text).not.toContain("kraken");

    const encodedAsset = await request(app).get("/assets%2Fmissing%2Ejs").set("Accept", "text/html");
    expect(encodedAsset.status).toBe(404);
  });

  it("rate-limits SPA fallback sendFile responses", async () => {
    const frontendDirectory = mkdtempSync(join(tmpdir(), "kmm-frontend-"));
    writeFileSync(join(frontendDirectory, "index.html"), "<html>kraken</html>");

    const app = createApp("test-version", {
      ...createDefaultDependencies(frontendDirectory),
      spaFallbackRateLimit: { windowMs: 60_000, limit: 2 },
    });

    const first = await request(app).get("/mods").set("Accept", "text/html");
    const second = await request(app).get("/library").set("Accept", "text/html");
    const third = await request(app).get("/settings").set("Accept", "text/html");

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(third.status).toBe(429);
  });

  it("serves embedded assets and applies the same SPA fallback rules", async () => {
    delete process.env.KMM_FRONTEND_DIR;
    const assets = new Map([
      ["index.html", Buffer.from("<html>embedded kraken</html>")],
      ["assets/app.js", Buffer.from("console.info('kraken')")],
    ]);
    const dependencies = createDefaultDependencies();
    dependencies.frontendAssets = { read: (assetKey) => assets.get(assetKey) };
    dependencies.spaFallbackRateLimit = { windowMs: 60_000, limit: 6 };
    const app = createApp("test-version", dependencies);

    const script = await request(app).get("/assets/app.js");
    expect(script.status).toBe(200);
    expect(script.headers["content-type"]).toContain("text/javascript");
    expect(script.headers["x-content-type-options"]).toBe("nosniff");

    const page = await request(app).get("/mods").set("Accept", "text/html");
    expect(page.status).toBe(200);
    expect(page.text).toContain("embedded kraken");

    const missingAsset = await request(app).get("/assets/missing.js").set("Accept", "*/*");
    expect(missingAsset.status).toBe(404);

    for (const path of ["/%2e%2e/package.json", "/assets%2f..%2fsecret", "/assets%2Fmissing%2Ejs"]) {
      const unsafePath = await request(app).get(path).set("Accept", "text/html");
      expect(unsafePath.status).toBe(404);
    }

    const secondPage = await request(app).get("/library").set("Accept", "text/html");
    const rateLimitedPage = await request(app).get("/settings").set("Accept", "text/html");
    expect(secondPage.status).toBe(200);
    expect(rateLimitedPage.status).toBe(429);
  });
});
