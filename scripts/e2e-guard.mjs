// Preloaded into the server the e2e starts (node --import): installs the shipped netguard before anything else runs (server/src/index.js
// gets this same instance, it installs once per process) and writes its attempts, every refused non-loopback connection, to E2E_GUARD_FILE on exit.
import fs from 'node:fs';
import { installNetguard } from '../server/src/netguard.js';

const g = installNetguard();
process.on('exit', () => { try { fs.writeFileSync(process.env.E2E_GUARD_FILE, JSON.stringify(g.attempts)); } catch { /* nothing to record */ } });
