import { createHash } from "node:crypto";

export interface DownloadProgress {
  bytesReceived: number;
  bytesTotal?: number;
}

export type DownloadProgressListener = (progress: DownloadProgress) => void;

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

  async get(
    url: string,
    onProgress?: DownloadProgressListener,
  ): Promise<{ bytes: Uint8Array; sha1: string; sha256: string }> {
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: "GET",
        headers: { Accept: "application/zip, application/octet-stream, */*" },
        redirect: "follow",
      });
    } catch (error: unknown) {
      throw new StreamingHttpError(
        `Could not download archive: ${error instanceof Error ? error.message : String(error)}`,
      );
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
    const chunks: Uint8Array[] = [];
    let bytesReceived = 0;

    if (response.body === null) {
      const buffer = new Uint8Array(await response.arrayBuffer());
      sha1.update(buffer);
      sha256.update(buffer);
      const progress: DownloadProgress = { bytesReceived: buffer.byteLength };
      if (bytesTotal !== undefined) {
        progress.bytesTotal = bytesTotal;
      }
      onProgress?.(progress);
      return { bytes: buffer, sha1: sha1.digest("hex"), sha256: sha256.digest("hex") };
    }

    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (value === undefined) {
        continue;
      }
      chunks.push(value);
      sha1.update(value);
      sha256.update(value);
      bytesReceived += value.byteLength;
      const progress: DownloadProgress = { bytesReceived };
      if (bytesTotal !== undefined) {
        progress.bytesTotal = bytesTotal;
      }
      onProgress?.(progress);
    }

    const bytes = concatChunks(chunks, bytesReceived);
    return { bytes, sha1: sha1.digest("hex"), sha256: sha256.digest("hex") };
  }
}

function concatChunks(chunks: readonly Uint8Array[], totalLength: number): Uint8Array {
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}
