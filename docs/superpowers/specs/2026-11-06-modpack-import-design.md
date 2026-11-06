# Modpack Import

## Goal

Users can load a modpack file (a CKAN `.ckan` metapackage, as written by
CKAN's "Export modpack") and install it. Kraken keeps the imported metapackage
so it shows as installed, can be updated by importing a newer version, and can
be uninstalled with its dependencies offered as orphans, across restarts.

Out of scope: removing an imported modpack from the store, exporting a
modpack, and installing regular (non-metapackage) modules from a `.ckan` file
(their download URLs would come from outside the registry).

## Background

CKAN-meta and the repositories listed in CKAN's `repositories.json` contain no
metapackages today; metapackages reach users as files. Kraken 0.7.0 already
installs metapackages from the registry as file-less managed mods. This
feature adds a second source of metapackages: files the user imports.

## Part 1: Data and backend

### Store

- `apps/backend/src/adapters/imported-modpack-store.ts`, file
  `imported-modpacks.json` in the Kraken data directory:
  `{ schemaVersion: 1, modules: CkanModule[] }`.
- Atomic writes (temporary file + rename), as the config and manifest stores.
- Reads are validated with hand-written guards; a malformed file fails loudly
  and is never reset silently. A missing file means no imports.
- Every imported version is kept. Importing the same identifier and version
  replaces that entry; a different version is added next to it.

### Registry

- The registry index is the CKAN-meta modules plus the imported modules whose
  identifier does not exist in CKAN-meta. On a collision CKAN-meta wins: the
  imported module is left out of the index but stays in the store.
- Modules carry `source: "registry" | "imported"` in the contract
  (`ckanModuleSchema`), so the UI can mark them.

### Import endpoint

- `POST /api/v1/modpacks` with body `{ contents: string }`, with its own JSON
  body limit of 1 MB (the global limit stays 100 kB).
- Steps: `JSON.parse(contents)`, then `parseCkanDocument`. Required:
  `kind: "metapackage"` and an identifier not present in CKAN-meta.
- Failures answer 400 `INVALID_MODPACK` with the reason: invalid JSON, missing
  required fields, not a metapackage, identifier used by a CKAN-meta module.
  A body over 1 MB answers 413.
- Success answers `{ mod }` with the imported module (`source: "imported"`).
- An imported metapackage never downloads anything: as for registry
  metapackages, its dependencies are resolved only against the index, so any
  `download` in the file is ignored.

### Unchanged paths

Plan, install, update, uninstall and recovery use the 0.7.0 metapackage path,
because the imported module is in the index.

## Part 2: UI

- An `Import modpack` button (`.btn-secondary`, `download` icon) in the
  Installed view header, next to the filter.
- The button opens a hidden `<input type="file" accept=".ckan,application/json">`.
  The frontend reads the file with `file.text()`; a file over 1 MB is rejected
  before any request with `The modpack file is larger than 1 MB.`
- `POST /api/v1/modpacks`; a 400 shows the server's message in the error bar.
- After a successful import the existing metapackage install flow starts
  (`onInstall` → plan → dependency dialog). Cancelling leaves the modpack
  imported but not installed; it can be found in Browse and installed later.
- Modules with `source: "imported"` show an `Imported` badge next to
  `Metapackage` in Browse rows and in the details panel.
- Accessibility: the button has a text label; the hidden input is out of the
  Tab order; focus returns to the button after the picker closes; errors use
  the existing `role="alert"`.

## Error handling

- Invalid file content never reaches the store: it is parsed and checked
  before the write.
- A store read error makes the registry load fail loudly (the same path as an
  unreadable registry cache), so a damaged imports file is visible.

## Testing

- Store: write and read back; malformed file; replacing the same version;
  keeping two versions.
- API: a valid modpack is imported, then found by search, planned and
  installed; rejections (not a metapackage, collision with CKAN-meta, invalid
  JSON, over 1 MB); CKAN-meta wins on a collision after a registry refresh;
  an imported modpack survives a restart and its uninstall plan offers its
  dependencies as orphans.
- Frontend: the button opens the picker; an oversized file is rejected without
  a request; a valid file leads to import, plan and dialog; a 400 shows the
  message; the `Imported` badge.
- Browser check with mocked API responses (no installs on a real KSP
  installation).
