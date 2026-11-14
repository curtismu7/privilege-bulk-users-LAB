// Mode, port and limits.
//
// PRIVILEGE_BULK_MODE is the owner's opt-in for Real. mock (the default) keeps Real refused; real lets the header toggle go to
// Real, and with it set (and the guards passing) the server starts in Real, as rule 19 says: Real if configured, else Mock. Real is
// still refused until every guard passes, and every write still needs a fresh plan, the typed count and the writes switch. A bare
// MODE is NOT read: another app's MODE must not switch this one. Anything that is not mock or real is an error, never a silent
// fallback.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bindHost, isLoopbackHost } from './security.js';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DEFAULT_PORT = 7817;
export const PORT_MIN = 7800;
export const PORT_MAX = 7999;
export const port = (env = process.env) => Number(env.PORT) || DEFAULT_PORT;
export const portInRange = (p) => Number.isInteger(p) && p >= PORT_MIN && p <= PORT_MAX;
export const dataDir = (env = process.env) => path.resolve(root, env.PBU_DATA_DIR || '.data');
export const webDist = path.join(root, 'web', 'dist');

export const LIMITS = Object.freeze({
  maxUsers: 50_000,
  concurrency: Object.freeze({ min: 1, max: 16, default: 6 }),
  planTtlMs: 15 * 60 * 1000,
  pageSize: 100, // PingOne caps a page at 100 (docs/references.md)
  maxPages: 1_000, // a hard stop on a pagination loop
});

export const MODES = Object.freeze(['mock', 'real']);
export const MODE_KEY = 'PRIVILEGE_BULK_MODE';

export function modeFrom(env = process.env) {
  const raw = env[MODE_KEY];
  const m = raw === undefined || raw === '' ? 'mock' : raw;
  if (!MODES.includes(m)) throw new Error(`${MODE_KEY}=${String(m).slice(0, 20).replace(/[^\x20-\x7e]/g, '?')} is not a mode: use mock or real`);
  return m;
}

// The guards Real must pass before anything real is called. Each: { id, ok, detail }. The settings of a route are checked
// again when a job starts (settings.js).
export function realGuards(env = process.env) {
  const host = bindHost(env);
  return [
    { id: 'owner-opt-in', ok: env[MODE_KEY] === 'real', detail: `${MODE_KEY}=real is set in this lab's own .env (beside docker-compose.yml) or the environment` },
    { id: 'loopback-bind', ok: isLoopbackHost(host) || (Boolean(env.PBU_BIND) && env.PBU_CONTAINER === '1'), detail: 'the server is bound to loopback; a non-loopback bind (PBU_BIND) is accepted for Real only when PBU_CONTAINER=1 is also set, which the compose file does (the image does not) and which is published on 127.0.0.1 only' },
  ];
}
// null when Real may run; otherwise which guards failed and what each needs.
export function realRefusal(env = process.env) {
  const failed = realGuards(env).filter((g) => !g.ok);
  return failed.length ? { failed: failed.map((g) => g.id), needs: failed.map((g) => g.detail) } : null;
}
