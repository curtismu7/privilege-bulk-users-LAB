import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { port as configPort } from './config.js';
import { allPassed, runChecks } from './doctor.js';
import { installNetguard } from './netguard.js';
import { applySettings } from './settings.js';
import { assertBindAllowed, bindHost } from './security.js';

// Boot on `port` (0 = ephemeral). Refuses a non-loopback host unless PBU_BIND is set.
export function startHttpServer({ port = configPort(), host = bindHost(), app = createApp() } = {}) {
  assertBindAllowed(host);
  return new Promise((resolve, reject) => {
    const server = app.listen(port, host);
    server.once('error', reject);
    server.once('listening', () => {
      const { port: bound } = server.address();
      resolve({ port: bound, url: `http://127.0.0.1:${bound}/`, close: async () => { await app.locals.close(); await new Promise((r) => { server.closeAllConnections?.(); server.close(r); }); } });
    });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  applySettings(); // this lab's own .env beside docker-compose.yml (BULK_ENV_FILE overrides): only the listed names are taken
  installNetguard(); // zero outbound by default; before anything else can open a socket. Live takes a permit per host (app.js).
  const checks = runChecks();
  if (!allPassed(checks)) {
    for (const c of checks.filter((x) => x.level === 'fail')) console.error(`[pbu] refusing to start: ${c.id}: ${c.detail}`);
    process.exit(1);
  }
  const { url } = await startHttpServer();
  console.log(`[pbu] listening on ${url} (loopback unless PBU_BIND is set)`);
  process.on('SIGTERM', () => process.exit(0));
}
