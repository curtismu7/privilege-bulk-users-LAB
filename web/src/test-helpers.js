import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { vi } from "vitest";

// The real diagram-studio/1 files the server serves, so the web tests render the same data the app does.
const DIAGRAMS = Object.fromEntries(["route-a", "route-b"].map((n) => [n, JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "server", "diagrams", `${n}.json`), "utf8"))]));
export const DIAGRAM_DOCS = DIAGRAMS;

export const SCENARIOS = [
  { id: "realistic", label: "Realistic", description: "A few conflicts, a few invalid records, some rate limiting." },
  { id: "clean", label: "Clean", description: "Nothing goes wrong." },
  { id: "rate-limited", label: "Rate-limited", description: "The service answers 429 with Retry-After." },
];

// GET /api/info for a given server mode. `over` is merged on top (routes, writesEnabled, ...).
export function infoFor(mode = "mock", realAvailable = false, over = {}) {
  return {
    mode, source: mode, realAvailable, realReason: realAvailable ? null : "Real is refused: owner-opt-in. Set PRIVILEGE_BULK_MODE=real in this lab's own .env.",
    real: { available: realAvailable, failed: realAvailable ? [] : ["owner-opt-in"], needs: [] },
    routes: {
      a: { label: "PingOne API: group membership", realReady: realAvailable, missing: realAvailable ? [] : ["BULK_P1_WORKER_CLIENT_ID", "BULK_P1_GROUP"] },
      b: { label: "Privilege console API: POST /v1/users", realReady: realAvailable, missing: realAvailable ? [] : ["BULK_CONSOLE_URL"] },
    },
    writesEnabled: false,
    limits: { maxUsers: 50000, concurrency: { min: 1, max: 16, default: 6 } },
    mock: { scenarios: SCENARIOS, datasets: [100, 500, 5000] },
    ...over,
  };
}

const NOW = "2026-11-14T10:00:00.000Z";
export const HTTP = { calls: 0, retries: 0, rate429: 0, waitedMs: 0, perSec: 0 };
export const PLAN_A = { "create+add": 12, add: 3, "in-sync": 80, conflict: 3, invalid: 2, toApply: 15 };
export const APPLY_A = { created: 12, added: 15, "in-sync": 80, conflict: 3, invalid: 2, failed: 0, pending: 0 };
// A Job as docs/api.md shapes it. A finished plan by default.
export const job = (over = {}) => ({
  id: "job-1", kind: "plan", route: "a", source: "mock", state: "done", phase: "finished", startedAt: NOW, updatedAt: NOW, finishedAt: NOW,
  total: 100, processed: 100, counts: PLAN_A, http: { ...HTTP, calls: 120, perSec: 30 }, warnings: [], planId: "plan-1", scenario: "realistic", users: 100, concurrency: 6, timeScale: 1, error: null, ...over,
});
export const applyJob = (over = {}) => job({ id: "job-2", kind: "apply", counts: APPLY_A, planId: null, ...over });

// n rows, statuses cycling through `statuses`. Emails are masked the way the server masks them.
export const makeRows = (n, statuses = ["create+add", "add", "in-sync", "conflict", "invalid"]) => Array.from({ length: n }, (_, i) => ({
  n: i + 1, username: `person${i + 1}.example`, email: `p***@people.example`, status: statuses[i % statuses.length], detail: `detail for ${i + 1}`, httpStatus: i % 2 ? 201 : null, attempts: 1,
}));

// A /api/jobs/current/results handler over an in-memory list: it filters by status and pages like the server does.
export function resultsOf(rows) {
  return (_b, _s, json, url) => {
    const q = new URL(url, "http://x").searchParams;
    const status = q.get("status") || ""; const offset = Number(q.get("offset") || 0); const limit = Number(q.get("limit") || 100);
    const tally = new Map(); // a Map and fromEntries, so a status named "__proto__" is an own key, as it is in the server's JSON
    for (const r of rows) tally.set(r.status, (tally.get(r.status) || 0) + 1);
    const statuses = Object.fromEntries(tally);
    const hit = status ? rows.filter((r) => r.status === status) : rows;
    return json(200, { total: hit.length, offset, limit, statuses, rows: hit.slice(offset, offset + limit) });
  };
}

// A tiny fake of this app's API. `calls` records every request; handlers (keyed "METHOD /path", query stripped) take
// (body, state, json, url) and can be overridden per test. state.job is what GET /api/jobs/current answers.
export function fakeApi({ info, realAvailable = false, audit = [], handlers = {}, job: first = null } = {}) {
  const state = { calls: [], audit, job: first, mode: info?.source ?? "mock", writes: false, count: (method, path) => state.calls.filter((c) => c.method === method && c.url.replace(/\?.*$/, "") === path).length };
  const json = (status, body) => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });
  globalThis.fetch = vi.fn((url, init = {}) => {
    const method = init.method || "GET"; const body = init.body ? JSON.parse(init.body) : undefined;
    state.calls.push({ method, url, body });
    const key = `${method} ${url.replace(/\?.*$/, "")}`;
    if (handlers[key]) return handlers[key](body, state, json, url);
    switch (key) {
      case "GET /api/info": return json(200, info && info.source === state.mode ? { ...info, writesEnabled: state.writes } : infoFor(state.mode, realAvailable, { writesEnabled: state.writes }));
      case "POST /api/mode":
        if (body.source === "real" && !realAvailable) return json(409, { error: "real_not_available", message: "Real is refused: owner-opt-in." });
        state.mode = body.source; return json(200, { source: state.mode, realAvailable, realReason: null });
      case "POST /api/reset": state.job = null; state.writes = false; return json(200, { ok: true });
      case "POST /api/writes": state.writes = body.enabled; return json(200, { writesEnabled: state.writes });
      case "GET /api/jobs/current": return json(200, { job: state.job });
      case "GET /api/shelf": return json(200, { shelfUrl: null });
      case "GET /api/audit": return json(200, { entries: state.audit });
      case "GET /api/diagrams": return json(200, { diagrams: Object.values(DIAGRAMS).map((d) => ({ name: d.id, title: d.title })) });
      case "GET /api/diagrams/route-a": return json(200, DIAGRAMS["route-a"]);
      case "GET /api/diagrams/route-b": return json(200, DIAGRAMS["route-b"]);
      default: return json(404, { error: "not_found", message: `unhandled ${key}` });
    }
  });
  return state;
}
