# Architecture

One Node 26 ESM process (Express) serves the JSON API ([api.md](api.md)) and the built web app (React and Vite, hash routes). Settings and secrets stay on the server; the page only ever sees setting names. One job runs at a time, in memory.

```text
browser  --same-origin-->  server (loopback, port 7817)  --Mock-->  in-process mock world (an injected fetch: no socket opens)
                               |
                               +--Real, only while a job runs, through a netguard permit per host-->
                                     PingOne token + API hosts of the region   (route a, and the source of route b)
                                     the one Privilege console origin         (route b)
```

The same picture is the Diagram page: two diagram-studio/1 data files, `server/diagrams/route-a.json` and `route-b.json`, checked when the server starts and fetched by name from `GET /api/diagrams/:name`. Nothing in the page lists a box or an arrow.

## The pipeline

Both routes run the same five steps. The code is `server/src/routeA.js` and `routeB.js`; the numbers are the engine's, not guesses.

1. **Source.** Read the people from the source environment, 100 to a page (PingOne caps a page at 100), following `_links.next.href` until there is none, up to 50,000 people. A link that leaves the environment or loops stops the job. A larger source is a blocking `truncated` warning, not a silent cut.
2. **Snapshot.** Read the destination once and keep it in memory, keyed by lower-case email and by lower-case username: Privilege's PingOne environment for route a, the console's user list for route b. One read, not one lookup per person: the number of calls stays near the number of pages plus the number of people to change. If the source and Privilege's environment are the same environment, there is no second read and nothing to create.
3. **Decide.** Match every person in memory. Route a: `create+add`, `add`, `in-sync`, `conflict` (the username belongs to someone else, a person decides), `invalid` (no email or no username: never sent). Route b: `create`, `exists`, `conflict`, `invalid`. A person whose email or username already appeared earlier in the source (a real duplicate, or a page that overlapped) is a `conflict` too, in both routes: only the first is planned and a person decides about the rest. Only route a's people who already exist cost one more call each, for their group membership (there is no bulk call that this lab knows of: UNVERIFIED). The group must exist: no group is `group_missing` and nothing is written. An empty destination is a blocking `destination_empty` warning, because a worker without Identity Data Admin reads an empty list, not a 403.
4. **Pool.** Apply runs the people to change through a bounded pool: `concurrency` calls in flight (1 to 16, default 6), never one request per person in sequence and never all at once. Route a creates the person with no password, then adds them to the group by the user-centric call, and retries the add when PingOne answers 404 for a person created a moment ago. A create whose answer was lost (a timeout or a 5xx, so the request was sent more than once) is not blindly trusted either way: if the retry is told the person already exists, the lab cannot know whether that was its own first try, so it looks the person up by email. The same email and username is its own earlier create, and the group add still happens; anything else is a `conflict` (someone else created it since the plan: plan again). Route b treats a 409 on create as `exists` for the same reason. A failure is that person's failed row; the pool carries on.
5. **Verify.** Plan again. Everyone who was created or added is now `in-sync` (or `exists`), so the plan finds 0 to apply, apart from conflicts and invalid rows. The lab keeps no memory of what it did: verify is a fresh read, which is why it is idempotent and why it proves the run.

### The request path (`http.js`)

Every call to PingOne or the console goes through one resilient function with one shared gate. A 429 pauses every worker for the `Retry-After` (seconds or an HTTP date, capped at 60 s), not only the one that was told off, and the call goes again. A 5xx or a network error is retried with exponential back-off, then reported as that person's failed row; nothing in this path throws for one person. It counts calls, retries and 429s, and the time waited, which the Run page shows. Each call times out after 30 s. In Mock every wait is scaled to 2% so a demo does not sit through real seconds (the job says `timeScale`).

## The job manager (`jobs.js`)

The rules that make a bulk write safe are in one place.

- **One job at a time**, a plan or an apply. A second start is 409 `job_running`.
- **A plan keeps its decisions in memory** and gets a `planId`. It can be applied for 15 minutes, in the mode it was made in, and once. Its lifecycle: it is **retired** when a new plan starts (a failed or aborted re-plan therefore leaves no older plan applicable), on a mode change (flipping back does not revive it), on Reset, and when an apply uses it. The apply takes the plan's `concurrency`: the Concurrency box on the Run page governs the plan and the apply alike.
- **The two-step gate.** `POST /api/apply` needs the latest plan's id, `confirm` exactly `REGISTER <n>` with `<n>` = `counts.toApply`, and every blocking warning acknowledged by code. In Real the Writes switch must also be on. Each refusal has its own code (see [api.md](api.md)) and writes nothing.
- **Abort and the circuit breaker share one mechanism.** An abort (the button, or Reset) lets the calls in flight finish, starts nobody else, and ends the job `aborted`; everyone not yet processed stays `pending`. That is true of a plan too: an aborted plan ends `aborted`, never `done`, and cannot be applied. The breaker trips the same abort: once 20 people have finished, if more than half of the most recent 50 have failed unexpectedly (a window, so a long run that breaks half way stops promptly), the run stops itself with `circuit_open` (the job ends `failed`): that is one cause (a missing role, a wrong group), not that many bad people. A few failures do not trip it, and a person who is a `conflict` or `invalid` in the plan was never going to be sent.
- **Reset aborts, then waits.** Reset aborts a running job and waits for it to drain (its calls in flight finish) before it forgets the job, its plan, the audit history and the Mock world and turns the Writes switch off. Because it waits, a job cannot write a late audit entry or bring a plan back after Reset.
- **Results and the report.** Every person has a row (`n`, username, masked email, status, detail, HTTP status, tries). Rows are paged and filterable; the last finished job downloads as JSON or CSV, with spreadsheet formulas neutralised, and the mode (mock or real) is in the file name and in every CSV row.
- **The audit.** One summary line per plan, apply, abort or writes switch, with counts and no address (`GET /api/audit`, `.data/audit.jsonl`).

## Contexts: Mock and Real (`context.js`)

A job asks for a context and gets the clients it talks through. In **Mock** that is the mock world behind an injected fetch. In **Real** it is the lab's own settings (`settings.js`, validated again when the job starts), the real fetch, and a netguard permit for only that job's hosts, released when the job ends. The mode is server-side state: the header toggle posts `POST /api/mode`, and Real answers 409 while the guards in `config.js` fail.

## The Mock world (`mockWorld.js`)

A deterministic fake of a PingOne source environment, Privilege's own environment and the Privilege console, with made-up people on `.example` addresses. Every person's fate comes from a hash of the seed and the person's index, never from call order, so a test compares the engine's plan with the ground truth computed while the world was built (`world.expected(route)`). Six scenarios switch on the behaviours the Guide teaches: `realistic`, `clean`, `rate-limited`, `flaky`, `conflicts`, `missing-role` (the last answers an EMPTY destination list with 200, the trap). The world persists between Plan, Apply and Verify while the scenario and the number of people stay the same; Reset, or changing either, starts a new one. It is an illustrative sample, not a recording.

## Server (`server/src`)

| File | Job |
| --- | --- |
| `app.js` | The routes, the mode (`/api/mode`, `/api/info`), the jobs (`/api/plan`, `/api/apply`, `/api/writes`, `/api/jobs/current`, `/api/report`), Reset, the audit, the diagrams, the static web app. |
| `jobs.js` | The job manager and the two-step gate (above). |
| `routeA.js`, `routeB.js` | The pipeline for each route: `plan` and `apply`. |
| `pingone.js`, `console.js` | The PingOne Management API client (token, paged reads, create, group add) and the Privilege console client (list, create). Reads throw a coded error; writes return the result. |
| `http.js`, `pool.js` | The resilient request path with its shared gate; the bounded worker pool. |
| `context.js`, `mockWorld.js` | The clients for Mock or Real; the Mock world and its scenarios. |
| `config.js`, `settings.js` | The mode and the guards (`realGuards`, `realRefusal`), the port and the limits; the lab's own `.env` (read with `util.parseEnv`, only `SETTING_KEYS`), route readiness (names only) and the validated Real configuration. |
| `netguard.js`, `urls.js` | The runtime guard with its permits and self-test; the typed-origin screen and `liveHosts`. |
| `security.js`, `redact.js`, `errors.js` | Loopback, Host and same-origin guards; scrubbing; the coded error for a stopped job. |
| `health.js`, `doctor.js` | `demo-health/1`; the preflight shared by `npm run doctor` and the health route. |
| `diagrams.js`, `diagramStudioValidate.js` | Loads and validates the two diagram files; refuses to start on a bad one. |
| `shelfLink.js` | The header Shelf button's address. |

## Web (`web/src`)

Hash routes, the Guide first: **Guide**, **Run**, **Diagram**, **Audit** and **Help**. The header holds the shared TopMenu (the Mock / Real toggle, the theme, the text size, Present, Shelf, Help, Reset) and the `Mode:` chip; the banner above every page names the mode, presenter mode included. The mode is the server's: the toggle posts it and the page follows `GET /api/info`, so the chip and the banner always say what the server is in. Server text is rendered as text nodes only, and JSON panes use the shared JsonPane (a Formatted form by default, with a Raw toggle). The vendored shared components (TopMenu, JsonPane, the floating dialog, the return link, the stylesheet) are pinned by sha256 and never hand-edited.

## Packaging

`Dockerfile` (two stages, Node 26, non-root, carries `server/src`, `server/diagrams` and the built web app, no `.env`), `docker-compose.yml` (`127.0.0.1` only, an optional `env_file`, `restart: unless-stopped`, a health check on `/api/health`, and the `PBU_CONTAINER=1` marker that lets Real accept the container's wide bind: the image has the wide bind but not the marker, so a bare `docker run` refuses Real), `scripts/` (doctor, reset, smoke, verify-running, e2e, the content-pack and talk-track builders and every test that pins the packaging), `docs/shelf-entry.json` and `content-pack.json`. There is no k8s build: the SE cluster build is deferred by the owner.

## Where each claim is pinned

| Claim | Where |
| --- | --- |
| The plan finds exactly what the Mock world holds; apply registers everyone it can; verify finds nothing left | `server/test/engine.test.js` |
| Apply is refused until the count is typed, the plan is fresh and every blocking warning is acknowledged | `server/test/gate.test.js`, `web/src/pages/Run.test.jsx` |
| The circuit breaker, the abort, the CSV and the redaction | `server/test/jobs.test.js`, `server/test/gate.test.js` |
| A plan is retired by a new plan, a mode change, Reset or an apply; an aborted plan never ends `done` | `server/test/abuse-gate.test.js :: G3 an old plan does not survive a failed or aborted re-plan`, `server/test/abuse-gate.test.js :: G2 abort during the plan membership phase: the plan is aborted, never done, and cannot be applied` |
| Reset aborts, waits, and leaves no late audit entry or revived plan | `server/test/abuse-gate.test.js :: G4 Reset during a running apply leaves no late audit entry`, `server/test/abuse-gate.test.js :: G5 Reset during a running plan does not resurrect the plan` |
| The Concurrency box governs the apply as well as the plan | `server/test/gate.test.js :: the Concurrency box governs the apply as well as the plan; the job says how many people and which scenario` |
| Duplicates in the source are planned once, the rest are conflicts | `server/test/jobs.test.js :: duplicate people in the source (the same email or username, or a page overlap) are planned once; the rest are conflicts, on both routes` |
| A create whose answer was lost: ours is still added to the group, anything else is a conflict | `server/test/jobs.test.js :: a create whose answer was lost and then retried: if the person is ours they are still added to the group; if not it is a conflict` |
| Hostile upstream text cannot leak a credential into a row or an error | `server/test/abuse-secrets.test.js`, `server/test/hardening.test.js :: an upstream "code" is shown only if it looks like a code: anything else is dropped even when it is not a secret we know` |
| Pagination, redirect, size and timeout guards on every upstream call | `server/test/hardening.test.js`, `server/test/abuse-outbound.test.js` |
| The response headers | `server/test/gate.test.js :: every response carries the security headers; the page can only load its own files` |
| 429 back-off, `Retry-After`, 5xx retry | `server/test/http.test.js` |
| Real is refused unless the owner opts in; the toggle answers 409 | `server/test/mode.test.js`, `server/test/real.test.js`, `scripts/repo.test.mjs` |
| Zero outbound in Mock; a permit per job in Real | `server/test/netguard.test.js`, `server/test/runtimeguard.test.js`, `server/test/real.test.js`, `npm run e2e` |
| Settings come from the `.env`, names only | `server/test/settings.test.js`, `scripts/docs.test.mjs` |
| Loopback, Host and same-origin | `server/test/labproxy.test.js`, `scripts/compose.test.mjs` |
| The docs name the real routes, codes, scenarios and settings | `scripts/docs.test.mjs` |
| No identifier from another project, no trace of the fork source | `server/test/repo-scan.test.js`, `scripts/repo.test.mjs` |
| The scripts do what they say | `scripts/scripts.test.mjs` |

The security model, with each rule and its test by title, is [security.md](security.md). The sources behind every product claim, and what is UNVERIFIED, are [references.md](references.md).
