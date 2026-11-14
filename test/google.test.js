'use strict';
// "Continue with Google" against a mock Google (discovery, authorize, token, JWKS).
// Checks PKCE, state, nonce, ID-token signature/iss/aud/exp/email_verified, account linking.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const { boot, client, signupPayload } = require('./helpers/server');

const skip = !process.env.DATABASE_URL && process.env.DB_DRIVER !== 'sqlite' ? 'set DATABASE_URL' : false;
const uid = () => 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const CLIENT_ID = 'test-client.apps.googleusercontent.com';
const SECRET = 'test-google-secret';

async function mockGoogle(opts = {}) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const rogue = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
  const codes = new Map(); // code -> { claims, challenge, redirectUri, sign }
  const calls = [];
  const srv = http.createServer(async (req, res) => {
    const base = `http://127.0.0.1:${srv.address().port}`;
    const u = new URL(req.url, base);
    let raw = ''; for await (const c of req) raw += c;
    calls.push({ path: u.pathname, body: raw });
    const json = (s, b, h = {}) => { res.writeHead(s, { 'content-type': 'application/json', ...h }); res.end(JSON.stringify(b)); };
    if (u.pathname === '/.well-known/openid-configuration') {
      return json(200, { issuer: 'https://accounts.google.com', authorization_endpoint: opts.authorizationEndpoint || (base + '/o/oauth2/v2/auth'), token_endpoint: base + '/token', jwks_uri: base + '/certs' }, { 'cache-control': 'public, max-age=3600' });
    }
    if (u.pathname === '/certs') return json(200, { keys: [jwk] }, { 'cache-control': 'public, max-age=3600' });
    if (u.pathname === '/token' && req.method === 'POST') {
      const p = new URLSearchParams(raw);
      const entry = codes.get(p.get('code'));
      if (!entry || p.get('grant_type') !== 'authorization_code' || p.get('client_id') !== CLIENT_ID || p.get('client_secret') !== SECRET || p.get('redirect_uri') !== entry.redirectUri) return json(400, { error: 'invalid_grant' });
      const challenge = crypto.createHash('sha256').update(p.get('code_verifier') || '').digest('base64url');
      if (challenge !== entry.challenge) return json(400, { error: 'invalid_grant', error_description: 'PKCE' });
      codes.delete(p.get('code'));
      const now = Math.floor(Date.now() / 1000);
      const claims = { iss: 'https://accounts.google.com', aud: CLIENT_ID, iat: now, exp: now + 3600, nonce: entry.nonce, email_verified: true, ...entry.claims };
      const id_token = jwt.sign(claims, entry.rogue ? rogue : privateKey, { algorithm: 'RS256', keyid: 'k1' });
      return json(200, { access_token: 'ya29.x', expires_in: 3599, token_type: 'Bearer', scope: 'openid email profile', id_token });
    }
    json(404, { error: 'not found' });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return { srv, calls, codes, url: `http://127.0.0.1:${srv.address().port}/.well-known/openid-configuration` };
}

/** Walk the flow: /auth/google/start -> (mock consent) -> /auth/google/callback. */
async function signInWithGoogle(s, g, claims, { next = '/dashboard', tamper = {} } = {}) {
  const c = client(s.base);
  const start = await c.get('/auth/google/start?next=' + encodeURIComponent(next));
  assert.equal(start.status, 302);
  const auth = new URL(start.res.headers.get('location'));
  const q = auth.searchParams;
  const code = 'code-' + uid();
  g.codes.set(code, { claims, challenge: q.get('code_challenge'), redirectUri: q.get('redirect_uri'), nonce: tamper.nonce || q.get('nonce'), rogue: tamper.rogue });
  if (tamper.dropCookie) c.jar.delete('1v_oauth');
  const cb = await c.get(`/auth/google/callback?code=${code}&state=${encodeURIComponent(tamper.state || q.get('state'))}`);
  return { c, start, auth, cb, location: cb.res.headers.get('location') };
}

test('Google sign-in is hidden and refused when not configured', { skip }, async () => {
  const s = await boot({ GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '' });
  try {
    assert.equal((await client(s.base).get('/api/config')).body.auth.google, false);
    const r = await client(s.base).get('/auth/google/start');
    assert.equal(r.status, 302); assert.equal(r.res.headers.get('location'), '/login?error=google-off');
  } finally { await s.stop(); }
});

test('Google sign-in: PKCE+state+nonce request, new user, returning user, linking by verified email', { skip }, async () => {
  const g = await mockGoogle();
  const s = await boot({ GOOGLE_CLIENT_ID: CLIENT_ID, GOOGLE_CLIENT_SECRET: SECRET, GOOGLE_DISCOVERY_URL: g.url });
  const db = require('../db');
  try {
    assert.equal((await client(s.base).get('/api/config')).body.auth.google, true);
    const email = `${uid()}@gmail.test`;
    const sub = 'sub-' + uid();
    const f = await signInWithGoogle(s, g, { sub, email, name: 'Ngozi Okafor', given_name: 'Ngozi', picture: 'https://example.com/p.png' }, { next: '/e/demo' });
    const q = f.auth.searchParams;
    assert.equal(q.get('client_id'), CLIENT_ID);
    assert.equal(q.get('response_type'), 'code');
    assert.match(q.get('scope'), /^openid email profile$/);
    assert.equal(q.get('redirect_uri'), s.base + '/auth/google/callback', 'redirect URI comes from PUBLIC_URL');
    assert.equal(q.get('code_challenge_method'), 'S256');
    assert.ok(q.get('state').length >= 40 && q.get('nonce').length >= 40);
    const flowCookie = f.start.res.headers.getSetCookie().find((x) => x.startsWith('1v_oauth='));
    assert.match(flowCookie, /HttpOnly/); assert.match(flowCookie, /SameSite=Lax/); assert.match(flowCookie, /Max-Age=600/);
    assert.ok(!flowCookie.includes(q.get('code_challenge')) && !g.calls.some((c) => c.path === '/token' && !c.body.includes('code_verifier=')), 'verifier only goes to the token endpoint');

    assert.equal(f.cb.status, 302); assert.equal(f.location, '/e/demo');
    const me = (await f.c.get('/api/session')).body.user;
    assert.equal(me.email, email); assert.equal(me.emailVerified, true); assert.equal(me.hasPassword, false);
    assert.equal(me.displayName, 'Ngozi Okafor');
    assert.ok(me.username, 'Google sign-up auto-generates a username');
    assert.match(me.username, /^[a-z0-9._]{3,30}$/);
    assert.ok(!me.username.startsWith('.') && !me.username.endsWith('.'));
    assert.match(me.username, /^ngozi/);
    assert.ok(await s.mailLink(email, /Welcome/) !== null);
    const ids = (await db.q('SELECT provider, subject FROM oauth_identities WHERE user_id = $1', [me.id])).rows;
    assert.deepEqual(ids, [{ provider: 'google', subject: sub }]);

    // returning user (by sub, even if the Google email changed)
    const again = await signInWithGoogle(s, g, { sub, email: `new-${email}` });
    assert.equal((await again.c.get('/api/session')).body.user.id, me.id);

    // existing verified local account with the same email: linked, password kept
    const le = `${uid()}@ex.test`;
    const local = client(s.base);
    await local.post('/api/signup', signupPayload({ email: le, password: 'local password 1' }));
    await db.q('UPDATE users SET email_verified_at = NOW() WHERE email = $1', [le]);
    const lk = await signInWithGoogle(s, g, { sub: 'sub-' + uid(), email: le.toUpperCase() });
    const lu = (await lk.c.get('/api/session')).body.user;
    assert.equal(lu.email, le); assert.equal(lu.hasPassword, true);
    assert.equal((await local.get('/api/me')).status, 200, 'existing sessions stay');
    assert.equal((await client(s.base).post('/api/login', { login: le, password: 'local password 1' })).status, 200);

    // unverified account with a password (could be a squatter): password and sessions dropped
    const se = `${uid()}@ex.test`;
    const squatter = client(s.base);
    await squatter.post('/api/signup', signupPayload({ email: se, password: 'squatter pass 1' }));
    const owner = await signInWithGoogle(s, g, { sub: 'sub-' + uid(), email: se });
    assert.equal((await owner.c.get('/api/session')).body.user.emailVerified, true);
    assert.equal((await squatter.get('/api/me')).status, 401, "squatter's session revoked");
    assert.equal((await client(s.base).post('/api/login', { login: se, password: 'squatter pass 1' })).status, 401, "squatter's password removed");

    // imported user (no password) links automatically
    const ce = `${uid()}@ex.test`;
    const cid = (await db.q("INSERT INTO users (username, email, password_hash, accounts_id, needs_password_setup, email_verified_at) VALUES ($1,$2,NULL,$3,true,NULL) RETURNING id", [uid(), ce, 'acc-' + uid()])).rows[0].id;
    const mig = await signInWithGoogle(s, g, { sub: 'sub-' + uid(), email: ce });
    assert.equal((await mig.c.get('/api/session')).body.user.id, cid);
    assert.equal((await db.q('SELECT needs_password_setup FROM users WHERE id = $1', [cid])).rows[0].needs_password_setup, false);

    // open redirect is not possible
    const evil = await signInWithGoogle(s, g, { sub: 'sub-' + uid(), email: `${uid()}@gmail.test` }, { next: '//evil.example/x' });
    assert.equal(evil.location, '/dashboard');
  } finally { await s.stop(); g.srv.close(); await db.close().catch(() => {}); }
});

test('Google sign-in refuses forged or unsafe responses', { skip }, async () => {
  const g = await mockGoogle();
  const s = await boot({ GOOGLE_CLIENT_ID: CLIENT_ID, GOOGLE_CLIENT_SECRET: SECRET, GOOGLE_DISCOVERY_URL: g.url });
  try {
    const base = () => ({ sub: 'sub-' + uid(), email: `${uid()}@gmail.test` });
    const cases = [
      [{}, { state: 'not-the-state' }, 'google-state'],
      [{}, { dropCookie: true }, 'google-expired'],
      [{}, { nonce: 'replayed-nonce' }, 'google'],
      [{}, { rogue: true }, 'google'],
      [{ email_verified: false }, {}, 'google-unverified'],
      [{ aud: 'someone-else.apps.googleusercontent.com' }, {}, 'google'],
      [{ iss: 'https://evil.example' }, {}, 'google'],
      [{ exp: Math.floor(Date.now() / 1000) - 3600 }, {}, 'google'],
    ];
    for (const [claims, tamper, code] of cases) {
      const f = await signInWithGoogle(s, g, { ...base(), ...claims }, { tamper });
      assert.equal(f.location, '/login?error=' + code, JSON.stringify({ claims, tamper }));
      assert.equal((await f.c.get('/api/me')).status, 401);
    }
    const denied = await client(s.base).get('/auth/google/callback?error=access_denied');
    assert.equal(denied.res.headers.get('location'), '/login?error=google-cancelled');
  } finally { await s.stop(); g.srv.close(); }
});

test('GOOGLE_ALLOW_SIGNUP=false: only existing accounts can use Google', { skip }, async () => {
  const g = await mockGoogle();
  const s = await boot({ GOOGLE_CLIENT_ID: CLIENT_ID, GOOGLE_CLIENT_SECRET: SECRET, GOOGLE_DISCOVERY_URL: g.url, GOOGLE_ALLOW_SIGNUP: 'false' });
  try {
    const f = await signInWithGoogle(s, g, { sub: 'sub-' + uid(), email: `${uid()}@gmail.test` });
    assert.equal(f.location, '/login?error=google-signup-closed');
  } finally { await s.stop(); g.srv.close(); }
});


test('GET /auth/google/start?next=/ returns 302 to accounts.google.com when configured', { skip }, async () => {
  const g = await mockGoogle({ authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth' });
  const s = await boot({ GOOGLE_CLIENT_ID: CLIENT_ID, GOOGLE_CLIENT_SECRET: SECRET, GOOGLE_DISCOVERY_URL: g.url });
  try {
    const r = await client(s.base).get('/auth/google/start?next=%2F');
    assert.equal(r.status, 302);
    const loc = r.res.headers.get('location');
    assert.ok(loc, 'Location header');
    const u = new URL(loc);
    assert.equal(u.origin, 'https://accounts.google.com');
    assert.equal(u.pathname, '/o/oauth2/v2/auth');
    assert.equal(u.searchParams.get('client_id'), CLIENT_ID);
    assert.equal(u.searchParams.get('redirect_uri'), s.base + '/auth/google/callback');
    assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
    assert.ok(u.searchParams.get('code_challenge'));
  } finally { await s.stop(); g.srv.close(); }
});
