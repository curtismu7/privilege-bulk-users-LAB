import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { afterEach, expect, test, vi } from "vitest";
import Guide, { PLACEHOLDERS, UNVERIFIED } from "./Guide.jsx";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const clipboard = (value) => Object.defineProperty(navigator, "clipboard", { configurable: true, value });
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

test("the page has its eight sections in order, with the owner's title", () => {
  render(<Guide />);
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Register users for Privilege with APIs");
  const ids = [...document.querySelectorAll("[data-testid^=section-]")].map((s) => s.dataset.testid.replace("section-", ""));
  expect(ids).toEqual(["why", "model", "routes", "route-a", "scale", "route-b", "try", "unverified"]);
  const kickers = [...document.querySelectorAll(".section-label")].map((k) => k.textContent);
  expect(kickers).toEqual(["1 · Why not by hand", "2 · How Privilege knows a user", "3 · Two routes", "4 · Route A, step by step", "5 · Doing it at scale", "6 · Route B", "7 · Try it", "8 · What we have not verified"]);
  const why = screen.getByTestId("section-why");
  for (const need of ["Repeatable", "Idempotent", "Reportable", "Rate-limit aware"]) expect(within(why).getByText(need)).toBeInTheDocument();
  expect(screen.getByTestId("section-model")).toHaveTextContent(/only knows the users of its own PingOne environment who are members of the Privilege group/);
  expect(screen.getByTestId("section-model")).toHaveTextContent(/same email, username and name; the default population; no password/);
  for (const h2 of screen.getAllByRole("heading", { level: 2 })) expect(h2.textContent.length).toBeGreaterThan(5);
});

test("the two routes are compared, with the evidence level of each", () => {
  render(<Guide />);
  const rows = within(screen.getByTestId("routes-table")).getAllByRole("row").slice(1);
  expect(rows.length).toBe(2);
  expect(rows[0]).toHaveTextContent("A: PingOne API");
  expect(rows[0]).toHaveTextContent("From our own working script");
  expect(rows[1]).toHaveTextContent("B: Privilege console API");
  expect(rows[1]).toHaveTextContent("POST /api/{tenant}/v1/users");
  expect(rows[1]).toHaveTextContent("UNVERIFIED against a real console");
  expect(screen.getByTestId("section-routes")).toHaveTextContent(/Use it when/);
});

test("Route A has steps 0 to 7; each call step has a curl block with a Copy button and a JSON excerpt", () => {
  render(<Guide />);
  const steps = [...document.querySelectorAll("[data-testid^=step-]")];
  expect(steps.map((s) => s.dataset.testid)).toEqual(Array.from({ length: 8 }, (_, i) => `step-${i}`));
  const titles = steps.map((s) => s.querySelector("h3").textContent);
  expect(titles).toEqual(["Step 0: Prerequisites", "Step 1: Get a token", "Step 2: Find the group and the default population", "Step 3: Read the source people", "Step 4: Snapshot the destination once and match", "Step 5: Create what is missing, with no password", "Step 6: Add them to the group, per person", "Step 7: Verify by planning again"]);
  expect(steps[0]).toHaveTextContent(/Identity Data Admin/);
  expect(steps[0]).toHaveTextContent(/empty user lists, not a 403/);
  expect(within(steps[3]).getAllByText(/_links\.next/, { selector: "code" }).length).toBeGreaterThanOrEqual(1);
  expect(steps[3]).toHaveTextContent(/caps a page at 100/);
  expect(steps[4]).toHaveTextContent(/PingOne usernames are case-insensitive/);
  expect(steps[5]).toHaveTextContent(/send no password/);
  expect(steps[6]).toHaveTextContent(/memberOfGroups/);
  expect(steps[6]).toHaveTextContent(/group-centric/);
  expect(steps[6]).toHaveTextContent(/404/);
  for (const n of [1, 2, 3, 4, 5, 6, 7]) {
    expect(within(steps[n]).getAllByTestId("code-block").length, `step ${n} code`).toBeGreaterThanOrEqual(1);
    expect(within(steps[n]).getAllByTestId("copy-btn").length, `step ${n} copy`).toBeGreaterThanOrEqual(1);
    expect(steps[n].querySelectorAll("[data-testid^=json-]").length, `step ${n} json`).toBeGreaterThanOrEqual(1);
  }
  expect(within(steps[1]).getByTestId("code-block")).toHaveTextContent("grant_type=client_credentials");
  expect(within(steps[6]).getByTestId("code-block")).toHaveTextContent("/users/$USER_ID/memberOfGroups");
});

test("the commands use $PLACEHOLDER variables only: every variable is a documented one, and no id, tenant or real host is on the page", () => {
  render(<Guide />);
  const allowed = new Set(PLACEHOLDERS.map(([n]) => n));
  for (const n of ["REGION", "SRC_ENV", "DST_ENV", "TOKEN", "GROUP_ID", "POP_ID", "USER_ID"]) expect(allowed.has(n), n).toBe(true);
  const used = new Set();
  for (const block of screen.getAllByTestId("code-block")) for (const m of block.textContent.matchAll(/\$([A-Za-z_][A-Za-z0-9_]*)/g)) used.add(m[1]);
  for (const v of used) expect(allowed.has(v), `$${v} is not a documented placeholder`).toBe(true);
  for (const n of ["REGION", "SRC_ENV", "DST_ENV", "TOKEN", "GROUP_ID", "POP_ID", "USER_ID"]) expect(used.has(n), `$${n} is used`).toBe(true);
  const hosts = new Set(screen.getAllByTestId("code-block").flatMap((b) => [...b.textContent.matchAll(/https?:\/\/([^/\s"']+)/g)].map((m) => m[1])));
  expect([...hosts].sort()).toEqual(["api.pingone.$REGION", "auth.pingone.$REGION"]);
  const page = screen.getByTestId("guide-page").textContent;
  expect(page).not.toMatch(UUID);
  expect(page).not.toMatch(/Bearer [A-Za-z0-9._-]{20,}/);
  const kinds = [...document.querySelectorAll("[data-testid^=json-][data-testid$=-pre]")].map((p) => p.textContent).join("\n");
  expect(kinds).not.toMatch(UUID);
});

test("every JSON excerpt goes through the shared JsonView (a Colored/Raw toggle on each pane)", () => {
  render(<Guide />);
  const panes = [...document.querySelectorAll("[data-testid^=json-][data-testid$=-pre]")];
  expect(panes.length).toBe(10);
  for (const pre of panes) expect(document.querySelector(`[data-testid=${pre.dataset.testid.replace(/-pre$/, "-toggle")}]`), pre.dataset.testid).not.toBeNull();
  expect(document.querySelectorAll("pre").length).toBe(panes.length + screen.getAllByTestId("code-block").length); // no other pre: curl blocks and JsonView only
  const body = screen.getByTestId("json-route-b-pre");
  for (const key of ["ObjectMeta", "Spec", "UserName", "EmailID", "FirstName", "LastName", "FullName", "Active"]) expect(body).toHaveTextContent(`"${key}"`);
});

test("Copy writes the command to the clipboard and says so", async () => {
  const writeText = vi.fn(() => Promise.resolve());
  clipboard({ writeText });
  render(<Guide />);
  const block = screen.getAllByTestId("code-block")[0];
  fireEvent.click(within(block).getByTestId("copy-btn"));
  await waitFor(() => expect(within(block).getByTestId("copy-state")).toHaveTextContent("Copied."));
  expect(writeText).toHaveBeenCalledWith(block.querySelector("code").textContent);
  expect(writeText.mock.calls[0][0]).toMatch(/^curl /);
});

test("Copy works without a clipboard: no error, the text is selected and the page says to copy by hand", async () => {
  clipboard(undefined);
  render(<Guide />);
  const block = screen.getAllByTestId("code-block")[1];
  fireEvent.click(within(block).getByTestId("copy-btn"));
  await waitFor(() => expect(within(block).getByTestId("copy-state")).toHaveTextContent(/Copying is not available here/));
  expect(window.getSelection().toString()).toBe(block.querySelector("code").textContent);
  clipboard({ writeText: () => Promise.reject(new Error("denied")) }); // a refused clipboard (no permission) is the same
  cleanup();
  render(<Guide />);
  const again = screen.getAllByTestId("code-block")[0];
  fireEvent.click(within(again).getByTestId("copy-btn"));
  await waitFor(() => expect(within(again).getByTestId("copy-state")).toHaveTextContent(/Copying is not available here/));
});

test("the scale section names each practice and where its number is on the Run page", () => {
  render(<Guide />);
  const rows = within(screen.getByTestId("scale-table")).getAllByRole("row").slice(1);
  expect(rows.map((r) => r.querySelector("th").textContent)).toEqual(["Bounded concurrency", "Back off on 429", "Retry the 404 right after create", "Idempotent: a re-run is safe", "Dry run first", "One bad person never stops the run", "Stop on purpose", "Keep a report", "Conflicts are a human decision"]);
  const where = Object.fromEntries(rows.map((r) => [r.querySelector("th").textContent, r.querySelectorAll("td")[1].textContent]));
  expect(where["Back off on 429"]).toMatch(/429 answers/);
  expect(where["Back off on 429"]).toMatch(/Waited/);
  expect(where["Retry the 404 right after create"]).toMatch(/Retries/);
  expect(where["Stop on purpose"]).toMatch(/circuit_open/);
  expect(where["Conflicts are a human decision"]).toMatch(/conflict count/);
  expect(screen.getByTestId("section-scale")).toHaveTextContent(/UNVERIFIED/);
});

test("Route B shows the body shape, the three auth headers and what is UNVERIFIED", () => {
  render(<Guide />);
  const b = screen.getByTestId("section-route-b");
  for (const h of ["x-api-key", "x-api-secret", "x-procyon-session-id"]) expect(within(b).getAllByText(h, { selector: "code" }).length).toBeGreaterThanOrEqual(1);
  expect(b).toHaveTextContent(/UNVERIFIED against a real console/);
  expect(b).toHaveTextContent(/Which ObjectMeta fields the console requires/);
  expect(b).toHaveTextContent(/whether a person created this way can sign in: UNVERIFIED/i);
  expect(b).toHaveTextContent(/no endpoint that generates an onboarding link and no inbound SCIM server/);
});

test("Try it: a prominent link to the Run page and one sentence on what Mock simulates", () => {
  render(<Guide />);
  const link = screen.getByTestId("try-it");
  expect(link).toHaveAttribute("href", "#/run");
  expect(link.className).toBe("cta");
  expect(screen.getByTestId("section-try")).toHaveTextContent(/Mock simulates PingOne and the Privilege console with made-up people/);
});

test("the UNVERIFIED list on the page is the one in docs/references.md, item for item", () => {
  render(<Guide />);
  const md = fs.readFileSync(path.join(root, "docs", "references.md"), "utf8");
  const section = md.split(/^## UNVERIFIED.*$/m)[1].split(/^## /m)[0];
  const expected = section.split("\n").filter((l) => l.startsWith("- ")).map((l) => l.slice(2).replaceAll("`", "").trim());
  expect(expected.length).toBeGreaterThanOrEqual(7);
  const shown = within(screen.getByTestId("unverified-list")).getAllByRole("listitem").map((li) => li.textContent.trim());
  expect(shown).toEqual(expected);
  expect(UNVERIFIED.map((t) => t.replaceAll("`", ""))).toEqual(expected);
  expect(screen.getByTestId("section-unverified")).toHaveTextContent(/The first Real run is the owner's/);
});

test("the Route A text is accurate about what the lab reads and where each step comes from", () => {
  render(<Guide />);
  const steps = [...document.querySelectorAll("[data-testid^=step-]")];
  // steps 3 and 7 read 100 a page, the same number
  expect(within(steps[3]).getByTestId("code-block")).toHaveTextContent("users?limit=100");
  expect(within(steps[7]).getAllByTestId("code-block")[0]).toHaveTextContent("memberOfGroups?limit=100");
  for (const block of screen.getAllByTestId("code-block")) expect(block.textContent).not.toMatch(/limit=200/);
  // step 4: users are listed once, but an existing person still costs a memberOfGroups read
  expect(steps[4]).toHaveTextContent(/every person who already exists in Privilege's environment costs one memberOfGroups read/);
  expect(steps[4]).not.toHaveTextContent(/instead of one filtered lookup per person/);
  // the sources do not overclaim
  const route = screen.getByTestId("section-route-a");
  expect(route).toHaveTextContent("steps 0 to 6 follow a sync script we run ourselves");
  expect(route).toHaveTextContent("The snapshot design, the choice of 100 a page and treating a 409 on the group add as success are this lab's own design.");
  expect(route).not.toHaveTextContent(/Source for every step of Route A/);
  expect(steps[6]).toHaveTextContent(/409 on the add as success/);
  expect(screen.getByTestId("section-model")).toHaveTextContent("our SE setup guide for Privilege");
  expect(screen.getByTestId("guide-page")).not.toHaveTextContent("Ping's setup guide");
});
