# Changelog

All notable changes to Kraken Mod Manager will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Mod updates:** an Update button per mod and an Update all button on the dashboard, and an Update button in the mod details panel. Update all queues every update that can run unattended and lists the ones that need a provider choice or are blocked.

### Fixed
- Updates are offered only for versions compatible with the installed KSP.
- A plan that changes an installed mod's version is blocked when an installed mod needs the old version.
- A two-part `ksp_version_max` such as `1.12` now covers every `1.12.x`, so such mods are no longer hidden by the compatible-only filter.
- Large mods such as Parallax-StockTextures and ParallaxContinued install. Archives are downloaded to disk and extracted with streaming (yauzl), so memory use no longer grows with the archive or with any single file in it. The per-file limit is gone and the uncompressed archive limit rises from 2 GiB to 8 GiB.
- Reinstalling or updating a large mod no longer reads the previous version into memory. Its files move to a backup folder (`.kraken-backup` in the KSP folder) and come back if the install fails.
- Downloaded archives are deleted as soon as their mod is installed or has failed, and leftover downloads from earlier runs are removed at startup. Backups from an interrupted install are kept and reported in the log, since they can hold the only copy of the previous version.
- The service keeps at most 50 finished install jobs in memory.

## [0.3.0] - 2026-11-01

### Added
- **Virtual packages and `any_of` dependencies:** the resolver satisfies dependencies through CKAN `provides` and `any_of` groups. A sole candidate is picked automatically; when several mods qualify, the install dialog asks which one to use.
- **Dependency-aware uninstall:** every uninstall is previewed first. Managed mods that depend on the target are removed with it, automatically installed dependencies that nothing needs any more are offered for removal, and manually installed mods that would break are listed as a warning.
- **Standalone executables:** `pnpm package:sea` builds a Node 24 SEA binary, and CI builds and smoke-tests Windows x64, Linux x64, and macOS arm64/x64 binaries. The Linux binary is also checked in a container without Node.js.
- **Release workflow:** pushing a `vX.Y.Z` tag builds all binaries and creates a draft GitHub Release with `SHA256SUMS` and notes from this changelog.
- Issue forms for bug reports and feature requests, and a pull request template.

### Changed
- `DELETE /api/v1/mods/:identifier` is replaced by `POST /api/v1/mods/:identifier/uninstall-plan` and `POST /api/v1/mods/:identifier/uninstall`. A selection that no longer matches the server's plan returns `409 UNINSTALL_PLAN_MISMATCH`, and uninstalls are refused with `409 INSTALL_IN_PROGRESS` while an install runs.
- The install manifest moves to schema v2 and records whether each mod was installed as a dependency. v1 manifests are migrated without losing records.
- The registry cache moves to schema v2; an older cache is rebuilt on the next refresh.

### Fixed
- A mod that conflicts with a virtual package it provides itself (for example Scatterer) no longer blocks its own install.
- Conflicts with dependencies planned later in the same install are detected.
- The resolver no longer swaps an already planned or target version for another one to satisfy a dependency.

### Known limitations
- Binaries are not code-signed. macOS builds carry an ad-hoc signature only, so Gatekeeper and Windows SmartScreen may warn on first launch.

## [0.2.0] - 2026-09-14

### Added
- **Mod Details Panel (ROADMAP 6.3):**
  - Dedicated side drawer panel showing full metadata for any selected mod.
  - Detailed description and license badges parsed from CKAN metadata.
  - Verified project links (homepage, repository, bugtracker, SpaceDock, CurseForge, manual) with safe URL filtering (`https`/`http` only, `rel="noopener noreferrer"`).
  - Version history dropdown allowing inspection and installation of historical versions.
  - Comprehensive dependency and relationship visualization (`depends`, `conflicts`, `recommends`, `suggests`) with version constraints.
  - Direct Install, Reinstall, and Uninstall actions within the details panel.
  - Keyboard accessibility (close on Escape) and click-outside dismissal.
- **Backend API:**
  - `GET /api/v1/mods/:identifier`: Fetches latest details for a specific mod by identifier (case-insensitive).
  - `GET /api/v1/mods/:identifier/versions`: Returns all available versions sorted in descending order by CKAN version comparison logic.
- **Core Domain & Parser:**
  - Extended `.ckan` parser to extract `description`, `license`, and `resources` fields with defensive validation.
  - Enhanced `CkanIndex` with `listVersions()` and `getLatest()` methods.
  - Improved mod search to match queries within `description`.
- **Contracts:**
  - Added `ckanResourcesSchema`, `modDetailsResponseSchema`, and `modVersionsResponseSchema`.

## [0.1.0] - 2026-07-17

### Added
- Project monorepo initialization using pnpm workspaces.
- Node.js v24 Express loopback server with TypeScript 7.
- Vue.js 3 frontend with Vite and Tailwind CSS.
- KSP auto-discovery module and web-based fallback directory browser.
- Configuration persistence in OS-specific app data paths.
- CKAN-meta archive fetching, parsing, and in-memory indexing.
- Mod inventory scanner, ZIP downloader with SSE progress tracking, unzipper, and uninstaller.
- SAT-like dependency and conflict resolution engine.
- Dashboard view displaying active KSP installation details and update notifications.
- Mod browser with search, tag filters, compatibility flags, and pagination.
