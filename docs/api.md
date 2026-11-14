# API contract (server <-> web)

All JSON. Writes are same-origin POSTs. Errors are `{ "error": "<code>", "message": "<text>" }` with the HTTP status noted below. The server never returns a secret.

## Unchanged from the family

| Route | Notes |
|---|---|
| `GET /api/health` | `demo-health/1` |
| `POST /api/mode` | body exactly `{ "source": "mock" \| "real" }` (any other field is a 400); 409 `real_not_available` when Real is not available, 409 `job_running` while a job runs. Switching mode retires the current plan for good: flipping back does not revive it |
| `POST /api/reset` | first aborts a running job and waits for its calls in flight to finish (a Reset-away job leaves no audit entry), then clears the job and its plan, the audit history, the writes switch and the Mock world (the next Mock plan builds a fresh one); the diagram boxes are restored by the page |
| `GET /api/diagrams`, `GET /api/diagrams/:name` | names: `route-a`, `route-b` |
| `GET /api/audit` | `{ entries: [{ at, op, route, outcome, ... }] }`, newest first. Summary entries only, never a user's email |
| `GET /api/shelf` | the header Shelf button |

## `GET /api/info`

```json
{
  "mode": "mock", "source": "mock", "realAvailable": false, "realReason": "Real is refused: owner-opt-in. ...",
  "real": { "available": false, "failed": ["owner-opt-in"], "needs": ["..."] },
  "routes": {
    "a": { "label": "PingOne API: group membership", "realReady": false, "missing": ["BULK_P1_WORKER_CLIENT_ID", "..."] },
    "b": { "label": "Privilege console API: POST /v1/users", "realReady": false, "missing": ["BULK_CONSOLE_URL", "..."] }
  },
  "writesEnabled": false,
  "limits": { "maxUsers": 50000, "concurrency": { "min": 1, "max": 16, "default": 6 } },
  "mock": {
    "scenarios": [{ "id": "realistic", "label": "Realistic", "description": "..." }],
    "datasets": [100, 500, 5000]
  }
}
```

`routes.*.missing` lists setting NAMES only, never values. `mock` is present in both modes (the controls only apply in Mock). `writesEnabled` is the Real-mode writes switch (see below).

Mock scenario ids: `realistic` (default), `clean`, `rate-limited`, `flaky`, `conflicts`, `missing-role`.

## Jobs

One job runs at a time. A job is a **plan** (reads, decides, writes nothing) or an **apply** (writes, from a plan).

### `POST /api/plan`

Body: `{ "route": "a" | "b", "scenario"?: <id>, "users"?: 100 | 500 | 5000, "concurrency"?: 1..16 }`.
`scenario` and `users` are Mock-only: in Real they are a 400 `bad_request`. In Real, `routes.<r>.realReady` must be true or 409 `needs_setup`.
`202 { "job": <Job> }`. 409 `job_running` when a job is running. 403 `real_refused` when Real is selected and the guards fail.

### `POST /api/apply`

Body: `{ "planId": "<from the finished plan job>", "confirm": "REGISTER <n>", "acknowledgeWarnings"?: [<warning code>, ...] }`. The apply runs at the plan's concurrency. where `<n>` is the number of people the plan would change (`plan.counts.toApply`).
`202 { "job": <Job> }`. Refusals (all JSON, nothing is written):

| Status | `error` | When |
|---|---|---|
| 409 | `no_plan` | no finished plan, or `planId` does not match the latest plan |
| 409 | `stale_plan` | the plan is older than 15 minutes, or the mode changed since (after a Reset there is no plan at all: `no_plan`) |
| 409 | `job_running` | another job is running |
| 400 | `bad_request` | `planId` or `confirm` is present but not a string |
| 400 | `confirm_required` | `confirm` is not exactly `REGISTER <n>` |
| 409 | `warnings_unacknowledged` | the plan has warnings with `blocking: true` that are not in `acknowledgeWarnings` |
| 403 | `writes_disabled` | Real, and the writes switch is off |
| 403 | `real_refused` | Real selected and the guards fail |
| 409 | `nothing_to_do` | `toApply` is 0 |

### `POST /api/writes`

Body `{ "enabled": true | false }`. Real only; in Mock it answers 409 `mock_only` (Mock always writes to the in-process mock). `200 { "writesEnabled": bool }`. Reset turns it off.

### `GET /api/jobs/current`

`{ "job": <Job> | null }`. The page polls this (every 400 ms while `state` is `running`).

### `POST /api/jobs/current/abort`

`200 { "job": <Job> }`; the job ends in state `aborted` after the calls in flight finish. 409 `no_job` when none is running.

### `GET /api/jobs/current/results?status=&offset=0&limit=100`

`{ "total": n, "offset": 0, "limit": 100, "statuses": { "<status>": count }, "rows": [<Row>] }`. `status` filters; `limit` is at most 500.

### `GET /api/report?format=json|csv`

The last finished job as a download (`Content-Disposition: attachment`; the filename is `bulk-users-<mock|real>-<plan|apply>-<a|b>.<json|csv>`, and the CSV has a `source` column, `mock` or `real`, on every row, so a Mock result cannot be mistaken for a Real one). 404 `no_report` when there is none. CSV cells that start with `= + - @` are prefixed with `'`.

## Shapes

```
Job = {
  id, kind: "plan" | "apply", route: "a" | "b", source: "mock" | "real",
  state: "running" | "done" | "aborted" | "failed",
  phase: string,                 // "reading the source", "snapshotting the destination", "deciding", "applying", "finished"
  startedAt, updatedAt, finishedAt: ISO string | null,
  total: number | null,          // people in the source, once known
  processed: number,
  counts: Counts,
  http: { calls, retries, rate429: number, waitedMs: number, perSec: number },
  warnings: [{ code, message, blocking: boolean }],
  planId: string | null,         // set on a finished plan
  scenario: string | null,       // Mock only (an apply carries its plan's)
  users: number | null,          // Mock only: how many people the Mock source holds (an apply carries its plan's)
  concurrency: number,           // the Concurrency box: an apply runs at its PLAN's concurrency
  timeScale: number,             // 1 in Real; 0.02 in Mock (every wait is shortened to that fraction, so a demo does not sit through real seconds)
  error: { code, message } | null
}

Counts (plan, route a):  { "create+add", "add", "in-sync", "conflict", "invalid", toApply }
Counts (plan, route b):  { "create", "exists", "conflict", "invalid", toApply }
Counts (apply, route a): { "created", "added", "in-sync", "conflict", "invalid", "failed", "pending" }
Counts (apply, route b): { "created", "exists", "conflict", "invalid", "failed", "pending" }

Row = { n, username, email /* masked: a***@host */, status, detail, httpStatus: number | null, attempts: number }
```

`toApply` for route a is `create+add + add`; for route b it is `create`.

Warning codes: `destination_empty` (blocking; the destination answered with no users at all, which in PingOne can mean the worker lacks the Identity Data Admin role rather than an empty environment), `truncated` (blocking; the source is over `limits.maxUsers`, only the first `maxUsers` are planned), `group_missing` makes the job `failed` with that error code instead of a warning.

Error codes inside `job.error`: `group_missing`, `source_unreadable`, `destination_unreadable`, `token_refused`, `login_required` (route b, console 401/403), `circuit_open` (too many failures early in an apply; the run stopped on purpose), `aborted`.

## Settings (Real only; the lab's own `.env` beside `docker-compose.yml`, mode 600)

```
PRIVILEGE_BULK_MODE=real                 # the owner's opt-in; anything else keeps Real refused
BULK_P1_REGION=com                       # com | eu | asia | ca | com.au | sg
BULK_P1_SOURCE_ENV_ID=                   # where the people are
BULK_P1_PRIVILEGE_ENV_ID=                # Privilege's own PingOne environment (may equal the source)
BULK_P1_WORKER_CLIENT_ID=
BULK_P1_WORKER_CLIENT_SECRET=            # write-only: never returned, logged or audited
BULK_P1_GROUP=                           # the Privilege group name
BULK_P1_WORKER_ENV_ID=                   # optional; the worker app's home environment (default: the source)
BULK_CONSOLE_URL= BULK_CONSOLE_TENANT= BULK_CONSOLE_API_KEY= BULK_CONSOLE_API_SECRET=   # route b
BULK_CONSOLE_INSECURE_TLS=1              # optional; the local desktop console's self-signed certificate
```

## Rules the engine applies (so the page can explain them)

- **Plan lifecycle.** Starting a plan retires the previous one at once. A plan that was aborted, or Reset away, is never `done` and never applicable. An apply uses its plan up.
- **Duplicates in the source.** A second person with the same email or username as an earlier one (or a page overlap) is planned as `conflict`, once; only the first is planned.
- **A create whose answer was lost.** If a create was sent more than once and the retry says "already exists", the lab looks the person up by email: the same email and username is ours (they still get added to the group, status `created`); anything else is a `conflict`.
- **Redirects are never followed**, and a response over 8 MB is refused. An upstream `code` is shown only if it looks like a code (upper-case words); any other text, such as an echoed header, is dropped.
- **Listing limits.** A source is cut at `limits.maxUsers` (a blocking `truncated` warning). Any single listing stops at 1,000 pages of 100 (100,000 people); a bigger Privilege environment stops with `destination_unreadable`.
- **Response headers.** Every response carries `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer` and a `Content-Security-Policy` that allows only this origin (`default-src 'self'`, `frame-ancestors 'none'`, `object-src 'none'`).
