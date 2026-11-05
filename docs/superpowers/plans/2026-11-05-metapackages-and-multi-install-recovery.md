# Metapackages and Multi-Installation Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Install CKAN metapackages as file-less managed mods, and undo interrupted installs in every KSP installation Kraken has managed, not only the active one.

**Architecture:** Core parses `kind` and decides installability; the backend
install job gains a file-less path for metapackages; the config remembers
every installation that was ever active, and startup recovery loops over them.
The recovery report names the installation of each entry.

**Tech Stack:** TypeScript, Node 24, Express, Zod contracts, Vue 3, Vitest 5, node:test (core, contracts), pnpm 11.

**Spec:** `docs/superpowers/specs/2026-11-05-metapackages-and-multi-install-recovery-design.md`

## Global Constraints

- pnpm 11 (committed), Node 24. No new dependencies.
- No `any`, no `@ts-ignore`, no unjustified `!`; `as` only with a comment saying why it is safe.
- Validate stored/external data at boundaries (config and journal use the repo's hand-written guards; API data uses `@kraken/contracts` Zod schemas).
- Fail loudly: no empty catch, no swallowed errors.
- TDD: every new test is run and seen failing before the code change.
- Code, comments, commits in English; Conventional Commits; no AI attribution.
- Each task ends with `pnpm lint && pnpm typecheck && pnpm test` green.
- Exact UI copy: badge `Metapackage`; dialog text `All of its mods are already installed. Kraken will only record {name}.`

Clarifications of the spec (decided while planning):
- The report carries `activeInstallationPath` (canonical path of the installation that was active at startup), so the frontend compares canonical paths instead of the config path, which may be a symlink.
- `failed[].jobId` becomes optional: an error that stops one whole installation (not one job) is reported with `installationPath` and no `jobId`.

## Review Focus

- A regular module without `download`, as target or dependency, must still fail with `NO_DOWNLOAD`; only metapackages are exempt.
- A metapackage must never download, move, back up or delete a file, also when it replaces an older metapackage record.
- A `dlc` module must stay non-installable everywhere (backend and every Install button).
- An installation folder that disappeared (unmounted drive) must not block startup or other installations, and must not lose its pending journals (they stay for the next start).
- Migrating a v1 config must keep the active installation and never drop it from `knownInstallationPaths`.

---

### Task 1: Parse `kind` and decide installability (core, contracts)

**Files:**
- Modify: `packages/core/src/ckan.ts` (`CkanModule`, `parseCkanDocument`)
- Modify: `packages/core/src/index.ts` (export `isInstallable` if helpers are re-exported there)
- Modify: `packages/contracts/src/index.ts` (`ckanModuleSchema`)
- Test: `packages/core/test/ckan.test.mjs`, `packages/contracts/test/schemas.test.mjs`

**Interfaces:**
- Produces: `CkanModule.kind?: "metapackage" | "dlc"` (set only for those two values; any other or missing value leaves it absent).
- Produces: `export function isInstallable(module: Pick<CkanModule, "download" | "kind">): boolean` — `module.kind === "metapackage" || (module.kind !== "dlc" && module.download !== undefined)`.
- Produces: `ckanModuleSchema` gains `kind: z.enum(["metapackage", "dlc"]).optional()`.

- [ ] **Step 1: Failing tests** (core): "reads kind for metapackages and DLC" (`kind: "metapackage"` → `"metapackage"`, `"dlc"` → `"dlc"`, `"package"`/`"other"`/`42`/missing → `undefined`); "decides installability" (`{download:"https://a.test/x.zip"}` → true; `{kind:"metapackage"}` → true; `{kind:"dlc", download:"https://a.test/x.zip"}` → false; `{}` → false). Contracts: a mod object with `kind: "metapackage"` parses and keeps `kind`; `kind: "other"` is rejected.
- [ ] **Step 2: Run** `pnpm --filter @kraken/core build && pnpm --filter @kraken/core test` and `pnpm --filter @kraken/contracts test` — Expected: new tests FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same — Expected: PASS; full checks.
- [ ] **Step 5: Commit** `feat(core): read the CKAN kind and tell installable modules apart`.

### Task 2: Install metapackages as file-less records (backend)

**Files:**
- Modify: `apps/backend/src/install-service.ts` (`resolveModulesForInstall`, `startInstall`, `installSingleModule`, new private `installMetapackage`)
- Test: `apps/backend/test/install-api.test.ts` (fixture meta archive in `fixtureMetaArchive`, new describe "metapackages")

**Interfaces:**
- Consumes: `isInstallable`, `CkanModule.kind` from Task 1.
- `startInstall`: dependency resolution is implied when `target.kind === "metapackage"` (as for `optional.length > 0`).
- `resolveModulesForInstall`: the no-resolver path keeps `NO_DOWNLOAD` for a target that is not installable; the dependency loop throws `NO_DOWNLOAD` only for modules where `!isInstallable(module)`.
- `installSingleModule`: for `module.kind === "metapackage"` call `installMetapackage(jobId, kspPath, module, stepLabel, isManual, journal)` instead of downloading. It runs inside `withManifestMutation`: canonical root, read manifest, `previous` record, `journal.beginModule({ identifier, name, backupId: randomUUID(), previousRecord })`, write the record `{ identifier, name, version, installationPath, files: [], autoInstalled: previous?.autoInstalled ?? !isManual }`, return a `ModuleInstallSnapshot` with `installedFiles: []` and `backup: { directory: join(root, BACKUP_DIRECTORY, backupId), files: [] }`. Job message `Recording metapackage${stepLabel}.`, phase `installing`.

Fixture modules (add to `fixtureMetaArchive`): `ExamplePack` (`kind: "metapackage"`, version `1.0.0`, `depends: [{ name: "ModuleManager" }, { name: "AnotherMod" }]`, no download), `ExamplePack` `2.0.0` (same, for the update test), `NestedPack` (regular mod with download like `AnotherMod` but `as: "NestedPack"`, `depends: [{ name: "ExamplePack" }]`), `DlcThing` (`kind: "dlc"`, has a `download`).

- [ ] **Step 1: Failing tests** (describe "metapackages"):
  - "installs a metapackage as a file-less record with automatic dependencies": install `ExamplePack` 1.0.0 with `{}` body → job succeeds; GameData has `ModuleManager` and `AnotherMod`; manifest `ExamplePack` record has `files: []`, `autoInstalled: false`; `ModuleManager` and `AnotherMod` `autoInstalled: true`; `/api/v1/installed-mods` lists `ExamplePack` as `managed`.
  - "installs a mod that depends on a metapackage": `NestedPack` with `installDependencies: true` → succeeds; `ExamplePack` record exists with `autoInstalled: true`.
  - "offers a newer metapackage as an update": after installing 1.0.0 (version pinned in the request), `/api/v1/updates` lists `ExamplePack` 1.0.0 → 2.0.0.
  - "offers a metapackage's dependencies as orphans when it is uninstalled": `uninstall-plan` for `ExamplePack` → `orphans` contains `ModuleManager` and `AnotherMod`.
  - "rolls back an interrupted install after a metapackage was recorded": install `NestedPack` with `installDependencies: true` using `CrashingZip(3, 1)` — install order is ModuleManager (extract 1), AnotherMod (extract 2), ExamplePack (recorded, no extract), NestedPack (extract 3, crashes). Before restart the manifest has an `ExamplePack` record; after restart and `cleanupTemporaryFiles` there is no `ExamplePack`, `NestedPack`, `ModuleManager` or `AnotherMod` record and no dependency folders. If the resolver orders the modules differently, assert the order from the plan response first and pick the crash call so that it happens after `ExamplePack` is recorded.
  - "still rejects a regular dependency without a download" (existing behaviour guard: a fixture regular mod without download as dependency → 4xx `NO_DOWNLOAD`) and "does not install DLC": install `DlcThing` → `NO_DOWNLOAD`.
- [ ] **Step 2: Run** `pnpm --filter @kraken/backend exec vitest run test/install-api.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS; full checks.
- [ ] **Step 5: Commit** `feat(backend): install CKAN metapackages as file-less managed mods`.

### Task 3: Metapackages in the UI

**Files:**
- Create: `apps/frontend/src/installable.ts` (`canInstall`)
- Modify: `apps/frontend/src/components/ModTable.vue`, `apps/frontend/src/components/ModDetailsPanel.vue`, `apps/frontend/src/App.vue` (`onInstall` guard, `applyPlan`), `apps/frontend/src/components/DependencyPromptDialog.vue`
- Modify: `CHANGELOG.md` (`[Unreleased]` → Added: metapackages)
- Test: `apps/frontend/test/BrowseModsView.test.ts`, `apps/frontend/test/ModDetailsPanel.test.ts`, `apps/frontend/test/DependencyPromptDialog.test.ts`, `apps/frontend/test/App.test.ts`

**Interfaces:**
- Consumes: contract `kind` from Task 1.
- Produces: `export function canInstall(mod: Pick<CkanModule, "download" | "kind">): boolean` (same rule as core `isInstallable`; the frontend does not depend on core).
- Every Install/Update button condition that today checks `download !== undefined` uses `canInstall`. Rows and the details panel show `<span class="badge">Metapackage</span>` (data-testid `metapackage-badge`) and hide the download size for metapackages.
- `applyPlan`: a metapackage target always opens the dialog on its first plan (even with no missing dependencies and nothing offered).
- Dialog confirm view, not `confirmed`, no missing dependencies, `prompt.mod.kind === "metapackage"`: title `Install {name}?`, paragraph `All of its mods are already installed. Kraken will only record {name}.`; optional groups still render if offered.
- CHANGELOG Added bullet: `Metapackages (CKAN modules that only bundle other mods) can be installed: Kraken installs the mods they list and records the metapackage, so it can be updated and uninstalled, and uninstalling it offers to remove the mods it brought in.`

- [ ] **Step 1: Failing tests**: ModTable/BrowseModsView row for `{kind:"metapackage"}` without download shows an Install button and `metapackage-badge`, no size; a `{kind:"dlc", download}` row has no Install button; ModDetailsPanel shows the install button and badge for a metapackage; dialog test for the record-only text; App test: installing a metapackage whose plan has `toInstall: [target]` opens the dialog with the record-only text and installs with `installDependencies: true` after `Install`.
- [ ] **Step 2: Run** `pnpm --filter @kraken/frontend exec vitest run` — Expected: new tests FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS; full checks.
- [ ] **Step 5: Commit** `feat(frontend): show and install CKAN metapackages`.

### Task 4: Recovery report names the installation

**Files:**
- Modify: `packages/contracts/src/index.ts` (`installRecoveryReportSchema`)
- Modify: `apps/backend/src/install-service.ts` (report building in `cleanupTemporaryFiles` / `recoverJob`)
- Modify: `apps/frontend/src/components/RecoveryNotice.vue`
- Test: `apps/backend/test/install-api.test.ts`, `apps/frontend/test/RecoveryNotice.test.ts`, `apps/frontend/test/App.test.ts` (recovery notice test mock)

**Interfaces:**
- Produces (contract): `rolledBack: { jobId, installationPath, modules }[]`; `failed: { jobId?: string, installationPath, message }[]`; `untrackedBackups?: { installationPath, count, directory }[]`; `activeInstallationPath?: string`.
- Backend: every entry gets the canonical root it came from; `activeInstallationPath` is the canonical path of the (still single) cleaned-up installation; `untrackedBackups` is pushed as an array element.
- Notice: for entries whose `installationPath !== report.activeInstallationPath`, render `in <PathText :path="installationPath" />` (rolled-back jobs: after the job's module list heading; failures: before the message; backups: the directory already is a path inside it, so prefix the group with the installation path only when it differs). Failure list keys fall back to the index when `jobId` is absent.

- [ ] **Step 1: Failing tests**: backend recovery tests assert `installationPath` on `rolledBack`/`failed` entries and `untrackedBackups` as an array; `getRecoveryReport().activeInstallationPath` equals the canonical KSP path; RecoveryNotice: an entry with `installationPath` different from `activeInstallationPath` shows that path, an entry for the active installation does not.
- [ ] **Step 2: Run** the backend and frontend test files — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS; full checks.
- [ ] **Step 5: Commit** `feat: name the installation in the install recovery report`.

### Task 5: Remember every installation that was active (config v2)

**Files:**
- Modify: `apps/backend/src/adapters/config-store.ts`
- Modify: `apps/backend/src/app.ts` (`PUT /api/v1/config`)
- Test: `apps/backend/test/config-store.test.ts`, `apps/backend/test/setup-api.test.ts`

**Interfaces:**
- Produces: `StoredConfig = { schemaVersion: 2; activeInstallationPath: string; knownInstallationPaths: string[]; preferences: Record<string, never> }`. `read()` accepts v2 (every path a non-empty string) and upgrades v1 in memory to `knownInstallationPaths: [activeInstallationPath]`; anything else is malformed as today.
- `PUT /api/v1/config`: canonical path = `fileSystem.realpath(installation.path)`; writes v2 with `activeInstallationPath: installation.path` (unchanged meaning) and `knownInstallationPaths` = previous list (if a readable config exists) plus the canonical path, deduplicated, order of first appearance kept.

- [ ] **Step 1: Failing tests**: config-store reads a v1 file as v2 with the active path in `knownInstallationPaths`; rejects v2 with a non-string or empty path; setup-api: two successive `PUT`s with different installations leave both canonical paths in the stored file, the second as active; a repeated `PUT` does not duplicate.
- [ ] **Step 2: Run** `pnpm --filter @kraken/backend exec vitest run test/config-store.test.ts test/setup-api.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS; full checks.
- [ ] **Step 5: Commit** `feat(backend): remember every KSP installation that was active`.

### Task 6: Startup recovery for every known installation

**Files:**
- Modify: `apps/backend/src/install-service.ts` (`cleanupTemporaryFiles`)
- Modify: `apps/backend/src/server.ts`
- Modify: `docs/ARCHITECTURE.md` (journal section: which installations are recovered), `CHANGELOG.md` (`[Unreleased]` → Fixed/Changed bullet; remove nothing from released sections)
- Test: `apps/backend/test/install-api.test.ts`

**Interfaces:**
- Consumes: Task 4 report shape, Task 5 `knownInstallationPaths`.
- Produces: `cleanupTemporaryFiles(kspPaths: readonly string[], options?: { recheckDelayMs?: number }): Promise<void>` — download cache cleaned once; then for each path in order: `realpath`; ENOENT → `console.info` and skip (no report entry, journals untouched); other errors → `failed` entry `{ installationPath: <path as given>, message }` and continue; otherwise the existing per-installation recovery. `activeInstallationPath` = canonical form of `kspPaths[0]` when it resolves.
- `server.ts`: `kspPaths = config === undefined ? [] : [config.activeInstallationPath, ...config.knownInstallationPaths]` (deduplicated, active first); the outer try/catch stays for errors outside the per-installation loop.
- All existing test calls `cleanupTemporaryFiles(ksp, …)` become `cleanupTemporaryFiles([ksp], …)`.
- CHANGELOG bullet: `Interrupted installs are now undone at startup in every KSP installation Kraken has managed, not only the active one; the notice names the installation.`

- [ ] **Step 1: Failing tests**: "undoes an interrupted install in an installation that is not active" (crash an install in KSP A, create and activate KSP B via `PUT /api/v1/config`, restart, `cleanupTemporaryFiles([B, A])` → A rolled back, entry `installationPath` = canonical A); "skips an installation folder that no longer exists" (paths `[ksp, join(home, "Gone")]` → no throw, no `failed` entry); "keeps recovering other installations when one fails" (make one installation's `.kraken-backup` unreadable, e.g. a file named `.kraken-backup` instead of a directory, → `failed` entry for it, the other still rolled back).
- [ ] **Step 2: Run** `pnpm --filter @kraken/backend exec vitest run test/install-api.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS; full checks.
- [ ] **Step 5: Commit** `feat(backend): undo interrupted installs in every known installation`.

### Final

- [ ] Whole-branch review (fresh reviewer, most capable model); one fix wave for Critical/Important findings with RED→GREEN tests.
- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm build`; browser check with mocked API responses: a metapackage in Browse (badge, Install, dialog), recovery notice with an entry for a non-active installation. No installs on the user's real KSP.
