'use strict';
// /metrics (Prometheus), the periodic log line, and the WebSocket heartbeat that feeds the
// dead-socket counter. Boots its own server with METRICS_TOKEN set; needs DATABASE_URL.
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const WebSocket = require('ws');

const skip = !process.env.DATABASE_URL ? 'set DATABASE_URL' : false;

// A port the OS says is free right now (random ranges collided between parallel test files).
const freePort = () => new Promise((resolve, reject) => {
  const srv = require('node:net').createServer();
  srv.once('error', reject);
  srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
});
// kill and wait for the exit, so the next test never talks to a server that is still shutting down
const stop = (child) => new Promise((resolve) => { if (child.exitCode !== null || child.signalCode) return resolve(); child.once('exit', resolve); child.kill(); });

async function boot(extraEnv) {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(port), JWT_SECRET: 'test-secret', PUBLIC_URL: base, AI_MOCK: 'true', ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  const ready = (async () => {
    for (let i = 0; i < 60; i++) { try { if ((await fetch(base + '/health')).ok) return; } catch {} await new Promise((r) => setTimeout(r, 250)); }
    throw new Error('server did not start: ' + out);
  })();
  return { base, port, child, ready, output: () => out };
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('metrics module renders Prometheus text and a compact log line', () => {
  const m = require('../src/core/metrics');
  const s = { rss: 104857600, heapUsed: 52428800, heapTotal: 73400320, liveRooms: 2, participants: 5, sockets: 6, deadSockets: 3, uptime: 42 };
  const text = m.prometheus(s);
  for (const line of ['process_resident_memory_bytes 104857600', 'nodejs_heap_used_bytes 52428800', 'nodejs_heap_total_bytes 73400320', 'venue_live_rooms 2',
    'venue_connected_participants 5', 'venue_open_websockets 6', 'venue_ws_dead_sockets_terminated_total 3', 'process_uptime_seconds 42']) {
    assert.ok(text.includes('\n' + line + '\n') || text.startsWith(line + '\n'), line);
  }
  assert.match(text, /# TYPE venue_ws_dead_sockets_terminated_total counter/);
  assert.equal(m.logLine(s), '[metrics] rss=100MB heap=50/70MB rooms=2 participants=5 sockets=6 dead_sockets_total=3 uptime=42s');
});

test('/metrics is 404 when METRICS_TOKEN is unset', { skip }, async () => {
  const s = await boot({ METRICS_TOKEN: '', METRICS_LOG: 'false' });
  try {
    await s.ready;
    assert.equal((await fetch(s.base + '/metrics')).status, 404);
    assert.equal((await fetch(s.base + '/metrics', { headers: { authorization: 'Bearer x' } })).status, 404);
  } finally { await stop(s.child); }
});

test('/metrics needs the bearer token; counts sockets, dead sockets; logs once per interval', { skip }, async () => {
  const s = await boot({ METRICS_TOKEN: 'tok-123', METRICS_LOG_INTERVAL_MS: '300', WS_HEARTBEAT_MS: '200' });
  const sockets = [];
  try {
    await s.ready;
    assert.equal((await fetch(s.base + '/metrics')).status, 401);
    assert.equal((await fetch(s.base + '/metrics', { headers: { authorization: 'Bearer wrong' } })).status, 401);

    // one healthy socket (answers pings) and one dead one (never answers)
    const alive = new WebSocket(`ws://127.0.0.1:${s.port}/`);
    const dead = new WebSocket(`ws://127.0.0.1:${s.port}/`, { autoPong: false });
    sockets.push(alive, dead);
    await Promise.all(sockets.map((w) => new Promise((r, j) => { w.once('open', r); w.once('error', j); })));
    const deadClosed = new Promise((r) => dead.once('close', r));

    const r1 = await fetch(s.base + '/metrics', { headers: { authorization: 'Bearer tok-123' } });
    assert.equal(r1.status, 200);
    assert.match(r1.headers.get('content-type'), /^text\/plain; version=0\.0\.4/);
    const t1 = await r1.text();
    assert.match(t1, /^venue_open_websockets 2$/m);
    assert.match(t1, /^venue_live_rooms \d+$/m);
    assert.match(t1, /^process_resident_memory_bytes \d+$/m);

    await deadClosed; // terminated by the heartbeat after missing a round
    const t2 = await (await fetch(s.base + '/metrics', { headers: { authorization: 'Bearer tok-123' } })).text();
    assert.match(t2, /^venue_ws_dead_sockets_terminated_total [1-9]\d*$/m);
    assert.match(t2, /^venue_open_websockets 1$/m);
    assert.equal(alive.readyState, WebSocket.OPEN, 'a socket that answers pings stays open');

    await wait(400);
    assert.match(s.output(), /\[metrics\] rss=\d+MB heap=\d+\/\d+MB rooms=\d+ participants=\d+ sockets=\d+ dead_sockets_total=\d+ uptime=\d+s/);
  } finally {
    sockets.forEach((w) => { try { w.terminate(); } catch {} });
    await stop(s.child);
  }
});

test('METRICS_LOG=false turns the log line off', { skip }, async () => {
  const s = await boot({ METRICS_TOKEN: '', METRICS_LOG: 'false', METRICS_LOG_INTERVAL_MS: '200' });
  try {
    await s.ready;
    await wait(500);
    assert.doesNotMatch(s.output(), /\[metrics\]/);
  } finally { await stop(s.child); }
});
