import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { DEFAULT_PORT } from '../server/src/config.js';
import { CATALOG_PLACEHOLDER } from './build-content-pack.mjs';
import { shelfProblems } from './lib/shelf-registry-rules.mjs';

const read = (f) => fs.readFileSync(new URL(f, import.meta.url), 'utf8');
const entry = JSON.parse(read('../docs/shelf-entry.json'));

test('docs/shelf-entry.json passes the shelf registry rules (copied into scripts/lib/shelf-registry-rules.mjs)', () => {
  assert.deepEqual(shelfProblems(entry.demos), []);
});

test('the entry matches this app: id, port 7817, /api/health, a relative compose file, kind Tester', () => {
  assert.equal(entry.demos.length, 1);
  const [d] = entry.demos;
  assert.equal(d.id, 'privilege-bulk-users');
  assert.equal(d.name, 'Privilege Bulk Users LAB');
  assert.equal(d.kind, 'Tester');
  assert.equal(d.composeFile, 'privilege-bulk-users-LAB/docker-compose.yml');
  assert.ok(!path.isAbsolute(d.composeFile), 'composeFile must be relative or a placeholder');
  assert.ok(!/\/Users\//.test(JSON.stringify(entry)), 'no absolute home path');
  assert.equal(DEFAULT_PORT, 7817);
  assert.equal(d.url, 'http://localhost:7817');
  assert.equal(d.healthPath, '/api/health');
  assert.ok(d.description.length <= 300 && d.description.length > 50, `description is ${d.description.length} characters`);
  const pkg = JSON.parse(read('../package.json'));
  assert.ok(pkg.scripts.start && pkg.scripts.doctor);
  assert.match(read('../docker-compose.yml'), /127\.0\.0\.1:\$\{HOST_PORT:-7817\}:7817/);
  assert.match(d.notes, /PRIVILEGE_BULK_MODE/);
});

test('no catalog id is assigned yet: the shelf entry has none, the content pack carries the D000 placeholder the schema requires, and the README says so', () => {
  assert.equal(entry.demos[0].catalogId, undefined, 'the owner assigns one with the board row; do not invent it');
  assert.equal(CATALOG_PLACEHOLDER, 'D000');
  assert.equal(JSON.parse(read('../content-pack.json')).demo.catalog, 'D000');
  assert.match(read('../README.md'), /^Catalog: none yet \(owner assigns with the board row\)$/m);
  assert.match(entry.demos[0].notes, /No catalog id yet/);
});

test('the copied rules reject a bad entry', () => {
  const bad = [{ ...entry.demos[0], url: 'http://evil.example:7817', healthPath: '//x', composeFile: '../x;y.yml', surprise: 1 }];
  assert.ok(shelfProblems(bad).length >= 4);
});
