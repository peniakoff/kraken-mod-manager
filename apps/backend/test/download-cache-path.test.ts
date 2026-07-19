import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveDownloadCachePath } from "../src/install-service.js";

describe("resolveDownloadCachePath", () => {
  it("uses a hash filename that cannot escape the cache directory", () => {
    const cacheDirectory = "/tmp/kraken-cache";
    const identifier = "../../.ssh/authorized_keys";
    const version = "../escape";
    const path = resolveDownloadCachePath(cacheDirectory, identifier, version);
    const digest = createHash("sha256").update(`${identifier}\0${version}`, "utf8").digest("hex");

    expect(path).toBe(resolve(cacheDirectory, `${digest}.zip`));
    expect(path.startsWith(resolve(cacheDirectory))).toBe(true);
    expect(path.includes(".ssh")).toBe(false);
  });
});
