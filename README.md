# Kraken Mod Manager (KMM)

Kraken Mod Manager (KMM) is a modern, lightweight, cross-platform mod manager
for Kerbal Space Program (KSP). It takes architectural inspiration from CKAN,
but is built with TypeScript, Node.js, and Vue.

## Prerequisites

- Node.js 24.18.0 or newer (`.nvmrc` pins the development version)
- Corepack-enabled pnpm 11.13.0 or newer

## Development

```sh
corepack enable
pnpm install
pnpm dev
```

The local UI is served at `http://127.0.0.1:5173` by Vite. API requests are
proxied to the Express service at `http://127.0.0.1:31415`. To run the
production-shaped service after a build:

```sh
pnpm build
pnpm start
```

The backend binds only to loopback. Set `KMM_PORT` to choose another local
port, and `KMM_OPEN_BROWSER=false` to suppress opening the default browser.

## Architecture

- `apps/frontend` — Vue 3, Vite, and Tailwind user interface.
- `apps/backend` — local Express API and production static-file server.
- `packages/contracts` — validated API contracts shared between client and
  server.
- `packages/core` — framework-independent KSP detection, CKAN metadata parsing,
  registry indexing, and install/uninstall policy.

## KSP setup

On first launch, Kraken searches standard Steam, GOG, and Epic locations for a
valid KSP executable. If it cannot find the game, select the installation from
the directory-only browser. The browser exposes directory names only, follows
neither path traversal nor symbolic links outside its explicit roots, and
validates the selected folder before it is saved. On Linux and macOS its roots
are the user's home directory and filesystem root; on Windows it exposes every
available drive root.

The active installation is stored atomically in `config.json`:

- Windows: `%APPDATA%/Kraken Mod Manager`
- Linux: `$XDG_CONFIG_HOME/kraken-mod-manager` (or `~/.config/kraken-mod-manager`)
- macOS: `~/Library/Application Support/Kraken Mod Manager`

## CKAN registry

After an installation is configured, refresh the official CKAN-meta archive to
build a local searchable index. The cache is stored separately from config:

- Windows: `%LOCALAPPDATA%/Kraken Mod Manager/Cache`
- Linux: `$XDG_CACHE_HOME/kraken-mod-manager` (or `~/.cache/kraken-mod-manager`)
- macOS: `~/Library/Caches/Kraken Mod Manager`

## Mod install and uninstall

Kraken downloads mod ZIPs, verifies `download_hash` when present, extracts with
Zip Slip rejection, and installs according to `.ckan` `install` stanzas (or
CKAN defaults). Managed installs are tracked in `install-manifest.json`;
uninstall removes only those tracked files. Inventory also detects top-level
`GameData` folders that match known registry identifiers.

Install progress is streamed with Server-Sent Events on
`GET /api/v1/jobs/:jobId/events`.

The local API includes `GET /api/v1/health`, `GET /api/v1/ksp/installations`,
`GET`/`PUT /api/v1/config`, `GET /api/v1/fs/directories`, `GET /api/v1/registry`,
`POST /api/v1/registry/refresh`, `GET /api/v1/mods`, `GET /api/v1/installed-mods`,
`POST /api/v1/mods/:identifier/install`, `DELETE /api/v1/mods/:identifier`,
`GET /api/v1/jobs/:jobId`, and `GET /api/v1/jobs/:jobId/events`.

## Verification

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Dependency updates are managed by Dependabot
(`.github/dependabot.yml`). See [the roadmap](docs/ROADMAP.md) and
[architecture decisions](docs/ARCHITECTURE.md) for the planned work.
