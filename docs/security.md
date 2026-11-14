# Security model

What this app protects, what it does not, and the test that pins each rule. Every `file :: title` below names a test that runs in `npm test` (a test in `scripts/docs.test.mjs` fails if a title goes missing).

## The request path

Browser, then this app's server (Express, loopback by default), then in Real only the PingOne token and API hosts of the configured region and, for route B, the one Privilege console origin. The browser never holds a credential and never talks to PingOne or the console directly. Mock opens no socket at all: it runs behind an in-process `fetch`.

## Real is owner-run

This lab can create people and group memberships in a PingOne environment, so Real is the owner's decision and nothing in the repo turns it on.

- Real is refused (403 `real_refused`, and 409 `real_not_available` on the header toggle) unless `PRIVILEGE_BULK_MODE=real` is in the lab's own `.env` and the bind is loopback. A non-loopback `PBU_BIND` counts only when `PBU_CONTAINER=1` is also set, and only `docker-compose.yml` sets that, together with its `127.0.0.1`-only publish: the image has the wide bind but not the marker, so a bare `docker run` of the image refuses Real (`scripts/compose.test.mjs :: with the real guard function: a bare run of the image refuses Real, the compose environment accepts it`). A bare `MODE` is never read. The compose file, the Dockerfile and CI never set the mode (`server/test/mode.test.js :: the guards: Real needs the owner opt-in and a loopback bind (or the container opt-in)`, `server/test/mode.test.js :: modeFrom: mock by default, real only when asked, anything else is an error, a bare MODE is ignored`, `scripts/repo.test.mjs :: Real stays an opt-in: the only mode key is PRIVILEGE_BULK_MODE, nothing in the repo sets it, a bare MODE is never read, and the page state starts as mock`).
- A refused Real can be neither toggled nor planned, and nothing real is called (`server/test/mode.test.js :: POST /api/mode: exactly {source}; Real is a 409 with the reason while the guards fail; Mock stays`, `server/test/real.test.js :: Real is refused off loopback: the server starts in Mock, the toggle answers 409, and nothing real is ever called`).
- Real needs the settings of the route in use, checked again when a job starts. A missing or malformed setting is a named stop that says which setting, never what it held (`server/test/settings.test.js :: realConfig: bad values are refused, and the message names the setting without echoing the value`).
- The agents that built this lab never ran Real. Every test uses the in-process mock. The first Real run is the owner's: see [live-checks.md](live-checks.md).

## Secrets

- Settings live in the lab's own `.env` beside `docker-compose.yml` (mode 600, git-ignored, kept out of the image by `.dockerignore`). Only the names in `SETTING_KEYS` are read from it; every other key is ignored (`server/test/settings.test.js :: only the listed names are read from the .env; nothing else enters the environment; no file means defaults; the environment wins`). `.env.example` lists the names and never a value.
- The worker client secret, the console API key and the console API secret are never returned by the API, never logged and never audited. `/api/info` and the doctor list setting NAMES that are missing, never values (`server/test/settings.test.js :: readiness lists setting NAMES only, never a value`). An error message that might echo a credential is scrubbed first (`server/test/jobs.test.js :: an unexpected exception is "internal error"; a coded one is shown, with secrets scrubbed`).
- A hostile or broken upstream cannot smuggle a credential into a row or an error: what PingOne or the console says back is scrubbed against every secret we hold (including the bearer token, from the moment it is issued) before it reaches a row, a job error or the audit, and an upstream `code` is shown only if it looks like a code (`server/test/abuse-secrets.test.js :: S3b Basic credential (base64 of id:secret) echoed in a code`, `server/test/hardening.test.js :: an upstream "code" is shown only if it looks like a code: anything else is dropped even when it is not a secret we know`).
- A wrong worker secret is a named stop (`token_refused`) that does not echo it (`server/test/real.test.js :: Real: a wrong worker secret is a named stop that does not echo it; scenario and users are Mock-only; missing settings name the setting`).
- The data directory holds one file, `audit.jsonl` (mode 600 in a mode 700 directory): one summary line per plan, apply, abort or writes switch. Counts only, never a person's address and never a credential (`server/test/gate.test.js :: the audit keeps one summary per job and no secret or address`).
- Mock uses clearly labelled mock credentials (`mock-worker`, `demo-key-1111`); they are not real credentials and are shown as such.

## Network

- **Loopback bind by default.** A non-loopback `PBU_BIND` is an explicit opt-in. The container sets it and compose publishes `127.0.0.1:` only (`scripts/compose.test.mjs :: the image opts in to a wide bind but NOT to the container marker; compose adds the marker, and only with the loopback publish`).
- **Host check.** The server answers only to a loopback Host header, or the names in `PBU_ALLOWED_HOSTS` / `LAB_ALLOWED_HOSTS` (the lab-proxy). DNS rebinding is refused (`server/test/labproxy.test.js :: LAB_ALLOWED_HOSTS: the lab-proxy name is served on any port, other names stay 403`).
- **Same-origin writes.** Every state-changing call must carry an Origin that matches Host, or, behind the lab-proxy, the forwarded origin the proxy sets, believed only for an allowed Host name.
- **Netguard.** Zero real outbound by default: every non-loopback socket, DNS lookup, fetch, UDP send and UDP connect is refused and recorded, with its own self-test (`server/test/runtimeguard.test.js :: self-test: every route out is refused and recorded, none reaches the network`, `server/test/runtimeguard.test.js :: a real outbound attempt is blocked and appears in attempts; loopback still works`).
- **Permits per job.** A Real job takes a permit for exactly the PingOne token and API hosts of its region and, for route B, the one console origin, and releases them when the job ends. Nothing else is reachable even while a job runs (`server/test/runtimeguard.test.js :: a permit allows exactly one named host, only while held; loopback never needs one; overlapping permits are counted`, `server/test/runtimeguard.test.js :: liveHosts: the PingOne token and API hosts of the region, plus the one console origin for route b only`, `server/test/real.test.js :: Real route b: the console host is permitted for the job and no longer; the console 401 is a named stop`).
- **No redirect is followed, and a response is bounded.** Every call is sent with `redirect: manual`, so a console or API answer cannot carry the key and secret to another origin; a response over 8 MB is refused rather than buffered, and a timeout is named (`server/test/hardening.test.js :: after a 429 pause an abort sends nothing more; redirects are never followed; every call is sent with redirect: manual`, `server/test/hardening.test.js :: a response that is too big is refused, not buffered; a timeout is named`).
- **A pagination link cannot send the job elsewhere.** A `_links.next.href` that leaves the environment, or loops, stops the job before any call to that host (`server/test/real.test.js :: Real: a pagination link that leaves the environment stops the job before any call to that host`).
- **Response headers.** Every response, a refused request included, carries `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer` and a `Content-Security-Policy` of `default-src 'self'` with `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'none'` and `form-action 'self'` (and `style-src 'self' 'unsafe-inline'` for the progress bar's inline width). No other site can frame the page or script it, and the page can load only its own files (`server/test/gate.test.js :: every response carries the security headers; the page can only load its own files`).
- **The console origin is screened.** https (http only for a loopback address), no credentials in the URL, no path, no literal private or link-local address.
- The end-to-end check (`npm run e2e`) starts the server under the shipped netguard, asserts it made zero outbound attempts across the browser session, and asserts the browser stayed on loopback.

## The two-step gate

A write needs two deliberate steps, and a third in Real.

1. A **plan** (reads, decides, writes nothing). It can be applied for 15 minutes, in the mode it was made in, and once. It is retired when a new plan starts (so a failed or aborted re-plan cannot leave an older plan applicable), on a mode change (switching back does not revive it), on Reset, and when an apply uses it. An aborted plan ends `aborted`, never `done`, and cannot be applied (`server/test/abuse-gate.test.js :: G3 an old plan does not survive a failed or aborted re-plan`, `server/test/abuse-gate.test.js :: G2 abort during the plan membership phase: the plan is aborted, never done, and cannot be applied`).
2. The exact count typed back as `REGISTER <n>`, where `<n>` is the number of people the plan would change, and every blocking warning acknowledged by name.
3. In Real only, the **Writes switch**, which is off by default, in memory only, and off again on Reset and on a mode change.

The **Concurrency** box (1 to 16) is one throttle for the whole run: the apply uses the value its plan was made with, so a low pace chosen for a plan is also the pace of the writes (`server/test/gate.test.js :: the Concurrency box governs the apply as well as the plan; the job says how many people and which scenario`). **Reset** aborts a running job and waits for it to drain before it clears anything, so a job cannot write a late audit entry or revive a plan after Reset (`server/test/abuse-gate.test.js :: G4 Reset during a running apply leaves no late audit entry`, `server/test/abuse-gate.test.js :: G5 Reset during a running plan does not resurrect the plan`). The JSON and CSV reports name the mode in the file name and in every CSV row, so a Mock result cannot be mistaken for a Real one once it has left the page.

Every refusal is JSON with a named code and writes nothing (`server/test/gate.test.js :: apply is refused, with a named reason and nothing written, until every condition holds`, `server/test/gate.test.js :: a plan from before a mode change or a Reset cannot be applied`, `web/src/pages/Run.test.jsx :: Apply is gated: the button stays disabled until REGISTER N is typed exactly, and the panel says how many people change`, `web/src/pages/Run.test.jsx :: Real: Apply also needs the Writes switch; the switch posts /api/writes, shows its state, and the banner follows`).

Around the gate, the engine keeps a bulk write safe:

- **The empty list is a blocking warning.** A worker without Identity Data Admin reads an empty destination, not a 403. The plan says so (`destination_empty`) and Apply stays off until it is acknowledged (`server/test/engine.test.js :: route a, missing role: the empty list is a blocking warning; ignoring it collides with people who exist, and the run stops on purpose`).
- **A conflict is never resolved by the lab.** A username that belongs to someone else is reported, not added.
- **One job at a time, and an abort that finishes what is in flight** (`server/test/gate.test.js :: one job at a time; abort stops the run, finishes what is in flight and leaves the rest pending`).
- **A circuit breaker.** When most of the first people fail, the run stops on purpose (`circuit_open`), because that is usually one cause (`server/test/jobs.test.js :: the circuit breaker: when most of the first people fail, the run stops on purpose and says why`).
- **A shared 429 back-off, capped.** One 429 pauses every worker for the `Retry-After` (seconds or an HTTP date), capped at 60 s, so a server hint cannot park the run (`server/test/http.test.js :: the gate: one 429 holds every worker, and a pause is never shortened`, `server/test/http.test.js :: Retry-After: seconds, fractions, an HTTP date, garbage, a huge value and the past`).
- **This lab never deletes.** There is no delete call anywhere in it, so a run cannot remove a person, and a rollback is the owner's, by hand.

## Hostile input

- Everything a remote service sends (usernames, details, error text) is shown as a text node, never markup (`web/src/App.test.jsx :: hostile text from the server never becomes markup, in the audit, the scenario description and the error pane`, `web/src/pages/Run.test.jsx :: hostile usernames, emails, details and statuses are inert text in the table and in the detail pane`).
- The CSV report prefixes any cell that starts with `=`, `+`, `-` or `@` so a spreadsheet does not run it (`server/test/jobs.test.js :: hostile usernames pass through as plain data and the CSV neutralises spreadsheet formulas`).
- Unknown routes and bad bodies answer JSON and never echo the path (`server/test/mode.test.js :: an unknown route and a malformed body answer JSON, never an HTML error page that echoes the path`). Request numbers are validated and nothing starts on a bad one (`server/test/gate.test.js :: request validation: route, concurrency, scenario and users are checked and nothing starts`).
- Results are paged and capped, and addresses are masked to the first letter and the domain (`server/test/gate.test.js :: results: filter, page, cap; the status tallies add up; usernames and emails are masked or inert`).
- Diagram names come from a fixed allow-list (`server/test/diagrams.test.js :: lookups never reach object prototypes: only the allow-list names resolve`).

## Container

Non-root (`USER node`), read-only root filesystem, `cap_drop: [ALL]`, `no-new-privileges`, a `/data` volume for the audit file only, `restart: unless-stopped`, no secret in the image or the compose file, and the `.env` is passed in at run time by compose, never baked in (`scripts/compose.test.mjs :: the container hardening stays: non-root, read-only, no capabilities, no new privileges, restart policy, health check on /api/health`, `scripts/compose.test.mjs :: no secret value in the container files`, `scripts/compose.test.mjs :: settings come from the .env beside the compose file, and the file is optional so Mock works with none`).

## No identifiers from other projects

A repo scan refuses any UUID except the placeholders, any private host and any key material (`server/test/repo-scan.test.js :: no UUID other than the placeholder, no private host, no key material`). Fixtures use `.example` and `.invalid` hosts and made-up people. CI also runs the forbidden-strings scan over the history and the tree.

## What the page stores

The page keeps three per-viewer conveniences in the browser's `localStorage`, and nothing else: `pbu.font` (text size), `pbu.theme` (Auto, Light or Dark) and `pbu.present` (presenter mode). No credential, no setting, no mode and no result is stored there: the mode is the server's, read from `GET /api/info` (`web/src/App.test.jsx :: presenter mode keeps the banner and the header; the settings are stored under pbu.* and no old key is written`).

## What is NOT protected

- **The app has no login.** The Host and same-origin checks defend against a browser page and against DNS rebinding, not against another program running as a user on this Mac, which can reach the loopback port. In Real that program could plan, and, if the writes switch is on, apply.
- **The `.env` is plain text on disk.** Keep it mode 600. The lab does not check its mode, and anyone who can read the file has the worker secret.
- **In Docker, the secret is also in the container's environment.** Compose's `env_file` passes every value of the `.env` to the container, so `docker inspect` and `docker exec <container> env` show the worker secret (and the route B key and secret) in plain text to anyone who can use the Docker daemon: on a Mac, your user and any program running as you; on a shared Docker host, every user with Docker access. Removing the container (`docker compose down`) removes that copy; rotating the secret afterwards is the real fix (see [live-checks.md](live-checks.md)).
- **A bare `docker run -p 7817:7817` of the image publishes on every interface.** The image has the wide bind (it must, to be reachable) but not the container marker, so that run is Mock-only and Real is refused; compose is the supported way to run it, with a `127.0.0.1`-only publish.
- **A Real run is real.** Created people and group memberships stay until someone deletes them by hand in PingOne. The audit and the report say what happened, but nothing undoes it.
- **People's usernames are shown** in the results table and in the report download (addresses are masked to the first letter and the domain). A downloaded report is a file on your disk with that data in it.
- **`BULK_CONSOLE_INSECURE_TLS=1` turns off certificate checking** for the console connection, for the local desktop console's self-signed certificate. Leave it empty for a cloud console.
- **The SSRF screen is for literals.** A console name that resolves to a private address is not caught (the doctor says so); the netguard permits only the one name you typed.
- **Route B and every Real behaviour are UNVERIFIED.** Nothing in Real was run while this lab was built. See [references.md](references.md).
- **The shared TopMenu stylesheet is vendored as it is.** `web/src/top-menu/top-menu.css` contains a `prefers-color-scheme` rule, so the family `check-css.sh` reports one FAIL for it in this lab, as it does in the other labs. The file is the canonical shared component (rule 22): it is never hand-edited here, and the app's own `app.css` passes the CSS standard (`scripts/repo.test.mjs :: app CSS follows the CSS standard: tokens only, no dark-mode media query, no forced priority, no italics, breakpoints 600 and 900 only, no purple, shared stylesheet first`).
- **The vendored JsonView is a copy.** `web/src/json/JsonView.jsx` is vendored from `AI-DEMO-Standalone/shared/json`, byte for byte, with a sha256 pin; it is never edited here. Re-vendor it when the canonical changes (copy the file, regenerate the pin); the pin test fails on any hand edit.
