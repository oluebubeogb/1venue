'use strict';
// Username / phone rules and the client-side Google 404 fix (SPA + service worker).
// These do not need DATABASE_URL.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseUsername, isValidUsername } = require('../src/features/auth/username');
const { normalizePhone } = require('../src/features/auth/phone');

const root = path.join(__dirname, '..');

test('username: 3–30 lowercase letters, digits, underscore or period; reserved names rejected', () => {
  assert.equal(parseUsername('Ada_Lovelace').ok, true);
  assert.equal(parseUsername('Ada_Lovelace').username, 'ada_lovelace');
  assert.equal(isValidUsername('a.b_c1'), true);
  assert.equal(isValidUsername('ab'), false);
  assert.equal(parseUsername('ab').reason, 'too_short');
  assert.equal(isValidUsername('a'.repeat(31)), false);
  assert.equal(parseUsername('a'.repeat(31)).reason, 'too_long');
  assert.equal(parseUsername('.dotty').reason, 'invalid');
  assert.equal(parseUsername('dotty.').reason, 'invalid');
  assert.equal(parseUsername('dot..ty').reason, 'invalid');
  assert.equal(parseUsername('Has Space').reason, 'invalid');
  assert.equal(parseUsername('hello!').reason, 'invalid');
  for (const n of ['admin', 'support', 'help', 'api', 'www', 'root', '1venue', 'settings', 'login', 'signup', 'privacy', 'terms']) {
    const r = parseUsername(n);
    assert.equal(r.ok, false, n);
    assert.equal(r.reason, 'reserved', n);
  }
  assert.equal(parseUsername('').reason, 'required');
});

test('phone: Nigeria default, E.164 storage, invalid numbers rejected', () => {
  const ok = normalizePhone('08031234567', 'NG');
  assert.equal(ok.ok, true);
  assert.equal(ok.e164, '+2348031234567');
  assert.equal(ok.country, 'NG');
  assert.equal(normalizePhone('+2348031234567').e164, '+2348031234567');
  assert.equal(normalizePhone('').reason, 'required');
  assert.equal(normalizePhone('123', 'NG').ok, false);
  assert.equal(normalizePhone('not-a-number', 'NG').ok, false);
});

test('service worker treats /auth/* as network-only and is bumped to v17', () => {
  const sw = fs.readFileSync(path.join(root, 'public/sw.js'), 'utf8');
  assert.match(sw, /const VERSION = 'v17-2026-11-14'/);
  assert.match(sw, /pathname\.startsWith\('\/auth\/'\)/);
});

test('SPA click interceptor does not capture /auth/* (full-page Google start)', () => {
  const app = fs.readFileSync(path.join(root, 'public/js/app.js'), 'utf8');
  assert.match(app, /pathname\.startsWith\('\/auth\/'\)/);
  const login = fs.readFileSync(path.join(root, 'public/js/pages/login.js'), 'utf8');
  assert.match(login, /\/auth\/google\/start\?next=/);
});
