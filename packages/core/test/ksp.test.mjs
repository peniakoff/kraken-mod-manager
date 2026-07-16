import assert from "node:assert/strict";
import test from "node:test";
import { discoverInstallations, validateKspInstallation } from "../dist/index.js";

test("validates an executable and optional version metadata", async () => {
  const fileSystem = {
    async exists(path) {
      return path.endsWith("/KSP.x86_64");
    },
    async isFile(path) {
      return path.endsWith("/KSP.x86_64");
    },
    async realpath(path) {
      return `/canonical${path}`;
    },
    async readText() {
      return "KSP Version 1.12.5";
    },
  };
  const installation = await validateKspInstallation(fileSystem, "linux", "/ksp", "manual");
  assert.deepEqual(installation, {
    path: "/canonical/ksp",
    version: "1.12.5",
    platform: "linux",
    source: "manual",
  });
});

test("deduplicates and sorts discovered installations", async () => {
  const platform = { platform: "linux", homeDirectory: "/home/test", environment: {} };
  const fileSystem = {
    async exists(path) {
      return path.includes("Steam") || path.includes(".steam");
    },
    async isFile(path) {
      return path.includes("Steam") || path.includes(".steam");
    },
    async realpath(path) {
      return path.replace("/.local/share/Steam", "/.steam/steam");
    },
    async readText() {
      throw new Error("no metadata");
    },
  };
  const installations = await discoverInstallations(fileSystem, platform);
  assert.equal(installations.length, 1);
  assert.equal(installations[0].source, "steam");
});

test("rejects a directory that only has an executable-looking name", async () => {
  const fileSystem = {
    async exists() {
      return true;
    },
    async isFile() {
      return false;
    },
    async realpath(path) {
      return path;
    },
    async readText() {
      return "";
    },
  };
  const installation = await validateKspInstallation(fileSystem, "linux", "/ksp", "manual");
  assert.equal(installation, undefined);
});

test("falls back to buildID64.txt when readme.txt has no parseable version", async () => {
  const fileSystem = {
    async exists(path) {
      return path.endsWith("/KSP.x86_64");
    },
    async isFile(path) {
      return path.endsWith("/KSP.x86_64");
    },
    async realpath(path) {
      return path;
    },
    async readText(path) {
      if (path.endsWith("/readme.txt")) {
        return "Kerbal Space Program";
      }
      if (path.endsWith("/buildID64.txt")) {
        return "buildID 1.12.5";
      }
      throw new Error("missing");
    },
  };
  const installation = await validateKspInstallation(fileSystem, "linux", "/ksp", "manual");
  assert.equal(installation?.version, "1.12.5");
});
