# One Job Queue for Installs and Uninstalls (0.8.0)

## Goal

1. Installs and uninstalls go into one queue and run one at a time, in the
   order they were added.
2. The queue survives a browser reload: the panel shows the same jobs, with
   the running job's progress.
3. A mod that already has a queued or running job cannot get another one; its
   action buttons are disabled.
4. Errors stay visible when the mod list is scrolled.

Out of scope: cancelling a running job, keeping the queue across a server
restart, and seeing jobs started in another browser tab live (they appear
after a reload).

## Background

Today every install starts at once and installs run in parallel; only
manifest writes are serialised. Uninstall is a synchronous request that is
refused with "Wait for running installs to finish before uninstalling." while
any install is active, and that message appears in the error bar at the top of
the page, out of view when the user is at the bottom of a long list. The job
list exists only in the browser, so a reload loses it.

## Part 1: Backend

### Queue

- A `JobQueue` runs jobs strictly one at a time, first in first out. A job
  waits with `status: "queued"` until every earlier job has finished.
- `jobResponseSchema.kind` becomes `z.enum(["install", "uninstall"])`.
  Uninstall jobs also carry `alsoRemove: string[]` and, once succeeded,
  `removed: string[]`.

### Install jobs

- When the job is added, the plan is resolved as today. A blocked plan
  (unmet dependency, conflict) is refused at once and never queued. The job
  stores the list of modules that was accepted.
- When the job starts, the plan is resolved again with the same choices and
  optional mods:
  - a module already installed by an earlier job is skipped;
  - if the new plan is blocked, or needs a module that is not in the accepted
    list, the job fails with
    `The install plan changed after it was queued: it now also needs {names}.`
    (or the resolver's blocking message). Nothing is installed.

### Uninstall jobs

- `POST /api/v1/mods/:identifier/uninstall` validates the selection against
  the current state (as today: `UNINSTALL_PLAN_MISMATCH` → 409) and answers
  `202 { job }`.
- When the job starts, the selection is validated again with
  `validateUninstallSelection`. A mismatch fails the job with its message;
  nothing is removed.
- The `INSTALL_IN_PROGRESS` guard is removed. It stopped a plan from being
  computed mid-install; the validation at start now covers that case.

### Duplicates

- A request for a mod that is the target of a queued or running job, or is in
  the `alsoRemove` list of a queued or running uninstall, is refused with
  `409 JOB_ALREADY_QUEUED` and the message
  `{name} already has a queued or running job.`
- For an uninstall request the check covers the target and every identifier
  in `alsoRemove`.

### Queue API

- `GET /api/v1/jobs` → `{ jobs: JobResponse[] }` in queue order: every job not
  hidden by the user.
- `DELETE /api/v1/jobs/:jobId`:
  - a queued job is removed from the queue (cancelled);
  - a finished job is hidden;
  - a running job → `409 JOB_RUNNING`;
  - an unknown job → `404 JOB_NOT_FOUND`;
  - success → `204`.
- `POST /api/v1/jobs/clear-finished` hides every finished job → `204`.
- Hidden jobs still count towards the existing cap of 50 finished jobs kept in
  memory.

### Server restart

The queue lives in memory. After a restart the journal recovery undoes the job
that was running, as today; queued jobs are gone. This is documented in
`docs/ARCHITECTURE.md`.

## Part 2: Frontend

### Queue state

- `useInstallQueue` becomes `useJobQueue`. At start-up it loads
  `GET /api/v1/jobs` and subscribes to progress events for queued and running
  jobs.
- Dismiss, Clear finished and Remove call the API. The panel reflects the
  server, so it looks the same after a reload.
- A failed `GET /api/v1/jobs` at start-up is reported in the error bar; the
  rest of the app still loads.

### Panel

- The title becomes `Queue`. The panel is shown whenever it has jobs.
- Each entry names its kind: `Install {name} {version}` or
  `Uninstall {name}`, with ` (+{n} more)` when `alsoRemove` is not empty.
- Queued entries show `Queued` and a `Remove` button. Running entries have no
  button. Failed entries show the error, as today.

### Uninstall

- The uninstall dialog plans and offers dependencies as today. Its confirm
  button adds the job and closes the dialog.
- A refusal when adding (409 plan mismatch or duplicate) stays in the dialog.
- When an uninstall job succeeds, the installed list and updates reload.

### Blocked actions

- A mod with a queued or running job (as target or in `alsoRemove`) has
  Install, Update and Uninstall disabled in list rows and in the details
  panel. The disabled button reads `Queued`, `Installing…` or
  `Uninstalling…`.
- `Update all` skips mods that already have a job.

### Error bar

- The error bar sticks to the top of the viewport (`sticky top-0`, opaque
  background) and gets a `Dismiss` button. It keeps `role="alert"`.

## Error handling

- A job that fails at start never changes files or the manifest.
- A cancelled job never starts.
- A broken event stream for a job does not drop the job: the panel reloads the
  job list.

## Testing

- Backend:
  - jobs run in order, one at a time;
  - an install whose plan changed before it started fails and installs
    nothing;
  - an uninstall whose selection no longer matches fails and removes nothing;
  - uninstall can be queued while an install runs;
  - duplicates are refused (target and `alsoRemove`);
  - cancel a queued job; 409 for a running job; hide finished jobs;
    clear-finished;
  - `GET /api/v1/jobs` lists jobs in order.
- Frontend:
  - the queue is restored from `GET /api/v1/jobs`;
  - action buttons are disabled for mods with a job;
  - Remove on a queued job;
  - the uninstall dialog closes after queueing and keeps a refusal;
  - the error bar's Dismiss.
- Browser check with mocked API responses (no installs on a real KSP
  installation): reload during an install, queued uninstall, blocked buttons,
  sticky error bar.
