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

async function signup() {
  const u = 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const r = await fetch(base + '/api/signup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: u, email: `${u}@example.test`, password: 'Passw0rd!long' }) });
  return (r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get('set-cookie')]).map((c) => c.split(';')[0]).join('; ');
}
test('uploads: content purpose accepted, unknown purpose normalised, video refused, limits exposed', { skip }, async () => {
  const cookie = await signup();
  const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
  const up = (purpose, type, body) => fetch(`${base}/api/files?purpose=${purpose}`, { method: 'POST', headers: { cookie, 'content-type': type, 'x-file-name': 'a.png' }, body });
  assert.equal((await up('content', 'image/png', png)).status, 200);
  assert.equal((await up('weird-thing', 'image/png', png)).status, 200);
  const v = await up('content', 'video/mp4', png); assert.equal(v.status, 415); assert.match((await v.json()).error, /YouTube/);
  const big = await up('post', 'image/png', Buffer.alloc(9 * 1024 * 1024)); assert.equal(big.status, 413); assert.match((await big.json()).error, /MB/);
  const cfg = await (await fetch(base + '/api/config')).json();
  assert.equal(typeof cfg.storage.limits.image, 'number');
  assert.ok(cfg.ai.providers.every((p) => typeof p === 'object'));
});
test('whiteboards: create, list, rename, save pages, delete', { skip }, async () => {
  const cookie = await signup();
  const j = (p, method = 'GET', body) => fetch(base + p, { method, headers: { cookie, 'content-type': 'application/json' }, body: body && JSON.stringify(body) }).then(async (r) => ({ s: r.status, b: await r.json() }));
  const a = await j('/api/whiteboards', 'POST', { title: 'Sermon notes' }); assert.equal(a.s, 200);
  const b2 = await j('/api/whiteboards', 'POST', { title: 'Sermon notes' }); assert.equal(b2.s, 200); assert.notEqual(a.b.id, b2.b.id);
  const put = await j(`/api/whiteboards/${a.b.id}`, 'PUT', { title: 'Renamed', data: { version: 2, pages: [{ strokes: [{ tool: 'pen', color: '#000', width: 2, points: [[1, 1], [5, 5]] }] }, { strokes: [] }] } });
  assert.equal(put.s, 200);
  const got = await j(`/api/whiteboards/${a.b.id}`); assert.equal(got.b.title, 'Renamed'); assert.equal(got.b.data.pages.length, 2);
  const list = await j('/api/whiteboards'); assert.ok(list.b.boards.length >= 2);
  assert.equal((await j(`/api/whiteboards/${b2.b.id}`, 'DELETE')).s, 200);
  assert.equal((await j(`/api/whiteboards/${b2.b.id}`)).s, 404);
});
