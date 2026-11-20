import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { DIAGRAM_DOCS, fakeApi } from "../test-helpers.js";
import Diagram from "./Diagram.jsx";
import { PresentProvider } from "../present/Present.jsx";

// React Flow fits the view on a short timer; let it finish before the page is torn down, or it fires into a closed window.
const setHash = (h) => window.history.replaceState(null, "", h || window.location.pathname); // sets the hash WITHOUT a hashchange event, as a fresh page load does
afterEach(async () => { await act(async () => { await new Promise((r) => setTimeout(r, 120)); }); cleanup(); vi.restoreAllMocks(); setHash(""); });
beforeEach(() => { setHash(""); });

const REV = "f".repeat(40);
// A made-up diagram: nothing in Diagram.jsx knows these boxes, so anything on screen came from the document.
const doc = (id, title) => ({
  schema: "diagram-studio/1", id, title, repo: { url: "https://github.com/o/r.git", rev: REV },
  groups: { g: { label: "Group G", color: "dark" } },
  nodes: [
    { id: "alpha", label: "Alpha box", group: "g", sub: ["first small line"], x: 10, y: 20, sources: [{ path: "server/src/jobs.js", line: 88, end_line: 97, label: "apply gate" }] },
    { id: "beta", label: "Beta box", group: "g", x: 400, y: 20 },
    { id: "gamma", label: "Gamma box", group: "g", x: 200, y: 200 },
  ],
  edges: [{ source: "alpha", target: "beta", label: "alpha to beta" }, { source: "beta", target: "gamma", label: "beta to gamma" }, { source: "beta", target: "alpha", label: "beta back" }],
  steps: [{ title: "One", what: `First step of ${id}`, edges: [0] }],
});
const serve = (docs) => ({
  "GET /api/diagrams": (_b, _s, json) => json(200, { diagrams: Object.values(docs).map((d) => ({ name: d.id, title: d.title })) }),
  ...Object.fromEntries(Object.values(docs).map((d) => [`GET /api/diagrams/${d.id}`, (_b, _s, json) => json(200, d)])),
});
const mount = () => render(<PresentProvider><Diagram theme="light" /></PresentProvider>);
const box = (id) => screen.findByTestId(`box-${id}`);
const open = () => [...document.querySelectorAll(".fbox[data-open]")].map((b) => b.getAttribute("data-testid"));

test("nothing is expanded at first; clicking a box expands it in place with its details, and only that box", async () => {
  fakeApi({ handlers: serve({ one: doc("one", "Model one") }) });
  mount();
  const alpha = await box("alpha");
  expect(open()).toEqual([]);
  fireEvent.click(alpha);
  expect(open()).toEqual(["box-alpha"]);
  const p = within(alpha).getByTestId("dk-passport-alpha"); // inside that box
  expect(p).toHaveTextContent("Group G");
  const src = within(p).getByTestId("dk-passport-sources");
  expect(src).toHaveTextContent("o/r @ fffffff"); expect(src).toHaveTextContent("apply gate: server/src/jobs.js:88-97");
  expect(src.querySelector("a").getAttribute("href")).toBe(`https://github.com/o/r/blob/${REV}/server/src/jobs.js#L88-L97`);
  expect(within(p).getByTestId("dk-passport-reach")).toHaveTextContent("Upstream 1 · Downstream 2"); // only beta reaches alpha (gamma has no arrows out); alpha reaches beta and gamma
  expect(within(p).getByTestId("dk-passport-outgoing")).toHaveTextContent("Outgoing · 1"); expect(within(p).getByTestId("dk-passport-outgoing")).toHaveTextContent("Beta box");
  expect(within(p).getByTestId("dk-passport-incoming")).toHaveTextContent("Incoming · 1");
});

test("clicking the open box again collapses it, clicking another box moves the expansion, and the empty canvas collapses it", async () => {
  fakeApi({ handlers: serve({ one: doc("one", "Model one") }) });
  mount();
  fireEvent.click(await box("alpha")); expect(open()).toEqual(["box-alpha"]);
  fireEvent.click(await box("alpha")); expect(open()).toEqual([]);
  fireEvent.click(await box("alpha")); fireEvent.click(await box("beta")); expect(open()).toEqual(["box-beta"]);
  fireEvent.click(document.querySelector(".react-flow__pane")); expect(open()).toEqual([]);
});

test("an item in the lists opens the box at the other end; Close collapses; clicks inside the details do nothing else", async () => {
  fakeApi({ handlers: serve({ one: doc("one", "Model one") }) });
  mount();
  fireEvent.click(await box("alpha"));
  fireEvent.click(screen.getByTestId("dk-passport-reach")); fireEvent.click(screen.getByTestId("dk-passport-sources").querySelector("a"));
  expect(open()).toEqual(["box-alpha"]); // not collapsed by a click inside the details
  fireEvent.click(screen.getByTestId("dk-passport-outgoing").querySelector("button.dk-passport-go")); // by class: jsdom never measures nodes, so React Flow keeps them visibility:hidden
  expect(open()).toEqual(["box-beta"]);
  fireEvent.click(screen.getByTestId("dk-passport-close")); expect(open()).toEqual([]);
});

test("choosing another route collapses the box at once, before the new route has even loaded (a box id means nothing in another route)", async () => {
  let release; const slow = new Promise((r) => { release = r; });
  const docs = { one: doc("one", "Model one"), two: doc("two", "Model two") };
  fakeApi({ handlers: { ...serve(docs), "GET /api/diagrams/two": async (_b, _s, json) => { await slow; return json(200, docs.two); } } });
  mount();
  fireEvent.click(await box("alpha")); expect(open()).toEqual(["box-alpha"]);
  fireEvent.change(screen.getByLabelText("Route"), { target: { value: "two" } });
  expect(open()).toEqual([]); // route two has not arrived: the old route is still drawn, with nothing expanded
  release(); await waitFor(() => expect(screen.getByText(/First step of two|Press Simulate/)).toBeInTheDocument());
});

test("a shared link #/diagram/<route>/<box> opens that route with that box expanded; a bad box or route is ignored", async () => {
  const docs = { one: doc("one", "Model one"), two: doc("two", "Model two") };
  setHash("#/diagram/two/beta");
  fakeApi({ handlers: serve(docs) }); mount();
  await waitFor(() => expect(open()).toEqual(["box-beta"]));
  expect(screen.getByLabelText("Route")).toHaveValue("two");
  cleanup(); setHash("#/diagram/two/ghost"); fakeApi({ handlers: serve(docs) }); mount();
  await box("alpha"); await waitFor(() => expect(screen.getByLabelText("Route")).toHaveValue("two")); expect(open()).toEqual([]);
  cleanup(); setHash("#/diagram/nope/alpha"); fakeApi({ handlers: serve(docs) }); mount();
  await box("alpha"); expect(screen.getByLabelText("Route")).toHaveValue("one"); // the first route
});

test("following a shared link while the page is already showing (only the hash changes) switches route and expands its box", async () => {
  const docs = { one: doc("one", "Model one"), two: doc("two", "Model two") };
  fakeApi({ handlers: serve(docs) }); mount();
  await box("alpha"); expect(screen.getByLabelText("Route")).toHaveValue("one"); expect(open()).toEqual([]);
  await act(async () => { window.location.hash = "#/diagram/two/beta"; window.dispatchEvent(new HashChangeEvent("hashchange")); });
  await waitFor(() => expect(screen.getByLabelText("Route")).toHaveValue("two"));
  await waitFor(() => expect(open()).toEqual(["box-beta"]));
  await act(async () => { window.location.hash = "#/diagram/two/gamma"; window.dispatchEvent(new HashChangeEvent("hashchange")); }); // same route: just the box
  await waitFor(() => expect(open()).toEqual(["box-gamma"]));
  await act(async () => { window.location.hash = "#/diagram/two/ghost"; window.dispatchEvent(new HashChangeEvent("hashchange")); }); // a box that is not there: nothing changes
  expect(open()).toEqual(["box-gamma"]);
});

test("Copy link puts a link that opens this route with this box expanded on the clipboard", async () => {
  const writeText = vi.fn(async () => {});
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  fakeApi({ handlers: serve({ one: doc("one", "Model one") }) });
  mount();
  fireEvent.click(await box("beta"));
  await act(async () => { fireEvent.click(screen.getByTestId("dk-passport-copy")); });
  const url = new URL(writeText.mock.calls[0][0]);
  expect(url.hash).toBe("#/diagram/one/beta"); expect(url.search).toBe("");
  expect(screen.getByTestId("dk-passport-copy")).toHaveTextContent("Copied");
});

test("the real route A: the This lab box shows its three code pointers as links to the commit the diagram pins", async () => {
  fakeApi({ handlers: serve(DIAGRAM_DOCS) });
  mount();
  fireEvent.click(await box("app"));
  const links = [...screen.getByTestId("dk-passport-sources").querySelectorAll("a")];
  expect(links.length).toBe(3);
  for (const a of links) expect(a.getAttribute("href")).toMatch(new RegExp(`^https://github\\.com/curtismu7/privilege-bulk-users-LAB/blob/${DIAGRAM_DOCS["route-a"].repo.rev}/server/src/[A-Za-z]+\\.js#L\\d+-L\\d+$`));
});

test("a box expanded from a shared link (no click, so React Flow has not raised it) is raised above its neighbours, and no other box is", async () => {
  setHash("#/diagram/one/alpha");
  fakeApi({ handlers: serve({ one: doc("one", "Model one") }) });
  mount();
  const z = async (id) => Number((await box(id)).closest(".react-flow__node").style.zIndex);
  await waitFor(() => expect(open()).toEqual(["box-alpha"]));
  expect(await z("alpha")).toBe(10);
  expect(await z("beta")).toBe(0); expect(await z("gamma")).toBe(0);
});
