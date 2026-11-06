# Modpack Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users import a CKAN modpack file (a `.ckan` metapackage) and install it like a registry metapackage, persistently.

**Architecture:** A new backend adapter stores imported metapackages in the
data directory; `RegistryService` merges them into its index (CKAN-meta wins on
identifier collisions) and exposes an import method behind
`POST /api/v1/modpacks`. The frontend adds an import button to the Installed
view that hands the imported module to the existing install flow.

**Tech Stack:** TypeScript, Node 24, Express 5, Zod contracts, Vue 3, Vitest 5, node:test, pnpm 11.

**Spec:** `docs/superpowers/specs/2026-11-06-modpack-import-design.md`

## Global Constraints

- No new dependencies. No `any`, no `@ts-ignore`, no unjustified `!`; `as` only with a comment.
- Stored files are validated with hand-written guards (backend style); API data with `@kraken/contracts` Zod schemas.
- Fail loudly: no empty catch, no swallowed errors; a damaged store is an error, never a silent reset.
- TDD: each new test is run and seen failing before the code change.
- English code/comments/commits; Conventional Commits; no AI attribution.
- Each task ends with `pnpm lint && pnpm typecheck && pnpm test` green.
- Exact copy: badge `Imported`; client-side size error `The modpack file is larger than 1 MB.`; button `Import modpack`.

Clarification decided while planning: `source` is optional in the contract and
in `CkanModule`; it is set to `"imported"` on imported modules and left absent
on CKAN-meta modules (absent means registry), so the 31k registry modules do
not grow the API payload.

## Review Focus

- A file that is not a metapackage, or whose identifier exists in CKAN-meta, must never reach the store.
- An imported modpack must never cause a download from a URL inside the imported file.
- Only `POST /api/v1/modpacks` accepts bodies up to 1 MB; every other route keeps the 100 kB limit.
- A registry refresh that brings a module with an imported identifier must hide the imported one from the index without deleting it from the store.
- A damaged `imported-modpacks.json` must make the registry load fail loudly, and "Refresh registry" must still be able to report it (not hide the error).

---

### Task 1: Store for imported modpacks (backend adapter, core and contract field)

**Files:**
- Create: `apps/backend/src/adapters/imported-modpack-store.ts`
- Modify: `apps/backend/src/platform.ts` (new `getImportedModpacksFilePath(platform)` next to `getInstallManifestFilePath`, same directory)
- Modify: `packages/core/src/ckan.ts` (`CkanModule.source?: "registry" | "imported"`)
- Modify: `packages/contracts/src/index.ts` (`ckanModuleSchema.source: z.enum(["registry", "imported"]).optional()`)
- Test: new `apps/backend/test/imported-modpack-store.test.ts`, `packages/contracts/test/schemas.test.mjs`

**Interfaces:**
- Produces: `class ImportedModpackStore { constructor(filePath: string); read(): Promise<CkanModule[]>; save(module: CkanModule): Promise<CkanModule[]> }` and `class ImportedModpackStoreError extends Error`.
  - File shape `{ schemaVersion: 1, modules: CkanModule[] }`; missing file → `[]`; any other shape or invalid JSON → `ImportedModpackStoreError` (message names the file).
  - Each stored module must have non-empty `identifier`, `name`, `version`, `kind === "metapackage"`, `authors` array, `tags` array, `provides` array; deeper fields are trusted as written by `save` (document this in a comment).
  - `save` replaces an entry with the same `identifier` and `version`, otherwise appends; writes atomically (temp file + rename, mode 0o600) like `config-store.ts`; returns the stored list.
- Produces: `getImportedModpacksFilePath(platform: PlatformPort): string`.

- [ ] **Step 1: Failing tests**: "returns no modules when the file is missing"; "saves and reads back a metapackage"; "replaces the same identifier and version, keeps a different version" (two versions of `MyPack` plus a re-save of 1.0 → 2 entries, the re-saved one updated); "rejects a malformed file" (`{ "schemaVersion": 1, "modules": [{ "identifier": "" }] }` and `not json` → `ImportedModpackStoreError`); contracts: a mod with `source: "imported"` parses, `source: "other"` is rejected.
- [ ] **Step 2: Run** `pnpm --filter @kraken/backend exec vitest run test/imported-modpack-store.test.ts` and `pnpm --filter @kraken/contracts test` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS; full checks.
- [ ] **Step 5: Commit** `feat(backend): store imported modpacks`.

### Task 2: Merge imports into the registry and add the import endpoint

**Files:**
- Modify: `apps/backend/src/registry-service.ts` (constructor takes an `ImportedModpackStore`; index merge; `importModpack`)
- Modify: `apps/backend/src/app.ts` (`createDefaultDependencies` wiring; body limits; `POST /api/v1/modpacks`; error mapping for `INVALID_MODPACK` and `ImportedModpackStoreError`)
- Modify: `packages/contracts/src/index.ts` (`importModpackRequestSchema = z.object({ contents: z.string().min(1) })`, `importModpackResponseSchema = z.object({ mod: ckanModuleSchema })`)
- Test: `apps/backend/test/registry-api.test.ts`, `apps/backend/test/install-api.test.ts` (update every `new RegistryService(...)` in tests to pass a store in a temp dir)

**Interfaces:**
- Consumes: Task 1 store and `source` field; `parseCkanDocument` from core.
- `RegistryService` index = registry snapshot modules + stored imports whose identifier is absent from the snapshot, each import marked `source: "imported"`; rebuilt after cache load, after refresh and after an import. Without a snapshot (registry missing) the index holds only imports. A store read error surfaces as `RegistryServiceError("…", "REGISTRY_CACHE_ERROR")` from `ensureLoaded` and from `refresh` (the refresh still writes the new registry cache first).
- `importModpack(contents: string): Promise<CkanModule>` — throws `RegistryServiceError` with a new code `"INVALID_MODPACK"` and the exact messages: `The modpack file is not valid JSON.`, `The modpack file is missing an identifier, name or version.`, `The modpack file is not a CKAN metapackage.`, `${identifier} is a mod in the CKAN registry and cannot be replaced by an imported file.` On success saves through the store, rebuilds the index, returns the module with `source: "imported"`. The module's `download`/`downloadMirrors` are dropped before saving (an imported file never supplies download URLs).
- `POST /api/v1/modpacks`: body parsed by `express.json({ limit: "1mb" })` for this path only; every other route keeps `express.json({ limit: "100kb" })` (one middleware that picks the parser by `request.path`). Over the limit → 413 with the existing error shape (`PAYLOAD_TOO_LARGE`). Invalid body (schema) → 400 `INVALID_REQUEST`. `INVALID_MODPACK` → 400 with its message. Success → 200 `importModpackResponseSchema`.

Fixture modpack for tests: `{ spec_version: "v1.34", identifier: "MyPack", name: "My Pack", abstract: "A modpack", author: "User", version: "1.0", kind: "metapackage", depends: [{ name: "ModuleManager" }, { name: "AnotherMod", version: "1.0.0" }], download: "https://evil.test/x.zip" }`.

- [ ] **Step 1: Failing tests** (install-api.test.ts, new describe "modpack import"): "imports a modpack that can then be found, planned and installed" (POST → 200 `mod.source === "imported"`, no `download` in the response; `/api/v1/mods?q=My Pack` finds it; install with `{}` succeeds; GameData has ModuleManager and AnotherMod; no request ever goes to `https://evil.test/x.zip` — assert via the HTTP mock); "rejects files that are not modpacks" (it.each over: `not json` → `not valid JSON`; a regular mod with download → `not a CKAN metapackage`; `identifier: "ModuleManager"` with `kind: "metapackage"` → `cannot be replaced`; missing version → `missing an identifier`), each 400 and the store file absent afterwards; "accepts up to 1 MB only on the import route" (a 200 kB `contents` padding string in `abstract` → 200 on `/api/v1/modpacks`; a 200 kB body to `PUT /api/v1/config` → 413); "keeps an imported modpack across a restart and offers its dependencies as orphans" (import, install, `restart()`, `uninstall-plan` for MyPack lists ModuleManager and AnotherMod as orphans); registry-api.test.ts: "hides an imported modpack when the registry gains a mod with the same identifier" (import `MechJeb2`-named metapackage before the first refresh → visible with `source: "imported"`; refresh with the fixture archive that contains `MechJeb2` → `/api/v1/mods/MechJeb2` has no `source`; the store file still contains it); "reports a damaged imports file" (write `not json` to the store path → `GET /api/v1/registry` → 500 `REGISTRY_CACHE_ERROR` mentioning the file).
- [ ] **Step 2: Run** both test files — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS; full checks.
- [ ] **Step 5: Commit** `feat(backend): import CKAN modpack files as metapackages`.

### Task 3: Import button, flow and badge in the UI

**Files:**
- Modify: `apps/frontend/src/api.ts` (`importModpack(contents: string): Promise<ImportModpackResponse>`)
- Modify: `apps/frontend/src/components/InstalledModsView.vue` (button + hidden input; emits `importModpack: [file: File]`)
- Modify: `apps/frontend/src/App.vue` (handler: size check, `file.text()`, `importModpack`, then `onInstall(mod)`; errors via `reportError`)
- Modify: `apps/frontend/src/components/ModTable.vue`, `apps/frontend/src/components/ModDetailsPanel.vue` (badge `Imported`, data-testid `imported-badge`, when `mod.source === "imported"`)
- Modify: `CHANGELOG.md` (`[Unreleased]` → Added)
- Test: `apps/frontend/test/InstalledModsView.test.ts`, `apps/frontend/test/BrowseModsView.test.ts`, `apps/frontend/test/ModDetailsPanel.test.ts`, `apps/frontend/test/App.test.ts`

**Interfaces:**
- Consumes: contract `importModpackResponseSchema`, `source`.
- `MAX_MODPACK_BYTES = 1_048_576` in `App.vue` (or a small module next to `installable.ts`); a larger `file.size` → `errorMessage = "The modpack file is larger than 1 MB."` and no request.
- The hidden input has `tabindex="-1"`, `class="sr-only"` or `hidden`, `accept=".ckan,application/json"`, and its value is reset after each pick so the same file can be picked again. After the picker closes, focus returns to the `Import modpack` button.
- CHANGELOG Added bullet: `Modpacks can be imported from a CKAN .ckan file (for example one made with CKAN's "Export modpack"): Kraken keeps the imported metapackage, installs the mods it lists, and marks it as Imported in the mod list.`

- [ ] **Step 1: Failing tests**: InstalledModsView: clicking `Import modpack` clicks the hidden input (spy on `HTMLInputElement.prototype.click`); a `change` event with a file emits `importModpack` with that file. App: a picked file of 2 MB shows the size error and makes no `/api/v1/modpacks` request; a valid file posts `{ contents }`, then plans the returned module and shows the dependency dialog; a 400 response shows its message in the alert. Badge tests for ModTable/BrowseModsView and ModDetailsPanel.
- [ ] **Step 2: Run** `pnpm --filter @kraken/frontend exec vitest run` — new tests FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS; full checks.
- [ ] **Step 5: Commit** `feat(frontend): import modpacks from the Installed view`.

### Final

- [ ] Whole-branch review (fresh reviewer, most capable model); one fix wave for Critical/Important findings with RED→GREEN tests.
- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm build`; browser check with mocked API responses: import button, size error, import → dialog, `Imported` badge. No installs on the user's real KSP.
