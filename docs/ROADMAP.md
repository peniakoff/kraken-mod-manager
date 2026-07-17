# Kraken Mod Manager – Implementation Roadmap

## 🛠️ Tech Stack (Local Web Server Architecture)
*   **Backend (Core Logic & File System):** Node.js v24 + TypeScript v7 (Express.js as a lightweight local server).
*   **Frontend (User Interface):** Vue.js 3 (Composition API) + Vite + Tailwind CSS.
*   **Package Manager:** `pnpm` (using pnpm workspaces for monorepo management).
*   **Communication:** REST API / Server-Sent Events (for download progress tracking).
*   **Build & Packaging:** Node.js v24 SEA (Single Executable Applications) API – zero external dependencies required for the end-user.

## Phase 1: Project Initialization & Skeleton (Monorepo)
*Goal: Set up the development environment and connect the frontend with the backend using pnpm workspaces.*

- [x] **1.1. Repository setup & folder structure:**
    ```text
    kraken-mod-manager/
    ├── apps/backend/         # Node.js Server (TS v7)
    ├── apps/frontend/        # Vue.js App (Vite)
    ├── packages/contracts/   # Shared API types and schemas
    ├── packages/core/        # Framework-independent domain logic
    ├── docs/                 # Roadmap and architecture decisions
    ├── package.json          # Root package.json (scripts)
    └── pnpm-workspace.yaml   # pnpm workspaces configuration
    ```
- [x] **1.2. Backend Configuration (Express + TS v7):**
    *   Local-only Express server defaults to `127.0.0.1:31415`; `KMM_PORT` permits an explicit port.
    *   Serve the production Vue build and SPA fallback when the frontend has been built.
    *   Provide a validated `GET /api/v1/health` contract.
- [x] **1.3. Frontend Configuration (Vue 3 + Vite + Tailwind):**
    *   Vue view verifies communication through `GET /api/v1/health`.
    *   Vite proxies `/api` to the local backend during development.
- [x] **1.4. Auto-launching the Browser:**
    *   Open the default browser after the local server is listening; opt out with `KMM_OPEN_BROWSER=false`.
- [x] **1.5. Development quality gates:**
    *   Add strict TypeScript, oxlint, unit/API tests, root workspace scripts, and GitHub Actions CI.

## Phase 2: Game Detection & Path Handling (KSP Auto-Discovery)
*Goal: Automatically locate the game installation or provide a seamless manual selection process.*

- [x] **2.1. Drive Scanning Module:**
    *   Create a Node.js module to scan standard Steam, GOG, and Epic Games paths across Windows, Linux, and macOS.
    *   Verify valid KSP instances by checking for `KSP.exe` / `KSP.x86_64` and reading the `readme.txt` / `buildID64.txt` for the game version.
- [x] **2.2. Web-based File Explorer (Fallback):**
    *   Create a backend endpoint (`GET /api/v1/fs/directories?path=...`) to return local directory structures.
    *   Build a Vue.js component that allows users to manually browse their local drives to select the KSP directory if auto-discovery fails.
- [x] **2.3. Configuration Persistence:**
    *   Save the selected game path and preferences to a local configuration file (e.g., `config.json` in the user's OS AppData/Config folder).

## Phase 3: Metadata & Mod Repository (CKAN Registry Integration)
*Goal: Fetch and process available mods and their versions from public CKAN repositories.*

- [x] **3.1. Fetching Metadata:**
    *   Implement a service to download and update the official `.tar.gz` or `.zip` from the CKAN-meta repository.
- [x] **3.2. Metadata Parser (.ckan):**
    *   Write a TS v7 parser for `.ckan` files utilizing modern language features (strict typing, pattern matching if applicable) for the JSON payload.
- [x] **3.3. Indexing & Searching:**
    *   Create a fast local index (in-memory, lightweight SQLite, or JSON cache) to allow instant filtering and searching by name, category, or author.

## Phase 4: Mod Management Engine (Core Logic)
*Goal: Download, extract, and manage files inside the KSP `GameData` directory.*

- [x] **4.1. Game State Analysis (Inventory):**
    *   Scan the `GameData` folder to detect currently installed mods and map them to metadata.
- [x] **4.2. Downloader Service:**
    *   Build a robust downloader for ZIP files utilizing native Node.js v24 `fetch` and web streams for chunk streaming and progress reporting.
- [x] **4.3. Extractor & Installer (Unzipper):**
    *   Use lightweight libraries to extract downloaded archives.
    *   Correctly map and copy files to the `GameData` folder according to the specific `.ckan` installation instructions (handling `install` stanzas).
- [x] **4.4. Uninstaller:**
    *   Track installed files and ensure clean removal from `GameData` without leaving orphaned files.

## Phase 5: Dependency Resolver (The Brain)
*Goal: Handle complex mod relationships, dependencies, and conflicts.*

- [ ] **5.1. Relationship Parsing:**
    *   Analyze `depends`, `conflicts`, `recommends`, and `suggests` fields from `.ckan` files.
- [ ] **5.2. Auto-Resolution Algorithm (SAT-like Solver):**
    *   Write logic that checks if a requested mod requires other libraries (e.g., *ModuleManager*).
    *   Present a unified Vue modal: *"This mod requires Mod X and Mod Y. Install automatically?"* and add them to the installation queue.

## Phase 6: User Interface (Vue.js Frontend)
*Goal: Deliver a clean, responsive, and modern UI without the overhead of Electron.*

- [ ] **6.1. Dashboard View:**
    *   Display active KSP installation details, total installed mods, and available updates.
- [ ] **6.2. Mod Browser View:**
    *   Data table / grid displaying mods with search bars, category filters (Gameplay, Parts, Graphics), and game version compatibility flags.
- [ ] **6.3. Mod Details Panel:**
    *   Show detailed descriptions, author info, project links, version history, and dependencies.
- [ ] **6.4. Queue & Progress Manager:**
*   A persistent bottom bar or sidebar showing real-time download and extraction progress (via SSE; WebSockets only if bidirectional communication becomes necessary).

## Phase 7: Build & Packaging (Distribution)
*Goal: Compile the entire stack into a single, user-friendly executable file using modern Node.js features.*

- [ ] **7.1. Build Pipeline Setup:**
    *   Automate the build process via `pnpm` scripts: Compile Vue.js frontend -> move to backend static folder -> compile TypeScript backend.
- [ ] **7.2. Standalone Executable Generation (Node 24 SEA):**
    *   Utilize Node.js v24 native SEA (Single Executable Application) capabilities to output native binaries:
        *   Windows (`kraken-mod-manager-win-x64.exe`)
        *   Linux (`kraken-mod-manager-linux-x64`)
        *   macOS (`kraken-mod-manager-macos-x64 / arm64`)
- [ ] **7.3. Cross-Platform Testing:**
    *   Verify the executables run correctly on fresh VMs without Node.js installed.

## Phase 8: Release & Maintenance (v1.0.0)
- [x] **Dependabot:** Weekly npm and GitHub Actions updates via `.github/dependabot.yml`.
- [ ] Set up binary-delivery CD (automated builds on new tags using `pnpm`); the existing workflow provides CI only.
- [ ] Create Issue / Pull Request templates for the community.
- [ ] Publish the first official Release (v1.0.0) on GitHub.
