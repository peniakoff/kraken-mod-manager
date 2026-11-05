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

The local API is intentionally loopback-only, which keeps the service off the
LAN and public internet. State-changing endpoints validate their input and
constrain file-system access to an explicitly selected KSP installation.
Archive installation validates hashes when present and rejects path traversal
(Zip Slip). Explicit browser-origin / CSRF checks are not implemented yet;
loopback binding is the primary remote-access control today.

## Install backups and the job journal

An install moves the previous version of each mod into
`<KSP>/.kraken-backup/<backup id>/` (a rename on the same file system) and
moves it back if the job fails. Every job also writes an append-only journal,
`<KSP>/.kraken-backup/job-<job id>.jsonl`: a header with the process id, a
`module` line (identifier, backup id, previous manifest record) that is synced
before that module's files move, a `file` line before each destination is
written, and `committed` once every module is in place.

At startup, before the server accepts requests, an uncommitted journal is
undone newest module first: recorded files are deleted, the backup folder is
moved back and the manifest record is restored. A committed journal only has
its backups deleted. Because file lines precede the writes, recovery never
deletes a file the job did not create; the cost is that a file being written
when the process died is deleted rather than kept. Journal contents are
untrusted input: backup ids must be UUIDs and every path goes through the same
allowed-root checks as an install, all before the first file is touched. A
journal that fails these checks, or whose process is still running, is left in
place with its backups and reported through `GET /api/v1/install-recovery`.
A running job touches its journal every 30 seconds, and a journal counts as
owned by a live process only if its pid is alive and the file was touched in
the last two minutes, so a reused pid cannot protect a dead job's journal. When the pid is alive
but the file looks stale, recovery waits 35 seconds and looks again, because
a suspended machine can delay the heartbeat; only an unchanged mtime counts
as dead. A
journal with no module (an empty file or just a header) has nothing to undo
and is deleted.

A job that ends in a running process, successfully or not, deletes its
journal, so a pending journal always means the process died. Keeping one for a
failed rollback would let the next start undo a later install of the same mod.
Durability covers a crashed or killed process; after a power loss the last
unsynced `file` lines can be missing, which leaves stray files but loses none.

## Packaging direction

Node SEA is an eventual delivery target, not a runtime requirement of local
development. SEA currently embeds one CommonJS entry script, so the backend must
be bundled and frontend assets accessed through an asset-provider abstraction.
Native dependencies should be avoided until per-platform SEA builds and signing
are in place.

The packaging pipeline bundles the backend as CommonJS, embeds the Vue build as
SEA assets, and injects the preparation blob into the current Node executable.
At runtime, the server selects the embedded asset provider only when `node:sea`
reports SEA execution; development and ordinary production builds continue to
serve the copied frontend directory. An explicit `KMM_FRONTEND_DIR` also takes
precedence for diagnostics. The application version is baked into the backend
bundle as a fallback so the standalone health endpoint does not depend on
package manager environment variables, while `KMM_VERSION` remains an explicit
runtime override.

## Progress events

Download and extraction progress use Server-Sent Events on
`GET /api/v1/jobs/:jobId/events`. SSE matches the primarily server-to-client
queue updates while reducing protocol complexity; WebSockets remain an option
only if bidirectional realtime messaging becomes necessary.
