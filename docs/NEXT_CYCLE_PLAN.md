# Next delivery cycle: Dependency resolver

## Outcome

Before installing a mod, Kraken computes a dry-run install plan from CKAN
`depends` / `conflicts` (plus informational `recommends` / `suggests`), prompts
to auto-install missing hard dependencies, and can install the transitive set
in one job with existing SSE progress.

This cycle implements Roadmap items 5.1–5.2.

## Current baseline

- Phases 1–4 deliver the monorepo, KSP setup, CKAN registry, GameData inventory,
  ZIP install/uninstall with `install-manifest.json`, and a minimal Vue UI.
- `@kraken/core` parses install stanzas and download hashes but not relationship
  fields.
- Install starts a single-module job with no dependency planning.

## Scope

### 1. Relationship parsing

- Parse `depends`, `conflicts`, `recommends`, and `suggests` into
  `CkanRelationship` (`name`, optional `min_version` / `max_version`).
- Expose them on `CkanModule.relationships`.

### 2. Install plan resolver (`@kraken/core`)

- Transitive BFS over `depends`; pick latest registry version in range.
- Merge with inventory (`managed` + `detected`).
- Surface conflicts, unmet deps, and optional recommends/suggests.
- Status `ok` or `blocked` (conflicts or unmet).

### 3. API

| Method and route | Purpose |
| --- | --- |
| `POST /api/v1/mods/:identifier/plan` | Dry-run install plan (optional `version`) |
| `POST /api/v1/mods/:identifier/install` | Body may include `installDependencies` (default `false`) |

When `installDependencies: true` and the plan is `ok`, one job installs
dependencies then the target, reusing `GET /api/v1/jobs/:jobId/events`.

### 4. Minimal UI slice

- Call `plan` before install.
- Modal when hard dependencies are missing.
- Confirm → install with `installDependencies: true`.
- Blocked plans show an error without starting a job.

### 5. Out of scope

- Full SAT solver / `any_of` / `provides` virtuals.
- Auto-install of `recommends` / `suggests`.
- Full dashboard / browser / queue chrome (Phase 6).
- SEA packaging (Phase 7).

## Delivery order

1. Document this cycle; leave Roadmap 5.x unchecked until DoD.
2. CKAN relationship parsing + unit tests.
3. `resolveInstallPlan` + unit tests.
4. Contracts, plan route, `installDependencies`, API tests.
5. Frontend plan → modal → install.
6. Quality gates; mark Roadmap 5.1–5.2; update README.

## Definition of done

- Mod with unmet `depends` returns those modules in the plan.
- UI confirmation installs dependencies then the target via one SSE job.
- Conflicts / unmet deps block install with a clear error.
- `installDependencies: false` preserves Phase 4 single-mod install.
- `pnpm lint`, `pnpm typecheck`, and `pnpm test` pass.
