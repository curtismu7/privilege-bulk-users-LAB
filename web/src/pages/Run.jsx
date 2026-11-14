import React, { useEffect, useRef, useState } from "react";
import * as api from "../api.js";
import Chip from "../components/Chip.jsx";
import Counts from "../components/Counts.jsx";
import RealReason from "../components/RealReason.jsx";
import Results from "../components/Results.jsx";
import Safe from "../components/Safe.jsx";
import { HINTS, lookup } from "../lib/status.js";
import { visibleLine } from "../lib/visible.js";

const POLL_MS = 400;
const ROUTES = [["a", "PingOne API: group membership"], ["b", "Privilege console API: POST /v1/users"]];
const STATE_TONE = { running: "info", done: "ok", aborted: "warn", failed: "danger" };
const pct100 = (x) => `${Math.round(Number(x) * 1000) / 10}%`;
const seconds = (ms) => `${((Number(ms) || 0) / 1000).toFixed(1)} s`;

// The lab: plan (a dry run), then apply, then plan again to verify. State comes from GET /api/info (the App re-reads it after Reset and
// after a mode switch) and from GET /api/jobs/current (read on load, and polled every 400 ms while a job runs).
export default function Run({ info, infoError, mode, onWrites, say }) {
  const [route, setRoute] = useState("a");
  const [scenario, setScenario] = useState("");
  const [users, setUsers] = useState(null);
  const [conc, setConc] = useState(null); // null = untouched: the server's default shows
  const [job, setJob] = useState(null);
  const [error, setError] = useState(null); // the last refused or failed action: { code, message }
  const [pollError, setPollError] = useState(null);
  const [acks, setAcks] = useState([]);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [aborting, setAborting] = useState(false);
  const via = useRef("plan");
  const acting = useRef(false); // a request of ours is in flight: a second click in the same tick (before React disables the button) is dropped
  const watching = useRef(false); // we started (or adopted) the job being shown: its start and end move focus
  const seen = useRef(null); // "<job id>:<run|end>" last handled by the focus effect
  const summaryRef = useRef(null);
  const applyRef = useRef(null);
  const verifyRef = useRef(null);

  const real = mode === "real";
  const scenarios = info?.mock?.scenarios ?? [];
  const datasets = info?.mock?.datasets ?? [];
  const lim = info?.limits?.concurrency ?? { min: 1, max: 16, default: 6 };
  const scenarioId = scenarios.some((s) => s.id === scenario) ? scenario : (scenarios.find((s) => s.id === "realistic") ?? scenarios[0])?.id ?? "";
  const usersN = datasets.includes(users) ? users : datasets[0];
  const concText = conc ?? String(lim.default);
  const route_ = info?.routes?.[route];
  const missing = route_?.missing ?? [];
  const running = job?.state === "running";

  // On load: show the running or the last job, so leaving the page and coming back loses nothing.
  useEffect(() => {
    let alive = true;
    api.get("/api/jobs/current").then((r) => {
      if (!alive) return;
      if (r.ok) setJob(r.json?.job ?? null); else setPollError(api.failure(r));
    });
    return () => { alive = false; };
  }, []);

  // While a job runs, ask again every 400 ms. It stops when the job is no longer running and when the page is left.
  useEffect(() => {
    if (!running) return undefined;
    let alive = true;
    let timer;
    const tick = async () => {
      const r = await api.get("/api/jobs/current");
      if (!alive) return;
      if (r.ok) { setPollError(null); setJob(r.json?.job ?? null); } else setPollError(api.failure(r));
      timer = setTimeout(tick, POLL_MS);
    };
    timer = setTimeout(tick, POLL_MS);
    return () => { alive = false; clearTimeout(timer); };
  }, [running]);

  // Focus and announcements. Starting a job removes the button that was pressed (and Apply's whole panel), so focus would fall to the page:
  // it goes to the job summary while the job runs, and when the job ends to what the reader does next (the Apply panel after a plan, Verify
  // after an apply, else the summary), with a line for the live region. A job found already running on load is followed too, but a finished
  // one is not announced, and focus is never moved for a job nobody here started.
  useEffect(() => {
    if (!job) return;
    const phase = job.state === "running" ? "run" : "end";
    const key = `${job.id}:${phase}`;
    const was = seen.current;
    if (was === key) return;
    seen.current = key;
    if (phase === "run" && was === null && !watching.current) { watching.current = true; return; }
    if (!watching.current) return;
    if (phase === "run") { summaryRef.current?.focus(); return; }
    watching.current = false;
    setAborting(false);
    (applyRef.current ?? verifyRef.current ?? summaryRef.current)?.focus();
    const what = job.kind === "apply" ? "Apply" : "Plan";
    const next = job.kind === "apply" ? ` ${job.counts?.failed ?? 0} failed.` : job.counts?.toApply !== undefined ? ` ${job.counts.toApply} to apply.` : "";
    say?.(`${what} ${job.state}.${next}`);
  }, [job, say]);

  const concurrency = () => { const n = Math.round(Number(concText)); return concText.trim() === "" || !Number.isFinite(n) ? lim.default : Math.min(lim.max, Math.max(lim.min, n)); };

  // `world` is the applied job's own parameters, for Verify: it plans the SAME world, whatever the controls say now.
  async function startPlan(how, world = null) {
    if (acting.current) return;
    acting.current = true;
    try {
      via.current = how;
      watching.current = true;
      setError(null); setPollError(null); setAcks([]); setConfirm(""); setBusy(true);
      const body = { route: world?.route ?? route, concurrency: Number.isFinite(world?.concurrency) ? world.concurrency : concurrency() };
      if (!real) {
        const sc = world ? world.scenario : scenarioId;
        const us = world ? world.users : usersN;
        if (sc != null) body.scenario = sc;
        if (us != null) body.users = us;
      }
      const r = await api.post("/api/plan", body);
      if (r.ok) setJob(r.json.job); else { watching.current = false; setError(api.failure(r)); }
    } finally { acting.current = false; setBusy(false); }
  }

  async function apply() {
    if (acting.current) return;
    acting.current = true;
    try {
      watching.current = true;
      setError(null); setBusy(true);
      const body = { planId: job.planId, confirm };
      const ack = blocking.map((w) => w.code).filter((c) => acks.includes(c));
      if (ack.length) body.acknowledgeWarnings = ack;
      const r = await api.post("/api/apply", body);
      if (r.ok) { setConfirm(""); setAcks([]); setJob(r.json.job); } else { watching.current = false; setError(api.failure(r)); }
    } finally { acting.current = false; setBusy(false); }
  }

  async function abort() {
    if (acting.current) return;
    acting.current = true;
    try {
      setError(null); setAborting(true);
      const r = await api.post("/api/jobs/current/abort");
      if (r.ok) setJob(r.json.job); else { setAborting(false); setError(api.failure(r)); }
    } finally { acting.current = false; }
  }

  async function toggleWrites(on) {
    if (acting.current) return;
    acting.current = true;
    try {
      setError(null); setBusy(true);
      const r = await api.post("/api/writes", { enabled: on });
      if (r.ok) onWrites?.(Boolean(r.json.writesEnabled)); else setError(api.failure(r));
    } finally { acting.current = false; setBusy(false); }
  }

  // What the page offers next, from the latest job.
  const finished = job && !running;
  const planDone = job?.kind === "plan" && job.state === "done";
  const toApply = job?.counts?.toApply ?? 0;
  const blocking = (job?.warnings ?? []).filter((w) => w.blocking);
  const sameMode = !job || job.source === (real ? "real" : "mock");
  const applyOffered = planDone && Boolean(job.planId) && toApply > 0 && sameMode;
  const verifyOffered = job?.kind === "apply" && finished;
  // Verify plans the world the applied job ran in: its own route, scenario, people count and concurrency, whatever the controls say now.
  const world = verifyOffered ? { route: job.route, scenario: job.scenario, users: job.users, concurrency: Number(job.concurrency) } : null;
  const worldText = world ? `${real ? "" : `scenario ${visibleLine(world.scenario ?? "default")}, ${world.users == null ? "the same number of people" : `${world.users} people`}, `}route ${String(world.route).toUpperCase()}, concurrency ${Number.isFinite(world.concurrency) ? world.concurrency : concurrency()}` : "";
  const expected = `REGISTER ${toApply}`;
  const writesOn = Boolean(info?.writesEnabled);
  const why = [
    confirm !== expected && `type ${expected}`,
    ...blocking.filter((w) => !acks.includes(w.code)).map((w) => `tick I understand for ${w.code}`),
    real && !writesOn && "turn the Writes switch on",
  ].filter(Boolean);
  const planWhy = !info ? "Waiting for the server's settings." : real && !route_?.realReady ? `Real is not set up for this route. Missing: ${missing.map(visibleLine).join(", ") || "settings the server did not name"}.` : "";
  const planDisabled = Boolean(planWhy) || running || busy;
  const nextStep = applyOffered ? "apply" : verifyOffered ? "verify" : "plan"; // the one primary button of this moment

  const jobError = job?.error && job.error.code !== "aborted" ? job.error : job?.state === "failed" ? { code: "failed", message: "The job failed without a message." } : null;
  const shown = error ?? pollError ?? infoError ?? jobError;
  const pct = job?.total ? Math.min(100, Math.round((job.processed / job.total) * 100)) : 0;
  const mocked = job?.source === "mock";

  return (
    <div data-testid="run-page">
      <h1>Run: register people</h1>
      <p className="lede">Plan reads and decides, and writes nothing. Apply writes what the plan said, after you type the count. Then plan again: a clean run shows 0 left to apply.</p>
      <RealReason info={info} />

      <section className="card" aria-labelledby="choose-h">
        <h2 id="choose-h">1 · Choose</h2>
        <fieldset className="field" disabled={running}>
          <legend>Route</legend>
          {ROUTES.map(([id, label]) => (
            <label key={id} className="choice">
              <input type="radio" name="route" value={id} checked={route === id} onChange={() => setRoute(id)} data-testid={`route-${id}`} />
              <span><strong>Route {id.toUpperCase()}</strong>: {visibleLine(info?.routes?.[id]?.label ?? label)}</span>
            </label>
          ))}
        </fieldset>
        <div className="controls">
          {!real && (
            <>
              <label className="field">Scenario
                <select value={scenarioId} onChange={(e) => setScenario(e.target.value)} disabled={running || !scenarios.length} data-testid="scenario-select">
                  {scenarios.map((s) => <option key={String(s.id)} value={String(s.id)}>{visibleLine(s.label)}</option>)}
                </select>
              </label>
              <label className="field">People in the source
                <select value={usersN ?? ""} onChange={(e) => setUsers(Number(e.target.value))} disabled={running || !datasets.length} data-testid="users-select">
                  {datasets.map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
            </>
          )}
          <label className="field">Concurrency ({lim.min} to {lim.max})
            <input type="number" min={lim.min} max={lim.max} value={concText} onChange={(e) => setConc(e.target.value)} onBlur={() => setConc(String(concurrency()))} disabled={running} data-testid="concurrency-input" />
          </label>
        </div>
        {!real && scenarios.length > 0 && <p className="hint" data-testid="scenario-desc"><strong>{visibleLine(scenarios.find((s) => s.id === scenarioId)?.label)}</strong>: <Safe text={scenarios.find((s) => s.id === scenarioId)?.description ?? ""} multiline /></p>}
        {real && info && (
          <div className="hint" data-testid="real-settings">
            {missing.length
              ? <>Settings still missing for this route (names only, set them in this lab's .env): <code>{missing.map(visibleLine).join(", ")}</code></>
              : "Every setting this route needs is present."}
          </div>
        )}
        <div className="row wrap actions">
          <button type="button" className={nextStep === "plan" ? "primary" : ""} onClick={() => startPlan("plan")} disabled={planDisabled} title={planWhy || undefined} data-testid="plan-btn">Plan (dry run)</button>
          {verifyOffered && <button type="button" className={nextStep === "verify" ? "primary" : ""} ref={verifyRef} onClick={() => startPlan("verify", world)} disabled={planDisabled} data-testid="verify-btn">Verify (plan again)</button>}
          {running && <button type="button" onClick={abort} disabled={aborting} data-testid="abort-btn">{aborting ? "Aborting..." : "Abort"}</button>}
        </div>
        {verifyOffered && <p className="hint" data-testid="verify-note">Verifying the same world: {worldText}. The choices above are not used for Verify.</p>}
        {planWhy && <p className="hint" data-testid="plan-reason">{planWhy}</p>}
      </section>

      {shown && (
        <div className="notice" data-state="bad" role="alert" data-testid="error-pane">
          <strong><Safe text={shown.code} /></strong>: <Safe text={shown.message} multiline />
          {lookup(HINTS, shown.code) && <p className="hint">{lookup(HINTS, shown.code)}</p>}
        </div>
      )}

      {job && (
        <section className="card" aria-labelledby="job-h" tabIndex={-1} ref={summaryRef} data-testid="job">
          <h2 id="job-h">2 · {job.kind === "apply" ? "Apply" : "Plan"}, route {String(job.route).toUpperCase()}</h2>
          <p className="row wrap">
            <Chip tone={lookup(STATE_TONE, job.state)} testId="job-state">{visibleLine(job.state)}</Chip>
            <Chip tone={mocked ? "info" : "warn"}>{visibleLine(job.source)}{job.scenario ? `: ${visibleLine(job.scenario)}` : ""}</Chip>
            <span data-testid="job-phase">{visibleLine(job.phase)}</span>
          </p>
          {job.state === "aborted" && <p className="hint" data-testid="job-aborted">Aborted on purpose. People already processed stay processed; the rest were not touched.</p>}
          <div className="progress" role="progressbar" aria-label="Progress" aria-valuemin={0} aria-valuemax={job.total ?? undefined} aria-valuenow={job.total ? job.processed : undefined} aria-valuetext={job.total ? `${job.processed} of ${job.total}` : visibleLine(job.phase)} data-testid="progress">
            <span className="progress__bar" style={{ width: `${pct}%` }} />
          </div>
          <p className="hint" data-testid="progress-text">{job.total ? `${job.processed} of ${job.total} people` : "Counting the people in the source..."}</p>
          <Counts counts={job.counts} />
          <dl className="kv" data-testid="http-stats">
            <dt>Calls</dt><dd data-testid="http-calls">{job.http?.calls ?? 0}</dd>
            <dt>Retries</dt><dd data-testid="http-retries">{job.http?.retries ?? 0}</dd>
            <dt>429 answers (rate limit)</dt><dd data-testid="http-429">{job.http?.rate429 ?? 0}</dd>
            <dt>Waited (back-off)</dt><dd data-testid="http-waited">{seconds(job.http?.waitedMs)}</dd>
            <dt>Calls per second</dt><dd data-testid="http-persec">{(Number(job.http?.perSec) || 0).toFixed(1)}</dd>
          </dl>
          {Number(job.timeScale) > 0 && Number(job.timeScale) < 1 && (
            <p className="notice" data-state="warn" data-testid="time-scale-note"><strong>Mock: every wait is shortened to {pct100(job.timeScale)} of real time, so back-off here is much shorter than a real run would wait.</strong> The figures above show that back-off happens, not how long a real one lasts.</p>
          )}
          {(job.http?.rate429 ?? 0) > 0 && <p className="notice" data-state="warn" data-testid="backoff">The service said slow down {job.http.rate429} time(s). The run waited {seconds(job.http.waitedMs)} in total and carried on.</p>}

          {job.warnings?.length > 0 && (
            <div data-testid="warnings">
              {job.warnings.map((w) => (
                <div key={w.code} className="notice" data-state={w.blocking ? "bad" : "warn"} role="alert" data-testid={`warning-${w.code}`}>
                  <strong><Safe text={w.code} />{w.blocking ? " (blocking)" : ""}</strong>: <Safe text={w.message} multiline />
                  {w.blocking && planDone && (
                    <label className="choice"><input type="checkbox" checked={acks.includes(w.code)} onChange={(e) => setAcks((a) => (e.target.checked ? [...a, w.code] : a.filter((c) => c !== w.code)))} data-testid={`ack-${w.code}`} /> I understand</label>
                  )}
                </div>
              ))}
            </div>
          )}

          {planDone && toApply === 0 && (
            <p className="notice" data-state="ok" role="status" data-testid="plan-clean"><strong>{via.current === "verify" ? "Verified: " : ""}0 to apply.</strong> Nobody is left to register{(job.counts?.conflict ?? 0) + (job.counts?.invalid ?? 0) > 0 ? ", apart from the conflicts and invalid rows a person must look at" : ""}.</p>
          )}
          {planDone && !sameMode && <p className="notice" data-state="warn" data-testid="plan-other-mode">This plan was made in {job.source}. Plan again in {real ? "Real" : "Mock"} before applying.</p>}

          {applyOffered && (
            <div className="apply" role="group" aria-labelledby="apply-h" tabIndex={-1} ref={applyRef} data-testid="apply-panel">
              <h3 id="apply-h">3 · Apply</h3>
              <p><strong data-testid="apply-count">This will change {toApply} {toApply === 1 ? "person" : "people"}.</strong> {real ? "They are created and added in the real environments." : "Only the in-process mock changes."} Apply runs with the plan's concurrency{Number.isFinite(Number(job.concurrency)) ? ` (${Number(job.concurrency)})` : ""}.</p>
              {real && (
                <label className="choice">
                  <input type="checkbox" role="switch" checked={writesOn} onChange={(e) => toggleWrites(e.target.checked)} disabled={busy} data-testid="writes-switch" />
                  <span>Writes: <strong>{writesOn ? "ON" : "off"}</strong>. Must be on before Apply is accepted. Off by default; Reset turns it off.</span>
                </label>
              )}
              <label className="field"><span>Type <code>{expected}</code> to confirm</span>
                <input type="text" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" spellCheck={false} placeholder={expected} data-testid="confirm-input" />
              </label>
              <div className="row wrap actions">
                <button type="button" className={nextStep === "apply" ? "primary" : ""} onClick={apply} disabled={why.length > 0 || busy || running} data-testid="apply-btn">Apply to {toApply} {toApply === 1 ? "person" : "people"}</button>
              </div>
              {why.length > 0 && <p className="hint" data-testid="apply-reason">Before Apply works: {why.join("; ")}.</p>}
            </div>
          )}

          {finished && (
            <p className="row wrap" data-testid="report-links">
              <span>Report of this job:</span>
              <a href="/api/report?format=json" download data-testid="report-json">JSON</a>
              <a href="/api/report?format=csv" download data-testid="report-csv">CSV</a>
            </p>
          )}
        </section>
      )}

      {finished && <Results key={job.id} />}
    </div>
  );
}
