import assert from "node:assert/strict";
import test from "node:test";
import {
  apiErrorSchema,
  configResponseSchema,
  directoryListingResponseSchema,
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
