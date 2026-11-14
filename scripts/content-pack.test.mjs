import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { PACK_PATH, buildPack, serialize } from './build-content-pack.mjs';
import { validatePack } from './validate-content-pack.mjs';

test('content-pack.json is exactly what the generator produces (run: npm run content-pack)', () => {
  assert.equal(fs.readFileSync(PACK_PATH, 'utf8'), serialize(buildPack()), 'content-pack.json is stale; regenerate it and commit the result');
});
test('the generator is deterministic', () => assert.equal(serialize(buildPack()), serialize(buildPack())));
test('content-pack.json validates against docs/content-pack.schema.json (ajv)', () => {
  assert.deepEqual(validatePack(JSON.parse(fs.readFileSync(PACK_PATH, 'utf8'))), []);
});
test('the validator rejects a broken pack', () => {
  const pack = buildPack();
  pack.cards[0].terms = ['no-such-term'];
  delete pack.title;
  assert.ok(validatePack(pack).length >= 2);
});
test('the pack is about this app: its id and name, the placeholder catalog id, the port, the health path', () => {
  const { demo, id, title } = buildPack();
  assert.equal(id, 'privilege-bulk-users');
  assert.equal(title, 'Privilege Bulk Users LAB');
  assert.deepEqual({ id: demo.id, name: demo.name, catalog: demo.catalog, baseUrl: demo.baseUrl, doctor: demo.doctor }, { id: 'privilege-bulk-users', name: 'Privilege Bulk Users LAB', catalog: 'D000', baseUrl: 'http://localhost:7817', doctor: '/api/health' });
});
test('the pack teaches the lab: the two routes, the empty-list trap, snapshot and diff, 429 back-off, idempotent verify, the two-step gate', () => {
  const pack = buildPack();
  for (const id of ['route-a', 'route-b', 'privilege-group', 'identity-data-admin', 'empty-list-trap', 'snapshot-diff', 'rate-limit-backoff', 'idempotent-verify', 'two-step-gate', 'plan-apply-verify', 'conflict', 'circuit-breaker', 'mock-world', 'netguard', 'audit-log', 'simulation-honesty']) assert.ok(pack.glossary.some((g) => g.id === id), id);
  const taught = new Set(pack.cards.flatMap((c) => c.terms ?? []));
  for (const g of pack.glossary) assert.ok(taught.has(g.id), `no card teaches the term ${g.id}`);
  assert.deepEqual(pack.cards.map((c) => c.action.type).filter((t) => t !== 'route'), []);
  for (const c of pack.cards) assert.match(c.action.href, /^\/#\/(guide|run|diagram|audit|help)$/, `${c.id} links to a real page`);
});
test('route B is labelled UNVERIFIED in the pack, and no source is listed that was not fetched', () => {
  const pack = buildPack();
  assert.match(pack.glossary.find((g) => g.id === 'route-b').definition, /UNVERIFIED/);
  assert.deepEqual(pack.sources, []);
  assert.deepEqual(pack.stories, []);
});
test('a commit is recorded only when passed', () => {
  assert.equal(buildPack().source, undefined);
  assert.equal(buildPack({ commit: 'abc1234' }).source.commit, 'abc1234');
});
