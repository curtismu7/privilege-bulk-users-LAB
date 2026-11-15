# The first Real run (owner-run)

Nothing in Real was run while this lab was built: every test uses the in-process mock, and everything below is the owner's to do, in this order, with an environment you own. Route A follows a script the owner runs in daily use, but this lab's Real mode has never touched a PingOne environment. Route B has never touched a console. Every claim about what a real service will answer is UNVERIFIED until you have recorded it in the evidence template at the end. Use a **throwaway** setup if you can: the Apply step creates real people and real group memberships, and **this lab never deletes**. Read "How to stop" and "Roll back" before you press anything.

## Before you start

- A PingOne **worker app** (client credentials) with the **Identity Data Admin** role on Privilege's own environment (the role is set on the worker app in PingOne; the Privilege app has no role to set), and the **Privilege group** already created there. Without the role PingOne returns an empty user list, not a 403 (see [references.md](references.md)).
- A **small source**: the lab reads every person in the source environment, with no filter, so the first run needs a source environment that holds a handful of throwaway people (ten or fewer), never your real directory.
- **WARNING: do not set the source to Privilege's own environment on a first run.** If `BULK_P1_SOURCE_ENV_ID` equals `BULK_P1_PRIVILEGE_ENV_ID`, nothing is created, and **every person in the whole environment who is not yet in the Privilege group is added to it by one `REGISTER <n>`**. That is everyone the environment holds: administrators, service and test accounts, disabled or departed people, anyone. The plan's `to apply` count is then the size of the environment minus the group. Try that on a throwaway environment first, and read the `add` count and the first rows before you type the number.
- **Cost of a plan.** Plan reads the whole source (100 people per page), reads Privilege's environment the same way, and makes **one more read per person who already exists in Privilege's environment** (their group membership). A source of ten thousand people is hundreds of page reads plus up to ten thousand membership reads, and **every Plan or Verify repeats all of it** against PingOne's rate limits. This lab does not know those limits (UNVERIFIED): it learns them from the 429s and waits them out, so a big source can take a long time and use a lot of your quota. The source is capped at 50,000 people; a larger one plans only the first 50,000 and says `truncated`.
- **The default population.** People route A creates go into the destination's default population, with no password. Creating users there may trigger notifications (a welcome or verification email) or provisioning rules (UNVERIFIED: this lab has not checked). Look at that population's settings, and at anything that listens for new users, before you apply.
- The lab's own `.env`, beside `docker-compose.yml`: `cp .env.example .env && chmod 600 .env`. Fill in the values yourself; never paste a secret into a chat, an issue or a commit. A host run (`npm start`) and Docker read the same file. **In Docker, compose's `env_file` puts every value of the `.env`, including the worker secret, into the container's environment, where `docker inspect` and `docker exec <container> env` show it in plain text.** Anyone who can talk to your Docker daemon can run those (on a Mac, your own user and any program running as you; on a shared Docker host, every user with Docker access). Use a worker app whose secret you can rotate, and rotate it afterwards (see "How to stop").
- Know how you will stop and undo it: read "How to stop" and "Roll back" first.

## Checks

1. **Set the names.** In `.env` set `PRIVILEGE_BULK_MODE=real` and, for route A, `BULK_P1_REGION`, `BULK_P1_SOURCE_ENV_ID`, `BULK_P1_PRIVILEGE_ENV_ID`, `BULK_P1_WORKER_CLIENT_ID`, `BULK_P1_WORKER_CLIENT_SECRET` and `BULK_P1_GROUP`. `BULK_P1_WORKER_ENV_ID` is optional (the default is the source environment). Leave the route B names empty for now. Check that the source and Privilege's environment are two different environments.
2. **Doctor.** `npm run doctor`. Expected: every line passes, the `mode` line says Real is allowed, and the `settings` line says route a is `ready` (it lists setting names that are missing, never values). Fix what it names before going on. In Docker, start the container and read `routes.a.realReady` from `GET /api/info` instead. A bare `docker run` of the image cannot run Real at all (the image does not carry the container marker); use `docker compose up --build -d`, which publishes on `127.0.0.1` only.
3. **Switch to Real.** Start the lab and open the page. Look at the `Mode:` chip. If it says mock, open the **Mode** control in the header (a select) and choose **Real**. Expected: the chip says real, the banner says REAL and says writes are off. While a guard fails, the **Real** option in that select is disabled, and the Run page and the Help page say why in plain text (no opt-in in the `.env`, or a bind that is not loopback outside the compose file). Fix the named guard and reload; do not look for another way in.
4. **Plan route A on the small source.** Choose route A. Real has no scenario or people controls: it plans from your own environments. Set **Concurrency** (1 to 16, default 6): start low, for example 2. **The same value governs the apply that follows**, so this is your pace for the writes too. Press **Plan (dry run)**. A plan reads and decides and writes nothing, but it is not free (see "Cost of a plan"). Press **Abort** at any time while it runs.
5. **Read the counts.** Compare each with what you expect from the small source: `create and add`, `add to the group`, `in sync`, `conflict`, `invalid`, `to apply`. Open a few rows in the results table. **Stop** if `to apply` is larger than the small source you meant to use, or (the same-environment warning above) if it is close to the size of a whole environment. **Stop** also if you see `destination_empty` (the worker probably lacks Identity Data Admin, or Privilege's environment is really empty: find out which), `group_missing` (no group has that name), `source_unreadable`, `destination_unreadable` or `token_refused`.
6. **Apply, with the Writes switch.** The plan you apply is the latest one: starting another Plan, switching the mode, pressing Reset, using it once or waiting more than 15 minutes ends it, and you plan again. Turn the **Writes** switch on (the banner turns to a red alert), type `REGISTER` and the number the plan says, and press **Apply**. Watch the counts, the 429 counter and the failed count. Press **Abort** if anything looks wrong: the calls in flight finish and everyone else stays pending. Expected: a short run for a small source; any 429 is waited out. Rows can fail (a person PingOne refuses): they are named in the results table and the run goes on. `circuit_open` means the run stopped itself after many early failures: read the first failed rows, they usually share one cause.
7. **Save the report now.** Download the JSON and the CSV (`Report of this job`) before the next step, and check that the file says Real: a Mock report is not your list of who was created. Pressing Verify starts a new job and replaces the results, Reset clears them, and the audit keeps counts only: the report is the only list of who was created. Turn the Writes switch off again.
8. **Verify by planning again.** Press **Verify (plan again)**. Expected: `0 to apply`, apart from any conflicts, invalid rows or people PingOne refused. If something is left that you did not expect, read its row. Verify is a full Plan: it costs what a plan costs.
9. **Verify in the consoles.** In the PingOne admin console, open Privilege's environment, find two or three people from the report and check they exist and are members of the Privilege group. Then check in Privilege that they are known to it. How long a new group member takes to appear in Privilege is UNVERIFIED: wait and look again before you call it a failure. How a person created this way then signs in is UNVERIFIED, and so is whether the per-user "Generate Onboarding Link" step in the PingOne console is still needed (this lab found no API for it).
10. **Route B, optionally and last.** Only after route A, and with a source of one or two people. Set `BULK_CONSOLE_URL`, `BULK_CONSOLE_TENANT`, `BULK_CONSOLE_API_KEY` and `BULK_CONSOLE_API_SECRET` (and `BULK_CONSOLE_INSECURE_TLS=1` only for the local desktop console's self-signed certificate), restart, plan route B, then apply. Everything about it is UNVERIFIED: whether `POST /v1/users` is accepted with this body, which `ObjectMeta` fields the console requires, whether the console's `GET /v1/users` pages, and whether a person created that way can sign in. Record what you see. A host run is the simple way to reach a console on this Mac's loopback; from Docker the container cannot see the host's loopback (reaching it that way is UNVERIFIED). The console key and secret are in the container's environment too, with the same `docker inspect` exposure.
11. **Things to record, all UNVERIFIED until you do:** the rate limits you meet (this lab discovers them from 429s and does not know the numbers), the format of `Retry-After` in your region, whether creating users in the default population triggered a notification or a provisioning rule, and anything PingOne answered differently from the Mock.

## How to stop

In the order of how fast each one stops the writes:

1. **Abort.** The **Abort** button (or `POST /api/jobs/current/abort`) works for a Plan as well as for an Apply. The calls already in flight finish, nobody else is started, and the job ends `aborted`. Everyone not yet processed stays pending; the people already created stay created.
2. **Reset.** The header **Reset** (or `npm run reset`) aborts a running job and waits for its calls in flight to finish, then clears the job, its plan, the audit history, the Mock people and the Writes switch. It is not an undo: nothing already done in PingOne is touched.
3. **Take Real away.** Turn the Writes switch off, remove `PRIVILEGE_BULK_MODE` from the `.env` (or set it to mock), and restart; then stop the lab: `docker compose down`, or stop `npm start`. Without the opt-in Real is refused again.
4. **Remove the values.** Delete the worker secret (and any route B key and secret) from the `.env`. A container that was started with them kept them in its environment until it was removed: `docker compose down` removes it, and `docker inspect` then has nothing to show.
5. **Rotate the worker secret afterwards.** In PingOne, create a new secret for the worker app and revoke the old one. Do this even if nothing went wrong: the secret sat in a plain-text file and, in Docker, in the container's environment. Rotate the route B API key and secret the same way if you used them.

## Roll back

**This lab never deletes.** There is no delete call in it, on purpose. What a Real run changed, you undo yourself.

- **People route A created** (`created` in the report): delete them in the PingOne admin console, or with a script you write against the Management API. The report from check 7 is your list: its usernames and masked addresses identify them. Nothing here provides or tests such a script.
- **People route A only added to the group** (`added`): remove them from the Privilege group by hand. They existed before; do not delete them. In the same-environment case that can be a very long list: use the report.
- **People route B created** (`created`): remove them in the Privilege console. UNVERIFIED how.
- If the report is gone (Reset, a restart), the audit tells you only counts. Compare the Privilege group's members with your source by hand.

## Stop if

- The banner says **REAL mode** and you do not recognise the environments or the console in the plan, or they belong to people who have not agreed to a bulk change.
- The source and Privilege's environment are the same environment and you did not mean it.
- The Writes switch is on and you did not turn it on, or you are not about to press Apply.
- The plan's `to apply` is larger than the small source you meant to use.
- The plan shows `destination_empty`, `group_missing` or `truncated` and you do not understand why.
- An apply stops with `circuit_open` or `token_refused`: stop, read the rows, fix the cause, and plan again. Do not just press Apply again.

## Evidence template

```text
- When: <date>
- Route: <a | b>   Source: <how many people>   Source is Privilege's own environment: <yes | no>   Region: <region suffix>   Concurrency: <n>
- Check 2 (doctor): <pass | what failed>
- Check 4-5 (plan): create+add <n>  add <n>  in-sync <n>  conflict <n>  invalid <n>  to apply <n>  warnings <codes>  calls <n>  429s <n>
- Check 6 (apply): created <n>  added <n>  failed <n>  429s <n>  waited <s>  retries <n>  errors <codes>
- Check 7 (report saved, and it says Real): <yes / where>
- Check 8 (verify): to apply <n> (expected 0 apart from conflicts and invalid)
- Check 9 (consoles): people present <yes/no>  in the Privilege group <yes/no>  known to Privilege after <minutes>
- Default population: notification or provisioning rule triggered <yes/no/unknown>
- How I stopped: <abort | reset | down>   Worker secret rotated: <yes/no>
- Roll back needed: <yes/no, how>
- Route B (if run): list <status>  create <status>  user can sign in <yes/no>
- Anything PingOne or the console answered differently from the Mock: <notes>
```
