import { Buffer } from "node:buffer";
import {
  EmbeddedFrontendAssets,
  getFrontendContentType,
  normalizeFrontendAssetPath,
} from "../src/frontend-assets.js";
import { describe, expect, it } from "vitest";

describe("frontend assets", () => {
  it("normalizes safe asset paths", () => {
    expect(normalizeFrontendAssetPath("/")).toBe("index.html");
    expect(normalizeFrontendAssetPath("/assets/app.js")).toBe("assets/app.js");
    expect(normalizeFrontendAssetPath("/manifest.webmanifest")).toBe("manifest.webmanifest");
  });

  it.each(["/%2e%2e/secret", "/../secret", "/assets\\app.js", "/assets//app.js", "/%00.js", "/%zz"])(
    "rejects unsafe or malformed path %s",
    (path) => {
      expect(normalizeFrontendAssetPath(path)).toBeUndefined();
    },
  );

  it("maps known extensions to content types and safely defaults unknown files", () => {
    expect(getFrontendContentType("index.html")).toBe("text/html; charset=utf-8");
    expect(getFrontendContentType("assets/app.js")).toBe("text/javascript; charset=utf-8");
    expect(getFrontendContentType("assets/chunk.mjs")).toBe("text/javascript; charset=utf-8");
    expect(getFrontendContentType("assets/app.css")).toBe("text/css; charset=utf-8");
    expect(getFrontendContentType("manifest.webmanifest")).toBe("application/manifest+json");
    expect(getFrontendContentType("asset.bin")).toBe("application/octet-stream");
  });

  it("only reads keys declared by the embedded asset source", () => {
    const assets = new EmbeddedFrontendAssets({
      getAsset: (key) => Uint8Array.from(Buffer.from(key)).buffer,
      getAssetKeys: () => ["index.html"],
    });

    expect(assets.read("index.html")?.toString()).toContain("index.html");
    expect(assets.read("../package.json")).toBeUndefined();
  });
});
