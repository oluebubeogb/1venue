/**
 * Authentication for 1venue.
 *
 * Token sources, in order:
 *   1. Authorization: Bearer <token>  (local 1venue JWT or Collab Accounts access token)
 *   2. Collab Accounts shared cookie `access_token` on COOKIE_DOMAIN (SSO across the suite)
 *   3. Local cookie `venue_token` (local accounts only, when Accounts is not used)
 *
 * When only the refresh cookie is present, or the access token is expired, the
 * request's cookies are forwarded to ACCOUNTS_URL/auth/me. Accounts silently
 * renews the session, and any Set-Cookie it returns is relayed to the browser.
 * Results are cached briefly by token hash so Accounts is not called on every request.
 */
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../../db');
const config = require('../config');
const { getBearerToken } = require('./http');

const LOCAL_COOKIE = 'venue_token';
const cache = new Map(); // key -> { user, exp }
const CACHE_MS = 60_000;

function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!k) continue;
    try { out[k] = decodeURIComponent(part.slice(i + 1).trim()); } catch (_) { out[k] = part.slice(i + 1).trim(); }
  }
  return out;
}

function isInternalUsername(name) {
  if (!name) return true;
  const s = String(name);
  return s.startsWith('accounts:') || s.startsWith('acc_') || s.endsWith('@accounts.local') || /^u[0-9a-f]{8}_/.test(s);
}

function niceDisplayName({ displayName, username, email }) {
  const candidates = [displayName, username, email && String(email).split('@')[0], 'User'];
  for (const c of candidates) {
    if (c && !isInternalUsername(c)) return String(c).trim().slice(0, 80);
  }
  return 'User';
}

function shapeUser(row, extra = {}) {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    displayName: extra.displayName || row.display_name || niceDisplayName({ username: row.username, email: row.email }),
    avatarUrl: row.avatar_url || null,
    accountsId: extra.accountsId || row.accounts_id || null,
    created_at: row.created_at,
    source: extra.source || (row.accounts_id ? 'accounts' : 'local'),
  };
}

async function ensureAccountsUser({ accountsId, email, username, displayName, avatarUrl }) {
  const id = String(accountsId || '').trim();
  const em = (email && String(email).trim().toLowerCase()) || (id ? id + '@accounts.local' : null);
  const pretty = niceDisplayName({ displayName, username, email: em });

  let row = null;
  if (id) {
    row = (await db.q('SELECT * FROM users WHERE accounts_id = $1', [id])).rows[0] || null;
  }
  if (!row && em && !em.endsWith('@accounts.local')) {
    row = (await db.q('SELECT * FROM users WHERE LOWER(email) = LOWER($1)', [em])).rows[0] || null;
  }
  if (!row && id) {
    row = (await db.q('SELECT * FROM users WHERE username = $1', ['accounts:' + id])).rows[0] || null;
  }
  if (row) {
    // Keep the profile in sync with Accounts (display name, accounts id link)
    if (row.accounts_id !== id || (pretty !== 'User' && row.display_name !== pretty) || (avatarUrl && !row.avatar_url)) {
      try {
        row = (await db.q(
          `UPDATE users SET accounts_id = COALESCE(accounts_id, $2),
             display_name = CASE WHEN $3 <> 'User' THEN $3 ELSE display_name END,
             avatar_url = COALESCE(avatar_url, $4), updated_at = NOW()
           WHERE id = $1 RETURNING *`,
          [row.id, id || null, pretty, avatarUrl || null]
        )).rows[0];
      } catch (e) { console.warn('[accounts] sync', e.message); }
    }
    return shapeUser(row, { displayName: row.display_name || pretty, accountsId: id, source: 'accounts' });
  }

  const base =
    (username && !isInternalUsername(username) && String(username).replace(/[^a-zA-Z0-9_]/g, '').slice(0, 16)) ||
    (em && !em.endsWith('@accounts.local') && em.split('@')[0].replace(/[^a-zA-Z0-9_]/g, '').slice(0, 16)) ||
    'user';
  const uname = ('u' + id.replace(/-/g, '').slice(0, 8) + '_' + base).slice(0, 40).toLowerCase();
  try {
    row = (await db.q(
      `INSERT INTO users (username, email, password_hash, display_name, accounts_id, avatar_url)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (email) DO UPDATE SET accounts_id = EXCLUDED.accounts_id, display_name = EXCLUDED.display_name
       RETURNING *`,
      [uname, em, bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), 8), pretty, id || null, avatarUrl || null]
    )).rows[0];
    return shapeUser(row, { source: 'accounts' });
  } catch (e) {
    console.error('[accounts] ensure user failed', e.message);
    return null;
  }
}

function fromAccountsPayload(u, fallbackSub) {
  return ensureAccountsUser({
    accountsId: String(u.id || fallbackSub || ''),
    email: u.email || null,
    username: u.username || null,
    displayName: u.display_name || u.name || u.username || null,
    avatarUrl: u.avatar_url || u.avatar || null,
  });
}

/** Ask Accounts who this is. Forwards the bearer token and/or cookies and relays renewed cookies. */
async function accountsMe(req, res, token) {
  if (!config.ACCOUNTS_URL) return null;
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  if (req.headers.cookie) headers.Cookie = req.headers.cookie;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 8000);
    const r = await fetch(config.ACCOUNTS_URL + '/auth/me', { headers, signal: ctl.signal });
    clearTimeout(t);
    if (res && typeof r.headers.getSetCookie === 'function') {
      const set = r.headers.getSetCookie();
      if (set && set.length && !res.headersSent) {
        const prev = res.getHeader('Set-Cookie');
        res.setHeader('Set-Cookie', [].concat(prev || [], set));
      }
    }
    if (!r.ok) return null;
    const data = await r.json();
    const u = data.user || data;
    if (!u || !(u.id || u.email)) return null;
    return await fromAccountsPayload(u);
  } catch (e) {
    console.warn('[accounts] /auth/me failed', e.message);
    return null;
  }
}

function tokenKey(parts) {
  return crypto.createHash('sha256').update(parts.join('|')).digest('base64url');
}

async function resolveToken(token, req, res) {
  // 1) Local 1venue JWT
  try {
    const payload = jwt.verify(token, config.JWT_SECRET);
    if (payload && payload.sub != null && payload.type !== 'access') {
      const row = (await db.q('SELECT * FROM users WHERE id = $1', [payload.sub])).rows[0];
      if (row) return shapeUser(row, { source: row.accounts_id ? 'accounts' : 'local' });
    }
  } catch (_) {}

  // 2) Accounts JWT verified locally (no network) when the secret is shared
  if (config.ACCOUNTS_JWT_SECRET) {
    try {
      const payload = jwt.verify(token, config.ACCOUNTS_JWT_SECRET);
      if (payload && payload.sub && (payload.type === 'access' || !payload.type)) {
        if (payload.email || payload.display_name) {
          return await fromAccountsPayload({
            id: payload.sub, email: payload.email, username: payload.username, display_name: payload.display_name,
          });
        }
        const viaMe = await accountsMe(req, res, token);
        if (viaMe) return viaMe;
      }
    } catch (_) {}
  }
  // 3) Ask Accounts (also handles expired access + refresh cookie renewals)
  return accountsMe(req, res, token);
}

/**
 * Resolve the signed-in user for a request, or null.
 * Pass `res` so renewed Accounts cookies can be relayed to the browser.
 */
async function getAuthUser(req, res) {
  if (req._authResolved) return req._authUser;
  const cookies = parseCookies(req);
  const bearer = getBearerToken(req);
  const token = bearer || cookies[config.ACCOUNTS_ACCESS_COOKIE] || cookies[LOCAL_COOKIE] || null;
  const refresh = cookies[config.ACCOUNTS_REFRESH_COOKIE] || null;
  if (!token && !refresh) {
    req._authResolved = true;
    req._authUser = null;
    return null;
  }
  const key = tokenKey([token || '', token ? '' : refresh || '']);
  const hit = cache.get(key);
  if (hit && hit.exp > Date.now()) {
    req._authResolved = true;
    req._authUser = hit.user;
    return hit.user;
  }
  let user = null;
  if (token) user = await resolveToken(token, req, res);
  if (!user && refresh) user = await accountsMe(req, res, null);
  if (user && user.id) {
    cache.set(key, { user, exp: Date.now() + CACHE_MS });
    if (cache.size > 5000) cache.delete(cache.keys().next().value);
  } else {
    user = null;
  }
  req._authResolved = true;
  req._authUser = user;
  return user;
}

function signToken(user) {
  return jwt.sign(
    { sub: user.id, username: user.username, email: user.email },
    config.JWT_SECRET,
    { expiresIn: config.JWT_TTL }
  );
}

function localCookie(token, { clear = false } = {}) {
  const parts = [
    `${LOCAL_COOKIE}=${clear ? '' : encodeURIComponent(token)}`,
    'Path=/', 'HttpOnly', 'SameSite=Lax',
    clear ? 'Max-Age=0' : `Max-Age=${30 * 24 * 3600}`,
  ];
  if ((config.PUBLIC_URL || '').startsWith('https://')) parts.push('Secure');
  return parts.join('; ');
}

function publicUser(user) {
  if (!user) return null;
  const displayName = niceDisplayName({
    displayName: user.displayName || user.display_name,
    username: user.username,
    email: user.email,
  });
  return {
    id: user.id,
    username: isInternalUsername(user.username) ? displayName : (user.username || displayName),
    email: user.email,
    displayName,
    avatarUrl: user.avatarUrl || user.avatar_url || null,
    source: user.source || 'local',
    createdAt: user.created_at,
  };
}

function loginUrl(next) {
  if (!config.ACCOUNTS_LOGIN_URL) return null;
  return config.ACCOUNTS_LOGIN_URL + '?next=' + encodeURIComponent(next || config.PUBLIC_URL || '/');
}

function logoutUrl(next) {
  if (!config.ACCOUNTS_URL) return null;
  return config.ACCOUNTS_URL + '/logout?next=' + encodeURIComponent(next || config.PUBLIC_URL || '/');
}

module.exports = {
  LOCAL_COOKIE,
  parseCookies,
  isInternalUsername,
  niceDisplayName,
  ensureAccountsUser,
  getAuthUser,
  signToken,
  localCookie,
  publicUser,
  loginUrl,
  logoutUrl,
  _cache: cache,
};
