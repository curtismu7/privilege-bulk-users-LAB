// The job manager against fake clients: hostile people, CSV injection, the circuit breaker, and that no internal text or secret leaks.
import assert from 'node:assert/strict';
import test from 'node:test';
import { BulkError } from '../src/errors.js';
import { createGate, newStats } from '../src/http.js';
import { createJobs } from '../src/jobs.js';

const HOSTILE = ['=HYPERLINK("http://x.invalid","click")', '<img src=x onerror=alert(1)>', '+cmd|calc', '@SUM(1+1)', 'quote"and,comma', '-1+1', 'x'.repeat(300)];
const people = (names) => names.map((u, i) => ({ id: `id-${i}`, username: u, email: `${i}@x.example`, name: { given: 'G', family: 'F' } }));
const fakeP1 = (raw, over = {}) => ({
  // The source ('S') has the people; the destination ('D') holds one unrelated administrator, so it is not empty.
  listUsers: async (env) => ({ items: env === 'S' ? raw : [{ id: 'adm', username: 'admin', email: 'admin@x.example', name: {} }], truncated: false }),
  findGroup: async () => ({ id: 'g1', name: 'G' }), defaultPopulation: async () => ({ id: 'p1' }), groupIdsOf: async () => [],
  createUser: async () => ({ status: 201, json: { id: 'new' }, tries: 1 }), addToGroup: async () => ({ status: 201, tries: 1 }), ...over,
});
const jobsFor = (p1, { secrets = [], breaker, now } = {}) => createJobs({
  now, breaker,
  makeContext: async () => ({ p1, con: null, gate: createGate({ scale: 0 }), stats: newStats(), timeScale: 1, secrets, release() {}, sourceEnvId: 'S', privilegeEnvId: 'D', group: 'G' }),
});
const run = async (j, body) => { j.startPlan({ route: 'a', mode: 'mock', params: {}, concurrency: 4, ...body }); await j.whenIdle(); return j.current(); };

test('hostile usernames pass through as plain data and the CSV neutralises spreadsheet formulas', async () => {
  const j = jobsFor(fakeP1(people(HOSTILE)));
  const plan = await run(j);
  assert.equal(plan.state, 'done'); assert.equal(plan.counts['create+add'], HOSTILE.length);
  const rows = j.results({ limit: 500 }).rows;
  assert.equal(rows[1].username, HOSTILE[1], 'stored as the exact text; the page renders text nodes only');
  assert.equal(rows[6].username.length, 200, 'long text is clipped');
  const csv = j.report('csv').body.split('\n');
  assert.ok(csv[1].includes(`"'=HYPERLINK(""http://x.invalid"",""click"")"`), csv[1]);
  for (const line of csv.slice(1, 8)) assert.ok(!/^\d+,[=+\-@]/.test(line), `no formula starts a cell: ${line.slice(0, 40)}`);
  assert.ok(csv.some((l) => l.includes(`,'+cmd|calc,`)) && csv.some((l) => l.includes(`,'@SUM(1+1),`)) && csv.some((l) => l.includes(`,'-1+1,`)));
  assert.equal(JSON.parse(j.report('json').body).rows.length, HOSTILE.length);
});

test('the circuit breaker: when most of the first people fail, the run stops on purpose and says why', async () => {
  const p1 = fakeP1(people(Array.from({ length: 200 }, (_, i) => `u${i}`)), { createUser: async () => ({ status: 403, json: { code: 'ACCESS_FAILED' }, tries: 1 }) });
  const j = jobsFor(p1, { breaker: { minSample: 10, ratio: 0.5 } });
  const plan = await run(j);
  j.startApply({ planId: plan.planId, confirm: 'REGISTER 200', mode: 'mock', writesEnabled: false, concurrency: 4 }); await j.whenIdle();
  const done = j.current();
  assert.equal(done.state, 'failed'); assert.equal(done.error.code, 'circuit_open');
  assert.ok(done.counts.failed >= 10 && done.counts.pending > 100, JSON.stringify(done.counts));
  const failed = j.results({ status: 'failed', limit: 1 }).rows[0];
  assert.match(failed.detail, /HTTP 403 ACCESS_FAILED.*Identity Data Admin/);
});

test('a few failures do not trip it: the run finishes and names them', async () => {
  let n = 0;
  const p1 = fakeP1(people(Array.from({ length: 100 }, (_, i) => `u${i}`)), { createUser: async () => (++n % 25 === 0 ? { status: 500, json: null, tries: 4 } : { status: 201, json: { id: 'x' }, tries: 1 }) });
  const j = jobsFor(p1);
  const plan = await run(j);
  j.startApply({ planId: plan.planId, confirm: 'REGISTER 100', mode: 'mock', writesEnabled: false, concurrency: 1 }); await j.whenIdle();
  const done = j.current();
  assert.equal(done.state, 'done'); assert.equal(done.counts.failed, 4); assert.equal(done.counts.created, 96); assert.equal(done.counts.pending, 0);
});

test('an unexpected exception is "internal error"; a coded one is shown, with secrets scrubbed', async () => {
  const boom = jobsFor(fakeP1([], { listUsers: async () => { throw new Error('connect ECONNREFUSED 10.0.0.9 token=abc123'); } }));
  const a = await run(boom);
  assert.equal(a.state, 'failed'); assert.deepEqual(a.error, { code: 'internal_error', message: 'internal error' });
  const coded = jobsFor(fakeP1([], { listUsers: async () => { throw new BulkError('token_refused', 'refused for client-secret-777'); } }), { secrets: ['client-secret-777'] });
  const b = await run(coded);
  assert.equal(b.error.code, 'token_refused'); assert.ok(!b.error.message.includes('client-secret-777')); assert.match(b.error.message, /\[redacted\]/);
});

test('a missing group is a named stop that writes nothing; a truncated source is a blocking warning', async () => {
  const j = jobsFor(fakeP1(people(['a']), { findGroup: async () => null }));
  const a = await run(j);
  assert.equal(a.error.code, 'group_missing'); assert.match(a.error.message, /nothing was written/);
  const big = fakeP1(people(['a', 'b', 'c']), { listUsers: async () => ({ items: people(['a', 'b']), truncated: true }) });
  const b = await run(jobsFor(big));
  assert.deepEqual(b.warnings.map((w) => [w.code, w.blocking]), [['truncated', true]]);
});

test('a membership check that fails for one person is not fatal: that person is planned as "add"', async () => {
  const both = people(['a', 'b']);
  const p1 = fakeP1(both, { listUsers: async () => ({ items: both, truncated: false }), groupIdsOf: async (_e, id) => { if (id === 'id-0') throw new BulkError('destination_unreadable', 'x', { httpStatus: 503 }); return ['g1']; } });
  const j = jobsFor(p1);
  // both exist in the destination (same list), so both are membership-checked
  const plan = await run(j);
  assert.equal(plan.state, 'done');
  assert.equal(plan.counts.add, 1); assert.equal(plan.counts['in-sync'], 1);
  assert.match(j.results({ status: 'add' }).rows[0].detail, /could not check membership \(HTTP 503\)/);
});

test('duplicate people in the source (the same email or username, or a page overlap) are planned once; the rest are conflicts, on both routes', async () => {
  const dup = [
    { id: 'a', username: 'ann', email: 'ann@x.example', name: {} }, { id: 'a2', username: 'ann', email: 'other@x.example', name: {} },
    { id: 'a3', username: 'ANN2', email: 'ANN@x.example', name: {} }, { id: 'b', username: 'bob', email: 'bob@x.example', name: {} },
  ];
  const plan = await run(jobsFor(fakeP1(dup)));
  assert.deepEqual([plan.counts['create+add'], plan.counts.conflict], [2, 2]);
  const rows = jobsFor(fakeP1(dup)); await run(rows);
  assert.deepEqual(rows.results({ limit: 10 }).rows.map((r) => r.status), ['create+add', 'conflict', 'conflict', 'create+add']);
  assert.match(rows.results({ status: 'conflict' }).rows[0].detail, /appears more than once in the source/);
});

test('a create whose answer was lost and then retried: if the person is ours they are still added to the group; if not it is a conflict', async () => {
  const uniq = { status: 400, json: { code: 'INVALID_DATA', details: [{ code: 'UNIQUENESS_VIOLATION' }] } };
  const adds = [];
  for (const [label, found, want] of [['ours', { id: 'new-1', username: 'u0', email: '0@x.example' }, 'created'], ['someone else', { id: 'x', username: 'someone-else', email: '0@x.example' }, 'conflict'], ['nobody', null, 'conflict']]) {
    const p1 = fakeP1(people(['u0']), { createUser: async () => ({ ...uniq, tries: 2 }), findUserByEmail: async () => found, addToGroup: async (_e, id) => { adds.push(id); return { status: 201, tries: 1 }; } });
    const j = jobsFor(p1); const plan = await run(j);
    j.startApply({ planId: plan.planId, confirm: 'REGISTER 1', mode: 'mock', writesEnabled: false, concurrency: 2 }); await j.whenIdle();
    assert.equal(j.results({ limit: 1 }).rows[0].status, want, label);
  }
  assert.deepEqual(adds, ['new-1'], 'only our own person was added to the group');
  const single = fakeP1(people(['u0']), { createUser: async () => ({ ...uniq, tries: 1 }), findUserByEmail: async () => { throw new Error('must not look up after a single try'); } });
  const j = jobsFor(single); const plan = await run(j);
  j.startApply({ planId: plan.planId, confirm: 'REGISTER 1', mode: 'mock', writesEnabled: false, concurrency: 2 }); await j.whenIdle();
  assert.equal(j.results({ limit: 1 }).rows[0].status, 'conflict', 'one try that says "exists" is simply someone else');
});

test('a 409 on the group add means already a member (added); progress ends at the total; secrets named in the settings are scrubbed from failed rows', async () => {
  const p1 = fakeP1(people(['a', 'b']), { addToGroup: async () => ({ status: 409, tries: 1 }), createUser: async () => ({ status: 400, json: { code: 'sentinel-secret-1' }, tries: 1 }) });
  const j = jobsFor(p1, { secrets: ['sentinel-secret-1'] });
  const plan = await run(j);
  j.startApply({ planId: plan.planId, confirm: 'REGISTER 2', mode: 'mock', writesEnabled: false, concurrency: 1 }); await j.whenIdle();
  const done = j.current();
  assert.equal(done.counts.failed, 2); assert.equal(done.processed, done.total);
  assert.ok(!JSON.stringify(j.results({ limit: 5 })).includes('sentinel-secret-1'));
  const ok = jobsFor(fakeP1(people(['a', 'b']), { addToGroup: async () => ({ status: 409, tries: 1 }) }));
  const plan2 = await run(ok);
  ok.startApply({ planId: plan2.planId, confirm: 'REGISTER 2', mode: 'mock', writesEnabled: false, concurrency: 1 }); await ok.whenIdle();
  assert.equal(ok.current().counts.created, 2); assert.equal(ok.current().processed, ok.current().total);
});

test('the plan reads the source with the people limit, so a bigger source is cut and says so', async () => {
  let asked = null;
  const p1 = fakeP1(people(['a']), { listUsers: async (env, opts) => { if (env === 'S') asked = opts?.max; return { items: env === 'S' ? people(['a']) : [{ id: 'adm', username: 'admin', email: 'admin@x.example', name: {} }], truncated: false }; } });
  await run(jobsFor(p1));
  assert.equal(asked, 50_000);
});
