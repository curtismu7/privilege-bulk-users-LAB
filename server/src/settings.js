// This lab's own settings: the `.env` beside docker-compose.yml (mode 600, git-ignored; `.env.example` lists the names). Owner rule
// 2026-11-09: each standalone reads its own .env, never ~/Documents and never another app's file. The file is read with
// util.parseEnv and ONLY the names below are taken; every other key is ignored. A host run reads <repo>/.env; the container gets the
// same names from compose (env_file). Values are never printed, returned or logged: routeReadiness() reports setting NAMES only.
import fs from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { root } from './config.js';
import { isLoopbackHost } from './security.js';
import { isPrivateLiteral } from './urls.js';

export const REGIONS = Object.freeze(['com', 'eu', 'asia', 'ca', 'com.au', 'sg']);
const P1_READ = ['BULK_P1_REGION', 'BULK_P1_SOURCE_ENV_ID', 'BULK_P1_WORKER_CLIENT_ID', 'BULK_P1_WORKER_CLIENT_SECRET'];
const NEEDS = {
  a: [...P1_READ, 'BULK_P1_PRIVILEGE_ENV_ID', 'BULK_P1_GROUP'],
  b: [...P1_READ, 'BULK_CONSOLE_URL', 'BULK_CONSOLE_TENANT', 'BULK_CONSOLE_API_KEY', 'BULK_CONSOLE_API_SECRET'],
};
export const SETTING_KEYS = Object.freeze([...new Set([
  'PRIVILEGE_BULK_MODE', ...NEEDS.a, ...NEEDS.b, 'BULK_P1_WORKER_ENV_ID', 'BULK_CONSOLE_INSECURE_TLS',
])]);
export const SECRET_KEYS = Object.freeze(['BULK_P1_WORKER_CLIENT_SECRET', 'BULK_CONSOLE_API_SECRET', 'BULK_CONSOLE_API_KEY']);

export const settingsPath = (env = process.env) => env.BULK_ENV_FILE || path.join(root, '.env');

export function readSettings(file) {
  try {
    const parsed = parseEnv(fs.readFileSync(file, 'utf8'));
    return Object.fromEntries(SETTING_KEYS.filter((k) => typeof parsed[k] === 'string' && parsed[k] !== '').map((k) => [k, parsed[k]]));
  } catch { return {}; } // no file, or not readable: the defaults
}

// Fills only the listed names, and only when the environment does not already set them.
export function applySettings(env = process.env, file = settingsPath(env)) {
  for (const [k, v] of Object.entries(readSettings(file))) if (env[k] === undefined) env[k] = v;
  return env;
}

const val = (env, k) => (typeof env[k] === 'string' && env[k].trim() ? env[k].trim() : null);
export function routeReadiness(env = process.env) {
  const out = {};
  for (const r of ['a', 'b']) { const missing = NEEDS[r].filter((k) => !val(env, k)); out[r] = { realReady: missing.length === 0, missing }; }
  return out;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GROUP = /^[A-Za-z0-9][A-Za-z0-9 _.:@-]{0,99}$/;

function consoleOrigin(raw) {
  let u;
  try { u = new URL(raw); } catch { throw cfgError('BULK_CONSOLE_URL is not a valid URL'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw cfgError('BULK_CONSOLE_URL must be http or https');
  if (u.protocol === 'http:' && !isLoopbackHost(u.hostname)) throw cfgError('BULK_CONSOLE_URL must be https (http is allowed only for a loopback address)');
  if (isPrivateLiteral(u.hostname)) throw cfgError('BULK_CONSOLE_URL must not be a private or link-local address');
  if (u.username || u.password) throw cfgError('BULK_CONSOLE_URL must not carry credentials; use BULK_CONSOLE_API_KEY and BULK_CONSOLE_API_SECRET');
  if (u.pathname && u.pathname !== '/') throw cfgError('BULK_CONSOLE_URL must be the console origin only (no path)');
  return u.origin;
}
const cfgError = (message) => Object.assign(new Error(message), { code: 'needs_setup' });

// The validated Real configuration for one route. Throws { code: 'needs_setup' } naming the SETTING, never its value.
export function realConfig(env, route) {
  const ready = routeReadiness(env)[route];
  if (!ready.realReady) throw cfgError(`set ${ready.missing.join(', ')} in this lab's .env`);
  const region = val(env, 'BULK_P1_REGION');
  if (!REGIONS.includes(region)) throw cfgError(`BULK_P1_REGION must be one of ${REGIONS.join(', ')}`);
  const need = (k) => { const v = val(env, k); if (!UUID.test(v)) throw cfgError(`${k} must be a PingOne environment id (a UUID)`); return v.toLowerCase(); }; // lower case: the same environment must compare equal however it was typed
  const sourceEnvId = need('BULK_P1_SOURCE_ENV_ID');
  const workerEnvId = val(env, 'BULK_P1_WORKER_ENV_ID') ? need('BULK_P1_WORKER_ENV_ID') : sourceEnvId;
  const cfg = {
    region, sourceEnvId, workerEnvId,
    clientId: val(env, 'BULK_P1_WORKER_CLIENT_ID'), clientSecret: val(env, 'BULK_P1_WORKER_CLIENT_SECRET'),
  };
  if (route === 'a') {
    cfg.privilegeEnvId = need('BULK_P1_PRIVILEGE_ENV_ID');
    cfg.group = val(env, 'BULK_P1_GROUP');
    if (!GROUP.test(cfg.group)) throw cfgError('BULK_P1_GROUP has characters this lab will not put in a filter: use letters, digits, space and _ . : @ -');
  } else {
    const tenant = val(env, 'BULK_CONSOLE_TENANT');
    if (!UUID.test(tenant)) throw cfgError('BULK_CONSOLE_TENANT must be your Privilege tenant id (a UUID)');
    Object.assign(cfg, { consoleUrl: consoleOrigin(val(env, 'BULK_CONSOLE_URL')), tenant, apiKey: val(env, 'BULK_CONSOLE_API_KEY'), apiSecret: val(env, 'BULK_CONSOLE_API_SECRET'), insecureTls: env.BULK_CONSOLE_INSECURE_TLS === '1' });
  }
  cfg.secrets = [cfg.clientSecret, cfg.apiSecret, cfg.apiKey].filter(Boolean);
  return cfg;
}
