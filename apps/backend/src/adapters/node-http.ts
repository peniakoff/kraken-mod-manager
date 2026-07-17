import type { HttpPort } from "@kraken/core";

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export class NodeHttp implements HttpPort {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async get(url: string): Promise<Uint8Array> {
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: "GET",
        headers: { Accept: "application/gzip, application/x-gzip, application/octet-stream, */*" },
        redirect: "follow",
      });
    } catch (error: unknown) {
      throw new HttpError(`Could not download metadata: ${error instanceof Error ? error.message : String(error)}`);
    }

    if (!response.ok) {
      throw new HttpError(`Metadata download failed with HTTP ${response.status}.`, response.status);
    }

    return new Uint8Array(await response.arrayBuffer());
  }
}
