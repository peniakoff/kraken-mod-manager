import assert from "node:assert/strict";
import test from "node:test";
import {
  apiErrorSchema,
  configResponseSchema,
  directoryListingResponseSchema,
  modsQuerySchema,
  modsResponseSchema,
  registryResponseSchema,
  updateConfigRequestSchema,
} from "../dist/index.js";

test("accepts configured and unconfigured responses", () => {
  assert.equal(configResponseSchema.parse({ configured: false }).configured, false);
  assert.equal(
    configResponseSchema.parse({
      configured: true,
      installation: { path: "/games/KSP", platform: "linux", source: "manual" },
    }).configured,
    true,
  );
});

test("rejects malformed requests and directory responses", () => {
  assert.equal(updateConfigRequestSchema.safeParse({ installationPath: "" }).success, false);
  assert.equal(
    directoryListingResponseSchema.safeParse({ roots: [], currentPath: "", parentPath: null, directories: [] }).success,
    false,
  );
  assert.equal(apiErrorSchema.safeParse({ code: "", message: "Problem" }).success, false);
});

test("accepts registry status and mods responses", () => {
  assert.deepEqual(
    registryResponseSchema.parse({ status: "missing", moduleCount: 0 }),
    { status: "missing", moduleCount: 0 },
  );
  assert.equal(
    registryResponseSchema.parse({
      status: "ready",
      moduleCount: 2,
      updatedAt: "2026-07-17T12:00:00.000Z",
      sourceUrl: "https://example.test/meta.tar.gz",
      parseErrors: 1,
    }).moduleCount,
    2,
  );
  assert.equal(
    modsResponseSchema.parse({
      total: 1,
      mods: [
        {
          identifier: "ModuleManager",
          name: "Module Manager",
          authors: ["sarbian"],
          version: "4.2.3",
          tags: ["plugin"],
        },
      ],
    }).total,
    1,
  );
});

test("applies mods query defaults and rejects invalid limits", () => {
  assert.deepEqual(modsQuerySchema.parse({}), { limit: 50, offset: 0 });
  assert.equal(modsQuerySchema.parse({ q: "mech", limit: "10", offset: "5" }).limit, 10);
  assert.equal(modsQuerySchema.safeParse({ limit: 0 }).success, false);
  assert.equal(modsQuerySchema.safeParse({ limit: 201 }).success, false);
});
