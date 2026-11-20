import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Background, Controls, Handle, MarkerType, Position, ReactFlow, applyNodeChanges } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { get } from "../api.js";
import { sourceHref, sourceLabel } from "../lib/sources.js";
import { usePresent } from "../present/Present.jsx";
import { ArrowNoLabel, EdgeLabels, FitOpen, Passport as KitPassport, PassportActions } from "../diagram-kit/DiagramKit.jsx";
import { boxPassport, slotPoint } from "../diagram-kit/diagramKit.js";
import "../diagram-kit/diagram-kit.css";

// The two routes (route-a, route-b). The picture is diagram-studio/1 DATA (server/diagrams/*.json) fetched by name from /api/diagrams/:name
// (rule 17): nothing in this file lists a box or an arrow. Boxes drag; Simulate walks one run, Reset restores positions and state, the speed
// control sets the pace; the caption says in words what the picture shows.
const SPEEDS = [["0.5", "0.5x"], ["1", "1x"], ["2", "2x"], ["4", "4x"]];
const BASE_MS = 1600;
const SIDES = [["l", Position.Left], ["r", Position.Right], ["t", Position.Top], ["b", Position.Bottom]];
const SLOT = /^[lrtb][12]$/;
const reduced = () => !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const starts = (doc) => doc.nodes.map((n) => ({ id: n.id, position: { x: n.x, y: n.y } }));

// Which side slot an arrow leaves and enters by. The data may say (edge.handles, e.g. ["r1","l1"]); otherwise the sides that face each other.
export function slots(edge, at) {
  if (Array.isArray(edge.handles) && edge.handles.length === 2 && edge.handles.every((h) => SLOT.test(h))) return edge.handles;
  const a = at[edge.source], b = at[edge.target];
  const dx = b.x - a.x, dy = b.y - a.y;
  const [s, t] = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? ["r", "l"] : ["l", "r"]) : (dy > 0 ? ["b", "t"] : ["t", "b"]);
  return [`${s}1`, `${t}1`];
}

// The ReactFlow edges for a diagram document: one per edge of the data (ids e0, e1, ...), the walkthrough's current ones highlighted.
// The curve only: every label is drawn by the diagram kit's EdgeLabels, above the boxes, so no edge carries a `label`.
export function flowEdges(doc, active, animate) {
  const at = Object.fromEntries(doc.nodes.map((n) => [n.id, { x: n.x, y: n.y }]));
  return doc.edges.map((e, i) => {
    const id = `e${i}`; const [sh, th] = slots(e, at); const on = active.has(id);
    return { id, type: "arrow", source: e.source, sourceHandle: sh, target: e.target, targetHandle: th, animated: on && animate, className: `${on ? "flow__edge--on" : ""}${e.dashed ? " flow__edge--dashed" : ""}`, markerEnd: { type: MarkerType.ArrowClosed } };
  });
}

function Box({ data }) {
  return (
    <div className="fbox" data-state={data.on ? "on" : data.dim ? "dim" : undefined} data-open={data.passport ? "1" : undefined} data-testid={`box-${data.id}`}>
      {SIDES.flatMap(([s, pos]) => [1, 2].flatMap((n) => {
        const style = pos === Position.Left || pos === Position.Right ? { top: n === 1 ? "30%" : "70%" } : { left: n === 1 ? "30%" : "70%" };
        return [<Handle key={`${s}${n}t`} id={`${s}${n}`} type="target" position={pos} style={style} />, <Handle key={`${s}${n}s`} id={`${s}${n}`} type="source" position={pos} style={style} />];
      }))}
      <strong>{data.title}</strong>{data.sub.map((line, i) => <span key={i}>{line}</span>)}
      {data.passport && <KitPassport p={data.passport} />}
    </div>
  );
}
const nodeTypes = { box: Box };

// The curve only: every label is drawn by the diagram kit's EdgeLabels, in a layer above the boxes,
// placed so no two labels overlap and none sits on a box (the shared standard, UI patterns §8c).
const edgeTypes = { arrow: ArrowNoLabel };

// One label item per arrow, for the kit's EdgeLabels layer.
export function toLabelItems(doc, edges, active) {
  return doc.edges.map((e, i) => ({
    id: `e${i}`,
    text: e.label ?? "",
    source: e.source,
    target: e.target,
    sourceHandle: edges[i]?.sourceHandle,
    targetHandle: edges[i]?.targetHandle,
    active: active.has(`e${i}`),
    dim: active.size > 0 && !active.has(`e${i}`),
  }));
}

// A shared link is #/diagram/<route>/<box>: it opens that route with that box expanded (anything else in it is ignored).
const linkParts = () => { const [, , route = "", box = ""] = window.location.hash.replace(/^#/, "").split("/").map((x) => { try { return decodeURIComponent(x); } catch { return ""; } }); return { route, box }; };

export default function Diagram({ theme = "system" }) {
  const { present } = usePresent();
  const [names, setNames] = useState(null); // [{ name, title }] from GET /api/diagrams
  const [scenario, setScenario] = useState(null);
  const [doc, setDoc] = useState(null); // the diagram-studio/1 document shown (the last one that arrived)
  const [error, setError] = useState(null);
  const [moved, setMoved] = useState([]);
  const [speed, setSpeed] = useState("1");
  const [step, setStep] = useState(-1);
  const [flowKey, setFlowKey] = useState(0);
  const [running, setRunning] = useState(false);
  const [open, setOpen] = useState(null);       // the id of the expanded box, or null
  const wantBox = useRef(linkParts().box);       // a box from a shared link, expanded once its route has loaded

  useEffect(() => {
    let live = true; // a late answer after the page is left is dropped
    get("/api/diagrams").then((r) => {
      if (!live) return;
      if (!r.ok || !Array.isArray(r.json?.diagrams) || !r.json.diagrams.length) { setError("the diagram list did not load"); return; }
      const asked = linkParts().route;
      setNames(r.json.diagrams); setScenario(r.json.diagrams.some((d) => d.name === asked) ? asked : r.json.diagrams[0].name);
    });
    return () => { live = false; };
  }, []);
  useEffect(() => {
    if (!scenario) return undefined;
    let live = true; // a late answer for a diagram the visitor has already left is dropped
    get(`/api/diagrams/${encodeURIComponent(scenario)}`).then((r) => {
      if (!live) return;
      if (!r.ok || !Array.isArray(r.json?.nodes)) { setError("the diagram did not load"); return; }
      setError(null); setDoc(r.json);
      setOpen(wantBox.current && r.json.nodes.some((n) => n.id === wantBox.current) ? wantBox.current : null); wantBox.current = ""; // a link's box is used once; a different route has no such box      // Boxes the visitor has moved stay where they are when the route changes (a box in both routes keeps its place).
      setMoved((prev) => starts(r.json).map((n) => prev.find((p) => p.id === n.id) || n));
    });
    return () => { live = false; };
  }, [scenario]);

  // A shared link followed while this page is already showing (only the hash changes): switch to its route, and expand its box.
  useEffect(() => {
    const follow = () => {
      const { route, box } = linkParts();
      if (!route || !names?.some((d) => d.name === route)) return;
      if (route !== scenario) { wantBox.current = box; setScenario(route); setRunning(false); setStep(-1); setOpen(null); }
      else if (box && doc?.nodes.some((n) => n.id === box)) setOpen(box);
    };
    window.addEventListener("hashchange", follow);
    return () => window.removeEventListener("hashchange", follow);
  }, [names, scenario, doc]);

  const steps = doc?.steps ?? [];
  useEffect(() => {
    if (!running) return undefined;
    if (step >= steps.length - 1) { setRunning(false); return undefined; }
    const t = setTimeout(() => setStep((s) => s + 1), BASE_MS / Number(speed));
    return () => clearTimeout(t);
  }, [running, step, steps.length, speed]);
  const ready = !!doc && doc.id === scenario;
  const simulate = () => { setStep(0); setRunning(true); };
  const reset = () => { setRunning(false); setStep(-1); setOpen(null); if (doc) setMoved(starts(doc)); setFlowKey((k) => k + 1); }; // remount: positions AND pan/zoom back to the initial fit
  const pick = (s) => { setScenario(s); setRunning(false); setStep(-1); setOpen(null); };
  const onNodesChange = useCallback((c) => setMoved((n) => applyNodeChanges(c, n)), []);
  const cur = step >= 0 && steps[step] ? steps[step] : null;
  const curEdges = useMemo(() => new Set((cur?.edges ?? []).map((i) => `e${i}`)), [cur]);
  const curNodes = useMemo(() => new Set((cur?.edges ?? []).flatMap((i) => [doc.edges[i].source, doc.edges[i].target])), [cur, doc]);
  const nodes = useMemo(() => {
    if (!doc) return [];
    const by = new Map(doc.nodes.map((n) => [n.id, n]));
    return moved.filter((m) => by.has(m.id)).map((m) => {
      const n = by.get(m.id);
      return { ...m, type: "box", zIndex: m.id === open ? 10 : undefined, data: { id: m.id, title: n.label, sub: n.sub ?? [], on: curNodes.has(m.id), dim: !!cur && !curNodes.has(m.id), passport: m.id === open ? boxPassport(doc, m.id) : null } };
    });
  }, [doc, moved, cur, curNodes, open]);
  const edges = useMemo(() => (doc ? flowEdges(doc, curEdges, !reduced()) : []), [doc, curEdges]);
  const items = useMemo(() => (doc ? toLabelItems(doc, edges, curEdges) : []), [doc, edges, curEdges]);
  // What an expanded box can do: open the box at the far end of an arrow, close itself, and make a link that opens this route with it expanded.
  const actions = useMemo(() => ({
    open: (id) => setOpen(id), close: () => setOpen(null),
    link: (id) => { const u = new URL(window.location.href); u.search = ""; u.hash = `/diagram/${encodeURIComponent(scenario)}/${encodeURIComponent(id)}`; return u.toString(); },
  }), [scenario]);
  const cited = useMemo(() => (doc ? doc.nodes.filter((n) => Array.isArray(n.sources) && n.sources.length) : []), [doc]);
  return (
    <>
      <h1>The two routes, drawn</h1>
      <p className="lede" data-testid="diagram-lede">{ready && doc.lede ? doc.lede : "Drag any box. Simulate walks one run through the chosen route; Reset puts everything back."}</p>
      <div className="card controls">
        <label className="field">Route<select value={scenario ?? ""} onChange={(e) => pick(e.target.value)} disabled={!names}>{(names ?? []).map((d) => <option key={d.name} value={d.name}>{d.title}</option>)}</select></label>
        <label className="field">Speed<select value={speed} onChange={(e) => setSpeed(e.target.value)}>{SPEEDS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></label>
        <button type="button" className="primary" onClick={simulate} disabled={running || !ready}>Simulate</button>
        <button type="button" onClick={reset}>Reset</button>
      </div>
      {error && <p className="err-text" role="alert">Could not load the diagram ({error}).</p>}
      <div className="flow-wrap" role="group" aria-label="Diagram of the chosen route: this page, this lab, PingOne or the Privilege console API. Boxes can be dragged.">
        {doc && (
          <PassportActions.Provider value={actions}>
          <ReactFlow key={flowKey} nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} onNodesChange={onNodesChange} onNodeClick={(_, n) => setOpen((o) => (o === n.id ? null : n.id))} onPaneClick={() => setOpen(null)} colorMode={theme} fitView fitViewOptions={{ padding: 0.12 }} nodesConnectable={false} proOptions={{ hideAttribution: true }} minZoom={0.2}>
            <Background /><Controls showInteractive={false} /><EdgeLabels items={items} present={present} pointFor={(box, handle) => slotPoint(box, String(handle))} fallback={{ w: 220, h: 64 }} /><FitOpen open={open} closePadding={0.12} />
          </ReactFlow>
          </PassportActions.Provider>
        )}
      </div>
      <p className="caption" role="status" aria-live="polite" data-testid="caption">{cur ? `Step ${step + 1} of ${steps.length}: ${cur.what}` : "Press Simulate to walk one run through the diagram."}</p>
      {ready && cited.length > 0 && (
        <section className="card" aria-label="Where this is in the code" data-testid="diagram-sources">
          <h2>Where this is in the code</h2>
          <ul>
            {cited.map((n) => n.sources.map((src, i) => {
              const href = sourceHref(doc.repo, src);
              return <li key={`${n.id}-${i}`}>{n.label}: {src.label && <>{src.label}, </>}{href ? <a href={href} target="_blank" rel="noopener noreferrer">{sourceLabel(src)}</a> : <code>{sourceLabel(src)}</code>}</li>;
            }))}
          </ul>
          <p className="hint">{doc.repo?.rev ? `Read at commit ${doc.repo.rev.slice(0, 7)}. ` : ""}These are pointers, not a live view: a test checks each file and line range still exists, but it cannot tell when the code has moved within a file.</p>
        </section>
      )}
    </>
  );
}
