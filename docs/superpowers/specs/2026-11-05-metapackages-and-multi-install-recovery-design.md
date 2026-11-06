# Metapackages and Recovery for All Known Installations (0.7.0)

## Goal

1. Users can install CKAN metapackages. Kraken installs the metapackage's
   dependencies and records the metapackage itself, so it shows as installed,
   can be updated and uninstalled, and its dependencies can be cleaned up.
2. An install interrupted in a KSP installation that is not active is undone
   at the next start too, and the report names the installation.

Out of scope: `kind: "dlc"` modules (DLC detection), forgetting a known
installation, and any UI to manage the list of known installations.

## Part 1: Metapackages

### Data

- `parseCkanDocument` reads `kind`. `CkanModule.kind?: "metapackage" | "dlc"`;
  absent means a regular package. Any other value is treated as absent.
- New core helper `isInstallable(module: CkanModule): boolean` — true when the
  module has a `download` or is a metapackage. `dlc` modules stay
  non-installable.
- `ckanModuleSchema` (contracts) gains `kind: z.enum(["metapackage", "dlc"]).optional()`.

### Install

- A metapackage target always goes through the resolver (dependency
  resolution is implied, as for picked optional mods). `resolveModulesForInstall`
  no longer throws `NO_DOWNLOAD` for a metapackage, as target or as dependency;
  a regular module without `download` still fails as today.
- In the job a metapackage downloads nothing and moves no files: it gets a
  `module` journal line (no `file` lines) and a manifest record with
  `files: []`. `autoInstalled` follows the existing rules (target and picked
  optional mods manual, dependencies automatic; an existing record keeps its
  flag).
- The manifest schema does not change; whether a record is a metapackage comes
  from the registry.

### Behaviour that must hold (tested, no new code expected)

- Updates: a newer metapackage version is offered like any update.
- Uninstall: removing a metapackage removes its record; its automatic
  dependencies are offered as orphans by the existing uninstall plan.
- Recovery: an interrupted metapackage install rolls back its record only.
- Inventory: a metapackage record without a GameData folder is listed as
  managed.

### Install UI

- The Install button shows when `download` exists or `kind === "metapackage"`
  (browse rows, details panel, update actions).
- Browse rows and the details panel show a `Metapackage` badge and no download
  size.
- Installing a metapackage always opens the dependency dialog. When every
  dependency is already installed, the dialog says so
  (`All of its mods are already installed. Kraken will only record {name}.`)
  instead of an empty list.

## Part 2: Recovery for all known installations

### Known installations (config)

- Config schema v2: `{ schemaVersion: 2, activeInstallationPath, knownInstallationPaths: string[], preferences }`.
  v1 configs are upgraded in memory with `knownInstallationPaths: [activeInstallationPath]`
  and written as v2 on the next save.
- `PUT /api/v1/config` adds the newly activated installation's canonical path
  (deduplicated, active one kept). The list is internal; the config API
  contract does not change.
- Rejected alternative: deriving the list from the install manifest — it misses
  an installation whose first install died before any record was written.

### Startup

- `cleanupTemporaryFiles(kspPaths: readonly string[], options?)` cleans the
  download cache once, then for each path (active first) runs the existing
  journal recovery and untracked-backup check.
- A path whose folder does not exist (or `realpath` fails with ENOENT) is
  skipped with a log line and no report entry.
- Any other error in one installation is reported in `failed` for that
  installation and does not stop the others.
- It still runs before the server listens, so no install can be active.

### Report (contract change)

- `rolledBack[]` and `failed[]` entries gain `installationPath: string`.
- `untrackedBackups` becomes `{ installationPath, count, directory }[]`
  (optional or empty when none). Only this repo's frontend consumes it.

### Recovery notice

- `RecoveryNotice` shows the installation path (via `PathText`) next to each
  rolled-back job, failure and backup group whose `installationPath` is not the
  active installation. Entries for the active installation read as today.

## Error handling

- Metapackage with an unresolvable dependency: the plan is blocked as for any
  mod (existing unmet/conflict reporting).
- Config v2 with a malformed `knownInstallationPaths` (not an array of
  non-empty strings): the config is malformed, as for any other field today.

## Testing

- Core: `kind` parsing (metapackage, dlc, unknown); `isInstallable`; resolver
  with a metapackage as target and as dependency.
- Backend: metapackage install creates a file-less record with automatic
  dependencies; uninstall offers its dependencies as orphans; update offered;
  interrupted metapackage install rolled back; config v1→v2 migration and
  `PUT` adding paths; recovery in a non-active installation; missing folder
  skipped; error in one installation does not block another; report carries
  `installationPath`.
- Frontend: Install button and badge for metapackages; dialog text when all
  dependencies are installed; recovery notice shows the path only for a
  non-active installation.
- Browser check of both flows with mocked API responses (no installs on a real
  KSP installation).
