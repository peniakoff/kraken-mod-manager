/**
 * Framework-independent domain logic. Adapters provide platform and file-system
 * access so this package stays usable outside the local Express application.
 */

export {
  buildModulesFromEntries,
  CkanIndex,
  compareCkanVersions,
  isCompatibleWithKsp,
  parseCkanDocument,
  parseCkanText,
  refreshRegistry,
  type ArchiveEntry,
  type ArchivePort,
  type CkanDownloadHash,
  type CkanInstallStanza,
  type CkanModule,
  type CkanRelationship,
  type CkanRelationships,
  type CkanSearchOptions,
  type CkanSearchResult,
  type HttpPort,
  type RegistrySnapshot,
} from "./ckan.js";

export {
  buildInventory,
  InstallPolicyError,
  isAllowedDestination,
  isSafeArchivePath,
  normalizeSlashPath,
  resolveInstallMappings,
  verifyDownloadHash,
  type InstallMapping,
  type InstalledModStatus,
  type InstalledModSummary,
  type ManagedModRecord,
} from "./install.js";

export {
  resolveInstallPlan,
  type InstallPlan,
  type InstallPlanConflict,
  type InstallPlanModuleRef,
  type InstallPlanOptional,
  type InstallPlanSatisfied,
  type InstallPlanStatus,
  type InstallPlanUnmet,
  type ResolveInstallPlanOptions,
} from "./resolve.js";

export type KspPlatform = "win32" | "linux" | "darwin";
export type InstallationSource = "steam" | "gog" | "epic" | "manual";

export interface KspInstallation {
  path: string;
  version?: string;
  platform: KspPlatform;
  source: InstallationSource;
}

export interface FileSystemPort {
  exists(path: string): Promise<boolean>;
  isFile(path: string): Promise<boolean>;
  realpath(path: string): Promise<string>;
  readText(path: string): Promise<string>;
}

export interface PlatformPort {
  platform: KspPlatform;
  homeDirectory: string;
  environment: Readonly<Record<string, string | undefined>>;
}

export interface DiscoveryCandidate {
  path: string;
  source: Exclude<InstallationSource, "manual">;
}

export function getDiscoveryCandidates(platform: PlatformPort): DiscoveryCandidate[] {
  const home = platform.homeDirectory;

  switch (platform.platform) {
    case "win32":
      return [
        { path: `${platform.environment.ProgramFiles ?? "C:\\Program Files"}\\Steam\\steamapps\\common\\Kerbal Space Program`, source: "steam" },
        { path: `${platform.environment["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)"}\\Steam\\steamapps\\common\\Kerbal Space Program`, source: "steam" },
        { path: `${platform.environment.ProgramFiles ?? "C:\\Program Files"}\\GOG Galaxy\\Games\\Kerbal Space Program`, source: "gog" },
        { path: `${platform.environment.ProgramFiles ?? "C:\\Program Files"}\\Epic Games\\KerbalSpaceProgram`, source: "epic" },
      ];
    case "darwin":
      return [
        { path: `${home}/Library/Application Support/Steam/steamapps/common/Kerbal Space Program`, source: "steam" },
        { path: "/Applications/Kerbal Space Program", source: "gog" },
        { path: `${home}/Library/Application Support/Epic/KerbalSpaceProgram`, source: "epic" },
      ];
    case "linux":
      return [
        { path: `${home}/.steam/steam/steamapps/common/Kerbal Space Program`, source: "steam" },
        { path: `${home}/.local/share/Steam/steamapps/common/Kerbal Space Program`, source: "steam" },
        { path: `${home}/GOG Games/Kerbal Space Program`, source: "gog" },
        { path: `${home}/.local/share/epic/KerbalSpaceProgram`, source: "epic" },
      ];
    default: {
      const exhaustive: never = platform.platform;
      throw new Error(`Unsupported platform: ${exhaustive}`);
    }
  }
}

function executableNames(platform: KspPlatform): string[] {
  switch (platform) {
    case "win32":
      return ["KSP.exe"];
    case "linux":
      return ["KSP.x86_64"];
    case "darwin":
      return ["KSP", "KSP.app/Contents/MacOS/KSP"];
    default: {
      const exhaustive: never = platform;
      throw new Error(`Unsupported platform: ${exhaustive}`);
    }
  }
}

function parseVersion(metadata: string): string | undefined {
  const match = metadata.match(/(?:version|build(?:ID)?)[^\d]*(\d+(?:\.\d+){1,3})/i);
  return match?.[1];
}

async function readVersion(fileSystem: FileSystemPort, path: string): Promise<string | undefined> {
  for (const file of ["readme.txt", "buildID64.txt"]) {
    try {
      const version = parseVersion(await fileSystem.readText(`${path}/${file}`));
      if (version !== undefined) {
        return version;
      }
    } catch {
      // Version metadata is optional; a valid executable remains authoritative.
    }
  }
  return undefined;
}

export async function validateKspInstallation(
  fileSystem: FileSystemPort,
  platform: KspPlatform,
  path: string,
  source: InstallationSource,
): Promise<KspInstallation | undefined> {
  let canonicalPath: string;
  try {
    canonicalPath = await fileSystem.realpath(path);
  } catch {
    return undefined;
  }

  const root = await resolveInstallationRoot(fileSystem, platform, canonicalPath);
  if (root === undefined) {
    return undefined;
  }

  const version = await readVersion(fileSystem, root);
  return version === undefined
    ? { path: root, platform, source }
    : { path: root, version, platform, source };
}

async function resolveInstallationRoot(
  fileSystem: FileSystemPort,
  platform: KspPlatform,
  canonicalPath: string,
): Promise<string | undefined> {
  if (await hasKspExecutable(fileSystem, platform, canonicalPath)) {
    return canonicalPath;
  }

  // GOG Linux (and some Galaxy layouts) wrap the game under a `game/` subdirectory.
  const gogGamePath = `${canonicalPath}/game`;
  let nestedPath: string;
  try {
    nestedPath = await fileSystem.realpath(gogGamePath);
  } catch {
    return undefined;
  }
  if (await hasKspExecutable(fileSystem, platform, nestedPath)) {
    return nestedPath;
  }
  return undefined;
}

async function hasKspExecutable(
  fileSystem: FileSystemPort,
  platform: KspPlatform,
  root: string,
): Promise<boolean> {
  const executables = executableNames(platform);
  const results = await Promise.all(executables.map((file) => fileSystem.isFile(`${root}/${file}`)));
  return results.some(Boolean);
}

export async function discoverInstallations(
  fileSystem: FileSystemPort,
  platform: PlatformPort,
): Promise<KspInstallation[]> {
  const candidates = getDiscoveryCandidates(platform);
  const installations = await Promise.all(
    candidates.map(({ path, source }) => validateKspInstallation(fileSystem, platform.platform, path, source)),
  );
  const byPath = new Map<string, KspInstallation>();

  for (const installation of installations) {
    if (installation !== undefined && !byPath.has(installation.path)) {
      byPath.set(installation.path, installation);
    }
  }

  return [...byPath.values()].sort((left, right) => left.path.localeCompare(right.path));
}
