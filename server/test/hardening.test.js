// Holes an independent review found by mutating the code: each test here fails if the named behaviour is removed.
import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { createConsole, insecureFetch } from '../src/console.js';
import { createGate, createResilient, newStats } from '../src/http.js';
import { MOCK, createMockWorld } from '../src/mockWorld.js';
import { createPingOne } from '../src/pingone.js';
import { runPool } from '../src/pool.js';

const json = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const API = 'https://api.pingone.com/v1/environments';
const ENV = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const client = (fetchImpl, opts = {}) => {
  const secrets = []; const gate = createGate({ scale: 0 }); const stats = newStats();
  const resilient = createResilient({ fetchImpl, gate, stats });
  return { stats, secrets, p1: createPingOne({ resilient, region: 'com', workerEnvId: ENV, clientId: 'cid', clientSecret: 'sentinel-secret-1', secrets, ...opts }) };
};
// A PingOne that serves `n` source users, 100 a page, following _links.next.
const pagedFetch = (n, { onUrl } = {}) => async (url, init) => {
  const u = new URL(url); onUrl?.(u, init);
  if (u.hostname.startsWith('auth.')) return json(200, { access_token: 'tok-abcdef', expires_in: 3600 });
  const at = Number(u.searchParams.get('cursor')) || 0; const items = Array.from({ length: Math.max(0, Math.min(100, n - at)) }, (_, i) => ({ id: `u${at + i}`, username: `u${at + i}`, email: `u${at + i}@x.example` }));
  return json(200, { _embedded: { users: items }, ...(at + 100 < n ? { _links: { next: { href: `${API}/${ENV}/users?limit=100&cursor=${at + 100}` } } } : {}) });
};

test('truncation is exact: max people are planned, one over says truncated, exactly max does not', async () => {
  const { p1 } = client(pagedFetch(250));
  assert.deepEqual([(await p1.listUsers(ENV, { max: 250 })).items.length, (await p1.listUsers(ENV, { max: 250 })).truncated], [250, false]);
  const over = await p1.listUsers(ENV, { max: 249 });
  assert.deepEqual([over.items.length, over.truncated], [249, true]);
  const cut = await p1.listUsers(ENV, { max: 120 });
  assert.deepEqual([cut.items.length, cut.truncated], [120, true]);
});

test('an environment id typed in upper case still follows its own pagination links', async () => {
  const { p1 } = client(pagedFetch(250));
  assert.equal((await p1.listUsers(ENV.toUpperCase())).items.length, 250);
});

test('pagination guards: a repeated link and an endless run of fresh links both stop the job', async () => {
  const same = client(async (url) => (new URL(url).hostname.startsWith('auth.') ? json(200, { access_token: 'tok-abcdef' }) : json(200, { _embedded: { users: [] }, _links: { next: { href: `${API}/${ENV}/users?limit=100&cursor=100` } } })));
  await assert.rejects(same.p1.listUsers(ENV), /looped/);
  let n = 0;
  const fresh = client(async (url) => (new URL(url).hostname.startsWith('auth.') ? json(200, { access_token: 'tok-abcdef' }) : json(200, { _embedded: { users: [] }, _links: { next: { href: `${API}/${ENV}/users?limit=100&cursor=${++n}` } } })));
  await assert.rejects(fresh.p1.listUsers(ENV), /past 1000 pages/);
  assert.ok(n <= 1001, 'it stopped at the page limit');
});

test('the group lookup is an encoded filter and accepts only the exact name', async () => {
  const urls = [];
  const odd = client(async (url) => { const u = new URL(url); if (u.hostname.startsWith('auth.')) return json(200, { access_token: 'tok-abcdef' }); urls.push(u); return json(200, { _embedded: { groups: [{ id: 'g-other', name: 'Domain Admins' }] } }); });
  assert.equal(await odd.p1.findGroup(ENV, 'A&B C'), null, 'a filter that answers with some other group never puts people in it');
  assert.ok(urls[0].search.includes('filter=name%20eq%20%22A%26B%20C%22'), urls[0].search);
  const ok = client(async (url) => (new URL(url).hostname.startsWith('auth.') ? json(200, { access_token: 'tok-abcdef' }) : json(200, { _embedded: { groups: [{ id: 'g1', name: 'Other' }, { id: 'g2', name: 'Mine' }] } })));
  assert.deepEqual(await ok.p1.findGroup(ENV, 'Mine'), { id: 'g2', name: 'Mine' });
});

test('an expired token is refreshed once and the call goes through; the token is in the scrub list from the moment it is issued', async () => {
  const world = createMockWorld({ scenario: 'clean', users: 100, region: 'com', latencyMs: 0 });
  const { p1, secrets } = client(world.fetchImpl, { clientId: MOCK.clientId, clientSecret: MOCK.clientSecret });
  assert.equal((await p1.listUsers(MOCK.sourceEnvId)).items.length, 100);
  assert.equal(world.tokensIssued(), 1);
  world.expireToken();
  assert.equal((await p1.listUsers(MOCK.sourceEnvId)).items.length, 100, 'a 401 got one fresh token and one retry');
  assert.equal(world.tokensIssued(), 2);
  assert.ok(secrets.includes('mock-token-1') && secrets.includes('mock-token-2') && secrets.includes('Bearer mock-token-2'));
  assert.ok(secrets.some((s) => s.startsWith('Basic ')), 'and the Basic credential');
});

test('a create carries the default population and a JSON content type', async () => {
  const world = createMockWorld({ scenario: 'clean', users: 100, region: 'com', latencyMs: 0 });
  const { p1 } = client(world.fetchImpl, { clientId: MOCK.clientId, clientSecret: MOCK.clientSecret });
  const person = { username: 'newcomer', email: 'newcomer@corp.example', given: 'N', family: 'C' };
  assert.equal((await p1.createUser(MOCK.privilegeEnvId, person, null)).status, 400, 'no population: refused');
  const ok = await p1.createUser(MOCK.privilegeEnvId, person, MOCK.populationId);
  assert.equal(ok.status, 201);
  assert.equal((await p1.findUserByEmail(MOCK.privilegeEnvId, 'NEWCOMER@corp.example'))?.username, 'newcomer', 'and the lookup finds it, case-insensitively');
});

test('the pool never runs more than `concurrency` at once and does use that many', async () => {
  let live = 0; let peak = 0;
  await runPool(Array.from({ length: 40 }, (_, i) => i), 5, async () => { live++; peak = Math.max(peak, live); await new Promise((r) => setTimeout(r, 3)); live--; });
  assert.equal(peak, 5);
  const seen = []; await assert.rejects(runPool([1, 2, 3, 4, 5, 6], 1, async (x) => { seen.push(x); if (x === 2) throw new Error('boom'); }), /boom/);
  assert.deepEqual(seen, [1, 2], 'an error stops the others from taking new work');
});

test('after a 429 pause an abort sends nothing more; redirects are never followed; every call is sent with redirect: manual', async () => {
  const gate = createGate({ scale: 0.05 }); gate.pause(2000); // ~100 ms
  const ctl = new AbortController(); const sent = [];
  const call = createResilient({ fetchImpl: async (u, init) => { sent.push(init.redirect); return new Response('{}', { status: 200 }); }, gate, signal: ctl.signal });
  const p = call('https://x.invalid/a'); setTimeout(() => ctl.abort(), 20);
  await assert.rejects(p, (e) => e.code === 'aborted');
  assert.equal(sent.length, 0, 'the pause ended after the abort and nothing was sent');
  const ok = createResilient({ fetchImpl: async (u, init) => { sent.push(init.redirect); return new Response('', { status: 302, headers: { location: 'https://evil.example/' } }); }, gate: createGate({ scale: 0 }) });
  const r = await ok('https://x.invalid/b');
  assert.equal(r.status, 302); assert.deepEqual(sent, ['manual']);
});

test('a response that is too big is refused, not buffered; a timeout is named', async () => {
  const big = () => new Response(new ReadableStream({ pull(c) { c.enqueue(new Uint8Array(1_000_000)); } }), { status: 200 });
  const r = await createResilient({ fetchImpl: async () => big(), gate: createGate({ scale: 0 }) })('https://x.invalid/a');
  assert.equal(r.status, 0); assert.equal(r.error, 'too_large');
  const t = await createResilient({ fetchImpl: async () => { throw new DOMException('timed out', 'TimeoutError'); }, gate: createGate({ scale: 0 }) })('https://x.invalid/a');
  assert.equal(t.error, 'timeout');
});

test('an unusable HTTP status from the insecure console path is a rejection, not an uncaught exception', async () => {
  const srv = http.createServer((_q, r) => { r.writeHead(600); r.end('x'); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try { await assert.rejects(insecureFetch(`http://127.0.0.1:${srv.address().port}/`, { method: 'GET', headers: {} }), (e) => e.code === 'bad_status'); }
  finally { srv.closeAllConnections?.(); await new Promise((r) => srv.close(r)); }
});

test('the console answering 200 with something that is not a list is a named stop, never "no users"', async () => {
  for (const body of [{}, { Users: 'nope' }, [], { message: 'ok' }]) {
    const c = createConsole({ resilient: createResilient({ fetchImpl: async () => json(200, body), gate: createGate({ scale: 0 }) }), url: 'https://console.example', tenant: MOCK.tenant, apiKey: 'k', apiSecret: 's' });
    await assert.rejects(c.listUsers(), (e) => e.code === 'destination_unreadable' && /not with a list/.test(e.message), JSON.stringify(body));
  }
  const ok = createConsole({ resilient: createResilient({ fetchImpl: async () => json(200, { Users: [] }), gate: createGate({ scale: 0 }) }), url: 'https://console.example', tenant: MOCK.tenant, apiKey: 'k', apiSecret: 's' });
  assert.deepEqual(await ok.listUsers(), [], 'a real empty list is still empty');
});

test('a pagination link to another HOST is refused by the client itself, with no netguard to fall back on', async () => {
  for (const href of [`https://evil.example/v1/environments/${ENV}/users?limit=100&cursor=100`, `http://api.pingone.com/v1/environments/${ENV}/users?cursor=100`, `https://api.pingone.com.evil.example/v1/environments/${ENV}/users`, `https://u:p@api.pingone.com/v1/environments/${ENV}/users`]) {
    const hosts = [];
    const { p1 } = client(async (url) => { const u = new URL(url); hosts.push(u.href); if (u.hostname.startsWith('auth.')) return json(200, { access_token: 'tok-abcdef' }); return json(200, { _embedded: { users: [] }, _links: { next: { href } } }); });
    await assert.rejects(p1.listUsers(ENV), /left this environment/, href);
    assert.ok(!hosts.some((h) => /evil|u:p|^http:/.test(h)), `${href}: the foreign link was never requested`);
  }
});

test('an upstream "code" is shown only if it looks like a code: anything else is dropped even when it is not a secret we know', async () => {
  const { describe } = await import('../src/errors.js');
  for (const hostile of ['internal-host.corp.example', '<img src=x onerror=alert(1)>', 'Bearer abc.def.ghi', 'a b c', 'x'.repeat(200), 'lowercase_code', 'ACCESS_FAILED<script>']) {
    const line = describe({ status: 400, json: { code: hostile } }, []);
    assert.equal(line, 'HTTP 400', hostile);
  }
  assert.equal(describe({ status: 403, json: { code: 'ACCESS_FAILED' } }, []), 'HTTP 403 ACCESS_FAILED');
  assert.equal(describe({ status: 0, error: 'ECONNRESET' }, []), 'no answer (ECONNRESET)');
  assert.equal(describe({ status: 0, error: 'x<script>' }, []), 'no answer (x?script?)');
});
