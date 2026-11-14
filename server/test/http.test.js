// The resilient call path: Retry-After parsing, the shared 429 gate, retries that report instead of throw.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createGate, createResilient, newStats, parseRetryAfter } from '../src/http.js';

const res = (status, { body = '{}', headers = {} } = {}) => new Response(body, { status, headers });
const seq = (...items) => async () => { const x = items.shift(); if (x instanceof Error) throw x; return x; };
const make = (fetchImpl, o = {}) => { const gate = createGate({ scale: 0.001 }); const stats = newStats(); return { gate, stats, call: createResilient({ fetchImpl, gate, stats, ...o }) }; };

test('Retry-After: seconds, fractions, an HTTP date, garbage, a huge value and the past', () => {
  const now = Date.parse('2026-01-01T00:00:00Z');
  assert.equal(parseRetryAfter('2'), 2000);
  assert.equal(parseRetryAfter('0.5'), 500);
  assert.equal(parseRetryAfter('Thu, 01 Jan 2026 00:00:03 GMT', now), 3000);
  assert.equal(parseRetryAfter('Wed, 31 Dec 2025 23:59:00 GMT', now), 250, 'a date in the past is the minimum wait, never zero');
  assert.equal(parseRetryAfter('0'), 250, 'a server that says 0 is still told off: the floor');
  for (const v of [undefined, null, '', 'soon', '-5', '1e9x']) assert.equal(parseRetryAfter(v), 1000, `default for ${String(v)}`);
  assert.ok(parseRetryAfter('soon 12') >= 250 && parseRetryAfter('1 jan') >= 250, 'junk with letters never becomes an instant retry');
  assert.equal(parseRetryAfter('99999'), 60_000, 'capped: a server hint must not park the run');
});

test('the gate: one 429 holds every worker, and a pause is never shortened', async () => {
  const gate = createGate({ scale: 0.05 }); // 1000 ms -> 50 ms
  assert.ok(gate.pause(1000) > 40);
  const t0 = Date.now();
  await Promise.all([gate.wait(), gate.wait(), gate.wait()]);
  assert.ok(Date.now() - t0 >= 40, 'all three waited');
  gate.pause(2000); const held = gate.pause(10);
  assert.ok(held > 60, 'a shorter pause does not cut the longer one');
  assert.ok(gate.waitedMs() >= 90);
});

test('a 5xx is retried with back-off and reported, never thrown', async () => {
  const a = make(seq(res(503), res(503), res(200, { body: '{"ok":true}' })));
  const r = await a.call('https://x.invalid/a');
  assert.equal(r.status, 200); assert.equal(r.tries, 3); assert.deepEqual(r.json, { ok: true });
  assert.equal(a.stats.calls, 3); assert.equal(a.stats.retries, 2);
  const b = make(seq(res(500), res(500), res(500), res(500)));
  const f = await b.call('https://x.invalid/a');
  assert.equal(f.status, 500, 'after the last try the answer is returned for the caller to name'); assert.equal(f.tries, 4);
});

test('a network error is retried, then reported as status 0 with its code', async () => {
  const e = () => Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } });
  const a = make(seq(e(), e(), e(), e()));
  const r = await a.call('https://x.invalid/a');
  assert.equal(r.status, 0); assert.equal(r.error, 'ECONNRESET'); assert.equal(r.tries, 4);
});

test('a 429 pauses, honours Retry-After and goes again without spending a retry of the failure budget', async () => {
  const a = make(seq(res(429, { headers: { 'retry-after': '1' } }), res(429, { headers: { 'retry-after': '1' } }), res(200)));
  const r = await a.call('https://x.invalid/a');
  assert.equal(r.status, 200); assert.equal(a.stats.rate429, 2); assert.ok(a.gate.waitedMs() >= 1);
  const forever = make(async () => res(429, { headers: { 'retry-after': '0' } }));
  const g = await forever.call('https://x.invalid/a');
  assert.equal(g.status, 429, 'a limit that never lifts is handed back, not looped on forever'); assert.equal(forever.stats.rate429, 21); assert.equal(forever.stats.retries, 20, 'retries count the re-sends, not the last answer');
});

test('a 4xx other than 429 is not retried; an abort throws', async () => {
  const a = make(seq(res(404)));
  assert.equal((await a.call('https://x.invalid/a')).status, 404); assert.equal(a.stats.retries, 0);
  const ctl = new AbortController(); ctl.abort();
  await assert.rejects(make(async () => res(200), { signal: ctl.signal }).call('https://x.invalid/a'), (err) => err.code === 'aborted');
});
