#!/usr/bin/env node
// Real-browser run of the BUILT app in Mock only. No real PingOne environment or console is contacted: the server is started with
// PRIVILEGE_BULK_MODE=mock and no .env, with the shipped netguard installed first by scripts/e2e-guard.mjs (which writes its attempts
// to a file on exit); this script asserts zero outbound attempts and that the browser's own requests stayed on loopback.
// Flow: Guide (the UNVERIFIED list, a placeholder-only curl sample, axe) -> Run: route A, the Clean scenario, 100 people: plan, apply with
// the typed count, verify finds 0 to apply -> the Missing role scenario: the blocking warning keeps Apply disabled until acknowledged
// (axe on the Run page with the warning and the apply panel showing) -> Reset.
// Screenshots go to E2E_SHOTS or .data/e2e-screenshots (git-ignored).
//   npm run build && node scripts/e2e.mjs        (E2E_PORT, default 7998; E2E_CHROMIUM=<binary> if the pinned Playwright build is missing)
import AxeBuilder from '@axe-core/playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shots = process.env.E2E_SHOTS || path.join(root, '.data', 'e2e-screenshots');
const port = Number(process.env.E2E_PORT) || 7998;
const base = `http://127.0.0.1:${port}`;
let failures = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) failures++; return ok; };

if (!fs.existsSync(path.join(root, 'web', 'dist', 'index.html'))) { console.error('Run `npm run build` first.'); process.exit(2); }
fs.mkdirSync(shots, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'privilege-bulk-users-e2e-'));
const guardFile = path.join(tmp, 'guard.json');

// The server's environment is built from scratch: nothing of this lab's own settings (BULK_*, PBU_*, a mode) is inherited from the shell.
const inherited = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(BULK_|PBU_|PRIVILEGE_BULK_|LAB_ALLOWED_|PORT$|SHELF_URL$)/.test(k)));
const server = spawn(process.execPath, ['--import', pathToFileURL(path.join(root, 'scripts', 'e2e-guard.mjs')).href, 'server/src/index.js'], {
  cwd: root,
  env: { ...inherited, PORT: String(port), PBU_DATA_DIR: path.join(tmp, 'data'), BULK_ENV_FILE: path.join(tmp, 'none.env'), PRIVILEGE_BULK_MODE: 'mock', SHELF_URL: 'https://shelf.example:8443/', E2E_GUARD_FILE: guardFile },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const serverErr = [];
server.stderr.on('data', (d) => serverErr.push(String(d)));
const exited = new Promise((resolve) => server.once('close', resolve));
const waitReady = async () => {
  for (let i = 0; i < 100; i++) {
    try { const r = await fetch(`${base}/api/health`); if (r.ok) return true; } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
};

// The UNVERIFIED section of docs/references.md: one bullet per item. The Guide must list exactly that many.
const unverifiedCount = (() => {
  const text = fs.readFileSync(path.join(root, 'docs', 'references.md'), 'utf8');
  const section = text.split(/^## UNVERIFIED.*$/m)[1]?.split(/^## /m)[0] ?? '';
  return section.split('\n').filter((l) => l.startsWith('- ')).length;
})();

let browser;
const offHost = [];
const pageErrors = [];
let page;
try {
  check(await waitReady(), 'the server comes up on the loopback port');
  browser = await chromium.launch(process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM } : {});
  page = await (await browser.newContext()).newPage(); // axe needs a page from an explicit context
  page.on('request', (req) => { try { if (!['127.0.0.1', 'localhost'].includes(new URL(req.url()).hostname)) offHost.push(req.url()); } catch { /* keep going */ } });
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  const t = (id) => page.getByTestId(id);
  const api = async (p) => (await page.request.get(`${base}${p}`)).json();
  // The Run page shows the job it was last given: wait until the page shows THIS kind of job in THIS state (a finished plan stays on screen while an apply starts).
  const waitJob = (kind, state) => page.waitForFunction(([k, s]) => {
    const job = document.querySelector('[data-testid="job"]');
    const st = document.querySelector('[data-testid="job-state"]');
    return Boolean(job && st && job.querySelector('h2')?.textContent.includes(k) && st.textContent.trim() === s);
  }, [kind, state], { timeout: 90_000 });
  const axe = async (name) => {
    try {
      // The font-size stepper is part of the vendored shared TopMenu (rule 22: never edited here). axe reports label-content-name-mismatch on its
      // two buttons (aria-label "Smaller text" / "Larger text" against a different visible label); that is a finding for the canonical component, so it is left out of this check and reported.
      const bad = (await new AxeBuilder({ page }).exclude('[data-testid="font-stepper"]').analyze()).violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      check(bad.length === 0, `axe on ${name}: no serious or critical violations (${bad.map((v) => `${v.id} x${v.nodes.length} at ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`).join('; ') || 'clean'})`);
    } catch (e) { check(false, `axe on ${name} could not run: ${e.message.split('\n')[0]}`); }
  };

  // --- the header and the banner, on load
  await page.goto(base, { waitUntil: 'networkidle' });
  check((await t('mode').textContent()).includes('mock'), 'the header says Mode: mock on load');
  check((await t('banner').textContent()).includes('MOCK mode'), 'the banner says Mock on load');

  // --- Guide
  await page.goto(`${base}/#/guide`, { waitUntil: 'networkidle' });
  await t('guide-page').waitFor();
  const items = await t('unverified-list').locator('li').count();
  check(unverifiedCount > 0 && items === unverifiedCount, `the Guide lists the ${unverifiedCount} UNVERIFIED items of docs/references.md (${items} shown)`);
  const samples = await page.locator('pre').allInnerTexts();
  const guideText = await t('guide-page').innerText();
  check(samples.some((s) => /^curl\b/m.test(s) && /\$TOKEN\b/.test(s)), 'the Guide shows a curl sample that uses $PLACEHOLDER variables');
  check(!/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(guideText) && !/eyJ[A-Za-z0-9_-]{10,}/.test(guideText), 'the Guide holds no identifier and no token: placeholders only');
  await page.screenshot({ path: path.join(shots, 'guide.png'), fullPage: true });
  await axe('the Guide page');

  // --- Run: route A, Clean, 100 people
  await t('nav-run').click();
  await t('run-page').waitFor();
  await t('route-a').check();
  await t('scenario-select').selectOption('clean');
  await t('users-select').selectOption('100');
  await axe('the Run page (before a job)');
  await t('plan-btn').click();
  await waitJob('Plan', 'done');
  const plan = (await api('/api/jobs/current')).job;
  const n = plan.counts.toApply;
  check(plan.kind === 'plan' && plan.source === 'mock' && plan.scenario === 'clean' && plan.total === 100 && n > 0, `route A plan: 100 people, ${n} to apply (a plan writes nothing)`);
  check(await t('counts').isVisible() && await t('progress').isVisible() && (await t('job-phase').textContent()).length > 0, 'the page shows the counts, the progress and the phase');

  await t('apply-panel').waitFor();
  check(await t('apply-btn').isDisabled(), 'Apply is disabled until the count is typed');
  await t('confirm-input').fill(`REGISTER ${n + 1}`);
  check(await t('apply-btn').isDisabled(), 'Apply stays disabled for a wrong count');
  await t('confirm-input').fill(`REGISTER ${n}`);
  check(await t('apply-btn').isEnabled(), `Apply is enabled once REGISTER ${n} is typed`);
  await t('apply-btn').click();
  await waitJob('Apply', 'done');
  const applied = (await api('/api/jobs/current')).job;
  check(applied.kind === 'apply' && applied.counts.failed === 0 && applied.counts.pending === 0 && applied.counts.created + applied.counts.added === n, `apply finished: ${applied.counts.created} created, ${applied.counts.added} added, 0 failed, 0 pending`);
  await t('results-table').waitFor();
  check(await t('report-json').isVisible() && await t('report-csv').isVisible(), 'the results table and both report links are shown');
  await page.screenshot({ path: path.join(shots, 'run-applied.png'), fullPage: true });

  await t('verify-btn').click();
  await waitJob('Plan', 'done');
  const verify = (await api('/api/jobs/current')).job;
  await t('plan-clean').waitFor();
  check(verify.kind === 'plan' && verify.counts.toApply === 0 && (await t('plan-clean').textContent()).includes('Verified: 0 to apply') && await t('apply-panel').count() === 0, 'verify (plan again) finds 0 to apply and offers no Apply');

  // --- Run: the Missing role scenario
  await t('scenario-select').selectOption('missing-role');
  await t('plan-btn').click();
  await t('warnings').waitFor(); // the verify plan is still on screen until the new plan arrives; only the new one has warnings
  check(await t('ack-destination_empty').count() === 1, 'missing role: the plan shows the blocking destination_empty warning with its acknowledge box');
  const m = (await api('/api/jobs/current')).job.counts.toApply;
  await t('apply-panel').waitFor();
  await t('confirm-input').fill(`REGISTER ${m}`);
  check(await t('apply-btn').isDisabled(), 'with the count typed, Apply is still disabled until the warning is acknowledged');
  await t('ack-destination_empty').check();
  check(await t('apply-btn').isEnabled(), 'once the warning is acknowledged, Apply is enabled (it is not pressed)');
  await t('ack-destination_empty').uncheck();
  check(await t('apply-btn').isDisabled(), 'un-ticking it disables Apply again');
  await page.screenshot({ path: path.join(shots, 'run-missing-role.png'), fullPage: true });
  await axe('the Run page (with a warning and the apply panel)');

  // --- the other pages, and the shared JSON pane in both views (the Audit page holds the entries of the jobs above, so this runs before Reset)
  await page.goto(`${base}/#/audit`, { waitUntil: 'networkidle' });
  await t('audit-page').waitFor();
  await t('audit-table').waitFor();
  await page.getByRole('button', { name: /Details for entry 1/ }).click();
  await t('audit-detail').waitFor();
  check((await t('audit-json-formatted').getAttribute('aria-pressed')) === 'true' && (await t('audit-json-box').getAttribute('data-view')) === 'form', 'the JSON pane opens Formatted (rule 24: a form, one choice for the page)');
  await axe('the Audit page (JSON pane, Formatted)');
  await t('audit-json-raw').click();
  check((await t('audit-json').evaluate((el) => el.tagName)) === 'PRE' && (await t('audit-json').innerText()).includes('"outcome"'), 'the Raw view is the exact JSON text');
  await axe('the Audit page (JSON pane, Raw)');
  await page.goto(`${base}/#/diagram`, { waitUntil: 'networkidle' });
  await t('diagram-lede').waitFor();
  await axe('the Diagram page');
  // Arrow labels: drawn above the boxes (none left as SVG text under them), the walked arrow's label is marked and raised, and no label
  // overlaps another label or sits on a box.
  await page.waitForSelector('.flow-label');
  await page.locator('.controls select').nth(1).selectOption('0.5'); // slow, so a loaded machine cannot tick past the step under test
  await page.getByRole('button', { name: 'Simulate' }).click();
  await page.waitForSelector('.flow-label--on');
  const lab = await page.evaluate(() => {
    const els = [...document.querySelectorAll('.flow-label')]; const rects = els.map((l) => l.getBoundingClientRect());
    const boxes = [...document.querySelectorAll('.react-flow__node')].map((n) => n.getBoundingClientRect());
    const hit = (a, b) => a.x < b.right && b.x < a.right && a.y < b.bottom && b.y < a.bottom;
    let pairs = 0; for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) if (hit(rects[i], rects[j])) pairs++;
    const hot = els.filter((l) => l.classList.contains('flow-label--on')); const other = els.find((l) => !l.classList.contains('flow-label--on'));
    return { n: els.length, svg: document.querySelectorAll('.react-flow__edge-text').length, pairs, onBox: rects.filter((r) => boxes.some((b) => hit(r, b))).length, hot: hot.length, hotColour: hot[0] && getComputedStyle(hot[0]).color, otherColour: other && getComputedStyle(other).color, hotZ: hot[0] && getComputedStyle(hot[0]).zIndex, otherZ: other && getComputedStyle(other).zIndex };
  });
  check(lab.n >= 5 && lab.svg === 0, `arrow labels are drawn above the boxes, none left as SVG text (${lab.n} labels, ${lab.svg} SVG)`);
  check(lab.hot === 1 && lab.otherColour && lab.hotColour !== lab.otherColour, `the walked arrow's label changes colour (${lab.otherColour} -> ${lab.hotColour})`);
  check(Number(lab.hotZ) > Number(lab.otherZ), `the walked arrow's label is raised above the others (z ${lab.hotZ} vs ${lab.otherZ})`);
  check(lab.pairs === 0 && lab.onBox === 0, `no label overlaps another label or a box (${lab.pairs} overlaps, ${lab.onBox} on a box)`);
  await axe('the Diagram page while an arrow is walked');
  await page.locator('.controls').getByRole('button', { name: 'Reset' }).click();
  // A box expands in place: click it and its details appear below its title, inside the box, on top; click it again and it collapses;
  // a #/diagram/<route>/<box> link opens that route with the box expanded. axe stays clean with a box expanded.
  await page.locator('[data-testid=box-app] strong').click();
  await page.waitForSelector('.fbox[data-open] .passport');
  await page.waitForTimeout(600); // the view eases to the expanded box
  const px = await page.evaluate(() => {
    const open = document.querySelector('.fbox[data-open]'); const t = open.querySelector('strong').getBoundingClientRect(); const p = open.querySelector('.passport').getBoundingClientRect(); const b = open.getBoundingClientRect();
    const top = document.elementFromPoint(p.x + p.width / 2, p.y + p.height / 2);
    const hit = (a, c) => a.x < c.right && c.x < a.right && a.y < c.bottom && c.y < a.bottom;
    const ls = [...document.querySelectorAll('.flow-label')].map((l) => l.getBoundingClientRect()); let pairs = 0; for (let i = 0; i < ls.length; i++) for (let j = i + 1; j < ls.length; j++) if (hit(ls[i], ls[j])) pairs++;
    return { count: document.querySelectorAll('.passport').length, below: p.top >= t.bottom - 1 && p.bottom <= b.bottom + 1, onTop: !!top && !!top.closest('.passport'), text: open.querySelector('.passport').innerText, links: [...open.querySelectorAll('.passport a')].map((a) => a.getAttribute('href')), pairs };
  });
  check(px.count === 1 && px.below && px.onTop, 'clicking a box expands it in place: details below its title, inside the box, on top');
  const inView = await page.evaluate(() => { const c = document.querySelector('.flow-wrap').getBoundingClientRect(); const b = document.querySelector('.fbox[data-open]').getBoundingClientRect(); return b.top >= c.top - 1 && b.bottom <= c.bottom + 1 && b.left >= c.left - 1 && b.right <= c.right + 1; });
  check(inView, 'the expanded box is brought fully into view, nothing cut off by the canvas edge');
  check(/upstream \d+ · downstream \d+/i.test(px.text) && /outgoing · \d+/i.test(px.text) && /incoming · \d+/i.test(px.text), 'the details show reach, outgoing and incoming');
  check(px.links.length === 3 && px.links.every((h) => /^https:\/\/github\.com\/curtismu7\/privilege-bulk-users-LAB\/blob\/[0-9a-f]{40}\/server\/src\/[A-Za-z]+\.js#L\d+-L\d+$/.test(h)), `the box lists its three code pointers as links to the pinned commit (${px.links.length} links)`);
  check(px.pairs === 0, `with a box expanded no two labels overlap (${px.pairs} overlaps)`);
  await axe('the Diagram page with a box expanded');
  await page.locator('[data-testid=box-app] strong').click();
  check(await page.locator('.fbox[data-open]').count() === 0, 'clicking the open box again collapses it');
  const linked = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await linked.goto(`${base}/#/diagram/route-b/app`, { waitUntil: 'networkidle' }); await linked.waitForSelector('.fbox[data-open]');
  check(await linked.locator('[data-testid=box-app][data-open]').count() === 1 && /Route B/.test(await linked.locator('.controls select').first().evaluate((el) => el.options[el.selectedIndex].text)), 'a #/diagram/<route>/<box> link opens that route with that box expanded');
  await linked.close();
  await page.goto(`${base}/#/help`, { waitUntil: 'networkidle' });
  await t('help-page').waitFor();
  await axe('the Help page');

  // --- Reset from the header
  await t('reset').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="live"]')?.textContent.includes('Reset'), null, { timeout: 10_000 });
  check((await api('/api/jobs/current')).job === null && (await api('/api/audit')).entries.length === 0, 'Reset clears the job and the audit history');
} catch (e) {
  check(false, `the run failed: ${e.message.split('\n')[0]}`);
  await page?.screenshot({ path: path.join(shots, 'failure.png'), fullPage: true }).catch(() => {});
  if (serverErr.length) console.log(`server stderr: ${serverErr.join('').slice(0, 600)}`);
} finally {
  check(offHost.length === 0, `the browser stayed on loopback (${offHost.length} off-host requests)`);
  check(pageErrors.length === 0, `no page errors (${pageErrors.join(' | ') || 'clean'})`);
  await browser?.close();
  server.kill('SIGTERM');
  await exited;
  let attempts = null;
  try { attempts = JSON.parse(fs.readFileSync(guardFile, 'utf8')); } catch { /* the server did not get to write it */ }
  check(Array.isArray(attempts) && attempts.length === 0, `the server made zero outbound attempts (${attempts === null ? 'no record written' : attempts.length})`);
  fs.rmSync(tmp, { recursive: true, force: true });
}
process.exit(failures ? 1 : 0);
