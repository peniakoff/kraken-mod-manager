# Next delivery cycle: Mod management engine

## Outcome

After KSP setup and a refreshed CKAN registry, Kraken can inventory
`GameData`, download a mod ZIP with progress, install it according to `.ckan`
install stanzas (with hash checks and Zip Slip rejection), and uninstall
managed mods without leaving orphaned files.

This cycle implements Roadmap items 4.1–4.4.

## Current baseline

- Phases 1–3 deliver the monorepo, KSP discovery/setup, and CKAN registry
  fetch/parse/index/search with a minimal Vue browser.
- `@kraken/core` parses metadata fields needed for search but not `install`
  stanzas or `download_hash`.
- There is no GameData inventory, ZIP downloader, installer, uninstall
  manifest, or SSE progress channel.

## Scope

### 1. Extend CKAN parsing and API contracts

- Parse `install` stanzas (`file`, `find`, `find_regexp`, `install_to`, `as`)
  and `download_hash` (sha1 / sha256).
- Add contracts for installed-mods inventory, install requests, job status,
  and progress events.
- Expose:

| Method and route | Purpose |
| --- | --- |
| `GET /api/v1/installed-mods` | Inventory from install manifest + GameData scan |
| `POST /api/v1/mods/:identifier/install` | Start an async install job |
| `DELETE /api/v1/mods/:identifier` | Uninstall a managed mod |
| `GET /api/v1/jobs/:jobId` | Job status |
| `GET /api/v1/jobs/:jobId/events` | SSE download/extract progress |

### 2. Core install policy

Framework-independent logic in `@kraken/core`:

- Map archive paths through install stanzas (or CKAN defaults) to destinations
  under the selected KSP root.
- Reject destinations outside allowed roots (`GameData` and documented
  `install_to` targets).
- Merge managed manifest entries with top-level `GameData` folders that match
  known registry identifiers (`managed` vs `detected`).
- Compute uninstall file lists from the manifest.

### 3. Backend adapters and InstallService

- Streaming HTTP download with byte progress.
- Pure-JS ZIP extraction with Zip Slip rejection and size caps.
- Atomic `install-manifest.json` beside other app data.
- Download cache directory via platform helpers.
- In-memory job store and SSE fan-out for a single local user.
- Require a configured, validated KSP installation for mutating routes.

### 4. Minimal UI slice

- Installed-mods list after setup.
- Install on searchable mods that declare a `download` URL.
- Uninstall for `managed` entries.
- Simple progress via `EventSource` on the job SSE endpoint.

### 5. Out of scope

- Dependency / conflict resolution (Phase 5).
- Full dashboard, mod details panel, and queue chrome (Phase 6).
- SEA packaging (Phase 7).

## Delivery order

1. Document this cycle and keep Roadmap checkboxes for 4.x unchecked until DoD.
2. Contracts + CKAN parser extensions with unit tests.
3. Core install mapping, inventory merge, and hash helpers with unit tests.
4. Adapters, InstallService, routes, and API tests (fixture KSP + ZIP).
5. Frontend API client, UI slice, and component test updates.
6. Quality gates; mark Roadmap 4.1–4.4; update README.

## Acceptance criteria

- With setup + registry, installing a fixture mod writes files under `GameData`,
  lists them in inventory as `managed`, and uninstall removes them without
  orphans.
- Top-level `GameData` folders that match known identifiers appear as
  `detected` when not in the manifest.
- Download hashes are verified before extraction; mismatches fail the job.
- Archive entries with `..`, absolute paths, or destinations outside the KSP
  root are rejected.
- Download progress is observable over SSE.
- `pnpm lint`, `typecheck`, `test`, and `build` succeed.
