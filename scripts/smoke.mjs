#!/usr/bin/env node
// The minimum end-to-end check against a RUNNING app (npm start, or the Docker container), in Mock only: health, the mode, then for each
// route a clean 100-person plan, a refused apply (wrong count), the apply with the typed count, and a verify that finds nothing left to
// apply; then the results and both reports, then Reset so nothing is left behind. It uses the in-process mock only: if the app is in
// Real it switches the page back to Mock first, and it never sends a Real plan. Prints one line per check and the counts; the exit
// code is the result (0 = all passed). Loopback only.
//   node scripts/smoke.mjs [base-url]      (default http://127.0.0.1:${PORT:-7817})
import { connect } from './lib/run-client.mjs';

let c;
try { c = connect(process.argv[2]); } catch (e) { console.error(e.message); process.exit(1); }
const { check, send } = c;
const show = (label, counts) => console.log(`      ${label}: ${JSON.stringify(counts)}`);

try {
  const h = await send('GET', '/api/health');
  check(h.status === 200 && h.json?.schema === 'demo-health/1' && h.json.state !== 'broken', 'GET /api/health is demo-health/1 and not broken');
  let info = await send('GET', '/api/info');
  if (info.json?.source !== 'mock') {
    const sw = await send('POST', '/api/mode', { source: 'mock' });
    check(sw.status === 200 && sw.json?.source === 'mock', 'the app was in Real: POST /api/mode switched it back to Mock before anything ran');
    info = await send('GET', '/api/info');
  }
  check(info.status === 200 && info.json?.source === 'mock' && info.json?.mock?.scenarios?.length >= 6, `GET /api/info: Mock, ${info.json?.mock?.scenarios?.length ?? 0} scenarios (Real is ${info.json?.realAvailable ? 'allowed by the owner' : 'refused'})`);

  for (const route of ['a', 'b']) {
    const body = { route, scenario: 'clean', users: 100 };
    const plan = await c.plan(body);
    check(plan.state === 'done' && plan.total === 100 && plan.counts.toApply > 0, `route ${route}: plan reads 100 people and finds ${plan.counts?.toApply} to apply`);
    show('plan', plan.counts);
    const wrong = await send('POST', '/api/apply', { planId: plan.planId, confirm: `REGISTER ${plan.counts.toApply + 1}` });
    check(wrong.status === 400 && wrong.json?.error === 'confirm_required', `route ${route}: a wrong count is refused (400 confirm_required) and nothing is written`);
    const applied = await c.apply(plan);
    check(applied.state === 'done' && applied.counts.failed === 0 && applied.counts.pending === 0, `route ${route}: apply with the typed count finished, none failed, none pending`);
    show('apply', applied.counts);
    const verify = await c.plan(body);
    check(verify.state === 'done' && verify.counts.toApply === 0, `route ${route}: verify (plan again) finds ${verify.counts?.toApply} to apply`);
    show('verify', verify.counts);

    const rows = await send('GET', '/api/jobs/current/results?limit=5');
    check(rows.status === 200 && rows.json?.total === 100 && rows.json.rows?.length === 5, `route ${route}: results are paged (5 of ${rows.json?.total} rows)`);
    const json = await send('GET', '/api/report?format=json');
    check(json.status === 200 && json.json?.schema === 'bulk-users-report/1' && json.json.rows?.length === 100, `route ${route}: the JSON report has ${json.json?.rows?.length} rows`);
    const csv = await send('GET', '/api/report?format=csv');
    check(csv.status === 200 && csv.text.startsWith('n,username,email,status,') && csv.text.trim().split('\n').length === 101, `route ${route}: the CSV report has a header and 100 rows`);
    check(/filename="bulk-users-mock-/.test(csv.headers.get('content-disposition') ?? '') && json.json?.job?.source === 'mock', `route ${route}: the reports say they are from Mock`);
  }

  const z = await send('POST', '/api/reset', {});
  const after = await send('GET', '/api/jobs/current');
  check(z.status === 200 && z.json?.ok === true && after.json?.job === null, 'POST /api/reset: ok, no job is left');
} catch (e) { check(false, `the run failed against ${c.base.origin}: ${e.message}`); }
process.exit(c.failures() ? 1 : 0);
