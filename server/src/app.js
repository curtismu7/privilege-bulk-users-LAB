import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { MODES, MODE_KEY, LIMITS, dataDir as cfgDataDir, realRefusal, modeFrom, webDist } from './config.js';
import { buildContext } from './context.js';
import { createDiagrams, DIAGRAM_DIR } from './diagrams.js';
import { createHealth } from './health.js';
import { createJobs } from './jobs.js';
import { DATASETS, SCENARIOS, createMockWorld } from './mockWorld.js';
import { hostCheck, labAllowedHosts, sameOriginWrites } from './security.js';
import { realConfig, routeReadiness } from './settings.js';
import { shelfInfo } from './shelfLink.js';

const ROUTES = { a: 'PingOne API: group membership', b: 'Privilege console API: POST /v1/users' };
const SCENARIO_IDS = SCENARIOS.map((s) => s.id);
const STATUS = { job_running: 409, no_job: 409, needs_setup: 409 };

export function createApp({ env = process.env, lab = labAllowedHosts(env), now = Date.now, diagramsDir = DIAGRAM_DIR, jobOptions = {}, mockLatencyMs = Number(env.PBU_MOCK_LATENCY_MS ?? 1) } = {}) {
  const diagrams = createDiagrams({ dir: diagramsDir }); // diagram-studio/1 data, validated now: an invalid file stops the app from starting
  const dir = cfgDataDir(env);
  const audit = createAudit({ dir, now });
  const health = createHealth({ env });
  const realGate = realRefusal(env); // Real is refused unless every guard in config.js passes
  const refuseReal = (res) => res.status(403).json({ error: 'real_refused', message: `Real is refused: ${realGate.failed.join(', ')}. ${realGate.needs.join(' ')}`, failed: realGate.failed, needs: realGate.needs });

  let runMode = modeFrom(env) === 'real' && !realGate ? 'real' : 'mock'; // 'mock' | 'real'; a refused Real never starts as real
  let writesEnabled = false; // the Real writes switch: off by default, off again on Reset
  let mockWorld = null; let mockKey = '';
  // The mock world persists between Plan, Apply and Verify while scenario and users stay the same. Reset, or changing either, starts a fresh one.
  const worldFor = ({ scenario, users } = {}) => {
    if (scenario === undefined && mockWorld) return mockWorld;
    const s = scenario ?? 'realistic'; const u = users ?? 500; const key = `${s}:${u}`;
    if (!mockWorld || key !== mockKey) { mockWorld = createMockWorld({ scenario: s, users: u, latencyMs: mockLatencyMs, now }); mockKey = key; }
    return mockWorld;
  };
  const jobs = createJobs({
    now, audit: (e) => audit.record(e), ...jobOptions,
    makeContext: ({ mode, route, params, signal }) => buildContext({ mode, route, env, world: mode === 'mock' ? worldFor(params) : null, signal }),
  });

  const sendErr = (res, err) => {
    const code = err?.code && typeof err.code === 'string' ? err.code : 'internal_error';
    const status = err?.status || STATUS[code] || (code === 'internal_error' ? 500 : 400);
    return res.status(status).json({ error: code, message: status === 500 ? 'internal error' : String(err.message).slice(0, 400) });
  };

  const app = express();
  app.disable('x-powered-by');
  // Response headers: the page never needs to be framed, sniffed or to send a referrer, and loads only its own files.
  app.use((_req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    });
    next();
  });
  app.use(hostCheck(env));
  app.use(sameOriginWrites(lab));
  app.use(express.json({ limit: '20kb' }));
  app.use('/api/health', health.router);

  // ---- mode: the header toggle. Rule 19: server-side Mock/Real. Real is only available when every guard passes.
  const modeView = () => ({
    source: runMode === 'real' ? 'real' : 'mock', realAvailable: !realGate,
    realReason: realGate ? `Real is refused: ${realGate.failed.join(', ')}. ${realGate.needs.join(' ')}` : null,
  });
  app.post('/api/mode', (req, res) => {
    const source = req.body?.source;
    if (Object.keys(req.body ?? {}).length !== 1 || (source !== 'mock' && source !== 'real')) return res.status(400).json({ error: 'bad_request', message: 'source must be exactly "mock" or "real"' });
    if (source === 'real' && realGate) return res.status(409).json({ error: 'real_not_available', message: modeView().realReason });
    if (jobs.current()?.state === 'running') return res.status(409).json({ error: 'job_running', message: 'A job is running. Wait for it or abort it before switching mode.' });
    if (source !== runMode) { writesEnabled = false; jobs.invalidatePlan(); } // a plan made in one mode is never valid in another, even after flipping back
    runMode = source;
    return res.json(modeView());
  });
  app.get('/api/info', (_req, res) => {
    res.set('Cache-Control', 'no-store');
    const ready = routeReadiness(env);
    res.json({
      mode: runMode, ...modeView(), modes: [...MODES], key: MODE_KEY, requested: modeFrom(env),
      real: { available: !realGate, failed: realGate?.failed ?? [], needs: realGate?.needs ?? [] },
      routes: Object.fromEntries(Object.entries(ROUTES).map(([r, label]) => [r, { label, ...ready[r] }])),
      writesEnabled,
      limits: { maxUsers: LIMITS.maxUsers, concurrency: { ...LIMITS.concurrency } },
      mock: { scenarios: SCENARIOS, datasets: [...DATASETS] },
    });
  });

  // Reset: the job, its plan, the audit history, the Mock world and the writes switch all go back to the start.
  app.post('/api/reset', async (_req, res) => {
    await jobs.reset(); // wait for a running job to drain first, so it cannot write a late audit entry or revive a plan
    audit.clear(); const was = writesEnabled; writesEnabled = false; mockWorld = null; mockKey = '';
    health.refresh();
    res.json({ ok: true, cleared: ['job and plan', 'audit history', 'mock world'], writesTurnedOff: was });
  });

  // ---- diagrams: diagram-studio/1 data served by name from a fixed allow-list. An unknown name is a JSON 404 that does not echo the input.
  app.get('/api/diagrams', (_req, res) => { res.set('Cache-Control', 'no-store'); res.json({ diagrams: diagrams.list() }); });
  app.get('/api/diagrams/:name', (req, res) => {
    const doc = diagrams.get(req.params.name);
    if (!doc) return res.status(404).json({ error: 'unknown_diagram', message: 'No such diagram.' });
    res.set('Cache-Control', 'no-store');
    return res.json(doc);
  });

  // ---- jobs
  const intIn = (v, lo, hi, fallback) => { if (v === undefined) return fallback; return Number.isInteger(v) && v >= lo && v <= hi ? v : null; };
  app.post('/api/plan', (req, res) => {
    const b = req.body && typeof req.body === 'object' ? req.body : {};
    if (b.route !== 'a' && b.route !== 'b') return res.status(400).json({ error: 'bad_request', message: 'route must be "a" or "b"' });
    const c = LIMITS.concurrency;
    const concurrency = intIn(b.concurrency, c.min, c.max, c.default);
    if (concurrency === null) return res.status(400).json({ error: 'bad_request', message: `concurrency must be a whole number from ${c.min} to ${c.max}` });
    const params = {};
    if (runMode === 'real') {
      if (realGate) return refuseReal(res);
      if (b.scenario !== undefined || b.users !== undefined) return res.status(400).json({ error: 'bad_request', message: 'scenario and users are Mock-only; Real plans from your own environments' });
      try { realConfig(env, b.route); } catch (err) { return sendErr(res, err); }
    } else {
      params.scenario = b.scenario ?? 'realistic'; params.users = b.users ?? 500;
      if (!SCENARIO_IDS.includes(params.scenario)) return res.status(400).json({ error: 'bad_request', message: `scenario must be one of ${SCENARIO_IDS.join(', ')}` });
      if (!DATASETS.includes(params.users)) return res.status(400).json({ error: 'bad_request', message: `users must be one of ${DATASETS.join(', ')}` });
    }
    try { return res.status(202).json({ job: jobs.startPlan({ route: b.route, mode: runMode, params, concurrency }) }); } catch (err) { return sendErr(res, err); }
  });
  app.post('/api/apply', (req, res) => {
    const b = req.body && typeof req.body === 'object' ? req.body : {};
    if (runMode === 'real' && realGate) return refuseReal(res);
    for (const k of ['planId', 'confirm']) if (b[k] !== undefined && typeof b[k] !== 'string') return res.status(400).json({ error: 'bad_request', message: `${k} must be a string` });
    const ack = Array.isArray(b.acknowledgeWarnings) ? b.acknowledgeWarnings.filter((x) => typeof x === 'string').slice(0, 10) : [];
    try {
      // Both must be real strings: String([x]) === x would let a one-element array pass the gate.
      return res.status(202).json({ job: jobs.startApply({ planId: typeof b.planId === 'string' ? b.planId : '', confirm: typeof b.confirm === 'string' ? b.confirm : '', acknowledge: ack, mode: runMode, writesEnabled }) });
    } catch (err) { return sendErr(res, err); }
  });
  app.post('/api/writes', (req, res) => {
    if (runMode !== 'real') return res.status(409).json({ error: 'mock_only', message: 'The writes switch is for Real. Mock always writes to the in-process mock.' });
    if (realGate) return refuseReal(res);
    if (typeof req.body?.enabled !== 'boolean') return res.status(400).json({ error: 'bad_request', message: 'enabled must be true or false' });
    writesEnabled = req.body.enabled;
    audit.record({ op: 'writes', mode: 'real', outcome: writesEnabled ? 'on' : 'off' });
    return res.json({ writesEnabled });
  });
  app.get('/api/jobs/current', (_req, res) => { res.set('Cache-Control', 'no-store'); res.json({ job: jobs.current() }); });
  app.post('/api/jobs/current/abort', (_req, res) => { try { res.json({ job: jobs.abort() }); } catch (err) { sendErr(res, err); } });
  app.get('/api/jobs/current/results', (req, res) => {
    res.set('Cache-Control', 'no-store');
    const int = (v, d, lo, hi) => { const n = Number(v ?? d); return Number.isInteger(n) ? Math.min(Math.max(n, lo), hi) : d; };
    res.json(jobs.results({ status: typeof req.query.status === 'string' && req.query.status ? req.query.status.slice(0, 40) : undefined, offset: int(req.query.offset, 0, 0, 1e9), limit: int(req.query.limit, 100, 1, 500) }));
  });
  app.get('/api/report', (req, res) => {
    const format = req.query.format ?? 'json';
    if (format !== 'json' && format !== 'csv') return res.status(400).json({ error: 'bad_request', message: 'format must be json or csv' });
    const out = jobs.report(format);
    if (!out) return res.status(404).json({ error: 'no_report', message: 'There is no finished job to report on.' });
    res.set({ 'Content-Type': out.type, 'Content-Disposition': `attachment; filename="${out.name}"`, 'Cache-Control': 'no-store' });
    return res.send(out.body);
  });

  app.get('/api/audit', (_req, res) => res.json({ entries: audit.recent() }));
  app.get('/api/shelf', (_req, res) => { res.set('Cache-Control', 'no-store'); res.json(shelfInfo()); }); // the header "Shelf" button

  if (fs.existsSync(webDist)) { app.use(express.static(webDist)); app.get('*', (req, res, next) => (req.path.startsWith('/api/') ? next() : res.sendFile('index.html', { root: webDist }))); }
  app.use((_req, res) => res.status(404).json({ error: 'not_found' }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'too_large', message: 'request too large' });
    if (err instanceof SyntaxError) return res.status(400).json({ error: 'bad_request', message: 'invalid JSON' });
    if (err instanceof URIError) return res.status(400).json({ error: 'bad_request', message: 'bad address' }); // a malformed %-escape in a path (Express reports it as a URIError)
    return res.status(500).json({ error: 'internal_error', message: 'internal error' });
  });

  app.locals.jobs = jobs; app.locals.audit = audit;
  app.locals.mockWorld = () => mockWorld;
  app.locals.close = async () => { await jobs.reset(); health.stop(); };
  return app;
}

// History: one summary line per plan, apply, abort or writes switch, in memory and on disk (mode 600 file). Counts only: never a
// person's email or a credential.
function createAudit({ dir: d, now }) {
  const file = path.join(d, 'audit.jsonl');
  const recent = [];
  try { for (const line of fs.readFileSync(file, 'utf8').split('\n').slice(-500)) { if (!line.trim()) continue; try { recent.push(JSON.parse(line)); } catch { /* skip */ } } } catch { /* none yet */ }
  const persist = (e) => { try { fs.mkdirSync(d, { recursive: true, mode: 0o700 }); fs.appendFileSync(file, `${JSON.stringify(e)}\n`, { mode: 0o600 }); } catch { /* best effort */ } };
  return {
    recent: () => recent.slice(-200).reverse(),
    record(e) { const full = { ...e, at: new Date(now()).toISOString() }; recent.push(full); if (recent.length > 500) recent.splice(0, recent.length - 500); persist(full); },
    clear() { recent.length = 0; try { fs.rmSync(file, { force: true }); } catch { /* best effort */ } },
  };
}
