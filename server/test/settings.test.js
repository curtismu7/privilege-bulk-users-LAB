// The lab's own .env: only the listed names are taken, readiness reports names and never values, and bad values name the SETTING.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { SETTING_KEYS, REGIONS, applySettings, readSettings, realConfig, routeReadiness } from '../src/settings.js';
import { tmpDir } from './helpers.js';

const UUID1 = '11111111-2222-4333-8444-555555555555'; const UUID2 = '11111111-2222-4333-8444-555555555556';
const good = {
  BULK_P1_REGION: 'com', BULK_P1_SOURCE_ENV_ID: UUID1, BULK_P1_PRIVILEGE_ENV_ID: UUID2, BULK_P1_WORKER_CLIENT_ID: 'cid', BULK_P1_WORKER_CLIENT_SECRET: 'sentinel-secret-1', BULK_P1_GROUP: 'Privilege Users',
  BULK_CONSOLE_URL: 'https://console.example', BULK_CONSOLE_TENANT: UUID1, BULK_CONSOLE_API_KEY: 'key-1', BULK_CONSOLE_API_SECRET: 'sentinel-secret-2',
};

test('only the listed names are read from the .env; nothing else enters the environment; no file means defaults; the environment wins', () => {
  const dir = tmpDir(); const file = path.join(dir, '.env');
  fs.writeFileSync(file, 'BULK_P1_REGION=eu\nPRIVILEGE_BULK_MODE=real\nSOMETHING_ELSE=1\nAWS_SECRET_ACCESS_KEY=nope\nBULK_P1_GROUP=\n', { mode: 0o600 });
  assert.deepEqual(readSettings(file), { BULK_P1_REGION: 'eu', PRIVILEGE_BULK_MODE: 'real' });
  const env = { BULK_P1_REGION: 'asia' };
  applySettings(env, file);
  assert.deepEqual(env, { BULK_P1_REGION: 'asia', PRIVILEGE_BULK_MODE: 'real' });
  assert.deepEqual(readSettings(path.join(dir, 'missing')), {});
  assert.ok(SETTING_KEYS.every((k) => /^(PRIVILEGE_BULK_MODE|BULK_)/.test(k)));
});

test('readiness lists setting NAMES only, never a value', () => {
  const none = routeReadiness({});
  assert.equal(none.a.realReady, false); assert.ok(none.a.missing.includes('BULK_P1_GROUP') && none.b.missing.includes('BULK_CONSOLE_URL'));
  assert.deepEqual(routeReadiness(good), { a: { realReady: true, missing: [] }, b: { realReady: true, missing: [] } });
  assert.ok(!JSON.stringify(routeReadiness({ ...good, BULK_P1_REGION: '' })).includes('sentinel'));
  assert.deepEqual(routeReadiness({ ...good, BULK_P1_REGION: '  ' }).a.missing, ['BULK_P1_REGION']);
});

test('realConfig: a valid route comes back whole, with its secrets listed for scrubbing', () => {
  const a = realConfig(good, 'a');
  assert.equal(a.region, 'com'); assert.equal(a.workerEnvId, UUID1, 'the worker env defaults to the source'); assert.equal(a.group, 'Privilege Users');
  assert.deepEqual(a.secrets, ['sentinel-secret-1']);
  const b = realConfig({ ...good, BULK_P1_WORKER_ENV_ID: UUID2, BULK_CONSOLE_INSECURE_TLS: '1' }, 'b');
  assert.equal(b.consoleUrl, 'https://console.example'); assert.equal(b.insecureTls, true); assert.equal(b.workerEnvId, UUID2);
  assert.ok(b.secrets.includes('sentinel-secret-2'));
  assert.deepEqual(REGIONS, ['com', 'eu', 'asia', 'ca', 'com.au', 'sg']);
});

test('realConfig: bad values are refused, and the message names the setting without echoing the value', () => {
  const cases = [
    [{ BULK_P1_REGION: 'evil.example' }, 'a', /BULK_P1_REGION/, 'evil.example'],
    [{ BULK_P1_SOURCE_ENV_ID: 'not-a-uuid-xyz' }, 'a', /BULK_P1_SOURCE_ENV_ID/, 'not-a-uuid-xyz'],
    [{ BULK_P1_PRIVILEGE_ENV_ID: 'nope-nope' }, 'a', /BULK_P1_PRIVILEGE_ENV_ID/, 'nope-nope'],
    [{ BULK_P1_WORKER_ENV_ID: 'worker-nope' }, 'a', /BULK_P1_WORKER_ENV_ID/, 'worker-nope'],
    [{ BULK_P1_GROUP: 'a" or name pr or "b' }, 'a', /BULK_P1_GROUP/, 'name pr'],
    [{ BULK_CONSOLE_URL: 'http://console.example' }, 'b', /https/, 'console.example'],
    [{ BULK_CONSOLE_URL: 'https://10.1.2.3' }, 'b', /private/, '10.1.2.3'],
    [{ BULK_CONSOLE_URL: 'https://user:pw@console.example' }, 'b', /credentials/, 'user:pw'],
    [{ BULK_CONSOLE_URL: 'https://console.example/api' }, 'b', /origin only/, '/api'],
    [{ BULK_CONSOLE_TENANT: 'tenant-1' }, 'b', /BULK_CONSOLE_TENANT/, 'tenant-1'],
  ];
  for (const [over, route, re, leak] of cases) {
    assert.throws(() => realConfig({ ...good, ...over }, route), (e) => e.code === 'needs_setup' && re.test(e.message) && !e.message.includes(leak), JSON.stringify(over));
  }
  assert.throws(() => realConfig({}, 'a'), (e) => e.code === 'needs_setup' && /BULK_P1_REGION/.test(e.message));
  // loopback http is allowed for the desktop console; a private literal is not
  assert.equal(realConfig({ ...good, BULK_CONSOLE_URL: 'http://127.0.0.1:8643' }, 'b').consoleUrl, 'http://127.0.0.1:8643');
});

test('environment ids are lower-cased, so the same environment compares equal however it was typed', () => {
  const lower = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const a = realConfig({ ...good, BULK_P1_SOURCE_ENV_ID: lower, BULK_P1_PRIVILEGE_ENV_ID: lower.toUpperCase(), BULK_P1_WORKER_ENV_ID: lower.toUpperCase() }, 'a');
  assert.equal(a.privilegeEnvId, lower); assert.equal(a.workerEnvId, lower);
  assert.equal(a.privilegeEnvId, a.sourceEnvId, 'the same environment typed in capitals equals the source (the same-environment branch)');
});
