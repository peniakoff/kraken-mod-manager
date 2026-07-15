# Architecture decisions

## Local server boundary

Kraken runs an Express server bound to `127.0.0.1`. The frontend consumes a
versioned REST API (`/api/v1`); production builds are served by the same local
process. Domain code must not be coupled to Vue or Express.

## Packages

`@kraken/contracts` owns request and response schemas and their inferred
TypeScript types. `@kraken/core` will contain KSP detection, CKAN metadata,
dependency resolution, and installation policy. Platform file-system access,
networking, and HTTP are adapters around that core.

## Security baseline

The local API is intentionally loopback-only. Future state-changing endpoints
must validate their input, constrain file-system access to an explicitly
selected KSP installation, and protect against browser-origin requests. Archive
installation must validate hashes and reject path traversal (Zip Slip).

## Packaging direction

Node SEA is an eventual delivery target, not a runtime requirement of the
development skeleton. SEA currently embeds one CommonJS entry script, so the
backend must be bundled and frontend assets accessed through an asset-provider
abstraction. Native dependencies should be avoided until per-platform SEA
builds and signing are in place.

## Progress events

Download and extraction progress will use Server-Sent Events unless the
application later requires bidirectional realtime messages. SSE matches the
primarily server-to-client queue updates while reducing protocol complexity.
