/**
 * Accounts API: sign up / in / out, sessions, email verification, password reset, account changes.
 * Answers are deliberately generic where they could reveal whether an email has an account
 * (sign-in failures, "forgot password", resend, change email). See docs/AUTH.md.
 */
const auth = require('../../lib/auth');
const config = require('../../config');
const data = require('./data');
const mail = require('../mail/mailer');
const google = require('./google');
const { parseUsername } = require('./username');
const { normalizePhone } = require('./phone');

const A = config.AUTH;
const BAD_LOGIN = 'Email or password is incorrect.';
const LOGIN_HINT = 'No password yet, or signed up with Google? Use “Forgot password” to get a link to set one, or Continue with Google.';
const FORGOT_OK = 'If that email has an account, a link is on its way. Check your inbox (and spam).';

module.exports = function routes(route, kit) {
  const { httpError, rateLimit, clientIp, isValidEmail } = kit;
  const link = (ctx, path, token) => `${ctx.origin}${path}?token=${encodeURIComponent(token)}`;
  const limit = (key, perMin, msg = 'Too many attempts. Wait a minute and try again.') => { if (!rateLimit(key, perMin)) throw httpError(429, msg); };
  const str = (v, max = 320) => (typeof v === 'string' ? v : '').slice(0, max);
  const hours = (h) => (h % 24 === 0 ? `${h / 24} day${h === 24 ? '' : 's'}` : `${h} hours`);
  const mins = (m) => (m % 60 === 0 ? `${m / 60} hour${m === 60 ? '' : 's'}` : `${m} minutes`);

  async function me(ctx, { allowUnverified = false } = {}) {
    const u = await auth.getAuthUser(ctx.req, ctx.res, { allowUnverified });
    if (!u) throw httpError(401, 'Sign in to continue');
    return u;
  }
  async function sendVerify(ctx, user, email = user.email, kind = 'verify') {
    const token = await data.issueToken(user.id, kind, email, A.verifyTtlHours);
    mail.sendLater('verify', email, { name: user.display_name || user.displayName || user.username, link: link(ctx, '/verify-email', token), expires: hours(A.verifyTtlHours) });
  }
  async function sendSetPassword(ctx, row) {
    const kind = row.password_hash ? 'reset' : 'set_password';
    const token = await data.issueToken(row.id, kind, row.email, A.resetTtlMin);
    mail.sendLater(kind === 'reset' ? 'reset' : 'setPassword', row.email, { name: row.display_name || row.username, link: link(ctx, '/reset-password', token), expires: mins(A.resetTtlMin) });
  }
  const syncInvites = (userId, email) => { try { require('../../venue/data').syncSpeakerInvites(userId, email).catch(() => {}); } catch (_) { /* optional */ } };

  /* ---------- sign up ---------- */
  async function signup(ctx) {
    if (!config.ALLOW_LOCAL_SIGNUP) throw httpError(403, google.enabled() ? 'New accounts use Continue with Google.' : 'Sign-up is closed on this server.');
    const b = await ctx.body(16 * 1024);
    const email = data.normEmail(str(b.email));
    const password = str(b.password, 200);
    const displayName = str(b.displayName || b.display_name || b.name, 80).trim() || null;
    const parsed = parseUsername(str(b.username, 40));
    const phone = normalizePhone(str(b.phone, 40), str(b.country, 8));
    limit('signup:' + clientIp(ctx.req), Math.max(1, Math.ceil(A.ratePerMin / 4)), 'Too many new accounts from this network. Try again in a minute.');
    if (!isValidEmail(email)) throw httpError(400, 'Enter a valid email address');
    const weak = auth.passwordProblem(password);
    if (weak) throw httpError(400, weak);
    if (!parsed.ok) throw httpError(400, parsed.message);
    if (!phone.ok) throw httpError(400, phone.message);
    if (await data.usernameTaken(parsed.username)) throw httpError(409, 'That username is taken');

    const existing = await data.userByEmail(email);
    if (existing) {
      // Don't reveal it here; tell the owner by email instead.
      if (!(await data.recentToken(existing.id, ['reset', 'set_password'], 300))) {
        mail.sendLater('accountExists', existing.email, { link: `${ctx.origin}/login` });
      }
      return { $status: 202, $body: { ok: true, checkEmail: true, message: 'Check your inbox to continue.' } };
    }
    let row;
    try {
      row = await data.createUser({
        username: parsed.username, email, passwordHash: await auth.hashPassword(password), displayName,
        phone: phone.e164, phoneVerified: false,
      });
    } catch (e) {
      if (data.isUsernameTakenError(e)) throw httpError(409, 'That username is taken');
      throw e;
    }
    syncInvites(row.id, email);
    await sendVerify(ctx, row);
    if (A.requireVerifiedEmail) return { $status: 202, $body: { ok: true, checkEmail: true, message: 'Check your inbox to confirm your email, then sign in.' } };
    await auth.startSession(ctx.req, ctx.res, row);
    return { $status: 201, $body: { user: auth.publicUser(auth.shapeUser(row)), verifyEmailSent: true } };
  }
  route('POST', '/api/signup', signup);
  route('POST', '/api/auth/signup', signup);

  /* ---------- sign in ---------- */
  async function login(ctx) {
    const b = await ctx.body(16 * 1024);
    const id = str(b.login || b.email || b.username, 320).trim();
    const password = str(b.password, 200);
    if (!id || !password) throw httpError(400, 'Enter your email and password');
    limit('login:id:' + id.toLowerCase(), Math.max(3, Math.ceil(A.ratePerMin / 4)), 'Too many attempts for this account. Wait a minute and try again.');
    const row = await data.userByLogin(id);
    const ok = await auth.verifyPassword(password, row && row.password_hash);
    if (!ok) {
      if (row && !row.password_hash && !(await data.recentToken(row.id, ['set_password', 'reset'], 600))) await sendSetPassword(ctx, row);
      return { $status: 401, $body: { error: BAD_LOGIN, hint: LOGIN_HINT } };
    }
    if (A.requireVerifiedEmail && !row.email_verified_at) {
      if (!(await data.recentToken(row.id, ['verify'], 120))) await sendVerify(ctx, row);
      return { $status: 403, $body: { error: 'Confirm your email first. We just sent you a new link.', code: 'email-unverified' } };
    }
    await auth.startSession(ctx.req, ctx.res, row);
    return { user: auth.publicUser(auth.shapeUser(row)) };
  }
  route('POST', '/api/login', login);
  route('POST', '/api/auth/login', login);

  /* ---------- sign out ---------- */
  async function logout(ctx) { await auth.endSession(ctx.req, ctx.res); return { ok: true }; }
  route('POST', '/api/logout', logout);
  route('POST', '/api/auth/logout', logout);
  route('POST', '/api/auth/logout-all', async (ctx) => {
    const u = await me(ctx, { allowUnverified: true });
    const n = await auth.revokeAllSessions(u.id);
    auth.clearCookies(ctx.res);
    return { ok: true, signedOut: n };
  });

  /* ---------- sessions ---------- */
  route('GET', '/api/auth/sessions', async (ctx) => {
    const u = await me(ctx, { allowUnverified: true });
    const sid = await auth.currentSessionId(ctx.req, ctx.res);
    return {
      sessions: (await auth.listSessions(u.id)).map((s) => ({
        id: s.id, current: s.id === sid, method: s.method, createdAt: s.created_at, lastSeenAt: s.last_seen_at,
        userAgent: s.user_agent || '', ip: s.ip ? s.ip.replace(/(\d+)\.(\d+)$/, 'x.x').replace(/:[0-9a-f]*:[0-9a-f]*$/i, ':…') : '',
      })),
    };
  });
  route('DELETE', '/api/auth/sessions/([\\w-]{8,64})', async (ctx, [id]) => {
    const u = await me(ctx, { allowUnverified: true });
    await auth.revokeSession(u.id, id);
    if (id === await auth.currentSessionId(ctx.req, ctx.res)) auth.clearCookies(ctx.res);
    return { ok: true };
  });

  /* ---------- account ---------- */
  route('GET', '/api/auth/account', async (ctx) => {
    const u = await me(ctx, { allowUnverified: true });
    const row = await auth.userById(u.id);
    return {
      user: { ...auth.publicUser(u), phone: row.phone || null, phoneVerified: !!row.phone_verified },
      identities: (await data.identitiesFor(u.id)).map((i) => ({ provider: i.provider, email: i.email, linkedAt: i.created_at })),
      google: google.enabled(),
      requireVerifiedEmail: A.requireVerifiedEmail,
      passwordMin: A.passwordMin,
    };
  });

  route('GET', '/api/auth/username-available', async (ctx) => {
    limit('username-available:' + clientIp(ctx.req), Number(process.env.USERNAME_RATE_PER_MIN || 60));
    const raw = str((ctx.url && ctx.url.searchParams.get('u')) || '', 40);
    const parsed = parseUsername(raw);
    let exceptId = null;
    try {
      const meUser = await auth.getAuthUser(ctx.req, ctx.res, { allowUnverified: true });
      if (meUser) exceptId = meUser.id;
    } catch (_) { /* anonymous check */ }
    if (!parsed.ok) return { available: false, reason: parsed.reason, message: parsed.message };
    if (await data.usernameTaken(parsed.username, exceptId)) {
      return {
        available: false, reason: 'taken', message: 'That username is taken',
        suggestions: await data.usernameSuggestions(parsed.username, exceptId),
      };
    }
    return { available: true, username: parsed.username };
  });

  route('POST', '/api/auth/change-username', async (ctx) => {
    const u = await me(ctx, { allowUnverified: true });
    const b = await ctx.body(4096);
    limit('chun:' + u.id, 8);
    const parsed = parseUsername(str(b.username, 40));
    if (!parsed.ok) throw httpError(400, parsed.message);
    const row = await auth.userById(u.id);
    if (String(row.username || '').toLowerCase() === parsed.username) return { ok: true, username: row.username };
    if (await data.usernameTaken(parsed.username, u.id)) throw httpError(409, 'That username is taken');
    try {
      await data.setUsername(u.id, parsed.username);
    } catch (e) {
      if (data.isUsernameTakenError(e)) throw httpError(409, 'That username is taken');
      throw e;
    }
    auth.forgetUser(u.id);
    return { ok: true, username: parsed.username };
  });

  route('POST', '/api/auth/change-phone', async (ctx) => {
    const u = await me(ctx, { allowUnverified: true });
    const b = await ctx.body(4096);
    limit('chph:' + u.id, 8);
    const phone = normalizePhone(str(b.phone, 40), str(b.country, 8));
    if (!phone.ok) throw httpError(400, phone.message);
    await data.setPhone(u.id, phone.e164, false);
    auth.forgetUser(u.id);
    return { ok: true, phone: phone.e164, phoneVerified: false };
  });

  /* ---------- email verification ---------- */
  route('POST', '/api/auth/verify-email', async (ctx) => {
    const b = await ctx.body(4096);
    limit('verify:' + clientIp(ctx.req), 20);
    const t = await data.consumeToken(str(b.token, 200), ['verify', 'email_change']);
    if (!t) throw httpError(400, 'This link has expired or was already used. Request a new one from Settings.');
    const row = await auth.userById(t.user_id);
    if (!row) throw httpError(400, 'This link is no longer valid.');
    if (t.kind === 'email_change') {
      if (await data.userByEmail(t.email)) throw httpError(409, 'That email is now used by another account.');
      await kit.db.q('UPDATE users SET email = $2, email_verified_at = NOW(), updated_at = NOW() WHERE id = $1', [row.id, t.email]);
      syncInvites(row.id, t.email);
    } else {
      if (data.normEmail(row.email) !== t.email) throw httpError(400, 'Your email changed since this link was sent. Request a new one.');
      await data.markVerified(row.id);
    }
    auth.forgetUser(row.id);
    return { ok: true, email: t.email };
  });
  route('POST', '/api/auth/resend-verification', async (ctx) => {
    const u = await me(ctx, { allowUnverified: true });
    limit('resend:' + u.id, 2, 'We just sent one. Wait a minute before asking again.');
    if (!u.emailVerified) await sendVerify(ctx, { ...u, id: u.id });
    return { ok: true, message: 'If your email still needs confirming, a new link is on its way.' };
  });

  /* ---------- forgot / reset password ---------- */
  route('POST', '/api/auth/forgot', async (ctx) => {
    const b = await ctx.body(4096);
    const email = data.normEmail(str(b.email));
    limit('forgot:ip:' + clientIp(ctx.req), 5);
    if (isValidEmail(email) && rateLimit('forgot:em:' + email, 2)) {
      const row = await data.userByEmail(email);
      if (row && !(await data.recentToken(row.id, ['reset', 'set_password'], 60))) await sendSetPassword(ctx, row);
    }
    return { ok: true, message: FORGOT_OK };
  });
  route('POST', '/api/auth/reset', async (ctx) => {
    const b = await ctx.body(4096);
    limit('reset:' + clientIp(ctx.req), 10);
    const password = str(b.password, 200);
    const weak = auth.passwordProblem(password);
    if (weak) throw httpError(400, weak);
    const t = await data.consumeToken(str(b.token, 200), ['reset', 'set_password']);
    if (!t) throw httpError(400, 'This link has expired or was already used. Ask for a new one.');
    const before = await auth.userById(t.user_id);
    if (!before || data.normEmail(before.email) !== t.email) throw httpError(400, 'This link is no longer valid. Ask for a new one.');
    const row = await data.setPassword(t.user_id, await auth.hashPassword(password));
    await data.markVerified(row.id); // the link reached their inbox
    await kit.db.q("UPDATE auth_tokens SET used_at = NOW() WHERE user_id = $1 AND kind IN ('reset','set_password') AND used_at IS NULL", [row.id]);
    await auth.revokeAllSessions(row.id, { reason: 'password-reset' });
    await auth.startSession(ctx.req, ctx.res, row);
    return { ok: true, user: auth.publicUser(auth.shapeUser({ ...row, email_verified_at: row.email_verified_at || new Date() })) };
  });

  /* ---------- change password / email (signed in) ---------- */
  route('POST', '/api/auth/change-password', async (ctx) => {
    const u = await me(ctx, { allowUnverified: true });
    const b = await ctx.body(4096);
    limit('chpw:' + u.id, 5);
    const row = await auth.userById(u.id);
    if (row.password_hash && !(await auth.verifyPassword(str(b.currentPassword, 200), row.password_hash))) throw httpError(400, 'Your current password is not right');
    const pw = str(b.newPassword, 200);
    const weak = auth.passwordProblem(pw);
    if (weak) throw httpError(400, weak);
    await data.setPassword(u.id, await auth.hashPassword(pw));
    const sid = await auth.currentSessionId(ctx.req, ctx.res);
    const n = await auth.revokeAllSessions(u.id, { except: sid, reason: 'password-changed' });
    return { ok: true, otherSessionsSignedOut: n };
  });
  route('POST', '/api/auth/change-email', async (ctx) => {
    const u = await me(ctx, { allowUnverified: true });
    const b = await ctx.body(4096);
    limit('chem:' + u.id, 3);
    const email = data.normEmail(str(b.email));
    if (!isValidEmail(email)) throw httpError(400, 'Enter a valid email address');
    const row = await auth.userById(u.id);
    if (row.password_hash && !(await auth.verifyPassword(str(b.password, 200), row.password_hash))) throw httpError(400, 'Your password is not right');
    if (email === data.normEmail(row.email)) throw httpError(400, 'That is already your email');
    // Same answer whether or not the address is taken; only a free address gets a link.
    if (!(await data.userByEmail(email))) {
      await sendVerify(ctx, row, email, 'email_change');
      mail.sendLater('emailChanged', row.email, { newEmail: email });
    }
    return { ok: true, pending: email, message: `Check ${email} for a confirmation link. Your email changes once you open it.` };
  });
};
