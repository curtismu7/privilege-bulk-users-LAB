// Privilege console API client, only what Route B needs: list and create users.
//   GET  /api/{tenant}/v1/users     list existing
//   POST /api/{tenant}/v1/users     create one (an imodelUser: ObjectMeta + Spec)
// Auth is x-api-key / x-api-secret plus a required x-procyon-session-id (its value is not validated by the console). The body shape
// of a user the console really accepts is UNVERIFIED (docs/references.md); the mock accepts the shape below.
import crypto from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import { BulkError } from './errors.js';

// fetch cannot take per-request TLS options, and the local desktop console serves a self-signed certificate. Only a configuration that
// says so (BULK_CONSOLE_INSECURE_TLS=1) takes this path; it returns a fetch-shaped Response.
export function insecureFetch(url, init = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request(u, { method: init.method, headers: init.headers, ...(u.protocol === 'https:' ? { rejectUnauthorized: false } : {}), signal: init.signal }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { text += c; if (text.length > 4_000_000) req.destroy(new Error('response too large')); });
      res.on('end', () => {
        // A status outside 200-599 makes `new Response` throw; inside this handler that would be an uncaught exception.
        if (!(res.statusCode >= 200 && res.statusCode <= 599)) return reject(Object.assign(new Error('the console sent an unusable status'), { code: 'bad_status' }));
        try { resolve(new Response(text, { status: res.statusCode, headers: { 'content-type': res.headers['content-type'] || 'application/json', ...(res.headers['retry-after'] ? { 'retry-after': res.headers['retry-after'] } : {}) } })); } catch (err) { reject(err); }
      });
    });
    req.on('error', reject);
    if (init.body !== undefined) req.write(init.body);
    req.end();
  });
}

export function createConsole({ resilient, url, tenant, apiKey, apiSecret }) {
  const base = `${url}/api/${tenant}/v1/users`;
  const headers = () => ({ 'x-api-key': apiKey, 'x-api-secret': apiSecret, 'x-procyon-session-id': crypto.randomUUID(), accept: 'application/json' });
  const refused = (r) => new BulkError('login_required', `the console refused the credential (HTTP ${r.status}): check BULK_CONSOLE_API_KEY, BULK_CONSOLE_API_SECRET and BULK_CONSOLE_TENANT`, { httpStatus: r.status });
  return {
    async listUsers() {
      const r = await resilient(base, { method: 'GET', headers: headers() });
      if (r.status === 401 || r.status === 403) throw refused(r);
      if (r.status !== 200) throw new BulkError('destination_unreadable', `the console answered ${r.status ? `HTTP ${r.status}` : `nothing (${r.error})`} listing users`, { httpStatus: r.status });
      // A 200 that is not a list of users is NOT "no users": reading it as empty would plan everyone as new. Stop and say so.
      const list = r.json?.Users ?? r.json?.users ?? r.json?.items;
      if (!Array.isArray(list)) throw new BulkError('destination_unreadable', 'the console answered 200, but not with a list of users (the shape is UNVERIFIED); nothing was written', { httpStatus: r.status });
      return list;
    },
    async createUser(p) {
      const r = await resilient(base, {
        method: 'POST', headers: { ...headers(), 'content-type': 'application/json' },
        body: JSON.stringify({
          ObjectMeta: { Kind: 'User', Namespace: 'default', Name: p.username },
          Spec: { UserName: p.username, EmailID: p.email, FirstName: p.given, LastName: p.family, FullName: [p.given, p.family].filter(Boolean).join(' ') || p.username, Active: true },
        }),
      });
      if (r.status === 401 || r.status === 403) throw refused(r);
      return r;
    },
  };
}
