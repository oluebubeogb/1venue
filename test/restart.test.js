'use strict';
require('./helpers/server');
// Graceful restart: SIGTERM snapshots live rooms instead of ending them, clients get
// "server-restarting", and a fresh process restores the room when they reconnect.
// Needs DATABASE_URL (skipped otherwise).
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const WebSocket = require('ws');

const skip = !process.env.DATABASE_URL && process.env.DB_DRIVER !== 'sqlite' ? 'set DATABASE_URL' : false;
const port = 4060 + Math.floor(Math.random() * 30);
const base = `http://127.0.0.1:${port}`;
const env = { ...process.env, PORT: String(port), AI_MOCK: 'true', JWT_SECRET: 'restart-test-secret', PUBLIC_URL: base, SHUTDOWN_GRACE_MS: '300' };

async function boot() {
  const child = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.out = '';
  child.stdout.on('data', (d) => { child.out += d; });
  child.stderr.on('data', (d) => { child.out += d; });
  for (let i = 0; i < 80; i++) { try { if ((await fetch(base + '/health')).ok) return child; } catch {} await new Promise((r) => setTimeout(r, 200)); }
  throw new Error('server did not start\n' + child.out);
}
function connect(code, participantId, wsCredential) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/`);
  ws.msgs = [];
  ws.on('message', (d) => ws.msgs.push(JSON.parse(d.toString())));
  ws.closed = new Promise((r) => ws.on('close', (c) => r(c)));
  return new Promise((resolve, reject) => {
    ws.on('open', () => { ws.send(JSON.stringify({ type: 'register', code, participantId, wsCredential })); resolve(ws); });
    ws.on('error', reject);
  });
}
const waitFor = async (fn, ms = 4000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = fn(); if (v) return v; await new Promise((r) => setTimeout(r, 50)); } return null; };
const post = (p, body) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));

test('SIGTERM keeps the meeting live and a new process restores it on reconnect', { skip, timeout: 60000 }, async () => {
  let server = await boot();
  try {
    const created = await post('/api/create', { name: 'Restart check', participantName: 'Host Person' });
    assert.equal(created.status, 200);
    const { code, participantId: hostId, wsCredential: hostCred } = created.body;
    const joined = await post('/api/join', { code, participantName: 'Guest Person' });
    assert.equal(joined.status, 200);
    const host = await connect(code, hostId, hostCred);
    assert.ok(await waitFor(() => host.msgs.find((m) => m.type === 'participants')), 'host registered');
    host.send(JSON.stringify({ type: 'chat', text: 'before restart' }));
    assert.ok(await waitFor(() => host.msgs.find((m) => m.type === 'chat')), 'chat echoed');

    server.kill('SIGTERM');
    const closeCode = await host.closed;
    assert.equal(closeCode, 1012, 'closed with Service Restart');
    assert.ok(host.msgs.find((m) => m.type === 'server-restarting'), 'got server-restarting');
    await new Promise((r) => server.on('exit', r));
    assert.doesNotMatch(server.out, /\(server-restart\)/, 'meeting was not ended');

    server = await boot();
    const again = await connect(code, hostId, hostCred);
    const roster = await waitFor(() => again.msgs.find((m) => m.type === 'participants'));
    assert.ok(roster, 'restored room accepts the old credential\n' + server.out);
    assert.equal(roster.self.role, 'host');
    const hist = await waitFor(() => again.msgs.find((m) => m.type === 'chat-history'));
    assert.ok(hist && hist.messages.some((m) => m.text === 'before restart'), 'chat history restored');
    const meeting = await fetch(`${base}/api/meeting/${code}`).then((r) => r.json());
    assert.equal(meeting.name, 'Restart check');
    again.close();
  } finally {
    server.kill('SIGKILL');
  }
});
