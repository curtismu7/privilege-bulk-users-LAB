import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { afterEach, expect, test, vi } from "vitest";
import { DIAGRAM_DOCS, fakeApi } from "../test-helpers.js";
import Diagram, { flowEdges, slots } from "./Diagram.jsx";
import { PresentProvider } from "../present/Present.jsx";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

// A made-up diagram-studio/1 document: nothing in Diagram.jsx knows these boxes, so anything on screen came from the fetched data.
const doc = (id, title, x2) => ({
  schema: "diagram-studio/1", id, title, groups: { g: { label: "G", color: "dark" } },
  nodes: [{ id: "alpha", label: "Alpha box", group: "g", sub: ["first small line", "second small line"], x: 10, y: 20 }, { id: "beta", label: "Beta box", group: "g", x: x2, y: 20 }, { id: "gamma", label: "Gamma box", group: "g", x: 600, y: 20 }],
  edges: [{ source: "alpha", target: "beta", label: "alpha to beta" }, { source: "beta", target: "alpha", label: "beta back", dashed: true, handles: ["l2", "r2"] }],
  steps: [{ title: "One", what: `First step of ${id}`, edges: [0] }, { title: "Two", what: `Second step of ${id}`, edges: [1] }],
});
const serve = (docs) => ({
  "GET /api/diagrams": (_b, _s, json) => json(200, { diagrams: Object.values(docs).map((d) => ({ name: d.id, title: d.title })) }),
  ...Object.fromEntries(Object.values(docs).map((d) => [`GET /api/diagrams/${d.id}`, (_b, _s, json) => json(200, d)])),
});
const mount = () => render(<PresentProvider><Diagram theme="light" /></PresentProvider>);

test("the diagram is drawn from the fetched data: boxes, small print, arrow labels, step text and the box positions all come from the document", async () => {
  const docs = { one: doc("one", "Model one", 300), two: doc("two", "Model two", 500) };
  const state = fakeApi({ handlers: serve(docs) });
  const user = userEvent.setup();
  mount();
  expect(await screen.findByText("Alpha box")).toBeInTheDocument();
  expect(screen.getByText("Beta box")).toBeInTheDocument();
  expect(screen.getByText("first small line")).toBeInTheDocument();
  expect(screen.getByText("second small line")).toBeInTheDocument();
  expect(screen.queryByText("You (this page)")).toBeNull(); // nothing is hard-coded in the component
  expect(state.calls.map((c) => c.url)).toEqual(["/api/diagrams", "/api/diagrams/one"]); // the list, then the first diagram by name
  expect(within(screen.getByLabelText("Route")).getAllByRole("option").map((o) => o.textContent)).toEqual(["Model one", "Model two"]);
  const at = (label) => screen.getByText(label).closest(".react-flow__node").style.transform.replace(/\s/g, "");
  expect(at("Alpha box")).toContain("translate(10px,20px)");
  expect(at("Beta box")).toContain("translate(300px,20px)");
  await user.click(screen.getByRole("button", { name: "Simulate" }));
  expect(screen.getByTestId("caption")).toHaveTextContent("Step 1 of 2: First step of one");
  expect([...document.querySelectorAll(".fbox")].map((b) => b.dataset.state)).toEqual(["on", "on", "dim"]); // the arrow's two boxes light up, the other dims
  // the second diagram is fetched by its name when chosen
  await user.selectOptions(screen.getByLabelText("Route"), "two");
  await waitFor(() => expect(state.calls.map((c) => c.url)).toContain("/api/diagrams/two"));
  await waitFor(() => expect(screen.getByRole("button", { name: "Simulate" })).toBeEnabled());
  expect(at("Beta box")).toContain("translate(300px,20px)"); // a box stays where it is when the route changes
  expect(screen.getByTestId("caption")).toHaveTextContent(/Press Simulate/);
  await user.click(screen.getByRole("button", { name: "Simulate" }));
  expect(screen.getByTestId("caption")).toHaveTextContent("Step 1 of 2: First step of two");
});

test("a box moves (keyboard drag), stays put when the route changes, and Reset puts it back at the position in the data and clears the walkthrough", async () => {
  fakeApi({ handlers: serve({ one: doc("one", "Model one", 300), two: doc("two", "Model two", 300) }) });
  const user = userEvent.setup();
  mount();
  const at = async () => (await screen.findByText("Alpha box")).closest(".react-flow__node").style.transform.replace(/\s/g, "");
  expect(await at()).toBe("translate(10px,20px)");
  (await screen.findByText("Alpha box")).closest(".react-flow__node").focus();
  await user.keyboard("{Enter}"); await user.keyboard("{Shift>}{ArrowRight}{/Shift}");
  await waitFor(async () => expect(await at()).toBe("translate(30px,20px)")); // moved by 20
  await user.selectOptions(screen.getByLabelText("Route"), "two");
  await waitFor(() => expect(screen.getByRole("button", { name: "Simulate" })).toBeEnabled());
  expect(await at()).toBe("translate(30px,20px)"); // the other route keeps the moved box where it is
  await user.click(screen.getByRole("button", { name: "Simulate" }));
  await user.click(screen.getByRole("button", { name: "Reset" }));
  expect(screen.getByTestId("caption")).toHaveTextContent(/Press Simulate/);
  await waitFor(async () => expect(await at()).toBe("translate(10px,20px)")); // back where the data puts it
});

test("a diagram that does not load shows an alert and no boxes; a missing list does too", async () => {
  fakeApi({ handlers: { "GET /api/diagrams": (_b, _s, json) => json(200, { diagrams: [{ name: "one", title: "Model one" }] }), "GET /api/diagrams/one": (_b, _s, json) => json(404, { error: "unknown_diagram" }) } });
  mount();
  expect(await screen.findByRole("alert")).toHaveTextContent(/Could not load the diagram/);
  expect(document.querySelector(".react-flow__node")).toBeNull();
  expect(screen.getByRole("button", { name: "Simulate" })).toBeDisabled();
  cleanup();
  fakeApi({ handlers: { "GET /api/diagrams": (_b, _s, json) => json(500, { error: "internal_error" }) } });
  mount();
  expect(await screen.findByRole("alert")).toHaveTextContent(/diagram list did not load/);
});

test("edges come from the data: one per edge, no label on the edge (the kit draws labels), dashed only where the data says, the hint or facing slots, and the current step's arrow highlighted", () => {
  const d = doc("one", "Model one", 300);
  const e = flowEdges(d, new Set(["e1"]), true);
  expect(e.map((x) => [x.id, x.source, x.target, x.sourceHandle, x.targetHandle])).toEqual([["e0", "alpha", "beta", "r1", "l1"], ["e1", "beta", "alpha", "l2", "r2"]]);
  expect(e.map((x) => x.type)).toEqual(["arrow", "arrow"]); // the kit's label-free edge
  expect(e.map((x) => x.className)).toEqual(["", "flow__edge--on flow__edge--dashed"]);
  expect(e.map((x) => x.animated)).toEqual([false, true]);
  expect(flowEdges(d, new Set(["e1"]), false).map((x) => x.animated)).toEqual([false, false]); // reduced motion
});

test("slots: a handles hint in the data wins, a malformed hint is ignored, and with no hint the arrow leaves by the side that faces its target", () => {
  const at = { a: { x: 0, y: 0 }, b: { x: 300, y: 10 }, c: { x: 0, y: -200 } };
  expect(slots({ source: "a", target: "b", handles: ["t1", "l2"] }, at)).toEqual(["t1", "l2"]);
  expect(slots({ source: "a", target: "b", handles: ["x9", "l2"] }, at)).toEqual(["r1", "l1"]);
  expect(slots({ source: "a", target: "b" }, at)).toEqual(["r1", "l1"]);
  expect(slots({ source: "b", target: "a" }, at)).toEqual(["l1", "r1"]);
  expect(slots({ source: "a", target: "c" }, at)).toEqual(["t1", "b1"]);
  expect(slots({ source: "c", target: "a" }, at)).toEqual(["b1", "t1"]);
});

test("a late answer for a diagram the visitor has already left is dropped", async () => {
  const docs = { one: doc("one", "Model one", 300), two: doc("two", "Model two", 300) };
  let release;
  const slow = new Promise((r) => { release = r; });
  fakeApi({ handlers: { ...serve(docs), "GET /api/diagrams/two": async (_b, _s, json) => { await slow; return json(200, docs.two); } } });
  const user = userEvent.setup();
  mount();
  await screen.findByText("Alpha box");
  await user.selectOptions(screen.getByLabelText("Route"), "two");
  await user.selectOptions(screen.getByLabelText("Route"), "one");
  release();
  await new Promise((r) => setTimeout(r, 50));
  await waitFor(() => expect(screen.getByRole("button", { name: "Simulate" })).toBeEnabled());
  await user.click(screen.getByRole("button", { name: "Simulate" }));
  expect(screen.getByTestId("caption")).toHaveTextContent("First step of one"); // not "two", which arrived last
});

test("the two real routes are drawn from the server's files: one box per node, the lede, the step text, and Simulate walks every step", async () => {
  const state = fakeApi();
  const user = userEvent.setup();
  mount();
  const a = DIAGRAM_DOCS["route-a"]; const b = DIAGRAM_DOCS["route-b"];
  expect(await screen.findByText("You (this page)")).toBeInTheDocument();
  expect(within(screen.getByLabelText("Route")).getAllByRole("option").map((o) => o.value)).toEqual(["route-a", "route-b"]);
  expect(document.querySelectorAll(".react-flow__node").length).toBe(a.nodes.length);
  for (const n of a.nodes) expect(screen.getByText(n.label)).toBeInTheDocument();
  expect(screen.getByTestId("diagram-lede")).toHaveTextContent(a.lede);
  await user.click(screen.getByRole("button", { name: "Simulate" }));
  expect(screen.getByTestId("caption")).toHaveTextContent(`Step 1 of ${a.steps.length}: ${a.steps[0].what}`);
  await user.selectOptions(screen.getByLabelText("Route"), "route-b");
  await waitFor(() => expect(screen.getByTestId("diagram-lede")).toHaveTextContent(b.lede));
  await waitFor(() => expect(document.querySelectorAll(".react-flow__node").length).toBe(b.nodes.length));
  for (const n of b.nodes) expect(screen.getByText(n.label)).toBeInTheDocument();
  expect(state.calls.map((c) => c.url)).toEqual(["/api/diagrams", "/api/diagrams/route-a", "/api/diagrams/route-b"]);
});

// Code pointers: the boxes may carry `sources` (and the diagram a pinned `repo`); the page lists them under the diagram.
const REV = "c".repeat(40);
const withSources = (repo) => {
  const d = doc("one", "Model one", 300);
  d.nodes[0].sources = [{ path: "server/src/jobs.js", line: 88, end_line: 97, label: "apply gate" }, { path: "server/src/http.js", line: 60 }];
  if (repo) d.repo = repo;
  return d;
};

test("a box's code pointers are listed under the diagram, as links to the pinned commit when the diagram names a GitHub repo", async () => {
  fakeApi({ handlers: serve({ one: withSources({ url: "https://github.com/o/r.git", rev: REV }) }) });
  mount();
  const card = await screen.findByTestId("diagram-sources");
  expect(card).toHaveTextContent("Alpha box: apply gate, server/src/jobs.js:88-97");
  expect(card).toHaveTextContent("Alpha box: server/src/http.js:60");
  expect(card).toHaveTextContent(`Read at commit ${REV.slice(0, 7)}`);
  expect(card).toHaveTextContent(/cannot tell when the code has moved/);
  const links = [...card.querySelectorAll("a")];
  expect(links.map((a) => a.getAttribute("href"))).toEqual([`https://github.com/o/r/blob/${REV}/server/src/jobs.js#L88-L97`, `https://github.com/o/r/blob/${REV}/server/src/http.js#L60`]);
  for (const a of links) expect(a.getAttribute("rel")).toBe("noopener noreferrer");
});

test("code pointers are plain text, never links, when the diagram has no repo or a repo that is not a GitHub https URL", async () => {
  for (const repo of [undefined, { url: "https://gitlab.com/o/r", rev: REV }, { url: "javascript:alert(1)", rev: REV }, { url: "https://github.com/o/r", rev: "abc" }]) {
    fakeApi({ handlers: serve({ one: withSources(repo) }) });
    const { unmount } = mount();
    const card = await screen.findByTestId("diagram-sources");
    expect(card.querySelectorAll("a").length).toBe(0);
    expect(card).toHaveTextContent("server/src/jobs.js:88-97");
    unmount();
  }
});

test("no code-pointer card when no box carries sources", async () => {
  fakeApi({ handlers: serve({ one: doc("one", "Model one", 300) }) });
  mount();
  await screen.findByText("Alpha box");
  expect(screen.queryByTestId("diagram-sources")).toBeNull();
});

test("the real route-a and route-b files show their three code pointers, each linked to the commit the diagram pins", async () => {
  fakeApi({ handlers: serve(DIAGRAM_DOCS) });
  const user = userEvent.setup();
  mount();
  for (const name of ["route-a", "route-b"]) {
    if (name === "route-b") await user.selectOptions(screen.getByLabelText("Route"), "route-b");
    await waitFor(() => expect(screen.getByLabelText("Route")).toHaveValue(name));
    const rev = DIAGRAM_DOCS[name].repo.rev;
    await waitFor(() => expect([...screen.getByTestId("diagram-sources").querySelectorAll("a")].length).toBe(3));
    const hrefs = [...screen.getByTestId("diagram-sources").querySelectorAll("a")].map((a) => a.getAttribute("href"));
    for (const h of hrefs) expect(h).toMatch(new RegExp(`^https://github\\.com/curtismu7/privilege-bulk-users-LAB/blob/${rev}/server/src/[A-Za-z]+\\.js#L\\d+-L\\d+$`));
    expect(screen.getByTestId("diagram-sources")).toHaveTextContent(`Read at commit ${rev.slice(0, 7)}`);
  }
});

// Arrow labels: drawn in a layer above the boxes; the walked arrow's label is marked and raised.
test("every arrow's label is drawn from the data, and during Simulate only the walked arrow's label is marked and raised above the others", async () => {
  const docs = { one: doc("one", "Model one", 300) };
  fakeApi({ handlers: serve(docs) });
  const user = userEvent.setup();
  mount();
  expect(await screen.findByTestId("dk-label-e0")).toHaveTextContent("alpha to beta");
  expect(screen.getByTestId("dk-label-e1")).toHaveTextContent("beta back");
  expect(document.querySelector(".react-flow__viewport-portal").contains(screen.getByTestId("dk-label-e0"))).toBe(true);
  expect(document.querySelectorAll(".dk-label--on").length).toBe(0); // nothing marked before Simulate
  await user.click(screen.getByRole("button", { name: "Simulate" }));
  const on = document.querySelectorAll(".dk-label--on");
  expect(on.length).toBe(1);
  expect(on[0]).toBe(screen.getByTestId("dk-label-e0")); // step 1 walks arrow 0
  expect(on[0].style.zIndex).toBe("3"); expect(screen.getByTestId("dk-label-e1").style.zIndex).toBe("1");
  await user.click(screen.getByRole("button", { name: "Reset" }));
  expect(document.querySelectorAll(".dk-label--on").length).toBe(0);
});

test("the real routes draw every label they have, and an arrow without text draws none", async () => {
  fakeApi({ handlers: serve(DIAGRAM_DOCS) });
  mount();
  await screen.findByTestId("dk-label-e0");
  expect(screen.getAllByTestId(/^dk-label-e/).length).toBe(DIAGRAM_DOCS["route-a"].edges.filter((e) => e.label).length);
  cleanup();
  const bare = doc("bare", "Bare", 300); delete bare.edges[1].label;
  fakeApi({ handlers: serve({ bare }) });
  mount();
  await screen.findByTestId("dk-label-e0");
  expect(screen.queryByTestId("dk-label-e1")).toBeNull();
});
