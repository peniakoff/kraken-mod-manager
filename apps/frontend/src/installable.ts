import type { CkanModule } from "@kraken/contracts";

/**
 * Frontend mirror of `isInstallable` from `@kraken/core` (the frontend does
 * not depend on core): a module can be installed when it has a download, or
 * is a metapackage, which only bundles other mods. DLCs never are.
 */
export function canInstall(mod: Pick<CkanModule, "download" | "kind">): boolean {
  if (mod.kind === "metapackage") {
    return true;
  }
  return mod.kind !== "dlc" && mod.download !== undefined;
}
