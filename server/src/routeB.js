// Route B: create user records with the Privilege console API (POST /api/{tenant}/v1/users). UNVERIFIED against a real console
// (docs/references.md): the people still come from the PingOne source environment; only the write differs.
// Actions (plan): create, exists, conflict, invalid.  Statuses (apply): created, exists, conflict, invalid, failed.
import { describe } from './errors.js';
import { lower } from './fold.js';
import { toPerson } from './pingone.js';
import { runPool } from './pool.js';

export async function planB({ p1, con, sourceEnvId, signal, limits, progress }) {
  progress.phase('reading the source');
  const src = await p1.listUsers(sourceEnvId, { signal, max: limits.maxUsers, onPage: (n) => progress.processed(n) });
  const people = src.items.map(toPerson);
  progress.total(people.length);
  const warnings = [];
  if (src.truncated) warnings.push({ code: 'truncated', blocking: true, message: `The source has more than ${limits.maxUsers} people. Only the first ${limits.maxUsers} are planned; run the rest in another pass.` });

  progress.phase('listing the console users');
  const existing = await con.listUsers();
  const byEmail = new Map(); const byUsername = new Map();
  for (const c of existing) {
    const username = String(c?.Spec?.UserName ?? c?.ObjectMeta?.Name ?? ''); const email = String(c?.Spec?.EmailID ?? '');
    if (email) byEmail.set(lower(email), { username, email });
    if (username) byUsername.set(lower(username), { username, email });
  }

  progress.phase('deciding');
  const decisions = people.map((person, i) => ({ n: i + 1, person, action: null, detail: '' }));
  const seenSrc = new Set();
  const dupe = (p) => { const k = [`e:${lower(p.email)}`, `u:${lower(p.username)}`]; const hit = k.some((x) => seenSrc.has(x)); k.forEach((x) => seenSrc.add(x)); return hit; };
  for (const d of decisions) {
    const p = d.person;
    if (!p.email || !p.username) { d.action = 'invalid'; d.detail = !p.email ? 'no email address on the source user' : 'no username on the source user'; }
    else if (dupe(p)) { d.action = 'conflict'; d.detail = 'this email or username appears more than once in the source (or a page overlapped); only the first is planned, a person has to decide about the rest'; }
    else if (byEmail.has(lower(p.email))) { d.action = 'exists'; d.detail = 'the console already has a user with this email'; }
    else if (byUsername.has(lower(p.username))) { d.action = 'conflict'; d.detail = 'that username already belongs to someone else in the console; a person has to decide'; }
    else { d.action = 'create'; d.detail = 'not in the console yet'; }
  }
  progress.processed(decisions.length);
  const counts = { create: 0, exists: 0, conflict: 0, invalid: 0 };
  for (const d of decisions) counts[d.action]++;
  counts.toApply = counts.create;
  return { decisions, counts, warnings, meta: {} };
}

export async function applyB({ con, plan, concurrency, signal, onResult, secrets }) {
  const todo = plan.decisions.filter((d) => d.action === 'create');
  await runPool(todo, concurrency, async (d) => {
    const r = await con.createUser(d.person); // a 401/403 throws login_required and stops the job
    if ([200, 201].includes(r.status)) return onResult(d, { status: 'created', detail: 'user record created in the console', httpStatus: r.status, attempts: r.tries });
    if (r.status === 409) return onResult(d, { status: 'exists', detail: 'the console says it already exists', httpStatus: 409, attempts: r.tries });
    return onResult(d, { status: 'failed', detail: `create failed: ${describe(r, secrets)}`, httpStatus: r.status || null, attempts: r.tries, unexpected: true });
  }, { signal });
}
