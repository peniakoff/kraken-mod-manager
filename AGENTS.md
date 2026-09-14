# Kraken Mod Manager

Kraken Mod Manager is a pnpm monorepo for a local-first KSP mod manager. It
uses TypeScript, Node.js, Vue, Vite, Express, and shared Zod contracts.

## Repository structure

- `apps/frontend`: Vue 3 user interface served by Vite in development.
- `apps/backend`: loopback-only Express API and production static-file host.
- `packages/contracts`: shared request and response schemas and inferred types.
- `packages/core`: framework-independent KSP and CKAN domain logic.
- `docs/ARCHITECTURE.md`: architectural and security decisions; read it when a
  task changes boundaries, contracts, persistence, packaging, or networking.
- `docs/ROADMAP.md`: product direction; consult it only when scope or intended
  behavior is unclear.

## Commands

Use the committed pnpm version through Corepack and existing scripts:

- `pnpm dev`: build shared packages and start frontend and backend watchers.
- `pnpm lint`: lint all workspaces.
- `pnpm typecheck`: build shared packages and type-check all workspaces.
- `pnpm test`: build shared packages and run all tests.
- `pnpm build`: create the production-shaped frontend and backend build.

Run focused workspace tests before broader checks when possible. Do not replace
the package manager, update dependencies, or regenerate lockfiles unless the
task requires it.

## Engineering rules

- Keep domain logic independent of Vue and Express.
- Define API changes in `@kraken/contracts` and validate data at boundaries.
- Preserve the loopback-only server boundary and explicit filesystem roots.
- Treat archive extraction, downloads, hashes, paths, install manifests, and
  configuration writes as security-sensitive operations.
- Preserve unrelated working-tree changes. Do not commit, push, publish,
  deploy, or perform destructive Git operations unless explicitly requested.
- Prefer the smallest coherent change and add focused regression coverage for
  changed behavior.

The development UI is normally available at `http://127.0.0.1:5173` and proxies
API calls to `http://127.0.0.1:31415`.
