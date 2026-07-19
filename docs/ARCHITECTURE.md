# Architecture decisions

## Local server boundary

Kraken runs an Express server bound to `127.0.0.1`. The frontend consumes a
versioned REST API (`/api/v1`); production builds are served by the same local
process. Domain code must not be coupled to Vue or Express.

## Packages

`@kraken/contracts` owns request and response schemas and their inferred
TypeScript types. `@kraken/core` contains KSP detection, CKAN metadata parsing
and indexing, dependency install planning, and installation policy. Platform
file-system access, networking, and HTTP are adapters around that core.

## TypeScript 7 compatibility

The project is pinned to TypeScript 7.0.2. Current `vue-tsc` depends on a
TypeScript compiler path that TypeScript 7 no longer exports, so the skeleton
uses `tsc` for TypeScript files and Vite plus component tests to compile Vue
single-file components. Restore full SFC type-checking when an upstream
`vue-tsc` release supports TypeScript 7.

## Security baseline

The local API is intentionally loopback-only. State-changing endpoints validate
their input, constrain file-system access to an explicitly selected KSP
installation, and protect against browser-origin requests. Archive installation
validates hashes when present and rejects path traversal (Zip Slip).

## Packaging direction

Node SEA is an eventual delivery target, not a runtime requirement of local
development. SEA currently embeds one CommonJS entry script, so the backend must
be bundled and frontend assets accessed through an asset-provider abstraction.
Native dependencies should be avoided until per-platform SEA builds and signing
are in place.

## Progress events

Download and extraction progress use Server-Sent Events on
`GET /api/v1/jobs/:jobId/events`. SSE matches the primarily server-to-client
queue updates while reducing protocol complexity; WebSockets remain an option
only if bidirectional realtime messaging becomes necessary.
