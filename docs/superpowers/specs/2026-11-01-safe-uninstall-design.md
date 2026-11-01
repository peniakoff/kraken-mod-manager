# Safe uninstall

Status: approved design, 2026-11-01

## Problem

`DELETE /api/v1/mods/:identifier` removes a managed mod immediately:

- **Mods that depend on it break.** Removing ModuleManager leaves every mod
  that needs it broken in GameData, with no warning.
- **Dependencies stay behind.** Dependencies installed automatically remain
  after the mod that pulled them in is gone. The manifest does not record
  which mods were installed as dependencies, so they cannot be cleaned up.
- **No confirmation.** The UI deletes files from GameData on a single click.

ROADMAP 4.4 promises clean removal "without leaving orphaned files". That
holds for files but not for mods.

## Goals

- Uninstalling a mod also removes the managed mods that depend on it,
  after one confirmation that lists them, as CKAN does.
- Offer to remove automatically installed dependencies that nothing needs
  any more, pre-selected and deselectable.
- Warn about unmanaged (detected) mods that will break; do not block on
  them.
- Every uninstall goes through a preview the user confirms.

## Non-goals

- A UI to toggle a mod's auto-installed flag.
- Treating `recommends` / `suggests` as reasons to keep a mod.
- Removing unmanaged (detected) mods.
- Uninstall progress streaming. Uninstall stays synchronous: it only
  deletes files.

## Domain (`packages/core`)

New `packages/core/src/uninstall.ts`:

```ts
interface PlanUninstallOptions {
  targetIdentifier: string;
  managed: readonly ManagedModRecord[]; // one installation, with autoInstalled
  inventory: readonly InstalledModSummary[]; // managed + detected
  registryModules: readonly CkanModule[];
}

interface UninstallPlan {
  target: UninstallModuleRef;
  dependents: UninstallModuleRef[]; // managed, must be removed with the target
  orphans: UninstallModuleRef[]; // managed + autoInstalled, offered for removal
  brokenUnmanaged: UninstallModuleRef[]; // detected mods that will break
  warnings: string[];
}
```

`ManagedModRecord` gains `autoInstalled: boolean`.

### Satisfaction

A `depends` relationship of an installed mod M is **satisfied by a set of
installed mods** when some mod in the set, other than M:

- has the relationship's name as its identifier, or lists it in the
  `provides` of its registry metadata, and
- has a version inside the range.

For `any_of`, at least one alternative must be satisfied. The provider
matching and version checks are the ones the install resolver uses. Shared
helpers move into `providers.ts`; resolver behaviour does not change.

An installed mod's relationships come from its registry metadata
(`findInstalledMetadata`: exact version, else latest). A mod without
metadata contributes no relationships, so it can never be a dependent.

### Dependents

1. Start with the removal set S = {target}.
2. An installed mod M ∉ S **breaks** if one of its `depends` is satisfied
   by all installed mods but not by installed mods minus S. A relationship
   that was already unsatisfied does not count.
3. A breaking managed mod joins S as a dependent. A breaking detected mod
   goes to `brokenUnmanaged`, and its own dependents are not followed.
4. Repeat until nothing changes.

### Orphans

A managed mod O ∉ S with `autoInstalled: true` is an orphan when removing S
plus the orphans found so far plus O breaks no remaining installed mod.
Repeat until nothing changes, so chains of auto-installed dependencies are
found. Candidates are checked in identifier order, so the result is
deterministic. If two auto-installed mods both provide a name that a
remaining mod needs, the first is offered for removal and the second stays.

### Validation of a chosen removal set

`validateUninstallSelection(plan, alsoRemove, options)` returns the final
removal set or a list of problems:

- every dependent must be in `alsoRemove`;
- every entry must be a dependent or an orphan;
- removing target + `alsoRemove` must break no remaining **managed** mod.
  This catches deselecting an orphan that a selected orphan's removal would
  break.

### Warnings

If `registryModules` is empty, `warnings` gets "The CKAN registry is not
loaded, so Kraken cannot check which mods depend on this one." and the plan
contains only the target. The UI shows the warning.

## Manifest (`apps/backend`)

- `StoredInstallManifest.schemaVersion` becomes `2`. Each record requires
  `autoInstalled: boolean`.
- **Reading v1 migrates in memory.** Every record gets
  `autoInstalled: false` and the manifest is returned as v2. The next write
  persists v2.
- The manifest is user data, so it is never discarded.
- `false` is the safe default: a mod the user may have chosen is never
  offered for removal.
- Any other unexpected shape keeps throwing `InstallManifestError`.

### Setting the flag on install

| Module being installed | `autoInstalled` |
|---|---|
| Already managed in this installation (reinstall, update) | keeps the existing value |
| New, and it is the install target | `false` |
| New, and it is a dependency of the target | `true` |

Keeping the value on update means updating an auto-installed ModuleManager
does not turn it into a manual install, which matches CKAN. Rollback
restores the previous record, flag included.

## API

- **Removed:** `DELETE /api/v1/mods/:identifier`. Its only client is the
  bundled frontend, and keeping it would leave a path that skips the
  dependency check. It returns 404 through the SPA/API fallback like any
  unknown route.
- **`POST /api/v1/mods/:identifier/uninstall-plan`** with an empty body
  returns `uninstallPlanResponseSchema`. A mod that is not managed gives
  422 `NOT_MANAGED`, as today.
- **`POST /api/v1/mods/:identifier/uninstall`** with body
  `{ alsoRemove: string[] }` (each 1–256 chars, at most 256 entries):
  - recomputes the plan and validates the selection;
  - a mismatch returns **409 `UNINSTALL_PLAN_MISMATCH`** with the problems
    joined into the message, and nothing is removed;
  - on success returns 200 with `{ removed: string[] }` (identifiers in
    removal order: dependents before what they depend on, target included).
- All removals run inside one `withManifestMutation`. Each mod keeps
  today's per-mod partial-failure handling. A failure stops the sequence,
  leaves the already removed mods removed and the failing mod's remaining
  files recorded, and surfaces `UNINSTALL_FAILED`.

## Frontend

- Clicking Uninstall, in the browse list or the details panel, requests the
  uninstall plan and opens a modal. It never deletes on the first click.
- The modal shows:
  - "Uninstall <name>?";
  - "This will also remove:" with the dependents, without checkboxes;
  - "No longer needed:" with one checked checkbox per orphan;
  - a warning list "These manually installed mods will stop working:" for
    `brokenUnmanaged`;
  - any plan `warnings`.
- Buttons: "Uninstall" and "Cancel".
- Confirming sends `alsoRemove` = dependents + checked orphans. A 409 shows
  its message and keeps the modal open.
- The modal uses the existing dialog markup: `role="dialog"`,
  `aria-modal`, `aria-labelledby`, native checkboxes with labels, and AA
  contrast for all text.

## Testing

TDD for domain and backend.

- `packages/core/test/uninstall.test.mjs`:
  - transitive dependents;
  - a remaining alternative provider (`provides`) keeps a mod from being a
    dependent;
  - `any_of` satisfied by a remaining alternative;
  - a relationship already broken before removal is ignored;
  - a detected dependent goes to `brokenUnmanaged` and is not followed;
  - an orphan chain;
  - non-auto mods are never orphans;
  - redundant auto providers: one offered, one kept;
  - mods without metadata;
  - empty registry warning;
  - `validateUninstallSelection` rejects a missing dependent, a foreign
    identifier, and a deselected orphan that is still needed.
- `apps/backend/test/install-api.test.ts`:
  - v1 manifest is migrated, not lost;
  - the flag is set for target and dependency;
  - an update keeps the flag;
  - uninstall-plan response;
  - uninstall with dependents and orphans removes the right files and
    manifest records;
  - 409 on a mismatched selection;
  - the old `DELETE` no longer removes anything.
- `apps/frontend/test`:
  - the modal renders all sections;
  - the orphan checkbox changes `alsoRemove`;
  - a 409 keeps the modal open with the message.
- Manual browser check, if a browser is available: install Kerbalism with a
  config, uninstall ModuleManager, and confirm the cascade.
