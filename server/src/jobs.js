// The job manager: one job at a time, either a PLAN (reads, decides, writes nothing) or an APPLY (writes, from a plan).
// The rules that make a bulk write safe live here, in one place:
//   - apply needs a fresh plan, the exact typed count, and every blocking warning acknowledged (a plan goes stale after
//     LIMITS.planTtlMs, on Reset, on a mode change, and once an apply has used it: verify by planning again);
//   - a per-person failure is a failed row, never a stopped run; but when too many of the first people fail the run stops on
//     purpose (the circuit breaker), because that is usually one cause (a role, a wrong group) and not N bad people;
//   - an abort lets the calls in flight finish and leaves everyone else `pending`.
import crypto from 'node:crypto';
import { LIMITS } from './config.js';
import { BulkError } from './errors.js';
import { applyA, planA } from './routeA.js';
import { applyB, planB } from './routeB.js';
import { clip, scrub } from './redact.js';

const maskEmail = (e) => { const s = String(e || ''); const at = s.lastIndexOf('@'); return at < 1 ? (s ? '***' : '') : `${s[0]}***${s.slice(at)}`; };
const KNOWN = new Set(['group_missing', 'source_unreadable', 'destination_unreadable', 'token_refused', 'login_required', 'circuit_open', 'aborted', 'needs_setup']);
const refuse = (code, message, status) => new BulkError(code, message, { status });

export function createJobs({ makeContext, now = Date.now, audit = () => {}, newId = () => crypto.randomUUID(), breaker = { minSample: 20, ratio: 0.5, window: 50 }, limits = LIMITS }) {
  let job = null; let plan = null; let running = Promise.resolve();
  const iso = () => new Date(now()).toISOString();
  const touch = (j) => { j.updatedAt = iso(); };

  const view = (j) => {
    if (!j) return null;
    const out = Object.fromEntries(Object.entries(j).filter(([k]) => !k.startsWith('_')));
    const elapsed = Math.max(1, (j.finishedAt ? Date.parse(j.finishedAt) : now()) - Date.parse(j.startedAt)) / 1000;
    const s = j._stats ?? { calls: 0, retries: 0, rate429: 0 };
    out.http = { calls: s.calls, retries: s.retries, rate429: s.rate429, waitedMs: j._gate?.waitedMs() ?? 0, perSec: Math.round((s.calls / elapsed) * 10) / 10 };
    return out;
  };

  function begin({ kind, route, mode, scenario = null, users = null, concurrency }) {
    if (job?.state === 'running') throw refuse('job_running', 'A job is already running. Wait for it, or abort it.', 409);
    job = {
      id: newId(), kind, route, source: mode, state: 'running', phase: 'starting', startedAt: iso(), updatedAt: iso(), finishedAt: null,
      total: null, processed: 0, counts: {}, warnings: [], planId: null, scenario, users, concurrency, timeScale: 1, error: null,
      _ctl: new AbortController(), _tripped: false, _rows: [], _stats: null, _gate: null, _ctx: null,
    };
    return job;
  }
  function finish(j, state, phase = 'finished') {
    j.state = state; j.phase = phase; j.finishedAt = iso(); touch(j);
    try { j._ctx?.release(); } catch { /* permits are best effort */ }
    if (j._reset) return; // Reset cleared the history; a job that was Reset away leaves no late entry behind
    audit({ op: j.kind, route: j.route, mode: j.source, outcome: state, counts: { ...j.counts }, warnings: j.warnings.map((w) => w.code), ...(j.error ? { error: j.error.code } : {}) });
  }
  function fail(j, err) {
    if (j._tripped) {
      j.error = { code: 'circuit_open', message: `Stopped on purpose: ${j._tripBad} of the last ${j._tripOf} people failed. That is usually one cause (a missing role, a wrong group, a refused credential), not that many bad people. Nothing else was started; ${j.counts.pending ?? 0} are still pending.` };
      return finish(j, 'failed', 'stopped');
    }
    if (err?.code === 'aborted' || (j._ctl.signal.aborted && !err?.code)) {
      j.error = { code: 'aborted', message: `Stopped by you. Calls already in flight finished; ${j.counts.pending ?? 0} people are still pending.` };
      return finish(j, 'aborted', 'stopped');
    }
    const secrets = j._ctx?.secrets ?? [];
    const known = KNOWN.has(err?.code);
    j.error = { code: known ? err.code : 'internal_error', message: known ? clip(scrub(err.message, secrets), 400) : 'internal error' }; // scrub first, clip after: a clip must not leave a prefix of a secret
    return finish(j, 'failed', 'stopped');
  }
  function attach(j, ctx) { j._ctx = ctx; j._stats = ctx.stats; j._gate = ctx.gate; j.timeScale = ctx.timeScale; }
  const rowOf = (d, status) => ({ n: d.n, username: d.person.username, email: maskEmail(d.person.email), status, detail: d.detail, httpStatus: null, attempts: 0 });

  function startPlan({ route, mode, params = {}, concurrency }) {
    const j = begin({ kind: 'plan', route, mode, scenario: mode === 'mock' ? params.scenario ?? null : null, users: mode === 'mock' ? params.users ?? null : null, concurrency });
    plan = null; // starting a plan retires the previous one: a failed or aborted re-plan must not leave an older plan applicable
    running = (async () => {
      const progress = {
        phase: (p) => { j.phase = p; touch(j); }, total: (n) => { j.total = n; j.processed = 0; touch(j); }, processed: (n) => { j.processed = n; touch(j); },
      };
      try {
        const ctx = await makeContext({ mode, route, params, signal: j._ctl.signal }); attach(j, ctx);
        const args = { p1: ctx.p1, con: ctx.con, sourceEnvId: ctx.sourceEnvId, privilegeEnvId: ctx.privilegeEnvId, group: ctx.group, concurrency, signal: j._ctl.signal, limits, progress };
        const out = await (route === 'a' ? planA(args) : planB(args));
        // The pool stops quietly when the signal is aborted, so a partial plan can come back looking finished. Never accept one.
        if (j._ctl.signal.aborted) throw new BulkError('aborted', 'aborted');
        j._rows = out.decisions.map((d) => rowOf(d, d.action));
        j.counts = out.counts; j.warnings = out.warnings; j.total = j.processed = out.decisions.length; j.planId = newId();
        plan = { planId: j.planId, route, mode, at: now(), scenario: j.scenario, users: j.users, concurrency, decisions: out.decisions, counts: out.counts, meta: out.meta, warnings: out.warnings };
        finish(j, 'done');
      } catch (err) { fail(j, err); }
    })();
    return view(j);
  }

  // `concurrency` defaults to the PLAN's: the Concurrency box on the page is one throttle for the whole run, reads and writes alike.
  function startApply({ planId, confirm, acknowledge = [], mode, writesEnabled, concurrency }) {
    if (job?.state === 'running') throw refuse('job_running', 'A job is already running. Wait for it, or abort it.', 409);
    if (!plan || plan.planId !== planId) throw refuse('no_plan', 'There is no finished plan with that id. Press Plan first.', 409);
    if (now() - plan.at > limits.planTtlMs || plan.mode !== mode) throw refuse('stale_plan', 'That plan is out of date (too old, or the mode changed). Plan again.', 409);
    const n = plan.counts.toApply;
    if (n === 0) throw refuse('nothing_to_do', 'The plan finds nothing to change. Nothing was written.', 409);
    if (confirm !== `REGISTER ${n}`) throw refuse('confirm_required', `Type exactly "REGISTER ${n}" to confirm that ${n} people will be changed.`, 400);
    const missing = plan.warnings.filter((w) => w.blocking && !acknowledge.includes(w.code));
    if (missing.length) throw refuse('warnings_unacknowledged', `Acknowledge ${missing.map((w) => w.code).join(', ')} first: ${missing[0].message}`, 409);
    if (mode === 'real' && !writesEnabled) throw refuse('writes_disabled', 'Writes are off. Turn the writes switch on, then apply.', 403);

    const route = plan.route; const p = plan;
    concurrency ??= p.concurrency;
    const j = begin({ kind: 'apply', route, mode, scenario: p.scenario, users: p.users, concurrency });
    j._rows = p.decisions.map((d) => rowOf(d, d.action === 'create+add' || d.action === 'add' || d.action === 'create' ? 'pending' : d.action));
    j.warnings = p.warnings; j.total = p.decisions.length; j._recent = []; j._recentBad = 0;
    j.counts = route === 'a'
      ? { created: 0, added: 0, 'in-sync': p.counts['in-sync'], conflict: p.counts.conflict, invalid: p.counts.invalid, failed: 0, pending: n }
      : { created: 0, exists: p.counts.exists, conflict: p.counts.conflict, invalid: p.counts.invalid, failed: 0, pending: n };
    j.processed = j.total - n;
    audit({ op: 'apply-start', route, mode, toApply: n });
    plan = null; // an apply uses its plan up: verify by planning again
    running = (async () => {
      try {
        const ctx = await makeContext({ mode, route, params: {}, signal: j._ctl.signal }); attach(j, ctx);
        j.phase = 'applying'; touch(j);
        const onResult = (d, res) => {
          const row = j._rows[d.n - 1];
          if (row.status !== 'pending') return;
          Object.assign(row, { status: res.status, detail: res.detail, httpStatus: res.httpStatus ?? null, attempts: res.attempts ?? 0 });
          j.counts.pending--; j.counts[res.status] = (j.counts[res.status] || 0) + 1; j.processed++;
          // The breaker looks at the most recent results (a window), not the whole run: a long run that breaks half way must stop promptly.
          j._recent.push(res.unexpected ? 1 : 0); j._recentBad += res.unexpected ? 1 : 0;
          if (j._recent.length > (breaker.window ?? 50)) j._recentBad -= j._recent.shift();
          touch(j);
          // A stop by the user that came first wins: results still arriving from calls in flight do not turn it into a trip.
          if (!j._tripped && !j._ctl.signal.aborted && j._recent.length >= breaker.minSample && j._recentBad / j._recent.length > breaker.ratio) {
            j._tripped = true; j._tripBad = j._recentBad; j._tripOf = j._recent.length; j._ctl.abort();
          }
        };
        const common = { concurrency, signal: j._ctl.signal, onResult, secrets: ctx.secrets, plan: p };
        await (route === 'a' ? applyA({ ...common, p1: ctx.p1, gate: ctx.gate, privilegeEnvId: ctx.privilegeEnvId }) : applyB({ ...common, con: ctx.con }));
        if (j._tripped || j._ctl.signal.aborted) fail(j, new BulkError('aborted', 'aborted')); else finish(j, 'done');
      } catch (err) { fail(j, err); }
    })();
    return view(j);
  }

  function abort() {
    if (!job || job.state !== 'running') throw refuse('no_job', 'No job is running.', 409);
    job._ctl.abort();
    return view(job);
  }
  function results({ status, offset = 0, limit = 100 } = {}) {
    const rows = job?._rows ?? [];
    const statuses = {}; for (const r of rows) statuses[r.status] = (statuses[r.status] || 0) + 1;
    const filtered = status ? rows.filter((r) => r.status === status) : rows;
    return { total: filtered.length, offset, limit, statuses, rows: filtered.slice(offset, offset + limit) };
  }
  const csvCell = (v) => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  function report(format) {
    if (!job || job.state === 'running') return null;
    if (format === 'csv') {
      // The mode is in the filename AND in every row, so a Mock result cannot be mistaken for a Real one once it leaves the page.
      const head = 'n,username,email,status,detail,httpStatus,attempts,source';
      return { type: 'text/csv; charset=utf-8', name: `bulk-users-${job.source}-${job.kind}-${job.route}.csv`, body: [head, ...job._rows.map((r) => [r.n, r.username, r.email, r.status, r.detail, r.httpStatus ?? '', r.attempts, job.source].map(csvCell).join(','))].join('\n') + '\n' };
    }
    return { type: 'application/json; charset=utf-8', name: `bulk-users-${job.source}-${job.kind}-${job.route}.json`, body: JSON.stringify({ schema: 'bulk-users-report/1', job: view(job), rows: job._rows }, null, 2) };
  }
  // Reset: abort a running job and WAIT for it to drain (its calls in flight finish; it leaves no audit entry), then forget the job and its plan.
  async function reset() {
    const j = job;
    if (j?.state === 'running') { j._reset = true; j._ctl.abort(); try { await running; } catch { /* the job reports its own end */ } }
    job = null; plan = null;
  }
  const invalidatePlan = () => { plan = null; }; // a mode change retires the plan for good: flipping back must not revive it

  return { startPlan, startApply, abort, results, report, reset, invalidatePlan, current: () => view(job), whenIdle: () => running, hasPlan: () => Boolean(plan) };
}
