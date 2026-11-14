// Abuse tests for the gate and the job lifecycle, from an independent review: wrong types, aborted and Reset plans, late audit entries.
import assert from 'node:assert/strict';
import test from 'node:test';
import { installNetguard } from '../src/netguard.js';
import { startApp, sleep } from './abuse-lib.js';

const guard = installNetguard();
test.after(() => guard.restore());
const post = (s, p, b) => s.call('POST', p, b);

test('G1 confirm and planId as arrays are refused as the wrong type', async () => {
  const s = await startApp();
  try {
    const plan = await s.plan({ route: 'a', scenario: 'clean', users: 100 });
    const n = plan.counts.toApply;
    const r = await post(s, '/api/apply', { planId: [plan.planId], confirm: [`REGISTER ${n}`] });
    assert.equal(r.status, 400, 'array confirm/planId should be refused as wrong type');
  } finally { await s.close(); }
});

test('G2 abort during the plan membership phase: the plan is aborted, never done, and cannot be applied', async () => {
  const s = await startApp({ mockLatencyMs: 4 });
  try {
    const r = await post(s, '/api/plan', { route: 'a', scenario: 'missing-role', users: 500, concurrency: 1 });
    // missing-role world: 50%+10% of people exist; destination reads empty though => no membership phase. use realistic instead
    await post(s, '/api/jobs/current/abort'); await s.settle();
  } finally { await s.close(); }
  const s2 = await startApp({ mockLatencyMs: 3 });
  try {
    const r = await post(s2, '/api/plan', { route: 'a', scenario: 'realistic', users: 5000, concurrency: 1 });
    assert.equal(r.status, 202);
    // wait until the job reached the deciding / membership phase
    let phase = '';
    for (let i = 0; i < 4000; i++) { phase = (await s2.call('GET', '/api/jobs/current')).json.job.phase; if (phase === 'deciding') break; await sleep(5); }
    await sleep(30);
    const ab = await post(s2, '/api/jobs/current/abort');
    const done = await s2.settle();
    const res = (await s2.call('GET', '/api/jobs/current/results?limit=500')).json;
    if (done.planId) {
      const ap = await post(s2, '/api/apply', { planId: done.planId, confirm: `REGISTER ${done.counts.toApply}` });
    }
    assert.equal(done.state, 'aborted', 'an aborted plan must not end as done');
  } finally { await s2.close(); }
});

test('G3 an old plan does not survive a failed or aborted re-plan', async () => {
  const s = await startApp({ mockLatencyMs: 2 });
  try {
    const p1 = await s.plan({ route: 'a', scenario: 'clean', users: 100 });
    const w1 = s.app.locals.mockWorld();
    await post(s, '/api/plan', { route: 'a', scenario: 'conflicts', users: 500 });
    await post(s, '/api/jobs/current/abort'); const j2 = await s.settle();
    const w2 = s.app.locals.mockWorld();
    const ap = await post(s, '/api/apply', { planId: p1.planId, confirm: `REGISTER ${p1.counts.toApply}` });
    if (ap.status === 202) { const d = await s.settle(); console.log('G3 apply result counts', JSON.stringify(d.counts), 'state', d.state, 'w2 created', w2.state().created, 'w1 created', w1.state().created); }
    assert.equal(ap.status, 409, 'a plan older than the latest plan job must not apply');
  } finally { await s.close(); }
});

test('G4 Reset during a running apply leaves no late audit entry', async () => {
  const s = await startApp({ mockLatencyMs: 3 });
  try {
    const plan = await s.plan({ route: 'a', scenario: 'clean', users: 500 });
    await post(s, '/api/apply', { planId: plan.planId, confirm: `REGISTER ${plan.counts.toApply}` });
    await sleep(40);
    await post(s, '/api/reset');
    const a0 = (await s.call('GET', '/api/audit')).json.entries.length;
    await sleep(300);
    const a1 = (await s.call('GET', '/api/audit')).json.entries;
    const fs = await import('node:fs'); const f = s.dir + '/audit.jsonl';
    assert.equal(a1.length, 0, 'Reset must leave an empty audit');
  } finally { await s.close(); }
});

test('G5 Reset during a running plan does not resurrect the plan', async () => {
  const s = await startApp({ mockLatencyMs: 3 });
  try {
    const r = await post(s, '/api/plan', { route: 'a', scenario: 'realistic', users: 5000, concurrency: 1 });
    for (let i = 0; i < 4000; i++) { const ph = (await s.call('GET', '/api/jobs/current')).json.job.phase; if (ph === 'deciding') break; await sleep(5); }
    await sleep(40);
    await post(s, '/api/reset');
    await s.app.locals.jobs.whenIdle();
    assert.equal(s.app.locals.jobs.hasPlan(), false);
  } finally { await s.close(); }
});

test('G6 prototype pollution / huge / wrong-type bodies', async () => {
  const s = await startApp();
  try {
    const raw = async (path, body) => fetch(`${s.origin}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: s.origin }, body });
    for (const b of ['{"route":"a","__proto__":{"polluted":1}}', '{"route":"a","constructor":{"prototype":{"polluted":1}}}', '{"__proto__":{"route":"a"}}']) { const r = await raw('/api/plan', b); console.log('G6', b.slice(0, 40), r.status); await s.settle?.().catch(() => {}); }
    assert.equal({}.polluted, undefined); assert.equal({}.route, undefined);
    // wrong types
    for (const b of [[], 'x', 5, null, { route: ['a'] }, { route: 'a', scenario: {} }, { route: 'a', users: [100] }, { route: 'a', concurrency: [4] }]) {
      const r = await post(s, '/api/plan', b); console.log('G6 type', JSON.stringify(b), r.status, r.json?.error);
      if (r.status === 202) await s.settle();
    }
    const huge = await post(s, '/api/apply', { planId: 'x'.repeat(15_000), confirm: 'y'.repeat(4000) });
    const ack = await post(s, '/api/apply', { planId: 'x', confirm: 'REGISTER 1', acknowledgeWarnings: { length: 3 } });
    const m = await post(s, '/api/mode', { source: 'mock', extra: 1 });
  } finally { await s.close(); }
});

test('G7 two applies in the same tick, plan+apply concurrency', async () => {
  const s = await startApp({ mockLatencyMs: 2 });
  try {
    const plan = await s.plan({ route: 'a', scenario: 'clean', users: 100 });
    const body = { planId: plan.planId, confirm: `REGISTER ${plan.counts.toApply}` };
    const [a, b] = await Promise.all([post(s, '/api/apply', body), post(s, '/api/apply', body)]);
    const c = await post(s, '/api/plan', { route: 'a', scenario: 'clean', users: 100 });
    await s.settle();
    const world = s.app.locals.mockWorld();
    assert.equal(world.state().created, plan.counts['create+add']);
  } finally { await s.close(); }
});
