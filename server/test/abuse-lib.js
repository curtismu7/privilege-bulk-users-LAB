// Helpers for the abuse tests (gate, secrets, outbound): Real with the network replaced by the Mock world, under the production netguard.
import { MOCK, createMockWorld } from '../src/mockWorld.js';
import { installNetguard } from '../src/netguard.js';
import { startApp } from './helpers.js';

export const trueFetch = globalThis.fetch;
export const seen = [];
export const seenUrls = [];
export const REAL = {
  PRIVILEGE_BULK_MODE: 'real', BULK_P1_REGION: 'com', BULK_P1_SOURCE_ENV_ID: MOCK.sourceEnvId, BULK_P1_PRIVILEGE_ENV_ID: MOCK.privilegeEnvId,
  BULK_P1_WORKER_CLIENT_ID: MOCK.clientId, BULK_P1_WORKER_CLIENT_SECRET: MOCK.clientSecret, BULK_P1_GROUP: MOCK.group,
  BULK_CONSOLE_URL: MOCK.consoleUrl, BULK_CONSOLE_TENANT: MOCK.tenant, BULK_CONSOLE_API_KEY: MOCK.apiKey, BULK_CONSOLE_API_SECRET: MOCK.apiSecret,
};
export const fresh = (o = {}) => createMockWorld({ scenario: 'clean', users: 100, region: 'com', latencyMs: 0, ...o });
export { MOCK, createMockWorld, startApp };

// Same shape as real.test.js: a stub network UNDER the production netguard.
export async function withReal(fn, { env = REAL, w = fresh(), tweak } = {}) {
  globalThis.fetch = async (u, init) => {
    const url = new URL(typeof u === 'string' || u instanceof URL ? u : u.url);
    if (url.hostname === '127.0.0.1') return trueFetch(u, init);
    seen.push(url.hostname); seenUrls.push(`${init?.method || 'GET'} ${url.href}`);
    return (tweak ? await tweak(url, init, w) : null) ?? w.fetchImpl(url.href, init);
  };
  const g = installNetguard();
  seen.length = 0; seenUrls.length = 0;
  const s = await startApp({ env });
  try { await fn(s, w, g); } finally { await s.close(); g.restore(); globalThis.fetch = trueFetch; }
}
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
