/** Queries for accounts: users, one-time email tokens, OAuth identities. */
const { q } = require('../../../db');
const { sha256, newSecret } = require('../../lib/auth');

const one = async (sql, args) => (await q(sql, args)).rows[0] || null;
const normEmail = (e) => String(e || '').trim().toLowerCase();

const userByEmail = (email) => one('SELECT * FROM users WHERE LOWER(email) = LOWER($1)', [normEmail(email)]);
const userByLogin = async (login) => {
  const s = String(login || '').trim();
  return s.includes('@') ? userByEmail(s) : one('SELECT * FROM users WHERE LOWER(username) = LOWER($1)', [s]);
};
const usernameTaken = async (u) => !!(await one('SELECT 1 FROM users WHERE LOWER(username) = LOWER($1)', [u]));

/** A free username based on a hint (email local part, a name). */
async function freeUsername(hint) {
  let base = String(hint || '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 18);
  if (base.length < 3) base = (base + 'user').slice(0, 18);
  if (!(await usernameTaken(base))) return base;
  for (let i = 0; i < 20; i++) {
    const c = `${base}_${Math.floor(100 + Math.random() * 9900)}`;
    if (!(await usernameTaken(c))) return c;
  }
  return `${base}_${Date.now().toString(36)}`;
}

async function createUser({ username, email, passwordHash = null, displayName = null, avatarUrl = null, verified = false }) {
  return one(
    `INSERT INTO users (username, email, password_hash, display_name, avatar_url, email_verified_at, password_changed_at)
     VALUES ($1, $2, $3, $4, $5, CASE WHEN $6 THEN NOW() END, CASE WHEN $3::text IS NOT NULL THEN NOW() END) RETURNING *`,
    [username, normEmail(email), passwordHash, displayName, avatarUrl, !!verified]);
}

async function setPassword(userId, passwordHash) {
  return one(`UPDATE users SET password_hash = $2, password_changed_at = NOW(), needs_password_setup = false, updated_at = NOW()
              WHERE id = $1 RETURNING *`, [userId, passwordHash]);
}
const markVerified = (userId) => q('UPDATE users SET email_verified_at = COALESCE(email_verified_at, NOW()), updated_at = NOW() WHERE id = $1', [userId]);

/* ---------- one-time tokens (only the hash is stored) ---------- */
const TTL = { verify: 'hours', email_change: 'hours', reset: 'mins', set_password: 'mins' };
async function issueToken(userId, kind, email, ttl) {
  // a new link replaces older unused ones of the same kind
  await q('UPDATE auth_tokens SET used_at = NOW() WHERE user_id = $1 AND kind = $2 AND used_at IS NULL', [userId, kind]);
  const token = newSecret();
  await q(`INSERT INTO auth_tokens (user_id, kind, token_hash, email, expires_at)
           VALUES ($1, $2, $3, $4, NOW() + make_interval(${TTL[kind]} => $5))`, [userId, kind, sha256(token), normEmail(email), ttl]);
  return token;
}
/** Use a token once. Returns the row (with user_id, email, kind) or null if unknown/used/expired. */
async function consumeToken(token, kinds) {
  if (!token || typeof token !== 'string' || token.length > 200) return null;
  return one(`UPDATE auth_tokens SET used_at = NOW()
              WHERE token_hash = $1 AND kind = ANY($2::text[]) AND used_at IS NULL AND expires_at > NOW()
              RETURNING *`, [sha256(token), kinds]);
}
/** Was a token of this kind sent recently? (throttles repeat emails per account) */
const recentToken = async (userId, kinds, seconds) => !!(await one(
  `SELECT 1 FROM auth_tokens WHERE user_id = $1 AND kind = ANY($2::text[]) AND created_at > NOW() - make_interval(secs => $3) LIMIT 1`, [userId, kinds, seconds]));

/* ---------- OAuth identities ---------- */
const identity = (provider, subject) => one('SELECT * FROM oauth_identities WHERE provider = $1 AND subject = $2', [provider, subject]);
const linkIdentity = (provider, subject, userId, email) => q(
  `INSERT INTO oauth_identities (provider, subject, user_id, email, last_login_at) VALUES ($1, $2, $3, $4, NOW())
   ON CONFLICT (provider, subject) DO UPDATE SET last_login_at = NOW(), email = EXCLUDED.email`, [provider, subject, userId, normEmail(email)]);
const identitiesFor = async (userId) => (await q('SELECT provider, email, created_at FROM oauth_identities WHERE user_id = $1 ORDER BY created_at', [userId])).rows;

module.exports = {
  normEmail, userByEmail, userByLogin, usernameTaken, freeUsername, createUser, setPassword, markVerified,
  issueToken, consumeToken, recentToken, identity, linkIdentity, identitiesFor,
};
