# Safe Uninstall Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Uninstall removes dependent mods with confirmation, offers to clean up auto-installed dependencies nobody needs, and warns about unmanaged mods that will break.

**Architecture:**
- The manifest records an `autoInstalled` flag per mod (schema v2, v1 migrated in memory).
- A pure `planUninstall` in `@kraken/core` computes dependents, orphans and broken unmanaged mods from registry metadata.
- The backend exposes preview and execute endpoints in place of `DELETE`, and re-validates the user's selection.
- The frontend confirms through a modal.

**Tech Stack:** TypeScript 7, Node 24 `node:test` (core, contracts), Vitest + supertest (backend), Vitest + @vue/test-utils (frontend), Zod 4.

**Spec:** `docs/superpowers/specs/2026-11-01-safe-uninstall-design.md`

## Global Constraints

- pnpm via Corepack; no new dependencies.
- Domain logic in `packages/core`, no Vue/Express imports.
- No `any`, no `@ts-ignore`; `as` only with a justifying comment.
- Manifest `schemaVersion` becomes `2`. v1 is migrated in memory, never discarded. Records get `autoInstalled: false`.
- Flag rule:
  - already managed → keep the existing value;
  - new target → `false`;
  - new dependency → `true`.
- `alsoRemove`: array of strings 1–256 chars, at most 256 entries, default `[]`.
- Mismatched selection → 409 `UNINSTALL_PLAN_MISMATCH`, nothing removed.
- `DELETE /api/v1/mods/:identifier` is removed.
- Empty registry warning text, exact: `The CKAN registry is not loaded, so Kraken cannot check which mods depend on this one.`
- Core tests run against `dist`: `pnpm --filter @kraken/core build` first.
- Commit per task on `feat/safe-uninstall`, Conventional Commits, no AI attribution.

## Review Focus

1. **Self-provides.** A mod whose own metadata provides a name it depends on must not count as satisfying itself. Removing its real provider must still make it a dependent. Test in Task 2.
2. **Two installations.** Records from another `installationPath` must never enter the plan or be removed. Test in Task 3.
3. **Target that is also a detected folder.** A managed target's own folder must not appear in `brokenUnmanaged`. Test in Task 2.
4. **Dependent that is not in the registry any more.** It has no metadata, so it is not a dependent, and uninstall proceeds. Test in Task 2.
5. **Repeated identifiers in `alsoRemove`, or the target listed in it.** Both are accepted and deduplicated; the target is not removed twice. Test in Task 2 (`validateUninstallSelection`).

---

### Task 1: Manifest v2 with `autoInstalled`

**Files:**
- Modify: `packages/core/src/install.ts:10-16` (`ManagedModRecord`)
- Modify: `apps/backend/src/adapters/install-manifest-store.ts`
- Modify: `apps/backend/src/install-service.ts`:
  - `runInstall` ~179 passes `isTarget`;
  - `installSingleModule` ~290 sets the flag;
  - every `schemaVersion: 1` write (lines ~154, 164, 375, 405, 417) becomes `2`.
- Test: `apps/backend/test/install-api.test.ts`

**Interfaces:**
- Produces:
  - `ManagedModRecord.autoInstalled: boolean`;
  - `StoredInstallManifest.schemaVersion: 2`;
  - `InstallManifestStore.read()` returns v2 for both v1 and v2 files.

- [ ] **Step 1: Write failing tests** in the `"mod install API"` describe block. Manifest path: `join(home, "data", "install-manifest.json")`. The tests read it with `JSON.parse(readFileSync(...))`, because the file format is the contract under test.
  - `"marks dependencies as auto-installed and the target as manual"`: install `DependentMod` with `installDependencies: true` and wait for the job. Expect `schemaVersion === 2`, the `ModuleManager` record with `autoInstalled: true`, and the `DependentMod` record with `autoInstalled: false`.
  - `"keeps the auto-installed flag when a dependency is reinstalled directly"`: after the above, install `ModuleManager` with `{}`. Its record still has `autoInstalled: true`.
  - `"migrates a v1 install manifest without losing records"`:
    1. Install `ExampleMod`.
    2. Rewrite the file as `{ schemaVersion: 1, mods: <records without autoInstalled> }`.
    3. `GET /installed-mods` lists `ExampleMod` as `managed`.
    4. Install `AnotherMod`. The file now has `schemaVersion: 2` and `ExampleMod` has `autoInstalled: false`.

- [ ] **Step 2: Run to verify they fail**

  Run: `pnpm --filter @kraken/core build && pnpm --filter @kraken/backend exec vitest run test/install-api.test.ts`
  Expected: FAIL. `schemaVersion` is 1 and `autoInstalled` is undefined.

- [ ] **Step 3: Implement**
  - `read()`: parse JSON. If `schemaVersion === 1` and `mods` is an array of valid v1 records, return `{ schemaVersion: 2, mods: mods.map((mod) => ({ ...mod, autoInstalled: false })) }`.
  - v2 validation additionally requires `typeof record.autoInstalled === "boolean"`.
  - Missing file returns `{ schemaVersion: 2, mods: [] }`.
  - `installSingleModule(jobId, kspPath, module, stepLabel, isTarget: boolean)` builds the record with `autoInstalled: previous?.autoInstalled ?? !isTarget`.
  - `runInstall` passes `module.identifier === target.identifier`.

- [ ] **Step 4: Run backend tests, typecheck, lint**

  Run: `pnpm --filter @kraken/backend test && pnpm typecheck && pnpm --filter @kraken/backend lint`
  Expected: PASS.

- [ ] **Step 5: Commit**

  `feat(backend): record which mods were installed as dependencies`

---

### Task 2: `planUninstall` and `validateUninstallSelection` in core

**Files:**
- Modify: `packages/core/src/providers.ts`: move `findInstalledMetadata` and `versionMatchesInstalled` here from `resolve.ts` and export them. `resolve.ts` imports them, with no behaviour change.
- Create: `packages/core/src/uninstall.ts`
- Modify: `packages/core/src/index.ts` (exports)
- Test: `packages/core/test/uninstall.test.mjs` (new; same `mod()`/`rels()`/`dep()` helper style as `resolve.test.mjs`)

**Interfaces:**
- Consumes: `ManagedModRecord.autoInstalled` (Task 1), `InstalledModSummary`, `CkanModule`.
- Produces:
  ```ts
  export interface UninstallModuleRef { identifier: string; name: string; version?: string }
  export interface PlanUninstallOptions {
    targetIdentifier: string;
    managed: readonly ManagedModRecord[];
    inventory: readonly InstalledModSummary[];
    registryModules: readonly CkanModule[];
  }
  export interface UninstallPlan {
    target: UninstallModuleRef;
    dependents: UninstallModuleRef[];
    orphans: UninstallModuleRef[];
    brokenUnmanaged: UninstallModuleRef[];
    warnings: string[];
  }
  export type UninstallSelection =
    | { ok: true; removeOrder: string[] }
    | { ok: false; problems: string[] };
  export function planUninstall(options: PlanUninstallOptions): UninstallPlan; // throws Error if target not in managed
  export function validateUninstallSelection(
    plan: UninstallPlan,
    alsoRemove: readonly string[],
    options: PlanUninstallOptions,
  ): UninstallSelection;
  ```
  `removeOrder` is:
  1. the dependents in reverse discovery order,
  2. then the target,
  3. then the selected orphans in discovery order.

- [ ] **Step 1: Write failing tests in `uninstall.test.mjs`**

  The fixture helper `managedRecord(id, version, autoInstalled)` builds a record with `installationPath: "/ksp"` and `files: []`. The inventory for each managed record is `{ identifier, name, version, status: "managed" }`.
  - `"removes transitive dependents"`: MM ← A ← B (A depends MM, B depends A); uninstall MM gives `dependents` identifiers `["A", "B"]`.
  - `"keeps a mod whose dependency another installed provider still satisfies"`: A depends on virtual `X`, and both P1 and P2 provide X. Uninstall P1 gives `dependents: []`.
  - `"treats any_of as satisfied by a remaining alternative"`.
  - `"ignores a relationship that was already broken"`: A depends on `Missing`. Uninstall unrelated MM gives `dependents: []`.
  - `"reports detected dependents as broken without following them"`: detected D depends on MM, and managed E depends on D. Uninstall MM gives `brokenUnmanaged` `["D"]` and `dependents: []`.
  - `"offers an orphan chain of auto-installed dependencies"`: T (manual) depends on L1 (auto), and L1 depends on L2 (auto). Uninstall T gives orphans `["L1", "L2"]`.
  - `"never offers manually installed dependencies as orphans"`.
  - `"offers only one of two redundant auto-installed providers"`: manual A depends on X, and auto P1 and P2 both provide X. Uninstall unrelated mod T gives orphans `["P1"]`.
  - Review Focus 1 `"does not let a mod satisfy its own dependency through provides"`.
  - Review Focus 3 `"does not report the target's own folder as broken"`.
  - Review Focus 4 `"skips dependents without registry metadata"`.
  - `"warns when the registry is empty"`: `registryModules: []` gives `warnings` equal to `[<exact text>]`, with empty `dependents` and `orphans`.
  - `validateUninstallSelection`:
    - `"rejects a selection missing a dependent"`: `problems[0]` matches `/A depends on MM and must be removed too/`;
    - `"rejects identifiers that are neither dependents nor orphans"`: matches `/Foreign is not part of this uninstall/`;
    - `"rejects deselecting an orphan another removal still needs"`: L2 selected and L1 kept, matches `/L1 needs L2/`;
    - Review Focus 5 `"accepts repeated identifiers and the target"`: `removeOrder` has no duplicates and the target once;
    - `"orders removals dependents first"`: MM ← A ← B with orphan O gives `removeOrder` `["B", "A", "MM", "O"]`.

- [ ] **Step 2: Run to verify they fail**

  Run: `pnpm --filter @kraken/core build && cd packages/core && node --test test/uninstall.test.mjs`
  Expected: FAIL. `planUninstall` is not exported.

- [ ] **Step 3: Move the helpers to `providers.ts`, then implement `uninstall.ts`**

  Core helper:
  ```ts
  satisfiedBy(owner: string, relation: single | anyOf, present: readonly InstalledModSummary[]): boolean
  ```
  - Match by identifier or metadata `provides`, excluding `owner`.
  - Version check with `versionMatchesInstalled(mod, relation, "depends")`.
  - `unsupported` relations are skipped.

  Dependents and orphans are fixpoint loops as in the spec, sections "Dependents" and "Orphans". Orphan candidates are iterated in identifier order.

  Problem messages:
  - `${dependent} depends on ${removed} and must be removed too.`
  - `${id} is not part of this uninstall.`
  - `${kept} needs ${removed}.`

- [ ] **Step 4: Run all core tests, typecheck, lint**

  Run: `pnpm --filter @kraken/core build && cd packages/core && node --test && cd ../.. && pnpm --filter @kraken/core typecheck && pnpm --filter @kraken/core lint`
  Expected: PASS. The resolver tests still pass after moving the helpers.

- [ ] **Step 5: Commit**

  `feat(core): plan uninstalls with dependents and orphaned dependencies`

---

### Task 3: Contracts and backend uninstall endpoints

**Files:**
- Modify: `packages/contracts/src/index.ts`
- Modify: `apps/backend/src/install-service.ts` (`uninstall` ~124, new `planUninstall`, error code)
- Modify: `apps/backend/src/app.ts` (remove the `DELETE` route ~386, add two `POST` routes, map the 409)
- Test: `packages/contracts/test/schemas.test.mjs`, `apps/backend/test/install-api.test.ts`

**Interfaces:**
- Consumes: `planUninstall`, `validateUninstallSelection` (Task 2).
- Produces:
  - `uninstallModuleRefSchema`, `uninstallPlanResponseSchema` (mirrors `UninstallPlan`);
  - `uninstallRequestSchema = z.object({ alsoRemove: z.array(z.string().min(1).max(256)).max(256).default([]) })`;
  - `uninstallResponseSchema = z.object({ removed: z.array(z.string().min(1)) })`;
  - inferred types `UninstallPlanResponse`, `UninstallRequest`, `UninstallResponse`;
  - `InstallService.planUninstall(kspPath, identifier): Promise<UninstallPlan>`;
  - `InstallService.uninstall(kspPath, identifier, alsoRemove: readonly string[]): Promise<string[]>`;
  - error code `"UNINSTALL_PLAN_MISMATCH"` → 409.

- [ ] **Step 1: Write failing contract tests**

  - `alsoRemove` defaults to `[]`;
  - 257 entries are rejected;
  - a plan response with all five fields parses.

- [ ] **Step 2: Rewrite existing backend `DELETE` usages and write failing API tests**

  The four existing `request(app).delete("/api/v1/mods/ExampleMod")` calls become `request(app).post("/api/v1/mods/ExampleMod/uninstall").send({})`. Their status expectations change from 204 to 200, and the `NOT_MANAGED` expectations stay. New tests:
  - `"previews an uninstall with dependents and orphans"`: after the Task 1 DependentMod install:
    - plan for ModuleManager gives `dependents` `[DependentMod]`;
    - plan for DependentMod gives `orphans` `[ModuleManager]`.
  - `"removes dependents together with the target"`:
    - uninstall ModuleManager with `alsoRemove: []` gives 409 `UNINSTALL_PLAN_MISMATCH`, and both folders still exist;
    - with `alsoRemove: ["DependentMod"]` gives 200, `removed: ["DependentMod", "ModuleManager"]`, both folders gone and the manifest empty.
  - `"removes selected orphans and keeps deselected ones"`:
    - uninstall DependentMod with `alsoRemove: []` leaves ModuleManager;
    - a second scenario with `["ModuleManager"]` removes both.
  - `"keeps other installations out of the uninstall plan"` (Review Focus 2): install into a second KSP root, as in the existing `"keeps managed installs scoped to their KSP installation"` test. The plan and the removal touch only the configured root.
  - `"no longer removes mods through DELETE"`: `DELETE /api/v1/mods/ExampleMod` gives 404, and the file still exists.
  - `"rejects uninstall plans for unmanaged mods"`: `POST /api/v1/mods/DetectedOnly/uninstall-plan` for a detected-only folder gives 422 `NOT_MANAGED`.

- [ ] **Step 3: Run to verify they fail**

  Run: `pnpm --filter @kraken/contracts build && (cd packages/contracts && node --test) ; pnpm --filter @kraken/backend exec vitest run test/install-api.test.ts`
  Expected: FAIL.

- [ ] **Step 4: Implement**

  - `planUninstall`:
    1. `ensureLoaded()`;
    2. read the manifest records for the canonical root;
    3. throw `NOT_MANAGED` if the target is absent;
    4. call core with `listInstalled(kspPath)` and `registryService.listModules()`.
  - `uninstall`, inside one `withManifestMutation`:
    1. recompute the plan;
    2. validate the selection; problems become `UNINSTALL_PLAN_MISMATCH` with `problems.join(" ")`;
    3. remove each identifier in `removeOrder` with the existing per-mod file removal and partial-failure bookkeeping (extract today's body into `removeManagedMod(canonicalRoot, manifest, identifier)`);
    4. return `removeOrder`.
  - Routes: `POST /api/v1/mods/:identifier/uninstall-plan` → `uninstallPlanResponseSchema.parse(plan)`; `POST /api/v1/mods/:identifier/uninstall` → `uninstallResponseSchema.parse({ removed })`.

- [ ] **Step 5: Run all tests, typecheck, lint**

  Run: `pnpm test && pnpm typecheck && pnpm lint`
  Expected: PASS. The frontend still compiles because `uninstallMod` in `api.ts` is untouched until Task 4.

- [ ] **Step 6: Commit**

  `feat(backend): preview and validate uninstalls with dependents`

---

### Task 4: Frontend uninstall confirmation

**Files:**
- Modify: `apps/frontend/src/api.ts` (`uninstallMod` ~148 → `planUninstall` + `uninstallMod(identifier, alsoRemove)`)
- Modify: `apps/frontend/src/App.vue` (`onUninstall` ~380; new `uninstallPrompt` state; confirm and cancel)
- Create: `apps/frontend/src/components/UninstallDialog.vue`
- Modify: `apps/frontend/src/components/BrowseModsView.vue` (render the dialog from a prop, re-emit events)
- Test: `apps/frontend/test/UninstallDialog.test.ts` (new), `apps/frontend/test/App.test.ts`

**Interfaces:**
- Consumes: `UninstallPlanResponse`, `uninstallResponseSchema` (Task 3).
- Produces:
  - `planUninstall(identifier): Promise<UninstallPlanResponse>`;
  - `uninstallMod(identifier, alsoRemove: string[]): Promise<UninstallResponse>`;
  - `UninstallDialog` props `{ plan: UninstallPlanResponse; error?: string; busy: boolean }`, emits `confirm: [alsoRemove: string[]]` and `cancel: []`.

- [ ] **Step 1: Write failing component tests in `UninstallDialog.test.ts`**

  - `"lists dependents, orphans, broken unmanaged mods and warnings"`: shows the texts `Uninstall Module Manager?`, `This will also remove:`, `No longer needed:`, `These manually installed mods will stop working:`, and the warning string.
  - `"sends dependents and checked orphans"`: with orphans O1 and O2, uncheck O2 and click `Uninstall`. Emits `confirm` with `[...dependents, "O1"]`.
  - `"labels every orphan checkbox"`: each `input[type=checkbox]` has a matching `label[for]`.
  - `"shows the error and keeps the dialog"`: prop `error` renders inside the dialog with `role="alert"`.

- [ ] **Step 2: Write failing `App.test.ts` test**

  `"previews and confirms an uninstall with dependents"`:
  - the mocked `/uninstall-plan` returns one dependent;
  - clicking Uninstall shows the dialog, and no POST `/uninstall` has been made yet;
  - Confirm sends `{ alsoRemove: ["DependentMod"] }`;
  - a mocked 409 on a second attempt keeps the dialog open with the message.

- [ ] **Step 3: Run to verify they fail**

  Run: `pnpm --filter @kraken/frontend exec vitest run test/UninstallDialog.test.ts test/App.test.ts`
  Expected: FAIL.

- [ ] **Step 4: Implement**

  - The dialog uses the same overlay markup as the dependency modal (`role="dialog"`, `aria-modal`, `aria-labelledby`).
  - Orphans render as checked native checkboxes, and the selection resets when `plan` changes.
  - The text colours are `text-slate-300`/`text-slate-400` on `bg-slate-900` (AA).
  - `App.vue`: `onUninstall` → `planUninstall` → set `uninstallPrompt = { mod, plan }`. Confirm → `uninstallMod` → on success clear the prompt and reload installed mods and updates; on error set `uninstallPrompt.error` and keep it open.

- [ ] **Step 5: Run frontend tests, typecheck, lint**

  Run: `pnpm --filter @kraken/frontend test && pnpm --filter @kraken/frontend typecheck && pnpm --filter @kraken/frontend lint`
  Expected: PASS.

- [ ] **Step 6: Commit**

  `feat(frontend): confirm uninstalls and offer orphan cleanup`

---

### Task 5: Docs and full verification

**Files:**
- Modify: `README.md` (endpoint list: drop `DELETE`, add the two `POST` routes; one paragraph on dependents and orphans)
- Modify: `docs/ROADMAP.md` (4.4: note dependent cascade and orphan cleanup)

- [ ] **Step 1: Update the docs**

- [ ] **Step 2: Full gate**

  Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm package:sea && pnpm smoke:sea`
  Expected: all exit 0.

- [ ] **Step 3: Manual check, if a browser is available**

  Use the isolated dev setup: XDG directories and a fake KSP in the scratchpad.
  1. Install Kerbalism with a config choice.
  2. Uninstall ModuleManager: the dialog lists Kerbalism as a dependent.
  3. Uninstall Kerbalism: the dialog offers its auto-installed dependencies.

  If no browser is available, check via `curl` against the API and report the browser step as not done.

- [ ] **Step 4: Commit**

  `docs: describe dependency-aware uninstall`
