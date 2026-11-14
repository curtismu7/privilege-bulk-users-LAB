#!/usr/bin/env node
// Reset a running app: POST /api/reset clears the current job and its plan, the audit history, the Mock world (the made-up people go back to
// their start) and the Real writes switch. Nothing in a PingOne environment or a console is undone: this lab never deletes. The UI Reset
// button also puts the diagram boxes back where they started; a script cannot move boxes in a browser tab.
//   node scripts/reset.mjs [base-url]      (default http://127.0.0.1:${PORT:-7817})
// Loopback only: refuses any other host. Needs the server already running; sends the same-origin header the server requires.
import { pathToFileURL } from 'node:url';
import { isLoopbackHost } from '../server/src/security.js';

export async function reset(base = `http://127.0.0.1:${process.env.PORT || 7817}`) {
  const u = new URL(base);
  if (!isLoopbackHost(u.hostname)) throw new Error(`refusing ${u.hostname}: loopback only`);
  const r = await fetch(new URL('/api/reset', u), { method: 'POST', headers: { 'content-type': 'application/json', origin: u.origin }, body: '{}' });
  if (!r.ok) throw new Error(`reset failed: HTTP ${r.status}`);
  return r.json();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  reset(process.argv[2]).then(() => console.log('reset: ok'), (e) => { console.error(e.message); process.exit(1); });
}
