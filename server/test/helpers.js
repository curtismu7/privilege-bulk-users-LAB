import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { startHttpServer } from '../src/index.js';

export const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'privilege-bulk-users-test-'));
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The app on an ephemeral loopback port. No real .env is read (BULK_ENV_FILE points at nothing), no mock latency unless asked.
export async function startApp({ env = {}, dir = tmpDir(), now, jobOptions, mockLatencyMs = 0 } = {}) {
  const app = createApp({ env: { PBU_DATA_DIR: dir, BULK_ENV_FILE: path.join(dir, 'none.env'), ...env }, now, jobOptions, mockLatencyMs });
  const srv = await startHttpServer({ port: 0, host: '127.0.0.1', app });
  const origin = `http://127.0.0.1:${srv.port}`;
  async function call(method, p, body, { headers = {}, origin: o = origin } = {}) {
    const h = { ...headers };
    if (o && method !== 'GET') h.Origin = o;
    if (body !== undefined) h['Content-Type'] = 'application/json';
    const res = await fetch(`${origin}${p}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, json, text, headers: res.headers };
  }
  const s = { ...srv, origin, dir, call, app, close: async () => { await srv.close(); } };
  // Wait for the current job to leave `running`; returns the job.
  s.settle = async (timeoutMs = 60_000) => {
    const t0 = Date.now();
    for (;;) {
      const { json } = await call('GET', '/api/jobs/current');
      if (json?.job && json.job.state !== 'running') return json.job;
      if (Date.now() - t0 > timeoutMs) throw new Error(`job did not finish in ${timeoutMs} ms: ${JSON.stringify(json?.job)?.slice(0, 300)}`);
      await sleep(5);
    }
  };
  s.plan = async (body) => { const r = await call('POST', '/api/plan', body); if (r.status !== 202) throw new Error(`plan refused: ${r.status} ${r.text}`); return s.settle(); };
  s.apply = async (job, extra = {}) => { const r = await call('POST', '/api/apply', { planId: job.planId, confirm: `REGISTER ${job.counts.toApply}`, ...extra }); if (r.status !== 202) throw new Error(`apply refused: ${r.status} ${r.text}`); return s.settle(); };
  return s;
}

// Everything in a plan's counts except toApply, for comparing with the mock world's ground truth.
export const withoutTotal = ({ toApply, ...c }) => c;
