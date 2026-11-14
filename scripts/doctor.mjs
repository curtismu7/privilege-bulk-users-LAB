// Preflight: the same checks GET /api/health reports from, plus the netguard self-test and whether the port is free.
//   PORT=7890 npm run doctor        (the server port; 7800-7999 only)
// Reads this lab's own .env (BULK_ENV_FILE overrides the path) the way the server does, and prints only pass/fail lines and setting NAMES,
// never the value of a setting. Exit 1 on any failure. Needs no network.
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const load = (rel) => import(pathToFileURL(path.join(root, rel)));
const { applySettings } = await load('server/src/settings.js');
applySettings(); // this lab's own .env: only the names in SETTING_KEYS are taken

const { runChecks } = await load('server/src/doctor.js');
const { PORT_MAX, PORT_MIN, port: configPort } = await load('server/src/config.js');
const { netguardSelfTest } = await load('server/src/netguard.js');
let failed = 0;
const report = (level, name, detail) => {
  if (level === 'fail') failed++;
  console.log(`${level.toUpperCase().padEnd(4)}  ${name}: ${detail}`);
};

for (const c of runChecks()) report(c.level, c.id, c.detail);

const guard = await netguardSelfTest();
report(guard.ok ? 'pass' : 'fail', 'netguard', guard.ok ? 'self-test: fetch, sockets, DNS and UDP out are all refused' : guard.detail);

const port = configPort();
await new Promise((resolve) => {
  const s = net.createServer();
  s.once('error', (e) => { report('fail', 'port', `${port} is not free (${e.code}). Set PORT to a free port in ${PORT_MIN}-${PORT_MAX}`); resolve(); });
  s.listen(port, '127.0.0.1', () => s.close(() => { report('pass', 'port', `${port} is free`); resolve(); }));
});
process.exit(failed ? 1 : 0);
