// Matching two people by email or username folds ASCII letters only. toLowerCase() also folds the Kelvin sign (U+212A) onto "k", which
// would make a different character match somebody else's account and add THAT account to the Privilege group.
import assert from 'node:assert/strict';
import test from 'node:test';
import { lower } from '../src/fold.js';
import { planA } from '../src/routeA.js';
import { planB } from '../src/routeB.js';

const KELVIN = 'K';
const progress = { phase() {}, total() {}, processed() {} };
const raw = (id, username, email) => ({ id, username, email, name: { given: 'G', family: 'F' } });

test('lower folds ASCII letters and leaves every other character alone', () => {
  assert.equal(lower('ADA@Example.COM'), 'ada@example.com');
  assert.equal(lower(`${KELVIN}elvin`), `${KELVIN}elvin`, 'the Kelvin sign is not the letter k');
  assert.notEqual(lower(`${KELVIN}.smith@x.example`), lower('K.smith@x.example'));
  assert.equal(lower('ÄB'), 'Äb', 'a non-ASCII capital is left as it is');
  assert.equal(lower(undefined), 'undefined'); assert.equal(lower(null), 'null'); // callers pass strings; the helper never throws
});

const routeAWith = (srcPeople, dstPeople) => planA({
  p1: {
    listUsers: async (env) => ({ items: env === 'S' ? srcPeople : dstPeople, truncated: false }),
    findGroup: async () => ({ id: 'g1', name: 'G' }), defaultPopulation: async () => ({ id: 'p1' }), groupIdsOf: async () => [],
  },
  sourceEnvId: 'S', privilegeEnvId: 'D', group: 'G', concurrency: 2, limits: { maxUsers: 1000 }, progress,
});
const admin = raw('adm', 'admin', 'admin@x.example');

test('route A: a Kelvin-sign email is a new person, never a match for the account with the plain letter', async () => {
  const plan = await routeAWith([raw('s1', 'k.smith', `${KELVIN}.smith@x.example`)], [admin, raw('real', 'real.k', 'k.smith@x.example')]);
  assert.equal(plan.decisions[0].action, 'create+add', JSON.stringify(plan.decisions[0]));
  assert.equal(plan.decisions[0].target, null, 'it is not aimed at the other account');
  assert.equal(plan.counts.add, 0);
});

test('route A: a Kelvin-sign username is not the plain-letter username either', async () => {
  const plan = await routeAWith([raw('s1', `${KELVIN}evin`, 'new.person@x.example')], [admin, raw('real', 'kevin', 'kevin@x.example')]);
  assert.equal(plan.decisions[0].action, 'create+add', 'no username conflict is invented from a look-alike');
});

test('route A: ordinary case differences still match (an upper-case email is the same person)', async () => {
  const plan = await routeAWith([raw('s1', 'ADA', 'ADA@X.EXAMPLE')], [admin, raw('real', 'ada', 'ada@x.example')]);
  assert.equal(plan.decisions[0].action, 'add');
  assert.equal(plan.decisions[0].target, 'real');
});

test('route B: a Kelvin-sign email is not "already in the console"', async () => {
  const con = { listUsers: async () => [{ Spec: { UserName: 'real.k', EmailID: 'k.smith@x.example' } }] };
  const plan = await planB({ p1: { listUsers: async () => ({ items: [raw('s1', 'k.smith', `${KELVIN}.smith@x.example`)], truncated: false }) }, con, sourceEnvId: 'S', limits: { maxUsers: 1000 }, progress });
  assert.equal(plan.decisions[0].action, 'create');
  const same = await planB({ p1: { listUsers: async () => ({ items: [raw('s1', 'someone', 'K.SMITH@X.EXAMPLE')], truncated: false }) }, con, sourceEnvId: 'S', limits: { maxUsers: 1000 }, progress });
  assert.equal(same.decisions[0].action, 'exists', 'ordinary case differences still match');
});
