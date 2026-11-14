// Builds the clients one job talks through.
//   Mock  an in-process world (mockWorld.js) behind an injected fetch: no socket is opened. Waits are scaled down (MOCK_SCALE) so a
//         demo does not sit through real seconds; the job says so (`timeScale`).
//   Real  the lab's own settings (settings.js), the real fetch, and a netguard permit for ONLY the hosts of this job (the PingOne
//         token and API hosts of the region, plus the one console origin for route b), held until the job ends.
import { createConsole, insecureFetch } from './console.js';
import { createGate, createResilient, newStats } from './http.js';
import { MOCK } from './mockWorld.js';
import { permit } from './netguard.js';
import { createPingOne } from './pingone.js';
import { realConfig } from './settings.js';
import { liveHosts } from './urls.js';

export const MOCK_SCALE = 0.02;

export async function buildContext({ mode, route, env, world, signal }) {
  const stats = newStats();
  const secrets = []; // LIVE: the PingOne client adds the Basic credential and each bearer token to it; every message is scrubbed against it
  if (mode === 'mock') {
    const gate = createGate({ scale: MOCK_SCALE });
    const resilient = createResilient({ fetchImpl: world.fetchImpl, gate, stats, signal });
    return {
      gate, stats, timeScale: MOCK_SCALE, secrets, release() {},
      sourceEnvId: MOCK.sourceEnvId, privilegeEnvId: MOCK.privilegeEnvId, group: MOCK.group,
      p1: createPingOne({ resilient, region: MOCK.region, workerEnvId: MOCK.sourceEnvId, clientId: MOCK.clientId, clientSecret: MOCK.clientSecret, secrets }),
      con: route === 'b' ? createConsole({ resilient, url: MOCK.consoleUrl, tenant: MOCK.tenant, apiKey: MOCK.apiKey, apiSecret: MOCK.apiSecret }) : null,
    };
  }
  const cfg = realConfig(env, route); // throws { code: 'needs_setup' } naming the setting, never its value
  const releases = liveHosts(cfg, route).map((h) => permit(h));
  const gate = createGate({ scale: 1 });
  const globalFetch = (url, init) => globalThis.fetch(url, init); // looked up per call, so the netguard's wrapper is the one used
  const resilient = createResilient({ fetchImpl: globalFetch, gate, stats, signal });
  secrets.push(...cfg.secrets);
  return {
    gate, stats, timeScale: 1, secrets, release() { for (const r of releases) r(); },
    sourceEnvId: cfg.sourceEnvId, privilegeEnvId: cfg.privilegeEnvId ?? cfg.sourceEnvId, group: cfg.group ?? null,
    p1: createPingOne({ resilient, region: cfg.region, workerEnvId: cfg.workerEnvId, clientId: cfg.clientId, clientSecret: cfg.clientSecret, secrets }),
    con: route === 'b'
      ? createConsole({ resilient: createResilient({ fetchImpl: cfg.insecureTls ? insecureFetch : globalFetch, gate, stats, signal }), url: cfg.consoleUrl, tenant: cfg.tenant, apiKey: cfg.apiKey, apiSecret: cfg.apiSecret })
      : null,
  };
}
