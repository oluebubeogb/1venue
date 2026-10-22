const { AccessToken } = require('livekit-server-sdk');
const config = require('../config');

// TrackSource enum (livekit-server-sdk v2). Prefer numeric/enum values —
// passing plain strings like "microphone" throws:
//   "Cannot convert TrackSource microphone to string"
let TrackSource = null;
try {
  TrackSource = require('livekit-server-sdk').TrackSource;
} catch (_) {
  TrackSource = null;
}

/**
 * Create a LiveKit access token with grants derived from Meet permissions.
 * @param {string} identity
 * @param {string} name
 * @param {string} roomName
 * @param {object} [opts]
 * @param {boolean} [opts.canPublish]
 * @param {boolean} [opts.canSubscribe]
 * @param {boolean} [opts.canPublishData]
 * @param {Array<number|string>} [opts.canPublishSources] - TrackSource enums only
 */
async function createLiveKitToken(identity, name, roomName, opts = {}) {
  if (!config.LIVEKIT_API_KEY || !config.LIVEKIT_API_SECRET) {
    throw new Error(
      'LiveKit is not configured on the server (missing LIVEKIT_API_KEY / LIVEKIT_API_SECRET)'
    );
  }
  const at = new AccessToken(config.LIVEKIT_API_KEY, config.LIVEKIT_API_SECRET, {
    identity: String(identity),
    name: String(name || identity),
    ttl: '6h',
  });

  const canPublish = opts.canPublish !== false;
  const canSubscribe = opts.canSubscribe !== false;
  const canPublishData = opts.canPublishData !== false;

  const grant = {
    roomJoin: true,
    room: String(roomName),
    canPublish,
    canSubscribe,
    canPublishData,
  };

  // Only attach canPublishSources when we have real TrackSource enum values.
  // Never pass raw strings — the JWT encoder cannot serialize them.
  if (Array.isArray(opts.canPublishSources) && opts.canPublishSources.length) {
    const safe = opts.canPublishSources.filter(
      (s) => typeof s === 'number' || (s && typeof s === 'object')
    );
    if (safe.length) {
      grant.canPublishSources = safe;
    }
  }

  at.addGrant(grant);
  return await at.toJwt();
}

/**
 * Map Meet permission object → LiveKit grant flags.
 */
function grantsFromPermissions(perms = {}) {
  const canPublish =
    !!perms.microphone || !!perms.camera || !!perms.screenShare;
  const canPublishData = !!perms.chat || !!perms.reactions;

  const sources = [];
  if (TrackSource) {
    // livekit-server-sdk exports TrackSource as an object of numeric enums
    if (perms.microphone && TrackSource.MICROPHONE != null) {
      sources.push(TrackSource.MICROPHONE);
    }
    if (perms.camera && TrackSource.CAMERA != null) {
      sources.push(TrackSource.CAMERA);
    }
    if (perms.screenShare) {
      if (TrackSource.SCREEN_SHARE != null) sources.push(TrackSource.SCREEN_SHARE);
      if (TrackSource.SCREEN_SHARE_AUDIO != null) sources.push(TrackSource.SCREEN_SHARE_AUDIO);
    }
  }

  return {
    canPublish,
    canSubscribe: true,
    canPublishData,
    // Only include when we have valid enum values; otherwise omit (canPublish covers it)
    canPublishSources: sources.length ? sources : undefined,
  };
}

function isLiveKitConfigured() {
  return !!(config.LIVEKIT_URL && config.LIVEKIT_API_KEY && config.LIVEKIT_API_SECRET);
}

module.exports = {
  createLiveKitToken,
  grantsFromPermissions,
  isLiveKitConfigured,
};
