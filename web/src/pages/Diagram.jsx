import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Background, BaseEdge, Controls, Handle, MarkerType, Position, ReactFlow, ViewportPortal, applyNodeChanges, getBezierPath, useStore } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { get } from "../api.js";
import { usePresent } from "../present/Present.jsx";
import { sourceHref, sourceLabel } from "../lib/sources.js";
import { placeLabels, slotPoint } from "../lib/labelPlacement.js";

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
export function flowEdges(doc, active, animate) {
  const at = Object.fromEntries(doc.nodes.map((n) => [n.id, { x: n.x, y: n.y }]));
  return doc.edges.map((e, i) => {
    const id = `e${i}`; const [sh, th] = slots(e, at); const on = active.has(id);
    return { id, type: "arrow", source: e.source, sourceHandle: sh, target: e.target, targetHandle: th, label: e.label, animated: on && animate, className: `${on ? "flow__edge--on" : ""}${e.dashed ? " flow__edge--dashed" : ""}`, markerEnd: { type: MarkerType.ArrowClosed } };
  });
}

function Box({ data }) {
  return (
    <div className="fbox" data-state={data.on ? "on" : data.dim ? "dim" : undefined}>
      {SIDES.flatMap(([s, pos]) => [1, 2].flatMap((n) => {
        const style = pos === Position.Left || pos === Position.Right ? { top: n === 1 ? "30%" : "70%" } : { left: n === 1 ? "30%" : "70%" };
        return [<Handle key={`${s}${n}t`} id={`${s}${n}`} type="target" position={pos} style={style} />, <Handle key={`${s}${n}s`} id={`${s}${n}`} type="source" position={pos} style={style} />];
      }))}
      <strong>{data.title}</strong>{data.sub.map((line, i) => <span key={i}>{line}</span>)}
    </div>
  );
}
const nodeTypes = { box: Box };

// The curve only. Its label is not drawn here (an SVG label would sit under the boxes): Labels draws every label above them.
function Arrow({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data: _data, label: _label, ...rest }) {
  const [path] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  return <BaseEdge path={path} {...rest} />;
}
const edgeTypes = { arrow: Arrow };

// The boxes as React Flow measured them (our nodes are controlled, so the sizes are not on them). A box not measured yet gets the
// size the page draws it at (220px wide); the measured size replaces that a moment later.
const boxesOf = (s) => [...s.nodeLookup.values()].map((n) => ({ id: n.id, x: n.internals.positionAbsolute.x, y: n.internals.positionAbsolute.y, w: n.measured?.width ?? 220, h: n.measured?.height ?? 64 }));
const sameBoxes = (a, b) => a.length === b.length && a.every((n, i) => n.id === b[i].id && n.x === b[i].x && n.y === b[i].y && n.w === b[i].w && n.h === b[i].h);

// Every arrow's label, in a layer above the boxes (React Flow's ViewportPortal), each on the first spot along its own arrow that
// touches no other label and no box (lib/labelPlacement.js). The label of the arrow being walked turns accent-coloured and bold
// and is raised above the others. Labels take no clicks: the boxes under them stay draggable.
function Labels({ edges, present }) {
  const boxes = useStore(boxesOf, sameBoxes);
  const els = useRef(new Map());
  const observer = useRef(null);
  const [sizes, setSizes] = useState(() => new Map()); // label id -> { w, h } as drawn; until then the placement estimates
  useEffect(() => {
    observer.current = new ResizeObserver((entries) => setSizes((prev) => {
      let next = null;
      for (const { target: el } of entries) {
        const w = el.offsetWidth; const h = el.offsetHeight; const old = prev.get(el.dataset.labelId);
        if (w > 0 && h > 0 && (!old || old.w !== w || old.h !== h)) { next ||= new Map(prev); next.set(el.dataset.labelId, { w, h }); }
      }
      return next || prev;
    }));
    for (const el of els.current.values()) observer.current.observe(el);
    return () => observer.current.disconnect();
  }, []);
  const placed = useMemo(() => {
    const by = new Map(boxes.map((b) => [b.id, b]));
    const input = edges.flatMap((e) => {
      const a = by.get(e.source); const b = by.get(e.target);
      const from = a && slotPoint(a, e.sourceHandle); const to = b && slotPoint(b, e.targetHandle);
      return from && to && e.label ? [{ id: e.id, text: e.label, from, to, prefer: 0, size: sizes.get(e.id) }] : [];
    });
    return placeLabels({ edges: input, boxes, fontPx: present ? 13 : 11 });
  }, [boxes, edges, present, sizes]);
  return (
    <ViewportPortal>
      {edges.filter((e) => placed.has(e.id)).map((e) => {
        const at = placed.get(e.id); const on = e.className.includes("flow__edge--on");
        return (
          <div key={e.id} ref={(el) => { if (el) { els.current.set(e.id, el); observer.current?.observe(el); } else els.current.delete(e.id); }} data-label-id={e.id}
            className={`flow-label${on ? " flow-label--on" : ""}`} data-testid={`flow-label-${e.id.slice(1)}`} style={{ transform: `translate(-50%, -50%) translate(${at.x}px, ${at.y}px)`, zIndex: on ? 3 : 1 }}>{e.label}</div>
        );
      })}
    </ViewportPortal>
  );
}

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

  useEffect(() => {
    let live = true; // a late answer after the page is left is dropped
    get("/api/diagrams").then((r) => {
      if (!live) return;
      if (!r.ok || !Array.isArray(r.json?.diagrams) || !r.json.diagrams.length) { setError("the diagram list did not load"); return; }
      setNames(r.json.diagrams); setScenario(r.json.diagrams[0].name);
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
      // Boxes the visitor has moved stay where they are when the route changes (a box in both routes keeps its place).
      setMoved((prev) => starts(r.json).map((n) => prev.find((p) => p.id === n.id) || n));
    });
    return () => { live = false; };
  }, [scenario]);

  const steps = doc?.steps ?? [];
  useEffect(() => {
    if (!running) return undefined;
    if (step >= steps.length - 1) { setRunning(false); return undefined; }
    const t = setTimeout(() => setStep((s) => s + 1), BASE_MS / Number(speed));
    return () => clearTimeout(t);
  }, [running, step, steps.length, speed]);
  const ready = !!doc && doc.id === scenario;
  const simulate = () => { setStep(0); setRunning(true); };
  const reset = () => { setRunning(false); setStep(-1); if (doc) setMoved(starts(doc)); setFlowKey((k) => k + 1); }; // remount: positions AND pan/zoom back to the initial fit
  const pick = (s) => { setScenario(s); setRunning(false); setStep(-1); };
  const onNodesChange = useCallback((c) => setMoved((n) => applyNodeChanges(c, n)), []);
  const cur = step >= 0 && steps[step] ? steps[step] : null;
  const curEdges = useMemo(() => new Set((cur?.edges ?? []).map((i) => `e${i}`)), [cur]);
  const curNodes = useMemo(() => new Set((cur?.edges ?? []).flatMap((i) => [doc.edges[i].source, doc.edges[i].target])), [cur, doc]);
  const nodes = useMemo(() => {
    if (!doc) return [];
    const by = new Map(doc.nodes.map((n) => [n.id, n]));
    return moved.filter((m) => by.has(m.id)).map((m) => {
      const n = by.get(m.id);
      return { ...m, type: "box", data: { title: n.label, sub: n.sub ?? [], on: curNodes.has(m.id), dim: !!cur && !curNodes.has(m.id) } };
    });
  }, [doc, moved, cur, curNodes]);
  const edges = useMemo(() => (doc ? flowEdges(doc, curEdges, !reduced()) : []), [doc, curEdges]);
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
          <ReactFlow key={flowKey} nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} onNodesChange={onNodesChange} colorMode={theme} fitView fitViewOptions={{ padding: 0.12 }} nodesConnectable={false} proOptions={{ hideAttribution: true }} minZoom={0.2}>
            <Background /><Controls showInteractive={false} /><Labels edges={edges} present={present} />
          </ReactFlow>
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
