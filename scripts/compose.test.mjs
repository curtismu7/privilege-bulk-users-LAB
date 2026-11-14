// Real can create people in a PingOne environment: every published port must be bound to loopback on the host, the container is
// hardened, the settings come from the lab's own optional .env, and no secret is in a container file. Pattern from hostile-mcp.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { DEFAULT_PORT, realRefusal } from '../server/src/config.js';

// A small line parser (no YAML dependency): the list items under each `ports:` key.
export function publishedPorts(text) {
  const out = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)ports:\s*$/.exec(lines[i]);
    if (!m) continue;
    for (let j = i + 1; j < lines.length; j++) {
      const item = /^\s*-\s*["']?([^"'\s#]+)["']?/.exec(lines[j]);
      if (!item || lines[j].search(/\S/) <= m[1].length) break;
      out.push(item[1]);
    }
  }
  return out;
}
const compose = fs.readFileSync(new URL('../docker-compose.yml', import.meta.url), 'utf8');
const dockerfile = fs.readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8');
const code = (t) => t.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');

test(`docker-compose.yml publishes only on 127.0.0.1, mapping to the container port ${DEFAULT_PORT}`, () => {
  const ports = publishedPorts(compose);
  assert.equal(ports.length, 1, 'exactly one published port');
  for (const p of ports) assert.match(p, new RegExp(`^127\\.0\\.0\\.1:(\\$\\{HOST_PORT:-${DEFAULT_PORT}\\}|\\d+):${DEFAULT_PORT}$`), `${p} must start with 127.0.0.1: and map to ${DEFAULT_PORT}`);
});
test('the parser flags an unbound or wildcard publish', () => {
  for (const bad of ['- "7817:7817"', '- "0.0.0.0:7817:7817"', '- 7817', '- "[::]:7817:7817"']) {
    const ports = publishedPorts(`services:\n  a:\n    ports:\n      ${bad}\n`);
    assert.equal(ports.length, 1);
    assert.doesNotMatch(ports[0], /^127\.0\.0\.1:/);
  }
});
test('the container hardening stays: non-root, read-only, no capabilities, no new privileges, restart policy, health check on /api/health', () => {
  assert.equal((dockerfile.match(/^FROM node:26-alpine/gm) || []).length, 2, 'both stages are Node 26');
  assert.match(dockerfile, /^USER node$/m);
  assert.match(compose, /read_only:\s*true/);
  assert.match(compose, /cap_drop:\s*\[ALL\]/);
  assert.match(compose, /no-new-privileges:true/);
  assert.match(compose, /^    restart: unless-stopped$/m, 'a long-running lab comes back after a Docker restart (rule 21)');
  assert.match(compose, new RegExp(`healthcheck:[\\s\\S]*127\\.0\\.0\\.1:${DEFAULT_PORT}/api/health[\\s\\S]*demo-health/1`), 'the health check reads the demo-health/1 contract');
});
test('settings come from the .env beside the compose file, and the file is optional so Mock works with none', () => {
  assert.match(compose, /^    env_file:\n      - path: \.env\n        required: false$/m);
  assert.ok(!/\bBULK_[A-Z0-9_]+/.test(code(compose)), 'no setting name is passed through compose: the env_file carries them');
  assert.ok(!/\.\.?\//.test(code(compose)), 'the env file and the volumes are beside the compose file or named: no path outside it');
});
test('no secret value in the container files', () => {
  const scrubbed = (compose + dockerfile).replace(/\$\{[^}]*\}/g, 'PASS_THROUGH');
  assert.doesNotMatch(scrubbed, /(SECRET|API_KEY|CLIENT_ID|PASSWORD|TOKEN)\s*[:=]\s*["']?(?!PASS_THROUGH\b)[A-Za-z0-9][A-Za-z0-9/_-]{8,}/i, 'no literal credential value in the container files');
});
// The environment a container gets, read from the two files: the image's ENV lines, and the compose file's `environment:` map on top.
const imageEnv = () => {
  const env = {};
  for (const line of code(dockerfile).split('\n')) {
    const m = /^ENV\s+(.+)$/.exec(line.trim());
    if (m) for (const [, k, v] of m[1].matchAll(/([A-Z][A-Z0-9_]*)=(\S*)/g)) env[k] = v;
  }
  return env;
};
const composeEnv = () => {
  const env = {};
  const block = /^ {4}environment:\n((?: {6}\S.*\n)+)/m.exec(compose)?.[1] ?? '';
  for (const [, k, v] of block.matchAll(/^ {6}([A-Z][A-Z0-9_]*):\s*(.*)$/gm)) if (!v.includes('${')) env[k] = v.replace(/^"|"$/g, '');
  return env;
};

test('the image opts in to a wide bind but NOT to the container marker; compose adds the marker, and only with the loopback publish', () => {
  assert.match(dockerfile, /^ENV PBU_BIND=0\.0\.0\.0$/m);
  assert.doesNotMatch(code(dockerfile), /PBU_CONTAINER/, 'a bare docker run of the image must not satisfy the Real loopback guard');
  assert.match(compose, /PBU_BIND:\s*0\.0\.0\.0/);
  assert.match(compose, /PBU_CONTAINER:\s*"1"/);
  assert.equal(publishedPorts(compose).length, 1);
  assert.match(publishedPorts(compose)[0], /^127\.0\.0\.1:/, 'the marker travels with a loopback-only publish');
  assert.match(compose, /LAB_ALLOWED_HOSTS:/);
});
test('with the real guard function: a bare run of the image refuses Real, the compose environment accepts it', () => {
  const optIn = { PRIVILEGE_BULK_MODE: 'real' }; // what the owner's .env adds
  assert.deepEqual(realRefusal({ ...imageEnv(), ...optIn })?.failed, ['loopback-bind'], 'docker run of the image alone: wide bind, no marker, Real refused');
  assert.equal(realRefusal({ ...imageEnv(), ...composeEnv(), ...optIn }), null, 'compose: wide bind plus the marker (published on 127.0.0.1 only)');
  assert.deepEqual(realRefusal(imageEnv())?.failed, ['owner-opt-in', 'loopback-bind'], 'and without the opt-in Real is refused anyway');
});
test(`the port is ${DEFAULT_PORT} everywhere: the image, the environment, the health check`, () => {
  assert.match(dockerfile, new RegExp(`^ENV NODE_ENV=production PORT=${DEFAULT_PORT} PBU_DATA_DIR=/data$`, 'm'));
  assert.match(dockerfile, new RegExp(`^EXPOSE ${DEFAULT_PORT}$`, 'm'));
  assert.match(compose, new RegExp(`PORT: "${DEFAULT_PORT}"`));
});
test('the image carries what the server needs: the sources, the diagram data and the built web app; and no spec catalog or .env', () => {
  assert.match(dockerfile, /^COPY server\/src server\/src$/m);
  assert.match(dockerfile, /^COPY server\/diagrams server\/diagrams$/m);
  assert.match(dockerfile, /^COPY --from=web \/app\/web\/dist web\/dist$/m);
  assert.doesNotMatch(dockerfile, new RegExp(`${['spec', 'catalog'].join('-')}|COPY \\.env`));
});
test('the compose file is Docker only: no k8s, no host mounts, no docker socket, no host network', () => {
  assert.doesNotMatch(compose, /network_mode|docker\.sock|privileged/);
  assert.doesNotMatch(code(compose), /^\s*-\s*["']?(?:\.{1,2}\/|~\/|\/[^\s:]*:)/m, 'no bind mount of a host path');
  assert.doesNotMatch(compose + dockerfile, /__IMAGE__|__SE_HOST__|kubectl/);
});
