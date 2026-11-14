/**
 * Core: app config, the current session, /api/me.
 * Sign-up / sign-in / reset / Google live in src/features/auth (see docs/AUTH.md).
 * Each block answers its path and returns; unmatched requests fall through (return false).
 */
const {
  config, sendJSON, getAuthUser, publicUser, features, LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET,
} = require('./http-kit');

module.exports = async function handle(req, res, parsed) {
  const urlPath = parsed.pathname;

  if (urlPath === '/api/config' && req.method === 'GET') {
    const ai = require('../venue/ai');
    const stt = require('../venue/stt');
    const google = require('../features/auth/google');
    return sendJSON(res, 200, {
      appName: config.APP_NAME,
      publicUrl: config.PUBLIC_URL || null,
      allowLocalSignup: config.ALLOW_LOCAL_SIGNUP,
      auth: {
        google: google.enabled(),
        googleSignup: google.enabled() && config.AUTH.google.allowSignup,
        allowSignup: config.ALLOW_LOCAL_SIGNUP,
        requireVerifiedEmail: config.AUTH.requireVerifiedEmail,
        passwordMin: config.AUTH.passwordMin,
      },
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
    const raw = await getAuthUser(req, res, { allowUnverified: true });
    const user = raw && (!config.AUTH.requireVerifiedEmail || raw.emailVerified) ? raw : null;
    return sendJSON(res, 200, {
      authenticated: !!user,
      user: user ? publicUser(user) : null,
      // signed in but must confirm their email first (AUTH_REQUIRE_VERIFIED_EMAIL=true)
      pendingVerification: raw && !user ? { email: raw.email } : null,
    });
  }

  if (urlPath === '/api/me' && req.method === 'GET') {
    const user = await getAuthUser(req, res);
    if (!user) return sendJSON(res, 401, { error: 'Not authenticated' });
    const prefs = await require('../venue/data').getPrefs(user.id).catch(() => null);
    return sendJSON(res, 200, { user: publicUser(user), prefs });
  }

  return false;
};
