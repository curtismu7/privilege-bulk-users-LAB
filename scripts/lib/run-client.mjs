// A small client for the scripts that drive a RUNNING app over its API (smoke.mjs, verify-running.mjs). Loopback only: it refuses any other host.
// Writes carry the same-origin header the server requires. Prints one PASS or FAIL line per check; the caller exits on failures().
import { isLoopbackHost } from '../../server/src/security.js';

export const defaultBase = () => `http://127.0.0.1:${process.env.PORT || 7817}`;

export function connect(arg) {
  const base = new URL(arg || defaultBase());
  if (!isLoopbackHost(base.hostname)) throw new Error(`refusing ${base.hostname}: loopback only`);
  let failed = 0;
  const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) failed += 1; return ok; };
  const send = async (method, p, body, headers = {}) => {
    const r = await fetch(new URL(p, base), {
      method,
      headers: { ...(method === 'GET' ? {} : { origin: base.origin }), ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: r.status, json, text, headers: r.headers };
  };
  // Wait until the current job is no longer running (a job is one plan or one apply). Returns the finished job.
  const settle = async (timeoutMs = 120_000) => {
    const t0 = Date.now();
    for (;;) {
      const { json } = await send('GET', '/api/jobs/current');
      if (json?.job && json.job.state !== 'running') return json.job;
      if (Date.now() - t0 > timeoutMs) throw new Error(`the job did not finish within ${timeoutMs / 1000} s`);
      await new Promise((r) => setTimeout(r, 100));
    }
  };
  const start = async (p, body) => {
    const r = await send('POST', p, body);
    if (r.status !== 202) throw new Error(`POST ${p} answered ${r.status} ${r.json?.error ?? ''}: ${r.json?.message ?? r.text.slice(0, 120)}`);
    return settle();
  };
  return {
    base, check, send, settle,
    plan: (body) => start('/api/plan', body),
    apply: (plan, extra = {}) => start('/api/apply', { planId: plan.planId, confirm: `REGISTER ${plan.counts.toApply}`, ...extra }),
    failures: () => failed,
  };
}
