/**
 * 1venue sessions (core). Used by every route through getAuthUser().
 *
 *   Access token  : short-lived JWT { sub, sid, typ:'access' } in an httpOnly cookie
 *                   (or Authorization: Bearer). Checked against its session row, so signing out
 *                   (or "sign out everywhere") takes effect at once, not when the JWT expires.
 *   Refresh token : random 256-bit secret in an httpOnly cookie. Only its SHA-256 is stored
 *                   (auth_sessions.token_hash). It is rotated every time it is used; the
 *                   previous value stays valid for a short grace period (parallel requests),
 *                   and using it after that revokes the session (token theft detection).
 *   Cookies       : host-only (no Domain), Path=/, HttpOnly, SameSite=Lax, Secure on https.
 *                   On https the names carry the __Host- prefix, which browsers only accept
 *                   from this exact host over TLS.
 * Routes for sign-up / sign-in / reset live in src/features/auth. See docs/AUTH.md.
 */
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../../db');
const config = require('../config');
const { getBearerToken, clientIp } = require('./http');

const A = config.AUTH;
const ROTATE_GRACE_MS = 60_000;
const prefix = () => (A.cookieSecure ? '__Host-' : '');
const ACCESS_COOKIE = () => prefix() + '1v_at';
const REFRESH_COOKIE = () => prefix() + '1v_rt';
const LEGACY_COOKIES = ['venue_token', 'access_token', 'refresh_token'];

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const newSecret = () => crypto.randomBytes(32).toString('base64url');

function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!k || k in out) continue;
    try { out[k] = decodeURIComponent(part.slice(i + 1).trim()); } catch (_) { out[k] = part.slice(i + 1).trim(); }
  }
  return out;
}

function cookie(name, value, maxAgeSec) {
  const parts = [`${name}=${value ? encodeURIComponent(value) : ''}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${value ? maxAgeSec : 0}`];
  if (A.cookieSecure) parts.push('Secure');
  return parts.join('; ');
}
function addCookies(res, list) {
  if (!res || res.headersSent) return;
  const prev = res.getHeader('Set-Cookie');
  res.setHeader('Set-Cookie', [].concat(prev || [], list));
}

/* ---------- passwords ---------- */
let dummyHash = null;
async function hashPassword(pw) { return bcrypt.hash(String(pw), A.bcryptCost); }
/** Constant-ish time: compares against a dummy hash when the user has no password. */
async function verifyPassword(pw, hash) {
  if (!hash) {
    dummyHash = dummyHash || await bcrypt.hash('dummy-password-for-timing', A.bcryptCost);
    await bcrypt.compare(String(pw), dummyHash);
    return false;
  }
  return bcrypt.compare(String(pw), hash);
}
function passwordProblem(pw) {
  if (typeof pw !== 'string' || pw.length < A.passwordMin) return `Use at least ${A.passwordMin} characters for your password`;
  if (pw.length > 128) return 'That password is too long (128 characters max)';
  if (/^(.)\1+$/.test(pw) || /^(password|12345678|qwertyui)/i.test(pw)) return 'Choose a less guessable password';
  return null;
}

/* ---------- users ---------- */
function niceDisplayName({ displayName, username, email }) {
  for (const c of [displayName, username, email && String(email).split('@')[0], 'User']) {
    if (c && String(c).trim()) return String(c).trim().slice(0, 80);
  }
  return 'User';
}
function shapeUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    displayName: row.display_name || niceDisplayName({ username: row.username, email: row.email }),
    avatarUrl: row.avatar_url || null,
    emailVerified: !!row.email_verified_at,
    hasPassword: !!row.password_hash,
    needsPasswordSetup: !!row.needs_password_setup,
    created_at: row.created_at,
    source: 'local',
  };
}
function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    displayName: user.displayName || user.display_name || niceDisplayName(user),
    avatarUrl: user.avatarUrl || user.avatar_url || null,
    emailVerified: user.emailVerified !== undefined ? !!user.emailVerified : !!user.email_verified_at,
    hasPassword: user.hasPassword !== undefined ? !!user.hasPassword : !!user.password_hash,
    source: 'local',
    plan: user.plan || 'free',
    createdAt: user.created_at,
  };
}
async function userById(id) { return (await db.q('SELECT * FROM users WHERE id = $1', [id])).rows[0] || null; }

/* ---------- small caches (one app replica; cleared on revoke) ---------- */
const sessionCache = new Map(); // sid -> { ok, userId, exp }
const userCache = new Map(); // userId -> { row, exp }
const CACHE_MS = 30_000;
function forgetSession(sid) { sessionCache.delete(sid); }
function forgetUser(userId) {
  userCache.delete(Number(userId));
  for (const [sid, v] of sessionCache) if (v.userId === Number(userId)) sessionCache.delete(sid);
}
async function sessionActive(sid, userId) {
  const hit = sessionCache.get(sid);
  if (hit && hit.exp > Date.now()) return hit.ok && hit.userId === Number(userId);
  const r = (await db.q('SELECT user_id FROM auth_sessions WHERE id = $1 AND revoked_at IS NULL AND expires_at > NOW()', [sid])).rows[0];
  const ok = !!r && Number(r.user_id) === Number(userId);
  sessionCache.set(sid, { ok, userId: Number(userId), exp: Date.now() + CACHE_MS });
  if (sessionCache.size > 20000) sessionCache.delete(sessionCache.keys().next().value);
  return ok;
}
async function cachedUser(id) {
  const hit = userCache.get(Number(id));
  if (hit && hit.exp > Date.now()) return hit.row;
  const row = await userById(id);
  userCache.set(Number(id), { row, exp: Date.now() + CACHE_MS });
  if (userCache.size > 20000) userCache.delete(userCache.keys().next().value);
  return row;
}

/* ---------- sessions ---------- */
function signAccess(userId, sid) {
  return jwt.sign({ sub: userId, sid, typ: 'access' }, config.JWT_SECRET, { expiresIn: A.accessTtlSec });
}
function sessionCookies(userId, sid, refresh) {
  return [
    cookie(ACCESS_COOKIE(), signAccess(userId, sid), A.accessTtlSec),
    cookie(REFRESH_COOKIE(), refresh, A.refreshTtlDays * 86400),
  ];
}
function clearCookies(res) {
  addCookies(res, [cookie(ACCESS_COOKIE(), '', 0), cookie(REFRESH_COOKIE(), '', 0), ...LEGACY_COOKIES.map((n) => `${n}=; Path=/; Max-Age=0`)]);
}

/** Start a new signed-in session for this browser and set the cookies. */
async function startSession(req, res, user, { method = 'password' } = {}) {
  const sid = crypto.randomUUID();
  const refresh = newSecret();
  await db.q(
    `INSERT INTO auth_sessions (id, user_id, token_hash, expires_at, max_expires_at, method, user_agent, ip)
     VALUES ($1, $2, $3, NOW() + make_interval(days => $4), NOW() + make_interval(days => $5), $6, $7, $8)`,
    [sid, user.id, sha256(refresh), A.refreshTtlDays, A.sessionMaxDays, method,
      String(req.headers['user-agent'] || '').slice(0, 300), clientIp(req).slice(0, 64)]);
  addCookies(res, sessionCookies(user.id, sid, refresh));
  req._authResolved = true;
  req._sid = sid;
  req._authRow = await userById(user.id);
  req._authUser = req._authRow ? shapeUser(req._authRow) : null;
  return sid;
}

/**
 * Exchange a refresh token for a new pair. Returns { userId, sid } or null.
 * rotate=false (no response to set cookies on) only validates.
 */
async function useRefresh(req, res, token, { rotate = true } = {}) {
  const h = sha256(token);
  const s = (await db.q(
    `SELECT * FROM auth_sessions WHERE (token_hash = $1 OR prev_token_hash = $1) AND revoked_at IS NULL
       AND expires_at > NOW() AND max_expires_at > NOW()`, [h])).rows[0];
  if (!s) return null;
  if (s.token_hash !== h) {
    // An older token. Fine for a moment after rotation (parallel requests), theft after that.
    if (Date.now() - new Date(s.rotated_at).getTime() <= ROTATE_GRACE_MS) return { userId: s.user_id, sid: s.id };
    await revokeSession(s.user_id, s.id, 'refresh-token-reuse');
    console.warn('[auth] refresh token reuse detected; session revoked', s.id.slice(0, 8));
    return null;
  }
  if (!rotate) return { userId: s.user_id, sid: s.id };
  const next = newSecret();
  const up = await db.q(
    `UPDATE auth_sessions SET prev_token_hash = token_hash, token_hash = $2, rotated_at = NOW(), last_seen_at = NOW(),
       expires_at = LEAST(max_expires_at, NOW() + make_interval(days => $3)), ip = $4
     WHERE id = $1 AND token_hash = $5 AND revoked_at IS NULL RETURNING id`,
    [s.id, sha256(next), A.refreshTtlDays, clientIp(req).slice(0, 64), h]);
  if (!up.rowCount) return { userId: s.user_id, sid: s.id }; // lost a race with a parallel request: fine
  addCookies(res, sessionCookies(s.user_id, s.id, next));
  return { userId: s.user_id, sid: s.id };
}

async function revokeSession(userId, sid, reason = 'signed-out') {
  await db.q('UPDATE auth_sessions SET revoked_at = NOW(), revoke_reason = $3 WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL', [sid, userId, reason]);
  forgetSession(sid);
}
async function revokeAllSessions(userId, { except = null, reason = 'signed-out-everywhere' } = {}) {
  const r = await db.q('UPDATE auth_sessions SET revoked_at = NOW(), revoke_reason = $3 WHERE user_id = $1 AND revoked_at IS NULL AND ($2::text IS NULL OR id <> $2) RETURNING id', [userId, except, reason]);
  forgetUser(userId);
  return r.rowCount;
}
async function listSessions(userId) {
  return (await db.q(
    `SELECT id, created_at, last_seen_at, expires_at, method, user_agent, ip FROM auth_sessions
      WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > NOW() ORDER BY last_seen_at DESC LIMIT 50`, [userId])).rows;
}

/** Resolve the session for a request: { row, sid } or null. Rotates the refresh token when needed. */
async function resolve(req, res) {
  const cookies = parseCookies(req);
  const access = getBearerToken(req) || cookies[ACCESS_COOKIE()] || null;
  if (access) {
    try {
      const p = jwt.verify(access, config.JWT_SECRET);
      if (p && p.typ === 'access' && p.sid && p.sub != null && await sessionActive(p.sid, p.sub)) {
        const row = await cachedUser(p.sub);
        if (row) return { row, sid: p.sid };
      }
    } catch (_) { /* expired or invalid: try the refresh token */ }
  }
  const refresh = cookies[REFRESH_COOKIE()];
  if (!refresh) return null;
  const canSet = !!(res && !res.headersSent);
  const r = await useRefresh(req, canSet ? res : null, refresh, { rotate: canSet });
  if (!r) { if (canSet) clearCookies(res); return null; }
  forgetSession(r.sid);
  const row = await userById(r.userId);
  return row ? { row, sid: r.sid } : null;
}

/**
 * The signed-in user for a request, or null. Pass `res` so an expired access token can be
 * renewed from the refresh cookie. With AUTH_REQUIRE_VERIFIED_EMAIL=true an unverified user
 * counts as signed out everywhere except where { allowUnverified: true } is passed.
 */
async function getAuthUser(req, res, { allowUnverified = false } = {}) {
  if (!req._authResolved) {
    req._authResolved = true;
    let s = null;
    try { s = await resolve(req, res); } catch (e) { console.error('[auth] session check failed:', e.message); }
    req._authRow = s ? s.row : null;
    req._sid = s ? s.sid : null;
    req._authUser = s ? shapeUser(s.row) : null;
  }
  const u = req._authUser;
  if (u && A.requireVerifiedEmail && !u.emailVerified && !allowUnverified) return null;
  return u;
}
async function currentSessionId(req, res) { await getAuthUser(req, res, { allowUnverified: true }); return req._sid || null; }

/** Sign this browser out (revokes its session) and clear the cookies. */
async function endSession(req, res) {
  const u = await getAuthUser(req, res, { allowUnverified: true });
  if (u && req._sid) await revokeSession(u.id, req._sid);
  else {
    const rt = parseCookies(req)[REFRESH_COOKIE()];
    if (rt) await db.q("UPDATE auth_sessions SET revoked_at = NOW(), revoke_reason = 'signed-out' WHERE token_hash = $1 AND revoked_at IS NULL", [sha256(rt)]);
  }
  clearCookies(res);
  req._authUser = null; req._authRow = null; req._sid = null;
}

module.exports = {
  parseCookies, sha256, newSecret,
  hashPassword, verifyPassword, passwordProblem,
  niceDisplayName, shapeUser, publicUser, userById,
  startSession, endSession, revokeSession, revokeAllSessions, listSessions, currentSessionId, clearCookies,
  getAuthUser, forgetUser,
  ACCESS_COOKIE, REFRESH_COOKIE,
};
