#!/usr/bin/env node
// Verifies a RUNNING instance (host-run or container) by content, in Mock only: the health contract, the built page, the Host and
// same-origin guards, the diagrams, the two-step gate, the back-off numbers of the Realistic scenario, the blocking warning of the
// Missing role scenario, and Reset. It contacts only the base URL you give (loopback) and, with --container, asks Docker about
// that one container (its published port and its user). It leaves nothing behind: it ends with POST /api/reset.
//   node scripts/verify-running.mjs [http://127.0.0.1:7817] [--container <name>]
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import { connect } from './lib/run-client.mjs';

const args = process.argv.slice(2);
const ci = args.indexOf('--container');
const container = ci >= 0 ? args[ci + 1] : null;
if (ci >= 0 && !container) { console.error('usage: verify-running.mjs [http://127.0.0.1:<port>] [--container name]'); process.exit(2); }
let c;
try { c = connect(args.find((a, i) => !a.startsWith('--') && i !== (ci >= 0 ? ci + 1 : -1))); } catch (e) { console.error(e.message); process.exit(2); }
const { check, send } = c;

try {
  const h = await send('GET', '/api/health');
  check(h.status === 200 && h.json?.schema === 'demo-health/1' && h.json.state === 'ready' && h.json.demo?.id === 'privilege-bulk-users', `health contract demo-health/1 (state ${h.json?.state}, runtime ${h.json?.runtime})`);
  const hdr = (n) => h.headers.get(n) ?? '';
  check(hdr('x-content-type-options') === 'nosniff' && hdr('referrer-policy') === 'no-referrer' && /default-src 'self'/.test(hdr('content-security-policy')) && /frame-ancestors 'none'/.test(hdr('content-security-policy')), 'responses carry the security headers (nosniff, no-referrer, a CSP with frame-ancestors none)');
  const page = await send('GET', '/');
  check(page.status === 200 && /<div id="root"/.test(page.text) && /<title>[^<]*Privilege Bulk Users/.test(page.text), 'the page is the built app (root div and title)');

  const badHost = await new Promise((resolve) => {
    const r = http.request({ host: c.base.hostname, port: Number(c.base.port), path: '/api/info', headers: { Host: 'evil.example' } }, (res) => { res.resume(); resolve(res.statusCode); });
    r.on('error', () => resolve(null)); r.end();
  });
  check(badHost === 403, 'a non-loopback Host header is refused (403)');
  const noOrigin = await fetch(new URL('/api/reset', c.base), { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  check(noOrigin.status === 403, 'a write with no matching Origin is refused (403)');

  let info = (await send('GET', '/api/info')).json;
  if (info?.source !== 'mock') { await send('POST', '/api/mode', { source: 'mock' }); info = (await send('GET', '/api/info')).json; }
  check(info?.source === 'mock' && info.routes?.a && info.routes?.b && info.mock?.scenarios?.length === 6 && info.writesEnabled === false, 'GET /api/info: Mock, both routes, six scenarios, writes off');
  const leaked = JSON.stringify(info);
  check(!/secret|password/i.test(leaked.replace(/BULK_[A-Z0-9_]*SECRET/g, '')) && !/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(leaked), '/api/info carries setting names only: no secret, no identifier');
  const real = await send('POST', '/api/mode', { source: 'real' });
  check(info?.realAvailable ? real.status === 200 : real.status === 409 && real.json?.error === 'real_not_available', info?.realAvailable ? 'Real is allowed by the owner here (switching it back to Mock)' : 'POST /api/mode real is refused (409 real_not_available): Real is the owner\'s opt-in');
  if (info?.realAvailable) await send('POST', '/api/mode', { source: 'mock' });

  const names = ((await send('GET', '/api/diagrams')).json?.diagrams ?? []).map((d) => d.name).sort();
  const dia = await send('GET', '/api/diagrams/route-a');
  check(names.join() === 'route-a,route-b' && dia.json?.schema === 'diagram-studio/1', 'the two diagrams are served by name as diagram-studio/1 data');

  const none = await send('POST', '/api/apply', { planId: 'x', confirm: 'REGISTER 1' });
  check(none.status === 409 && none.json?.error === 'no_plan', 'apply with no plan is refused (409 no_plan)');
  const writes = await send('POST', '/api/writes', { enabled: true });
  check(writes.status === 409 && writes.json?.error === 'mock_only', 'the Real writes switch is refused in Mock (409 mock_only)');

  // The Realistic scenario: the plan matches the world, the apply meets 429s and waits, and a second plan finds nothing left.
  const body = { route: 'a', scenario: 'realistic', users: 100 };
  const plan = await c.plan(body);
  check(plan.state === 'done' && plan.counts.toApply > 0,`realistic: plan finds ${plan.counts?.toApply} to apply, ${plan.counts?.conflict} conflicts, ${plan.counts?.invalid} invalid`);
  const wrong = await send('POST', '/api/apply', { planId: plan.planId, confirm: 'REGISTER' });
  check(wrong.status === 400 && wrong.json?.error === 'confirm_required', 'apply without the typed count is refused (400 confirm_required)');
  const applied = await c.apply(plan);
  check(applied.state === 'done' && applied.counts.pending === 0 && applied.http.rate429 > 0 && applied.http.waitedMs > 0, `realistic: apply finished; ${applied.http?.rate429} x 429, waited ${applied.http?.waitedMs} ms, ${applied.http?.retries} retries`);
  const again = await send('POST', '/api/apply', { planId: plan.planId, confirm: `REGISTER ${plan.counts.toApply}` });
  check(again.status === 409 && again.json?.error === 'no_plan', 'a plan is used up by its apply: applying it again is refused (409 no_plan)');
  const verify = await c.plan(body);
  check(verify.state === 'done' && verify.counts.toApply === 0, `realistic: verify (plan again) finds ${verify.counts?.toApply} to apply`);

  // The trap: a worker without the role sees an EMPTY list, which must be a blocking warning the page makes you acknowledge.
  const mr = await c.plan({ route: 'a', scenario: 'missing-role', users: 100 });
  const warn = mr.warnings?.find((w) => w.code === 'destination_empty');
  check(mr.state === 'done' && warn?.blocking === true, 'missing-role: the empty destination is a blocking warning (destination_empty)');
  const blocked = await send('POST', '/api/apply', { planId: mr.planId, confirm: `REGISTER ${mr.counts.toApply}` });
  check(blocked.status === 409 && blocked.json?.error === 'warnings_unacknowledged', 'missing-role: apply without acknowledging it is refused (409 warnings_unacknowledged)');

  const audit = (await send('GET', '/api/audit')).json?.entries ?? [];
  check(audit.length > 0 && !/@/.test(JSON.stringify(audit)), 'the audit holds summaries and no address');

  const z = await send('POST', '/api/reset', {});
  const after = await send('GET', '/api/jobs/current');
  const auditAfter = (await send('GET', '/api/audit')).json?.entries ?? [];
  check(z.status === 200 && after.json?.job === null && auditAfter.length === 0, 'Reset clears the job and the audit history');

  if (container) {
    const port = execFileSync('docker', ['port', container, '7817/tcp'], { encoding: 'utf8' }).trim().split('\n');
    check(port.length > 0 && port.every((l) => /^127\.0\.0\.1:\d+$/.test(l)), `the container publishes 7817 on 127.0.0.1 only (${port.join(', ')})`);
    const uid = execFileSync('docker', ['exec', container, 'id', '-u'], { encoding: 'utf8' }).trim();
    check(uid !== '0', `the container runs as a non-root user (uid ${uid})`);
  } else console.log('SKIP  container leg (pass --container <name> to check the published port and the user)');
} catch (e) { check(false, `the run failed against ${c.base.origin}: ${e.message}`); }
console.log(c.failures() ? `\n${c.failures()} check(s) failed` : '\nall checks passed');
process.exit(c.failures() ? 1 : 0);
