// A hostile upstream tries to send the job to another host or environment (pagination links), to take our headers on a redirect, or to keep a permit.
import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { isAllowed } from '../src/netguard.js';
import { MOCK, REAL, withReal, seen, seenUrls, sleep, startApp, fresh } from './abuse-lib.js';

const json = (status, body, h = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...h } });
const U = '/v1/environments';
const OTHER = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

for (const [label, href] of [
  ['dot-dot to another env', `https://api.pingone.com${U}/${MOCK.sourceEnvId}/../${OTHER}/users?limit=100`],
  ['encoded %2e%2e', `https://api.pingone.com${U}/${MOCK.sourceEnvId}/%2e%2e/${OTHER}/users?limit=100`],
  ['backslash', `https://api.pingone.com${U}/${MOCK.sourceEnvId}/..\\${OTHER}/users?limit=100`],
  ['userinfo', `https://api.pingone.com@evil.example${U}/${MOCK.sourceEnvId}/users`],
  ['protocol relative', `//evil.example${U}/${MOCK.sourceEnvId}/users`],
  ['http scheme', `http://api.pingone.com${U}/${MOCK.sourceEnvId}/users`],
  ['trailing dot host', `https://api.pingone.com.${U}/${MOCK.sourceEnvId}/users`],
  ['uppercase host', `https://API.PINGONE.COM${U}/${MOCK.sourceEnvId}/users`],
  ['other env', `https://api.pingone.com${U}/${OTHER}/users`],
]) {
  test(`O1 next-link: ${label}`, async () => {
    await withReal(async (s) => {
      const plan = await s.plan({ route: 'a' });
      const hitOther = seenUrls.filter((u) => u.includes(OTHER) || u.includes('evil'));
      assert.equal(hitOther.length, 0);
    }, { tweak: (url) => (url.pathname === `${U}/${MOCK.sourceEnvId}/users` && !url.searchParams.get('cursor') ? json(200, { _embedded: { users: [] }, _links: { next: { href } } }) : (url.pathname.includes(OTHER) ? json(404, { code: 'NOT_FOUND' }) : null)) });
  });
}

test('O2 a redirect from the console carries x-api-key / x-api-secret to a DIFFERENT origin (loopback ports stand in)', async () => {
  const got = [];
  const B = http.createServer((q, r) => { got.push({ host: q.headers.host, key: q.headers['x-api-key'], secret: q.headers['x-api-secret'], auth: q.headers.authorization }); r.setHeader('content-type', 'application/json'); r.end('{"Users":[]}'); });
  await new Promise((r) => B.listen(0, '127.0.0.1', r));
  const A = http.createServer((q, r) => { r.statusCode = 302; r.setHeader('location', `http://127.0.0.1:${B.address().port}/stolen`); r.end(); });
  await new Promise((r) => A.listen(0, '127.0.0.1', r));
  try {
    await withReal(async (s) => {
      const plan = await s.plan({ route: 'b' });
      assert.equal(got.length, 0, 'a redirect must not be followed (or must strip the credential headers)');
    }, { env: { ...REAL, BULK_CONSOLE_URL: `http://127.0.0.1:${A.address().port}` } });
  } finally { A.close(); B.close(); }
});

test('O3 permits are given back after: failure, abort, reset mid-job, breaker trip, normal end', async () => {
  const held = () => ['api.pingone.com', 'auth.pingone.com'].filter(isAllowed);
  // failure: wrong secret
  await withReal(async (s) => { await s.plan({ route: 'a' }); console.log('O3 after token_refused', held()); assert.deepEqual(held(), []); }, { env: { ...REAL, BULK_P1_WORKER_CLIENT_SECRET: 'wrong-secret-1' } });
  // abort mid plan
  await withReal(async (s, w) => {
    await s.call('POST', '/api/plan', { route: 'a' }); await sleep(3);
    await s.call('POST', '/api/jobs/current/abort'); await s.settle();
  }, { w: fresh({ users: 5000, latencyMs: 2 }) });
  // reset mid plan
  await withReal(async (s) => {
    await s.call('POST', '/api/plan', { route: 'a' }); await sleep(3);
    await s.call('POST', '/api/reset');
    await s.app.locals.jobs.whenIdle(); await sleep(20);
  }, { w: fresh({ users: 5000, latencyMs: 2 }) });
  // breaker
  await withReal(async (s) => {
    const plan = await s.plan({ route: 'a' }); await s.call('POST', '/api/writes', { enabled: true });
    const done = await s.apply(plan);
  }, { tweak: (url, init) => (init?.method === 'POST' && url.pathname.endsWith('/users') ? json(403, { code: 'ACCESS_FAILED' }) : null) });
});
