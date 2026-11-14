// GET /api/health, contract demo-health/1 (demo-shelf docs/health-contract.md). Public, GET only, no counts or detail.
// Doctor checks refresh in the background every 60 s; a request never runs them. Pattern from mcp-tools/health.js.
import express from 'express';
import fs from 'node:fs';
import { MODE_KEY, realRefusal } from './config.js';
import { allPassed, runChecks as defaultChecks } from './doctor.js';

const { version } = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const DEMO = { id: 'privilege-bulk-users', name: 'Privilege Bulk Users LAB', version };

export function createHealth({ runChecks = defaultChecks, env = process.env, now = () => new Date(), intervalMs = 60_000 }) {
  let last = { state: 'unknown', at: null, runtime: 'offline' };
  // Mock needs no setup, so a healthy install is `ready` and `offline`. `live` only when the owner opted into Real and the guards pass.
  function refresh() {
    try {
      const state = allPassed(runChecks({ env })) ? 'ready' : 'broken';
      last = { state, at: now().toISOString(), runtime: env[MODE_KEY] === 'real' && !realRefusal(env) ? 'live' : 'offline' };
    } catch { last = { state: 'unknown', at: now().toISOString(), runtime: 'offline' }; }
  }
  refresh();
  const timer = setInterval(refresh, intervalMs); timer.unref();
  const router = express.Router();
  router.get('/', (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ schema: 'demo-health/1', at: last.at || now().toISOString(), state: last.state, runtime: last.runtime, demo: DEMO });
  });
  router.all('/', (_req, res) => res.set('Allow', 'GET').status(405).json({ error: 'method_not_allowed' }));
  return { router, refresh, stop: () => clearInterval(timer) };
}
