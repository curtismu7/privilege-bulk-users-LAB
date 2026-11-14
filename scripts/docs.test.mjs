// The docs must stay true: every test security.md names exists, every relative link resolves, every npm script a doc names is real,
// the settings names agree across the code, .env.example, docs/api.md and the Help page, and docs/api.md matches the server's routes,
// codes and scenarios.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { DEFAULT_PORT, PORT_MAX, PORT_MIN } from '../server/src/config.js';
import { SCENARIOS } from '../server/src/mockWorld.js';
import { SETTING_KEYS } from '../server/src/settings.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const docsMd = fs.readdirSync(path.join(root, 'docs')).filter((x) => x.endsWith('.md')).map((x) => `docs/${x}`);
const prose = ['README.md', 'CLAUDE.md', 'CHANGELOG.md', ...docsMd];
const serverSrc = fs.readdirSync(path.join(root, 'server/src')).filter((f) => f.endsWith('.js')).map((f) => read(`server/src/${f}`)).join('\n');
// Every test file by its base name: the server's (server/test), the web app's (web/src, any depth) and this folder's.
const testSources = {};
const collect = (dir) => { for (const n of fs.readdirSync(path.join(root, dir))) { const p = `${dir}/${n}`; if (fs.statSync(path.join(root, p)).isDirectory()) { if (n !== 'node_modules') collect(p); } else if (/\.test\.(?:js|jsx|mjs)$/.test(n)) testSources[n] = read(p); } };
collect('server/test'); collect('web/src'); collect('scripts');
const sorted = (a) => [...a].sort();

test('every `file :: test title` in docs/security.md and docs/architecture.md names a test that exists', () => {
  const refs = [...read('docs/security.md').matchAll(/`(?:(?:server\/test|web\/src(?:\/[a-z-]+)?|scripts)\/)?([a-zA-Z.-]+\.test\.(?:js|jsx|mjs)) :: ([^`]+)`/g)];
  refs.push(...read('docs/architecture.md').matchAll(/`(?:(?:server\/test|web\/src(?:\/[a-z-]+)?|scripts)\/)?([a-zA-Z.-]+\.test\.(?:js|jsx|mjs)) :: ([^`]+)`/g));
  assert.ok(refs.length >= 25, `found ${refs.length} references`);
  for (const [, file, title] of refs) assert.ok(testSources[file]?.includes(title), `${file} has no test titled "${title}"`);
});
test('relative markdown links in the README, the changelog and the docs resolve', () => {
  for (const f of prose) {
    for (const [, target] of read(f).matchAll(/\]\(([^)#\s]+)(?:#[^)]*)?\)/g)) {
      if (/^[a-z]+:/.test(target)) continue;
      assert.ok(fs.existsSync(path.join(root, path.dirname(f), target)), `${f}: broken link ${target}`);
    }
  }
});
test('every `npm run <script>` a doc names exists in package.json', () => {
  const scripts = JSON.parse(read('package.json')).scripts;
  for (const f of prose) for (const [, name] of read(f).matchAll(/npm run ([a-z0-9:-]+)/g)) assert.ok(scripts[name], `${f} names npm run ${name}`);
});
test('the commands in CLAUDE.md are the ones in package.json', () => {
  const scripts = Object.keys(JSON.parse(read('package.json')).scripts);
  const named = new Set([...read('CLAUDE.md').matchAll(/npm run ([a-z0-9:-]+)/g)].map((m) => m[1]));
  for (const s of ['build', 'dev', 'doctor', 'reset', 'smoke', 'e2e', 'content-pack', 'talk-track', 'verify-running']) assert.ok(named.has(s), `CLAUDE.md names npm run ${s}`);
  for (const s of named) assert.ok(scripts.includes(s), s);
});

test('.env.example lists exactly the names the server reads (SETTING_KEYS), each with a comment and never a value', () => {
  const lines = read('.env.example').split('\n');
  const names = lines.filter((l) => /^[A-Z][A-Z0-9_]*=/.test(l)).map((l) => l.split('=')[0]);
  assert.deepEqual(sorted(names), sorted(SETTING_KEYS));
  assert.equal(new Set(names).size, names.length, 'no name twice');
  for (const l of lines.filter((x) => /^[A-Z][A-Z0-9_]*=/.test(x))) assert.equal(l.split('=').slice(1).join('='), '', `${l.split('=')[0]} carries no value`);
  names.forEach((n) => { const i = lines.findIndex((l) => l.startsWith(`${n}=`)); assert.match(lines[i - 1] ?? '', /^# \S/, `${n} has a one-line comment above it`); });
});
test('the settings block of docs/api.md names exactly SETTING_KEYS', () => {
  const block = /## Settings[^\n]*\n+```\n([\s\S]*?)```/.exec(read('docs/api.md'))?.[1];
  assert.ok(block, 'docs/api.md has a settings block');
  const names = [...block.matchAll(/\b(PRIVILEGE_BULK_MODE|BULK_[A-Z0-9_]+)(?==)/g)].map((m) => m[1]);
  assert.deepEqual(sorted(new Set(names)), sorted(SETTING_KEYS));
});
test('the Help page names every setting', () => {
  const help = read('web/src/pages/Help.jsx');
  for (const k of SETTING_KEYS) assert.ok(help.includes(`"${k}"`), `Help.jsx lists ${k}`);
});
test('every setting or environment name a doc mentions is one the server really reads', () => {
  const extra = new Set(['BULK_ENV_FILE']); // the host-run override of the .env path (settings.js)
  for (const f of [...prose, '.env.example', 'docker-compose.yml']) {
    for (const [, n] of read(f).matchAll(/\b(PRIVILEGE_BULK_[A-Z]+|BULK_[A-Z0-9_]*[A-Z0-9])\b/g)) assert.ok(SETTING_KEYS.includes(n) || extra.has(n), `${f} names ${n}`);
    for (const [, n] of read(f).matchAll(/\b(PBU_[A-Z0-9_]+)\b/g)) assert.ok(serverSrc.includes(n), `${f} names ${n}, which no server file reads`);
  }
  assert.ok(serverSrc.includes('BULK_ENV_FILE'));
});

test('docs/api.md documents every route the server registers, and the codes and scenarios agree with the code', () => {
  const api = read('docs/api.md');
  const routes = new Set([...read('server/src/app.js').matchAll(/app\.(?:get|post|put|delete|use)\('(\/api\/[^']+)'/g)].map((m) => m[1]));
  assert.ok(routes.size >= 14, `found ${routes.size} routes`);
  for (const r of routes) assert.ok(api.includes(r), `docs/api.md does not mention ${r}`);
  const codes = [...api.matchAll(/\|\s*\d{3}\s*\|\s*`([a-z_]+)`/g)].map((m) => m[1]);
  assert.ok(codes.length >= 8, `found ${codes.length} refusal codes`);
  for (const line of api.split('\n').filter((l) => /^(Warning codes|Error codes inside)/.test(l))) for (const [, c] of line.matchAll(/`([a-z_]+)`/g)) codes.push(c);
  for (const c of new Set(codes)) assert.ok(serverSrc.includes(`'${c}'`) || serverSrc.includes(`"${c}"`) || serverSrc.includes(`\`${c}\``), `no server file uses the code ${c}`);
  const line = api.split('\n').find((l) => l.startsWith('Mock scenario ids:'));
  assert.ok(line, 'docs/api.md lists the Mock scenario ids');
  assert.deepEqual(sorted([...line.matchAll(/`([a-z-]+)`/g)].map((m) => m[1])), sorted(SCENARIOS.map((s) => s.id)));
});

test('the port is the same in the code, the README, CLAUDE.md, the shelf entry and the docs; the dev port in the README is the one in vite.config.js', () => {
  assert.equal(DEFAULT_PORT, 7817);
  assert.equal(PORT_MIN, 7800); assert.equal(PORT_MAX, 7999);
  for (const f of ['README.md', 'CLAUDE.md', 'docs/shelf-entry.json', 'docs/architecture.md']) assert.ok(read(f).includes(String(DEFAULT_PORT)), `${f} names port ${DEFAULT_PORT}`);
  const vite = /VITE_PORT\)\s*\|\|\s*(\d+)/.exec(read('web/vite.config.js'))?.[1];
  assert.ok(vite, 'vite.config.js has a VITE_PORT default');
  assert.match(read('README.md'), new RegExp(`VITE_PORT[^\\n]*\\b${vite}\\b|\\b${vite}\\b[^\\n]*VITE_PORT`), `the README names the Vite dev port ${vite} and VITE_PORT`);
  assert.match(read('web/vite.config.js'), new RegExp(`PORT\\) \\|\\| ${DEFAULT_PORT}`), 'the Vite proxy points at the app port');
  const e2e = /E2E_PORT\) \|\| (\d+)/.exec(read('scripts/e2e.mjs'))?.[1];
  assert.equal(e2e, '7998', 'the end-to-end run uses the port the README declares');
  assert.equal(vite, '7999', 'the Vite dev server uses the port the README declares');
  assert.match(read('README.md'), /7998 \(the end-to-end run, `E2E_PORT`\)/);
  assert.match(read('CLAUDE.md'), /7998/);
});

test('live-checks.md, architecture.md and security.md have their required parts, and every claim the Guide cannot source is labelled UNVERIFIED', () => {
  const lc = read('docs/live-checks.md');
  for (const h of ['## Before you start', '## Checks', '## How to stop', '## Roll back', '## Stop if', '## Evidence template']) assert.ok(lc.includes(h), h);
  for (const w of [/Writes switch/, /REGISTER/, /plan again/i, /this lab never deletes/i, /UNVERIFIED/, /small source/i]) assert.match(lc, w);
  // The owner's warnings: the same-environment source, the cost of a plan, the default population, how to stop and rotate, the env_file exposure.
  for (const w of [/BULK_P1_SOURCE_ENV_ID` equals `BULK_P1_PRIVILEGE_ENV_ID/, /every person in the whole environment/, /one more read per person/, /default population/, /notifications/, /Abort/, /Reset/, /docker compose down/, /[Rr]otate the worker secret/, /docker inspect/, /Concurrency/, /\*\*Real\*\* option in that select is disabled/]) assert.match(lc, w);
  assert.doesNotMatch(lc, /press \*\*Real\*\*/i, 'the Mode control is a select, not a Real button');
  const arch = read('docs/architecture.md');
  for (const w of ['snapshot', 'job manager', 'two-step gate', 'Mock world', 'pool']) assert.ok(arch.toLowerCase().includes(w.toLowerCase()), `architecture.md covers ${w}`);
  const sec = read('docs/security.md');
  for (const h of ['## What is NOT protected', '## The two-step gate']) assert.ok(sec.includes(h), h);
  assert.match(sec, /owner-run/i);
});
test('docs/references.md and the Guide page carry the same UNVERIFIED list', () => {
  const section = read('docs/references.md').split(/^## UNVERIFIED.*$/m)[1]?.split(/^## /m)[0] ?? '';
  const bullets = section.split('\n').filter((l) => l.startsWith('- ')).map((l) => l.slice(2).trim());
  assert.ok(bullets.length >= 5, `found ${bullets.length} bullets`);
  const guide = read('web/src/pages/Guide.jsx');
  const listed = [...guide.slice(guide.indexOf('export const UNVERIFIED'), guide.indexOf('export const PLACEHOLDERS')).matchAll(/^\s*"(.*)",$/gm)].map((m) => JSON.parse(`"${m[1]}"`));
  assert.deepEqual(listed, bullets);
});
