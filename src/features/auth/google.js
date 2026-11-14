/**
 * "Continue with Google": OpenID Connect authorization-code flow with PKCE (S256), state and nonce.
 * Endpoints come from Google's discovery document (as Google's OIDC docs require), currently
 *   authorization_endpoint https://accounts.google.com/o/oauth2/v2/auth
 *   token_endpoint         https://oauth2.googleapis.com/token
 *   jwks_uri               https://www.googleapis.com/oauth2/v3/certs
 * The ID token is verified locally: RS256 signature against Google's JWKS, iss, aud, exp, nonce,
 * and email_verified. GOOGLE_DISCOVERY_URL can point elsewhere for tests only.
 */
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const config = require('../../config');

const G = () => config.AUTH.google;
const ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
const enabled = () => !!(G().clientId && G().clientSecret);

let disco = null; // { doc, exp }
let jwks = null; // { keys: Map(kid -> KeyObject), exp, fetchedAt }

function maxAge(res, fallbackSec) {
  const m = /max-age=(\d+)/i.exec(res.headers.get('cache-control') || '');
  return (m ? Math.min(Number(m[1]), 86400) : fallbackSec) * 1000;
}
async function getJson(url, init) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(10000) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(`Google ${res.status}: ${body.error || 'request failed'}`); e.status = 502; throw e; }
  return { res, body };
}
async function discovery() {
  if (disco && disco.exp > Date.now()) return disco.doc;
  const { res, body } = await getJson(G().discoveryUrl);
  for (const k of ['authorization_endpoint', 'token_endpoint', 'jwks_uri']) if (!body[k]) throw new Error('Google discovery document is missing ' + k);
  disco = { doc: body, exp: Date.now() + maxAge(res, 3600) };
  return body;
}
async function keyFor(kid) {
  const fresh = jwks && jwks.exp > Date.now();
  if (fresh && jwks.keys.has(kid)) return jwks.keys.get(kid);
  // unknown kid: Google rotated keys. Refetch, but not more than once a minute.
  if (!fresh || Date.now() - jwks.fetchedAt > 60_000) {
    const { res, body } = await getJson((await discovery()).jwks_uri);
    const keys = new Map();
    for (const k of body.keys || []) {
      if (k.kty !== 'RSA' || !k.kid) continue;
      try { keys.set(k.kid, crypto.createPublicKey({ key: k, format: 'jwk' })); } catch (_) { /* skip bad key */ }
    }
    jwks = { keys, exp: Date.now() + maxAge(res, 3600), fetchedAt: Date.now() };
  }
  return jwks.keys.get(kid) || null;
}

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const random = (n = 32) => b64url(crypto.randomBytes(n));

/** Build the Google URL plus the secrets to keep in the (signed, httpOnly) flow cookie. */
async function authUrl({ redirectUri, loginHint }) {
  const d = await discovery();
  const state = random();
  const nonce = random();
  const verifier = random(48); // 64 chars, within RFC 7636's 43-128
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const u = new URL(d.authorization_endpoint);
  u.search = new URLSearchParams({
    client_id: G().clientId, response_type: 'code', scope: 'openid email profile', redirect_uri: redirectUri,
    state, nonce, code_challenge: challenge, code_challenge_method: 'S256', prompt: 'select_account',
    ...(loginHint ? { login_hint: loginHint } : {}),
  }).toString();
  return { url: u.toString(), state, nonce, verifier };
}

/** Exchange the code, verify the ID token, return its claims. Throws on anything off. */
async function finish({ code, verifier, nonce, redirectUri }) {
  const d = await discovery();
  const { body } = await getJson(d.token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ code, client_id: G().clientId, client_secret: G().clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code', code_verifier: verifier }).toString(),
  });
  if (!body.id_token) throw new Error('Google did not return an ID token');
  return verifyIdToken(body.id_token, { nonce });
}

async function verifyIdToken(idToken, { nonce }) {
  const head = jwt.decode(idToken, { complete: true });
  if (!head || !head.header || head.header.alg !== 'RS256' || !head.header.kid) throw new Error('Unexpected ID token format');
  const key = await keyFor(head.header.kid);
  if (!key) throw new Error('ID token signed with an unknown key');
  const claims = jwt.verify(idToken, key, { algorithms: ['RS256'], audience: G().clientId, issuer: ISSUERS, clockTolerance: 60 });
  if (!nonce || claims.nonce !== nonce) throw new Error('ID token nonce mismatch');
  if (!claims.sub) throw new Error('ID token has no subject');
  const verified = claims.email_verified === true || claims.email_verified === 'true';
  if (!claims.email || !verified) { const e = new Error('Your Google email address is not verified'); e.expose = true; throw e; }
  return claims;
}

module.exports = { enabled, authUrl, finish, verifyIdToken, _reset: () => { disco = null; jwks = null; } };
