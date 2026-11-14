// The repo must carry no tenant identifier: the only UUID allowed is the placeholder used by tests, and no private host.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKIP = new Set(['node_modules', 'dist', '.git', '.data', '.env']); // .env: the owner's local secret file (mode 600, git-ignored), same treatment as .data
// Synthetic ids only: the 1111...-5555... placeholder family used by the tests, or one hex digit repeated (the Mock's environment ids).
const SYNTHETIC = (u) => /^11111111-2222-4333-8444-5555555555\d\d$/.test(u) || /^([0-9a-f])\1{7}-\1{4}-4\1{3}-8\1{3}-\1{12}$/i.test(u);
function* walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (SKIP.has(e.name)) continue; const p = path.join(d, e.name); if (e.isDirectory()) yield* walk(p); else if (!/package-lock\.json$/.test(p)) yield p; } }

test('no UUID other than the placeholder, no private host, no key material', () => {
  const bad = [];
  const privateHost = new RegExp(['ping', 'devops'].join('-') + '\\.com', 'i');
  const allowedHosts = new RegExp('(?:privilege-bulk-users\\.)?local\\.' + ['ping', 'devops'].join('-') + '\\.com', 'gi');
  for (const f of walk(root)) {
    const t = fs.readFileSync(f, 'utf8');
    for (const m of t.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) || []) if (!SYNTHETIC(m)) bad.push(`${f}: uuid ${m}`);
    // The lab-proxy's public name and this app's own Host name are the two allowed uses (LAB_ALLOWED_HOSTS and its tests).
    if (privateHost.test(t.replace(allowedHosts, ''))) bad.push(`${f}: private host`);
    if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(t)) bad.push(`${f}: private key`);
  }
  assert.deepEqual(bad, []);
});
