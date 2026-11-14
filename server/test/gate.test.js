// The apply gate and the job lifecycle: what is refused, in what words, and that a refusal writes nothing.
import assert from 'node:assert/strict';
import test from 'node:test';
import { sleep, startApp } from './helpers.js';
import { installNetguard } from './netguard.js';

const guard = installNetguard();
test.after(() => { assert.deepEqual(guard.attempts, [], 'zero outbound attempts'); guard.restore(); });

const post = (s, path, body) => s.call('POST', path, body);

test('apply is refused, with a named reason and nothing written, until every condition holds', async () => {
  let t = 1_700_000_000_000;
  const s = await startApp({ now: () => t });
  try {
    assert.equal((await post(s, '/api/apply', { planId: 'x', confirm: 'REGISTER 1' })).json.error, 'no_plan');
    const plan = await s.plan({ route: 'a', scenario: 'clean', users: 100 });
    const n = plan.counts.toApply; const world = s.app.locals.mockWorld();
    const wrong = await post(s, '/api/apply', { planId: 'not-it', confirm: `REGISTER ${n}` });
    assert.equal(wrong.status, 409); assert.equal(wrong.json.error, 'no_plan');
    for (const confirm of ['', 'register ' + n, `REGISTER ${n + 1}`, `REGISTER ${n} `, 'yes', undefined]) {
      const r = await post(s, '/api/apply', { planId: plan.planId, confirm });
      assert.equal(r.status, 400, String(confirm)); assert.equal(r.json.error, 'confirm_required');
      assert.match(r.json.message, new RegExp(`REGISTER ${n}`));
    }
    assert.equal(world.state().created, 0, 'every refusal wrote nothing');
    t += 16 * 60 * 1000; // older than the 15 minute window
    const stale = await post(s, '/api/apply', { planId: plan.planId, confirm: `REGISTER ${n}` });
    assert.equal(stale.status, 409); assert.equal(stale.json.error, 'stale_plan');
    t += 0;
    const fresh = await s.plan({ route: 'a', scenario: 'clean', users: 100 });
    const ok = await post(s, '/api/apply', { planId: fresh.planId, confirm: `REGISTER ${fresh.counts.toApply}` });
    assert.equal(ok.status, 202, ok.text);
    await s.settle();
    // an apply uses its plan up: the same plan cannot be applied twice
    const again = await post(s, '/api/apply', { planId: fresh.planId, confirm: `REGISTER ${fresh.counts.toApply}` });
    assert.equal(again.status, 409); assert.equal(again.json.error, 'no_plan');
    // verify finds nothing, and an apply of that is refused as nothing to do
    const verify = await s.plan({ route: 'a', scenario: 'clean', users: 100 });
    assert.equal(verify.counts.toApply, 0);
    const none = await post(s, '/api/apply', { planId: verify.planId, confirm: 'REGISTER 0' });
    assert.equal(none.status, 409); assert.equal(none.json.error, 'nothing_to_do');
  } finally { await s.close(); }
});

test('a plan from before a mode change or a Reset cannot be applied', async () => {
  const s = await startApp();
  try {
    const plan = await s.plan({ route: 'a', scenario: 'clean', users: 100 });
    assert.equal((await post(s, '/api/reset')).status, 200);
    const r = await post(s, '/api/apply', { planId: plan.planId, confirm: `REGISTER ${plan.counts.toApply}` });
    assert.equal(r.json.error, 'no_plan');
    assert.equal((await s.call('GET', '/api/jobs/current')).json.job, null, 'Reset clears the job');
    assert.equal((await s.call('GET', '/api/audit')).json.entries.length, 0);
    assert.equal(s.app.locals.mockWorld(), null, 'and the mock world, so the next plan starts fresh');
  } finally { await s.close(); }
});

test('one job at a time; abort stops the run, finishes what is in flight and leaves the rest pending', async () => {
  const s = await startApp({ mockLatencyMs: 3 });
  try {
    const first = await post(s, '/api/plan', { route: 'a', scenario: 'clean', users: 5000 });
    assert.equal(first.status, 202); assert.equal(first.json.job.state, 'running');
    const second = await post(s, '/api/plan', { route: 'b', scenario: 'clean', users: 100 });
    assert.equal(second.status, 409); assert.equal(second.json.error, 'job_running');
    assert.equal((await post(s, '/api/mode', { source: 'mock' })).status, 409, 'no mode switch mid-job');
    await sleep(30);
    const ab = await post(s, '/api/jobs/current/abort');
    assert.equal(ab.status, 200);
    const done = await s.settle();
    assert.equal(done.state, 'aborted'); assert.equal(done.error.code, 'aborted');
    assert.equal((await post(s, '/api/jobs/current/abort')).json.error, 'no_job');
  } finally { await s.close(); }
});

test('abort during an apply: the calls in flight finish, the rest stay pending, the audit says so', async () => {
  const s = await startApp({ mockLatencyMs: 3 });
  try {
    const plan = await s.plan({ route: 'a', scenario: 'clean', users: 500 });
    const r = await post(s, '/api/apply', { planId: plan.planId, confirm: `REGISTER ${plan.counts.toApply}` });
    assert.equal(r.status, 202);
    await sleep(60);
    await post(s, '/api/jobs/current/abort');
    const done = await s.settle();
    assert.equal(done.state, 'aborted');
    assert.ok(done.counts.pending > 0 && done.counts.pending < plan.counts.toApply, `some done, some pending: ${JSON.stringify(done.counts)}`);
    assert.equal(done.counts.created + done.counts.added + done.counts.failed + done.counts.pending, plan.counts.toApply);
    const audit = (await s.call('GET', '/api/audit')).json.entries;
    assert.ok(audit.some((e) => e.op === 'apply' && e.outcome === 'aborted'));
    assert.ok(!JSON.stringify(audit).includes('@'), 'the audit holds counts, never an email');
  } finally { await s.close(); }
});

test('request validation: route, concurrency, scenario and users are checked and nothing starts', async () => {
  const s = await startApp();
  try {
    for (const body of [{}, { route: 'c' }, { route: 'a', concurrency: 0 }, { route: 'a', concurrency: 17 }, { route: 'a', concurrency: 2.5 }, { route: 'a', concurrency: '6' }, { route: 'a', scenario: 'nope' }, { route: 'a', users: 7 }, { route: 'a', users: '100' }]) {
      const r = await post(s, '/api/plan', body);
      assert.equal(r.status, 400, JSON.stringify(body)); assert.equal(r.json.error, 'bad_request');
    }
    assert.equal((await s.call('GET', '/api/jobs/current')).json.job, null, 'nothing started');
    assert.equal((await post(s, '/api/writes', { enabled: true })).json.error, 'mock_only');
    assert.equal((await s.call('GET', '/api/report')).json.error, 'no_report');
    assert.equal((await s.call('GET', '/api/report?format=xml')).status, 400);
  } finally { await s.close(); }
});

test('results: filter, page, cap; the status tallies add up; usernames and emails are masked or inert', async () => {
  const s = await startApp();
  try {
    const plan = await s.plan({ route: 'a', scenario: 'conflicts', users: 500 });
    const all = (await s.call('GET', '/api/jobs/current/results?limit=500')).json;
    assert.equal(all.total, 500); assert.equal(all.rows.length, 500);
    assert.equal(Object.values(all.statuses).reduce((a, b) => a + b, 0), 500);
    assert.equal(all.statuses.conflict, plan.counts.conflict);
    const page = (await s.call('GET', '/api/jobs/current/results?offset=10&limit=5')).json;
    assert.deepEqual(page.rows.map((r) => r.n), [11, 12, 13, 14, 15]);
    assert.equal((await s.call('GET', '/api/jobs/current/results?limit=99999')).json.limit, 500);
    assert.equal((await s.call('GET', '/api/jobs/current/results?offset=-4&limit=abc')).json.offset, 0);
    const filtered = (await s.call('GET', `/api/jobs/current/results?status=invalid`)).json;
    assert.equal(filtered.total, plan.counts.invalid);
    for (const r of all.rows.filter((x) => x.email)) assert.match(r.email, /^.\*\*\*@corp\.example$/, 'the address is masked');
  } finally { await s.close(); }
});

test('the report: JSON and CSV of the last job, as a download', async () => {
  const s = await startApp();
  try {
    await s.plan({ route: 'a', scenario: 'clean', users: 100 });
    const j = await s.call('GET', '/api/report?format=json');
    assert.equal(j.status, 200); assert.match(j.headers.get('content-disposition'), /attachment; filename="bulk-users-mock-plan-a\.json"/);
    assert.equal(j.json.schema, 'bulk-users-report/1'); assert.equal(j.json.rows.length, 100); assert.equal(j.json.job.kind, 'plan');
    const c = await s.call('GET', '/api/report?format=csv');
    assert.match(c.headers.get('content-type'), /text\/csv/);
    const lines = c.text.trim().split('\n');
    assert.equal(lines[0], 'n,username,email,status,detail,httpStatus,attempts,source'); assert.equal(lines.length, 101);
    assert.ok(lines.slice(1).every((l) => l.endsWith(',mock')), 'every row says it is Mock');
  } finally { await s.close(); }
});

test('the audit keeps one summary per job and no secret or address', async () => {
  const s = await startApp();
  try {
    const plan = await s.plan({ route: 'a', scenario: 'clean', users: 100 });
    await s.apply(plan);
    const entries = (await s.call('GET', '/api/audit')).json.entries;
    assert.deepEqual(entries.map((e) => `${e.op}:${e.outcome ?? ''}`).reverse(), ['plan:done', 'apply-start:', 'apply:done']);
    assert.ok(entries.every((e) => e.at && !('email' in e)));
  } finally { await s.close(); }
});

test('Reset aborts a running job: it stops the calls and returns once the calls in flight have finished, not when the whole job would have', async () => {
  const s = await startApp({ mockLatencyMs: 3 });
  try {
    assert.equal((await post(s, '/api/plan', { route: 'a', scenario: 'clean', users: 5000, concurrency: 2 })).status, 202);
    await sleep(40);
    const world = s.app.locals.mockWorld();
    const t0 = Date.now();
    assert.equal((await post(s, '/api/reset')).status, 200);
    const after = world.state().calls;
    assert.ok(after < 400, `a full plan of 5000 makes about 800 calls; Reset stopped it near ${after}`);
    await sleep(60);
    assert.equal(world.state().calls, after, 'and nothing more was sent after Reset returned');
    assert.ok(Date.now() - t0 < 1500, 'Reset did not wait for the whole job');
  } finally { await s.close(); }
});

test('the Concurrency box governs the apply as well as the plan; the job says how many people and which scenario', async () => {
  const s = await startApp();
  try {
    const plan = await s.plan({ route: 'a', scenario: 'clean', users: 100, concurrency: 3 });
    assert.equal(plan.concurrency, 3); assert.equal(plan.users, 100); assert.equal(plan.scenario, 'clean');
    const applied = await s.apply(plan);
    assert.equal(applied.concurrency, 3, 'apply ran at the plan\'s concurrency, not a default');
    assert.equal(applied.users, 100); assert.equal(applied.scenario, 'clean');
    const csv = (await s.call('GET', '/api/report?format=csv')).headers.get('content-disposition');
    assert.match(csv, /bulk-users-mock-apply-a\.csv/, 'the mode is in the filename');
  } finally { await s.close(); }
});

test('every response carries the security headers; the page can only load its own files', async () => {
  const s = await startApp();
  try {
    for (const p of ['/api/health', '/api/info', '/nope']) {
      const r = await s.call('GET', p);
      assert.equal(r.headers.get('x-content-type-options'), 'nosniff', p);
      assert.equal(r.headers.get('x-frame-options'), 'DENY'); assert.equal(r.headers.get('referrer-policy'), 'no-referrer');
      const csp = r.headers.get('content-security-policy');
      assert.match(csp, /default-src 'self'/); assert.match(csp, /frame-ancestors 'none'/); assert.match(csp, /object-src 'none'/); assert.ok(!/unsafe-eval|script-src[^;]*unsafe-inline/.test(csp));
    }
    const bad = await fetch(`${s.origin}/api/info`, { headers: { Host: 'evil.example' } }).catch(() => null);
    if (bad) assert.equal(bad.headers.get('x-content-type-options'), 'nosniff', 'even a refused request');
  } finally { await s.close(); }
});
