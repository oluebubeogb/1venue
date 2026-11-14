'use strict';
// Local accounts end to end: sign-up, verification, sign-in, refresh rotation + reuse detection,
// sessions, sign out everywhere, forgot/reset, change password/email, imported users without a password,
// AUTH_REQUIRE_VERIFIED_EMAIL, rate limits, CANONICAL_HOST. Needs DATABASE_URL.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { boot, client, signupPayload } = require('./helpers/server');

const skip = !process.env.DATABASE_URL && process.env.DB_DRIVER !== 'sqlite' ? 'set DATABASE_URL' : false;
const uid = () => 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const tokenOf = (link) => new URL(link).searchParams.get('token');
let db;
test.before(() => { if (!skip) db = require('../db'); });
test.after(async () => { if (db) await db.close().catch(() => {}); });

test('sign up, verify email, sign in/out, generic errors, cookies', { skip }, async () => {
  const s = await boot();
  try {
    const u = uid(); const email = `${u}@ex.test`;
    const c = client(s.base);
    const su = await c.post('/api/signup', signupPayload({ email, password: 'correct horse 1', displayName: 'Ada L' }));
    assert.equal(su.status, 201);
    assert.equal(su.body.user.emailVerified, false);
    assert.match(su.body.user.username, /^[a-z0-9._]{3,30}$/);
    assert.equal(su.body.token, undefined, 'tokens never go to the page');
    const cookies = su.res.headers.getSetCookie();
    for (const name of ['1v_at=', '1v_rt=']) {
      const ck = cookies.find((x) => x.startsWith(name));
      assert.ok(ck, name);
      assert.match(ck, /HttpOnly/); assert.match(ck, /SameSite=Lax/); assert.match(ck, /Path=\//);
      assert.doesNotMatch(ck, /Domain=/i, 'host-only cookie');
    }
    assert.equal((await c.get('/api/me')).status, 200);
    const sess = await c.get('/api/session');
    assert.equal(sess.body.authenticated, true);
    assert.equal(sess.body.user.displayName, 'Ada L');

    // verification link (printed because SMTP is not configured in tests)
    const link = await s.mailLink(email, /Confirm your email/);
    assert.ok(link && link.startsWith(s.base + '/verify-email?token='), 'verify link uses PUBLIC_URL');
    assert.equal((await c.post('/api/auth/verify-email', { token: tokenOf(link) })).status, 200);
    assert.equal((await c.post('/api/auth/verify-email', { token: tokenOf(link) })).status, 400, 'single use');
    assert.equal((await c.get('/api/session')).body.user.emailVerified, true);

    // same email again: no account created, no hint on the page, owner is told by email
    const again = await client(s.base).post('/api/signup', signupPayload({ email: email.toUpperCase(), password: 'another pass 22' }));
    assert.equal(again.status, 202);
    assert.equal(again.body.checkEmail, true);
    assert.ok(await s.mailLink(email, /already have/));

    // weak password, bad email
    assert.equal((await client(s.base).post('/api/signup', { email: `${uid()}@ex.test`, password: 'short' })).status, 400);
    assert.equal((await client(s.base).post('/api/signup', { email: 'nope', password: 'long enough pass' })).status, 400);

    // sign-in failures look identical for unknown account and wrong password
    const wrong = await client(s.base).post('/api/login', { login: email, password: 'wrong password!' });
    const unknown = await client(s.base).post('/api/login', { login: `${uid()}@ex.test`, password: 'wrong password!' });
    assert.equal(wrong.status, 401); assert.equal(unknown.status, 401);
    assert.deepEqual(wrong.body, unknown.body);

    const c2 = client(s.base);
    const li = await c2.post('/api/login', { login: email, password: 'correct horse 1' });
    assert.equal(li.status, 200);
    assert.equal(li.body.user.email, email);
    const byName = await client(s.base).post('/api/login', { login: su.body.user.username, password: 'correct horse 1' });
    assert.equal(byName.status, 200, 'username works too');

    // sign out revokes the session server-side: the old access JWT stops working at once
    const stolen = c2.jar.clone();
    assert.equal((await c2.post('/api/logout')).status, 200);
    assert.equal((await c2.get('/api/me')).status, 401);
    assert.equal((await client(s.base, stolen).get('/api/me')).status, 401, 'copied cookies are dead after sign-out');
  } finally { await s.stop(); }
});

test('refresh token rotation, grace period, reuse detection; sessions; sign out everywhere', { skip }, async () => {
  const s = await boot();
  try {
    const email = `${uid()}@ex.test`;
    const a = client(s.base);
    assert.equal((await a.post('/api/signup', signupPayload({ email, password: 'rotate me please' }))).status, 201);
    const rt0 = a.jar.get('1v_rt');
    // access cookie expired (browser dropped it): only the refresh cookie is sent
    a.jar.delete('1v_at');
    const r1 = await a.get('/api/me');
    assert.equal(r1.status, 200);
    const rt1 = a.jar.get('1v_rt');
    assert.ok(rt1 && rt1 !== rt0, 'refresh token rotated');
    assert.ok(a.jar.get('1v_at'), 'new access token');
    const hashes = (await db.q('SELECT token_hash, prev_token_hash FROM auth_sessions WHERE user_id = (SELECT id FROM users WHERE email = $1)', [email])).rows;
    assert.ok(!JSON.stringify(hashes).includes(rt1), 'only hashes are stored');

    // a parallel request still holding the previous token is fine within the grace period
    const old = client(s.base); old.jar.set('1v_rt', rt0);
    assert.equal((await old.get('/api/me')).status, 200);
    // ...but after it, reuse means theft: the whole session is revoked
    await db.q(`UPDATE auth_sessions SET rotated_at = ${db.USE_PG ? "NOW() - interval '5 minutes'" : "strftime('%Y-%m-%dT%H:%M:%fZ','now','-5 minutes')"} WHERE user_id = (SELECT id FROM users WHERE email = $1)`, [email]);
    const thief = client(s.base); thief.jar.set('1v_rt', rt0);
    assert.equal((await thief.get('/api/me')).status, 401);
    a.jar.delete('1v_at');
    assert.equal((await a.get('/api/me')).status, 401, 'the legitimate holder is signed out too');

    // several devices
    const d1 = client(s.base); const d2 = client(s.base); const d3 = client(s.base);
    for (const d of [d1, d2, d3]) assert.equal((await d.post('/api/login', { login: email, password: 'rotate me please' })).status, 200);
    const list = await d1.get('/api/auth/sessions');
    assert.equal(list.body.sessions.length, 3);
    assert.equal(list.body.sessions.filter((x) => x.current).length, 1);
    const d2id = (await d2.get('/api/auth/sessions')).body.sessions.find((x) => x.current).id;
    assert.equal((await d1.del('/api/auth/sessions/' + d2id)).status, 200);
    assert.equal((await d2.get('/api/me')).status, 401, 'removed device is signed out');
    assert.equal((await d3.get('/api/me')).status, 200);
    const all = await d1.post('/api/auth/logout-all');
    assert.equal(all.body.signedOut, 2);
    assert.equal((await d3.get('/api/me')).status, 401);
    assert.equal((await d1.get('/api/me')).status, 401);
  } finally { await s.stop(); }
});

test('forgot / reset password: generic answer, single-use link, every session revoked', { skip }, async () => {
  const s = await boot();
  try {
    const email = `${uid()}@ex.test`;
    const a = client(s.base);
    await a.post('/api/signup', signupPayload({ email, password: 'first password 1' }));
    const other = client(s.base);
    await other.post('/api/login', { login: email, password: 'first password 1' });

    const known = await client(s.base).post('/api/auth/forgot', { email });
    const unknown = await client(s.base).post('/api/auth/forgot', { email: `${uid()}@ex.test` });
    assert.equal(known.status, 200); assert.deepEqual(known.body, unknown.body);
    const link = await s.mailLink(email, /Reset your/);
    assert.ok(link && link.includes('/reset-password?token='));

    const fresh = client(s.base);
    assert.equal((await fresh.post('/api/auth/reset', { token: tokenOf(link), password: 'tiny' })).status, 400, 'weak password refused; token not used up');
    const r = await fresh.post('/api/auth/reset', { token: tokenOf(link), password: 'second password 2' });
    assert.equal(r.status, 200);
    assert.equal(r.body.user.emailVerified, true, 'the link proved the inbox');
    assert.equal((await fresh.get('/api/me')).status, 200, 'signed in on this browser');
    assert.equal((await client(s.base).post('/api/auth/reset', { token: tokenOf(link), password: 'third password 3' })).status, 400, 'single use');
    assert.equal((await a.get('/api/me')).status, 401, 'old sessions revoked');
    assert.equal((await other.get('/api/me')).status, 401);
    assert.equal((await client(s.base).post('/api/login', { login: email, password: 'first password 1' })).status, 401);
    assert.equal((await client(s.base).post('/api/login', { login: email, password: 'second password 2' })).status, 200);

    // expired link (the previous link is aged past the 60 s resend throttle first)
    await db.q(`UPDATE auth_tokens SET created_at = ${db.USE_PG ? "NOW() - interval '2 minutes'" : "strftime('%Y-%m-%dT%H:%M:%fZ','now','-2 minutes')"} WHERE user_id = (SELECT id FROM users WHERE email = $1)`, [email]);
    await client(s.base).post('/api/auth/forgot', { email });
    const l2 = await s.mailLink(email, /Reset your/, { after: s.output().indexOf(link) + link.length });
    await db.q(`UPDATE auth_tokens SET expires_at = ${db.USE_PG ? "NOW() - interval '1 second'" : "strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 second')"} WHERE user_id = (SELECT id FROM users WHERE email = $1) AND used_at IS NULL`, [email]);
    assert.equal((await client(s.base).post('/api/auth/reset', { token: tokenOf(l2), password: 'fourth password 4' })).status, 400);
  } finally { await s.stop(); }
});

test('change password keeps this device, signs out others; change email needs the new inbox', { skip }, async () => {
  const s = await boot();
  try {
    const email = `${uid()}@ex.test`; const newEmail = `${uid()}@ex.test`;
    const a = client(s.base); const b = client(s.base);
    await a.post('/api/signup', signupPayload({ email, password: 'change me now 1' }));
    await b.post('/api/login', { login: email, password: 'change me now 1' });
    assert.equal((await a.post('/api/auth/change-password', { currentPassword: 'nope nope nope', newPassword: 'brand new pass 2' })).status, 400);
    const ch = await a.post('/api/auth/change-password', { currentPassword: 'change me now 1', newPassword: 'brand new pass 2' });
    assert.equal(ch.status, 200); assert.equal(ch.body.otherSessionsSignedOut, 1);
    assert.equal((await a.get('/api/me')).status, 200);
    assert.equal((await b.get('/api/me')).status, 401);

    assert.equal((await a.post('/api/auth/change-email', { email: newEmail, password: 'wrong wrong wrong' })).status, 400);
    const ce = await a.post('/api/auth/change-email', { email: newEmail, password: 'brand new pass 2' });
    assert.equal(ce.status, 200);
    assert.ok(await s.mailLink(email, /email is changing/).then((x) => x !== null), 'old address is told');
    const link = await s.mailLink(newEmail, /Confirm your email/);
    assert.ok(link);
    assert.equal((await a.get('/api/session')).body.user.email, email, 'unchanged until confirmed');
    assert.equal((await client(s.base).post('/api/auth/verify-email', { token: tokenOf(link) })).status, 200);
    const after = await a.get('/api/session');
    assert.equal(after.body.user.email, newEmail);
    assert.equal(after.body.user.emailVerified, true);
    assert.equal((await client(s.base).post('/api/login', { login: newEmail, password: 'brand new pass 2' })).status, 200);

    // changing to an address that already has an account answers the same, sends nothing
    const taken = `${uid()}@ex.test`;
    await client(s.base).post('/api/signup', signupPayload({ email: taken, password: 'someone else 1' }));
    await s.mailLink(taken, /Confirm your email/);
    const m = s.mark();
    const ce2 = await a.post('/api/auth/change-email', { email: taken, password: 'brand new pass 2' });
    assert.equal(ce2.status, 200);
    assert.equal(await s.mailLink(taken, /Confirm your email/, { after: m, timeout: 600 }), null);
  } finally { await s.stop(); }
});

test('Imported users: migration clears placeholder passwords and cleans usernames; sign-in sends set-password', { skip: skip || (process.env.DB_DRIVER === 'sqlite' ? 'PostgreSQL legacy import migrations' : false) }, async () => {
  const s = await boot();
  try {
    const bcrypt = require('bcryptjs');
    const tag = uid().slice(-6);
    const placeholder = bcrypt.hashSync('random-never-told', 8); // what ensureAccountsUser used
    const realLocal = bcrypt.hashSync('my real password 1', 10);
    const ins = async (username, email, hash, acc) => (await db.q('INSERT INTO users (username, email, password_hash, accounts_id) VALUES ($1,$2,$3,$4) RETURNING id', [username, email, hash, acc])).rows[0].id;
    const importedId = await ins(`u1a2b3c4d_ada${tag}`, `ada${tag}@ex.test`, placeholder, 'acc-' + tag);
    const linkedLocal = await ins(`bola${tag}`, `bola${tag}@ex.test`, realLocal, 'acc2-' + tag);
    const weird = await ins(`accounts:9f8e7d6c-${tag}`, `chi${tag}@ex.test`, placeholder, 'acc3-' + tag);
    await ins(`ada${tag}`, `other${tag}@ex.test`, realLocal, null); // takes the clean name first

    const dir = path.join(__dirname, '../src/features/auth/migrations');
    const m1 = fs.readFileSync(path.join(dir, '20261113230000_local_accounts.sql'), 'utf8');
    const m2 = fs.readFileSync(path.join(dir, '20261113230100_clean_collab_usernames.sql'), 'utf8');
    await db.q(m1); await db.q(m2); // both are safe to run again
    const row = async (id) => (await db.q('SELECT username, password_hash, needs_password_setup FROM users WHERE id = $1', [id])).rows[0];
    const ada = await row(importedId);
    assert.equal(ada.password_hash, null); assert.equal(ada.needs_password_setup, true);
    assert.equal(ada.username, `ada${tag}_2`, 'prefix removed; clean name was taken so a number is added');
    const bola = await row(linkedLocal);
    assert.ok(bola.password_hash, 'a real local password is kept'); assert.equal(bola.needs_password_setup, false);
    assert.equal((await row(weird)).username, `chi${tag}`, 'accounts:<id> falls back to the email name');

    // signing in with any password sends a set-password link; the answer stays generic
    const r = await client(s.base).post('/api/login', { login: `ada${tag}@ex.test`, password: 'whatever I used' });
    assert.equal(r.status, 401); assert.ok(r.body.hint);
    const link = await s.mailLink(`ada${tag}@ex.test`, /Set a password/);
    assert.ok(link && link.includes('/reset-password?token='));
    const c = client(s.base);
    assert.equal((await c.post('/api/auth/reset', { token: tokenOf(link), password: 'my new 1venue pass' })).status, 200);
    assert.equal((await client(s.base).post('/api/login', { login: `ada${tag}@ex.test`, password: 'my new 1venue pass' })).status, 200);
    assert.equal((await row(importedId)).needs_password_setup, false);
    // "forgot password" also works for them
    await client(s.base).post('/api/auth/forgot', { email: `chi${tag}@ex.test` });
    assert.ok(await s.mailLink(`chi${tag}@ex.test`, /Set a password/));
  } finally { await s.stop(); }
});

test('AUTH_REQUIRE_VERIFIED_EMAIL=true and rate limits', { skip }, async () => {
  const s = await boot({ AUTH_REQUIRE_VERIFIED_EMAIL: 'true', AUTH_RATE_PER_MIN: '8' });
  try {
    const email = `${uid()}@ex.test`;
    const c = client(s.base);
    const su = await c.post('/api/signup', signupPayload({ email, password: 'verify first 1' }));
    assert.equal(su.status, 202); assert.equal(su.body.checkEmail, true);
    assert.equal(c.jar.get('1v_rt'), undefined, 'no session before verifying');
    const li = await c.post('/api/login', { login: email, password: 'verify first 1' });
    assert.equal(li.status, 403); assert.equal(li.body.code, 'email-unverified');
    const link = await s.mailLink(email, /Confirm your email/);
    assert.equal((await c.post('/api/auth/verify-email', { token: tokenOf(link) })).status, 200);
    assert.equal((await c.post('/api/login', { login: email, password: 'verify first 1' })).status, 200);
    assert.equal((await c.get('/api/me')).status, 200);

    // per-account sign-in limit (max(3, 8/4) per minute), then 429
    const statuses = [];
    for (let i = 0; i < 4; i++) statuses.push((await client(s.base).post('/api/login', { login: 'nobody@ex.test', password: 'x'.repeat(10) })).status);
    assert.deepEqual(statuses, [401, 401, 401, 429]);
  } finally { await s.stop(); }
});

test('CANONICAL_HOST 301-redirects other hosts; health checks stay reachable', { skip }, async () => {
  const s = await boot({ CANONICAL_HOST: '1venue.example.com' });
  const get = (p, host) => new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: s.port, path: p, headers: { host } }, (res) => { res.resume(); resolve(res); }).on('error', reject);
  });
  try {
    const r = await get('/e/abc?x=1', 'www.1venue.example.com');
    assert.equal(r.statusCode, 301);
    assert.equal(r.headers.location, 'https://1venue.example.com/e/abc?x=1');
    assert.equal((await get('/health', 'www.1venue.example.com')).statusCode, 200);
    assert.equal((await get('/', '1venue.example.com')).statusCode, 200);
  } finally { await s.stop(); }
});


test('local signup requires a valid unique username and a valid phone', { skip }, async () => {
  const s = await boot();
  try {
    const base = { email: `${uid()}@ex.test`, password: 'correct horse 1', displayName: 'Ada L' };
    assert.equal((await client(s.base).post('/api/signup', signupPayload({ ...base, username: '' }))).status, 400);
    assert.equal((await client(s.base).post('/api/signup', signupPayload({ ...base, phone: '' }))).status, 400);
    assert.equal((await client(s.base).post('/api/signup', signupPayload({ ...base, username: 'admin' }))).status, 400);
    assert.equal((await client(s.base).post('/api/signup', signupPayload({ ...base, username: '.dotty' }))).status, 400);
    assert.equal((await client(s.base).post('/api/signup', signupPayload({ ...base, phone: '123', country: 'NG' }))).status, 400);

    const username = 'ada.' + uid().slice(0, 10);
    const c = client(s.base);
    const su = await c.post('/api/signup', signupPayload({ ...base, username, phone: '08031234567', country: 'NG' }));
    assert.equal(su.status, 201);
    assert.equal(su.body.user.username, username);
    const acc = await c.get('/api/auth/account');
    assert.equal(acc.status, 200);
    assert.equal(acc.body.user.phone, '+2348031234567');
    assert.equal(acc.body.user.phoneVerified, false);

    const taken = await client(s.base).post('/api/signup', signupPayload({ email: `${uid()}@ex.test`, password: 'correct horse 1', username }));
    assert.equal(taken.status, 409);

    const avail = await client(s.base).get('/api/auth/username-available?u=' + encodeURIComponent(username));
    assert.equal(avail.status, 200);
    assert.equal(avail.body.available, false);
    assert.equal(avail.body.reason, 'taken');
    assert.ok(Array.isArray(avail.body.suggestions) && avail.body.suggestions.length >= 1);

    const free = await client(s.base).get('/api/auth/username-available?u=' + encodeURIComponent('free_' + uid()));
    assert.equal(free.status, 200);
    assert.equal(free.body.available, true);

    const reserved = await client(s.base).get('/api/auth/username-available?u=support');
    assert.equal(reserved.body.available, false);
    assert.equal(reserved.body.reason, 'reserved');

    const mine = await c.get('/api/auth/username-available?u=' + encodeURIComponent(username));
    assert.equal(mine.body.available, true, 'your own username stays available to you');

    const ch = await c.post('/api/auth/change-username', { username: 'new.' + uid().slice(0, 12) });
    assert.equal(ch.status, 200);
    const ph = await c.post('/api/auth/change-phone', { phone: '08021234567', country: 'NG' });
    assert.equal(ph.status, 200);
    assert.equal(ph.body.phone, '+2348021234567');
  } finally { await s.stop(); }
});

test('two signups racing for the same username: one wins, the other is 409', { skip }, async () => {
  const s = await boot();
  try {
    const username = 'race_' + uid();
    const [a, b] = await Promise.all([
      client(s.base).post('/api/signup', signupPayload({ username, email: `${uid()}@ex.test`, password: 'correct horse 1' })),
      client(s.base).post('/api/signup', signupPayload({ username, email: `${uid()}@ex.test`, password: 'correct horse 1' })),
    ]);
    const statuses = [a.status, b.status].sort();
    assert.deepEqual(statuses, [201, 409]);
  } finally { await s.stop(); }
});
