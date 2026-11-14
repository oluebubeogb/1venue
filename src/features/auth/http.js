/**
 * Google sign-in redirects (non-/api paths, so they live in a raw handler):
 *   GET /auth/google/start?next=/dashboard  -> 302 to Google
 *   GET /auth/google/callback               -> back from Google, signs in, 302 to `next`
 * Redirect URI registered in Google Cloud: ${PUBLIC_URL}/auth/google/callback
 */
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const config = require('../../config');
const db = require('../../../db');
const auth = require('../../lib/auth');
const data = require('./data');
const google = require('./google');
const mail = require('../mail/mailer');
const { rateLimit, clientIp } = require('../../lib/http');

const FLOW_COOKIE = () => (config.AUTH.cookieSecure ? '__Host-' : '') + '1v_oauth';
const FLOW_TTL = 600;

function origin(req) {
  if (config.PUBLIC_URL) return config.PUBLIC_URL;
  const proto = (config.TRUST_PROXY && req.headers['x-forwarded-proto']) || 'http';
  return `${String(proto).split(',')[0]}://${req.headers.host}`;
}
const redirectUri = (req) => origin(req) + '/auth/google/callback';
function safeNext(raw) {
  const s = String(raw || '');
  return s.startsWith('/') && !s.startsWith('//') && !s.startsWith('/\\') && s.length < 500 ? s : '/dashboard';
}
function redirect(res, to, cookies = []) {
  const prev = res.getHeader('Set-Cookie');
  res.writeHead(302, { Location: to, 'Cache-Control': 'no-store', 'Set-Cookie': [].concat(prev || [], cookies) });
  res.end();
  return true;
}
const flowCookie = (value, maxAge) => [`${FLOW_COOKIE()}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAge}`, ...(config.AUTH.cookieSecure ? ['Secure'] : [])].join('; ');
const fail = (res, code) => redirect(res, `/login?error=${encodeURIComponent(code)}`, [flowCookie('', 0)]);
const eq = (a, b) => { const x = Buffer.from(String(a)); const y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

/** Find or create the 1venue user for verified Google claims. Returns { row, created } or null. */
async function userForGoogle(claims) {
  const email = data.normEmail(claims.email);
  const linked = await data.identity('google', claims.sub);
  if (linked) {
    await data.linkIdentity('google', claims.sub, linked.user_id, email);
    return { row: await auth.userById(linked.user_id), created: false };
  }
  const existing = await data.userByEmail(email);
  if (existing) {
    // Link by verified email. If the account's email was never verified, someone may have
    // registered it with a password before the real owner arrived: that password (and every
    // session made with it) is dropped. The owner can set a password later via "forgot".
    if (!existing.email_verified_at) {
      if (existing.password_hash) await db.q('UPDATE users SET password_hash = NULL, updated_at = NOW() WHERE id = $1', [existing.id]);
      await auth.revokeAllSessions(existing.id, { reason: 'google-link-unverified-email' });
    }
    await data.markVerified(existing.id);
    await db.q('UPDATE users SET needs_password_setup = false, avatar_url = COALESCE(avatar_url, $2), display_name = COALESCE(display_name, $3) WHERE id = $1',
      [existing.id, claims.picture || null, claims.name || null]);
    await data.linkIdentity('google', claims.sub, existing.id, email);
    auth.forgetUser(existing.id);
    return { row: await auth.userById(existing.id), created: false };
  }
  if (!config.AUTH.google.allowSignup) return null;
  const row = await data.createUser({
    username: await data.freeUsername(claims.given_name || email.split('@')[0]),
    email, displayName: claims.name || null, avatarUrl: claims.picture || null, verified: true,
  });
  await data.linkIdentity('google', claims.sub, row.id, email);
  try { require('../../venue/data').syncSpeakerInvites(row.id, email).catch(() => {}); } catch (_) { /* optional */ }
  return { row, created: true };
}

module.exports = async function handle(req, res, parsed) {
  const p = parsed.pathname;
  if (p !== '/auth/google/start' && p !== '/auth/google/callback') return false;
  if (req.method !== 'GET') return false;
  if (!google.enabled()) return fail(res, 'google-off');
  if (!rateLimit('google:' + clientIp(req), config.AUTH.ratePerMin)) return fail(res, 'rate');

  if (p === '/auth/google/start') {
    try {
      const a = await google.authUrl({ redirectUri: redirectUri(req) });
      const flow = jwt.sign({ s: a.state, n: a.nonce, v: a.verifier, next: safeNext(parsed.searchParams.get('next')) }, config.JWT_SECRET, { expiresIn: FLOW_TTL, audience: 'oauth-flow' });
      return redirect(res, a.url, [flowCookie(flow, FLOW_TTL)]);
    } catch (e) {
      console.error('[google] start failed:', e.message);
      return fail(res, 'google-unavailable');
    }
  }

  // callback
  const q = parsed.searchParams;
  if (q.get('error')) return fail(res, q.get('error') === 'access_denied' ? 'google-cancelled' : 'google');
  let flow;
  try { flow = jwt.verify(auth.parseCookies(req)[FLOW_COOKIE()] || '', config.JWT_SECRET, { audience: 'oauth-flow' }); } catch (_) { return fail(res, 'google-expired'); }
  if (!q.get('state') || !eq(q.get('state'), flow.s) || !q.get('code')) return fail(res, 'google-state');
  try {
    const claims = await google.finish({ code: q.get('code'), verifier: flow.v, nonce: flow.n, redirectUri: redirectUri(req) });
    const r = await userForGoogle(claims);
    if (!r || !r.row) return fail(res, 'google-signup-closed');
    if (r.created) mail.sendLater('welcome', r.row.email, { name: r.row.display_name || r.row.username, link: origin(req) + '/' });
    await auth.startSession(req, res, r.row, { method: 'google' });
    return redirect(res, flow.next || '/dashboard', [flowCookie('', 0)]);
  } catch (e) {
    console.warn('[google] sign-in failed:', e.message);
    return fail(res, /not verified/.test(e.message) ? 'google-unverified' : 'google');
  }
};
module.exports.userForGoogle = userForGoogle;
