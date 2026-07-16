# Next delivery cycle: KSP installation setup

## Outcome

Deliver the first complete user-facing workflow after the application skeleton:
Kraken discovers Kerbal Space Program installations, lets the user safely choose
one manually when discovery fails, persists the selection, and restores it after
a restart.

This cycle implements Roadmap items 2.1–2.3. It also fixes production static
asset resolution before feature work because the current `pnpm start` working
directory makes the backend look for the frontend under
`apps/backend/apps/frontend/dist`.

## Current baseline

- Phase 1 provides the pnpm monorepo, loopback-only Express API, Vue shell,
  shared Zod contracts, and CI quality gates.
- `GET /api/v1/health` is the only application endpoint.
- `@kraken/core` is a placeholder and the backend does not use it yet.
- There are no KSP discovery, configuration, or file-system browsing features.
- `pnpm build` succeeds, but the default frontend path used by `pnpm start` does
  not point to the built Vue application.

## Scope

### 0. Restore the production-shaped application path

- Resolve frontend assets independently of the process working directory, or
  copy them to a deterministic backend asset directory during the build.
- Preserve `KMM_FRONTEND_DIR` as an explicit override.
- Add a production smoke test proving that the built service returns the SPA
  for `/` and still returns the health response under `/api/v1/health`.

### 1. Define the domain model and file-system ports

Implement framework-independent KSP setup logic in `@kraken/core`:

- `KspInstallation`: canonical path, detected game version, operating system,
  and source (`steam`, `gog`, `epic`, or `manual`).
- Candidate validation based on the expected executable (`KSP.exe` or
  `KSP.x86_64`) and version metadata from `readme.txt` or `buildID64.txt`.
- Discovery strategies for standard Steam, GOG, and Epic locations on Windows,
  Linux, and macOS.
- Injected file-system and platform ports so core has no Express, Vue, or direct
  Node file-system dependency.
- Stable deduplication and ordering when multiple strategies find the same
  installation.

The Node implementations of these ports belong in `apps/backend`.

### 2. Add shared API contracts

Define all request, response, and error schemas in `@kraken/contracts` before
adding routes:

| Method and route | Purpose |
| --- | --- |
| `GET /api/v1/ksp/installations` | Discover and return valid KSP installations. |
| `GET /api/v1/config` | Return the active installation and preferences. |
| `PUT /api/v1/config` | Validate and persist a selected installation. |
| `GET /api/v1/fs/directories?path=...` | List directories for the manual-selection fallback. |

Use one structured API error contract with a stable machine-readable code and a
human-readable message. Invalid request data is a `400`, paths outside the
allowed browsing roots are a `403`, and a selected path that is not a KSP
installation is a `422`.

### 3. Implement discovery and configuration adapters

In the backend:

- Implement platform-aware discovery using the core ports and strategies.
- Canonicalize paths before validation, comparison, storage, and API responses.
- Store configuration atomically as JSON in the platform's standard
  per-user configuration directory:
  - Windows: `%APPDATA%/Kraken Mod Manager`
  - Linux: `$XDG_CONFIG_HOME/kraken-mod-manager`, falling back to
    `~/.config/kraken-mod-manager`
  - macOS: `~/Library/Application Support/Kraken Mod Manager`
- Tolerate a missing configuration file as an unconfigured state.
- Report malformed or unreadable configuration explicitly instead of silently
  overwriting it.
- Revalidate a selected installation before every write.
- Inject discovery and storage dependencies into route construction so API
  tests do not touch the developer machine.

The configuration format starts with a schema version to support future
migrations:

```json
{
  "schemaVersion": 1,
  "activeInstallationPath": "/path/to/KSP",
  "preferences": {}
}
```

### 4. Provide a constrained manual directory browser

The browser is directory-only and does not expose file contents. It must:

- start from explicit platform roots returned by the backend;
- normalize and canonicalize every requested path;
- reject traversal outside those roots, including escape through symbolic
  links;
- avoid returning hidden/system entries that cannot be traversed;
- return only the current path, optional parent path, and child directory names;
- apply a bounded result count and deterministic sorting.

The browsing roots allow discovery of an installation. After selection, future
file-system operations remain constrained to the validated KSP installation as
required by the architecture security baseline.

### 5. Build the setup experience

Replace the health-only screen with a minimal state-driven setup flow:

1. Check backend health and load saved configuration.
2. If configured, show the active installation path and detected game version.
3. If unconfigured, run discovery and show valid candidates.
4. Let the user select and save a candidate.
5. If no candidate is suitable, open the directory-only browser and validate
   the selected directory through the configuration endpoint.
6. Show actionable loading, empty, validation-error, persistence-error, and
   backend-unavailable states.

Keep the UI within the existing Vue application; routing and a full dashboard
are not required in this cycle.

### 6. Align documentation

After implementation:

- mark Roadmap items 2.1–2.3 complete only when their acceptance criteria pass;
- document the configuration location and supported discovery sources;
- document manual-browser roots and path-containment guarantees;
- replace the stale Roadmap reference to WebSockets with SSE;
- replace the stale ESLint reference with oxlint;
- clarify that the existing workflow provides CI while tagged binary delivery
  remains future CD work.

## Delivery order

Each step leaves the repository buildable and has focused tests.

1. Fix production frontend asset resolution and add its smoke test.
2. Add domain types, ports, validation, and discovery strategies to core.
3. Add contracts and contract parsing tests.
4. Add Node file-system, platform, and atomic configuration adapters.
5. Add discovery and configuration routes with API tests.
6. Add the constrained directory-listing route and security tests.
7. Add API client methods and the Vue setup flow with component tests.
8. Run the full quality gates and perform a production-shaped workflow check.
9. Update Roadmap and operational documentation.

## Acceptance criteria

### Discovery and validation

- A valid fixture containing a supported KSP executable is discovered and
  includes source, platform, canonical path, and version when version metadata
  is available.
- Invalid directories are excluded without aborting discovery of other
  candidates.
- Duplicate paths from multiple stores are returned once.
- Windows, Linux, and macOS path strategies have deterministic fixture-based
  tests; platform-specific behavior is not inferred from the CI host.

### Configuration

- A valid manual or discovered installation can be saved and read through the
  API.
- A new backend/configuration-store instance reads the same selection, proving
  persistence across restart.
- Missing configuration returns an explicit unconfigured state.
- Invalid installation paths and malformed configuration files return the
  documented error shape.
- Writes are atomic and do not leave a partial target file after a simulated
  failure.

### Manual selection security

- The API exposes directories only.
- Absolute paths outside an allowed root, `..` traversal, and symlink escapes
  are rejected.
- Results are bounded, sorted, and schema-validated.
- The frontend can navigate to a valid KSP directory and save it without the
  browser receiving arbitrary file contents.

### User workflow

- With no configuration, the user can select a discovered installation or use
  manual browsing.
- After saving and refreshing, the selected installation and game version are
  still visible.
- Backend, validation, discovery-empty, and persistence failures have distinct
  actionable UI states.
- The existing health behavior remains available.

### Quality and architecture

- Domain logic in `@kraken/core` has no Vue, Express, or `node:fs` imports.
- API payloads are defined once in `@kraken/contracts` and parsed at runtime.
- `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` pass.
- After `pnpm build && KMM_OPEN_BROWSER=false pnpm start`, both the SPA and API
  are reachable on loopback.

## Test plan

| Layer | Required coverage |
| --- | --- |
| Core unit tests | Candidate validation, version parsing, discovery paths, deduplication, and partial discovery failures. |
| Contract tests | Valid payloads and rejection of malformed requests, responses, and errors. |
| Backend adapter tests | Config directory selection, atomic persistence, canonicalization, and malformed files. |
| Backend API tests | Discovery, config read/write, status codes, path traversal, and symlink escape. |
| Frontend component tests | Saved setup, discovered selection, manual selection, empty results, and API failures. |
| Production smoke test | Built SPA fallback and health endpoint from the actual start working directory. |

CI remains host-independent through temporary directories, fixture trees, and
injected platform values. A short manual validation matrix on Windows, Linux,
and macOS confirms real store locations before the cycle is marked complete.

## Risks and controls

| Risk | Control |
| --- | --- |
| Store locations vary by installation and launcher version. | Keep discovery strategies data-driven, isolate failures, support manual selection, and document tested locations. |
| A local file browser broadens access beyond the selected game directory. | Expose directories only, use explicit roots, canonical containment checks, symlink-escape tests, and loopback/origin protections. |
| Version files differ across KSP releases. | Treat version as optional, keep executable validation authoritative, and test known formats. |
| Configuration corruption blocks startup. | Separate config errors from server startup, report recovery guidance, and never overwrite malformed data automatically. |
| Platform behavior is hidden by Linux-only CI. | Inject platform/path behavior for unit tests and complete the manual cross-platform matrix. |
| Scope expands into general settings or mod management. | Keep preferences empty/reserved and defer CKAN, inventory, and mod operations. |

## Explicitly out of scope

- CKAN metadata download, parsing, indexing, and search.
- `GameData` inventory and mod installation or removal.
- Dependency resolution.
- Download queues, progress reporting, and SSE.
- A full dashboard, mod browser, or client-side router.
- Node SEA binaries, signing, and release automation.
- Arbitrary file reading or writing through the browsing API.

## Definition of done

The cycle is complete when a new user can build and start Kraken, discover or
manually select a valid KSP installation, restart the application, and see the
same validated installation in the UI. The workflow must pass all automated
quality gates and the cross-platform manual matrix, with the security and
operational documentation updated to match the delivered behavior.
