import { Buffer } from "node:buffer";
import { extname } from "node:path";
import { getAsset, getAssetKeys, isSea } from "node:sea";

export interface FrontendAssets {
  read(assetKey: string): Buffer | undefined;
}

interface EmbeddedAssetSource {
  getAsset(assetKey: string): ArrayBuffer;
  getAssetKeys(): string[];
}

const contentTypes: Readonly<Record<string, string>> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".gif": "image/gif",
  ".avif": "image/avif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".ttf": "font/ttf",
  ".webmanifest": "application/manifest+json",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".xml": "application/xml; charset=utf-8",
};

export class EmbeddedFrontendAssets implements FrontendAssets {
  readonly #assetKeys: ReadonlySet<string>;
  readonly #source: EmbeddedAssetSource;

  constructor(source: EmbeddedAssetSource) {
    this.#source = source;
    this.#assetKeys = new Set(source.getAssetKeys());
  }

  read(assetKey: string): Buffer | undefined {
    if (!this.#assetKeys.has(assetKey)) {
      return undefined;
    }

    return Buffer.from(this.#source.getAsset(assetKey));
  }
}

export function createSeaFrontendAssets(): FrontendAssets | undefined {
  if (!isSea()) {
    return undefined;
  }

  return new EmbeddedFrontendAssets({ getAsset, getAssetKeys });
}

export function getFrontendContentType(assetKey: string): string {
  return contentTypes[extname(assetKey).toLowerCase()] ?? "application/octet-stream";
}

export function normalizeFrontendAssetPath(requestPath: string): string | undefined {
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(requestPath);
  } catch {
    return undefined;
  }

  if (decodedPath.includes("\0") || decodedPath.includes("\\")) {
    return undefined;
  }

  const relativePath = decodedPath.startsWith("/") ? decodedPath.slice(1) : decodedPath;
  if (relativePath === "") {
    return "index.html";
  }

  const segments = relativePath.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    return undefined;
  }

  return segments.join("/");
}
