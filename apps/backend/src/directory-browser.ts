import type { Dirent } from "node:fs";
import { readdir, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

const maximumDirectories = 200;

export class DirectoryBrowserError extends Error {
  constructor(
    readonly code: "INVALID_PATH" | "OUTSIDE_ALLOWED_ROOT",
    message: string,
  ) {
    super(message);
    this.name = "DirectoryBrowserError";
  }
}

export interface DirectoryListing {
  roots: string[];
  currentPath: string;
  parentPath: string | null;
  directories: string[];
}

export class DirectoryBrowser {
  constructor(private readonly roots: readonly string[]) {}

  async list(requestedPath: string | undefined): Promise<DirectoryListing> {
    const resolvedRoots = await Promise.all(
      this.roots.map(async (root) => {
        try {
          return await realpath(root);
        } catch {
          return undefined;
        }
      }),
    );
    const canonicalRoots = resolvedRoots.filter((root): root is string => root !== undefined);
    const requested = requestedPath === undefined ? canonicalRoots[0] : requestedPath;
    if (requested === undefined || !isAbsolute(requested)) {
      throw new DirectoryBrowserError("INVALID_PATH", "A valid absolute directory path is required.");
    }

    let currentPath: string;
    try {
      currentPath = await realpath(resolve(requested));
    } catch {
      throw new DirectoryBrowserError("INVALID_PATH", "The requested directory does not exist or cannot be opened.");
    }
    if (!canonicalRoots.some((root) => containsPath(root, currentPath))) {
      throw new DirectoryBrowserError("OUTSIDE_ALLOWED_ROOT", "The requested directory is outside the allowed browsing roots.");
    }

    let entries: Dirent[];
    try {
      entries = await readdir(currentPath, { withFileTypes: true });
    } catch {
      throw new DirectoryBrowserError("INVALID_PATH", "The requested directory cannot be listed.");
    }

    const directories = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right))
      .slice(0, maximumDirectories);
    const rawParent = dirname(currentPath);
    const parentPath = canonicalRoots.some((root) => containsPath(root, rawParent)) ? rawParent : null;

    return { roots: canonicalRoots, currentPath, parentPath, directories };
  }
}

function containsPath(root: string, candidate: string): boolean {
  const pathRelative = relative(root, candidate);
  return pathRelative === "" || (!pathRelative.startsWith("..") && !isAbsolute(pathRelative));
}
