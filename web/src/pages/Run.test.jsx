import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import App from "../App.jsx";
import { setJsonView } from "../components/JsonPane.jsx";
import { applyJob, fakeApi, infoFor, job, makeRows, resultsOf } from "../test-helpers.js";

beforeEach(() => { setJsonView("form"); window.location.hash = ""; try { localStorage.clear(); } catch { /* none */ } delete document.documentElement.dataset.present; });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const go = (h) => act(() => { window.location.hash = h; window.dispatchEvent(new HashChangeEvent("hashchange")); });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const running = (over = {}) => job({ state: "running", phase: "reading the source", processed: 40, total: 100, finishedAt: null, planId: null, counts: { "create+add": 5, add: 1, "in-sync": 30, conflict: 2, invalid: 2, toApply: 6 }, ...over });

// The page, on #/run, once the server's settings have arrived.
async function mount(opts = {}) {
  const state = fakeApi(opts);
  render(<App />);
  go("#/run");
  await screen.findByTestId("run-page");
  await waitFor(() => expect(state.calls.some((c) => c.url === "/api/info")).toBe(true));
  return state;
}
const planBtn = () => screen.getByTestId("plan-btn");
const ready = () => waitFor(() => expect(planBtn()).toBeEnabled());

// plan -> (apply) -> (verify), each a finished job straight away
function flow({ plan = job(), apply = applyJob(), verify = job({ id: "job-3", counts: { "create+add": 0, add: 0, "in-sync": 95, conflict: 3, invalid: 2, toApply: 0 }, planId: "plan-3" }), rows = makeRows(100) } = {}) {
  let planned = 0;
  return {
    "POST /api/plan": (_b, s, json) => { s.job = planned++ === 0 ? plan : verify; return json(202, { job: s.job }); },
    "POST /api/apply": (_b, s, json) => { s.job = apply; return json(202, { job: apply }); },
    "GET /api/jobs/current/results": resultsOf(rows),
  };
}

test("the controls come from /api/info: route radios, the scenario with its description, the people count, concurrency with its limits; nothing to apply yet", async () => {
  await mount();
  await ready();
  expect(screen.getByTestId("route-a")).toBeChecked();
  expect(screen.getByTestId("route-b")).not.toBeChecked();
  expect(screen.getByTestId("route-a").closest("label")).toHaveTextContent("PingOne API: group membership");
  expect(screen.getByTestId("route-b").closest("label")).toHaveTextContent("Privilege console API: POST /v1/users");
  const scenario = screen.getByTestId("scenario-select");
  expect(within(scenario).getAllByRole("option").map((o) => o.value)).toEqual(["realistic", "clean", "rate-limited"]);
  expect(scenario).toHaveValue("realistic");
  expect(screen.getByTestId("scenario-desc")).toHaveTextContent("A few conflicts, a few invalid records, some rate limiting.");
  expect(within(screen.getByTestId("users-select")).getAllByRole("option").map((o) => o.value)).toEqual(["100", "500", "5000"]);
  const conc = screen.getByTestId("concurrency-input");
  expect(conc).toHaveValue(6);
  expect(conc).toHaveAttribute("min", "1");
  expect(conc).toHaveAttribute("max", "16");
  for (const id of ["apply-panel", "verify-btn", "abort-btn", "counts", "results-table", "error-pane", "job-state"]) expect(screen.queryByTestId(id), id).toBeNull();
  expect(planBtn()).toHaveTextContent("Plan (dry run)");
});

test("Plan posts the choices, then shows plain-worded counts as chips, the progress, the phase and the http stats", async () => {
  const state = await mount({ handlers: flow({ plan: job({ http: { calls: 120, retries: 7, rate429: 3, waitedMs: 3200, perSec: 18.5 } }) }) });
  await ready();
  const user = userEvent.setup();
  await user.selectOptions(screen.getByTestId("scenario-select"), "rate-limited");
  await user.selectOptions(screen.getByTestId("users-select"), "500");
  await user.click(screen.getByTestId("route-b"));
  await user.click(planBtn());
  await screen.findByTestId("counts");
  expect(state.calls.find((c) => c.url === "/api/plan").body).toEqual({ route: "b", concurrency: 6, scenario: "rate-limited", users: 500 });
  // the fake's finished job is a route a plan, whatever was asked: the chips are named by the server's keys
  const counts = screen.getByTestId("counts");
  for (const [key, n, label] of [["create-add", "12", "create and add"], ["add", "3", "add to the group"], ["in-sync", "80", "in sync"], ["conflict", "3", "conflict"], ["invalid", "2", "invalid"], ["toApply", "15", "to apply"]]) {
    const chip = within(counts).getByTestId(`count-${key}`);
    expect(chip).toHaveAttribute("data-count", n);
    expect(chip).toHaveTextContent(`${n} ${label}`);
  }
  expect(screen.getByTestId("job-state").textContent).toBe("done");
  expect(screen.getByTestId("job-phase")).toHaveTextContent("finished");
  const bar = screen.getByTestId("progress");
  expect(bar).toHaveAttribute("role", "progressbar");
  expect(bar).toHaveAttribute("aria-valuenow", "100");
  expect(bar).toHaveAttribute("aria-valuemax", "100");
  expect(screen.getByTestId("http-calls")).toHaveTextContent("120");
  expect(screen.getByTestId("http-retries")).toHaveTextContent("7");
  expect(screen.getByTestId("http-429")).toHaveTextContent("3");
  expect(screen.getByTestId("http-waited")).toHaveTextContent("3.2 s");
  expect(screen.getByTestId("http-persec")).toHaveTextContent("18.5");
  expect(screen.getByTestId("backoff")).toHaveTextContent(/slow down 3 time/);
});

test("route B counts are named too", async () => {
  await mount({ handlers: flow({ plan: job({ route: "b", counts: { create: 40, exists: 55, conflict: 3, invalid: 2, toApply: 40 } }) }) });
  await ready();
  await userEvent.setup().click(planBtn());
  const counts = await screen.findByTestId("counts");
  for (const [key, text] of [["create", "40 create"], ["exists", "55 already exist"], ["conflict", "3 conflict"], ["invalid", "2 invalid"], ["toApply", "40 to apply"]]) expect(within(counts).getByTestId(`count-${key}`)).toHaveTextContent(text);
});

test("Apply is gated: the button stays disabled until REGISTER N is typed exactly, and the panel says how many people change", async () => {
  const state = await mount({ handlers: flow() });
  await ready();
  const user = userEvent.setup();
  await user.click(planBtn());
  const panel = await screen.findByTestId("apply-panel");
  expect(within(panel).getByTestId("apply-count")).toHaveTextContent("This will change 15 people.");
  expect(screen.queryByTestId("writes-switch")).toBeNull(); // Mock: no switch
  const apply = screen.getByTestId("apply-btn");
  expect(apply).toBeDisabled();
  expect(screen.getByTestId("apply-reason")).toHaveTextContent("type REGISTER 15");
  const input = screen.getByTestId("confirm-input");
  for (const wrong of ["register 15", "REGISTER 14", "REGISTER 150", "REGISTER 15 ", "REGISTER", "15"]) {
    await user.clear(input); await user.type(input, wrong);
    expect(apply, `typed "${wrong}"`).toBeDisabled();
  }
  await user.clear(input); await user.type(input, "REGISTER 15");
  expect(apply).toBeEnabled();
  await user.click(apply);
  await waitFor(() => expect(screen.getByTestId("verify-btn")).toBeInTheDocument());
  expect(state.calls.find((c) => c.url === "/api/apply").body).toEqual({ planId: "plan-1", confirm: "REGISTER 15" });
  expect(screen.queryByTestId("apply-panel")).toBeNull();
});

test("a plan with nothing to do shows no Apply panel and says so", async () => {
  await mount({ handlers: flow({ plan: job({ counts: { "create+add": 0, add: 0, "in-sync": 100, conflict: 0, invalid: 0, toApply: 0 } }) }) });
  await ready();
  await userEvent.setup().click(planBtn());
  expect(await screen.findByTestId("plan-clean")).toHaveTextContent("0 to apply.");
  expect(screen.queryByTestId("apply-panel")).toBeNull();
});

test("a blocking warning needs an I understand tick per code; a non-blocking one is shown without one; both are alerts", async () => {
  const warnings = [
    { code: "destination_empty", message: "The destination answered with no users at all: the worker may lack the Identity Data Admin role.", blocking: true },
    { code: "truncated", message: "The source is over the limit: only the first 50000 are planned.", blocking: true },
    { code: "slow_start", message: "The first calls were slow.", blocking: false },
  ];
  const state = await mount({ handlers: flow({ plan: job({ warnings }) }) });
  await ready();
  const user = userEvent.setup();
  await user.click(planBtn());
  const box = await screen.findByTestId("warnings");
  expect(within(box).getAllByRole("alert").length).toBe(3);
  expect(within(box).getByTestId("warning-destination_empty")).toHaveTextContent("Identity Data Admin");
  expect(screen.getByTestId("ack-destination_empty")).not.toBeChecked();
  expect(screen.getByTestId("ack-truncated")).toBeInTheDocument();
  expect(screen.queryByTestId("ack-slow_start")).toBeNull();
  await user.type(screen.getByTestId("confirm-input"), "REGISTER 15");
  expect(screen.getByTestId("apply-btn")).toBeDisabled(); // typed, but two warnings are not acknowledged
  expect(screen.getByTestId("apply-reason")).toHaveTextContent("destination_empty");
  await user.click(screen.getByTestId("ack-destination_empty"));
  expect(screen.getByTestId("apply-btn")).toBeDisabled(); // one of two
  await user.click(screen.getByTestId("ack-truncated"));
  expect(screen.getByTestId("apply-btn")).toBeEnabled();
  await user.click(screen.getByTestId("ack-truncated")); // un-ticking closes it again
  expect(screen.getByTestId("apply-btn")).toBeDisabled();
  await user.click(screen.getByTestId("ack-truncated"));
  await user.click(screen.getByTestId("apply-btn"));
  await waitFor(() => expect(state.calls.some((c) => c.url === "/api/apply")).toBe(true));
  expect(state.calls.find((c) => c.url === "/api/apply").body).toEqual({ planId: "plan-1", confirm: "REGISTER 15", acknowledgeWarnings: ["destination_empty", "truncated"] });
});

test("a running apply is polled every 400 ms with progress and live counts; the polling stops by itself when the job is done; Verify then shows a clean result", async () => {
  let polls = 0;
  const state = await mount({
    handlers: {
      ...flow(),
      "POST /api/apply": (_b, s, json) => { s.job = applyJob({ state: "running", phase: "applying", processed: 8, total: 15, finishedAt: null, counts: { created: 4, added: 4, "in-sync": 0, conflict: 0, invalid: 0, failed: 0, pending: 7 }, http: { calls: 30, retries: 2, rate429: 1, waitedMs: 1000, perSec: 9 } }); return json(202, { job: s.job }); },
      "GET /api/jobs/current": (_b, s, json) => { if (s.job?.state === "running" && ++polls >= 3) s.job = applyJob(); return json(200, { job: s.job }); },
    },
  });
  await ready();
  const user = userEvent.setup();
  await user.click(planBtn());
  await user.type(await screen.findByTestId("confirm-input"), "REGISTER 15");
  await user.click(screen.getByTestId("apply-btn"));
  // running: progress, phase, live counts, http stats, Abort offered, Plan disabled
  await waitFor(() => expect(screen.getByTestId("job-state")).toHaveTextContent("running"));
  const bar = screen.getByTestId("progress");
  expect(bar).toHaveAttribute("aria-valuenow", "8");
  expect(bar).toHaveAttribute("aria-valuemax", "15");
  expect(screen.getByTestId("job-phase")).toHaveTextContent("applying");
  expect(screen.getByTestId("count-pending")).toHaveAttribute("data-count", "7");
  expect(screen.getByTestId("http-429")).toHaveTextContent("1");
  expect(screen.getByTestId("abort-btn")).toBeEnabled();
  expect(planBtn()).toBeDisabled();
  expect(screen.queryByTestId("results-table")).toBeNull(); // rows are read when the job is over
  // the poll runs until the job is done...
  await waitFor(() => expect(screen.getByTestId("job-state").textContent).toBe("done"));
  expect(state.count("GET", "/api/jobs/current")).toBeGreaterThanOrEqual(3);
  expect(screen.queryByTestId("abort-btn")).toBeNull();
  // ...and then stops
  const stopped = state.count("GET", "/api/jobs/current");
  await wait(1200);
  expect(state.count("GET", "/api/jobs/current")).toBe(stopped);
  expect(await screen.findByTestId("results-table")).toBeInTheDocument();
  // Verify = plan again; a clean result is a success message
  expect(screen.getByTestId("verify-btn")).toHaveTextContent("Verify (plan again)");
  await user.click(screen.getByTestId("verify-btn"));
  const clean = await screen.findByTestId("plan-clean");
  expect(clean).toHaveTextContent("Verified: 0 to apply.");
  expect(screen.getByTestId("count-toApply")).toHaveAttribute("data-count", "0");
  expect(state.calls.filter((c) => c.url === "/api/plan").length).toBe(2);
});

test("the polling also stops when the page is left, and leaving and coming back shows the running job again", async () => {
  const state = await mount({ job: running() });
  expect(await screen.findByTestId("job-state")).toHaveTextContent("running");
  await waitFor(() => expect(state.count("GET", "/api/jobs/current")).toBeGreaterThanOrEqual(3));
  go("#/guide");
  await screen.findByTestId("guide-page");
  await wait(150);
  const left = state.count("GET", "/api/jobs/current");
  await wait(1000);
  expect(state.count("GET", "/api/jobs/current")).toBe(left); // not polling from the Guide
  go("#/run");
  expect(await screen.findByTestId("job-state")).toHaveTextContent("running"); // read again on load
  expect(screen.getByTestId("progress")).toHaveAttribute("aria-valuenow", "40");
  expect(state.count("GET", "/api/jobs/current")).toBeGreaterThan(left);
});

test("Abort posts, ends the job in the aborted state, and says so", async () => {
  const state = await mount({
    job: running(),
    handlers: { "POST /api/jobs/current/abort": (_b, s, json) => { s.job = running({ state: "aborted", phase: "finished", finishedAt: "2026-11-14T10:01:00.000Z", error: { code: "aborted", message: "Aborted by you." } }); return json(200, { job: s.job }); }, "GET /api/jobs/current/results": resultsOf(makeRows(10)) },
  });
  const user = userEvent.setup();
  await user.click(await screen.findByTestId("abort-btn"));
  await waitFor(() => expect(screen.getByTestId("job-state").textContent).toBe("aborted"));
  expect(state.calls.some((c) => c.method === "POST" && c.url === "/api/jobs/current/abort")).toBe(true);
  expect(screen.getByTestId("job-aborted")).toBeInTheDocument();
  expect(screen.queryByTestId("abort-btn")).toBeNull();
  expect(screen.queryByTestId("error-pane")).toBeNull(); // a deliberate stop is not an error
  expect(planBtn()).toBeEnabled();
});

test("concurrency is held between its limits and the scenario and people choices go to the server", async () => {
  const state = await mount({ handlers: flow() });
  await ready();
  const user = userEvent.setup();
  const conc = screen.getByTestId("concurrency-input");
  await user.clear(conc); await user.type(conc, "99");
  await user.click(planBtn());
  await screen.findByTestId("counts");
  expect(state.calls.find((c) => c.url === "/api/plan").body.concurrency).toBe(16);
  await user.clear(conc); await user.type(conc, "0"); await user.tab();
  expect(conc).toHaveValue(1);
});

test("results: a table of people from the results endpoint, filter chips built from its statuses, paging by 100, and the report links", async () => {
  const state = await mount({ job: job(), handlers: { "GET /api/jobs/current/results": resultsOf(makeRows(250)) } });
  const table = await screen.findByTestId("results-table");
  expect(within(table).getAllByTestId("result-row").length).toBe(100);
  expect(state.calls.find((c) => c.url.startsWith("/api/jobs/current/results")).url).toBe("/api/jobs/current/results?status=&offset=0&limit=100");
  expect(screen.getByTestId("status-filter-all")).toHaveAttribute("aria-pressed", "true");
  for (const s of ["create-add", "add", "in-sync", "conflict", "invalid"]) expect(screen.getByTestId(`status-filter-${s}`)).toHaveTextContent("(50)");
  expect(screen.getByTestId("report-json")).toHaveAttribute("href", "/api/report?format=json");
  expect(screen.getByTestId("report-csv")).toHaveAttribute("href", "/api/report?format=csv");
  const user = userEvent.setup();
  // a filter
  await user.click(screen.getByTestId("status-filter-conflict"));
  await waitFor(() => expect(within(screen.getByTestId("results-table")).getAllByTestId("result-row").length).toBe(50));
  expect(state.calls.at(-1).url).toBe("/api/jobs/current/results?status=conflict&offset=0&limit=100");
  expect(screen.getByTestId("status-filter-conflict")).toHaveAttribute("aria-pressed", "true");
  expect(within(screen.getByTestId("results-table")).getAllByTestId("cell-status").every((c) => c.textContent === "conflict")).toBe(true);
  expect(screen.getByTestId("status-filter-invalid")).toBeInTheDocument(); // the other chips stay
  await user.click(screen.getByTestId("status-filter-create-add"));
  await waitFor(() => expect(state.calls.at(-1).url).toBe("/api/jobs/current/results?status=create%2Badd&offset=0&limit=100"));
  await user.click(screen.getByTestId("status-filter-all"));
  // paging
  await waitFor(() => expect(screen.getByTestId("results-paging")).toHaveTextContent("Rows 1 to 100 of 250"));
  expect(screen.getByTestId("results-prev")).toBeDisabled();
  await user.click(screen.getByTestId("results-next"));
  await waitFor(() => expect(screen.getByTestId("results-paging")).toHaveTextContent("Rows 101 to 200 of 250"));
  expect(state.calls.at(-1).url).toBe("/api/jobs/current/results?status=&offset=100&limit=100");
  expect(screen.getByTestId("results-prev")).toBeEnabled();
  await user.click(screen.getByTestId("results-next"));
  await waitFor(() => expect(screen.getByTestId("results-paging")).toHaveTextContent("Rows 201 to 250 of 250"));
  expect(screen.getByTestId("results-next")).toBeDisabled();
  expect(within(screen.getByTestId("results-table")).getAllByTestId("result-row").length).toBe(50);
});

test("selecting a row opens its detail in the shared JsonPane (Formatted by default, with a Raw toggle), and Close puts it away", async () => {
  await mount({ job: job(), handlers: { "GET /api/jobs/current/results": resultsOf(makeRows(5)) } });
  const user = userEvent.setup();
  await screen.findByTestId("results-table");
  expect(screen.queryByTestId("row-detail")).toBeNull();
  await user.click(screen.getAllByTestId("row-open")[1]);
  const detail = screen.getByTestId("row-detail");
  const form = within(detail).getByTestId("row-json");
  expect(within(detail).getByTestId("row-json-formatted")).toHaveAttribute("aria-pressed", "true");
  expect(form).toHaveTextContent("username");
  expect(form).toHaveTextContent("person2.example");
  expect(form).toHaveTextContent("status");
  expect(screen.getAllByTestId("result-row")[1]).toHaveAttribute("data-selected", "true");
  await user.click(within(detail).getByTestId("row-json-raw"));
  expect(within(detail).getByTestId("row-json-raw")).toHaveAttribute("aria-pressed", "true");
  const pre = within(detail).getByTestId("row-json");
  expect(pre.tagName).toBe("PRE");
  expect(pre).toHaveTextContent('"username"');
  expect(pre).toHaveTextContent("person2.example");
  await user.click(within(detail).getByRole("button", { name: "Close" }));
  expect(screen.queryByTestId("row-detail")).toBeNull();
});

test("hostile usernames, emails, details and statuses are inert text in the table and in the detail pane", async () => {
  const bad = "<img src=x onerror=alert(1)>";
  const rows = [{ n: 1, username: bad, email: "<b>x</b>@people.example", status: "<i>odd</i>", detail: "<script>alert(1)</script>", httpStatus: null, attempts: 1 }, ...makeRows(2).map((r) => ({ ...r, n: r.n + 1 }))];
  await mount({ job: job(), handlers: { "GET /api/jobs/current/results": resultsOf(rows) } });
  const table = await screen.findByTestId("results-table");
  expect(within(table).getByText(bad)).toBeInTheDocument(); // shown, not run
  expect(within(table).getByText("<script>alert(1)</script>")).toBeInTheDocument();
  expect(table.querySelector("img, b, i, script")).toBeNull();
  await userEvent.setup().click(screen.getAllByTestId("row-open")[0]);
  expect(screen.getByTestId("row-json")).toHaveTextContent(bad); // Formatted
  await userEvent.setup().click(screen.getByTestId("row-json-raw"));
  expect(screen.getByTestId("row-json")).toHaveTextContent(bad); // Raw
  expect(document.querySelector("img")).toBeNull();
  expect(document.querySelector("script")).toBeNull();
});

test("every failure is named: a refused plan, a failed job, a refused apply, a non-JSON answer and a server that is down", async () => {
  // a refused plan
  let state = await mount({ handlers: { "POST /api/plan": (_b, _s, json) => json(409, { error: "job_running", message: "A job is already running." }) } });
  await ready();
  const user = userEvent.setup();
  await user.click(planBtn());
  let pane = await screen.findByTestId("error-pane");
  expect(pane).toHaveTextContent("job_running");
  expect(pane).toHaveTextContent("A job is already running.");
  expect(pane).toHaveAttribute("role", "alert");
  cleanup();

  // a job that failed: its own error code and message, and no counts-only blank
  const failed = job({ state: "failed", phase: "finished", planId: null, counts: {}, error: { code: "group_missing", message: "No group named in BULK_P1_GROUP exists in the destination environment." } });
  state = await mount({ job: failed });
  pane = await screen.findByTestId("error-pane");
  expect(pane).toHaveTextContent("group_missing");
  expect(pane).toHaveTextContent("No group named in BULK_P1_GROUP exists in the destination environment.");
  expect(screen.getByTestId("job-state")).toHaveTextContent("failed");
  expect(screen.queryByTestId("apply-panel")).toBeNull();
  cleanup();

  // the run stopped on purpose
  await mount({ job: applyJob({ state: "failed", error: { code: "circuit_open", message: "40 of the first 50 calls failed: stopped." } }), handlers: { "GET /api/jobs/current/results": resultsOf(makeRows(3)) } });
  pane = await screen.findByTestId("error-pane");
  expect(pane).toHaveTextContent("circuit_open");
  expect(pane).toHaveTextContent("40 of the first 50 calls failed: stopped.");
  expect(pane).toHaveTextContent(/stopped on purpose/);
  cleanup();

  // a refused apply: the server's words, verbatim
  state = await mount({ handlers: { ...flow(), "POST /api/apply": (_b, _s, json) => json(409, { error: "stale_plan", message: "The plan is older than 15 minutes." }) } });
  await ready();
  await user.click(planBtn());
  await user.type(await screen.findByTestId("confirm-input"), "REGISTER 15");
  await user.click(screen.getByTestId("apply-btn"));
  pane = await screen.findByTestId("error-pane");
  expect(pane).toHaveTextContent("stale_plan");
  expect(pane).toHaveTextContent("The plan is older than 15 minutes.");
  expect(screen.getByTestId("apply-panel")).toBeInTheDocument(); // nothing was lost
  cleanup();

  // a proxy's HTML error page is not JSON: still a message
  await mount({ handlers: { "POST /api/plan": () => Promise.resolve({ ok: false, status: 502, json: () => Promise.reject(new SyntaxError("Unexpected token <")) }) } });
  await ready();
  await user.click(planBtn());
  pane = await screen.findByTestId("error-pane");
  expect(pane).toHaveTextContent("http_502");
  expect(pane).toHaveTextContent("The server answered HTTP 502 without a message.");
  cleanup();

  // the server goes away while a plan is requested
  state = await mount();
  await ready();
  globalThis.fetch = vi.fn(() => Promise.reject(new TypeError("fetch failed")));
  await user.click(planBtn());
  pane = await screen.findByTestId("error-pane");
  expect(pane).toHaveTextContent("unreachable");
  expect(pane).toHaveTextContent("This app's server is not reachable.");
});

test("Real: no scenario or people controls, the missing setting NAMES are shown and Plan is disabled with the reason; a ready route plans with route and concurrency only", async () => {
  const notReady = infoFor("real", true, { routes: { a: { label: "PingOne API: group membership", realReady: false, missing: ["BULK_P1_WORKER_CLIENT_ID", "BULK_P1_GROUP"] }, b: { label: "Privilege console API: POST /v1/users", realReady: true, missing: [] } } });
  const state = await mount({ realAvailable: true, info: notReady, handlers: flow({ plan: job({ route: "b", source: "real", scenario: null, counts: { create: 4, exists: 6, conflict: 0, invalid: 0, toApply: 4 } }) }) });
  await waitFor(() => expect(screen.getByTestId("plan-reason")).toBeInTheDocument());
  expect(screen.queryByTestId("scenario-select")).toBeNull();
  expect(screen.queryByTestId("users-select")).toBeNull();
  expect(planBtn()).toBeDisabled();
  expect(screen.getByTestId("plan-reason")).toHaveTextContent("BULK_P1_WORKER_CLIENT_ID, BULK_P1_GROUP");
  expect(screen.getByTestId("real-settings")).toHaveTextContent("BULK_P1_WORKER_CLIENT_ID, BULK_P1_GROUP");
  const user = userEvent.setup();
  await user.click(screen.getByTestId("route-b"));
  expect(planBtn()).toBeEnabled();
  expect(screen.getByTestId("real-settings")).toHaveTextContent("Every setting this route needs is present.");
  await user.click(planBtn());
  await screen.findByTestId("apply-panel");
  expect(state.calls.find((c) => c.url === "/api/plan").body).toEqual({ route: "b", concurrency: 6 });
});

test("Real: Apply also needs the Writes switch; the switch posts /api/writes, shows its state, and the writes notice follows", async () => {
  const state = await mount({ realAvailable: true, info: infoFor("real", true), handlers: flow({ plan: job({ source: "real", scenario: null }), apply: applyJob({ source: "real", scenario: null }) }) });
  await ready();
  const user = userEvent.setup();
  await user.click(planBtn());
  await screen.findByTestId("apply-panel");
  const sw = screen.getByTestId("writes-switch");
  expect(sw).toHaveAttribute("role", "switch");
  expect(sw).not.toBeChecked();
  expect(screen.getByTestId("apply-panel")).toHaveTextContent("Writes: off");
  await user.type(screen.getByTestId("confirm-input"), "REGISTER 15");
  expect(screen.getByTestId("apply-btn")).toBeDisabled(); // typed, but Writes are off
  expect(screen.getByTestId("apply-reason")).toHaveTextContent("turn the Writes switch on");
  await user.click(sw);
  await waitFor(() => expect(sw).toBeChecked());
  expect(state.calls.find((c) => c.url === "/api/writes").body).toEqual({ enabled: true });
  expect(screen.getByTestId("apply-panel")).toHaveTextContent("Writes: ON");
  expect(screen.getByTestId("writes-notice")).toHaveTextContent(/WRITES ARE ENABLED/);
  expect(screen.getByTestId("apply-btn")).toBeEnabled();
  await user.click(sw); // and off again
  await waitFor(() => expect(sw).not.toBeChecked());
  expect(screen.getByTestId("apply-btn")).toBeDisabled();
  expect(screen.getByTestId("writes-notice")).toHaveTextContent(/Writes are off/);
});

test("Real: the server's refusal of an apply is shown word for word", async () => {
  const handlers = { ...flow({ plan: job({ source: "real", scenario: null }) }), "POST /api/apply": (_b, _s, json) => json(403, { error: "writes_disabled", message: "Writes are disabled: turn the Writes switch on first." }) };
  await mount({ realAvailable: true, info: infoFor("real", true), handlers });
  await ready();
  const user = userEvent.setup();
  await user.click(planBtn());
  await user.click(await screen.findByTestId("writes-switch")); // the page's view says on; the server still refuses (for example after a Reset elsewhere)
  await waitFor(() => expect(screen.getByTestId("writes-switch")).toBeChecked());
  await user.type(screen.getByTestId("confirm-input"), "REGISTER 15");
  await user.click(screen.getByTestId("apply-btn"));
  const pane = await screen.findByTestId("error-pane");
  expect(pane).toHaveTextContent("writes_disabled");
  expect(pane).toHaveTextContent("Writes are disabled: turn the Writes switch on first.");
});

test("a plan made in the other mode cannot be applied here", async () => {
  await mount({ realAvailable: true, info: infoFor("real", true), job: job({ source: "mock" }), handlers: { "GET /api/jobs/current/results": resultsOf(makeRows(3)) } });
  expect(await screen.findByTestId("plan-other-mode")).toHaveTextContent("This plan was made in mock. Plan again in Real before applying.");
  expect(screen.queryByTestId("apply-panel")).toBeNull();
});

test("the progress bar has no value while the total is unknown", async () => {
  await mount({ job: running({ total: null, processed: 0, phase: "reading the source" }) });
  const bar = await screen.findByTestId("progress");
  expect(bar).not.toHaveAttribute("aria-valuenow");
  expect(bar).toHaveAttribute("aria-valuetext", "reading the source");
  expect(screen.getByTestId("progress-text")).toHaveTextContent("Counting the people");
});

test("when Mock's waits are shortened the Run page says so beside the http stats; a job at full scale shows no note", async () => {
  await mount({ job: job({ timeScale: 0.02, http: { calls: 140, retries: 36, rate429: 36, waitedMs: 100, perSec: 800 } }), handlers: { "GET /api/jobs/current/results": resultsOf(makeRows(3)) } });
  const note = await screen.findByTestId("time-scale-note");
  expect(note).toHaveTextContent("Mock: every wait is shortened to 2% of real time, so back-off here is much shorter than a real run would wait.");
  expect(screen.getByTestId("http-stats").compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy(); // right under the stats
  expect(screen.getByTestId("http-waited")).toHaveTextContent("0.1 s");
  cleanup();
  await mount({ job: job({ timeScale: 1 }), handlers: { "GET /api/jobs/current/results": resultsOf(makeRows(3)) } });
  await screen.findByTestId("http-stats");
  expect(screen.queryByTestId("time-scale-note")).toBeNull();
  cleanup();
  await mount({ job: running({ timeScale: 0.5 }) });
  expect(await screen.findByTestId("time-scale-note")).toHaveTextContent("shortened to 50% of real time"); // also while it runs
});

test("Verify plans the SAME world as the applied job (route, scenario, people, concurrency) whatever the controls say now, and says so", async () => {
  const state = await mount({ handlers: flow({ plan: job({ route: "b", scenario: "rate-limited", users: 500, concurrency: 9, counts: { create: 40, exists: 55, conflict: 3, invalid: 2, toApply: 40 } }), apply: applyJob({ route: "b", scenario: "rate-limited", users: 500, concurrency: 9, counts: { created: 40, exists: 55, conflict: 3, invalid: 2, failed: 0, pending: 0 } }) }) });
  await ready();
  const user = userEvent.setup();
  await user.click(screen.getByTestId("route-b"));
  await user.selectOptions(screen.getByTestId("scenario-select"), "rate-limited");
  await user.selectOptions(screen.getByTestId("users-select"), "500");
  await user.clear(screen.getByTestId("concurrency-input")); await user.type(screen.getByTestId("concurrency-input"), "9");
  await user.click(planBtn());
  await user.type(await screen.findByTestId("confirm-input"), "REGISTER 40");
  await user.click(screen.getByTestId("apply-btn"));
  await screen.findByTestId("verify-btn");
  // the controls now ask for something else entirely
  await user.click(screen.getByTestId("route-a"));
  await user.selectOptions(screen.getByTestId("scenario-select"), "clean");
  await user.selectOptions(screen.getByTestId("users-select"), "5000");
  await user.clear(screen.getByTestId("concurrency-input")); await user.type(screen.getByTestId("concurrency-input"), "2");
  expect(screen.getByTestId("verify-note")).toHaveTextContent("Verifying the same world: scenario rate-limited, 500 people, route B, concurrency 9.");
  await user.click(screen.getByTestId("verify-btn"));
  await waitFor(() => expect(state.calls.filter((c) => c.url === "/api/plan").length).toBe(2));
  expect(state.calls.filter((c) => c.url === "/api/plan")[1].body).toEqual({ route: "b", scenario: "rate-limited", users: 500, concurrency: 9 });
  // Plan still follows the controls
  await user.click(planBtn());
  await waitFor(() => expect(state.calls.filter((c) => c.url === "/api/plan").length).toBe(3));
  expect(state.calls.filter((c) => c.url === "/api/plan")[2].body).toEqual({ route: "a", scenario: "clean", users: 5000, concurrency: 2 });
});

test("Verify in Real names the route and concurrency it reuses and sends no Mock fields", async () => {
  const state = await mount({ realAvailable: true, info: infoFor("real", true), handlers: flow({ plan: job({ source: "real", scenario: null, users: null, concurrency: 4 }), apply: applyJob({ source: "real", scenario: null, users: null, concurrency: 4 }) }) });
  await ready();
  const user = userEvent.setup();
  await user.click(planBtn());
  await user.click(await screen.findByTestId("writes-switch"));
  await waitFor(() => expect(screen.getByTestId("writes-switch")).toBeChecked());
  await user.type(screen.getByTestId("confirm-input"), "REGISTER 15");
  await user.click(screen.getByTestId("apply-btn"));
  await screen.findByTestId("verify-btn");
  expect(screen.getByTestId("verify-note")).toHaveTextContent("Verifying the same world: route A, concurrency 4.");
  await user.click(screen.getByTestId("verify-btn"));
  await waitFor(() => expect(state.calls.filter((c) => c.url === "/api/plan").length).toBe(2));
  expect(state.calls.filter((c) => c.url === "/api/plan")[1].body).toEqual({ route: "a", concurrency: 4 });
});

test("focus: a started job takes focus to its summary (the pressed button is gone), a finished plan to the Apply panel, a finished apply to Verify; each is announced", async () => {
  let polls = 0;
  await mount({
    handlers: {
      ...flow(),
      "POST /api/apply": (_b, s, json) => { s.job = applyJob({ state: "running", phase: "applying", processed: 5, total: 15, finishedAt: null }); return json(202, { job: s.job }); },
      "GET /api/jobs/current": (_b, s, json) => { if (s.job?.state === "running" && ++polls >= 2) s.job = applyJob(); return json(200, { job: s.job }); },
    },
  });
  await ready();
  const user = userEvent.setup();
  expect(screen.getByRole("heading", { level: 1 })).toHaveFocus(); // where opening the page left it
  await user.click(planBtn());
  await screen.findByTestId("apply-panel");
  await waitFor(() => expect(screen.getByTestId("apply-panel")).toHaveFocus()); // the plan ended: the next thing is Apply
  expect(screen.getByTestId("live")).toHaveTextContent("Plan done. 15 to apply.");
  await user.type(screen.getByTestId("confirm-input"), "REGISTER 15");
  await user.click(screen.getByTestId("apply-btn")); // the Apply button and its panel unmount here
  await waitFor(() => expect(screen.getByTestId("job-state")).toHaveTextContent("running"));
  expect(screen.getByTestId("job")).toHaveFocus(); // not the page body
  await waitFor(() => expect(screen.getByTestId("job-state").textContent).toBe("done"));
  await waitFor(() => expect(screen.getByTestId("verify-btn")).toHaveFocus()); // one keypress from the next step
  expect(screen.getByTestId("live")).toHaveTextContent("Apply done. 0 failed.");
});

test("focus: a failed or aborted job lands on its summary; a finished job found on load, or started elsewhere, does not steal focus", async () => {
  const failed = job({ state: "failed", planId: null, counts: {}, error: { code: "group_missing", message: "No such group." } });
  await mount({ job: failed });
  await screen.findByTestId("error-pane");
  expect(screen.getByRole("heading", { level: 1 })).toHaveFocus(); // loaded, not started here: the page heading, where opening the page left it
  cleanup();
  const state = await mount({ handlers: { "POST /api/plan": (_b, s, json) => { s.job = failed; return json(202, { job: failed }); } } });
  await ready();
  await userEvent.setup().click(planBtn());
  await waitFor(() => expect(screen.getByTestId("job")).toHaveFocus());
  expect(screen.getByTestId("live")).toHaveTextContent("Plan failed.");
  expect(state.calls.some((c) => c.url === "/api/plan")).toBe(true);
});

test("focus: a running job found on load is followed to its end (focus, announcement), without moving focus at the start", async () => {
  let polls = 0;
  await mount({ job: running(), handlers: { "GET /api/jobs/current": (_b, s, json) => { if (s.job.state === "running" && ++polls >= 3) s.job = job({ id: "job-1" }); return json(200, { job: s.job }); }, "GET /api/jobs/current/results": resultsOf(makeRows(3)) } });
  await screen.findByTestId("job-state");
  expect(screen.getByRole("heading", { level: 1 })).toHaveFocus(); // not moved at the start
  await waitFor(() => expect(screen.getByTestId("apply-panel")).toHaveFocus());
  expect(screen.getByTestId("live")).toHaveTextContent("Plan done.");
});

test("three clicks on Plan in the same tick send one request and no job_running flash", async () => {
  let release;
  const state = await mount({ handlers: { "POST /api/plan": (_b, s, json) => new Promise((r) => { release = () => { s.job = job(); r(json(202, { job: s.job })); }; }), "GET /api/jobs/current/results": resultsOf(makeRows(3)) } });
  await ready();
  const btn = planBtn();
  act(() => { btn.click(); btn.click(); btn.click(); }); // one act: React has not re-rendered (disabled the button) between the clicks
  expect(state.calls.filter((c) => c.method === "POST" && c.url === "/api/plan").length).toBe(1);
  expect(btn).toBeDisabled();
  await act(async () => { release(); });
  await screen.findByTestId("counts");
  expect(screen.queryByTestId("error-pane")).toBeNull();
  expect(state.calls.filter((c) => c.method === "POST" && c.url === "/api/plan").length).toBe(1);
});

test("the same goes for Apply: a double click sends one apply", async () => {
  let n = 0;
  const state = await mount({ handlers: { ...flow(), "POST /api/apply": (_b, s, json) => { n++; return new Promise((r) => { setTimeout(() => { s.job = applyJob(); r(json(202, { job: s.job })); }, 50); }); } } });
  await ready();
  const user = userEvent.setup();
  await user.click(planBtn());
  await user.type(await screen.findByTestId("confirm-input"), "REGISTER 15");
  const btn = screen.getByTestId("apply-btn");
  act(() => { btn.click(); btn.click(); });
  await screen.findByTestId("verify-btn");
  expect(n).toBe(1);
  expect(state.calls.filter((c) => c.url === "/api/apply").length).toBe(1);
  expect(screen.queryByTestId("error-pane")).toBeNull();
});

test("invisible and look-alike characters in names, emails and details are shown as escapes in the table, as the JSON pane does", async () => {
  const rows = [
    { n: 1, username: "adm\u202ein\u202d", email: "a***@corp.example", status: "create", detail: "plain", httpStatus: null, attempts: 1 },
    { n: 2, username: "admin\u200b", email: "z\u200dw***@corp.example", status: "create", detail: "line\nbreak\ttab\u0000nul", httpStatus: null, attempts: 1 },
    { n: 3, username: "admin", email: "a***@corp.example", status: "create", detail: "plain", httpStatus: null, attempts: 1 },
  ];
  await mount({ job: job(), handlers: { "GET /api/jobs/current/results": resultsOf(rows) } });
  const table = await screen.findByTestId("results-table");
  const cell = (r, id) => within(screen.getAllByTestId("result-row")[r]).getByTestId(id).textContent;
  expect(cell(0, "cell-username")).toBe("adm‹U+202E›in‹U+202D›");
  expect(cell(1, "cell-username")).toBe("admin‹U+200B›"); // not the same as "admin"
  expect(cell(2, "cell-username")).toBe("admin");
  expect(cell(1, "cell-email")).toBe("z‹U+200D›w***@corp.example");
  expect(cell(1, "cell-detail")).toBe("line‹U+000A›break‹U+0009›tab‹U+0000›nul");
  expect(table.textContent).not.toMatch(/[\u202a-\u202e\u200b-\u200f]/);
});

test("long values do not squeeze the Status chip: the chip keeps its text on one line and its own column", async () => {
  const long = "x".repeat(300);
  const rows = [{ n: 1, username: long, email: long, status: "create+add", detail: long, httpStatus: null, attempts: 1 }];
  await mount({ job: job(), handlers: { "GET /api/jobs/current/results": resultsOf(rows) } });
  const table = await screen.findByTestId("results-table");
  expect(table).toHaveClass("results"); // .results td wraps anywhere; .col-status has a minimum width; chips are nowrap (app.css)
  const status = within(table).getByTestId("cell-status").closest("td");
  expect(status).toHaveClass("col-status");
  expect(within(table).getByTestId("cell-status").closest(".chip")).toHaveAttribute("title", "create+add");
});
