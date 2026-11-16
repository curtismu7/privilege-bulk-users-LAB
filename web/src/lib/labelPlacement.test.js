import { describe, expect, it } from "vitest";
import { Position, getBezierPath } from "@xyflow/react";
import { flowEdges } from "../pages/Diagram.jsx";
import { DIAGRAM_DOCS } from "../test-helpers.js";
import { curveOf, labelOverlaps, labelSize, placeLabels, pointAt, slotPoint } from "./labelPlacement.js";

const box = (x, y, w = 220, h = 64) => ({ x, y, w, h });

describe("the slots", () => {
  it("are the eight side slots the box draws: slot 1 at 30% along the side, slot 2 at 70%, and nothing else", () => {
    const b = box(10, 20, 200, 100);
    expect(slotPoint(b, "l1")).toEqual([10, 50, Position.Left]);
    expect(slotPoint(b, "l2")).toEqual([10, 90, Position.Left]);
    expect(slotPoint(b, "r1")).toEqual([210, 50, Position.Right]);
    expect(slotPoint(b, "r2")).toEqual([210, 90, Position.Right]);
    expect(slotPoint(b, "t1")).toEqual([70, 20, Position.Top]);
    expect(slotPoint(b, "t2")).toEqual([150, 20, Position.Top]);
    expect(slotPoint(b, "b1")).toEqual([70, 120, Position.Bottom]);
    expect(slotPoint(b, "b2")).toEqual([150, 120, Position.Bottom]);
    for (const bad of ["x1", "l3", "l", "", undefined, null]) expect(slotPoint(b, bad)).toBeNull();
  });
  it("give React Flow's own curve: its middle is exactly where React Flow puts a label", () => {
    const a = box(0, 0); const b = box(500, 140); const c = box(40, 320);
    for (const [from, to] of [[slotPoint(a, "r1"), slotPoint(b, "l1")], [slotPoint(b, "l2"), slotPoint(a, "r2")], [slotPoint(a, "b1"), slotPoint(c, "t1")], [slotPoint(c, "t2"), slotPoint(a, "b2")]]) {
      const [, lx, ly] = getBezierPath({ sourceX: from[0], sourceY: from[1], sourcePosition: from[2], targetX: to[0], targetY: to[1], targetPosition: to[2] });
      const [mx, my] = pointAt(curveOf(from, to), 0.5);
      expect(mx).toBeCloseTo(lx, 6); expect(my).toBeCloseTo(ly, 6);
    }
  });
});

describe("placing the labels", () => {
  const a = box(0, 0); const b = box(500, 0);
  const edge = (id, text, extra = {}) => ({ id, text, from: slotPoint(a, "r1"), to: slotPoint(b, "l1"), ...extra });

  it("a lone label stays exactly where React Flow would have put it", () => {
    const [, lx, ly] = getBezierPath({ sourceX: 220, sourceY: 19.2, sourcePosition: Position.Right, targetX: 500, targetY: 19.2, targetPosition: Position.Left });
    const at = placeLabels({ edges: [edge("e0", "token")], boxes: [a, b] }).get("e0");
    expect(at.x).toBeCloseTo(lx, 6); expect(at.y).toBeCloseTo(ly, 6);
  });
  it("a request and its response between the same two boxes do not overlap", () => {
    const at = placeLabels({ edges: [edge("e0", "POST /users"), { id: "e1", text: "201 Created", from: slotPoint(b, "l2"), to: slotPoint(a, "r2") }], boxes: [a, b] });
    expect(labelOverlaps(at)).toBe(0);
  });
  it("many arrows between the same boxes: no two labels overlap", () => {
    expect(labelOverlaps(placeLabels({ edges: Array.from({ length: 6 }, (_, i) => edge(`e${i}`, `request number ${i}`)), boxes: [a, b] }))).toBe(0);
  });
  it("a label moves out of the way of a box on its arrow, and uses the measured size when given", () => {
    const wall = box(290, -20, 120, 100);
    const at = placeLabels({ edges: [edge("e0", "token", { size: { w: 150, h: 40 } })], boxes: [a, b, wall] }).get("e0");
    expect([at.w, at.h]).toEqual([150, 40]);
    const r = { x: at.x - at.w / 2, y: at.y - at.h / 2, w: at.w, h: at.h };
    expect(r.x < wall.x + wall.w && wall.x < r.x + r.w && r.y < wall.y + wall.h && wall.y < r.y + r.h).toBe(false);
  });
  it("an arrow with no text has no label; a long label wraps at 224px", () => {
    expect(placeLabels({ edges: [edge("e0", ""), edge("e1", undefined)], boxes: [a, b] }).size).toBe(0);
    expect(labelSize("x".repeat(120), 11).w).toBe(224);
  });
});

// The two real routes, through the page's own flowEdges (slots and all). Box sizes are estimated here (the browser measures them).
describe("the two real routes", () => {
  const boxesOf = (d) => new Map(d.nodes.map((n) => [n.id, box(n.x, n.y, 220, 56 + 14 * (n.sub?.length ?? 0))]));
  for (const name of ["route-a", "route-b"]) {
    it(`${name}: every label is placed, and none overlaps another`, () => {
      const d = DIAGRAM_DOCS[name]; const boxes = boxesOf(d); const edges = flowEdges(d, new Set(), false);
      const input = edges.filter((e) => e.label).map((e) => ({ id: e.id, text: e.label, from: slotPoint(boxes.get(e.source), e.sourceHandle), to: slotPoint(boxes.get(e.target), e.targetHandle) }));
      const placed = placeLabels({ edges: input, boxes: [...boxes.values()] });
      expect(placed.size).toBe(d.edges.filter((e) => e.label).length);
      expect(placed.size).toBeGreaterThanOrEqual(5);
      expect(labelOverlaps(placed)).toBe(0);
    });
  }
});
