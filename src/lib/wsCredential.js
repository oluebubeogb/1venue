/**
 * Short-lived signed credential binding a WebSocket session to a
 * (meeting code, participantId) pair issued by the HTTP join/create APIs.
 * Clients must present this on WS `register` — claiming an ID alone is not enough.
 */
const crypto = require('crypto');
const config = require('../config');

const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000; // 6h, matches LiveKit token TTL

function signWsCredential({ participantId, code, ttlMs = DEFAULT_TTL_MS }) {
  const exp = Date.now() + ttlMs;
  const payload = Buffer.from(
    JSON.stringify({
      pid: String(participantId),
      code: String(code || '').toUpperCase(),
      exp,
    }),
    'utf8'
  ).toString('base64url');
  const sig = crypto
    .createHmac('sha256', config.JWT_SECRET)
    .update(payload)
    .digest('base64url');
  return `${payload}.${sig}`;
}

function verifyWsCredential(token, { participantId, code } = {}) {
  if (!token || typeof token !== 'string' || !token.includes('.')) {
    return { ok: false, error: 'Missing or malformed ws credential' };
  }
  const [payload, sig] = token.split('.');
  if (!payload || !sig) {
    return { ok: false, error: 'Malformed ws credential' };
  }
  const expected = crypto
    .createHmac('sha256', config.JWT_SECRET)
    .update(payload)
    .digest('base64url');
  // timing-safe compare
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, error: 'Invalid ws credential signature' };
  }
  let data;
  try {
    data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch (_) {
    return { ok: false, error: 'Invalid ws credential payload' };
  }
  if (!data || !data.pid || !data.code || !data.exp) {
    return { ok: false, error: 'Incomplete ws credential' };
  }
  if (Date.now() > Number(data.exp)) {
    return { ok: false, error: 'Ws credential expired' };
  }
  if (participantId && String(data.pid) !== String(participantId)) {
    return { ok: false, error: 'Ws credential participant mismatch' };
  }
  if (code && String(data.code).toUpperCase() !== String(code).toUpperCase()) {
    return { ok: false, error: 'Ws credential meeting mismatch' };
  }
  return {
    ok: true,
    participantId: String(data.pid),
    code: String(data.code).toUpperCase(),
    exp: Number(data.exp),
  };
}

module.exports = {
  signWsCredential,
  verifyWsCredential,
  DEFAULT_TTL_MS,
};
