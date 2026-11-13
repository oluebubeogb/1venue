/**
 * Core: app config, sessions, sign-up/in (local + Collab Accounts SSO), /api/me.
 * Raw HTTP handler (moved verbatim from the old src/http/routes.js chain).
 * Each block answers its path and returns; unmatched requests fall through (return false).
 */
const {
  bcrypt, db, config, parseBody, sendJSON, isValidEmail, isValidUsername, getAuthUser, signToken, publicUser, ensureAccountsUser, localCookie, loginUrl, logoutUrl, features, publicErr, LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET, ACCOUNTS_URL, ACCOUNTS_JWT_SECRET,
} = require('./http-kit');

module.exports = async function handle(req, res, parsed) {
  const urlPath = parsed.pathname;

  // ----- Auth / suite config -----
  if (urlPath === '/api/config' && req.method === 'GET') {
    const ai = require('../venue/ai');
    const stt = require('../venue/stt');
    return sendJSON(res, 200, {
      appName: config.APP_NAME,
      publicUrl: config.PUBLIC_URL || null,
      accountsUrl: ACCOUNTS_URL || null,
      accountsEnabled: !!(ACCOUNTS_URL || ACCOUNTS_JWT_SECRET),
      accountsLoginUrl: config.ACCOUNTS_LOGIN_URL || null,
      allowLocalSignup: config.ALLOW_LOCAL_SIGNUP,
      livekitUrl: LIVEKIT_URL || null,
      livekitConfigured: !!(LIVEKIT_URL && LIVEKIT_API_KEY && LIVEKIT_API_SECRET),
      media: config.MEDIA,
      maxParticipants: config.MAX_PARTICIPANTS,
      maxAudience: config.MAX_AUDIENCE,
      defaultSpeakerSeats: config.DEFAULT_SPEAKER_SEATS,
      ai: ai.status(),
      stt: stt.status(),
      bible: { defaultTranslation: config.BIBLE.defaultTranslation },
      storage: { driver: config.STORAGE.driver, maxUploadBytes: config.STORAGE.maxUploadBytes, limits: require('../venue/uploads').publicLimits() },
      features,
    });
  }

  if (urlPath === '/api/session' && req.method === 'GET') {
    const user = await getAuthUser(req, res);
    const next = parsed.searchParams.get('next') || '/';
    const nextAbs = config.PUBLIC_URL ? config.PUBLIC_URL + next : next;
    return sendJSON(res, 200, {
      authenticated: !!user,
      user: user ? publicUser(user) : null,
      loginUrl: loginUrl(nextAbs),
      logoutUrl: logoutUrl(config.PUBLIC_URL || '/'),
    });
  }

  if (urlPath === '/api/logout' && req.method === 'POST') {
    return sendJSON(res, 200, { ok: true, logoutUrl: logoutUrl(config.PUBLIC_URL || '/') }, {
      'Set-Cookie': localCookie('', { clear: true }),
    });
  }

  if (urlPath === '/api/accounts/login' && req.method === 'POST') {
    if (!ACCOUNTS_URL) return sendJSON(res, 503, { error: 'Accounts not configured' });
    try {
      const body = await parseBody(req);
      const email = (body.email || body.login || '').trim();
      const password = body.password || '';
      if (!email || !password) return sendJSON(res, 400, { error: 'Email and password required' });
      const resA = await fetch(ACCOUNTS_URL + '/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await resA.json().catch(() => ({}));
      if (!resA.ok) {
        const detail = data.detail || data.error || 'Login failed';
        return sendJSON(res, resA.status, { error: typeof detail === 'string' ? detail : 'Login failed' });
      }
      const access = data.access_token;
      const u = data.user || {};
      const linked = await ensureAccountsUser({
        accountsId: String(u.id),
        email: u.email,
        username: u.username,
        displayName: u.display_name || u.username || u.email,
      });
      return sendJSON(res, 200, {
        token: access,
        user: publicUser({ ...linked, displayName: u.display_name || linked.username }),
        products: u.products || [],
      }, access ? { 'Set-Cookie': localCookie(access) } : {});
    } catch (e) {
      console.error('[accounts/login]', e);
      return sendJSON(res, 502, { error: publicErr(e, 'Accounts unreachable') });
    }
  }

  if (urlPath === '/api/accounts/signup' && req.method === 'POST') {
    if (!ACCOUNTS_URL) return sendJSON(res, 503, { error: 'Accounts not configured' });
    try {
      const body = await parseBody(req);
      const payload = {
        email: (body.email || '').trim(),
        password: body.password || '',
        display_name: (body.display_name || body.username || body.displayName || '').trim(),
      };
      if (body.username) payload.username = body.username;
      if (!payload.email || !payload.password || !payload.display_name) {
        return sendJSON(res, 400, { error: 'Email, password and name are required' });
      }
      const resA = await fetch(ACCOUNTS_URL + '/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await resA.json().catch(() => ({}));
      if (!resA.ok) {
        const detail = data.detail || data.error || 'Signup failed';
        return sendJSON(res, resA.status, { error: typeof detail === 'string' ? detail : 'Signup failed' });
      }
      const access = data.access_token;
      const u = data.user || {};
      const linked = await ensureAccountsUser({
        accountsId: String(u.id),
        email: u.email,
        username: u.username,
        displayName: u.display_name || u.username || u.email,
      });
      return sendJSON(res, 200, {
        token: access,
        user: publicUser({ ...linked, displayName: u.display_name || linked.username }),
        products: u.products || [],
      }, access ? { 'Set-Cookie': localCookie(access) } : {});
    } catch (e) {
      console.error('[accounts/signup]', e);
      return sendJSON(res, 502, { error: publicErr(e, 'Accounts unreachable') });
    }
  }

  if (urlPath === '/api/signup' && req.method === 'POST') {
    if (!config.ALLOW_LOCAL_SIGNUP) return sendJSON(res, 403, { error: 'Local sign-up is disabled. Use Collab Accounts.' });
    try {
      const body = await parseBody(req);
      const username = (body.username || '').trim();
      const email = (body.email || '').trim().toLowerCase();
      const password = body.password || '';

      if (!isValidUsername(username)) {
        return sendJSON(res, 400, { error: 'Username must be 3–24 chars (letters, numbers, underscore)' });
      }
      if (!isValidEmail(email)) {
        return sendJSON(res, 400, { error: 'Invalid email address' });
      }
      if (typeof password !== 'string' || password.length < 6) {
        return sendJSON(res, 400, { error: 'Password must be at least 6 characters' });
      }
      if (password.length > 128) {
        return sendJSON(res, 400, { error: 'Password too long' });
      }

      if (await db.getUserByUsername(username)) {
        return sendJSON(res, 409, { error: 'Username already taken' });
      }
      if (await db.getUserByEmail(email)) {
        return sendJSON(res, 409, { error: 'Email already registered' });
      }

      const passwordHash = await bcrypt.hash(password, 10);
      const user = await db.createUser({ username, email, passwordHash });
      try { await require('../venue/data').syncSpeakerInvites(user.id, email); } catch (_) {}
      const token = signToken(user);
      return sendJSON(res, 201, { token, user: publicUser(user) }, { 'Set-Cookie': localCookie(token) });
    } catch (e) {
      console.error('[signup]', e);
      return sendJSON(res, 500, { error: publicErr(e, 'Signup failed') });
    }
  }

  if (urlPath === '/api/login' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const login = (body.login || body.email || body.username || '').trim();
      const password = body.password || '';

      if (!login || !password) {
        return sendJSON(res, 400, { error: 'Login and password are required' });
      }

      // Prefer Collab Accounts when configured (suite SSO); local accounts remain a fallback.
      let accountsError = null;
      if (ACCOUNTS_URL) {
        try {
          const resA = await fetch(ACCOUNTS_URL + '/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ email: login, password }),
          });
          const data = await resA.json().catch(() => ({}));
          if (resA.ok && data.access_token) {
            const u = data.user || {};
            const linked = await ensureAccountsUser({
              accountsId: String(u.id),
              email: u.email,
              username: u.username,
              displayName: u.display_name || u.username || u.email,
            });
            return sendJSON(res, 200, {
              token: data.access_token,
              user: publicUser({ ...linked, displayName: u.display_name || linked.username }),
              products: u.products || [],
            }, { 'Set-Cookie': localCookie(data.access_token) });
          }
          // If Accounts rejects, fall through to local only when identity is not an email-looking Accounts attempt
          // Still surface Accounts error for email logins
          if (login.includes('@')) {
            const detail = data.detail || data.error || 'Invalid credentials';
            accountsError = typeof detail === 'string' ? detail : 'Invalid credentials';
          }
        } catch (e) {
          console.warn('[login] Accounts unreachable, trying local:', e.message);
        }
      }

      const row = await db.findUserByLogin(login);
      const ok = !!(row && row.password_hash && await bcrypt.compare(password, row.password_hash));
      if (!ok) {
        return sendJSON(res, 401, { error: accountsError || 'Invalid credentials' });
      }

      const user = publicUser(row);
      const token = signToken(user);
      return sendJSON(res, 200, { token, user }, { 'Set-Cookie': localCookie(token) });
    } catch (e) {
      console.error('[login]', e);
      return sendJSON(res, 500, { error: publicErr(e, 'Login failed') });
    }
  }

  if (urlPath === '/api/me' && req.method === 'GET') {
    const user = await getAuthUser(req, res);
    if (!user) return sendJSON(res, 401, { error: 'Not authenticated', loginUrl: loginUrl(config.PUBLIC_URL || '/') });
    const prefs = await require('../venue/data').getPrefs(user.id).catch(() => null);
    return sendJSON(res, 200, { user: publicUser(user), prefs });
  }

  return false;
};
