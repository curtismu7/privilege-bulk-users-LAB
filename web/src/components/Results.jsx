import React, { useEffect, useState } from "react";
import * as api from "../api.js";
import JsonView from "../json/JsonView.jsx";
import { HINTS, TONE, lookup, testKey } from "../lib/status.js";
import { visibleLine } from "../lib/visible.js";
import Chip from "./Chip.jsx";
import Safe from "./Safe.jsx";

const PAGE = 100;

// The per-person rows of the last finished job: status filter chips (built from what the server says is in the job), paging,
// and a detail pane for the selected row. Usernames, masked emails and details are server text: they are rendered as text nodes only.
// The parent gives it key={job.id}, so a new job starts with no filter, page or selection.
export default function Results() {
  const [filter, setFilter] = useState("");
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState(null);
  const [statuses, setStatuses] = useState({}); // from the unfiltered answer, so the chips stay while a filter is on
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    let alive = true; // an answer for a page or filter the visitor has already left is dropped
    api.get(`/api/jobs/current/results?status=${encodeURIComponent(filter)}&offset=${offset}&limit=${PAGE}`).then((r) => {
      if (!alive) return;
      if (!r.ok) { setError(api.failure(r)); return; }
      setError(null); setData(r.json);
      if (filter === "") setStatuses(r.json.statuses && typeof r.json.statuses === "object" ? r.json.statuses : {});
    });
    return () => { alive = false; };
  }, [filter, offset]);

  const pick = (s) => { setFilter(s); setOffset(0); setSelected(null); };
  const rows = Array.isArray(data?.rows) ? data.rows : [];
  const total = Number(data?.total) || 0;
  const all = Object.values(statuses).reduce((a, n) => a + (Number(n) || 0), 0);
  return (
    <section className="card" aria-labelledby="results-h" data-testid="results">
      <h2 id="results-h">Results, person by person</h2>
      {error && (
        <div className="notice" data-state="bad" role="alert" data-testid="results-error">
          <strong><Safe text={error.code} /></strong>: <Safe text={error.message} multiline />
          {lookup(HINTS, error.code) && <p className="hint">{lookup(HINTS, error.code)}</p>}
        </div>
      )}
      <div className="seg" role="group" aria-label="Filter by status">
        <button type="button" aria-pressed={filter === ""} onClick={() => pick("")} data-testid="status-filter-all">All ({String(all || total)})</button>
        {Object.entries(statuses).map(([s, n]) => (
          <button key={s} type="button" aria-pressed={filter === s} onClick={() => pick(s)} data-testid={`status-filter-${testKey(s)}`}>{visibleLine(s)} ({String(n)})</button>
        ))}
      </div>
      {data && rows.length === 0 && !error && <p className="hint" data-testid="results-empty">No rows{filter ? ` with status ${visibleLine(filter)}` : ""}.</p>}
      {rows.length > 0 && (
        <div className="scroll">
          <table className="results" data-testid="results-table">
            <thead><tr><th scope="col">#</th><th scope="col">Username</th><th scope="col">Email (masked)</th><th scope="col" className="col-status">Status</th><th scope="col">HTTP</th><th scope="col">Tries</th><th scope="col">Detail</th><th scope="col">Open</th></tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.n} data-testid="result-row" data-selected={selected?.n === row.n ? "true" : undefined}>
                  <td>{String(row.n)}</td>
                  <td><Safe text={row.username} testId="cell-username" /></td>
                  <td><Safe text={row.email} testId="cell-email" /></td>
                  <td className="col-status"><Chip tone={lookup(TONE, row.status)} title={visibleLine(row.status)}><Safe text={row.status} testId="cell-status" /></Chip></td>
                  <td>{row.httpStatus == null ? "" : String(row.httpStatus)}</td>
                  <td>{String(row.attempts ?? "")}</td>
                  <td><Safe text={row.detail} testId="cell-detail" /></td>
                  <td><button type="button" aria-pressed={selected?.n === row.n} aria-label={`Details for row ${String(row.n)}`} onClick={() => setSelected(row)} data-testid="row-open">Details</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {total > PAGE && (
        <p className="row wrap" data-testid="results-paging">
          <button type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))} data-testid="results-prev">Previous 100</button>
          <span>Rows {offset + 1} to {offset + rows.length} of {total}</span>
          <button type="button" disabled={offset + PAGE >= total} onClick={() => setOffset(offset + PAGE)} data-testid="results-next">Next 100</button>
        </p>
      )}
      {selected && (
        <div className="detail" data-testid="row-detail">
          <div className="row between wrap">
            <h3>Row {String(selected.n)}</h3>
            <button type="button" onClick={() => setSelected(null)}>Close</button>
          </div>
          <div className="json-pane"><JsonView value={selected} label="This row, as the server sent it" testId="row-json" /></div>
        </div>
      )}
    </section>
  );
}
