// Plain words and semantic tones for the counts, the statuses and the refusals the server can send (docs/api.md).
// A chip always carries its word; the tone only adds colour (never colour alone).

export const COUNT_LABEL = {
  "create+add": "create and add", add: "add to the group", "in-sync": "in sync", conflict: "conflict", invalid: "invalid", toApply: "to apply",
  create: "create", exists: "already exist",
  created: "created", added: "added to the group", failed: "failed", pending: "pending",
};

// ok = done or already right, info = work to do, warn = a person must look, danger = did not work
export const TONE = {
  "create+add": "info", add: "info", create: "info", toApply: "info",
  "in-sync": "ok", exists: "ok", created: "ok", added: "ok",
  conflict: "warn", pending: "warn",
  invalid: "danger", failed: "danger",
};

// "create+add" -> "create-add", so a count or a filter has an id a selector can use
export const testKey = (key) => String(key).replace(/\+/g, "-");

// Every table here is keyed by TEXT THE SERVER SENDS (an error code, a count key, a status). A plain table[key] would answer
// Object.prototype for "__proto__" (and a function for "constructor"), which React cannot draw: the whole page went blank. Only own keys count.
export const lookup = (table, key) => (typeof key === "string" && Object.hasOwn(table, key) ? table[key] : undefined);

// What the server's error codes mean in this lab, from docs/api.md. The server's own message is always shown too.
export const HINTS = {
  needs_setup: "Real is not set up for this route: the settings named above are missing.",
  real_refused: "Real is refused until the owner opts in. Switch to Mock to practise.",
  job_running: "A job is running. Wait for it to end, or abort it.",
  no_plan: "Nothing to apply: run Plan first.",
  stale_plan: "The plan is out of date (older than 15 minutes, or the mode changed since). Plan again.",
  confirm_required: "The confirmation must be exactly REGISTER and the number of people.",
  warnings_unacknowledged: "Tick I understand on each blocking warning first.",
  writes_disabled: "Writes are off. Turn the Writes switch on (Real only).",
  nothing_to_do: "The plan has nothing to apply.",
  mock_only: "The Writes switch is for Real only: Mock always writes to the in-process mock.",
  no_job: "No job is running.",
  no_report: "There is no finished job to report on yet.",
  group_missing: "The Privilege group was not found in the destination environment, so nothing could be added.",
  source_unreadable: "The source environment could not be read.",
  destination_unreadable: "The destination environment could not be read.",
  token_refused: "PingOne refused the worker's credentials.",
  login_required: "The Privilege console refused the API key and secret (401 or 403).",
  circuit_open: "Most of the recent calls failed: it stopped on purpose (the circuit breaker). Nothing more was sent.",
  unreachable: "The page cannot reach this lab's server. Is it running?",
};
