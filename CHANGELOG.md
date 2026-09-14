# Changelog

All notable changes to Kraken Mod Manager will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
