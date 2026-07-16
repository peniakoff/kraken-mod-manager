import type { FileSystemPort } from "@kraken/core";
import { access, readFile, realpath } from "node:fs/promises";

export class NodeFileSystem implements FileSystemPort {
  async exists(path: string): Promise<boolean> {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  }

  realpath(path: string): Promise<string> {
    return realpath(path);
  }

  readText(path: string): Promise<string> {
    return readFile(path, "utf8");
  }
}
