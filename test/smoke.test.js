'use strict';
// End-to-end smoke test of the assembled app: boots server.js and walks one request through
// each layer (health, readiness, feature JSON routes, feature raw handlers, core routes,
// generated feature assets, static shell). Needs DATABASE_URL (or TEST_BASE_URL).
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');

let base = process.env.TEST_BASE_URL;
let child;
const skip = !base && !process.env.DATABASE_URL && process.env.DB_DRIVER !== 'sqlite' ? 'set TEST_BASE_URL or DATABASE_URL' : false;

test.before(async () => {
  if (skip || base) return;
  const port = 4010 + Math.floor(Math.random() * 40);
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(port), AI_MOCK: 'true', JWT_SECRET: process.env.JWT_SECRET || 'test-secret', PUBLIC_URL: base }, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(base + '/health')).ok) return; } catch {} await new Promise((r) => setTimeout(r, 250)); }
  throw new Error('server did not start');
});
test.after(() => child && child.kill());

test('smoke: every layer answers', { skip }, async () => {
  assert.equal((await fetch(base + '/health')).status, 200);
  assert.equal((await fetch(base + '/ready')).status, 200);

  // feature JSON route (events) and core route (config)
  const cats = await fetch(base + '/api/categories');
  assert.equal(cats.status, 200);
  assert.equal((await fetch(base + '/api/config')).status, 200);

  // sign up, then a signed-in feature route (dashboard) and a raw feature handler (schedule)
  const u = 's' + Date.now().toString(36);
  const r = await fetch(base + '/api/signup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: u, email: `${u}@ex.test`, password: 'Passw0rd!long', phone: '+2348031234567', country: 'NG' }) });
  assert.ok(r.ok, 'signup ' + r.status);
  const cookie = r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  assert.equal((await fetch(base + '/api/dashboard', { headers: { cookie } })).status, 200);
  assert.equal((await fetch(base + '/api/dashboard')).status, 401);

  // core room flow: create a meeting and read it back
  const created = await fetch(base + '/api/create', { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ name: 'Smoke test', hostName: 'Smoke Host' }) });
  assert.ok(created.ok, 'create ' + created.status);
  const { code } = await created.json();
  assert.ok(code);
  assert.equal((await fetch(base + '/api/meeting/' + code)).status, 200);

  // generated feature assets
  const js = await (await fetch(base + '/features/client.js')).text();
  assert.match(js, /import '\/features\/chat\/ws\.js';/);
  const polls = await fetch(base + '/features/polls/ws.js');
  assert.equal(polls.status, 200);
  assert.match(polls.headers.get('content-type'), /javascript/);
  assert.equal((await fetch(base + '/features/polls/..%2F..%2Fdata.js')).status, 404);
  assert.equal((await fetch(base + '/features/_template/ws.js')).status, 404);
  assert.equal((await fetch(base + '/features/features.css')).status, 200);
  for (const f of ['readout.js', 'lang.js']) {
    const r = await fetch(base + '/features/tts/' + f);
    assert.equal(r.status, 200, f);
    assert.doesNotMatch(await r.text(), /REPLICATE_API_TOKEN|r8_/, 'no token in client code');
  }
  assert.doesNotMatch(js, /features\/tts\/ws\.js/, 'tts has no socket client');

  // static shell + unknown API
  assert.equal((await fetch(base + '/')).status, 200);
  assert.equal((await fetch(base + '/api/definitely-not-a-route')).status, 404);
});
