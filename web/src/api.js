// Thin fetch wrapper. Returns { ok, status, json } and never throws on an HTTP error: the server answers refusals with 4xx
// bodies the UI shows as they are (writes_disabled, stale_plan, ...). Same-origin POSTs carry the browser's own Origin header.
async function send(method, path, body) {
  let res;
  try {
    res = await fetch(path, { method, headers: body === undefined ? undefined : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    return { ok: false, status: 0, json: { error: "unreachable", message: "This app's server is not reachable." } };
  }
  let json = null;
  try { json = await res.json(); } catch { /* not JSON */ }
  return { ok: res.ok, status: res.status, json };
}
export const get = (path) => send("GET", path);
export const post = (path, body = {}) => send("POST", path, body);

// A named failure for any answer that is not ok (rule 23): the server's own { error, message } when it sent one, otherwise
// words that say what happened. Never blank.
export function failure(r) {
  const code = typeof r.json?.error === "string" ? r.json.error : r.status ? `http_${r.status}` : "unreachable";
  const message = typeof r.json?.message === "string" && r.json.message
    ? r.json.message
    : r.status ? `The server answered HTTP ${r.status} without a message.` : "This app's server is not reachable.";
  return { code, message };
}
