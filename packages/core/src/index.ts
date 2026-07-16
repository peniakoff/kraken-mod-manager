/**
 * Framework-independent domain logic belongs in this package.
 *
 * It must not import HTTP, UI, or file-system adapters so that registry,
 * dependency-resolution, and installation workflows remain testable.
 */
export const corePackageName = "@kraken/core";
