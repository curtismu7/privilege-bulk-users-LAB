// The resilient call path every bulk request goes through (PingOne and the Privilege console alike). It is the mechanics the Guide
// page teaches, in one place:
//   - one SHARED gate: a 429 pauses every worker for the server's Retry-After, not just the one that was told off;
//   - Retry-After is seconds or an HTTP date, and is capped (a server hint must not park the run for an hour);
//   - a 5xx or a network error is retried with exponential back-off, a few times, then reported (never thrown) so one bad person
//     becomes one failed row and the run goes on;
//   - nothing here ever throws for a per-request failure: it returns { status, json, text, tries, error } (status 0 = no answer).
// `scale` shrinks every wait (Mock uses a small one so a demo does not sit through real seconds; Real uses 1).
const MAX_WAIT_MS = 60_000;
const MIN_WAIT_MS = 250; // a server that says "0" or sends junk is still told off: never hammer back
const DEFAULT_WAIT_MS = 1_000;
const MAX_429_IN_A_ROW = 20;
const MAX_BODY_BYTES = 8_000_000; // a response bigger than this is refused, not buffered

export function parseRetryAfter(value, nowMs = Date.now()) {
  if (value === null || value === undefined || value === '') return DEFAULT_WAIT_MS;
  const s = String(value).trim();
  let ms;
  if (/^\d+(\.\d+)?$/.test(s)) ms = Number(s) * 1000;
  else if (/[a-z]/i.test(s)) { const t = Date.parse(s); ms = Number.isNaN(t) ? DEFAULT_WAIT_MS : t - nowMs; } // an HTTP date has day and month names
  else ms = DEFAULT_WAIT_MS;
  return Math.min(Math.max(ms, MIN_WAIT_MS), MAX_WAIT_MS);
}

export function createGate({ scale = 1, now = Date.now } = {}) {
  let until = 0;
  let waited = 0;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  return {
    // Every worker awaits this before it sends. While a 429 pause is in force it holds them all.
    async wait() { for (;;) { const d = until - now(); if (d <= 0) return; await sleep(d); } },
    // Extend the pause (never shorten it). Returns the wait in force, in real ms.
    pause(ms) {
      const target = now() + ms * scale;
      if (target > until) { waited += target - Math.max(until, now()); until = target; }
      return until - now();
    },
    backoff: (ms) => sleep(ms * scale),
    waitedMs: () => Math.round(waited),
  };
}

export const newStats = () => ({ calls: 0, retries: 0, rate429: 0 });

const tryParse = (t) => { try { return JSON.parse(t); } catch { return null; } };

// The body as text, up to MAX_BODY_BYTES; over that the read stops and the call is reported as failed (a stream that never ends cannot fill memory).
async function readCapped(res) {
  if (!res.body?.getReader) return res.text();
  const reader = res.body.getReader(); const dec = new TextDecoder(); let n = 0; let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return text + dec.decode();
    n += value.byteLength;
    if (n > MAX_BODY_BYTES) { try { await reader.cancel(); } catch { /* already closing */ } throw Object.assign(new Error('response too large'), { code: 'too_large' }); }
    text += dec.decode(value, { stream: true });
  }
}
const errorName = (err) => (err?.name === 'TimeoutError' ? 'timeout' : String(err?.cause?.code || (typeof err?.code === 'string' ? err.code : '') || err?.name || 'network_error'));
export function createResilient({ fetchImpl = fetch, gate, stats = newStats(), maxAttempts = 4, timeoutMs = 30_000, signal } = {}) {
  return async function resilient(url, init = {}) {
    let failures = 0; let limited = 0; let tries = 0;
    for (;;) {
      if (signal?.aborted) throw Object.assign(new Error('aborted'), { code: 'aborted' });
      await gate.wait();
      if (signal?.aborted) throw Object.assign(new Error('aborted'), { code: 'aborted' }); // a pause can end after the abort: nothing more is sent
      let res = null; let text = ''; let error = null;
      stats.calls++; tries++;
      try {
        // redirect: manual, so a 3xx is an answer to report and never a hop that carries our credential headers somewhere else.
        res = await fetchImpl(url, { ...init, redirect: 'manual', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs) });
        text = await readCapped(res);
      } catch (err) { error = errorName(err); }

      if (!error && res.status === 429) {
        stats.rate429++; limited++;
        if (limited > MAX_429_IN_A_ROW) return { status: 429, text, json: tryParse(text), tries, error: null, headers: res.headers };
        stats.retries++;
        gate.pause(parseRetryAfter(res.headers.get('retry-after')));
        continue;
      }
      if (error || res.status >= 500) {
        failures++;
        if (failures >= maxAttempts) return { status: error ? 0 : res.status, text, json: error ? null : tryParse(text), tries, error, headers: res?.headers ?? null };
        stats.retries++;
        await gate.backoff(250 * 2 ** (failures - 1));
        continue;
      }
      return { status: res.status, text, json: tryParse(text), tries, error: null, headers: res.headers };
    }
  };
}
