// Mock / Real: Real is refused unless every guard passes (owner opt-in, loopback bind). Mock never needs the network.
import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { MODE_KEY, modeFrom, realGuards, realRefusal } from '../src/config.js';
import { startApp } from './helpers.js';
import { installNetguard } from './netguard.js';

const guard = installNetguard();
let s;
before(async () => { s = await startApp({ env: { [MODE_KEY]: 'mock' } }); });
after(async () => { await s.close(); assert.deepEqual(guard.attempts, [], 'zero outbound attempts'); guard.restore(); });

test('GET /api/info: Mock is the mode, Real is refused and says which guard failed; the shape the page reads', async () => {
  const r = await s.call('GET', '/api/info');
  assert.equal(r.status, 200); assert.equal(r.headers.get('cache-control'), 'no-store');
  const i = r.json;
  assert.equal(i.mode, 'mock'); assert.equal(i.source, 'mock'); assert.equal(i.realAvailable, false); assert.deepEqual(i.modes, ['mock', 'real']);
  assert.deepEqual(i.real.failed, ['owner-opt-in']); assert.ok(i.real.needs[0].includes(MODE_KEY)); assert.match(i.realReason, /Real is refused/);
  assert.deepEqual(Object.keys(i.routes), ['a', 'b']);
  assert.equal(i.routes.a.realReady, false); assert.ok(i.routes.a.missing.includes('BULK_P1_WORKER_CLIENT_SECRET'));
  assert.equal(i.writesEnabled, false);
  assert.deepEqual(i.limits, { maxUsers: 50000, concurrency: { min: 1, max: 16, default: 6 } });
  assert.deepEqual(i.mock.datasets, [100, 500, 5000]);
  assert.deepEqual(i.mock.scenarios.map((x) => x.id), ['realistic', 'clean', 'rate-limited', 'flaky', 'conflicts', 'missing-role']);
  assert.ok(i.mock.scenarios.every((x) => x.label && x.description));
});

test('POST /api/mode: exactly {source}; Real is a 409 with the reason while the guards fail; Mock stays', async () => {
  for (const body of [{}, { source: 'both' }, { source: 'REAL' }, { mode: 'real' }]) assert.equal((await s.call('POST', '/api/mode', body)).status, 400);
  const r = await s.call('POST', '/api/mode', { source: 'real' });
  assert.equal(r.status, 409); assert.equal(r.json.error, 'real_not_available'); assert.match(r.json.message, /owner-opt-in/);
  assert.equal((await s.call('GET', '/api/info')).json.mode, 'mock');
  assert.equal((await s.call('POST', '/api/mode', { source: 'mock' })).json.source, 'mock');
});

test('with Real refused, a Real plan is refused too, and Mock plans work', async () => {
  // runMode is mock here, so the plan runs as Mock; the guards are checked when Real is selected (real.test.js).
  const plan = await s.plan({ route: 'a', scenario: 'clean', users: 100 });
  assert.equal(plan.state, 'done'); assert.equal(plan.source, 'mock');
});

test('the guards: Real needs the owner opt-in and a loopback bind (or the container opt-in)', () => {
  assert.deepEqual(realGuards({}).map((g) => [g.id, g.ok]), [['owner-opt-in', false], ['loopback-bind', true]]);
  assert.equal(realRefusal({ [MODE_KEY]: 'real' }), null);
  assert.deepEqual(realRefusal({ [MODE_KEY]: 'real', PBU_BIND: '0.0.0.0', PBU_CONTAINER: '1' }), null, 'the container sets both and is published on 127.0.0.1 only');
  assert.deepEqual(realRefusal({ [MODE_KEY]: 'real', PBU_BIND: '127.0.0.1' }), null);
  for (const bind of ['0.0.0.0', '::', '192.0.2.1']) assert.deepEqual(realRefusal({ [MODE_KEY]: 'real', PBU_BIND: bind })?.failed, ['loopback-bind']);
  assert.deepEqual(realRefusal({ [MODE_KEY]: 'real', PBU_BIND: '0.0.0.0', PBU_CONTAINER: '0' })?.failed, ['loopback-bind'], 'only the exact marker counts');
  assert.deepEqual(realRefusal({ PBU_BIND: '0.0.0.0' })?.failed, ['owner-opt-in', 'loopback-bind']);
});

test('modeFrom: mock by default, real only when asked, anything else is an error, a bare MODE is ignored', () => {
  assert.equal(modeFrom({}), 'mock'); assert.equal(modeFrom({ [MODE_KEY]: '' }), 'mock'); assert.equal(modeFrom({ [MODE_KEY]: 'real' }), 'real');
  assert.equal(modeFrom({ MODE: 'real' }), 'mock', 'another app\'s MODE must not switch this one');
  for (const bad of ['Real', 'live', 'true', 'mock ']) assert.throws(() => modeFrom({ [MODE_KEY]: bad }), /is not a mode/);
  assert.throws(() => modeFrom({ [MODE_KEY]: 'x\u0000y' }), /x\?y/, 'control characters are not echoed');
});

test('an unknown route and a malformed body answer JSON, never an HTML error page that echoes the path', async () => {
  const nf = await s.call('GET', '/api/<script>alert(1)</script>');
  assert.equal(nf.status, 404); assert.equal(nf.json.error, 'not_found'); assert.ok(!nf.text.includes('script'));
  const bad = await fetch(`${s.origin}/api/plan`, { method: 'POST', headers: { 'content-type': 'application/json', origin: s.origin }, body: '{nope' });
  assert.equal(bad.status, 400); assert.equal((await bad.json()).error, 'bad_request');
  const big = await fetch(`${s.origin}/api/plan`, { method: 'POST', headers: { 'content-type': 'application/json', origin: s.origin }, body: JSON.stringify({ route: 'a', pad: 'x'.repeat(30_000) }) });
  assert.equal(big.status, 413);
  const cross = await s.call('POST', '/api/plan', { route: 'a' }, { origin: 'https://evil.example' });
  assert.equal(cross.status, 403); assert.equal(cross.json.error, 'cross_origin');
});

test('an unsupported Content-Encoding or charset is a 415 in JSON with fixed text, not a 500 and not an echo of what was sent', async () => {
  const post = (headers) => fetch(`${s.origin}/api/plan`, { method: 'POST', headers: { origin: s.origin, ...headers }, body: '{}' });
  const enc = await post({ 'content-type': 'application/json', 'content-encoding': 'x-<script>alert(1)</script>' });
  const encBody = await enc.text();
  assert.equal(enc.status, 415, encBody);
  assert.equal(JSON.parse(encBody).error, 'unsupported_media');
  assert.ok(!encBody.includes('script'), 'the encoding name is not echoed');
  const cs = await post({ 'content-type': 'application/json; charset=iso-8859-1' }); // the parser accepts any utf-*; this one it refuses
  assert.equal(cs.status, 415);
  assert.equal((await cs.json()).error, 'unsupported_media');
  const plain = await post({ 'content-type': 'application/json' }); // the same request with nothing wrong is read normally
  assert.notEqual(plain.status, 415); assert.notEqual(plain.status, 500);
});
