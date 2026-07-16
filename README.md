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
- `packages/core` — future framework-independent domain logic.

The current integration endpoint is `GET /api/v1/health`.

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
