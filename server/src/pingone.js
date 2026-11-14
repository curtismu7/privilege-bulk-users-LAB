// PingOne Management API client, only the calls Route A needs (every one is in docs/references.md):
//   token   POST https://auth.pingone.{region}/{workerEnv}/as/token   (client credentials, HTTP Basic)
//   list    GET  /v1/environments/{env}/users?limit=100   -> _embedded.users, follow _links.next.href
//   group   GET  /groups?filter=name eq "<name>"          -> _embedded.groups
//   create  POST /users                                   (no password)
//   add     POST /users/{id}/memberOfGroups {id}          (user-centric; the group-centric /groups/{id}/members is refused for a
//                                                          worker app with a misleading 403)
// It is given a `resilient` fetch (http.js), so a 429 or a 5xx is already handled below it. Reads throw a BulkError (the job cannot
// go on without them); writes return the result so one bad person is one failed row.
import { LIMITS } from './config.js';
import { BulkError, safeCode } from './errors.js';

const str = (v, n = 200) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
export const toPerson = (u) => ({ id: str(u?.id, 64), username: str(u?.username), email: str(u?.email), given: str(u?.name?.given, 100), family: str(u?.name?.family, 100) });

// `secrets` is a LIVE list the job scrubs every message against: this client adds the Basic credential at once and every bearer token
// the moment it is issued, so an upstream that echoes either back cannot get it into a row, an error or a report.
export function createPingOne({ resilient, region, workerEnvId, clientId, clientSecret, secrets = [] }) {
  const AUTH = `https://auth.pingone.${region}`;
  const API_ORIGIN = `https://api.pingone.${region}`;
  const API = `${API_ORIGIN}/v1/environments`;
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  secrets.push(basic, `Basic ${basic}`);
  let token = null; let expires = 0; let pending = null;

  async function fetchToken() {
    const r = await resilient(`${AUTH}/${workerEnvId}/as/token`, {
      method: 'POST', headers: { authorization: `Basic ${basic}`, 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body: 'grant_type=client_credentials',
    });
    if (r.status !== 200 || typeof r.json?.access_token !== 'string') {
      throw new BulkError('token_refused', `PingOne did not give the worker app a token (${r.status ? `HTTP ${r.status}` : `no answer: ${r.error}`}). Check BULK_P1_WORKER_CLIENT_ID, BULK_P1_WORKER_CLIENT_SECRET and BULK_P1_WORKER_ENV_ID.`, { httpStatus: r.status });
    }
    token = r.json.access_token;
    secrets.push(token, `Bearer ${token}`);
    expires = Date.now() + Math.max(30, (Number(r.json.expires_in) || 3600) - 60) * 1000;
    return token;
  }
  function getToken(force = false) {
    if (!force && token && Date.now() < expires) return Promise.resolve(token);
    pending ||= fetchToken().finally(() => { pending = null; });
    return pending;
  }

  // One authenticated call. A 401 gets one fresh token and one retry; a second 401 is returned as it is (that is a role problem).
  async function call(method, url, body) {
    const send = async (force) => resilient(url, {
      method,
      headers: { authorization: `Bearer ${await getToken(force)}`, accept: 'application/json', ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let r = await send(false);
    if (r.status === 401) r = await send(true);
    return r;
  }
  const api = (method, envId, pathAndQuery, body) => call(method, `${API}/${envId}${pathAndQuery}`, body);

  const fail = (code, what, r) => new BulkError(code, `PingOne answered ${r.status ? `HTTP ${r.status}${safeCode(r) ? ` ${safeCode(r)}` : ''}` : `nothing (${String(r.error || 'network error').replace(/[^A-Za-z0-9_ .:-]/g, '?')})`} while ${what}`, { httpStatus: r.status });

  // A next link is followed only if, once the URL parser has normalised it (dot segments, %2e, backslashes), it is still this API origin,
  // this environment and no credentials: a string that merely STARTS with the right prefix can climb out of it with `..`.
  function inThisEnvironment(href, envId) {
    let u;
    try { u = new URL(href); } catch { return null; }
    const base = `/v1/environments/${envId.toLowerCase()}/`;
    if (u.origin !== API_ORIGIN || u.username || u.password || !u.pathname.toLowerCase().startsWith(base)) return null;
    if (/%2e|%2f|%5c|\\|\/\.\.?(\/|$)/i.test(u.pathname)) return null; // nothing that could still be read as a dot segment or a separator
    return u.href;
  }
  // Every page of a collection. Follows _links.next.href, but only to the same environment on the same API host: a link that points
  // anywhere else stops the job (an SSRF guard on server-supplied text). `max` stops early and says so (`truncated`).
  async function listAll(envId, path, key, { code = 'source_unreadable', onPage, signal, max = Infinity } = {}) {
    const items = []; const seen = new Set();
    let url = `${API}/${envId}${path}?limit=${LIMITS.pageSize}`;
    for (let pages = 0; ; pages++) {
      if (pages >= LIMITS.maxPages) throw new BulkError(code, `PingOne kept paging past ${LIMITS.maxPages} pages; stopped`);
      if (signal?.aborted) throw new BulkError('aborted', 'aborted');
      const r = await call('GET', url);
      if (r.status !== 200) throw fail(code, `reading ${path}`, r);
      const page = r.json?._embedded?.[key];
      if (Array.isArray(page)) items.push(...page);
      onPage?.(items.length);
      if (items.length > max) { items.length = max; return { items, truncated: true }; }
      const next = r.json?._links?.next?.href;
      if (typeof next !== 'string' || !next) return { items, truncated: false };
      const safe = inThisEnvironment(next, envId);
      if (!safe || seen.has(safe)) throw new BulkError(code, 'a pagination link left this environment or looped; stopped');
      seen.add(safe); url = safe;
    }
  }

  return {
    listUsers: (envId, opts) => listAll(envId, '/users', 'users', opts),
    async findGroup(envId, name) {
      const r = await api('GET', envId, `/groups?filter=${encodeURIComponent(`name eq "${name}"`)}`);
      if (r.status !== 200) throw fail('destination_unreadable', 'looking up the Privilege group', r);
      // Exactly the configured name: a filter that answers with some other group must never put people in it.
      const g = r.json?._embedded?.groups?.find((x) => x?.name === name);
      return g && typeof g.id === 'string' ? { id: g.id, name: name } : null;
    },
    async defaultPopulation(envId) {
      const r = await api('GET', envId, `/populations?limit=${LIMITS.pageSize}`);
      if (r.status !== 200) throw fail('destination_unreadable', 'reading populations', r);
      const pops = r.json?._embedded?.populations ?? [];
      const p = pops.find((x) => x?.default) ?? pops[0];
      return p && typeof p.id === 'string' ? { id: p.id } : null;
    },
    // The ids of the groups a user is in.
    async groupIdsOf(envId, userId, opts) {
      const { items } = await listAll(envId, `/users/${encodeURIComponent(userId)}/memberOfGroups`, 'groupMemberships', { code: 'destination_unreadable', ...opts });
      return items.map((g) => g?.id).filter((x) => typeof x === 'string');
    },
    // One user by email (a filter, as our own sync script does). Used when a create's answer was lost and the retry says "already exists":
    // the user may be the one we just made.
    async findUserByEmail(envId, email) {
      const r = await api('GET', envId, `/users?filter=${encodeURIComponent(`email eq "${String(email).replace(/[\\"]/g, '')}"`)}`);
      if (r.status !== 200) return null;
      const u = r.json?._embedded?.users?.find((x) => String(x?.email ?? '').toLowerCase() === String(email).toLowerCase());
      return u && typeof u.id === 'string' ? toPerson(u) : null;
    },
    createUser: (envId, p, populationId) => api('POST', envId, '/users', {
      email: p.email, username: p.username, ...(p.given || p.family ? { name: { ...(p.given ? { given: p.given } : {}), ...(p.family ? { family: p.family } : {}) } } : {}), ...(populationId ? { population: { id: populationId } } : {}),
    }),
    addToGroup: (envId, userId, groupId) => api('POST', envId, `/users/${encodeURIComponent(userId)}/memberOfGroups`, { id: groupId }),
  };
}
