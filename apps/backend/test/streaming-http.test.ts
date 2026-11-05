import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { StreamingHttp, StreamingHttpError, type DownloadProgress } from "../src/adapters/streaming-http.js";

function chunkedResponse(chunks: Uint8Array[], init: ResponseInit = {}, failAfter?: number): Response {
  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (failAfter !== undefined && index === failAfter) {
        controller.error(new Error("connection reset"));
        return;
      }
      const chunk = chunks[index];
      index += 1;
      if (chunk === undefined) {
        controller.close();
      } else {
        controller.enqueue(chunk);
      }
    },
  });
  return new Response(body, init);
}

async function destination(): Promise<{ directory: string; path: string }> {
  const directory = await mkdtemp(join(tmpdir(), "kmm-download-"));
  return { directory, path: join(directory, "archive.zip") };
}

describe("StreamingHttp.download", () => {
  it("writes the body to disk, hashes it and reports progress", async () => {
    const chunks = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5])];
    const http = new StreamingHttp(async () => chunkedResponse(chunks, { headers: { "content-length": "5" } }));
    const { path } = await destination();
    const progress: DownloadProgress[] = [];

    const result = await http.download("https://example.test/a.zip", path, (event) => progress.push(event));

    const expected = new Uint8Array([1, 2, 3, 4, 5]);
    expect(new Uint8Array(await readFile(path))).toEqual(expected);
    expect(result).toEqual({
      bytesReceived: 5,
      sha1: createHash("sha1").update(expected).digest("hex"),
      sha256: createHash("sha256").update(expected).digest("hex"),
    });
    expect(progress).toEqual([
      { bytesReceived: 3, bytesTotal: 5 },
      { bytesReceived: 5, bytesTotal: 5 },
    ]);
  });

  it("fails on an HTTP error without leaving a file behind", async () => {
    const http = new StreamingHttp(async () => new Response("missing", { status: 404 }));
    const { directory, path } = await destination();

    await expect(http.download("https://example.test/a.zip", path)).rejects.toMatchObject({
      name: "StreamingHttpError",
      status: 404,
    });
    expect(await readdir(directory)).toEqual([]);
  });

  it("removes the partial file when the connection breaks", async () => {
    const http = new StreamingHttp(async () => chunkedResponse([new Uint8Array([1, 2, 3])], {}, 1));
    const { directory, path } = await destination();

    await expect(http.download("https://example.test/a.zip", path)).rejects.toBeInstanceOf(StreamingHttpError);
    expect(await readdir(directory)).toEqual([]);
  });

  it("refuses to overwrite an existing file", async () => {
    const http = new StreamingHttp(async () => chunkedResponse([new Uint8Array([1])]));
    const { path } = await destination();
    await http.download("https://example.test/a.zip", path);

    await expect(http.download("https://example.test/a.zip", path)).rejects.toThrow(/exists/i);
    expect(new Uint8Array(await readFile(path))).toEqual(new Uint8Array([1]));
  });
});
