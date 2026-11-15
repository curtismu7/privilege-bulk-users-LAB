// Route A: register people through the PingOne Management API (the path our own environment uses; docs/references.md).
//   plan  read the source once, read Privilege's environment once (snapshot), match in memory by email and username, and check group
//         membership only for people who already exist there. Writes nothing.
//   apply for each person to change: create (no password) and add to the Privilege group, or just add. Bounded pool, idempotent.
// Actions (plan): create+add, add, in-sync, conflict, invalid.  Statuses (apply): created, added, in-sync, conflict, invalid, failed.
import { BulkError, describe, isUniqueness } from './errors.js';
import { lower } from './fold.js';
import { toPerson } from './pingone.js';
import { runPool } from './pool.js';

export async function planA({ p1, sourceEnvId, privilegeEnvId, group, concurrency, signal, limits, progress }) {
  const same = sourceEnvId === privilegeEnvId; // the people already live in Privilege's own environment: nothing to create
  progress.phase('reading the source');
  const src = await p1.listUsers(sourceEnvId, { signal, max: limits.maxUsers, onPage: (n) => progress.processed(n) });
  const people = src.items.map(toPerson);
  progress.total(people.length);
  const warnings = [];
  if (src.truncated) warnings.push({ code: 'truncated', blocking: true, message: `The source has more than ${limits.maxUsers} people. Only the first ${limits.maxUsers} are planned; run the rest in another pass.` });

  progress.phase('looking up the group');
  const grp = await p1.findGroup(privilegeEnvId, group);
  if (!grp) throw new BulkError('group_missing', `There is no group named "${group}" in the Privilege environment. Create it there (or fix BULK_P1_GROUP) and plan again; nothing was written.`);
  const pop = same ? null : await p1.defaultPopulation(privilegeEnvId);

  progress.phase('snapshotting the destination');
  const dstPeople = same ? people : (await p1.listUsers(privilegeEnvId, { code: 'destination_unreadable', signal })).items.map(toPerson);
  if (!same && dstPeople.length === 0) {
    warnings.push({ code: 'destination_empty', blocking: true, message: 'The Privilege environment answered with no users at all. In PingOne that usually means the worker app lacks the Identity Data Admin role there (it returns an empty list, not a 403), not that the environment is empty. Applying now would try to create people who already exist.' });
  }
  const byEmail = new Map(); const byUsername = new Map();
  for (const u of dstPeople) { if (u.email) byEmail.set(lower(u.email), u); if (u.username) byUsername.set(lower(u.username), u); }

  progress.phase('deciding');
  const decisions = people.map((person, i) => ({ n: i + 1, person, action: null, target: null, detail: '' }));
  const toCheck = [];
  const seenSrc = new Set();
  const dupe = (p) => { const k = [`e:${lower(p.email)}`, `u:${lower(p.username)}`]; const hit = k.some((x) => seenSrc.has(x)); k.forEach((x) => seenSrc.add(x)); return hit; };
  for (const d of decisions) {
    const p = d.person;
    if (!p.email) { d.action = 'invalid'; d.detail = 'no email address on the source user'; continue; }
    if (!p.username) { d.action = 'invalid'; d.detail = 'no username on the source user'; continue; }
    if (dupe(p)) { d.action = 'conflict'; d.detail = 'this email or username appears more than once in the source (or a page overlapped); only the first is planned, a person has to decide about the rest'; continue; }
    let target = same ? p : byEmail.get(lower(p.email));
    if (!target) {
      const holder = byUsername.get(lower(p.username));
      if (holder && !holder.email) target = holder; // a same-username record with no email is the same account
      else if (holder) { d.action = 'conflict'; d.detail = 'that username already belongs to someone else in the Privilege environment (usernames are case-insensitive); a person has to decide'; continue; }
    }
    if (!target) { d.action = 'create+add'; d.detail = 'not in the Privilege environment yet'; continue; }
    d.target = target.id; toCheck.push(d);
  }
  // Membership is a per-user call (there is no bulk one that we know of), so only the people who exist already cost one.
  let done = decisions.length - toCheck.length;
  progress.processed(done);
  await runPool(toCheck, concurrency, async (d) => {
    try {
      const ids = await p1.groupIdsOf(privilegeEnvId, d.target, { signal });
      d.action = ids.includes(grp.id) ? 'in-sync' : 'add';
      d.detail = d.action === 'in-sync' ? 'already in the group' : 'exists, not in the group yet';
    } catch (err) {
      if (err.code === 'aborted') throw err;
      d.action = 'add'; d.detail = `could not check membership (${err.httpStatus ? `HTTP ${err.httpStatus}` : 'no answer'}); will try to add`;
    }
    progress.processed(++done);
  }, { signal });

  const counts = { 'create+add': 0, add: 0, 'in-sync': 0, conflict: 0, invalid: 0 };
  for (const d of decisions) counts[d.action]++;
  counts.toApply = counts['create+add'] + counts.add;
  return { decisions, counts, warnings, meta: { groupId: grp.id, populationId: pop?.id ?? null } };
}

const hint = (r) => (r.status === 401 || r.status === 403 ? ' (the worker app may lack the Identity Data Admin role on the Privilege environment)' : '');

export async function applyA({ p1, gate, privilegeEnvId, plan, concurrency, signal, onResult, secrets }) {
  const { groupId, populationId } = plan.meta;
  const todo = plan.decisions.filter((d) => d.action === 'create+add' || d.action === 'add');

  async function addToGroup(userId) {
    let r; let tries = 0;
    for (let k = 0; k < 4; k++) {
      r = await p1.addToGroup(privilegeEnvId, userId, groupId); tries += r.tries;
      if (r.status !== 404) break; // a user created a moment ago can 404 here until PingOne catches up: wait and try again
      await gate.backoff(1000);
    }
    return { r, tries, ok: [200, 201, 204, 409].includes(r.status) }; // 409: already a member
  }

  await runPool(todo, concurrency, async (d) => {
    let attempts = 0; let userId = d.target;
    if (d.action === 'create+add') {
      const c = await p1.createUser(privilegeEnvId, d.person, populationId); attempts += c.tries;
      if ([200, 201].includes(c.status) && typeof c.json?.id === 'string') userId = c.json.id;
      else if (isUniqueness(c) && c.tries > 1) {
        // The create was sent more than once: our own first try may have gone through and only its ANSWER was lost, so "already exists" can
        // be us. Look the person up; the same email AND username is ours, and the group add must still happen.
        const mine = await p1.findUserByEmail(privilegeEnvId, d.person.email); attempts += 1;
        if (mine && lower(mine.username) === lower(d.person.username)) userId = mine.id;
        else return onResult(d, { status: 'conflict', detail: 'someone else created this username or email in the Privilege environment since the plan; plan again', httpStatus: c.status, attempts, unexpected: true });
      } else if (isUniqueness(c)) return onResult(d, { status: 'conflict', detail: 'someone created this username or email in the Privilege environment since the plan; plan again', httpStatus: c.status, attempts, unexpected: true });
      else return onResult(d, { status: 'failed', detail: `create failed: ${describe(c, secrets)}${hint(c)}`, httpStatus: c.status || null, attempts, unexpected: true });
    }
    const a = await addToGroup(userId); attempts += a.tries;
    if (a.ok) return onResult(d, { status: d.action === 'create+add' ? 'created' : 'added', detail: d.action === 'create+add' ? 'created and added to the group' : 'added to the group', httpStatus: a.r.status, attempts });
    return onResult(d, { status: 'failed', detail: `${d.action === 'create+add' ? 'created, but ' : ''}the group add failed: ${describe(a.r, secrets)}${hint(a.r)}${d.action === 'create+add' ? '; plan and apply again to finish' : ''}`, httpStatus: a.r.status || null, attempts, unexpected: true });
  }, { signal });
}
