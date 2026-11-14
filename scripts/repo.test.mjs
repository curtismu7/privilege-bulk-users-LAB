// Repo-level pins for the -LAB standard and for this app's identity: files, README standard (tier, fork line, catalog convention, sections,
// ports), no trace of the app it was forked from, CSS standard, CI, Node 26, no SE build, no bare MODE, no EC keygen, Real stays an
// opt-in, no AI attribution.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DEFAULT_PORT, MODE_KEY } from '../server/src/config.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const SKIP = new Set(['node_modules', 'dist', '.git', 'package-lock.json', '.data', '.env']);
const walk = (dir, fn) => {
  for (const name of fs.readdirSync(dir)) {
    if (SKIP.has(name) || name.startsWith('.env.bak.')) continue;
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) walk(p, fn); else fn(p, name);
  }
};
const rel = (p) => path.relative(root, p);
// The app's own React files: not the vendored shared components (each sits in a folder with a .sha256 pin), not the tests.
const ownJsx = () => {
  const out = [];
  walk(path.join(root, 'web', 'src'), (p, name) => {
    if (!name.endsWith('.jsx') || name.endsWith('.test.jsx')) return;
    if (fs.readdirSync(path.dirname(p)).some((f) => f.endsWith('.sha256'))) return;
    out.push(p);
  });
  return out;
};

test('the files the standalone rules ask for are present', () => {
  for (const f of ['README.md', 'CLAUDE.md', 'CHANGELOG.md', 'LICENSE', 'Dockerfile', 'docker-compose.yml', '.dockerignore', '.nvmrc', '.env.example', '.gitignore', '.github/workflows/ci.yml', 'docs/api.md', 'docs/architecture.md', 'docs/security.md', 'docs/live-checks.md', 'docs/references.md', 'docs/talk-track.md', 'docs/content-pack.schema.json', 'docs/shelf-entry.json', 'content/terms.json', 'content-pack.json', 'scripts/doctor.mjs', 'scripts/reset.mjs', 'scripts/smoke.mjs', 'scripts/verify-running.mjs', 'scripts/e2e.mjs', 'scripts/e2e-guard.mjs', 'scripts/check-no-ai-attribution.sh', 'web/src/styles/standalone-ui.css', 'web/src/app.css']) {
    assert.ok(fs.existsSync(path.join(root, f)), f);
  }
});

test('package.json has the standard scripts and requires Node 26; the Dockerfile uses a Node 26 base; the .env is never committed or baked into an image', () => {
  const pkg = JSON.parse(read('package.json'));
  for (const s of ['start', 'dev', 'test', 'build', 'doctor', 'reset', 'smoke', 'e2e', 'talk-track', 'content-pack', 'verify-running']) assert.ok(pkg.scripts[s], s);
  assert.equal(pkg.engines.node, '>=26');
  assert.equal(read('.nvmrc').trim(), '26');
  assert.ok((read('Dockerfile').match(/^FROM node:26-alpine/gm) || []).length === 2 && (read('Dockerfile').match(/^FROM /gm) || []).length === 2, 'every stage is Node 26');
  assert.match(pkg.scripts.test, /node --test scripts\/\*\.test\.mjs/, 'the scripts tests run by glob, never a directory');
  assert.match(JSON.parse(read('server/package.json')).scripts.test, /test\/\*\.test\.js/, 'the server tests run by glob');
  const lines = (f) => read(f).split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  for (const l of ['.env', '.env.*', '!.env.example']) assert.ok(lines('.gitignore').includes(l), `.gitignore has ${l}`);
  assert.ok(lines('.gitignore').indexOf('!.env.example') > lines('.gitignore').indexOf('.env.*'), 'the .env.example exception comes after the .env.* rule');
  for (const l of ['.env', '**/.env', '.env.*', '**/.env.*']) assert.ok(lines('.dockerignore').includes(l), `.dockerignore has ${l}`);
  assert.ok(!lines('.dockerignore').includes('!.env.example') && !fs.existsSync(path.join(root, '.env')), 'no .env is in the tree');
});

test('README follows the README standard: title ends in LAB, Tier Tester, Repo, the catalog convention, the fork line, the sections in order, the port text', () => {
  const r = read('README.md');
  assert.equal(r.split('\n')[0], '# Privilege Bulk Users LAB');
  assert.match(r, /^Tier: Tester$/m);
  assert.match(r, /^Repo: https:\/\/github\.com\/curtismu7\/privilege-bulk-users-LAB$/m);
  assert.match(r, /^Catalog: none yet \(owner assigns with the board row\)$/m, 'no catalog id is assigned yet: the same line the other labs without a row carry');
  assert.match(r, /^Fork of: \[privilege-api-explorer-LAB\]\(https:\/\/github\.com\/curtismu7\/privilege-api-explorer-LAB\)/m, 'an honest fork line');
  assert.match(r, /^Changed from the fork:.*no connections store and no catalog explorer.*bulk engine.*Mock world/m, 'the fork line says what changed');
  const at = (h) => r.indexOf(`\n## ${h}\n`);
  const order = ['What is simulated', 'The two routes', 'Run from a clone', 'Settings file', 'Ports, and what to do if the port is taken', 'Mock and Real', 'The pages', 'Health, doctor and reset', 'Docker', 'Safety model', 'Tests', 'Troubleshooting', 'Docs', 'Ownership'].map(at);
  assert.ok(order.every((i) => i > 0), order.join());
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'sections are in order');
  assert.match(r, new RegExp(`lsof -iTCP:${DEFAULT_PORT} -sTCP:LISTEN -n -P`));
  assert.match(r, /PORT=7890 npm start/);
  assert.match(r, /Port range for this app: three ports are declared: 7817 \(the app\), 7998 \(the end-to-end run, `E2E_PORT`\) and 7999 \(the Vite dev server, `VITE_PORT`\)\. The app itself accepts any `PORT` in 7800-7999/);
  assert.match(r, /\/api\/health/);
  assert.match(r, /npm run doctor/);
  assert.match(r, /npm run reset/);
  assert.match(r, /Mock/); assert.match(r, /Real/);
  assert.ok(!/cmuir\b/i.test(r) && !/ping-devops/i.test(r.replace(/local\.ping-devops\.com:8443/g, '')), 'no personal name and no internal host in the README');
  assert.ok(!/TEST_COUNTS_PLACEHOLDER/.test(r), 'the test counts are filled in');
});

test('no trace of the app this one was forked from: its name, port, catalog id, env names, connections store or spec catalog (the fork line and the changelog name the source repo)', () => {
  const MAY_NAME_THE_SOURCE = new Set(['README.md', 'CHANGELOG.md', 'CLAUDE.md', 'docs/references.md']);
  const everywhere = [/\b7813\b/, /\bD131\b/, /PAE_/, /PRIVILEGE_EXPLORER/, /PRIV_EXPLORER/, /PRIV_LOG_/, /\b447 (?:console )?operations?\b/i, /spec-catalog/i, /swagger catalog/i, /local\.procyon\.ai/i, /\/api\/connections/, /connections\.json/];
  const onlyOutsideTheFork = [/privilege-api-explorer/i, /API Explorer/i];
  const hits = [];
  walk(root, (p, name) => {
    if (/\.(png|jpg|ico|sha256)$/.test(name) || rel(p) === 'scripts/repo.test.mjs') return;
    const text = fs.readFileSync(p, 'utf8');
    for (const re of everywhere) if (re.test(text)) hits.push(`${rel(p)}: ${re}`);
    if (!MAY_NAME_THE_SOURCE.has(rel(p))) for (const re of onlyOutsideTheFork) if (re.test(text)) hits.push(`${rel(p)}: ${re}`);
  });
  assert.deepEqual(hits, []);
});

test('rule 17: the diagrams are diagram-studio/1 data in server/diagrams (route-a, route-b), validated and served by name, copied into the image, and the page builds no nodes or edges itself', () => {
  const dir = path.join(root, 'server', 'diagrams');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  assert.deepEqual(files, ['route-a.json', 'route-b.json']);
  for (const f of files) assert.equal(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).schema, 'diagram-studio/1', f);
  assert.match(read('Dockerfile'), /^COPY server\/diagrams server\/diagrams$/m, 'the image carries the diagram files');
  assert.match(read('server/src/app.js'), /createDiagrams\(/);
  const page = read('web/src/pages/Diagram.jsx');
  assert.match(page, /get\(`\/api\/diagrams\/\$\{encodeURIComponent\(scenario\)\}`\)/, 'the page fetches the diagram by name');
  assert.doesNotMatch(page, /\b(START|EDGES|SCENARIOS)\b/, 'no hand-built node, edge or scenario tables');
  assert.doesNotMatch(page, /position:\s*\{\s*x:\s*-?\d/, 'no literal box positions');
});

test('app CSS follows the CSS standard: tokens only, no dark-mode media query, no forced priority, no italics, breakpoints 600 and 900 only, no purple, shared stylesheet first', () => {
  const css = read('web/src/app.css');
  assert.ok(!/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/.test(css), 'no colour literal');
  assert.ok(!/prefers-color-scheme/.test(css)); assert.ok(!/!important/.test(css)); assert.ok(!/font-style:\s*italic/.test(css));
  const widths = [...css.matchAll(/@media \((?:max|min)-width: (\d+)px\)/g)].map((m) => m[1]);
  assert.ok(widths.length > 0 && widths.every((w) => w === '600' || w === '900'), widths.join());
  assert.ok(!/purple|violet|magenta|indigo/i.test(css));
  assert.ok(!fs.existsSync(path.join(root, 'web/src/styles.css')), 'no second stylesheet with its own palette');
  const main = read('web/src/main.jsx');
  assert.ok(main.indexOf('standalone-ui.css') >= 0 && main.indexOf('standalone-ui.css') < main.indexOf('app.css'), 'the shared stylesheet loads before the app stylesheet');
  const jsx = ownJsx();
  assert.ok(jsx.length >= 8, `found ${jsx.length} app components`);
  const source = jsx.map((p) => fs.readFileSync(p, 'utf8')).join('\n');
  assert.ok(!/<em>|<i>/.test(source), 'no <em> or <i>: emphasis is weight');
  assert.ok(!/\sstyle=\{\{[^}]*(color|background)/.test(source), 'no inline colours');
});

test('the vendored shared files match their sha256 pins (never hand-edit a copy: re-vendor from AI-DEMO-Standalone/shared and regenerate the pin)', () => {
  let pinned = 0;
  walk(path.join(root, 'web', 'src'), (p, name) => {
    if (!name.endsWith('.sha256')) return;
    const lines = fs.readFileSync(p, 'utf8').split('\n').filter((l) => l.trim() && !l.startsWith('#'));
    assert.ok(lines.length > 0, `${rel(p)} lists files`);
    for (const l of lines) {
      const [hash, file] = l.trim().split(/\s+/);
      assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(path.dirname(p), file))).digest('hex'), hash, `${path.join(path.dirname(rel(p)), file)} differs from its pin`);
      pinned++;
    }
  });
  assert.ok(pinned >= 8, `${pinned} vendored files are pinned (TopMenu, JsonView, floating dialog, return link)`);
  const css = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'web/src/styles/standalone-ui.css'))).digest('hex');
  assert.equal(css, read('scripts/standalone-ui.sha256').trim(), 'standalone-ui.css matches scripts/standalone-ui.sha256');
});

test('the CI workflow is GitHub-hosted, Node 26 only, and carries the forbidden-strings, gitleaks, AI-attribution, doctor, content-pack and e2e steps', () => {
  const ci = read('.github/workflows/ci.yml');
  assert.match(ci, /runs-on: ubuntu-latest/);
  assert.ok(!/self-hosted/.test(ci));
  const versions = [...ci.matchAll(/node-version: (\S+)/g)].map((m) => m[1]);
  assert.ok(versions.length >= 4 && versions.every((v) => v === '26'), versions.join());
  assert.match(ci, /forbidden-strings:/);
  assert.match(ci, /gitleaks/);
  assert.match(ci, /actions\/checkout@v5/);
  assert.match(ci, /actions\/setup-node@v5/);
  assert.match(ci, /run: npm test/);
  assert.match(ci, /run: npm run build/);
  assert.match(ci, /run: npm run doctor/);
  assert.match(ci, /validate-content-pack\.mjs/);
  assert.match(ci, /check-ui-standard\.sh/);
  assert.match(ci, /check-no-ai-attribution\.sh/);
  assert.match(ci, /run: npm run e2e/);
  assert.match(ci, /npx playwright install --with-deps chromium/);
  assert.match(ci, /secrets\.FORBIDDEN_STRINGS/);
  // A broken Dockerfile or compose file cannot ship green: the image builds, and compose is valid with no .env and HOST_PORT unset.
  assert.match(ci, /^  docker:$/m, 'a docker job');
  assert.match(ci, /run: docker build\b[^\n]* \.$/m);
  assert.match(ci, /test ! -e \.env/);
  assert.match(ci, /env -u HOST_PORT docker compose config/);
  const uses = [...ci.matchAll(/uses: (actions\/[a-z-]+@v\d+)/g)].map((m) => m[1]);
  assert.ok(uses.length >= 8 && uses.every((u) => /^actions\/(checkout|setup-node)@v5$|^actions\/upload-artifact@v4$/.test(u)), `action versions: ${[...new Set(uses)].join(', ')}`);
});

test('the repo ships no k8s manifests, no deploy scripts, no hosted mode and no bare MODE', () => {
  for (const d of ['k8s', 'deploy', 'server/src/workspaces.js']) assert.ok(!fs.existsSync(path.join(root, d)), d);
  const hits = [];
  walk(root, (p, name) => {
    if (/\.test\.m?jsx?$/.test(name) || !(/\.(m?jsx?|json|ya?ml|html|css)$/.test(name) || name === 'Dockerfile')) return;
    if (/process\.env\.MODE\b|env\.MODE\b|se-mock|SE_HOST|__IMAGE__|VITE_BASE_PATH/.test(fs.readFileSync(p, 'utf8'))) hits.push(rel(p));
  });
  assert.deepEqual(hits, []);
});

test('no EC key generation through generateKeyPair(Sync) anywhere (SIGABRT on Node 20 CI); RSA is fine', () => {
  const hits = [];
  walk(root, (p, name) => {
    if (!/\.(m?jsx?)$/.test(name) || name === 'repo.test.mjs') return;
    const t = fs.readFileSync(p, 'utf8');
    for (const m of t.matchAll(/generateKeyPair(Sync)?\(\s*['"]([a-z0-9-]+)['"]/g)) if (m[2] !== 'rsa') hits.push(`${rel(p)}: ${m[2]}`);
  });
  assert.deepEqual(hits, []);
});

test('Real stays an opt-in: the only mode key is PRIVILEGE_BULK_MODE, nothing in the repo sets it, a bare MODE is never read, and the page state starts as mock', () => {
  assert.equal(MODE_KEY, 'PRIVILEGE_BULK_MODE');
  assert.match(read('web/src/App.jsx'), /useState\("mock"\)/);
  assert.doesNotMatch(read('server/src/settings.js'), /['"]MODE['"]/);
  assert.match(read('server/src/index.js'), /applySettings\(\)/);
  const code = (f) => read(f).split('\n').filter((l) => !/^\s*(#|\/\/)/.test(l)).join('\n');
  for (const f of ['docker-compose.yml', 'Dockerfile', '.github/workflows/ci.yml']) assert.ok(!code(f).includes(MODE_KEY), `${f} never sets ${MODE_KEY}: it comes from the owner's .env only`);
  assert.doesNotMatch(read('.env.example'), /^PRIVILEGE_BULK_MODE=\S/m, '.env.example carries no value, so it cannot switch Real on');
});

test('no shipped text names a real customer, company, tenant or personal path, and uses no retired wording', () => {
  const retired = new RegExp(`\\b${['do', 'or'].join('')}s?\\b`, 'i');
  const hits = [];
  walk(root, (p, name) => {
    if (/(repo|docs|content-pack|shelf-entry)\.test\.mjs$/.test(p) || /\.(png|jpg|ico)$/.test(name)) return;
    // The two lab-proxy names are the one allowed use of the proxy's domain: its public name (the Origin check and its tests name it)
    // and this app's own Host name (the compose default for LAB_ALLOWED_HOSTS). Anything else with that word is still a hit.
    const t = fs.readFileSync(p, 'utf8').replace(/(?:privilege-bulk-users\.)?local\.ping-devops\.com/gi, 'LAB-HOST');
    for (const w of ['united airlines', 'mileageplus', 'datapower', 'optum', 'unitedhealth', 'uhg', 'personal-agent', 'ping-devops', 'amazonaws.com', '/users/cmuir', 'cmuir_pingcorp']) if (t.toLowerCase().includes(w)) hits.push(`${rel(p)}: ${w}`);
    if (/\.(md|json)$/.test(name) && retired.test(t)) hits.push(`${rel(p)}: retired wording`);
  });
  assert.deepEqual(hits, []);
});

test('no AI attribution anywhere in the tree; and, in a git checkout, scripts/check-no-ai-attribution.sh passes', () => {
  const credit = /[G]enerated with \[?[C]laude Code|[C]o-[A]uthored-[B]y:/i;
  const hits = [];
  walk(root, (p, name) => { if (!/\.(png|jpg|ico)$/.test(name) && credit.test(fs.readFileSync(p, 'utf8'))) hits.push(rel(p)); });
  assert.deepEqual(hits, []);
  if (!fs.existsSync(path.join(root, '.git'))) return; // a synced copy has no git history to check
  execFileSync('bash', ['scripts/check-no-ai-attribution.sh'], { cwd: root, stdio: 'pipe' }); // throws on a non-zero exit
});
