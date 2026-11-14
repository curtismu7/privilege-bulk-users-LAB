// The Mock: an in-process, deterministic fake of PingOne (a source environment and Privilege's own environment) and of the Privilege
// console, reached through an injected `fetch` (no socket is ever opened, so the netguard stays at zero). The people are synthetic:
// `.example` addresses only. It is an ILLUSTRATIVE SAMPLE, NOT A RECORDING: the shapes follow what docs/references.md sources, the
// numbers are invented, and the failure behaviours (429, 5xx, a 404 right after create, an empty list when a role is missing) are the
// ones the Guide teaches, switched on by the scenario.
//
// Deterministic by design: every person's fate comes from a hash of (seed, index), never from call order, so a test can compare the
// engine's plan with `expected`, the ground truth computed while the world was built.
export const MOCK = Object.freeze({
  region: 'invalid',
  sourceEnvId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  privilegeEnvId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  group: 'PrivilegeUsers',
  groupId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  populationId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  clientId: 'mock-worker', clientSecret: 'mock-worker-secret', // mock-only credentials, labelled as such (rule 4 exception)
  consoleUrl: 'https://console.privlab.invalid', tenant: '11111111-2222-4333-8444-555555555555',
  apiKey: 'demo-key-1111', apiSecret: 'demo-secret-2222',
  label: 'illustrative sample, not a recording',
});

const NONE = { max: 0 };
const BASE = { rate: NONE, overlapMember: 0.1, overlapNoMember: 0.05, conflicts: 0, adopt: 0, noEmail: 0, flaky: 0, notFoundAfterCreate: 0, hardFail: 0, lostResponse: 0, missingRole: false };
const PROFILES = {
  clean: { ...BASE },
  realistic: { ...BASE, rate: { max: 30, windowMs: 50, retryAfter: 1 }, conflicts: 0.02, adopt: 0.01, noEmail: 0.01, flaky: 0.01, notFoundAfterCreate: 0.05 },
  'rate-limited': { ...BASE, rate: { max: 10, windowMs: 50, retryAfter: 2 } },
  flaky: { ...BASE, flaky: 0.05, notFoundAfterCreate: 0.15, hardFail: 2, lostResponse: 0.03 },
  conflicts: { ...BASE, conflicts: 0.1, adopt: 0.03, noEmail: 0.05 },
  'missing-role': { ...BASE, overlapMember: 0.5, overlapNoMember: 0.1, missingRole: true },
};
export const SCENARIOS = Object.freeze([
  { id: 'realistic', label: 'Realistic', description: 'A rate limit that pushes back, a few people who exist already, a couple of username conflicts, one without an email, and a 404 right after some creates.' },
  { id: 'clean', label: 'Clean', description: 'No limits and no trouble. Some people already exist; the rest are new.' },
  { id: 'rate-limited', label: 'Rate limited', description: 'A tight rate limit with a long Retry-After. Watch the 429 counter and the back-off.' },
  { id: 'flaky', label: 'Flaky', description: 'Occasional 503s, many 404s right after create, a few creates whose ANSWER is lost after they went through, and two people PingOne always fails on. The run must finish and say who failed.' },
  { id: 'conflicts', label: 'Conflicts', description: 'Many usernames that already belong to someone else, some people without an email, a few same-username records with no email to adopt.' },
  { id: 'missing-role', label: 'Missing role', description: 'The worker lacks Identity Data Admin: PingOne answers 200 with an EMPTY user list instead of a 403 (sourced). The plan warns; ignore it and many creates collide. That the writes still work is this lab\'s model; PingOne\'s own write behaviour with a missing role is UNVERIFIED.' },
]);
export const DATASETS = Object.freeze([100, 500, 5000]);

const GIVEN = ['Ada', 'Grace', 'Alan', 'Edsger', 'Barbara', 'Donald', 'Margaret', 'Ken', 'Radia', 'Linus', 'Hedy', 'Dennis'];
const FAMILY = ['Lovelace', 'Hopper', 'Turing', 'Dijkstra', 'Liskov', 'Knuth', 'Hamilton', 'Thompson', 'Perlman', 'Torvalds', 'Lamarr', 'Ritchie'];
const hex12 = (n) => n.toString(16).padStart(12, '0');
const pad = (n) => String(n).padStart(5, '0');
function roll(seed, i, salt) {
  let x = (Math.imul(seed + 1, 374761393) + Math.imul(i + 1, 668265263) + Math.imul(salt + 1, 2246822519)) | 0;
  x = Math.imul(x ^ (x >>> 13), 1274126177); x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

export function createMockWorld({ scenario = 'realistic', users = 500, seed = 1, latencyMs = 1, now = Date.now, region = MOCK.region } = {}) {
  const P = PROFILES[scenario];
  if (!P) throw new Error(`unknown scenario "${String(scenario).slice(0, 30)}"`);
  const n = Number(users);

  const source = []; // PingOne source environment
  const dst = new Map(); // Privilege's environment: id -> user
  const consoleUsers = []; // the Privilege console's own user records (Route B)
  const flakyOnce = new Set(); const hardFail = new Set(); const loseOnce = new Set();
  let tokenSeq = 0; let validToken = null;
  const expected = { a: { 'create+add': 0, add: 0, 'in-sync': 0, conflict: 0, invalid: 0 }, b: { create: 0, exists: 0, conflict: 0, invalid: 0 } };
  const dstSeed = (u) => dst.set(u.id, u);

  for (let i = 1; i <= n; i++) {
    const username = `user${pad(i)}`; const email = `${username}@corp.example`;
    const person = { id: `aaaaaaaa-0000-4000-8000-${hex12(i)}`, username, email, name: { given: GIVEN[i % GIVEN.length], family: FAMILY[(i * 7) % FAMILY.length] }, enabled: true };
    const dstId = `bbbbbbbb-0000-4000-8000-${hex12(i)}`;
    const r1 = roll(seed, i, 1); const r2 = roll(seed, i, 2); const r3 = roll(seed, i, 3); const r6 = roll(seed, i, 6);
    if (r3 < P.noEmail) {
      delete person.email; expected.a.invalid++; expected.b.invalid++;
    } else if (r1 < P.overlapMember) {
      dstSeed({ id: dstId, username, email, name: person.name, member: true, born: 0, notFoundLeft: 0 }); expected.a['in-sync']++;
      consoleUsers.push({ username, email }); expected.b.exists++;
    } else if (r1 < P.overlapMember + P.overlapNoMember) {
      dstSeed({ id: dstId, username, email, name: person.name, member: false, born: 0, notFoundLeft: 0 }); expected.a.add++;
      consoleUsers.push({ username, email }); expected.b.exists++;
    } else if (r2 < P.conflicts) {
      dstSeed({ id: dstId, username, email: `other.${username}@elsewhere.example`, name: { given: 'Someone', family: 'Else' }, member: false, born: 0, notFoundLeft: 0 }); expected.a.conflict++;
      consoleUsers.push({ username, email: `other.${username}@elsewhere.example` }); expected.b.conflict++;
    } else if (r6 < P.adopt) {
      dstSeed({ id: dstId, username, email: '', name: {}, member: false, born: 0, notFoundLeft: 0 }); expected.a.add++; // a same-username record with no email is the same account
      expected.b.create++;
    } else { expected.a['create+add']++; expected.b.create++; }
    if (roll(seed, i, 4) < P.flaky) flakyOnce.add(username);
    if (roll(seed, i, 8) < P.lostResponse) loseOnce.add(username);
    source.push(person);
  }
  // Failing-for-good people (hardFail): new people PingOne always answers 500 for. Picked from the tail so the head stays predictable.
  let hf = 0;
  for (let i = n; i >= 1 && hf < P.hardFail; i--) {
    const username = `user${pad(i)}`; const p = source[i - 1];
    if (!p.email || dst.has(`bbbbbbbb-0000-4000-8000-${hex12(i)}`) || consoleUsers.some((c) => c.username === username)) continue;
    hardFail.add(username); hf++;
  }
  // Privilege's environment also holds people who are not in the source (administrators), so it is never empty on its own.
  for (let k = 1; k <= 12; k++) dstSeed({ id: `bbbbbbbb-1111-4000-8000-${hex12(k)}`, username: `priv-admin-${k}`, email: `priv-admin-${k}@privilege.example`, name: { given: 'Admin', family: String(k) }, member: true, born: 0, notFoundLeft: 0 });

  const toA = (a) => ({ ...a, toApply: a['create+add'] + a.add });
  const expectedCounts = (route) => (route === 'a' ? toA(expected.a) : { ...expected.b, toApply: expected.b.create });

  const stats = { calls: 0, created: 0, memberAdds: 0, consoleCreated: 0 };
  let win = { start: 0, count: 0 };
  const json = (status, body, headers = {}) => new Response(body === undefined ? '' : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
  const limited = () => {
    if (!P.rate.max) return null;
    const t = now();
    if (t - win.start >= P.rate.windowMs) win = { start: t, count: 0 };
    return ++win.count > P.rate.max ? json(429, { code: 'REQUEST_LIMITED', message: 'Too many requests' }, { 'retry-after': String(P.rate.retryAfter) }) : null;
  };
  const bodyOf = (init) => { try { return JSON.parse(init?.body || '{}'); } catch { return null; } };
  const header = (init, k) => { const h = init?.headers || {}; const key = Object.keys(h).find((x) => x.toLowerCase() === k); return key ? h[key] : undefined; };
  const page = (envId, path, key, list, qs) => {
    const limit = Math.min(Number(qs.get('limit')) || 100, 100); const at = Number(qs.get('cursor')) || 0;
    const items = list.slice(at, at + limit);
    const next = at + limit < list.length ? { next: { href: `https://api.pingone.${region}/v1/environments/${envId}${path}?limit=${limit}&cursor=${at + limit}` } } : {};
    return json(200, { _links: { self: { href: 'mock' }, ...next }, _embedded: { [key]: items }, count: items.length });
  };
  const view = (u) => ({ id: u.id, username: u.username, ...(u.email ? { email: u.email } : {}), name: u.name, enabled: true });

  async function pingone(url, init) {
    if (url.hostname === `auth.pingone.${region}`) {
      const m = /^\/([^/]+)\/as\/token$/.exec(url.pathname);
      const basic = String(header(init, 'authorization') || '');
      if (!m || basic !== `Basic ${Buffer.from(`${MOCK.clientId}:${MOCK.clientSecret}`).toString('base64')}`) return json(401, { error: 'invalid_client' });
      validToken = `mock-token-${++tokenSeq}`;
      return json(200, { access_token: validToken, token_type: 'Bearer', expires_in: 3600 });
    }
    if (!validToken || header(init, 'authorization') !== `Bearer ${validToken}`) return json(401, { code: 'ACCESS_FAILED', message: 'Invalid token' }); // an expired or unknown token
    const m = /^\/v1\/environments\/([^/]+)(\/.*)?$/.exec(url.pathname);
    if (!m || ![MOCK.sourceEnvId, MOCK.privilegeEnvId].includes(m[1])) return json(404, { code: 'NOT_FOUND' });
    const env = m[1]; const rest = m[2] || ''; const method = init?.method || 'GET'; const isDst = env === MOCK.privilegeEnvId;
    if (method === 'GET' && rest === '/users') {
      const f = /^(email|username) eq "(.*)"$/.exec(url.searchParams.get('filter') || '');
      const only = (list) => (f ? list.filter((u) => String(u[f[1]] ?? '').toLowerCase() === f[2].toLowerCase()) : list);
      if (!isDst) return page(env, rest, 'users', only(source).map(view), url.searchParams);
      return page(env, rest, 'users', P.missingRole ? [] : only([...dst.values()]).map(view), url.searchParams); // 200 and EMPTY, not a 403: the trap
    }
    if (!isDst) return json(404, { code: 'NOT_FOUND' });
    if (method === 'GET' && rest === '/groups') {
      const want = /name eq "([^"]*)"/.exec(url.searchParams.get('filter') || '')?.[1];
      return json(200, { _embedded: { groups: want === MOCK.group ? [{ id: MOCK.groupId, name: MOCK.group }] : [] } });
    }
    if (method === 'GET' && rest === '/populations') return json(200, { _embedded: { populations: [{ id: MOCK.populationId, name: 'Default', default: true }] } });
    if (method === 'POST' && rest === '/users') {
      if (!String(header(init, 'content-type') || '').includes('application/json')) return json(415, { code: 'UNSUPPORTED_MEDIA_TYPE' });
      const b = bodyOf(init);
      if (!b || typeof b.email !== 'string' || typeof b.username !== 'string' || !b.email || !b.username) return json(400, { code: 'INVALID_VALUE', message: 'email and username are required' });
      if (hardFail.has(b.username)) return json(500, { code: 'UNEXPECTED_ERROR', message: 'internal error' });
      if (flakyOnce.has(b.username)) { flakyOnce.delete(b.username); return json(503, { code: 'SERVICE_UNAVAILABLE' }); }
      if (b.population?.id !== MOCK.populationId) return json(400, { code: 'INVALID_VALUE', message: 'population is required' }); // this lab's model: a create names the default population
      const lower = (s) => String(s).toLowerCase();
      if ([...dst.values()].some((u) => lower(u.username) === lower(b.username) || (u.email && lower(u.email) === lower(b.email)))) {
        return json(400, { code: 'INVALID_DATA', message: 'The request could not be completed.', details: [{ code: 'UNIQUENESS_VIOLATION', target: 'username' }] });
      }
      const idx = Number(/(\d+)$/.exec(b.username)?.[1]) || 0;
      const u = { id: `bbbbbbbb-2222-4000-8000-${hex12(++stats.created)}`, username: b.username, email: b.email, name: b.name || {}, member: false, born: now(), notFoundLeft: roll(seed, idx, 5) < P.notFoundAfterCreate ? 2 : 0 };
      dst.set(u.id, u);
      if (loseOnce.delete(b.username)) return json(504, { code: 'GATEWAY_TIMEOUT' }); // the user WAS created; only the answer is lost
      return json(201, view(u));
    }
    const mu = /^\/users\/([^/]+)\/memberOfGroups$/.exec(rest);
    if (mu) {
      const u = dst.get(decodeURIComponent(mu[1]));
      if (!u) return json(404, { code: 'NOT_FOUND', message: 'user not found' });
      if (method === 'GET') return page(env, rest, 'groupMemberships', u.member ? [{ id: MOCK.groupId, name: MOCK.group }] : [], url.searchParams);
      if (method === 'POST') {
        if (u.notFoundLeft > 0) { u.notFoundLeft--; return json(404, { code: 'NOT_FOUND', message: 'user not found (just created)' }); } // PingOne can lag right after a create
        if (bodyOf(init)?.id !== MOCK.groupId) return json(404, { code: 'NOT_FOUND', message: 'group not found' });
        if (!u.member) { u.member = true; stats.memberAdds++; }
        return json(201, { id: MOCK.groupId, name: MOCK.group });
      }
    }
    return json(404, { code: 'NOT_FOUND' });
  }

  async function privilegeConsole(url, init) {
    if (!header(init, 'x-procyon-session-id')) return json(400, { error: 'x-procyon-session-id is required' });
    if (header(init, 'x-api-key') !== MOCK.apiKey || header(init, 'x-api-secret') !== MOCK.apiSecret) return json(401, { error: 'User is not authorized' });
    if (url.pathname !== `/api/${MOCK.tenant}/v1/users`) return json(404, { error: 'not_found' });
    const method = init?.method || 'GET';
    const rec = (c) => ({ ObjectMeta: { Kind: 'User', Namespace: 'default', Name: c.username }, Spec: { UserName: c.username, EmailID: c.email, Active: true } });
    if (method === 'GET') return json(200, { Users: consoleUsers.map(rec) });
    if (method === 'POST') {
      const b = bodyOf(init); const name = b?.ObjectMeta?.Name; const email = b?.Spec?.EmailID;
      if (typeof name !== 'string' || !name || typeof email !== 'string' || !email) return json(400, { error: 'ObjectMeta.Name and Spec.EmailID are required' });
      if (hardFail.has(name)) return json(500, { error: 'mock_error' });
      if (flakyOnce.has(name)) { flakyOnce.delete(name); return json(503, { error: 'unavailable' }); }
      if (consoleUsers.some((c) => c.username.toLowerCase() === name.toLowerCase() || c.email.toLowerCase() === email.toLowerCase())) return json(409, { error: 'already_exists' });
      const c = { username: name, email }; consoleUsers.push(c); stats.consoleCreated++;
      return json(201, rec(c));
    }
    return json(405, { error: 'method_not_allowed' });
  }

  async function fetchImpl(input, init = {}) {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    stats.calls++;
    if (latencyMs > 0) await new Promise((r) => setTimeout(r, latencyMs));
    if (url.hostname.endsWith(`.${region}`) && url.hostname.includes('pingone')) {
      if (url.hostname.startsWith('api.')) { const lim = limited(); if (lim) return lim; }
      return pingone(url, init);
    }
    if (url.hostname === new URL(MOCK.consoleUrl).hostname) { const lim = limited(); if (lim) return lim; return privilegeConsole(url, init); }
    throw Object.assign(new Error(`the mock does not serve ${url.hostname}`), { code: 'ENOTFOUND' });
  }

  return {
    fetchImpl, scenario, users: n, seed, expected: expectedCounts,
    state: () => ({ sourceUsers: source.length, privilegeEnvUsers: dst.size, groupMembers: [...dst.values()].filter((u) => u.member).length, consoleUsers: consoleUsers.length, ...stats }),
    // Who in the Privilege environment is in the group (what Privilege "knows"); names only, for tests.
    members: () => [...dst.values()].filter((u) => u.member).map((u) => u.username),
    // The current bearer token stops working: the next call gets a 401 until the client asks for a new one.
    expireToken() { validToken = null; },
    tokensIssued: () => tokenSeq,
  };
}
