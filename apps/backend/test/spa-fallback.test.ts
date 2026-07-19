import { createApp, createDefaultDependencies } from "../src/app.js";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";

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
});
