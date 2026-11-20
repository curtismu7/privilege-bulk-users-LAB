import { describe, expect, it } from "vitest";
import { flowEdges, slots, toLabelItems } from "../pages/Diagram.jsx";
import { DIAGRAM_DOCS } from "../test-helpers.js";
import { placeLabels, slotPoint, labelOverlaps } from "../diagram-kit/diagramKit.js";

// The label placement itself is the vendored diagram kit's (../diagram-kit, pinned by diagram-kit.sha256); here: this page's
// wiring — the slots its boxes draw, the edges it hands React Flow (no labels on them), and the label items it gives the kit.

const box = (x, y, w = 220, h = 64) => ({ x, y, w, h });

describe("the slots", () => {
  it("are the eight side slots the box draws: slot 1 at 30% along the side, slot 2 at 70%, and nothing else", () => {
    const b = box(10, 20, 200, 100);
    expect(slotPoint(b, "l1")).toEqual([10, 50, "left"]);
    expect(slotPoint(b, "l2")).toEqual([10, 90, "left"]);
    expect(slotPoint(b, "r1")).toEqual([210, 50, "right"]);
    expect(slotPoint(b, "r2")).toEqual([210, 90, "right"]);
    expect(slotPoint(b, "t1")).toEqual([70, 20, "top"]);
    expect(slotPoint(b, "t2")).toEqual([150, 20, "top"]);
    expect(slotPoint(b, "b1")).toEqual([70, 120, "bottom"]);
    expect(slotPoint(b, "b2")).toEqual([150, 120, "bottom"]);
    for (const bad of ["x1", "l3", "l", "", undefined, null]) expect(slotPoint(b, bad)).toBeNull();
  });
  it("come from the data's handles when it names them, otherwise the sides that face each other", () => {
    const at = { a: box(0, 0), b: box(500, 0) };
    expect(slots({ source: "a", target: "b", handles: ["l2", "r2"] }, at)).toEqual(["l2", "r2"]);
    expect(slots({ source: "a", target: "b" }, at)).toEqual(["r1", "l1"]);
    expect(slots({ source: "b", target: "a" }, at)).toEqual(["l1", "r1"]);
  });
});

// The two real routes, through the page's own flowEdges (slots and all). Box sizes are estimated here (the browser measures them).
describe("the two real routes", () => {
  const boxesOf = (d) => new Map(d.nodes.map((n) => [n.id, box(n.x, n.y, 220, 56 + 14 * (n.sub?.length ?? 0))]));
  for (const name of ["route-a", "route-b"]) {
    it(`${name}: every label is placed by the kit, and none overlaps another`, () => {
      const d = DIAGRAM_DOCS[name]; const boxes = boxesOf(d); const edges = flowEdges(d, new Set(), false);
      expect(edges.every((e) => e.label === undefined && e.type === "arrow")).toBe(true); // labels come from the kit, not the edge
      const input = edges.filter((e) => DIAGRAM_DOCS[name].edges[Number(e.id.slice(1))].label).map((e, i) => {
        const src = DIAGRAM_DOCS[name].edges[Number(e.id.slice(1))];
        return { id: e.id, text: src.label, from: slotPoint(boxes.get(e.source), e.sourceHandle), to: slotPoint(boxes.get(e.target), e.targetHandle) };
      });
      const placed = placeLabels({ edges: input, boxes: [...boxes.values()] });
      expect(placed.size).toBe(DIAGRAM_DOCS[name].edges.filter((e) => e.label).length);
      expect(placed.size).toBeGreaterThanOrEqual(5);
      expect(labelOverlaps(placed)).toBe(0);
    });
    it(`${name}: the page hands the kit one label item per arrow, with the right text and handles`, () => {
      const d = DIAGRAM_DOCS[name]; const edges = flowEdges(d, new Set(), false);
      const items = toLabelItems(d, edges, new Set(["e0"]));
      expect(items.length).toBe(d.edges.length);
      expect(items[0].text).toBe(d.edges[0].label ?? "");
      expect(items[0].active).toBe(true);
      expect(items[1].dim).toBe(true);
    });
  }
});
