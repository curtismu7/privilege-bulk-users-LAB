import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { TALK_PATH, buildTalkTrack } from './build-talk-track.mjs';

test('docs/talk-track.md is exactly what the builder produces (run: npm run talk-track)', () => {
  assert.equal(fs.readFileSync(TALK_PATH, 'utf8'), buildTalkTrack(), 'docs/talk-track.md is stale; regenerate it and commit the result');
});
test('the talk track names the mode, presenter mode and Reset, and says what is UNVERIFIED', () => {
  const t = buildTalkTrack();
  for (const w of ['which mode you are in', 'presenter mode', 'Reset', 'UNVERIFIED', 'Caveats to say out loud']) assert.ok(t.includes(w), w);
});
test('the script runs in order: the problem, the Guide, the trap, the Realistic run with the 429 counter, and plan again finds nothing', () => {
  const t = buildTalkTrack();
  const heads = [...t.matchAll(/^## (\d)\. (.+)$/gm)].map((m) => `${m[1]}. ${m[2]}`);
  assert.deepEqual(heads, ['1. Open on the problem', '2. Walk the Guide', '3. The trap: Missing role', '4. Run the Realistic scenario', '5. Plan again finds nothing']);
  for (const w of ['**429 answers (rate limit)**', 'Missing role', 'Realistic', 'destination_empty', 'REGISTER', 'Verify (plan again)']) assert.ok(t.includes(w), w);
  assert.ok(t.indexOf('3. The trap') < t.indexOf('4. Run the Realistic'), 'Missing role comes before the Realistic run: a scenario switch starts a fresh Mock world, so the script can end on a clean verify');
});
test('every section has what to do, what to say and why it matters, and the text carries no old identity or leftover token', () => {
  const t = buildTalkTrack();
  for (const section of t.split(/^## \d\. /m).slice(1)) for (const w of ['**Do:**', '**Say:**', '**Why it matters:**']) assert.ok(section.includes(w), `${section.split('\n')[0]}: ${w}`);
  assert.ok(!/\{\{|⟨missing|undefined|\[object/.test(t));
});
