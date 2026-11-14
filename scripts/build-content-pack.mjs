#!/usr/bin/env node
// Generates content-pack.json (repo root) for the Learning Hub. Format: docs/content-pack.schema.json (copy of the ID-JAG kit's).
// Deterministic: lists sorted by id, 2-space JSON, no timestamps; a commit is recorded only when passed (--commit=<sha>).
// Sources: none. A source is listed only if its URL was fetched this build or verified; this lab's sources are the files in
// docs/references.md (a script run by the owner, the console's swagger), not web pages, so the list is empty on purpose.
// Catalog: the owner has not assigned a catalog id. The pack schema requires one, so the pack carries the D000 placeholder and
// docs/shelf-entry.json carries none (the same convention as the other labs without a row).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PACK_PATH = path.join(ROOT, 'content-pack.json');
export const CATALOG_PLACEHOLDER = 'D000';
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

const CARDS = [
  { id: 'routes', label: 'Two routes to register people', description: 'Route A calls the PingOne Management API (create in Privilege\'s environment, add to the Privilege group). Route B calls the Privilege console API, UNVERIFIED against a real console. The Guide shows both as curl commands with placeholders.', group: 'concept', href: '/#/guide', terms: ['privilege-group', 'route-a', 'route-b'] },
  { id: 'empty-list', label: 'The empty list that is not a 403', description: 'A worker app without the Identity Data Admin role reads an empty user list instead of an error. The plan turns that into a blocking warning you must acknowledge.', group: 'concept', href: '/#/guide', terms: ['empty-list-trap', 'identity-data-admin', 'worker-app'] },
  { id: 'plan', label: 'Plan: a dry run', description: 'Read the source and the destination once, decide every person in memory, write nothing. The counts say who to create, who to add, who is in sync, and who needs a person to look.', group: 'try-it', href: '/#/run', terms: ['plan-apply-verify', 'snapshot-diff', 'conflict'] },
  { id: 'apply', label: 'Apply: the two-step gate', description: 'Apply needs a fresh plan and the exact count typed back as REGISTER n. Blocking warnings need an acknowledgement; in Real the Writes switch must be on too. Every refusal names its reason.', group: 'try-it', href: '/#/run', terms: ['two-step-gate'] },
  { id: 'backoff', label: '429: slow down together', description: 'Run the Realistic scenario and watch the 429 counter and the time waited: one 429 pauses every worker for the Retry-After, then the run carries on.', group: 'try-it', href: '/#/run', terms: ['rate-limit-backoff', 'circuit-breaker'] },
  { id: 'verify', label: 'Verify: plan again', description: 'After an apply, plan again. A clean run finds 0 to apply, because people who are already right are left alone.', group: 'try-it', href: '/#/run', terms: ['idempotent-verify'] },
  { id: 'results', label: 'Results and reports', description: 'Every person has a row with a status, an HTTP status and the tries. Download the last job as JSON or CSV. Addresses are masked and the audit never holds one.', group: 'reference', href: '/#/run', terms: ['audit-log'] },
  { id: 'diagram', label: 'Diagram', description: 'Route A and route B drawn as diagram-studio data: movable boxes, Simulate, Reset, speed.', group: 'concept', href: '/#/diagram' },
  { id: 'audit', label: 'Audit log', description: 'One summary line per plan, apply, abort or writes switch. No address, no credential.', group: 'reference', href: '/#/audit', terms: ['audit-log'] },
  { id: 'mock', label: 'Mock: six scenarios, no tenant', description: 'An in-process stand-in for PingOne and the Privilege console with made-up people. Realistic, clean, rate-limited, flaky, conflicts and missing role. Nothing leaves this machine.', group: 'setup', href: '/#/help', terms: ['mock-world', 'netguard', 'simulation-honesty'] },
  { id: 'real', label: 'Real: your own .env', description: 'Real is owner-run. Set the settings in this lab\'s own .env, press Real in the header, plan on a small source first, then apply with the Writes switch on.', group: 'setup', href: '/#/help', terms: ['worker-app'] },
];

export function buildPack({ commit } = {}) {
  const pkg = readJson('package.json');
  const pack = {
    schema: 'demo-content-pack/1',
    id: 'privilege-bulk-users',
    title: 'Privilege Bulk Users LAB',
    version: pkg.version,
    ...(commit ? { source: { repo: 'privilege-bulk-users-LAB', commit } } : {}),
    demo: { id: 'privilege-bulk-users', name: 'Privilege Bulk Users LAB', catalog: CATALOG_PLACEHOLDER, baseUrl: 'http://localhost:7817', doctor: '/api/health', tags: ['privilege', 'bulk-registration', 'pingone-api', 'rate-limiting', 'simulated'] },
    glossary: readJson('content/terms.json').sort(byId),
    sources: [],
    cards: CARDS.map(({ href, ...c }) => ({ ...c, action: { type: 'route', href } })).sort(byId),
    diagrams: [
      { id: 'route-a', label: 'Route A: register every user through the PingOne API', href: '/#/diagram' },
      { id: 'route-b', label: 'Route B: create user records with the Privilege console API', href: '/#/diagram' },
    ],
    stories: [],
  };
  return pack;
}
export const serialize = (p) => `${JSON.stringify(p, null, 2)}\n`;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const commit = process.argv.find((a) => a.startsWith('--commit='))?.slice(9);
  fs.writeFileSync(PACK_PATH, serialize(buildPack({ commit })));
  console.log(`wrote ${PACK_PATH}`);
}
