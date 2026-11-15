# Privilege Bulk Users LAB

Privilege Bulk Users LAB shows how to register many people for PingOne Privilege with API calls instead of console clicks: a Guide teaches the two routes step by step, and a Run page plans, applies and verifies a bulk registration against a simulation of PingOne and the Privilege console, with 429 back-off, a typed-count gate and a downloadable report. Mock by default and fully offline; Real is owner-run, and nobody who built this lab has run it.

Tier: Tester
Repo: https://github.com/curtismu7/privilege-bulk-users-LAB
Catalog: none yet (owner assigns with the board row)
Fork of: [privilege-api-explorer-LAB](https://github.com/curtismu7/privilege-api-explorer-LAB), with its repo, port, shelf entry and history of its own.
Changed from the fork: no connections store and no catalog explorer; added the bulk engine (plan, apply, verify), the two routes, the Mock world, and the Guide and Run pages; settings now come from this lab's own `.env`.

> **Nothing in Real was run while this lab was built.** Every test uses the in-process mock. Route A follows a script the owner runs in daily use; route B is UNVERIFIED against a real console. The header has a **Mode** control (Mock or Real) and shows the mode; **Real is refused** until the owner opts in, and the banner on every page, presenter mode included, names the mode.

## What is simulated

**Mock mode (the default, and the only mode that runs with no setup).** An in-process stand-in for PingOne (a source environment and Privilege's own environment) and for the Privilege console, with made-up people on `.example` addresses, held in memory on this machine. It plays six scenarios: realistic, clean, rate-limited, flaky, conflicts and a worker with a missing role. The people and the failures are an illustrative sample, not a recording. Nothing leaves this machine: a netguard refuses every non-loopback socket, DNS lookup, fetch and UDP send, and a test asserts zero attempts. The banner says the same.

**Real mode (owner-run).** Reads the people from the PingOne environment you name, and creates people and group memberships in Privilege's environment (route A) or user records in the Privilege console (route B), with the credentials in this lab's own `.env`. It is refused until the owner sets `PRIVILEGE_BULK_MODE=real`, and even then a write needs a fresh plan, the count typed back, and the Writes switch. The netguard lets a job reach only the PingOne hosts of its region and, for route B, the one console origin, and only while the job runs. This lab never deletes anything.

## The two routes

| | Route A: PingOne API | Route B: Privilege console API |
| --- | --- | --- |
| What it calls | The PingOne Management API: create the person in Privilege's environment (no password), add them to the Privilege group | `POST /api/{tenant}/v1/users` on the Privilege console |
| Signs in with | A worker app (client credentials) with the Identity Data Admin role | A console user API key and secret |
| Evidence | A script the owner runs in daily use | UNVERIFIED against a real console; documented in the swagger and Mock-tested only |
| Real settings | The `BULK_P1_*` names | The `BULK_P1_*` names (the source of the people) and the `BULK_CONSOLE_*` names |

The people always come from a PingOne source environment. Privilege only knows the people of its own PingOne environment who are in the Privilege group; the trap is that a worker without the role reads an empty list, not a 403, which the plan turns into a blocking warning.

## Run from a clone

Prerequisites: Node 26 or newer (`.nvmrc` says 26). Docker only for the Docker form.

```bash
git clone https://github.com/curtismu7/privilege-bulk-users-LAB.git
cd privilege-bulk-users-LAB
npm ci
npm run doctor      # node, mode, bind, data directory, port range, diagrams, settings names, netguard self-test, free port
npm run build       # builds web/dist, which the server serves itself
npm start           # then open http://127.0.0.1:7817/
```

Docker (OrbStack, never Docker Desktop), instead of the host run:

```bash
docker compose up --build -d     # then open http://127.0.0.1:7817/
```

Mock needs no setup at all: no settings file, no account, no network. The Guide is the front page. Open **Run**, keep route A and the Realistic scenario, press **Plan (dry run)**, then type `REGISTER` and the count it shows and press **Apply**, and finally press **Verify (plan again)**: it finds 0 to apply.

```bash
curl -s http://127.0.0.1:7817/api/health
curl -s http://127.0.0.1:7817/api/info
npm run smoke       # both routes end to end against the running app (Mock), then Reset
```

Development: `npm run dev` starts the API (`node --watch`) and the Vite dev server on `127.0.0.1` (`VITE_PORT`, default 7999), which proxies `/api`. `npm run e2e` drives headless Chromium against the built UI in Mock (it needs `npm run build` first and `npx playwright install chromium`; set `E2E_CHROMIUM` to a Chromium binary if the pinned Playwright build is missing; `E2E_PORT` defaults to 7998).

## Settings file

This lab reads its own `.env`, beside `docker-compose.yml` (mode 600, git-ignored, never baked into the image). Copy `.env.example`, which lists the names with a comment each and never a value. Only these names are read; every other key in the file is ignored. Docker takes them from the same file through an optional `env_file`, so with no `.env` the lab starts in Mock. A host run can point at another file with `BULK_ENV_FILE=/path`. A bare `MODE` is never read.

| Name | Needed for | What it is |
| --- | --- | --- |
| `PRIVILEGE_BULK_MODE` | Real | `real` is the owner's opt-in; anything else keeps Real refused |
| `BULK_P1_REGION` | Real, both routes | PingOne region suffix: `com`, `eu`, `asia`, `ca`, `com.au` or `sg` |
| `BULK_P1_SOURCE_ENV_ID` | Real, both routes | The environment where the people are |
| `BULK_P1_PRIVILEGE_ENV_ID` | Real, route A | Privilege's own PingOne environment (it may equal the source) |
| `BULK_P1_WORKER_CLIENT_ID` | Real, both routes | The worker app's client id |
| `BULK_P1_WORKER_CLIENT_SECRET` | Real, both routes | The worker app's secret: write-only, never returned, logged or audited |
| `BULK_P1_GROUP` | Real, route A | The Privilege group's name |
| `BULK_P1_WORKER_ENV_ID` | Optional | The worker app's home environment (the default is the source) |
| `BULK_CONSOLE_URL` | Real, route B | The console origin: https (http only for a loopback address), no path |
| `BULK_CONSOLE_TENANT` | Real, route B | The console tenant id |
| `BULK_CONSOLE_API_KEY` | Real, route B | The console user API key |
| `BULK_CONSOLE_API_SECRET` | Real, route B | The console user API secret: write-only |
| `BULK_CONSOLE_INSECURE_TLS` | Optional | `1` accepts the local desktop console's self-signed certificate |

The page, `GET /api/info` and `npm run doctor` show which names a route is missing, never a value. The port is not a setting: it is `PORT` in the environment (see below). The first Real run is the owner's: follow [docs/live-checks.md](docs/live-checks.md).

## Ports, and what to do if the port is taken

Ports: privilege-bulk-users listens on 7817 (set with PORT, default 7817).
Port range for this app: three ports are declared: 7817 (the app), 7998 (the end-to-end run, `E2E_PORT`) and 7999 (the Vite dev server, `VITE_PORT`). The app itself accepts any `PORT` in 7800-7999 (the doctor checks it), and Docker publishes `HOST_PORT` (default 7817) on 127.0.0.1 only.

If the port is taken:
1. Find what is using it:

```bash
lsof -iTCP:7817 -sTCP:LISTEN -n -P
```

2. If it is an old copy of this app, stop that process: `kill <PID>`.
3. If it is something else, either stop it or start this app on another port in 7800-7999: `PORT=7890 npm start` (the doctor accepts that range; the shelf registry only knows 7817).
4. Do not use 8080, 5173, 3000, 4000, 4400, 4510, 4600-4601, 18080, 19080 or 19090. Those are taken by other demos or other tools.

## Mock and Real

The header has a **Mode** control (a select with Mock and Real) on every page, the `Mode:` chip next to it, and a banner on every page, presenter mode included, that says which mode you are in and what is simulated. The mode lives on the server: the toggle posts `POST /api/mode` and the page re-reads `GET /api/info`, so switching back and forth needs no restart. The Real option is disabled while the guards fail (no opt-in in the `.env`, or a non-loopback bind outside the compose file), and the Run and Help pages say why in plain text. In Real the Run page drops the scenario and people controls (it plans from your own environments), shows the settings the route is still missing by name, and adds the Writes switch, which is off by default and off again after Reset. The Concurrency box (1 to 16) sets the pace of the plan and of the apply that follows it. A plan can be applied once, in the mode it was made in, for 15 minutes: starting another Plan, switching the mode or Reset retires it.

## The pages

- **Guide** (the front page): why one click per person does not scale, how Privilege knows a user, the two routes, route A step by step as `curl` commands with `$PLACEHOLDER` variables and shortened answers, what a bulk run needs at scale, route B, and the list of what is UNVERIFIED.
- **Run**: choose the route, the scenario (Mock) and the concurrency (it governs the plan and the apply), then Plan, Apply and Verify, with live counts, progress, call numbers (429s, retries, time waited), warnings, a person-by-person results table and JSON and CSV reports.
- **Diagram**: route A and route B drawn from diagram-studio data, with movable boxes, Simulate, Reset and a speed control.
- **Audit**: one summary line per plan, apply, abort or writes switch.
- **Help**: how to run it, what Mock simulates, how Real is set up (setting names only), presenter mode and what each refusal code means.

Presenter mode (the Present button, or P) enlarges the text and keeps the banner and the mode on screen; Esc leaves it. The presenter script is [docs/talk-track.md](docs/talk-track.md).

## Health, doctor and reset

```bash
npm run doctor   # preflight: node, mode, data dir, bind, port range, diagrams, settings names, netguard self-test, free port
npm run reset    # POST /api/reset on the running app: the job and plan, the audit history, the Mock world and the Writes switch
```

The app answers `GET /api/health` with `demo-health/1`. The Reset button in the header does the same and also puts the diagram boxes back. Reset undoes nothing in a real environment: this lab never deletes.

## Docker

```bash
docker compose up --build -d     # OrbStack; HOST_PORT=<port> changes the host port
```

The container publishes `127.0.0.1:` only (a test pins it), runs as a non-root user with a read-only filesystem and no capabilities, restarts with Docker (`restart: unless-stopped`), and has a health check on `/api/health`. Settings come from the optional `.env` beside the compose file; compose's `env_file` puts every value in it, the worker secret included, into the container's environment, where `docker inspect` shows it (see [docs/live-checks.md](docs/live-checks.md)). Run it through compose: the image listens on all interfaces inside the container but does not carry the marker that lets Real accept that, so a bare `docker run -p 7817:7817` is Mock only and refuses Real. To check a running copy by content: `npm run verify-running -- http://127.0.0.1:7817 --container <container name>`.

## Safety model

- Loopback only: the bind, the Host check and the same-origin write check; Docker publishes `127.0.0.1:` only.
- Zero outbound in Mock; a permit per job, for the PingOne hosts of the region (and the one console origin) only, in Real.
- A write needs a fresh plan, the exact `REGISTER <n>` typed back, every blocking warning acknowledged and, in Real, the Writes switch.
- Secrets are write-only: never returned, logged or audited. Server text is shown as text, never markup.
- No identifiers from other projects: fixtures use made-up people and `.example` hosts.

The full model, each rule with its test, and what is not protected are in [docs/security.md](docs/security.md).

## Tests

```bash
npm test            # server (node --test) + web (vitest) + scripts/*.test.mjs
npm run content-pack
npm run talk-track  # regenerates docs/talk-track.md; a test fails on drift
```

On Node 26 a good `npm test` run (2026-11-14) is 125 server tests, 119 web tests (vitest) and 59 scripts tests, 303 in all; `npm run e2e` adds 31 browser checks (axe runs on seven page states).

`npm run e2e` is the browser run (Mock only). `bash scripts/check-ui-standard.sh` checks the vendored stylesheet against the canonical copy and its pin. The family `check-css.sh` reports one FAIL here, for the vendored shared TopMenu stylesheet (a `prefers-color-scheme` rule); that file is the canonical shared component and is never edited in this lab.

## Troubleshooting

- **The port is taken.** See "Ports, and what to do if the port is taken" above.
- **Real is refused, or the Real option is disabled.** Real needs `PRIVILEGE_BULK_MODE=real` in this lab's own `.env` and a loopback bind (in Docker, only the compose file satisfies it: a bare `docker run` of the image refuses Real); the Run and Help pages say which guard fails. Run `npm run doctor`: its `mode` line names the guard that fails.
- **The plan shows `destination_empty`.** The worker app probably lacks the Identity Data Admin role on Privilege's environment: PingOne then answers with an empty list instead of a 403. Fix the role and plan again.
- **A plan says `needs_setup` or Plan is disabled in Real.** The message names the settings the route is missing. Set them in `.env` and restart.
- **The page is missing, or `/` answers JSON.** The server serves `web/dist`: run `npm run build` first (the Docker image builds it).
- **A run stops with `circuit_open`.** Most of the most recent people failed (the last 50, once 20 have finished), which is usually one cause. Read the first failed rows, fix it, and plan again; do not just apply again.

## Docs

- [docs/architecture.md](docs/architecture.md): the pipeline, the job manager, the gate, the Mock world and where each claim is pinned.
- [docs/security.md](docs/security.md): the security model and what is not protected.
- [docs/live-checks.md](docs/live-checks.md): the owner's checklist for the first Real run, including how to roll back.
- [docs/api.md](docs/api.md): the API contract between the server and the page.
- [docs/references.md](docs/references.md): the sources, and the UNVERIFIED list.
- [docs/talk-track.md](docs/talk-track.md): the presenter script.
- [CHANGELOG.md](CHANGELOG.md).

## Ownership

- Owner: curtismu7
- License: MIT (see [LICENSE](LICENSE))
- Found a problem? Open an issue on the repo.
