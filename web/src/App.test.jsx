import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import App from "./App.jsx";
import { setJsonView } from "./components/JsonPane.jsx";
import { fakeApi, infoFor, job, makeRows, resultsOf } from "./test-helpers.js";

beforeEach(() => { setJsonView("form"); window.location.hash = ""; try { localStorage.clear(); } catch { /* none */ } delete document.documentElement.dataset.present; delete document.documentElement.dataset.theme; });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const go = (h) => act(() => { window.location.hash = h; window.dispatchEvent(new HashChangeEvent("hashchange")); });
const PAGES = ["#/guide", "#/run", "#/diagram", "#/audit", "#/help"];

test("skip link, title, nav and modal: the Guide is the front page, Mock the default mode, and the old banner is gone", async () => {
  fakeApi();
  render(<App />);
  expect(screen.getByText("Skip to content")).toHaveAttribute("href", "#main");
  expect(screen.getByText("Privilege Bulk Users LAB")).toBeInTheDocument();
  expect(await screen.findByTestId("guide-page")).toBeInTheDocument();
  for (const [id, label] of [["guide", "Guide"], ["run", "Run"], ["diagram", "Diagram"], ["audit", "Audit"]]) expect(screen.getByTestId(`nav-${id}`)).toHaveTextContent(label);
  expect(screen.getByTestId("nav-guide")).toHaveAttribute("aria-current", "page");
  expect(screen.getByTestId("nav-run")).not.toHaveAttribute("aria-current");
  const modal = await screen.findByTestId("mode-modal");
  expect(modal).toHaveAttribute("data-mode", "mock");
  expect(modal).toHaveTextContent("MOCK");
  expect(modal).toHaveTextContent(/Nothing leaves this machine/);
  expect(modal).toHaveTextContent(/\.example/);
  expect(screen.queryByTestId("banner")).toBeNull();
  expect(document.querySelector("main > .banner, [data-testid=banner]")).toBeNull();
  await userEvent.setup().click(screen.getByTestId("mode-modal-ok"));
  expect(screen.queryByTestId("mode-modal")).toBeNull();
  expect(screen.getByTestId("mode")).toHaveTextContent("Mode: mock");
  expect(screen.getAllByRole("heading", { level: 1 }).length).toBe(1); // one h1 per page; the title in the bar is not a heading
});

test("hash routing: an empty, unknown or nested hash lands on the Guide; each nav link opens its page; the footer and live region exist", async () => {
  fakeApi();
  render(<App />);
  for (const h of ["#/nonsense", "#/", "#"]) { go(h); expect(await screen.findByTestId("guide-page")).toBeInTheDocument(); }
  go("#/run"); expect(await screen.findByTestId("run-page")).toBeInTheDocument();
  expect(screen.getByTestId("nav-run")).toHaveAttribute("aria-current", "page");
  go("#/audit"); expect(await screen.findByTestId("audit-page")).toBeInTheDocument();
  go("#/diagram"); expect(await screen.findByRole("heading", { name: /two routes/i })).toBeInTheDocument();
  go("#/help"); expect(await screen.findByTestId("help-page")).toBeInTheDocument();
  expect(screen.getByRole("contentinfo")).toHaveTextContent(/UNVERIFIED/);
  expect(screen.getByTestId("live")).toHaveAttribute("aria-live", "polite");
});

test("the header toggle, theme, text size, presenter, Shelf, Help and Reset are on every page; the old banner is gone on every page", async () => {
  fakeApi();
  render(<App />);
  for (const h of PAGES) {
    go(h);
    await waitFor(() => expect(screen.getByTestId("nav-guide")).toBeInTheDocument());
    for (const id of ["mode-select", "theme-select", "font-select", "presenter", "shelf-link", "help-link", "reset", "mode"]) expect(screen.getByTestId(id), `${id} on ${h}`).toBeInTheDocument();
    expect(screen.queryByTestId("banner"), h).toBeNull();
    expect(screen.queryByTestId("writes-notice"), h).toBeNull(); // Mock: no writes notice
  }
});

test("Real refused: the option is disabled with the server's reason, the page stays in Mock, and nothing is posted", async () => {
  const state = fakeApi();
  render(<App />);
  const real = await screen.findByTestId("mode-real");
  await waitFor(() => expect(real).toBeDisabled());
  expect(real).toHaveAttribute("title", expect.stringContaining("Real is refused: owner-opt-in"));
  expect(screen.getByTestId("mode")).toHaveTextContent("Mode: mock");
  expect(state.calls.some((c) => c.url === "/api/mode")).toBe(false);
});

test("Real allowed: the toggle posts {source: real}, re-reads info, the modal and the chip follow with REAL, writes are shown off, and switching back works", async () => {
  const state = fakeApi({ realAvailable: true });
  const user = userEvent.setup();
  render(<App />);
  await waitFor(() => expect(screen.getByTestId("mode-real")).toBeEnabled());
  await user.click(await screen.findByTestId("mode-modal-ok")); // the MOCK modal, dismissed
  await user.selectOptions(screen.getByTestId("mode-select"), "real");
  await waitFor(() => expect(screen.getByTestId("mode")).toHaveTextContent("Mode: real"));
  expect(state.calls.find((c) => c.url === "/api/mode").body).toEqual({ source: "real" });
  expect(state.count("GET", "/api/info")).toBe(2);
  const modal = await screen.findByTestId("mode-modal");
  expect(modal).toHaveAttribute("data-mode", "real");
  expect(modal).toHaveTextContent("REAL");
  expect(modal).toHaveTextContent(/Owner-run/);
  expect(modal).toHaveTextContent(/Writes stay off until you turn the Writes switch on/);
  expect(screen.getByTestId("writes-notice")).toHaveTextContent(/Writes are off/);
  expect(localStorage.getItem("pbu.mode")).toBeNull(); // nothing about the mode is remembered
  await user.selectOptions(screen.getByTestId("mode-select"), "mock");
  await waitFor(() => expect(screen.getByTestId("mode")).toHaveTextContent("Mode: mock"));
  expect(screen.queryByTestId("mode-modal")).toBeNull(); // MOCK was dismissed earlier in this session, so switching back shows nothing new
  expect(screen.queryByTestId("writes-notice")).toBeNull();
});

test("a switch the server refuses (409) is shown as the server's own message and the page stays in Mock", async () => {
  fakeApi({ realAvailable: true, handlers: { "POST /api/mode": (_b, _s, json) => json(409, { error: "real_not_available", message: "Real is refused: the bind is not loopback." }) } });
  const user = userEvent.setup();
  render(<App />);
  await waitFor(() => expect(screen.getByTestId("mode-real")).toBeEnabled());
  await user.selectOptions(screen.getByTestId("mode-select"), "real");
  expect(await screen.findByTestId("refusal")).toHaveTextContent("Real is refused: the bind is not loopback.");
  expect(screen.getByTestId("mode")).toHaveTextContent("Mode: mock");
});

test("Real with writes enabled: the writes notice raises an alert and the modal says REAL", async () => {
  const state = fakeApi({ realAvailable: true, info: infoFor("real", true) });
  state.writes = true;
  render(<App />);
  go("#/audit");
  const writes = await screen.findByTestId("writes-notice");
  expect(writes).toHaveTextContent(/WRITES ARE ENABLED/);
  expect(writes).toHaveAttribute("role", "alert");
  expect(screen.queryByTestId("banner")).toBeNull();
  expect(screen.getByTestId("mode")).toHaveTextContent("Mode: real");
  await waitFor(() => expect(screen.getByTestId("mode-modal")).toHaveAttribute("data-mode", "real"));
});

test("a server that starts in Real: the modal says MOCK until /api/info answers, then REAL (the earlier MOCK does not block it)", async () => {
  let release;
  const held = new Promise((r) => { release = r; });
  fakeApi({ realAvailable: true, handlers: { "GET /api/info": (_b, _s, json) => held.then(() => json(200, infoFor("real", true))) } });
  render(<App />);
  expect(await screen.findByTestId("mode-modal")).toHaveAttribute("data-mode", "mock");
  release();
  await waitFor(() => expect(screen.getByTestId("mode-modal")).toHaveAttribute("data-mode", "real"));
  expect(screen.getByTestId("mode-modal")).toHaveTextContent("REAL");
  expect(screen.getByTestId("mode")).toHaveTextContent("Mode: real");
});

test("presenter mode keeps the header (the modal is not shown again in the same session); the settings are stored under pbu.* and no old key is written", async () => {
  fakeApi();
  const user = userEvent.setup();
  render(<App />);
  await user.click(await screen.findByTestId("mode-modal-ok"));
  await user.click(screen.getByTestId("presenter"));
  expect(document.documentElement.dataset.present).toBe("1");
  expect(screen.getByRole("region", { name: "Presenter controls" })).toBeInTheDocument(); // a landmark, not a bare toolbar
  expect(screen.getAllByRole("button", { name: /exit/i }).length).toBe(1); // one Exit control (the header button), not two
  expect(screen.getByTestId("presenter")).toHaveTextContent("Exit present");
  expect(screen.queryByTestId("mode-modal")).toBeNull();
  expect(screen.getByTestId("reset")).toBeInTheDocument();
  expect(localStorage.getItem("pbu.present")).toBe("1");
  await user.selectOptions(screen.getByTestId("theme-select"), "dark");
  await user.selectOptions(screen.getByTestId("font-select"), "L");
  expect(document.documentElement.dataset.theme).toBe("dark");
  expect(localStorage.getItem("pbu.theme")).toBe("dark");
  expect(localStorage.getItem("pbu.font")).toBe("L");
  const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i));
  expect(keys.filter((k) => !k.startsWith("pbu."))).toEqual([]);
});

test("Reset from the header posts, re-reads info, says what it did, and starts the page over (the job, the polling and the typed fields)", async () => {
  const state = fakeApi({ job: job() });
  const user = userEvent.setup();
  render(<App />);
  go("#/run");
  expect(await screen.findByTestId("job-state")).toHaveTextContent("done");
  await user.clear(screen.getByTestId("concurrency-input"));
  await user.type(screen.getByTestId("concurrency-input"), "12");
  expect(screen.getByTestId("concurrency-input")).toHaveValue(12);
  const infoCalls = state.count("GET", "/api/info");
  await user.click(screen.getByTestId("reset"));
  await waitFor(() => expect(state.calls.some((c) => c.method === "POST" && c.url === "/api/reset")).toBe(true));
  await waitFor(() => expect(state.count("GET", "/api/info")).toBe(infoCalls + 1));
  await waitFor(() => expect(screen.queryByTestId("job-state")).toBeNull()); // the server has no job now
  await waitFor(() => expect(screen.getByTestId("concurrency-input")).toHaveValue(6)); // back to the default
  expect(screen.getByTestId("live")).toHaveTextContent(/^Reset:/);
});

test("Reset stops a running job's polling", async () => {
  const state = fakeApi({ job: job({ state: "running", phase: "reading the source", processed: 10, finishedAt: null, planId: null }) });
  const user = userEvent.setup();
  render(<App />);
  go("#/run");
  await waitFor(() => expect(state.count("GET", "/api/jobs/current")).toBeGreaterThanOrEqual(3)); // the load, then polls
  await user.click(screen.getByTestId("reset"));
  await waitFor(() => expect(screen.queryByTestId("job-state")).toBeNull());
  await new Promise((r) => setTimeout(r, 150));
  const after = state.count("GET", "/api/jobs/current");
  await new Promise((r) => setTimeout(r, 1000));
  expect(state.count("GET", "/api/jobs/current")).toBe(after);
});

test("an unreachable server is a named message, not a blank page", async () => {
  globalThis.fetch = vi.fn(() => Promise.reject(new TypeError("fetch failed")));
  render(<App />);
  go("#/run");
  const pane = await screen.findByTestId("error-pane");
  expect(pane).toHaveTextContent("unreachable");
  expect(pane).toHaveTextContent("This app's server is not reachable.");
  expect(screen.getByTestId("plan-btn")).toBeDisabled();
});

test("the Help page lists the Real setting names (never values), the two-step gate, and links to the UNVERIFIED list", async () => {
  fakeApi();
  const user = userEvent.setup();
  render(<App />);
  await user.click(await screen.findByTestId("help-link"));
  const help = await screen.findByTestId("help-page");
  for (const name of ["PRIVILEGE_BULK_MODE", "BULK_P1_REGION", "BULK_P1_SOURCE_ENV_ID", "BULK_P1_PRIVILEGE_ENV_ID", "BULK_P1_WORKER_CLIENT_ID", "BULK_P1_WORKER_CLIENT_SECRET", "BULK_P1_GROUP", "BULK_CONSOLE_URL", "BULK_CONSOLE_TENANT", "BULK_CONSOLE_API_KEY", "BULK_CONSOLE_API_SECRET"]) expect(within(help).getByText(name)).toBeInTheDocument();
  expect(help).toHaveTextContent(/npm ci && npm run build && npm start/);
  expect(help).toHaveTextContent(/docker compose up --build -d/);
  expect(help).toHaveTextContent(/mode 600/);
  expect(help).toHaveTextContent(/REGISTER N/);
  expect(within(help).getByTestId("unverified-link")).toHaveAttribute("href", "#/guide");
  expect(help).not.toHaveTextContent(/BULK_P1_WORKER_CLIENT_SECRET=/); // names only, no assignment
});

test("Audit: entries render as text rows, a row opens as JSON, and a failing read is a named error", async () => {
  fakeApi({ audit: [{ at: "2026-11-12T01:00:00Z", op: "apply", route: "a", outcome: "ok", counts: { created: 2 } }, { at: "2026-11-12T00:59:00Z", op: "plan", route: "b", outcome: "done" }] });
  const user = userEvent.setup();
  render(<App />);
  go("#/audit");
  await screen.findByTestId("audit-table");
  const rows = screen.getAllByTestId("audit-row");
  expect(rows.length).toBe(2);
  expect(rows[0]).toHaveTextContent("apply");
  expect(rows[0]).toHaveTextContent("a");
  expect(rows[1]).toHaveTextContent("plan");
  await user.click(within(rows[0]).getByRole("button", { name: /Details for entry 1/ }));
  const detail = screen.getByTestId("audit-detail");
  expect(within(detail).getByTestId("audit-json")).toHaveTextContent(/outcome/); // Formatted (the default): a label per field
  await user.click(within(detail).getByTestId("audit-json-raw"));
  expect(within(detail).getByTestId("audit-json")).toHaveTextContent(/"outcome"/); // Raw: the exact JSON text
  cleanup();
  fakeApi({ handlers: { "GET /api/audit": (_b, _s, json) => json(500, { error: "internal_error", message: "The audit log could not be read." }) } });
  render(<App />);
  go("#/audit");
  expect(await screen.findByTestId("audit-error")).toHaveTextContent("internal_error");
  expect(screen.getByTestId("audit-error")).toHaveTextContent("The audit log could not be read.");
});

test("hostile text from the server never becomes markup, in the audit, the scenario description and the error pane", async () => {
  const hostile = "<img src=x onerror=alert(1)>";
  fakeApi({
    audit: [{ at: hostile, op: "<script>bad()</script>", route: hostile, outcome: "ok" }],
    info: infoFor("mock", false, { mock: { scenarios: [{ id: "realistic", label: hostile, description: "<script>bad()</script>" }], datasets: [100] } }),
    handlers: { "POST /api/plan": (_b, _s, json) => json(409, { error: "job_running", message: hostile }) },
  });
  const user = userEvent.setup();
  render(<App />);
  go("#/audit");
  await screen.findByTestId("audit-table");
  expect(document.querySelector("img")).toBeNull();
  expect(document.querySelector("script")).toBeNull();
  go("#/run");
  await waitFor(() => expect(screen.getByTestId("plan-btn")).toBeEnabled());
  expect(screen.getByTestId("scenario-desc")).toHaveTextContent("<script>bad()</script>");
  await user.click(screen.getByTestId("plan-btn"));
  expect(await screen.findByTestId("error-pane")).toHaveTextContent(hostile);
  expect(document.querySelector("img")).toBeNull();
  expect(document.querySelector("script")).toBeNull();
});

test("Reset from the header also puts a moved diagram box back where the data has it", async () => {
  fakeApi();
  const user = userEvent.setup();
  render(<App />);
  go("#/diagram");
  const at = () => screen.getByText("You (this page)").closest(".react-flow__node").style.transform.replace(/\s/g, "");
  await screen.findByText("You (this page)");
  const start = at();
  screen.getByText("You (this page)").closest(".react-flow__node").focus();
  await user.keyboard("{Enter}"); await user.keyboard("{Shift>}{ArrowRight}{/Shift}");
  await waitFor(() => expect(at()).not.toBe(start));
  await user.click(screen.getByTestId("reset"));
  await waitFor(() => expect(at()).toBe(start));
});

const shelfLink = () => screen.getByTestId("shelf-link");
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); }); // let the page's requests answer, inside act

test("the Shelf button points where the server says (GET /api/shelf), and falls back to the family default only on null or an unreadable answer", async () => {
  fakeApi({ handlers: { "GET /api/shelf": (_b, _s, json) => json(200, { shelfUrl: "https://shelf.example:8443" }) } });
  render(<App />);
  await waitFor(() => expect(shelfLink()).toHaveAttribute("href", "https://shelf.example:8443"));
  cleanup();
  const state = fakeApi(); // the default answer is { shelfUrl: null }
  render(<App />);
  await waitFor(() => expect(state.calls.some((c) => c.url === "/api/shelf")).toBe(true));
  await settle();
  expect(shelfLink()).toHaveAttribute("href", "https://local.ping-devops.com:8443/");
  cleanup();
  fakeApi({ handlers: { "GET /api/shelf": (_b, _s, json) => json(500, { error: "internal_error", message: "no" }) } });
  render(<App />);
  await settle();
  expect(shelfLink()).toHaveAttribute("href", "https://local.ping-devops.com:8443/");
  cleanup();
  globalThis.fetch = vi.fn(() => Promise.reject(new TypeError("fetch failed"))); // server down: the button is still there
  render(<App />);
  await settle();
  expect(shelfLink()).toHaveAttribute("href", "https://local.ping-devops.com:8443/");
});

test("after a route change focus goes to the new page's heading; the first render and a same-page hash do not move it", async () => {
  fakeApi();
  render(<App />);
  await screen.findByTestId("guide-page");
  await userEvent.setup().click(screen.getByTestId("mode-modal-ok")); // the open modal autofocuses Got it; close it first
  expect(document.body).toHaveFocus();
  go("#/run");
  await screen.findByTestId("run-page");
  expect(screen.getByRole("heading", { level: 1 })).toHaveFocus();
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Run: register people");
  screen.getByTestId("nav-guide").focus();
  go("#/run"); // same page again: focus stays where the reader put it
  expect(screen.getByTestId("nav-guide")).toHaveFocus();
  go("#/help");
  await screen.findByTestId("help-page");
  expect(screen.getByRole("heading", { level: 1 })).toHaveFocus();
});

test("when Real is not available the reason is visible text on the Run and Help pages (the server's own words), and gone when it is available", async () => {
  fakeApi({ info: infoFor("mock", false, { realReason: "Real is refused: owner-opt-in. Set PRIVILEGE_BULK_MODE=real in this lab's own .env.", real: { available: false, failed: ["owner-opt-in"], needs: ["PRIVILEGE_BULK_MODE=real is set in this lab's own .env", "the bind is loopback"] } }) });
  render(<App />);
  go("#/run");
  let reason = await screen.findByTestId("real-reason");
  expect(reason).toHaveTextContent("Real mode is not available on this machine.");
  expect(reason).toHaveTextContent("Real is refused: owner-opt-in.");
  expect(reason).toHaveTextContent("What it needs:");
  expect(within(reason).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["PRIVILEGE_BULK_MODE=real is set in this lab's own .env", "the bind is loopback"]);
  expect(reason).toHaveTextContent(/Mock works fully without it/);
  go("#/help");
  reason = await screen.findByTestId("real-reason");
  expect(reason).toHaveTextContent("Real is refused: owner-opt-in.");
  cleanup();
  // a need the reason already says is not repeated; with nothing left there is no list at all
  fakeApi({ info: infoFor("mock", false, { realReason: "Real is refused: owner-opt-in. PRIVILEGE_BULK_MODE=real is not set.", real: { available: false, failed: ["owner-opt-in"], needs: ["PRIVILEGE_BULK_MODE=real is not set."] } }) });
  render(<App />);
  go("#/run");
  reason = await screen.findByTestId("real-reason");
  expect(reason).toHaveTextContent("PRIVILEGE_BULK_MODE=real is not set.");
  expect(within(reason).queryByRole("listitem")).toBeNull();
  expect(reason).not.toHaveTextContent("What it needs:");
  cleanup();
  fakeApi({ realAvailable: true });
  render(<App />);
  go("#/run");
  await screen.findByTestId("run-page");
  await waitFor(() => expect(screen.getByTestId("mode-real")).toBeEnabled());
  expect(screen.queryByTestId("real-reason")).toBeNull();
  go("#/help");
  await screen.findByTestId("help-page");
  expect(screen.queryByTestId("real-reason")).toBeNull();
});

test("the Help page says that Mock shortens its waits", async () => {
  fakeApi();
  render(<App />);
  go("#/help");
  expect(await screen.findByTestId("help-page")).toHaveTextContent(/Mock waits only a small fraction of the real time[\s\S]*much shorter than a real run would wait/);
});

test("a server error code or count key of __proto__ (and constructor) does not blank the page: lookups use own keys only", async () => {
  const proto = (code) => JSON.parse(`{"error":"${code}","message":"refused as ${code}"}`);
  fakeApi({ handlers: { "POST /api/plan": (_b, _s, json) => json(409, proto("__proto__")) } });
  const user = userEvent.setup();
  render(<App />);
  go("#/run");
  await waitFor(() => expect(screen.getByTestId("plan-btn")).toBeEnabled());
  await user.click(screen.getByTestId("plan-btn"));
  expect(await screen.findByTestId("error-pane")).toHaveTextContent("__proto__: refused as __proto__");
  expect(screen.queryByTestId("page-crash")).toBeNull();
  cleanup();
  const odd = job({ counts: JSON.parse('{"__proto__":3,"constructor":4,"toString":5,"toApply":0}'), error: null });
  fakeApi({ job: odd, handlers: { "GET /api/jobs/current/results": resultsOf(makeRows(3, ["__proto__", "constructor", "hasOwnProperty"])) } });
  render(<App />);
  go("#/run");
  const counts = await screen.findByTestId("counts");
  expect(within(counts).getByTestId("count-__proto__")).toHaveTextContent("3 __proto__");
  expect(within(counts).getByTestId("count-constructor")).toHaveTextContent("4 constructor");
  expect(within(counts).getByTestId("count-toString")).toHaveTextContent("5 toString");
  expect(await screen.findByTestId("results-table")).toBeInTheDocument();
  expect(screen.getByTestId("status-filter-__proto__")).toBeInTheDocument();
  expect(screen.queryByTestId("page-crash")).toBeNull();
  cleanup();
  fakeApi({ job: job({ state: "failed", planId: null, counts: {}, error: JSON.parse('{"code":"constructor","message":"x"}') }) });
  render(<App />);
  go("#/run");
  expect(await screen.findByTestId("error-pane")).toHaveTextContent("constructor: x");
  expect(screen.queryByTestId("page-crash")).toBeNull();
});

test("a page that cannot be drawn shows a named message and leaves the header, the modal and other pages working", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  fakeApi({ job: job({ warnings: { length: 1 } }) }); // warnings.map is not a function: the page throws while rendering
  const user = userEvent.setup();
  render(<App />);
  go("#/run");
  const crash = await screen.findByTestId("page-crash");
  expect(crash).toHaveAttribute("role", "alert");
  expect(crash).toHaveTextContent("This page could not be drawn");
  expect(screen.getByTestId("mode-modal")).toHaveAttribute("data-mode", "mock");
  expect(screen.getByTestId("mode-select")).toBeInTheDocument();
  go("#/guide"); // leaving the broken page clears the message
  expect(await screen.findByTestId("guide-page")).toBeInTheDocument();
  expect(screen.queryByTestId("page-crash")).toBeNull();
  go("#/run");
  await screen.findByTestId("page-crash");
  await user.click(screen.getByTestId("reset")); // Reset starts the page over (and the server has no job now)
  await waitFor(() => expect(screen.queryByTestId("page-crash")).toBeNull());
  expect(await screen.findByTestId("run-page")).toBeInTheDocument();
});
