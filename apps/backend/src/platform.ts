import type { KspPlatform, PlatformPort } from "@kraken/core";
import { homedir } from "node:os";
import { join, parse } from "node:path";

export function getPlatformPort(
  platform: NodeJS.Platform = process.platform,
  homeDirectory = homedir(),
  environment: Readonly<Record<string, string | undefined>> = process.env,
): PlatformPort {
  if (platform !== "win32" && platform !== "linux" && platform !== "darwin") {
    throw new Error(`Unsupported platform: ${platform}`);
  }

  return { platform: platform satisfies KspPlatform, homeDirectory, environment };
}

export function getConfigFilePath(platform: PlatformPort): string {
  switch (platform.platform) {
    case "win32":
      return join(platform.environment.APPDATA ?? join(platform.homeDirectory, "AppData", "Roaming"), "Kraken Mod Manager", "config.json");
    case "linux":
      return join(platform.environment.XDG_CONFIG_HOME ?? join(platform.homeDirectory, ".config"), "kraken-mod-manager", "config.json");
    case "darwin":
      return join(platform.homeDirectory, "Library", "Application Support", "Kraken Mod Manager", "config.json");
    default: {
      const exhaustive: never = platform.platform;
      throw new Error(`Unsupported platform: ${exhaustive}`);
    }
  }
}

export function getBrowseRoots(platform: PlatformPort): string[] {
  if (platform.platform === "win32") {
    return Array.from({ length: 26 }, (_, index) => `${String.fromCharCode(65 + index)}:\\`);
  }
  const roots = [platform.homeDirectory, parse(platform.homeDirectory).root];
  return [...new Set(roots)];
}
