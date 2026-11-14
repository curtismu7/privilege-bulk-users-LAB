// Real, with the network replaced by the Mock world behind a stub fetch, and the PRODUCTION netguard installed on top of it. This proves
// what Mock cannot: a Real job holds permits for exactly its own hosts and gives them back; a link that leaves the environment is
// refused before any call; a secret never appears in anything the server returns; and writes need the switch, the plan and the count.
import assert from 'node:assert/strict';
import test from 'node:test';
import { MOCK, createMockWorld } from '../src/mockWorld.js';
import { installNetguard, isAllowed } from '../src/netguard.js';
import { startApp } from './helpers.js';

const trueFetch = globalThis.fetch;
const seen = [];
let world;
function stubNetwork(w, tweak) {
  world = w;
  globalThis.fetch = async (u, init) => {
    const url = new URL(typeof u === 'string' || u instanceof URL ? u : u.url);
    if (url.hostname === '127.0.0.1') return trueFetch(u, init); // the test's own calls to the app
    seen.push(url.hostname);
    return (tweak ? tweak(url, init, w) : null) ?? w.fetchImpl(url.href, init);
  };
}
const REAL = {
  PRIVILEGE_BULK_MODE: 'real', BULK_P1_REGION: 'com', BULK_P1_SOURCE_ENV_ID: MOCK.sourceEnvId, BULK_P1_PRIVILEGE_ENV_ID: MOCK.privilegeEnvId,
  BULK_P1_WORKER_CLIENT_ID: MOCK.clientId, BULK_P1_WORKER_CLIENT_SECRET: MOCK.clientSecret, BULK_P1_GROUP: MOCK.group,
  BULK_CONSOLE_URL: MOCK.consoleUrl, BULK_CONSOLE_TENANT: MOCK.tenant, BULK_CONSOLE_API_KEY: MOCK.apiKey, BULK_CONSOLE_API_SECRET: MOCK.apiSecret,
};
const fresh = (o = {}) => createMockWorld({ scenario: 'clean', users: 100, region: 'com', latencyMs: 0, ...o });

// The stub network sits UNDER the production netguard: stub first, then the guard wraps it, as in the real process.
async function withReal(fn, { env = REAL, w = fresh(), tweak } = {}) {
  stubNetwork(w, tweak);
  const g = installNetguard();
  seen.length = 0;
  const s = await startApp({ env });
  try { await fn(s, w, g); } finally { await s.close(); g.restore(); globalThis.fetch = trueFetch; }
}

test('Real route a: only the PingOne hosts, only while the job runs; writes need the switch, the plan and the count; no secret in any answer', async () => {
  await withReal(async (s, w, g) => {
    const info = (await s.call('GET', '/api/info')).json;
    assert.equal(info.mode, 'real'); assert.equal(info.routes.a.realReady, true); assert.equal(info.writesEnabled, false);
    const plan = await s.plan({ route: 'a' });
    assert.equal(plan.state, 'done', JSON.stringify(plan.error)); assert.equal(plan.source, 'real');
    assert.deepEqual(plan.counts, w.expected('a'));
    assert.deepEqual([...new Set(seen)].sort(), ['api.pingone.com', 'auth.pingone.com']);
    assert.deepEqual(g.attempts, [], 'every call was inside a permit');
    assert.equal(isAllowed('api.pingone.com'), false, 'the permits were given back when the job ended');
    assert.equal(w.state().created, 0, 'a plan writes nothing');

    const off = await s.call('POST', '/api/apply', { planId: plan.planId, confirm: `REGISTER ${plan.counts.toApply}` });
    assert.equal(off.status, 403); assert.equal(off.json.error, 'writes_disabled'); assert.equal(w.state().created, 0);
    assert.equal((await s.call('POST', '/api/writes', { enabled: 'yes' })).status, 400);
    assert.equal((await s.call('POST', '/api/writes', { enabled: true })).json.writesEnabled, true);
    assert.equal((await s.call('POST', '/api/apply', { planId: plan.planId, confirm: 'REGISTER' })).json.error, 'confirm_required');
    const applied = await s.apply(plan);
    assert.equal(applied.state, 'done', JSON.stringify(applied.error)); assert.equal(applied.counts.pending, 0);
    assert.equal(w.state().created, plan.counts['create+add']);
    const verify = await s.plan({ route: 'a' });
    assert.equal(verify.counts.toApply, 0);

    const everything = [(await s.call('GET', '/api/info')).text, (await s.call('GET', '/api/jobs/current')).text, (await s.call('GET', '/api/jobs/current/results?limit=500')).text,
      (await s.call('GET', '/api/report?format=json')).text, (await s.call('GET', '/api/report?format=csv')).text, (await s.call('GET', '/api/audit')).text].join('\n');
    for (const secret of [MOCK.clientSecret, MOCK.apiSecret, MOCK.apiKey]) assert.ok(!everything.includes(secret), 'a credential never leaves the server');
    assert.ok((await s.call('POST', '/api/reset')).json.writesTurnedOff, 'Reset turns the writes switch off');
    assert.equal((await s.call('GET', '/api/info')).json.writesEnabled, false);
  });
});

test('Real route b: the console host is permitted for the job and no longer; the console 401 is a named stop', async () => {
  await withReal(async (s, w, g) => {
    const plan = await s.plan({ route: 'b' });
    assert.equal(plan.state, 'done', JSON.stringify(plan.error)); assert.deepEqual(plan.counts, w.expected('b'));
    assert.deepEqual([...new Set(seen)].sort(), ['api.pingone.com', 'auth.pingone.com', 'console.privlab.invalid']);
    assert.deepEqual(g.attempts, []);
    assert.equal(isAllowed('console.privlab.invalid'), false);
  });
  await withReal(async (s) => {
    const plan = await s.plan({ route: 'b' });
    assert.equal(plan.state, 'failed'); assert.equal(plan.error.code, 'login_required'); assert.match(plan.error.message, /BULK_CONSOLE_API_KEY/);
    assert.ok(!JSON.stringify(plan).includes('wrong-secret-9'));
  }, { env: { ...REAL, BULK_CONSOLE_API_SECRET: 'wrong-secret-9' } });
});

test('Real: a pagination link that leaves the environment stops the job before any call to that host', async () => {
  await withReal(async (s, _w, g) => {
    const plan = await s.plan({ route: 'a' });
    assert.equal(plan.state, 'failed'); assert.equal(plan.error.code, 'source_unreadable'); assert.match(plan.error.message, /left this environment/);
    assert.ok(!seen.includes('evil.example'), 'the foreign host was never called');
    assert.deepEqual(g.attempts, [], 'and the guard was never even asked');
  }, { tweak: (url) => (url.pathname.endsWith('/users') && url.pathname.includes(MOCK.sourceEnvId) ? new Response(JSON.stringify({ _embedded: { users: [] }, _links: { next: { href: 'https://evil.example/v1/environments/x/users' } } }), { status: 200 }) : null) });
});

test('Real: a wrong worker secret is a named stop that does not echo it; scenario and users are Mock-only; missing settings name the setting', async () => {
  await withReal(async (s) => {
    const plan = await s.plan({ route: 'a' });
    assert.equal(plan.state, 'failed'); assert.equal(plan.error.code, 'token_refused'); assert.ok(!JSON.stringify(plan).includes('wrong-worker-secret'));
  }, { env: { ...REAL, BULK_P1_WORKER_CLIENT_SECRET: 'wrong-worker-secret' } });
  await withReal(async (s) => {
    const r = await s.call('POST', '/api/plan', { route: 'a', scenario: 'clean' });
    assert.equal(r.status, 400); assert.match(r.json.message, /Mock-only/);
  });
  await withReal(async (s) => {
    const r = await s.call('POST', '/api/plan', { route: 'a' });
    assert.equal(r.status, 409); assert.equal(r.json.error, 'needs_setup'); assert.match(r.json.message, /BULK_P1_GROUP/);
    assert.equal((await s.call('GET', '/api/jobs/current')).json.job, null, 'nothing started');
  }, { env: { ...REAL, BULK_P1_GROUP: '' } });
});

test('Real is refused off loopback: the server starts in Mock, the toggle answers 409, and nothing real is ever called', async () => {
  await withReal(async (s, w, g) => {
    const info = (await s.call('GET', '/api/info')).json;
    assert.equal(info.mode, 'mock'); assert.equal(info.realAvailable, false); assert.deepEqual(info.real.failed, ['loopback-bind']);
    assert.equal((await s.call('POST', '/api/mode', { source: 'real' })).json.error, 'real_not_available');
    assert.equal((await s.call('POST', '/api/writes', { enabled: true })).json.error, 'mock_only');
    const plan = await s.plan({ route: 'a', scenario: 'clean', users: 100 });
    assert.equal(plan.source, 'mock'); assert.deepEqual(seen, [], 'the stub network was never reached'); assert.deepEqual(g.attempts, []);
  }, { env: { ...REAL, PBU_BIND: '0.0.0.0' } });
});

test('Real: a plan does not survive a trip through Mock and back; a console 403 on create stops route b with the rest pending', async () => {
  await withReal(async (s) => {
    const plan = await s.plan({ route: 'a' });
    assert.equal((await s.call('POST', '/api/mode', { source: 'mock' })).json.source, 'mock');
    assert.equal((await s.call('POST', '/api/mode', { source: 'real' })).json.source, 'real');
    assert.equal((await s.call('POST', '/api/writes', { enabled: true })).json.writesEnabled, true);
    const r = await s.call('POST', '/api/apply', { planId: plan.planId, confirm: `REGISTER ${plan.counts.toApply}` });
    assert.equal(r.status, 409); assert.equal(r.json.error, 'no_plan', 'flipping back does not revive the old plan');
  });
  await withReal(async (s) => {
    const plan = await s.plan({ route: 'b' });
    await s.call('POST', '/api/writes', { enabled: true });
    const done = await s.apply(plan);
    assert.equal(done.state, 'failed'); assert.equal(done.error.code, 'login_required');
    assert.ok(done.counts.pending > 0, 'the refused credential stopped the run');
    assert.ok(!JSON.stringify(done).includes(MOCK.apiSecret));
  }, { tweak: (url, init) => (url.hostname.includes('privlab') && init?.method === 'POST' ? new Response('{}', { status: 403 }) : null) });
});
