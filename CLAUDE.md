# CLAUDE.md

Privilege Bulk Users LAB (Tier: Tester, port 7817, catalog id not assigned yet). Shows how to register many people for PingOne Privilege by API: a Guide page teaches two routes (A: the PingOne Management API, create in Privilege's environment and add to the Privilege group; B: the Privilege console API, `POST /v1/users`, UNVERIFIED), and a Run page plans, applies and verifies a bulk registration against an in-process Mock world (six scenarios) or, owner-run, against real environments. A fork of privilege-api-explorer-LAB (no connections store, no catalog explorer). Details: [README.md](README.md), [docs/architecture.md](docs/architecture.md), [docs/security.md](docs/security.md), [docs/api.md](docs/api.md). Presenter script: [docs/talk-track.md](docs/talk-track.md). Owner checklist for the first Real run: [docs/live-checks.md](docs/live-checks.md).

## Commands (from package.json)

```bash
npm ci
npm test               # server (node --test test/*.test.js) + web (vitest) + scripts/*.test.mjs
npm run build          # builds web/dist, served by the server itself
npm start              # http://127.0.0.1:7817/  (PORT to change, 7800-7999; declared ports: 7817 app, 7998 e2e, 7999 Vite)
npm run dev            # API with --watch, Vite on VITE_PORT (7999)
npm run doctor         # node 26, mode, data dir, bind, port range, diagrams, settings names, netguard self-test, free port
npm run reset          # POST /api/reset on the running app
npm run smoke          # both routes end to end against the running app (Mock), then Reset
npm run verify-running # by content: guards, back-off, Missing role warning; add -- <url> --container <name>
npm run e2e            # headless Chromium on 7998; build first (E2E_CHROMIUM=<binary> if the Playwright build is missing)
npm run content-pack   # regenerates and validates content-pack.json (do not hand-edit it)
npm run talk-track     # regenerates docs/talk-track.md (a test fails on drift)
```

Docker (OrbStack, never Docker Desktop): `HOST_PORT=7817 docker compose up --build -d` (publishes `127.0.0.1:` only, `restart: unless-stopped`, an optional `.env` beside the compose file). Node 26 only. Heavy runs (tests, builds) go to the Air with `air-test`; `git add -A` first.

## Rules that bite here

- **Mock / Real toggle in the header on every page**, the mode shown (`Mode: mock|real`) and the banner saying the same mode, presenter mode included. **Real is refused** unless `PRIVILEGE_BULK_MODE=real` is in the lab's own `.env` (or the environment) and the bind is loopback (a non-loopback `PBU_BIND` counts only with `PBU_CONTAINER=1`, which only `docker-compose.yml` sets, beside its `127.0.0.1` publish; the image bakes the wide bind but NOT the marker, so a bare `docker run` refuses Real; `scripts/compose.test.mjs` pins it): `server/src/config.js` guards, `GET /api/info`, 409 `real_not_available` on the toggle, 403 `real_refused` on a Real plan or apply. Nothing in the repo (compose, Dockerfile, CI) sets the mode. Never read a bare `MODE`, never `process.env.MODE`.
- **The two-step gate.** Apply needs a fresh plan (15 minutes, not used, same mode), `confirm` exactly `REGISTER <toApply>`, every blocking warning acknowledged, and in Real the Writes switch (`server/src/jobs.js`). Do not add a path that writes without all of them.
- **This lab never deletes.** No DELETE call anywhere; rollback is the owner's, by hand (docs/live-checks.md).
- **Settings are the lab's own `.env`**, beside `docker-compose.yml` (mode 600, git-ignored, not in the image). Only the names in `SETTING_KEYS` (`server/src/settings.js`) are read, through `util.parseEnv`. `.env.example` lists exactly those names, no values; docs/api.md's settings block lists them too; a test pins both. Compose reads the file through an optional `env_file` (`required: false`), so Mock needs none. Never `~/Documents`, never another app's file.
- **Secrets are write-only.** The worker secret, the console API key and secret are never returned, logged or audited (`redact.js` scrubs every error). `routeReadiness` and the doctor name settings, never values.
- **Zero outbound in Mock; a permit per job in Real.** `server/src/netguard.js` (installed by `index.js`) refuses every non-loopback socket, DNS lookup, fetch, UDP send and UDP connect; a Real job holds a permit for the PingOne hosts of its region and, route B, the one console origin (`urls.js` `liveHosts`, `context.js`), released when it ends. Mock runs behind an injected fetch: no socket opens.
- **Loopback only.** Bind `127.0.0.1`; keep the Host check and the same-origin write check (`security.js`) in front of every route. Docker publishes `127.0.0.1:` only.
- **Honest claims.** Product claims come from `docs/references.md` or are labelled UNVERIFIED (the Guide's list is compared with that file by a test). Route B and everything Real are UNVERIFIED. The Mock people are an illustrative sample, not a recording.
- **CSS standard.** `web/src/styles/standalone-ui.css` is vendored byte-for-byte from `~/Development/AI-DEMO-Standalone/shared/standalone-ui.css` (never edit it; `bash scripts/check-ui-standard.sh --pin` after a re-vendor) and loads before `app.css`. App CSS: tokens only, no colour literals, no `prefers-color-scheme`, no `!important`, no italics, breakpoints 600/900 only. The vendored TopMenu, JsonView, floating dialog and return link each have a `.sha256` pin and are never hand-edited (the family `check-css.sh` reports one FAIL for the vendored top-menu.css, same as other labs).
- **No identifiers from other projects.** Fixtures use `.example` / `.invalid` hosts, made-up people and the synthetic ids in `server/src/mockWorld.js` and `11111111-2222-4333-8444-5555555555NN`. The forbidden-strings scan must print 0. Never print or copy the forbidden list. No trace of the fork source's name, port, catalog id or env names (a test scans the repo).
- **No AI attribution** in any file, commit message or PR body (`scripts/check-no-ai-attribution.sh`, a test, and CI).
- **Test scripts use globs, never directories** (`node --test test/*.test.js`). Never parse `node:test` stdout: use the exit code. No `crypto.generateKeyPairSync('ec')`.
- **Diagrams are diagram-studio/1 data** (rule 17): `server/diagrams/route-a.json` and `route-b.json`, validated at startup, served by name, fetched by name in `web/src/pages/Diagram.jsx`. The Dockerfile must `COPY server/diagrams`.
- No k8s manifests, no SE build, no hosted mode (deferred by the owner, 2026-10-31); a repo test pins that.

## Where the safety claims are pinned

- `server/test/engine.test.js`: the plan equals the Mock world's ground truth in every scenario; apply registers everyone it can; verify finds nothing left; the missing-role trap.
- `server/test/gate.test.js`, `jobs.test.js`, `http.test.js`: the two-step gate, abort, circuit breaker, CSV safety, the shared 429 back-off.
- `server/test/mode.test.js`, `real.test.js`, `runtimeguard.test.js`, `netguard.test.js`, `settings.test.js`: Real refused, the guards, permits per job, zero outbound, names-only settings.
- `server/test/labproxy.test.js`, `repo-scan.test.js`, `diagrams.test.js`: Host names, no stray identifier, diagram data.
- `web/src/**/*.test.jsx`: the toggle and banner on every page, the Run page's gate, inert server text, the Guide's placeholders and UNVERIFIED list.
- `scripts/repo.test.mjs`: README standard, no fork trace, CSS standard, vendored pins, CI, no k8s/MODE/EC keygen, Real stays an opt-in. `compose.test.mjs`: loopback-only publish, hardening, optional env_file. `docs.test.mjs`: docs match the code (routes, codes, scenarios, settings names, ports). `shelf-entry.test.mjs`, `content-pack.test.mjs`, `talk-track.test.mjs`. `scripts.test.mjs`: smoke, verify-running, reset and doctor run against a live app.

## Shelf and content pack

- Edit `content/terms.json` or the cards in `scripts/build-content-pack.mjs`, then `npm run content-pack`. No catalog id is assigned yet: the README says `Catalog: none yet (owner assigns with the board row)`, `docs/shelf-entry.json` has no `catalogId`, and the pack carries the schema-required placeholder `D000`; a test pins all three. When the owner assigns one, change all three together.
- The shelf entry is `docs/shelf-entry.json` (port 7817, relative `composeFile`); `scripts/lib/shelf-registry-rules.mjs` is a copy of the shelf's rules.
- Run check-drift, check-css and conformance by hand: `bash ~/Development/AI-DEMO-Standalone/scripts/check-drift.sh .`, `bash ~/Development/AI-DEMO-Standalone/scripts/check-css.sh .`, `node ~/Development/demo-kit-base/scripts/conformance.mjs . --new`.
