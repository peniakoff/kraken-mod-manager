# Review Fixes for 0.6.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the findings of the `/code-review` of `v0.5.0..HEAD` that were accepted before tagging 0.6.0.

**Architecture:** Backend changes stay in the install journal adapter and
`InstallService` recovery; frontend changes stay in `App.vue` flow logic and
two components. No contract shape changes (only a docstring).

**Tech Stack:** TypeScript, Node 24, Express, Vue 3, Vitest 5, pnpm 11.

**Spec:** the accepted scope in the session (findings 1/10, 2, 4, 5, 6, 8, 9
of the review); findings 3 and 7 are out of scope by decision.

## Global Constraints

- Run commands with the committed pnpm (`pnpm`), Node 24.
- No new dependencies. No `any`, no `@ts-ignore`, no unjustified `!`; `as` only with a comment.
- TDD: each new test is run and seen failing before the code change.
- Code, comments, commits in English; Conventional Commits, no AI attribution.
- Do not change files outside each task's list.
- Finish each task with `pnpm lint && pnpm typecheck && pnpm test` green.

## Review Focus

- Two Kraken instances on one KSP: a header-only journal of a live, fresh process must not be deleted.
- A journal whose heartbeat stops (crash, reboot) must be recovered even if its PID now belongs to another live process.
- The heartbeat timer must never keep the process alive (`unref`) or keep running after `close()`/`remove()`.
- A config read error must never expose the installation picker, while a later registry error still keeps the light green (#63 behaviour).
- After optional mods are confirmed, nothing the user has not seen may be installed without a second confirmation.

---

### Task 1: Journal robustness (heartbeat, empty journals, commit without modules)

**Files:**
- Modify: `apps/backend/src/adapters/install-journal.ts`
- Modify: `apps/backend/src/install-service.ts` (`recoverJob`, `isProcessAlive` call site ~L829)
- Modify: `docs/ARCHITECTURE.md` ("Install backups and the job journal": header pid → pid plus heartbeat)
- Test: `apps/backend/test/install-api.test.ts` (describe "interrupted install recovery"), new `apps/backend/test/install-journal.test.ts`

**Interfaces:**
- Produces: `export const JOURNAL_HEARTBEAT_MS = 30_000`, `export const JOURNAL_STALE_MS = 120_000` in `install-journal.ts`.
- Produces: `new InstallJournal(path: string, heartbeatMs = JOURNAL_HEARTBEAT_MS)`; once the file is opened, an `unref`'d interval updates the file's atime/mtime every `heartbeatMs`; a failed update is reported with `console.warn` (not swallowed); the interval stops in `close()` (and so `remove()`).
- Produces: `commit()` resolves without writing when no module was begun (no file handle).
- Produces: `ParsedInstallJournal.pid` becomes `pid?: number`; `parseInstallJournal` returns `{ committed: false, modules: [] }` (no `pid`) for content with no complete line instead of throwing. A complete first line that is not a valid header still throws.
- Recovery rule in `recoverJob`: a journal is "owned by a running Kraken" only when `pid !== undefined && pid !== process.pid && isProcessAlive(pid) && Date.now() - mtimeMs < JOURNAL_STALE_MS` (mtime via `stat` of the journal file). Owned → reported in `failed` and left alone (as today). Not owned and `modules.length === 0` → delete the journal (`console.info` with its path), no report entry. Otherwise recover as today.

- [ ] **Step 1: Write failing tests**
  - `install-journal.test.ts`:
    - "commits without writing when no module was begun": `await new InstallJournal(path).commit()` resolves and `existsSync(path)` is false.
    - "refreshes the journal's mtime while it is open and stops after close": `heartbeatMs = 20`; after `beginModule`, set mtime 10 minutes back with `utimesSync`, wait 80 ms, `statSync(path).mtimeMs` is within 5 s of now; `await journal.close()`, set mtime back again, wait 80 ms, mtime unchanged.
    - "parses content without a complete line as an empty journal": `parseInstallJournal("", p)` and `parseInstallJournal('{"type":"jour', p)` both deep-equal `{ committed: false, modules: [] }`.
  - `install-api.test.ts` (use existing `writeJournal`, `JOURNAL_HEADER`):
    - "removes an empty journal left by a crash while it was created": write `job-<uuid>.jsonl` with content `""`; after `cleanupTemporaryFiles`, file gone, `.kraken-backup` gone, report `{ rolledBack: [], failed: [] }`.
    - "removes a header-only journal of a process that is gone": `[JOURNAL_HEADER]` only → removed, nothing reported.
    - "recovers a journal whose process id is reused by another live process": header with `pid: process.ppid`, a module + file line (as in the existing "still running" test), then `utimesSync(journal, tenMinutesAgo, tenMinutesAgo)`; after cleanup the file `GameData/Mod/file.cfg` is removed and `rolledBack` has one job.
    - The existing "leaves the journal of a Kraken process that is still running alone" must keep passing (fresh mtime).
- [ ] **Step 2: Run** `pnpm --filter @kraken/backend exec vitest run test/install-journal.test.ts test/install-api.test.ts` — Expected: the new tests FAIL.
- [ ] **Step 3: Implement** the interfaces above.
- [ ] **Step 4: Run** the same command — Expected: PASS; then `pnpm lint && pnpm typecheck && pnpm test`.
- [ ] **Step 5: Commit** `fix(backend): make install journal recovery robust to crashes and PID reuse`.

### Task 2: Honest wording for backups without a journal

**Files:**
- Modify: `apps/backend/src/install-service.ts` (the `console.warn` for untracked backups in `cleanupTemporaryFiles`)
- Modify: `packages/contracts/src/index.ts` (docstring of `untrackedBackups` only)
- Modify: `apps/frontend/src/components/RecoveryNotice.vue` (the untracked-backups block)
- Modify: `CHANGELOG.md` (`[0.6.0]` → Known limitations)
- Test: `apps/frontend/test/RecoveryNotice.test.ts`, `apps/backend/test/install-api.test.ts`

**Interfaces / exact copy:**
- Backend warn: ``Found ${n} backup folder(s) without an install journal in ${backupRoot}. Kraken cannot restore them automatically. They may hold the only copy of a previous mod version, so check them before deleting anything.``
- Contract docstring: `/** Backup folders with no usable journal (left by Kraken 0.5.0 or earlier, by a failed rollback, or by an unreadable journal). */`
- Notice title: `Backups Kraken cannot restore`; text: `Found {N backup folder(s)} that Kraken has no record of how to restore, for example from an interrupted install in Kraken 0.5.0 or earlier or from a rollback that failed. They may hold the only copy of a previous mod version, so check them before deleting anything:` followed by the existing `PathText`.
- CHANGELOG `[0.6.0]` Known limitations: replace the bullet starting "Backups left by an interrupted install in Kraken 0.5.0 or earlier" with `Backups without a usable journal (from Kraken 0.5.0 or earlier, or from a rollback that failed) are reported but not restored automatically.` and add `Interrupted installs are undone only for the installation that is active when Kraken starts.`

- [ ] **Step 1: Write failing tests**
  - `RecoveryNotice.test.ts` "points to backups left by an earlier version" → rename to "points to backups Kraken cannot restore"; assert text contains `Backups Kraken cannot restore`, `2 backup folders`, `check them before deleting anything`, and the directory; assert it does NOT contain `restore or delete them by hand`.
  - `install-api.test.ts` "removes leftover downloads at startup and keeps interrupted backups": the warn spy is called with `expect.stringContaining("without an install journal")`.
- [ ] **Step 2: Run** `pnpm --filter @kraken/frontend exec vitest run test/RecoveryNotice.test.ts` and the backend test file — Expected: FAIL.
- [ ] **Step 3: Implement** the copy above.
- [ ] **Step 4: Run** — Expected: PASS; full `pnpm lint && pnpm typecheck && pnpm test`.
- [ ] **Step 5: Commit** `fix: describe backups without a journal without suggesting deletion`.

### Task 3: A config read error blocks setup again

**Files:**
- Modify: `apps/frontend/src/App.vue` (`loadSetup`)
- Test: `apps/frontend/test/App.test.ts` (describe "App service status")

**Interfaces:** in `loadSetup`, `getConfig()` joins `getHealth()` in the first `try`: its failure sets `errorMessage` and `status = "unavailable"` and returns. Only failures after the config is known (recovery report, registry, installed mods, updates, installations list) go to the second `try` and keep `status = "ready"`.

- [ ] **Step 1: Write failing test** "does not offer the installation picker when the config cannot be read": health ok, `/api/v1/config` → 500 `{ code: "CONFIG_ERROR", message: "Config file is malformed." }`; after load, `[role="alert"]` contains `Config file is malformed.`, the text contains `Local service is unavailable.` and does NOT contain `Detected installations`. The existing "keeps the service light green when the registry cache cannot be read at startup" must keep passing.
- [ ] **Step 2: Run** `pnpm --filter @kraken/frontend exec vitest run test/App.test.ts` — Expected: the new test FAILS.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — Expected: PASS; full checks.
- [ ] **Step 5: Commit** `fix(frontend): keep the setup picker hidden when the config cannot be read`.

### Task 4: Confirm dependencies brought in by picked optional mods

**Files:**
- Modify: `apps/frontend/src/App.vue` (`OptionalState`, `applyPlan`, `confirmDependencyInstall`)
- Modify: `apps/frontend/src/components/DependencyPromptDialog.vue`
- Test: `apps/frontend/test/DependencyPromptDialog.test.ts`, `apps/frontend/test/App.test.ts` (describe "App optional mods at install")

**Interfaces:**
- Consumes: `DependencyPrompt` (`offered`, `selected`, `confirmed`) from the 0.6.0 code.
- Produces: `DependencyPrompt.seen?: string[]` — identifiers from `plan.toInstall` the user has already been shown. `OptionalState` picks it up too (`Pick<DependencyPrompt, "offered" | "selected" | "confirmed" | "seen">`).
- `applyPlan`: when the first (unconfirmed) dialog is shown, `seen = plan.toInstall` identifiers. When `confirmed` and the plan is `ok`, `extra = toInstall` identifiers not in `seen`, not in `selected`, not the target; if `extra` is non-empty, show the dialog with `confirmed: true` and `seen` = all current `toInstall` identifiers; otherwise install as today.
- Dialog, `confirmed === true` and no pending choices: no optional fieldsets; title `Install these mods too?`; text `{mod.name} and the mods you picked need:`; the existing list of `missingDependencies`; one primary button `Install` that emits `confirm` with `prompt.selected ?? []`; Cancel as today.
- `confirmDependencyInstall`: if `prompt.confirmed === true`, call `startInstallJob(prompt.mod, true, prompt.choices, prompt.selected ?? [])` directly (no re-plan).

- [ ] **Step 1: Write failing tests**
  - Dialog: "asks to confirm mods that picked optional mods bring in": prompt with `confirmed: true`, `selected: ["ModuleManager"]`, plan `toInstall` [MM Lib, MM, target]; no `input[type="checkbox"]`; `h2` text `Install these mods too?`; text contains `MM Lib`; clicking `Install` emits `confirm` with `[["ModuleManager"]]`.
  - App: "shows dependencies of picked optional mods before installing them": like the existing "offers recommendations…" test, but the second plan returns `toInstall` [`{identifier:"ModuleManagerLib",...}`, moduleManager, target]; after the first `Install`, the dialog shows `Install these mods too?` and `installBodies` is still empty; after clicking `Install` again, `installBodies[0]` equals `{ version: "20.4", installDependencies: true, optional: ["ModuleManager"] }` and exactly two plan requests were made.
  - The existing optional-mod App tests keep passing (no extra dialog when nothing new appears).
- [ ] **Step 2: Run** the two test files — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — Expected: PASS; full checks.
- [ ] **Step 5: Commit** `fix(frontend): confirm dependencies that picked optional mods bring in`.

### Final

- [ ] Whole-branch review (fresh reviewer), fixes for Critical/Important findings with RED→GREEN tests.
- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm build`; browser check of the recovery notice and the optional-mod flow (route mocks for API responses; no real installs on the user's KSP).
