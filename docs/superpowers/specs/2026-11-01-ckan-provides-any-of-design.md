# CKAN `provides` and `any_of` resolution

Status: approved design, 2026-11-01

## Problem

The install-plan resolver in `@kraken/core` cannot resolve two common CKAN
relationship forms:

- **`provides` (virtual packages).** The parser drops the `provides` field, so
  a dependency on a virtual name (for example `RSSTextures`,
  `Scatterer-sunflare-default`, `FAR`) never matches the module that provides
  it and the plan reports it as unmet.
- **`any_of` groups.** The parser marks them `unsupported`, which blocks the
  plan by design (fail closed).

Measured on the cached CKAN registry (3,740 identifiers, 30,834 versions):

- 90 identifiers depend directly on a name that is not a real identifier.
- 21 identifiers use `any_of` in `depends`.
- About 298 identifiers (~8%) are blocked directly or transitively, including
  EnvironmentalVisualEnhancements, Parallax, Kerbalism, DistantObject,
  RealSolarSystem and RealismOverhaul.

## Goals

- Resolve dependencies satisfied by a module's `provides`.
- Resolve `any_of` groups.
- Pick a provider automatically only when the choice is unambiguous; otherwise
  ask the user, as CKAN does.
- Treat `conflicts` on a virtual name as a conflict with every provider of it.
- Keep failing closed for relationship shapes Kraken still cannot interpret.

## Non-goals

- A complete SAT solver or backtracking. The resolver stays greedy: each
  dependency gets the latest compatible version. If a greedy pick leads to a
  conflict, the plan is `blocked`; Kraken does not search other version
  combinations.
- Choices for `recommends` / `suggests`. They keep being reported as
  optional entries; `any_of` inside them is shown but never installed
  automatically.
- Playwright E2E. The repo has no Playwright setup, and adding it is a new
  dependency, so it is tracked separately before v1.0.0.

## Domain (`packages/core`)

### Parsing (`ckan.ts`)

- `CkanModule` gains `provides: string[]`, parsed from the `.ckan` `provides`
  array (non-empty strings only, deduplicated, never containing the module's
  own identifier). Modules without the field get `[]`.
- `CkanRelationship` becomes a discriminated union:

  ```ts
  type CkanSingleRelationship = {
    kind: "single";
    name: string;
    minVersion?: string;
    maxVersion?: string;
  };
  type CkanAnyOfRelationship = {
    kind: "anyOf";
    alternatives: CkanSingleRelationship[];
  };
  type CkanUnsupportedRelationship = { kind: "unsupported"; reason: string };
  type CkanRelationship =
    | CkanSingleRelationship
    | CkanAnyOfRelationship
    | CkanUnsupportedRelationship;
  ```

  A union rather than an `unsupported` flag, so the compiler forces every
  consumer that reads `relation.name` today to handle each shape explicitly.
- An `any_of` entry parses into `anyOf` when every alternative is a valid
  single relationship and there is at least one. Otherwise the whole entry
  becomes `unsupported`. Nested arrays and entries without a name stay
  `unsupported`, as today.
- A `version` field on a relationship (exact version) maps to
  `minVersion = maxVersion = version`, consistent with CKAN semantics.

### Candidate lookup

A provider index maps each name to the modules that satisfy it: modules whose
`identifier` equals the name (`via: "identifier"`) plus modules whose
`provides` contains it (`via: "provides"`). For each candidate identifier the
resolver uses the latest version that satisfies the relationship's version
range.

Version ranges apply to the providing module's own version. CKAN does the
same: virtual packages have no version of their own.

### Resolution order for a dependency

For a `single` relationship, and for each alternative of an `anyOf` group:

1. **Installed**: an installed mod whose identifier matches, or whose registry
   metadata for the installed version lists the name in `provides`, and whose
   version satisfies the range. The dependency is satisfied.
2. **Planned**: a module already in this plan that matches the same way. The
   dependency is satisfied.
3. **User choice**: if `choices[key]` names an identifier that is among the
   candidates, that candidate is planned and resolved recursively. If it names
   anything else, the plan gets an `unmet` entry saying the choice is not a
   valid provider. It never silently falls back to another candidate.
4. **Registry candidates**: exactly one candidate is planned automatically.
   Several candidates produce a pending choice. Zero produce `unmet`.

For an `anyOf` group, steps 1 and 2 succeed if any alternative is satisfied.
Steps 3 and 4 work on the union of the alternatives' candidates, deduplicated
by identifier.

Choice keys are deterministic:

- `single`: the relationship name, e.g. `RSSTextures`.
- `anyOf`: `any_of:` + the alternative names sorted and joined with `|`, e.g.
  `any_of:EVE-Default|EVE-HD|SVE`.

The same key at several places in the tree yields one pending choice.
`requiredBy` lists every requiring module.

A pending choice is not expanded. Its subtree is resolved after the user
picks, on the next plan request, which may surface further choices. The UI
iterates until the plan is no longer `choice-required`.

### Conflicts

A `conflicts` relationship with name `X` matches every installed, planned or
target module whose identifier is `X` or whose `provides` contains `X`, within
the version range. A module never conflicts with itself, so CKAN's pattern of
providers of the same virtual package conflicting with that name is handled
without the target blocking its own install. `anyOf` inside `conflicts`
matches if any alternative matches. `unsupported` in `conflicts` keeps
blocking.

### Plan status

`blocked` if there is any conflict or unmet entry; otherwise
`choice-required` if there are pending choices; otherwise `ok`. A `blocked`
plan still reports pending choices.

## Contracts (`packages/contracts`)

- `planModRequestSchema` and `installModRequestSchema` gain an optional
  `choices: z.record(z.string().min(1).max(256), z.string().min(1).max(256))`,
  refined to at most 64 entries.
- `installPlanStatusSchema`: `"ok" | "choice-required" | "blocked"`.
- `installPlanResponseSchema` gains:

  ```ts
  choices: Array<{
    key: string;
    label: string; // e.g. "RSSTextures" or "one of EVE-Default, EVE-HD, SVE"
    requiredBy: string[];
    candidates: Array<{ identifier; name; version; via: "identifier" | "provides" }>;
  }>;
  ```

- The ckan relationship schema used by mod details mirrors the new union so
  the details panel can render `any_of` groups and provided names.

## Backend (`apps/backend`)

- `InstallService.planInstall` and `startInstall` accept `choices` and pass
  them to `resolveInstallPlan`.
- `startInstall` with `installDependencies: true` recomputes the plan with
  the same choices. A `blocked` plan keeps throwing the existing
  `PLAN_BLOCKED` (HTTP 422). A `choice-required` plan throws a new
  `PLAN_NOT_READY` error, which the API maps to **409** with the pending
  choice labels. No job is created in either case.
- `startInstall` with `installDependencies: false` is unchanged.

### Registry cache migration

The stored registry cache has no `provides`, so `schemaVersion` becomes `2`.
`RegistryCacheStore.read()` recognises `schemaVersion: 1` as stale: it logs a
warning and returns `undefined`, so the app behaves as on first run and the
registry is refreshed. Any other unexpected shape keeps throwing
`RegistryCacheError`. This explicit branch exists only for the one known old
version.

## Frontend (`apps/frontend`)

- `App.vue` keeps the accumulated `choices` next to `dependencyPrompt` and
  clears them on cancel or after the install starts.
- A `choice-required` plan opens the existing dependency modal in
  `BrowseModsView.vue`. It shows one `<fieldset>` with a `<legend>` per
  pending choice, e.g. "RSSTextures, required by RealSolarSystem", and native
  radio inputs for the candidates: name, version, "provides" annotation when
  `via` is `provides`. "Continue" is disabled until every choice has a
  selection. It re-plans with the merged choices.
- When the plan becomes `ok`, the modal shows the current
  "requires X, Y, install?" confirmation. The install request carries the
  same choices.
- `blocked` plans keep showing their messages as today.
- The mod details panel renders `any_of` groups as "one of A, B, C" and lists
  provided names.

## Testing

TDD for the domain and backend changes.

- `packages/core/test/ckan.test.mjs`: `provides` parsing; `any_of` parsing,
  including invalid alternatives becoming `unsupported`; exact `version`.
- `packages/core/test/resolve.test.mjs`:
  - single provider picked automatically;
  - installed provider satisfies the dependency;
  - several providers produce `choice-required` with a deterministic key;
  - a valid choice is honoured and resolved recursively;
  - an invalid choice becomes `unmet`;
  - `any_of` group satisfied by an installed alternative;
  - `any_of` group producing a choice over the union of candidates;
  - conflict through `provides`;
  - providers of the same virtual package do not block their own install;
  - nested choice across two plan iterations.
- `apps/backend/test/install-api.test.ts`: `choices` validation, including
  the size limit; 409 `PLAN_NOT_READY`; choices passed through to install.
- `apps/backend/test/registry-api.test.ts`: a v1 cache is treated as missing.
- `apps/frontend/test/BrowseModsView.test.ts` and `App.test.ts`: choice
  fieldsets render and are keyboard-reachable radios; "Continue" re-plans
  with the merged choices; install carries the choices.
- Manual browser check against the live registry: install RealSolarSystem,
  choose an RSSTextures variant, confirm the dependencies land in GameData.
