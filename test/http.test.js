'use strict';
// HTTP smoke tests. Uses TEST_BASE_URL if set, otherwise boots the server
// (needs DATABASE_URL pointing at a reachable Postgres); skipped when neither.
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');

let base = process.env.TEST_BASE_URL;
let child;
const skip = !base && !process.env.DATABASE_URL ? 'set TEST_BASE_URL or DATABASE_URL' : false;

test.before(async () => {
  if (skip || base) return;
  const port = 3990 + Math.floor(Math.random() * 9);
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(port), AI_MOCK: 'true', JWT_SECRET: process.env.JWT_SECRET || 'test-secret', PUBLIC_URL: base }, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(base + '/health')).ok) return; } catch {} await new Promise((r) => setTimeout(r, 250)); }
  throw new Error('server did not start');
});
test.after(() => child && child.kill());

test('GET /health', { skip }, async () => {
  const r = await fetch(base + '/health'); assert.equal(r.status, 200);
  const j = await r.json(); assert.equal(j.ok, true); assert.equal(j.db, 'postgresql');
});
test('GET /api/config', { skip }, async () => {
  const r = await fetch(base + '/api/config'); assert.equal(r.status, 200); assert.equal(typeof (await r.json()), 'object');
});
test('static shell, manifest, service worker, logo', { skip }, async () => {
  for (const p of ['/', '/discover', '/manifest.webmanifest', '/sw.js', '/brand/logo.svg', '/icons/icon-192.png']) {
    const r = await fetch(base + p); assert.equal(r.status, 200, p);
  }
});
test('optional event lookup by room code returns null, strict returns 404', { skip }, async () => {
  assert.equal(await (await fetch(base + '/api/events/NOPE99?optional=1')).json(), null);
  assert.equal((await fetch(base + '/api/events/NOPE99')).status, 404);
});
test('local signup sets session cookie, /api/me works', { skip }, async () => {
  const u = 't' + Date.now().toString(36);
  const r = await fetch(base + '/api/signup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: u, email: `${u}@example.test`, password: 'Passw0rd!long' }) });
  assert.equal(r.status, 201);
  const cookie = (r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get('set-cookie')]).map((c) => c.split(';')[0]).join('; ');
  const me = await fetch(base + '/api/me', { headers: { cookie } }); assert.equal(me.status, 200);
});
