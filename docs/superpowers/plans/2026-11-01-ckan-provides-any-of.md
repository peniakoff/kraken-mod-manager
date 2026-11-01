# CKAN `provides` and `any_of` Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the install planner resolve CKAN virtual packages (`provides`) and `any_of` groups, auto-picking unambiguous providers and asking the user otherwise.

**Architecture:** The parser turns relationships into a discriminated union and keeps `provides`. A provider index in `@kraken/core` feeds a greedy resolver that returns pending choices with status `choice-required`. Contracts, backend and frontend pass a stateless `choices` map through plan and install requests until the plan is `ok`.

**Tech Stack:** TypeScript 7, Node 24 `node:test` (core, contracts), Vitest + supertest (backend), Vitest + @vue/test-utils (frontend), Zod.

**Spec:** `docs/superpowers/specs/2026-11-01-ckan-provides-any-of-design.md`

## Global Constraints

- pnpm via Corepack; no new dependencies; do not regenerate the lockfile.
- Domain logic stays in `packages/core` with no Vue/Express imports.
- No `any`, no `@ts-ignore`; `as` only with a comment explaining why it is safe.
- Fail closed: unparseable relationship shapes keep blocking the plan.
- `choices` request field: record of strings (each 1–256 chars), at most 64 entries.
- Choice keys: `single` → relationship name; `anyOf` → `any_of:` + sorted alternative names joined with `|`.
- Status precedence: `blocked` > `choice-required` > `ok`.
- Registry cache `schemaVersion` becomes `2`; `1` is treated as stale (warn, return `undefined`).
- Core tests run against `dist`, so rebuild before running them: `pnpm --filter @kraken/core build`.
- Commit after every task on branch `feat/ckan-provides-any-of`, Conventional Commits, no AI attribution.

## Review Focus

1. **Provider cycles.** A depends on virtual X, provided only by B, and B depends on A. The plan must terminate and stay `ok`. Test in Task 2.
2. **Target provides the needed name.** A dependency of a dependency needs virtual X, and the target provides X. It must be satisfied by the target, not offered as a choice. Test in Task 2.
3. **Stale choice keys.** The client sends a choice for a key the current plan no longer asks about, for example after an earlier pick changed the tree. Ignore it without error. Test in Task 2.
4. **Detected (unmanaged) mod without a version providing X.** It satisfies an unranged dependency on X via its latest registry metadata, but not a ranged one. Test in Task 2.
5. **Ranged dependency on a virtual name.** Each provider contributes its latest version inside the range; providers with no version in range are not candidates. Test in Task 2.

---

### Task 1: Relationship union, `provides` and exact `version` in the parser

**Files:**
- Modify: `packages/core/src/ckan.ts` (types at lines 18–35, `CkanModule`, `parseCkanDocument`, `parseRelationshipList` at 574–618)
- Modify: `packages/core/src/resolve.ts` (mechanical adaptation only, no behaviour change)
- Modify: `packages/core/src/index.ts` (exports)
- Test: `packages/core/test/ckan.test.mjs`, `packages/core/test/resolve.test.mjs`

**Interfaces:**
- Produces:
  ```ts
  export interface CkanSingleRelationship { kind: "single"; name: string; minVersion?: string; maxVersion?: string }
  export interface CkanAnyOfRelationship { kind: "anyOf"; alternatives: CkanSingleRelationship[] }
  export interface CkanUnsupportedRelationship { kind: "unsupported"; reason: string }
  export type CkanRelationship = CkanSingleRelationship | CkanAnyOfRelationship | CkanUnsupportedRelationship;
  // CkanModule gains: provides: string[]
  ```
  All four types exported from `packages/core/src/index.ts`.

- [ ] **Step 1: Update existing parser tests and add new ones in `ckan.test.mjs`**

  Change existing expectations to the union shape. For example, `{ name: "ModuleManager" }` becomes `{ kind: "single", name: "ModuleManager" }`. Then add:
  - `test("parses provides, dropping blanks, duplicates and the own identifier")`: `provides: ["EVE-Config", "", "EVE-Config", "FancyMod"]` on identifier `FancyMod` gives `provides` equal to `["EVE-Config"]`. A document without `provides` gives `[]`.
  - `test("parses any_of groups into anyOf relationships")`: `depends: [{ any_of: [{ name: "TextureReplacer" }, { name: "DiRT", min_version: "1.0" }] }]` gives
    `[{ kind: "anyOf", alternatives: [{ kind: "single", name: "TextureReplacer" }, { kind: "single", name: "DiRT", minVersion: "1.0" }] }]`.
  - Rewrite the existing unsupported test:
    - `any_of: []` gives `{ kind: "unsupported", reason: "empty any_of" }`;
    - `any_of: [{ name: "A" }, { min_version: "1" }]` gives `{ kind: "unsupported", reason: "invalid any_of alternative" }`;
    - `{ min_version: "1.0.0" }` gives `{ kind: "unsupported", reason: "missing name" }`;
    - `[[{ name: "NestedLegacy" }]]` gives `{ kind: "unsupported", reason: "nested array" }`.
  - `test("maps an exact relationship version to min and max")`: `{ name: "A", version: "1.2" }` gives `{ kind: "single", name: "A", minVersion: "1.2", maxVersion: "1.2" }`.

- [ ] **Step 2: Update `resolve.test.mjs` fixtures to the union shape**

  Every `{ name: ... }` relationship gets `kind: "single"`. The test "blocks unsupported any_of depends instead of ignoring them" becomes "blocks unsupported depends instead of ignoring them" and uses `{ kind: "unsupported", reason: "nested array" }`. Its assertions are unchanged.

- [ ] **Step 3: Run tests to verify they fail**

  Run: `pnpm --filter @kraken/core build && cd packages/core && node --test test/ckan.test.mjs`
  Expected: FAIL on the new provides/anyOf/version tests.

- [ ] **Step 4: Implement the parser changes in `ckan.ts`**

  `parseRelationshipList` returns `CkanRelationship[]` built by a new `parseSingleRelationship(raw): CkanSingleRelationship | undefined`, which is reused for `any_of` alternatives. `version` wins over `min_version`/`max_version` when present. Add `parseProvides(value: unknown, identifier: string): string[]`.

- [ ] **Step 5: Adapt `resolve.ts` to the union without changing behaviour**

  `kind === "unsupported"` and `kind === "anyOf"` both keep producing the existing "unsupported dependency relationship" unmet entry, and are skipped in optional and conflict checks exactly as `unsupported: true` is today. `kind === "single"` follows the existing path. Use exhaustive `switch` with a `never` default.

- [ ] **Step 6: Run core tests and typecheck**

  Run: `pnpm --filter @kraken/core build && cd packages/core && node --test && cd ../.. && pnpm --filter @kraken/core typecheck`
  Expected: all PASS.

- [ ] **Step 7: Commit**

  ```bash
  git add packages/core
  git commit -m "feat(core): parse provides and any_of into a relationship union"
  ```

---

### Task 2: Provider index, `provides` resolution and choices for single relationships

**Files:**
- Create: `packages/core/src/providers.ts`
- Modify: `packages/core/src/resolve.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/resolve.test.mjs`

**Interfaces:**
- Consumes: Task 1 types.
- Produces:
  ```ts
  // providers.ts
  export interface ProviderCandidate { module: CkanModule; via: "identifier" | "provides" }
  export class ProviderIndex {
    constructor(modules: readonly CkanModule[]);
    /** Latest version per providing identifier that satisfies the range, sorted by identifier. */
    candidates(relation: CkanSingleRelationship): ProviderCandidate[];
    /** True when `module` is `name` or provides it. */
    static satisfiesName(module: CkanModule, name: string): boolean;
  }

  // resolve.ts
  export type InstallPlanStatus = "ok" | "choice-required" | "blocked";
  export interface InstallPlanChoiceCandidate extends InstallPlanModuleRef { via: "identifier" | "provides" }
  export interface InstallPlanChoice { key: string; label: string; requiredBy: string[]; candidates: InstallPlanChoiceCandidate[] }
  // ResolveInstallPlanOptions gains: choices?: Readonly<Record<string, string>>
  // InstallPlan gains: choices: InstallPlanChoice[]
  ```
  `ProviderIndex`, `InstallPlanChoice`, `InstallPlanChoiceCandidate` are exported from `index.ts`.

- [ ] **Step 1: Write failing tests in `resolve.test.mjs`**

  Each test uses the existing `mod()` helper.
  - `"auto-picks the only provider of a virtual dependency"`: target depends on `RSSTextures`, only `RSSTextures8192` provides it. Expect `status === "ok"`, `toInstall` identifiers equal `["RSSTextures8192", target]`, `choices` equal `[]`.
  - `"treats an installed provider as satisfying a virtual dependency"`: the inventory has managed `RSSTextures8192` at the version whose metadata provides `RSSTextures`. Expect `ok`, and `alreadySatisfied[0].identifier === "RSSTextures8192"`.
  - `"asks for a choice when several modules provide a dependency"`: `RSSTextures4096` and `RSSTextures8192` both provide it. Expect `status === "choice-required"`, `choices` equal `[{ key: "RSSTextures", label: "RSSTextures", requiredBy: [target], candidates: [<4096 ref, via "provides">, <8192 ref, via "provides">] }]`, and `toInstall` containing only the target.
  - `"honours a valid choice and resolves its dependencies"`: as above, with `choices: { RSSTextures: "RSSTextures8192" }`, where 8192 depends on `Kopernicus`. Expect `ok`, with `toInstall` containing Kopernicus, then 8192, then the target.
  - `"reports an invalid choice as unmet"`: `choices: { RSSTextures: "SomethingElse" }`. Expect `blocked`, with an unmet message matching `/SomethingElse is not a provider of RSSTextures/`.
  - `"merges requiredBy for the same choice key"`: two planned modules both depend on `RSSTextures`. Expect one choice, `requiredBy` with both identifiers sorted.
  - Review Focus 1 `"terminates on a cycle through provides"`.
  - Review Focus 2 `"lets the target satisfy a virtual name it provides"`.
  - Review Focus 3 `"ignores choices for keys the plan does not ask about"`: `choices: { Unrelated: "X" }` on an `ok` plan stays `ok`.
  - Review Focus 4 `"lets a versionless detected provider satisfy only unranged dependencies"`.
  - Review Focus 5 `"limits candidates to provider versions inside the range"`: provider A has 1.0 and 2.0, provider B only has 1.0, the dependency is `{ name: "X", minVersion: "2.0" }`. Expect A 2.0 auto-picked and B absent.

- [ ] **Step 2: Run tests to verify they fail**

  Run: `pnpm --filter @kraken/core build && cd packages/core && node --test test/resolve.test.mjs`
  Expected: FAIL. The new tests report unmet "No compatible version of RSSTextures" or a missing `choices` field.

- [ ] **Step 3: Implement `ProviderIndex` in `providers.ts`**

  Build `Map<name, CkanModule[]>` once from identifiers and `provides`. `candidates()` groups by identifier, keeps the latest version in range using `compareCkanVersions`, and sets `via` to `"identifier"` when `module.identifier === relation.name`.

- [ ] **Step 4: Rewrite single-relationship handling in `resolveInstallPlan`**

  Follow the resolution order in the spec, section "Resolution order for a dependency":
  1. Installed: an inventory entry whose identifier matches, or whose metadata from `findInstalledMetadata` provides the name, with the version check from `versionMatchesInstalled`.
  2. Planned or target: `ProviderIndex.satisfiesName` plus `versionMatchesModule`.
  3. `choices[key]`.
  4. Candidates: 1 → plan it, more than 1 → pending choice, 0 → the existing unmet message.

  Pending choices go into a `Map<key, InstallPlanChoice>`. Merge `requiredBy`, sort it, and do not recurse into a pending choice. Compute status by the precedence rule. Keep `topologicalInstallOrder`, but resolve dependency edges by `satisfiesName` so a dependency on a virtual name orders its provider first.

- [ ] **Step 5: Run core tests and typecheck**

  Run: `pnpm --filter @kraken/core build && cd packages/core && node --test && cd ../.. && pnpm --filter @kraken/core typecheck && pnpm --filter @kraken/core lint`
  Expected: all PASS.

- [ ] **Step 6: Commit**

  ```bash
  git add packages/core
  git commit -m "feat(core): resolve virtual dependencies through provides"
  ```

---

### Task 3: `any_of` groups and conflicts through `provides`

**Files:**
- Modify: `packages/core/src/resolve.ts`
- Test: `packages/core/test/resolve.test.mjs`

**Interfaces:**
- Consumes: `ProviderIndex`, `InstallPlanChoice` from Task 2.
- Produces: no new exports.

- [ ] **Step 1: Write failing tests**

  - `"treats an any_of group as satisfied by an installed alternative"`: the group is `EVE-Default|SVE`, and `SVE` is installed. Expect `ok`, with nothing planned for the group.
  - `"auto-picks the only available alternative of an any_of group"`: only `SVE` exists in the registry. Expect `ok`, with `SVE` planned.
  - `"asks for a choice over the union of any_of candidates"`: the alternatives are `EVE-HD` and `SVE`, and `EVE-Default` provides `EVE-HD`. Expect one choice with `key === "any_of:EVE-HD|SVE"`, `label === "one of EVE-HD, SVE"`, and candidates `EVE-Default` (`via: "provides"`) and `SVE` (`via: "identifier"`), deduplicated by identifier.
  - `"blocks when a planned module conflicts with a virtual name another planned module provides"`: A conflicts with `FAR`, and planned B provides `FAR`. Expect `blocked`, with a conflict message naming B.
  - `"does not let a provider conflict with itself"`: B provides `FAR` and conflicts with `FAR` (the CKAN pattern). Installing B alone gives `ok`.
  - `"blocks when an installed module provides a name the target conflicts with"`.
  - `"blocks when a conflicts any_of group matches a planned module"`: the target conflicts with `any_of: [A, B]`, and B is planned. Expect `blocked`.
  - `"keeps recommends any_of as optional without installing it"`: the `optional` list has one entry with `name === "any_of:A|B"`, and `toInstall` has only the target.

- [ ] **Step 2: Run tests to verify they fail**

  Run: `pnpm --filter @kraken/core build && cd packages/core && node --test test/resolve.test.mjs`
  Expected: FAIL. `any_of` is still reported as unsupported.

- [ ] **Step 3: Implement `anyOf` resolution and provides-aware conflicts**

  - `anyOf`: steps 1 and 2 over every alternative. Then `choices[key]` checked against the union of `ProviderIndex.candidates` per alternative, deduplicated by identifier with the first `via` kept. Then 1/many/0 as in Task 2.
  - Conflicts: `checkConflicts` and `checkInstalledModuleConflicts` match installed, planned and target modules via `satisfiesName` plus the version check, skip `module.identifier === conflicting.identifier`, and treat `anyOf` as matching if any alternative matches.
  - Optional `anyOf`: one optional entry with the choice key as `name`.

- [ ] **Step 4: Run core tests, typecheck and lint**

  Run: `pnpm --filter @kraken/core build && cd packages/core && node --test && cd ../.. && pnpm --filter @kraken/core typecheck && pnpm --filter @kraken/core lint`
  Expected: all PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add packages/core
  git commit -m "feat(core): resolve any_of groups and provides-aware conflicts"
  ```

---

### Task 4: Contracts and mod details rendering

**Files:**
- Modify: `packages/contracts/src/index.ts` (`ckanRelationshipSchema` ~line 89, `ckanModuleSchema` ~132, request schemas 214–225, plan schemas 227–275)
- Modify: `apps/frontend/src/components/ModDetailsPanel.vue` (relationship lists ~lines 300–365)
- Test: `packages/contracts/test/schemas.test.mjs`, `apps/frontend/test/ModDetailsPanel.test.ts`

**Interfaces:**
- Consumes: core types from Tasks 1–3, whose shapes must match.
- Produces:
  - `ckanRelationshipSchema` as `z.discriminatedUnion("kind", [...])` mirroring the core union.
  - `ckanModuleSchema.provides: z.array(z.string().min(1)).optional()`. It is optional so older API fixtures still parse; core always sets it.
  - `installChoicesSchema`, exported, used as `choices: installChoicesSchema.optional()` in `planModRequestSchema` and `installModRequestSchema`.
  - `installPlanStatusSchema = z.enum(["ok", "choice-required", "blocked"])`.
  - `installPlanChoiceSchema`, plus `choices: z.array(installPlanChoiceSchema)` on `installPlanResponseSchema`. Exported type `InstallPlanChoice`.

- [ ] **Step 1: Write failing contract tests in `schemas.test.mjs`**

  - The `choices` record accepts `{ RSSTextures: "RSSTextures8192" }`, and rejects 65 entries, an empty value, and a 257-char key.
  - The plan response with `status: "choice-required"` and one choice parses.
  - The relationship union accepts `single`, `anyOf` and `unsupported` and rejects `{ name: "A" }` without `kind`.

- [ ] **Step 2: Write failing panel tests in `ModDetailsPanel.test.ts`**

  Update fixtures to `kind: "single"`. Add:
  - `"renders any_of groups as one of"`: the text contains `one of TextureReplacer, DiRT`.
  - `"lists provided names"`: `provides: ["EVE-Config"]` renders `Provides:` and `EVE-Config`.

- [ ] **Step 3: Run tests to verify they fail**

  Run: `pnpm --filter @kraken/contracts build && cd packages/contracts && node --test; cd ../.. && pnpm --filter @kraken/frontend exec vitest run test/ModDetailsPanel.test.ts`
  Expected: FAIL.

- [ ] **Step 4: Implement the schemas and the panel rendering**

  In the panel, add a small `formatRelationship(relation: CkanRelationship): string` in the component script:
  - `single` → `name >= min <= max`, as today;
  - `anyOf` → `one of A, B`;
  - `unsupported` → `unsupported relationship`.

  Keys use the formatted string plus index.

- [ ] **Step 5: Run workspace typecheck and the touched tests**

  Run: `pnpm typecheck && pnpm --filter @kraken/contracts test && pnpm --filter @kraken/frontend exec vitest run test/ModDetailsPanel.test.ts`
  Expected: all PASS. Backend typecheck passes because the `plan` response schema now accepts `choices`.

- [ ] **Step 6: Commit**

  ```bash
  git add packages/contracts apps/frontend/src/components/ModDetailsPanel.vue apps/frontend/test/ModDetailsPanel.test.ts
  git commit -m "feat(contracts): add install choices and relationship union"
  ```

---

### Task 5: Backend plan and install with choices

**Files:**
- Modify: `apps/backend/src/install-service.ts` (`planInstall` ~80, `startInstall` ~91, `resolveModulesForInstall` ~223, `InstallServiceError` codes ~24)
- Modify: `apps/backend/src/app.ts` (plan route ~331, install route ~356, error mapping ~546)
- Test: `apps/backend/test/install-api.test.ts`

**Interfaces:**
- Consumes: `installChoicesSchema`, request schemas (Task 4), `resolveInstallPlan` with `choices` (Task 2).
- Produces:
  - `planInstall(kspPath, identifier, version?, choices?: Readonly<Record<string, string>>)`
  - `startInstall(kspPath, identifier, version?, installDependencies = false, choices?: Readonly<Record<string, string>>)`
  - New error code `"PLAN_NOT_READY"` → HTTP 409. `"PLAN_BLOCKED"` stays 422, as today.

- [ ] **Step 1: Write failing API tests in `install-api.test.ts`**

  Reuse the registry fixture helper used by `"plans dependencies and installs them when requested"`.
  - `"returns choice-required when several mods provide a dependency"`: `POST /plan` gives 200 with `status: "choice-required"` and `choices[0].key === "RSSTextures"`.
  - `"installs the chosen provider when choices are sent"`: `POST /install` with `{ installDependencies: true, choices: { RSSTextures: "RSSTextures8192" } }` gives 202. After the job finishes, the chosen mod is in `/installed-mods`.
  - `"rejects dependency installs with pending choices"`: no `choices` gives 409 with `code: "PLAN_NOT_READY"` and a message naming `RSSTextures`.
  - `"rejects oversized choices"`: 65 entries gives 400 `INVALID_REQUEST` on both `/plan` and `/install`.

- [ ] **Step 2: Run tests to verify they fail**

  Run: `pnpm --filter @kraken/contracts build && pnpm --filter @kraken/core build && pnpm --filter @kraken/backend exec vitest run test/install-api.test.ts`
  Expected: FAIL.

- [ ] **Step 3: Implement**

  Routes pass `body.data.choices` through. `resolveModulesForInstall` passes `choices` to `resolveInstallPlan`. It keeps throwing `PLAN_BLOCKED` for `blocked`. For `choice-required` it throws `PLAN_NOT_READY` with the message `Install plan needs a choice for: <labels joined by ", ">.`. Add `PLAN_NOT_READY` → 409 in the error mapping.

- [ ] **Step 4: Run backend tests, typecheck and lint**

  Run: `pnpm --filter @kraken/backend test && pnpm --filter @kraken/backend typecheck && pnpm --filter @kraken/backend lint`
  Expected: all PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add apps/backend
  git commit -m "feat(backend): accept install choices in plan and install requests"
  ```

---

### Task 6: Registry cache schema v2

**Files:**
- Modify: `apps/backend/src/adapters/registry-cache-store.ts`
- Test: `apps/backend/test/registry-api.test.ts`

**Interfaces:**
- Produces: `StoredRegistryCache.schemaVersion: 2`. `read()` returns `undefined` for a v1 file.

- [ ] **Step 1: Write failing tests in `registry-api.test.ts`**

  - `"treats a schema v1 registry cache as missing"`: write `{ schemaVersion: 1, sourceUrl, updatedAt, parseErrors: 0, modules: [] }` to the cache path. `GET /api/v1/registry` gives `status: "missing"`. Spy on `console.warn` with `vi.spyOn` and expect it called once with a message matching `/outdated registry cache/i`.
  - `"still rejects a malformed registry cache"`: `{ schemaVersion: 99 }` gives the existing error response (`REGISTRY_CACHE_ERROR`).
  - The existing `"refreshes, caches, searches, and restores from disk"` test still passes, now writing v2.

- [ ] **Step 2: Run tests to verify they fail**

  Run: `pnpm --filter @kraken/backend exec vitest run test/registry-api.test.ts`
  Expected: FAIL. v1 currently raises `REGISTRY_CACHE_ERROR`.

- [ ] **Step 3: Implement**

  Write `schemaVersion: 2`. In `read()`, before the full shape check, if the parsed object is a non-null object with `schemaVersion === 1`, call `console.warn("Ignoring outdated registry cache (schema v1); refresh the registry to rebuild it.")` and return `undefined`.

- [ ] **Step 4: Run backend tests**

  Run: `pnpm --filter @kraken/backend test`
  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add apps/backend
  git commit -m "fix(backend): rebuild registry cache saved before provides support"
  ```

---

### Task 7: Frontend choice flow

**Files:**
- Modify: `apps/frontend/src/api.ts` (`planModInstall` ~115, `installMod` ~123)
- Modify: `apps/frontend/src/App.vue` (`dependencyPrompt` ~63, `onInstall` ~309, `confirmDependencyInstall` ~344, `cancelDependencyInstall` ~353, `startInstallJob` ~361, template props ~463)
- Modify: `apps/frontend/src/components/BrowseModsView.vue` (props ~26, emits, modal ~160–200)
- Test: `apps/frontend/test/BrowseModsView.test.ts`, `apps/frontend/test/App.test.ts`

**Interfaces:**
- Consumes: `InstallPlanChoice`, `InstallPlanResponse` from Task 4. The 409 `PLAN_NOT_READY` from Task 5 surfaces as an error message.
- Produces:
  - `planModInstall(identifier, version?, choices?: Record<string, string>)`
  - `installMod(identifier, version?, installDependencies = false, choices?: Record<string, string>)`
  - `dependencyPrompt` type `{ mod: CkanModule; plan: InstallPlanResponse; choices: Record<string, string> }`
  - New `BrowseModsView` emit `continueWithChoices: [choices: Record<string, string>]`

- [ ] **Step 1: Write failing component tests in `BrowseModsView.test.ts`**

  - `"renders a fieldset per pending choice with radio candidates"`: a `dependencyPrompt` with a `choice-required` plan and one choice of two candidates. Expect one `fieldset` whose `legend` text is `RSSTextures, required by Real Solar System`, two `input[type=radio]` with the same `name`, and visible text `provides` next to each `via: "provides"` candidate.
  - `"keeps Continue disabled until every choice is selected"`.
  - `"emits continueWithChoices with the merged selections"`: the prompt's existing `choices: { A: "x" }` plus the radio pick gives the emit payload `{ A: "x", RSSTextures: "RSSTextures8192" }`.
  - `"shows the dependency confirmation when the plan is ok"`: the existing confirmation text still renders.

- [ ] **Step 2: Write failing integration test in `App.test.ts`**

  `"re-plans with choices and installs with them"`: mock `fetch` so the first `/plan` returns `choice-required`, the second (with body `choices`) returns `ok` with a missing dependency, and `/install` returns 202. Click Install, pick the radio, click Continue, click "Install automatically". Assert:
  - the second `/plan` body is `{ version, choices: { RSSTextures: "RSSTextures8192" } }`;
  - the `/install` body is `{ version, installDependencies: true, choices: { RSSTextures: "RSSTextures8192" } }`.

- [ ] **Step 3: Run tests to verify they fail**

  Run: `pnpm --filter @kraken/frontend exec vitest run test/BrowseModsView.test.ts test/App.test.ts`
  Expected: FAIL.

- [ ] **Step 4: Implement**

  - `api.ts` sends `choices` only when it is non-empty.
  - `App.vue`: extract the plan handling from `onInstall` into `applyPlan(mod, plan, choices)`.
    - `blocked`: error, as today.
    - `choice-required`: set `dependencyPrompt`.
    - `ok`: the existing missing-dependencies logic.

    `onContinueWithChoices(choices)` re-plans and calls `applyPlan`. Confirm passes `prompt.choices` to `startInstallJob`. Cancel clears the prompt.
  - `BrowseModsView.vue`: in the modal, when `plan.status === "choice-required"`, render the fieldsets. Local `selected` is a `ref<Record<string, string>>`, reset when the prompt changes. The heading is `Choose a provider` and the button is `Continue`. Otherwise render the current confirmation. Radios use `:id`/`for` pairs for labels; native radios give arrow-key navigation.

- [ ] **Step 5: Run frontend tests, typecheck and lint**

  Run: `pnpm --filter @kraken/frontend test && pnpm --filter @kraken/frontend typecheck && pnpm --filter @kraken/frontend lint`
  Expected: all PASS.

- [ ] **Step 6: Commit**

  ```bash
  git add apps/frontend
  git commit -m "feat(frontend): let users choose providers for virtual dependencies"
  ```

---

### Task 8: Docs and full verification

**Files:**
- Modify: `docs/ROADMAP.md` (5.2: note `provides`/`any_of` support and the greedy, no-backtracking limit)
- Modify: `docs/ARCHITECTURE.md` (only if it describes the resolver or registry cache schema; update those statements to match)

- [ ] **Step 1: Update the docs**

- [ ] **Step 2: Run the full gate**

  Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm package:sea && pnpm smoke:sea`
  Expected: all exit 0.

- [ ] **Step 3: Manual browser check against the live registry**

  1. `pnpm dev`, open `http://127.0.0.1:5173`.
  2. Refresh the registry. The old v1 cache must be ignored with a warning in the backend log.
  3. Plan RealSolarSystem: the provider choice for RSSTextures appears.
  4. Pick one variant, continue and install into a throwaway KSP copy. The dependencies must land in GameData.
  5. Repeat with one EVE/Parallax config-pack mod.

  Record the outcome in the final summary.

- [ ] **Step 4: Commit**

  ```bash
  git add docs
  git commit -m "docs: record provides and any_of support in the roadmap"
  ```
