import React from "react";
import CodeBlock from "../components/CodeBlock.jsx";
import RealReason from "../components/RealReason.jsx";
import { HINTS } from "../lib/status.js";

// How to run the lab, how Real is set up (setting NAMES only, never values), what Mock simulates, presenter mode and Reset.
// Documentation, not state. Setting names are the ones in docs/api.md.
const SETTINGS = [
  ["PRIVILEGE_BULK_MODE", "Set to real: the owner's opt-in. Anything else keeps Real refused."],
  ["BULK_P1_REGION", "The PingOne region suffix (for example com)."],
  ["BULK_P1_SOURCE_ENV_ID", "The source environment: where the people are."],
  ["BULK_P1_PRIVILEGE_ENV_ID", "Privilege's own PingOne environment (it may be the same as the source)."],
  ["BULK_P1_WORKER_CLIENT_ID", "The worker app's client id."],
  ["BULK_P1_WORKER_CLIENT_SECRET", "The worker app's secret. Write-only: never returned, logged or audited."],
  ["BULK_P1_GROUP", "The Privilege group's name."],
  ["BULK_P1_WORKER_ENV_ID", "Optional: the worker app's home environment (default: the source)."],
  ["BULK_CONSOLE_URL", "Route B: the Privilege console origin."],
  ["BULK_CONSOLE_TENANT", "Route B: the console tenant."],
  ["BULK_CONSOLE_API_KEY", "Route B: the console user API key."],
  ["BULK_CONSOLE_API_SECRET", "Route B: the console user API secret. Write-only."],
  ["BULK_CONSOLE_INSECURE_TLS", "Optional: 1 accepts the local desktop console's self-signed certificate."],
];
const SCENARIOS = ["realistic (the default)", "clean", "rate-limited", "flaky", "conflicts", "missing-role"];

export default function Help({ info = null }) {
  return (
    <div data-testid="help-page">
      <h1>Help</h1>
      <p className="lede">How to start the lab, how to set up Real (owner-run), what Mock simulates, and what the page does when something goes wrong.</p>

      <section className="card" aria-labelledby="help-run">
        <h2 id="help-run">Run it</h2>
        <p>On the host (Node 26), then open the loopback address the README gives:</p>
        <CodeBlock label="shell" code="npm ci && npm run build && npm start" />
        <p>In Docker (OrbStack). It is published on 127.0.0.1 only:</p>
        <CodeBlock label="shell" code="docker compose up --build -d" />
      </section>

      <section className="card" aria-labelledby="help-mock">
        <h2 id="help-mock">What Mock simulates</h2>
        <p>An in-process stand-in for PingOne and for the Privilege console API, with made-up people on <code>.example</code> addresses, held in memory. Nothing leaves this machine, and Reset puts it back. Its waits are shortened: after a 429 or a retry, Mock waits only a small fraction of the real time (the Run page says how much for each job), so back-off in Mock is much shorter than a real run would wait. On the Run page, Mock adds a scenario and a people count to choose. The scenarios:</p>
        <ul className="plain-list">{SCENARIOS.map((s) => <li key={s}><code>{s}</code></li>)}</ul>
        <p>Each one has a description in the scenario box on the Run page.</p>
      </section>

      <section className="card" aria-labelledby="help-real">
        <h2 id="help-real">Set up Real (owner-run)</h2>
        <RealReason info={info} />
        <p>Real calls real services, so the first Real run is the owner's. Put these settings in this lab's own <code>.env</code>, beside <code>docker-compose.yml</code> (mode 600). The page shows setting names that are missing, never values.</p>
        <dl className="kv" data-testid="settings-list">
          {SETTINGS.map(([name, what]) => <React.Fragment key={name}><dt><code>{name}</code></dt><dd>{what}</dd></React.Fragment>)}
        </dl>
        <p>Writes are off by default. Applying in Real takes three deliberate steps: <strong>plan</strong>, type the count (<code>REGISTER N</code>), and turn the <strong>Writes</strong> switch on. Reset turns Writes off again.</p>
      </section>

      <section className="card" aria-labelledby="help-present">
        <h2 id="help-present">Presenter mode and Reset</h2>
        <p>Present (or the P key) makes the type larger; Escape leaves it. A MOCK or REAL modal opens the page and comes back when the mode changes; the Mode chip stays in the header on every page, presenter mode included. Reset in the header clears the job, the audit history and the Writes switch, stops any polling, and puts the diagram boxes back.</p>
      </section>

      <section className="card" aria-labelledby="help-errors">
        <h2 id="help-errors">When something is refused</h2>
        <p>The page shows the server's own message, word for word, with its code. What the codes mean:</p>
        <div className="scroll">
          <table data-testid="error-table">
            <thead><tr><th scope="col">Code</th><th scope="col">Meaning</th></tr></thead>
            <tbody>{Object.entries(HINTS).map(([code, text]) => <tr key={code}><th scope="row"><code>{code}</code></th><td>{text}</td></tr>)}</tbody>
          </table>
        </div>
      </section>

      <section className="card" aria-labelledby="help-unverified">
        <h2 id="help-unverified">What is not verified</h2>
        <p>Route B has never run against a real console, and Real was not run while this lab was built. The full list is on the <a href="#/guide" data-testid="unverified-link">Guide page, under What we have not verified</a>.</p>
      </section>
    </div>
  );
}
