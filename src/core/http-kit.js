/**
 * Everything a feature's HTTP code usually needs, in one place, so feature files don't
 * each carry a long list of relative requires. Feature routes get it as the 2nd argument
 * (routes.js) or can require it directly (http.js).
 */
const { URL } = require('url');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const db = require('../../db');
const config = require('../config');
const codes = require('../lib/codes');
const { normCode, isCode, codeLink } = codes;
const { parseBody, readRaw, sendJSON, sendText, isValidEmail, isValidUsername, clientIp, rateLimit } = require('../lib/http');
const auth = require('../lib/auth');
const { getAuthUser, publicUser } = auth;
const store = require('../rooms/store');
const { can, resolvePermissions, isModerator } = require('../lib/permissions');
const { endMeeting } = require('../rooms/lifecycle');
const { getOrRestoreMeeting, discardSnapshot } = require('../rooms/snapshot');
const { createLiveKitToken, isLiveKitConfigured, grantsFromPermissions } = require('../livekit/tokens');
const { signWsCredential, verifyWsCredential } = require('../lib/wsCredential');
const { features } = require('../lib/features');
const stage = require('../venue/stage');
const data = require('../venue/data');

const lazy = (m) => () => require(m);
const ai = lazy('../venue/ai');
const stt = lazy('../venue/stt');
const bible = lazy('../venue/bible');
const qr = lazy('../venue/qr');
const storage = lazy('../venue/storage');

/** Throw from a route handler to answer with that status: throw httpError(404, 'Not found'). */
function httpError(status, message) { const e = new Error(message); e.status = status; return e; }
async function requireUser(req, res) {
  const u = await getAuthUser(req, res);
  if (!u) throw httpError(401, 'Sign in to continue');
  return { ...u, ...publicUser(u) };
}
/** In-room callers prove membership with the same HMAC credential the WebSocket uses. */
function roomParticipant(req, codeHint) {
  const code = normCode(req.headers['x-room-code'] || codeHint);
  const pid = String(req.headers['x-participant-id'] || '');
  const cred = String(req.headers['x-room-credential'] || '');
  if (!code || !pid || !cred) return null;
  if (!verifyWsCredential(cred, { participantId: pid, code }).ok) return null;
  const meeting = store.getMeeting(code);
  const p = meeting && meeting.participants.get(pid);
  if (!p || p.status !== 'ACTIVE') return null;
  return { code, meeting, participant: p };
}
const int = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; };
const attach = (name) => ({ 'Content-Disposition': `attachment; filename="${String(name).replace(/[^\w.\- ]+/g, '_')}"` });

/** Live state for an event card (viewers, stage), or null when it isn't live in this process. */
function liveInfo(ev) {
  if (!ev || ev.status !== 'live') return null;
  const m = store.getMeeting(ev.code);
  if (!m) return null;
  let active = 0;
  for (const p of m.participants.values()) if (p.status === 'ACTIVE') active++;
  return { code: ev.code, viewers: active, stage: stage.state(m), requiresKey: !!m.requireInviteKey };
}

/* Never leak raw driver/DB errors (e.g. "violates check constraint …") to users. */
function publicErr(e, fallback) {
  if (e && e.code && /^[0-9A-Z]{5}$/.test(e.code)) { // Postgres SQLSTATE
    console.error('[db]', e.code, e.message);
    if (e.code === '23505') return 'That already exists';
    if (e.code === '23503') return 'That item no longer exists';
    if (e.code === '23514' || e.code === '22P02' || e.code === '22001') return 'Some of that input isn’t valid';
    return fallback;
  }
  const m = e && typeof e.message === 'string' ? e.message : '';
  if (!m || /ECONN|ETIMEDOUT|ENOTFOUND|socket hang up|relation .* does not exist|syntax error|column .* does not exist/i.test(m)) { if (m) console.error('[err]', m); return fallback; }
  return m.slice(0, 200);
}

const { PORT, PUBLIC, LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET, MIME } = config;

module.exports = {
  URL, fs, path, bcrypt, db, config, codes, normCode, isCode, codeLink,
  parseBody, readRaw, sendJSON, sendText, isValidEmail, isValidUsername, clientIp, rateLimit,
  auth, getAuthUser, publicUser,
  store, ...store,
  can, resolvePermissions, isModerator, endMeeting, getOrRestoreMeeting, discardSnapshot,
  createLiveKitToken, isLiveKitConfigured, grantsFromPermissions, signWsCredential, verifyWsCredential,
  features, stage, data, ai, stt, bible, qr, storage,
  httpError, requireUser, roomParticipant, int, attach, liveInfo, publicErr,
  PORT, PUBLIC, LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET, MIME,
};
