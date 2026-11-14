import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { installNetguard } from './netguard.js';

test('test netguard: blocks and records a non-loopback fetch and socket, allows loopback', async () => {
  const g = installNetguard();
  try {
    await assert.rejects(fetch('https://example.invalid/x'), /netguard/);
    await assert.rejects(fetch('https://auth.pingone.com/x'), /netguard/);
    assert.deepEqual(g.attempts.map((a) => a.host), ['example.invalid', 'auth.pingone.com']);
    const net = await import('node:net');
    assert.throws(() => net.connect({ host: '203.0.113.9', port: 80 }), /netguard/);
    assert.equal(g.attempts.at(-1).via, 'socket');
    g.attempts.length = 0;
    const srv = http.createServer((_q, r) => { r.statusCode = 404; r.end('{}'); });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    try { assert.equal((await fetch(`http://127.0.0.1:${srv.address().port}/nothing`)).status, 404); } finally { srv.closeAllConnections?.(); await new Promise((r) => srv.close(r)); }
    assert.equal(g.attempts.length, 0, 'loopback traffic is not an attempt');
  } finally { g.restore(); }
});
