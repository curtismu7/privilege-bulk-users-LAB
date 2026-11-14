// A hostile upstream tries to get a credential into a response, a row, an error, a report or the audit file. None may appear.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { MOCK, REAL, withReal, fresh } from './abuse-lib.js';

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const everything = async (s) => {
  const get = async (p) => (await s.call('GET', p)).text;
  const parts = [await get('/api/info'), await get('/api/jobs/current'), await get('/api/jobs/current/results?limit=500'), await get('/api/report?format=json'), await get('/api/report?format=csv'), await get('/api/audit'), await get('/api/health')];
  try { parts.push(fs.readFileSync(s.dir + '/audit.jsonl', 'utf8')); } catch { /* none */ }
  return parts.join('\n');
};
const AUTHZ = (init) => String(init?.headers?.authorization || '');

test('S1 hostile upstream echoes the Authorization header (Bearer token) in `code` on a create', async () => {
  await withReal(async (s) => {
    const plan = await s.plan({ route: 'a' });
    await s.call('POST', '/api/writes', { enabled: true });
    const done = await s.apply(plan);
    const all = await everything(s);
    const leaked = all.includes('mock-token');
    const row = (await s.call('GET', '/api/jobs/current/results?status=failed&limit=1')).json.rows[0];
    assert.ok(!leaked, 'the bearer token must never reach a response');
  }, { tweak: (url, init) => (init?.method === 'POST' && url.pathname.endsWith('/users') ? json(400, { code: AUTHZ(init).replace(/^Bearer /, ''), message: 'echo' }) : null) });
});

test('S2 hostile upstream echoes the worker secret padded so the 80-char clip cuts it: a PREFIX of the secret survives scrub', async () => {
  await withReal(async (s) => {
    const plan = await s.plan({ route: 'a' });
    await s.call('POST', '/api/writes', { enabled: true });
    await s.apply(plan);
    const all = await everything(s);
    const prefix = MOCK.clientSecret.slice(0, 9);
    assert.ok(!all.includes(prefix), 'no part of the secret (>=4 chars) may be shown');
  }, { tweak: (url, init) => (init?.method === 'POST' && url.pathname.endsWith('/users') ? json(400, { code: 'x'.repeat(62) + MOCK.clientSecret }) : null) });
});

test('S3 job.error.message path (source_unreadable) echoes the Bearer token and the Basic credential', async () => {
  for (const [label, mk] of [['bearer', (init) => AUTHZ(init).replace(/^Bearer /, '')], ['basic', () => 'Basic ' + Buffer.from(`${MOCK.clientId}:${MOCK.clientSecret}`).toString('base64')]]) {
    await withReal(async (s) => {
      const plan = await s.plan({ route: 'a' });
      const all = await everything(s);
      const leak = label === 'bearer' ? all.includes('mock-token') : all.includes(Buffer.from(`${MOCK.clientId}:${MOCK.clientSecret}`).toString('base64'));
      assert.ok(!leak);
    }, { tweak: (url, init) => (init?.method !== 'POST' && url.pathname.endsWith(`${MOCK.sourceEnvId}/users`) ? json(400, { code: mk(init) }) : null) });
  }
});

test('S4 route b: console echoes api key/secret; and a Retry-After / error body path', async () => {
  await withReal(async (s) => {
    const plan = await s.plan({ route: 'b' });
    await s.call('POST', '/api/writes', { enabled: true });
    const done = plan.counts?.toApply ? await s.apply(plan) : plan;
    const all = await everything(s);
    for (const secret of [MOCK.apiKey, MOCK.apiSecret, MOCK.clientSecret]) console.log('S4 leaked', secret.slice(0, 5), all.includes(secret));
    assert.ok(![MOCK.apiKey, MOCK.apiSecret, MOCK.clientSecret].some((x) => all.includes(x)));
  }, { tweak: (url, init) => (url.hostname.includes('privlab') && init?.method === 'POST' ? json(400, { code: init.headers['x-api-secret'] + init.headers['x-api-key'], error: init.headers['x-api-key'] }) : null) });
});

test('S5 baseline: with a well-behaved upstream nothing secret is anywhere (control)', async () => {
  await withReal(async (s) => {
    const plan = await s.plan({ route: 'a' });
    await s.call('POST', '/api/writes', { enabled: true });
    await s.apply(plan);
    const all = await everything(s);
    for (const secret of [MOCK.clientSecret, MOCK.apiSecret, MOCK.apiKey, 'mock-token']) assert.ok(!all.includes(secret), secret);
  });
});

test('S3b Basic credential (base64 of id:secret) echoed in a code', async () => {
  const b64 = Buffer.from(`${MOCK.clientId}:${MOCK.clientSecret}`).toString('base64');
  await withReal(async (s) => {
    const plan = await s.plan({ route: 'a' });
    const all = await everything(s);
    assert.ok(!all.includes(b64));
  }, { tweak: (url, init) => (init?.method !== 'POST' && url.pathname.endsWith(`${MOCK.sourceEnvId}/users`) ? json(400, { code: 'Basic ' + b64 }) : null) });
});
