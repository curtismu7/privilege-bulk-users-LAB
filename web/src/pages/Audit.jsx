import React, { useEffect, useState } from "react";
import * as api from "../api.js";
import JsonPane from "../components/JsonPane.jsx";
import { Untrusted } from "../lib/Untrusted.jsx";

// The audit page: what this lab did, newest first. Entries are summaries (never a person's email, never a secret); the page
// renders text nodes only, and the selected entry opens as JSON.
export default function Audit() {
  const [entries, setEntries] = useState(null);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);
  useEffect(() => {
    let alive = true;
    api.get("/api/audit").then((r) => {
      if (!alive) return;
      if (r.ok && Array.isArray(r.json?.entries)) setEntries(r.json.entries); else setError(api.failure(r));
    });
    return () => { alive = false; };
  }, []);
  return (
    <div data-testid="audit-page">
      <h1>Audit</h1>
      <p className="lede">What this lab did, newest first: plans, applies, aborts, mode switches. Each entry is a summary. It never holds a person's email or a secret.</p>
      {error && <p className="notice" data-state="bad" role="alert" data-testid="audit-error"><strong>{error.code}</strong>: <Untrusted text={error.message} /></p>}
      {entries && entries.length === 0 && <p data-testid="audit-empty">Nothing has been recorded yet.</p>}
      {entries && entries.length > 0 && (
        <div className="scroll">
          <table data-testid="audit-table">
            <thead><tr><th scope="col">When</th><th scope="col">Operation</th><th scope="col">Route</th><th scope="col">Outcome</th><th scope="col">Open</th></tr></thead>
            <tbody>
              {entries.map((e, i) => (
                <tr key={i} data-testid="audit-row">
                  <td><Untrusted text={String(e.at ?? "").replace("T", " ").slice(0, 19)} /></td>
                  <td><Untrusted text={String(e.op ?? "")} /></td>
                  <td><Untrusted text={String(e.route ?? "")} /></td>
                  <td><Untrusted text={String(e.outcome ?? "")} /></td>
                  <td><button type="button" aria-pressed={selected === i} aria-label={`Details for entry ${i + 1}`} onClick={() => setSelected(selected === i ? null : i)}>Details</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {entries && selected !== null && entries[selected] && (
        <section className="card" aria-label="Audit entry" data-testid="audit-detail">
          <div className="json-pane"><JsonPane value={entries[selected]} label="This entry, as the server sent it" testId="audit-json" /></div>
        </section>
      )}
    </div>
  );
}
