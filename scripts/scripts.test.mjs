// The scripts do what their headers say. smoke.mjs, verify-running.mjs and reset.mjs run against an app started in this process (Mock,
// loopback, an ephemeral port); doctor.mjs runs on its own; e2e.mjs needs the built web app and a browser, so it is only syntax-checked
// here and its test ids are checked against the web sources. Results are exit codes, never parsed output.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/src/app.js';
import { startHttpServer } from '../server/src/index.js';
import { reset } from './reset.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const run = (args, env = {}) => new Promise((resolve) => {
  execFile(process.execPath, args, { cwd: root, env: { ...process.env, ...env }, timeout: 120_000 }, (err, stdout, stderr) => resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout, stderr }));
});
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'privilege-bulk-users-scripts-'));
let srv;
before(async () => {
  const env = { PBU_DATA_DIR: tmp, BULK_ENV_FILE: path.join(tmp, 'none.env') }; // no .env is read: Real is refused
  srv = await startHttpServer({ port: 0, host: '127.0.0.1', app: createApp({ env, mockLatencyMs: 0 }) });
});
after(async () => { await srv.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

test('every script parses (node --check)', async () => {
  const files = [...fs.readdirSync(path.join(root, 'scripts')).filter((f) => f.endsWith('.mjs')).map((f) => `scripts/${f}`), 'scripts/lib/run-client.mjs', 'scripts/lib/shelf-registry-rules.mjs'];
  assert.ok(files.length >= 14, files.join());
  for (const f of files) assert.equal((await run(['--check', f])).code, 0, f);
});

test('smoke.mjs passes against a running app: both routes, plan, wrong count refused, apply, verify finds 0, results, reports, Reset', async () => {
  const r = await run(['scripts/smoke.mjs', srv.url]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.ok(!/FAIL/.test(r.stdout), r.stdout);
  const after = await fetch(new URL('/api/jobs/current', srv.url)).then((x) => x.json());
  assert.equal(after.job, null, 'smoke leaves nothing behind');
});

test('verify-running.mjs passes against a running app: the guards, the Realistic back-off, the Missing role warning, Reset', async () => {
  const r = await run(['scripts/verify-running.mjs', srv.url]);
  const failed = r.stdout.split('\n').filter((l) => l.startsWith('FAIL')).map((l) => l.replace(/^FAIL\s+/, ''));
  // The one check that needs the built web app (web/dist, from npm run build) is the page itself; without a build it is the only failure.
  if (fs.existsSync(path.join(root, 'web', 'dist', 'index.html'))) assert.deepEqual(failed, [], r.stdout);
  else assert.deepEqual(failed, ['the page is the built app (root div and title)'], r.stdout);
  assert.match(r.stdout, /SKIP {2}container leg/);
});

test('reset.mjs resets a running app and refuses a host that is not loopback', async () => {
  assert.equal((await reset(srv.url)).ok, true);
  await assert.rejects(reset('http://example.invalid:7817'), /loopback only/);
  assert.equal((await run(['scripts/reset.mjs', 'http://example.invalid'])).code, 1);
  assert.equal((await run(['scripts/smoke.mjs', 'http://example.invalid'])).code, 1);
  assert.equal((await run(['scripts/verify-running.mjs', 'http://example.invalid'])).code, 2);
});

test('smoke.mjs fails, with a non-zero exit, when nothing is listening', async () => {
  const free = await new Promise((resolve) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); });
  assert.notEqual((await run(['scripts/smoke.mjs', `http://127.0.0.1:${free}`])).code, 0);
});

test('doctor.mjs passes on a clean checkout: no .env, a free port in range, the netguard self-test', async () => {
  let port = 0;
  for (let p = 7900; p < 7999 && !port; p++) {
    if (await new Promise((resolve) => { const s = net.createServer(); s.once('error', () => resolve(false)); s.listen(p, '127.0.0.1', () => s.close(() => resolve(true))); })) port = p;
  }
  assert.ok(port, 'a free port in 7900-7999');
  const env = { PORT: String(port), PBU_DATA_DIR: path.join(tmp, 'doctor'), BULK_ENV_FILE: path.join(tmp, 'none.env'), PRIVILEGE_BULK_MODE: '' };
  const r = await run(['scripts/doctor.mjs'], env);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.ok(!/^FAIL/m.test(r.stdout), r.stdout);
  const bad = await run(['scripts/doctor.mjs'], { ...env, PORT: '5173' });
  assert.equal(bad.code, 1, 'a port outside 7800-7999 fails the doctor');
});

test('doctor.mjs never prints a setting value: a secret in the .env stays out of its output', async () => {
  const file = path.join(tmp, 'secret.env');
  const marker = ['s3cr3t', 'marker', String(process.pid)].join('-');
  fs.writeFileSync(file, `BULK_P1_WORKER_CLIENT_SECRET=${marker}\nBULK_P1_REGION=com\n`, { mode: 0o600 });
  const r = await run(['scripts/doctor.mjs'], { PORT: '7999', PBU_DATA_DIR: path.join(tmp, 'doctor2'), BULK_ENV_FILE: file, PRIVILEGE_BULK_MODE: '' });
  assert.ok(!r.stdout.includes(marker) && !r.stderr.includes(marker));
  assert.match(r.stdout, /BULK_P1_SOURCE_ENV_ID/, 'it names the settings still missing');
});

test('e2e.mjs drives only test ids the web app has, and the contract ones are all there', () => {
  const e2e = fs.readFileSync(path.join(root, 'scripts/e2e.mjs'), 'utf8');
  const used = new Set([...e2e.matchAll(/\bt\('([a-z0-9_-]+)'\)/g), ...e2e.matchAll(/data-testid="([a-z0-9_-]+)"/g)].map((m) => m[1]));
  for (const id of ['nav-run', 'guide-page', 'unverified-list', 'run-page', 'route-a', 'scenario-select', 'users-select', 'plan-btn', 'verify-btn', 'job-state', 'job-phase', 'progress', 'counts', 'warnings', 'ack-destination_empty', 'apply-panel', 'confirm-input', 'apply-btn', 'results-table', 'report-json', 'report-csv', 'mode', 'mode-modal', 'mode-modal-ok', 'reset', 'live']) assert.ok(used.has(id), `e2e.mjs uses ${id}`);
  const web = [];
  const walk = (d) => { for (const n of fs.readdirSync(d)) { const p = path.join(d, n); if (fs.statSync(p).isDirectory()) walk(p); else if (/\.jsx?$/.test(n) && !/\.test\.jsx?$/.test(n)) web.push(fs.readFileSync(p, 'utf8')); } };
  walk(path.join(root, 'web', 'src'));
  const source = web.join('\n');
  for (const id of used) {
    const literal = new RegExp(`(?:data-testid|testId|testid)=\\{?["'\`]${id}["'\`]`).test(source);
    const prefix = `${id.split('-')[0]}-`; // nav-run, route-a, ack-destination_empty: built from a template such as nav-${id}
    const template = id.includes('-') && new RegExp(`(?:data-testid|testId)=\\{\`${prefix}\\$\\{`).test(source);
    const paneBase = /^(.+)-(?:box|formatted|raw)$/.exec(id)?.[1]; // the vendored JsonPane derives X-box, X-formatted and X-raw from a testId="X" prop
    const pane = paneBase !== undefined && new RegExp(`testId=\\{?["'\`]${paneBase}["'\`]`).test(source) && /\$\{testId\}-formatted/.test(source);
    assert.ok(literal || template || pane, `the web app has no test id ${id}`);
  }
});
