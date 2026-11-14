// A coded error for the things that stop a whole job (a name the page shows, never a blank). Per-person failures are NOT errors:
// they become a failed row and the run goes on.
import { clip, scrub } from './redact.js';

export class BulkError extends Error {
  constructor(code, message, extra = {}) { super(message); this.name = 'BulkError'; this.code = code; Object.assign(this, extra); }
}

// An upstream's `code` is shown only when it looks like a code (PingOne's are upper-case words such as ACCESS_FAILED). Anything else, such
// as an echoed header or a token, is dropped: a server-supplied string is never trusted to be free of what we sent it.
const CODE = /^[A-Z][A-Z0-9_]{2,40}$/;
export const safeCode = (r) => (r?.json && typeof r.json.code === 'string' && CODE.test(r.json.code) ? r.json.code : '');

// One line saying what an upstream answer was, for a row's `detail`. Scrubbed first and clipped after, so a secret cut by the clip
// cannot leave a prefix behind.
export function describe(r, secrets = []) {
  if (!r) return 'no answer';
  if (r.status === 0) return clip(scrub(`no answer (${String(r.error || 'network error').replace(/[^A-Za-z0-9_ .:-]/g, '?')})`, secrets), 80);
  const code = safeCode(r);
  return clip(scrub(`HTTP ${r.status}${code ? ` ${code}` : ''}`, secrets), 80);
}

export const isUniqueness = (r) => (r.status === 400 || r.status === 409) && /UNIQUENESS|already.?exist/i.test(JSON.stringify(r.json ?? r.text ?? ''));
