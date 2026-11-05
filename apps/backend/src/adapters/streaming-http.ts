import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { rm } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";

export interface DownloadProgress {
  bytesReceived: number;
  bytesTotal?: number;
}

export type DownloadProgressListener = (progress: DownloadProgress) => void;

export interface DownloadResult {
  bytesReceived: number;
  sha1: string;
  sha256: string;
}

export class StreamingHttpError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "StreamingHttpError";
  }
}

export class StreamingHttp {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  /**
   * Streams the response body into a new file at `destinationPath` and hashes
   * it on the way, so memory use does not depend on the archive size. The
   * file must not exist yet; on any failure it is removed.
   */
  async download(
    url: string,
    destinationPath: string,
    onProgress?: DownloadProgressListener,
  ): Promise<DownloadResult> {
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: "GET",
        headers: { Accept: "application/zip, application/octet-stream, */*" },
        redirect: "follow",
      });
    } catch (error: unknown) {
      throw new StreamingHttpError(`Could not download archive: ${getErrorMessage(error)}`);
    }

    if (!response.ok) {
      throw new StreamingHttpError(`Archive download failed with HTTP ${response.status}.`, response.status);
    }

    const totalHeader = response.headers.get("content-length");
    const parsedTotal =
      totalHeader === null || totalHeader.length === 0 ? Number.NaN : Number.parseInt(totalHeader, 10);
    const bytesTotal = Number.isFinite(parsedTotal) ? parsedTotal : undefined;
    const sha1 = createHash("sha1");
    const sha256 = createHash("sha256");
    let bytesReceived = 0;

    const hashing = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        sha1.update(chunk);
        sha256.update(chunk);
        bytesReceived += chunk.byteLength;
        onProgress?.(bytesTotal === undefined ? { bytesReceived } : { bytesReceived, bytesTotal });
        callback(null, chunk);
      },
    });
    const source =
      response.body === null
        ? Readable.from([])
        : // Safe: fetch bodies are WHATWG byte streams, which Node's web stream type describes.
          Readable.fromWeb(response.body as NodeReadableStream<Uint8Array>);

    try {
      // "wx" refuses to follow or replace an existing file at the path.
      await pipeline(source, hashing, createWriteStream(destinationPath, { flags: "wx", mode: 0o600 }));
    } catch (error: unknown) {
      if (isAlreadyExists(error)) {
        throw new StreamingHttpError(`Download target already exists: ${destinationPath}`);
      }
      await rm(destinationPath, { force: true });
      throw new StreamingHttpError(`Could not download archive: ${getErrorMessage(error)}`);
    }

    return { bytesReceived, sha1: sha1.digest("hex"), sha256: sha256.digest("hex") };
  }
}

function isAlreadyExists(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST";
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
