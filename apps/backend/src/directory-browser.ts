import type { Dirent } from "node:fs";
import { readdir, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

const maximumDirectories = 200;
const maximumPathLength = 4_096;

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
    const canonicalRoots = await this.resolveCanonicalRoots();
    if (canonicalRoots.length === 0) {
      throw new DirectoryBrowserError("INVALID_PATH", "No browsing roots are available.");
    }

    const defaultRoot = canonicalRoots[0];
    if (defaultRoot === undefined) {
      throw new DirectoryBrowserError("INVALID_PATH", "No browsing roots are available.");
    }

    const currentPath =
      requestedPath === undefined ? defaultRoot : await this.resolveRequestedPath(requestedPath, canonicalRoots);

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

  private async resolveCanonicalRoots(): Promise<string[]> {
    const resolvedRoots = await Promise.all(
      this.roots.map(async (root) => {
        try {
          return await realpath(root);
        } catch {
          return undefined;
        }
      }),
    );
    return resolvedRoots.filter((root): root is string => root !== undefined);
  }

  private async resolveRequestedPath(requestedPath: string, canonicalRoots: readonly string[]): Promise<string> {
    assertSafeAbsolutePath(requestedPath);
    const normalizedPath = resolve(requestedPath);
    const containingRoot = canonicalRoots.find((root) => containsPath(root, normalizedPath));
    if (containingRoot === undefined) {
      throw new DirectoryBrowserError(
        "OUTSIDE_ALLOWED_ROOT",
        "The requested directory is outside the allowed browsing roots.",
      );
    }

    const pathWithinRoot = buildPathWithinRoot(containingRoot, normalizedPath);
    let currentPath: string;
    try {
      currentPath = await realpath(pathWithinRoot);
    } catch {
      throw new DirectoryBrowserError("INVALID_PATH", "The requested directory does not exist or cannot be opened.");
    }
    if (!canonicalRoots.some((root) => containsPath(root, currentPath))) {
      throw new DirectoryBrowserError(
        "OUTSIDE_ALLOWED_ROOT",
        "The requested directory is outside the allowed browsing roots.",
      );
    }
    return currentPath;
  }
}

function assertSafeAbsolutePath(path: string): void {
  if (!isAbsolute(path)) {
    throw new DirectoryBrowserError("INVALID_PATH", "A valid absolute directory path is required.");
  }
  if (path.includes("\0") || path.length > maximumPathLength) {
    throw new DirectoryBrowserError("INVALID_PATH", "The requested directory path is invalid.");
  }
}

function buildPathWithinRoot(root: string, requestedAbsolutePath: string): string {
  const relativePath = relative(root, requestedAbsolutePath);
  if (relativePath === "" || relativePath === ".") {
    return root;
  }
  if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new DirectoryBrowserError(
      "OUTSIDE_ALLOWED_ROOT",
      "The requested directory is outside the allowed browsing roots.",
    );
  }

  let currentPath = root;
  for (const segment of relativePath.split(sep)) {
    if (segment === "" || segment === ".") {
      continue;
    }
    if (segment === "..") {
      throw new DirectoryBrowserError(
        "OUTSIDE_ALLOWED_ROOT",
        "The requested directory is outside the allowed browsing roots.",
      );
    }
    currentPath = join(currentPath, segment);
  }
  return currentPath;
}

function containsPath(root: string, candidate: string): boolean {
  const pathRelative = relative(root, candidate);
  return pathRelative === "" || (!pathRelative.startsWith("..") && !isAbsolute(pathRelative));
}
