// The engine end to end, against the Mock world's own ground truth: for each scenario the plan must find exactly what the world was built
// to contain, apply must register everyone it can, and planning again (verify) must find nothing left but the people PingOne always fails.
import assert from 'node:assert/strict';
import test from 'node:test';
import { startApp, withoutTotal } from './helpers.js';
import { installNetguard } from './netguard.js';

const guard = installNetguard();
test.after(() => { assert.deepEqual(guard.attempts, [], 'zero outbound attempts across the whole file'); guard.restore(); });

const HARD_FAIL = { flaky: 2 };

for (const scenario of ['clean', 'realistic', 'conflicts', 'flaky', 'rate-limited']) {
  test(`route a, ${scenario}: plan = ground truth, apply registers everyone it can, verify finds nothing left`, async () => {
    const s = await startApp();
    try {
      const plan = await s.plan({ route: 'a', scenario, users: 100 });
      assert.equal(plan.state, 'done', JSON.stringify(plan.error));
      const world = s.app.locals.mockWorld();
      assert.deepEqual(plan.counts, world.expected('a'), 'the plan found exactly what the world holds');
      assert.equal(plan.total, 100); assert.equal(plan.processed, 100);
      assert.ok(plan.planId);
      assert.equal(world.state().created, 0, 'a plan writes nothing');
      assert.equal(world.state().memberAdds, 0);

      const applied = await s.apply(plan);
      const failed = HARD_FAIL[scenario] ?? 0;
      assert.equal(applied.state, 'done', JSON.stringify(applied.error));
      assert.equal(applied.counts.failed, failed);
      assert.equal(applied.counts.pending, 0);
      assert.equal(applied.counts.created + applied.counts.added + applied.counts.failed, plan.counts.toApply);
      assert.equal(applied.counts.created, plan.counts['create+add'] - failed);
      if (scenario === 'rate-limited' || scenario === 'realistic') {
        assert.ok(applied.http.rate429 > 0, `${scenario}: the mock pushed back`);
        assert.ok(applied.http.waitedMs > 0, 'and the run waited it out');
        assert.equal(applied.timeScale, 0.02);
      }
      if (scenario === 'flaky') assert.ok(applied.http.retries > 0, 'a 503 and a 404 right after create were retried');

      const verify = await s.plan({ route: 'a', scenario, users: 100 });
      assert.equal(verify.counts.toApply, failed, 'verify: only the people PingOne always fails are left');
      assert.equal(verify.counts['in-sync'], plan.counts['in-sync'] + plan.counts.toApply - failed, 'everyone registered now reads as in sync');
      assert.equal(verify.counts.conflict, plan.counts.conflict, 'conflicts stay conflicts: a person must decide');
      for (const name of world.members()) assert.ok(typeof name === 'string');
    } finally { await s.close(); }
  });
}

test('route a: the failed people are named, with what went wrong, and the run did not stop for them', async () => {
  const s = await startApp();
  try {
    const plan = await s.plan({ route: 'a', scenario: 'flaky', users: 100 });
    const applied = await s.apply(plan);
    const rows = (await s.call('GET', '/api/jobs/current/results?status=failed')).json;
    assert.equal(rows.total, 2);
    for (const r of rows.rows) { assert.match(r.detail, /create failed: HTTP 500 UNEXPECTED_ERROR/); assert.equal(r.httpStatus, 500); assert.ok(r.attempts >= 4); }
    assert.equal(applied.counts.created + applied.counts.added, plan.counts.toApply - 2);
  } finally { await s.close(); }
});

test('route a, conflicts: nobody is added to someone else\'s account, the invalid are named', async () => {
  const s = await startApp();
  try {
    const plan = await s.plan({ route: 'a', scenario: 'conflicts', users: 500 });
    assert.ok(plan.counts.conflict > 20 && plan.counts.invalid > 10);
    const conflict = (await s.call('GET', '/api/jobs/current/results?status=conflict&limit=3')).json.rows[0];
    assert.match(conflict.detail, /already belongs to someone else/);
    const invalid = (await s.call('GET', '/api/jobs/current/results?status=invalid&limit=3')).json.rows[0];
    assert.match(invalid.detail, /no email/);
    const world = s.app.locals.mockWorld();
    const before = world.state().groupMembers;
    await s.apply(plan);
    assert.ok(!world.members().includes(conflict.username), 'the conflicting username was not put in the group');
    assert.ok(world.state().groupMembers > before);
  } finally { await s.close(); }
});

test('route a, missing role: the empty list is a blocking warning; ignoring it collides with people who exist, and the run stops on purpose', async () => {
  const s = await startApp();
  try {
    const plan = await s.plan({ route: 'a', scenario: 'missing-role', users: 500 });
    assert.deepEqual(plan.warnings.map((w) => [w.code, w.blocking]), [['destination_empty', true]]);
    assert.equal(plan.counts['in-sync'] + plan.counts.add, 0, 'the plan believes nobody exists');
    const refused = await s.call('POST', '/api/apply', { planId: plan.planId, confirm: `REGISTER ${plan.counts.toApply}` });
    assert.equal(refused.status, 409); assert.equal(refused.json.error, 'warnings_unacknowledged'); assert.match(refused.json.message, /destination_empty/);
    const world = s.app.locals.mockWorld();
    assert.equal(world.state().created, 0, 'refused: nothing was written');
    const applied = await s.apply(plan, { acknowledgeWarnings: ['destination_empty'] });
    assert.equal(applied.state, 'failed'); assert.equal(applied.error.code, 'circuit_open');
    assert.match(applied.error.message, /Stopped on purpose/);
    assert.ok(applied.counts.pending > 0, 'the rest were never started');
    assert.ok(applied.counts.conflict > 0);
  } finally { await s.close(); }
});

for (const scenario of ['clean', 'realistic', 'conflicts', 'flaky']) {
  test(`route b, ${scenario}: plan = ground truth, apply creates the new people, verify finds nothing left`, async () => {
    const s = await startApp();
    try {
      const plan = await s.plan({ route: 'b', scenario, users: 100 });
      assert.equal(plan.state, 'done', JSON.stringify(plan.error));
      const world = s.app.locals.mockWorld();
      assert.deepEqual(plan.counts, world.expected('b'));
      const applied = await s.apply(plan);
      const failed = HARD_FAIL[scenario] ?? 0;
      assert.equal(applied.state, 'done', JSON.stringify(applied.error));
      assert.equal(applied.counts.created, plan.counts.toApply - failed);
      assert.equal(applied.counts.failed, failed);
      const verify = await s.plan({ route: 'b', scenario, users: 100 });
      assert.equal(verify.counts.toApply, failed);
      assert.equal(verify.counts.conflict, plan.counts.conflict);
    } finally { await s.close(); }
  });
}

test('a bigger run: 5000 people through route a with a rate limit, finished and verified', async () => {
  const s = await startApp();
  try {
    const plan = await s.plan({ route: 'a', scenario: 'realistic', users: 5000, concurrency: 8 });
    assert.deepEqual(plan.counts, s.app.locals.mockWorld().expected('a'));
    assert.ok(plan.http.calls >= 50 + 50, 'the source and the destination were read a page of 100 at a time');
    const applied = await s.apply(plan);
    assert.equal(applied.state, 'done');
    assert.equal(applied.counts.pending, 0);
    const verify = await s.plan({ route: 'a', scenario: 'realistic', users: 5000 });
    assert.equal(verify.counts.toApply, 0, 'idempotent: planning again finds nothing to do');
  } finally { await s.close(); }
});

test('the source and the destination are the same environment: nothing is created, people are only added to the group', async () => {
  // Unit-level: the engine's `same` branch, with fakes (the Real settings may name one environment for both).
  const { planA } = await import('../src/routeA.js');
  const people = [{ id: 'u1', username: 'a', email: 'a@x.example' }, { id: 'u2', username: 'b', email: 'b@x.example' }];
  const p1 = {
    listUsers: async () => ({ items: people.map((p) => ({ ...p, name: {} })), truncated: false }),
    findGroup: async () => ({ id: 'g1', name: 'G' }),
    defaultPopulation: async () => { throw new Error('must not be asked'); },
    groupIdsOf: async (_e, id) => (id === 'u1' ? ['g1'] : []),
  };
  const out = await planA({ p1, sourceEnvId: 'E', privilegeEnvId: 'E', group: 'G', concurrency: 2, limits: { maxUsers: 10 }, progress: { phase() {}, total() {}, processed() {} } });
  assert.deepEqual(withoutTotal(out.counts), { 'create+add': 0, add: 1, 'in-sync': 1, conflict: 0, invalid: 0 });
});
