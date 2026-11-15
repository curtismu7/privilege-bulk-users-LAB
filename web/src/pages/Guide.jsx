import React from "react";
import Chip from "../components/Chip.jsx";
import CodeBlock from "../components/CodeBlock.jsx";
import JsonPane from "../components/JsonPane.jsx";

// The page that teaches. Every product claim here comes from docs/references.md; what is not in it says UNVERIFIED. Requests use
// $PLACEHOLDER variables only, never a real id. JSON excerpts are shortened examples and go through the shared JsonPane (rule 24).

// docs/references.md, "UNVERIFIED" section. Backticks mark code. A test compares this list with that file.
export const UNVERIFIED = [
  "That `POST /v1/users` on the console, with the fields above, is accepted as-is, which `ObjectMeta` fields it requires, and whether a user created that way can sign in. Route B is documented and mock-tested only.",
  "Whether the console's `GET /v1/users` pages. The swagger shows no paging parameters.",
  "How long a new group member takes to appear in Privilege.",
  "That PingOne has no bulk membership call. This lab found none and goes per user.",
  "The \"Generate Onboarding Link\" step in the PingOne console (per user) has no API we could find. It may not be needed once the user is a group member; that is not tested here.",
  "Rate limits: this lab discovers them from 429s and does not know the numbers.",
  "Region list and `Retry-After` format against our own environment: from PingOne's published behaviour, not exercised by this lab's Real mode yet.",
  "Taking the user and the groups from token claims (the owner places it in Privilege's OBO, on-behalf-of, setup): which claim names it uses for the user and for the groups, where each is set, and whether a person who is only in a token ever shows in Privilege's user list. The console swagger's OBO settings (2026-11-02) cover the token exchange only (client, audience, scope, subject token type), with no field for choosing a claim, and this lab has not run it.",
];

export const PLACEHOLDERS = [
  ["REGION", "your PingOne region suffix, for example com"],
  ["WORKER_ENV", "the environment that holds the worker app (the token comes from there)"],
  ["CLIENT_ID", "the worker app's client id"],
  ["CLIENT_SECRET", "the worker app's client secret: keep it in a secret store, never in a command you keep"],
  ["SRC_ENV", "the source environment's id: where the people are"],
  ["DST_ENV", "Privilege's own PingOne environment's id"],
  ["TOKEN", "the access token from step 1"],
  ["GROUP_ID", "the Privilege group's id (step 2)"],
  ["POP_ID", "the default population's id in Privilege's environment (step 2)"],
  ["USER_ID", "one created person's id (step 5)"],
  ["CONSOLE_URL", "Route B: the Privilege console's origin"],
  ["TENANT", "Route B: the console tenant id, the part of the path after /api/"],
  ["API_KEY", "Route B: the console user API key"],
  ["API_SECRET", "Route B: the console user API secret"],
  ["SESSION_ID", "Route B: any fresh value for x-procyon-session-id"],
];

// Renders `code` spans inside a sentence.
const withCode = (text) => text.split("`").map((part, i) => (i % 2 ? <code key={i}>{part}</code> : <React.Fragment key={i}>{part}</React.Fragment>));

const API = "https://api.pingone.$REGION/v1/environments";
const CURL = {
  token: String.raw`curl -s -X POST "https://auth.pingone.$REGION/$WORKER_ENV/as/token" \
  -u "$CLIENT_ID:$CLIENT_SECRET" \
  -d grant_type=client_credentials`,
  find: String.raw`# the Privilege group, by name
curl -s -G -H "Authorization: Bearer $TOKEN" \
  "${API}/$DST_ENV/groups" \
  --data-urlencode 'filter=name eq "Your group name"'

# the populations: pick the one marked default
curl -s -H "Authorization: Bearer $TOKEN" \
  "${API}/$DST_ENV/populations"`,
  read: String.raw`curl -s -H "Authorization: Bearer $TOKEN" \
  "${API}/$SRC_ENV/users?limit=100"
# then GET the _links.next.href it returns, until there is none`,
  snapshot: String.raw`curl -s -H "Authorization: Bearer $TOKEN" \
  "${API}/$DST_ENV/users?limit=100"
# same paging; keep every person in memory, keyed by lower-case email and username`,
  create: String.raw`curl -s -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  "${API}/$DST_ENV/users" \
  --data-binary @- <<EOF
{
  "username": "ada.example",
  "email": "ada@people.example",
  "name": { "given": "Ada", "family": "Example" },
  "population": { "id": "$POP_ID" }
}
EOF`,
  member: String.raw`curl -s -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  "${API}/$DST_ENV/users/$USER_ID/memberOfGroups" \
  -d "{\"id\": \"$GROUP_ID\"}"`,
  verify: String.raw`curl -s -H "Authorization: Bearer $TOKEN" \
  "${API}/$DST_ENV/users/$USER_ID/memberOfGroups?limit=100"`,
  routeB: String.raw`curl -s -X POST "$CONSOLE_URL/api/$TENANT/v1/users" \
  -H "x-api-key: $API_KEY" \
  -H "x-api-secret: $API_SECRET" \
  -H "x-procyon-session-id: $SESSION_ID" \
  -H "content-type: application/json" \
  --data-binary @user.json`,
};

// Shortened example answers. Values are made up (.example addresses, <PLACEHOLDER> ids); the shapes are the ones the calls above return.
const SHOW = {
  token: { access_token: "<access token>", token_type: "Bearer", expires_in: 3600 },
  group: { _embedded: { groups: [{ id: "<GROUP_ID>", name: "Your group name" }] } },
  pops: { _embedded: { populations: [{ id: "<POP_ID>", name: "Your default population", default: true }] } },
  users: { _embedded: { users: [{ id: "<USER_ID>", username: "ada.example", email: "ada@people.example", name: { given: "Ada", family: "Example" } }] }, _links: { next: { href: "https://api.pingone.REGION/v1/environments/SRC_ENV/users?limit=100&cursor=..." } } },
  snapshot: { _embedded: { users: [{ id: "<USER_ID>", username: "ada.example", email: "ada@people.example" }] } },
  created: { id: "<USER_ID>", username: "ada.example", email: "ada@people.example", population: { id: "<POP_ID>" } },
  memberBody: { id: "<GROUP_ID>" },
  memberships: { _embedded: { groupMemberships: [{ id: "<GROUP_ID>" }] } },
  counts: { "create+add": 0, add: 0, "in-sync": 97, conflict: 2, invalid: 1, toApply: 0 },
  routeB: { ObjectMeta: {}, Spec: { UserName: "ada.example", EmailID: "ada@people.example", FirstName: "Ada", LastName: "Example", FullName: "Ada Example", Active: true } },
};

const Json = ({ id, value, label }) => <div className="json-pane"><JsonPane value={value} label={label} testId={`json-${id}`} /></div>;

function Section({ id, kicker, title, children }) {
  return (
    <section className="guide-section" aria-labelledby={`g-${id}`} data-testid={`section-${id}`}>
      <p className="section-label">{kicker}</p>
      <h2 id={`g-${id}`}>{title}</h2>
      {children}
    </section>
  );
}

function Step({ n, title, children }) {
  return (
    <li className="step" data-testid={`step-${n}`}>
      <span className="step__n" aria-hidden="true">{n}</span>
      <div className="step__body">
        <h3>Step {n}: {title}</h3>
        {children}
      </div>
    </li>
  );
}

const Io = ({ children }) => <div className="step__io">{children}</div>;

const SCALE = [
  ["Bounded concurrency", "A fixed pool of workers (1 to 16 here), never one request per person all at once.", "Concurrency box; the Calls per second figure.", "this lab's design"],
  ["Back off on 429", "When PingOne answers 429, wait for Retry-After (seconds or a date, capped) and try again.", "429 answers and Waited (back-off).", "from our own script"],
  ["Retry the 404 right after create", "A person created a moment ago can answer 404 on the group add until PingOne catches up: wait and retry.", "Retries, and Tries on each row.", "from our own script"],
  ["Idempotent: a re-run is safe", "People who are already right are left alone, so running it twice changes nothing the second time.", "in sync count; to apply falls to 0 on Verify.", "this lab's design"],
  ["Dry run first", "Plan reads and decides and writes nothing. Apply needs the count typed back.", "The to apply count; the REGISTER N box.", "this lab's design"],
  ["One bad person never stops the run", "A failure is recorded against that person and the pool carries on.", "failed and invalid counts; the row's status.", "this lab's design"],
  ["Stop on purpose", "When many fail early in an Apply, the run stops itself (a circuit breaker) instead of grinding on.", "The circuit_open error and the failed count.", "this lab's design"],
  ["Keep a report", "Every person has a row: status, HTTP status, tries. Download it as JSON or CSV.", "The results table and the report links.", "this lab's design"],
  ["Conflicts are a human decision", "A person whose username belongs to someone else is never added automatically.", "The conflict count and its rows.", "from our own script"],
];

export default function Guide() {
  return (
    <div data-testid="guide-page">
      <h1>Register users for Privilege with APIs</h1>
      <p className="lede">No large company registers people one console click at a time. This page shows how to register many people for PingOne Privilege with API calls, step by step, and then lets you run the whole thing against a simulation. The commands use <code>$PLACEHOLDER</code> variables: fill them from your own environment, never paste real ids into a page like this one.</p>

      <Section id="why" kicker="1 · Why not by hand" title="One click per person does not scale">
        <p>Adding people one at a time in the console is fine for ten. At a few thousand nobody can say afterwards who was done and who was skipped, and a second run is a second round of the same clicks. A large company needs four things.</p>
        <div className="card-grid">
          <div className="card"><h3>Repeatable</h3><p>The same input gives the same outcome. Run it on Monday and again on Friday.</p></div>
          <div className="card"><h3>Idempotent</h3><p>Running it twice is safe. People who are already registered are left alone.</p></div>
          <div className="card"><h3>Reportable</h3><p>Every person ends with a status you can hand to an auditor or put on a ticket.</p></div>
          <div className="card"><h3>Rate-limit aware</h3><p>The service will say slow down. A bulk job listens, waits and carries on.</p></div>
        </div>
      </Section>

      <Section id="model" kicker="2 · How Privilege knows a user" title="Its own PingOne environment, and one group">
        <dl className="kv">
          <dt>Privilege's environment</dt><dd>Privilege only knows the users of its own PingOne environment who are members of the Privilege group.</dd>
          <dt>The Privilege group</dt><dd>Being in the environment is not enough: only members of the group count.</dd>
          <dt>People who live elsewhere</dt><dd>A person in another environment is created in Privilege's environment first (same email, username and name; the default population; no password), then added to the group.</dd>
          <dt>Who writes</dt><dd>Privilege only reads people from PingOne, so route A writes to PingOne, never to Privilege. The Privilege app has no role to set for this.</dd>
          <dt>Or from token claims</dt><dd>Privilege can take the user and the groups from claims in a token instead of from PingOne, and it can use any claim, for example the claims in a PingFederate token. This is part of Privilege's OBO (on-behalf-of) setup.</dd>
        </dl>
        <p className="notice" data-state="ok" data-testid="claims-notice"><strong>Check this first:</strong> if your people already arrive in a token that carries the user and the groups Privilege needs, there may be nobody to register. The rest of this page is for the case where Privilege reads its people from PingOne.</p>
        <p className="source">Source: a sync script we run ourselves, in daily use, and our SE setup guide for Privilege. The token-claims option, and its place in OBO, is the owner's statement of 2026-11-15; how it is set up is UNVERIFIED (see the end of this page).</p>
      </Section>

      <Section id="routes" kicker="3 · Two routes" title="Which API do you call?">
        <div className="scroll">
          <table className="stack-table" data-testid="routes-table">
            <thead><tr><th scope="col">Route</th><th scope="col">What it calls</th><th scope="col">Evidence</th><th scope="col">Use it when</th></tr></thead>
            <tbody>
              <tr>
                <th scope="row">A: PingOne API</th>
                <td data-label="What it calls">The PingOne Management API: create the person in Privilege's environment, add them to the Privilege group.</td>
                <td data-label="Evidence"><Chip tone="ok">From our own working script</Chip></td>
                <td data-label="Use it when">You want people to exist in PingOne and be in the Privilege group. This is the route we have run.</td>
              </tr>
              <tr>
                <th scope="row">B: Privilege console API</th>
                <td data-label="What it calls"><code>POST /api/{"{tenant}"}/v1/users</code> on the Privilege console.</td>
                <td data-label="Evidence"><Chip tone="warn">UNVERIFIED against a real console</Chip></td>
                <td data-label="Use it when">Only to try it. It is the one route that writes into Privilege itself, which otherwise only reads people from PingOne. It is documented in the console's swagger and tested here against a mock, never against a real console, so it may not work.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Section>

      <Section id="route-a" kicker="4 · Route A, step by step" title="Register people through the PingOne API">
        <p>Step 0 is the setup; steps 1 to 7 are the calls, from a token to proof. Each shows the request as a curl command and a shortened example of the answer. Copy a command, fill the variables, run it.</p>
        <details className="placeholders" data-testid="placeholders">
          <summary>Placeholders used on this page</summary>
          <dl className="kv">{PLACEHOLDERS.map(([name, what]) => <React.Fragment key={name}><dt><code>${name}</code></dt><dd>{what}</dd></React.Fragment>)}</dl>
        </details>
        <ol className="steps" start={0}>
          <Step n={0} title="Prerequisites">
            <p>You need a worker application in PingOne (client credentials). The role is set on that worker app in PingOne, not on the Privilege app: give it the Identity Data Admin role on Privilege's environment. The Privilege group must already exist there.</p>
            <p className="notice" data-state="warn"><strong>The trap:</strong> without that role PingOne answers with empty user lists, not a 403. An empty list can mean no people or no permission. Treat an empty destination as a warning, never as good news. This lab does: it raises <code>destination_empty</code> and makes you acknowledge it before it applies anything.</p>
          </Step>
          <Step n={1} title="Get a token">
            <p>Ask the token endpoint for an access token with the client credentials grant, using the worker's id and secret as HTTP Basic.</p>
            <Io><CodeBlock code={CURL.token} /><Json id="token" value={SHOW.token} label="Response excerpt" /></Io>
          </Step>
          <Step n={2} title="Find the group and the default population">
            <p>Look up the Privilege group by name and read the destination's populations: you need the group's id and the default population's id.</p>
            <Io><CodeBlock code={CURL.find} /><div className="stack"><Json id="group" value={SHOW.group} label="Groups response excerpt" /><Json id="pops" value={SHOW.pops} label="Populations response excerpt" /></div></Io>
            <p className="hint">No group with that name means nothing can be added: stop there. This lab ends the job with <code>group_missing</code>.</p>
          </Step>
          <Step n={3} title="Read the source people">
            <p>List the source environment's users 100 to a page and follow <code>_links.next</code> until it is gone; PingOne caps a page at 100.</p>
            <Io><CodeBlock code={CURL.read} /><Json id="users" value={SHOW.users} label="Response excerpt" /></Io>
          </Step>
          <Step n={4} title="Snapshot the destination once and match">
            <p>Read the destination's users the same way, once, and keep them in memory, so matching a person by email and username costs no call. The snapshot does not tell you who is already in the group: every person who already exists in Privilege's environment costs one <code>memberOfGroups</code> read (the call in step 7) to see whether they are in it.</p>
            <Io><CodeBlock code={CURL.snapshot} /><Json id="snapshot" value={SHOW.snapshot} label="Response excerpt" /></Io>
            <div className="scroll">
              <table data-testid="match-table">
                <thead><tr><th scope="col">In the destination</th><th scope="col">Decision</th></tr></thead>
                <tbody>
                  <tr><td>The same email</td><td>The same person: do not create; add to the group if they are not in it yet.</td></tr>
                  <tr><td>The same username and no email on that record</td><td>The same account (a hand-made one): use it.</td></tr>
                  <tr><td>The same username and a different email</td><td>Conflict. PingOne usernames are case-insensitive, so this can be someone else: do not add them, report it, and let a person decide.</td></tr>
                  <tr><td>Nothing</td><td>Create them, then add them.</td></tr>
                </tbody>
              </table>
            </div>
            <p className="hint">A source record that cannot be turned into a valid request is counted <code>invalid</code> and never sent.</p>
          </Step>
          <Step n={5} title="Create what is missing, with no password">
            <p>Create each missing person in Privilege's environment with the same email, username and name and the default population, and send no password.</p>
            <Io><CodeBlock code={CURL.create} /><Json id="created" value={SHOW.created} label="Response excerpt" /></Io>
            <p className="hint">How a person created this way then signs in is not tested here: see What we have not verified.</p>
          </Step>
          <Step n={6} title="Add them to the group, per person">
            <p>Add each person with the user-centric call, <code>POST .../users/$USER_ID/memberOfGroups</code>; this lab only reads the status code of the answer.</p>
            <Io><CodeBlock code={CURL.member} /><Json id="member" value={SHOW.memberBody} label="Request body" /></Io>
            <p className="hint">Why not the group-centric <code>/groups/{"{id}"}/members</code>: PingOne refused it for the worker app (a 403 with a misleading JWT-parse error). And a person created a moment ago can answer 404 here until PingOne catches up: retry after a short wait. This lab also treats a 409 on the add as success (the person is already in the group); that is its own design.</p>
          </Step>
          <Step n={7} title="Verify by planning again">
            <p>Repeat steps 3 and 4 and decide again: everyone created and added is now in sync and nothing is left to apply. Spot-check one person's memberships to see the group.</p>
            <Io><CodeBlock code={CURL.verify} /><div className="stack"><Json id="memberships" value={SHOW.memberships} label="Memberships response excerpt" /><Json id="counts" value={SHOW.counts} label="This lab's counts after a clean verify" /></div></Io>
          </Step>
        </ol>
        <p className="source">Source: steps 0 to 6 follow a sync script we run ourselves, in daily use, and a second script for the group call. The snapshot design, the choice of 100 a page and treating a 409 on the group add as success are this lab's own design.</p>
      </Section>

      <Section id="scale" kicker="5 · Doing it at scale" title="What a bulk run needs, and where you see it">
        <p>None of this is exotic. The Run page shows each practice as a number you can watch.</p>
        <div className="scroll">
          <table className="stack-table" data-testid="scale-table">
            <thead><tr><th scope="col">Practice</th><th scope="col">What it means</th><th scope="col">On the Run page</th><th scope="col">Basis</th></tr></thead>
            <tbody>
              {SCALE.map(([name, means, where, basis]) => <tr key={name}><th scope="row">{name}</th><td data-label="What it means">{means}</td><td data-label="On the Run page">{where}</td><td data-label="Basis">{basis}</td></tr>)}
            </tbody>
          </table>
        </div>
        <p className="hint">How many calls PingOne allows is UNVERIFIED: this lab finds the limit by being told 429, and does not know the numbers.</p>
      </Section>

      <Section id="route-b" kicker="6 · Route B" title="Create user records with the Privilege console API">
        <p><Chip tone="warn">UNVERIFIED against a real console</Chip> The console's swagger has <code>GET</code> and <code>POST /api/{"{tenant}"}/v1/users</code>. A user is an object with <code>ObjectMeta</code> and <code>Spec</code>, and the three headers below authenticate the call.</p>
        <dl className="kv">
          <dt><code>x-api-key</code></dt><dd>The console user API key.</dd>
          <dt><code>x-api-secret</code></dt><dd>The console user API secret.</dd>
          <dt><code>x-procyon-session-id</code></dt><dd>Required by the console. This lab sends a fresh value per call; what the console checks in it is UNVERIFIED.</dd>
        </dl>
        <Io><CodeBlock code={CURL.routeB} label="curl" /><Json id="route-b" value={SHOW.routeB} label="user.json: the request body" /></Io>
        <ul>
          <li>Which <code>ObjectMeta</code> fields the console requires, and whether this POST is accepted as it stands: UNVERIFIED.</li>
          <li>Whether a person created this way can sign in: UNVERIFIED.</li>
          <li>Whether <code>GET /v1/users</code> pages: UNVERIFIED (the swagger shows no paging parameters).</li>
        </ul>
        <p className="source">Source: the console's swagger (baseline 2026-11-02), and a sibling lab that ran <code>GET users</code> against a local desktop console and got 200. The swagger has no endpoint that generates an onboarding link and no inbound SCIM server.</p>
      </Section>

      <Section id="try" kicker="7 · Try it" title="Run both routes without touching a real tenant">
        <p>Mock simulates PingOne and the Privilege console with made-up people on <code>.example</code> addresses, and plays six situations: realistic, clean, rate-limited, flaky, conflicts and a worker with a missing role. Nothing leaves this machine.</p>
        <p><a className="cta" href="#/run" data-testid="try-it">Open the Run page</a></p>
      </Section>

      <Section id="unverified" kicker="8 · What we have not verified" title="Read this before you rely on it">
        <ul data-testid="unverified-list">
          {UNVERIFIED.map((text) => <li key={text}>{withCode(text)}</li>)}
        </ul>
        <p className="source">The first Real run is the owner's. Nothing in Real was run while this lab was built; every test uses the in-process mock.</p>
      </Section>
    </div>
  );
}
