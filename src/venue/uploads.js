/**
 * Upload policy: per-type size limits, per-user / per-guest quota, per-meeting cap and
 * rate limits. Everything is configured in config.UPLOADS (env) with lean defaults.
 */
const config = require('../config');
const { rateLimit } = require('../lib/http');

const U = config.UPLOADS;
const PURPOSES = new Set(['attachment', 'avatar', 'cover', 'post', 'timeline', 'transcript', 'content', 'chat', 'voice', 'whiteboard', 'sound', 'other']);
const normalizePurpose = (p) => (PURPOSES.has(String(p || '')) ? String(p) : 'attachment');

function kindOf(mime) {
  const m = String(mime || '').toLowerCase();
  if (m.startsWith('image/')) return 'image';
  if (m === 'application/pdf') return 'pdf';
  if (m.startsWith('audio/')) return 'audio';
  if (m.startsWith('video/')) return 'video';
  return 'other';
}
const LIMIT = { image: 'maxImageBytes', pdf: 'maxPdfBytes', audio: 'maxAudioBytes', video: 'maxVideoBytes', other: 'maxOtherBytes' };
const LABEL = { image: 'Images', pdf: 'PDFs', audio: 'Audio files', video: 'Videos', other: 'Files' };
const fmtMB = (b) => { const v = b / 1048576; return (v >= 10 ? Math.round(v) : Math.round(v * 10) / 10) + ' MB'; };
function limitFor(mime) { return Math.min(U[LIMIT[kindOf(mime)]], config.STORAGE.maxUploadBytes); }
const err = (status, message) => Object.assign(new Error(message), { status, expose: true });

const hours = new Map();
function hourly(key) {
  const h = Math.floor(Date.now() / 3600e3), k = key + ':' + h;
  const n = (hours.get(k) || 0) + 1; hours.set(k, n);
  if (hours.size > 5000) for (const kk of hours.keys()) if (!kk.endsWith(':' + h)) hours.delete(kk);
  return n <= U.perHour;
}

/** Cheap pre-checks before the body is read. */
function precheck({ mime, declaredSize, rateKey }) {
  const kind = kindOf(mime);
  const max = limitFor(mime);
  if (/html|javascript|svg|x-msdownload|x-sh\b/i.test(mime)) throw err(415, 'That file type is not allowed');
  if (!max) throw err(415, kind === 'video' ? 'Video uploads are turned off — share a YouTube link instead.' : `${LABEL[kind]} can’t be uploaded here`);
  if (declaredSize && declaredSize > max) throw err(413, `${LABEL[kind]} can be up to ${fmtMB(max)} (this one is ${fmtMB(declaredSize)})`);
  if (!rateLimit(`up:m:${rateKey}`, U.perMinute)) throw err(429, 'Too many uploads — wait a minute and try again');
  if (!hourly(rateKey)) throw err(429, 'Hourly upload limit reached — try again later');
  return max;
}

/** Quota checks once the size is known. data = venue data module. */
async function quota(data, { size, userId, ownerKey, roomCode }) {
  const used = await data.fileUsage({ userId, ownerKey });
  const cap = userId ? U.userQuotaBytes : U.guestQuotaBytes;
  if (cap && used + size > cap) throw err(413, `Storage quota reached (${fmtMB(used)} of ${fmtMB(cap)} used). Delete old uploads or ask the admin for more.`);
  if (roomCode && U.meetingCapBytes) {
    const r = await data.fileUsage({ roomCode });
    if (r + size > U.meetingCapBytes) throw err(413, `This meeting has reached its ${fmtMB(U.meetingCapBytes)} upload cap`);
  }
}

function publicLimits() {
  return {
    image: limitFor('image/png'), pdf: limitFor('application/pdf'), audio: limitFor('audio/webm'), video: limitFor('video/mp4'), other: limitFor('application/octet-stream'),
    userQuota: U.userQuotaBytes, meetingCap: U.meetingCapBytes, perMinute: U.perMinute,
  };
}

module.exports = { PURPOSES, normalizePurpose, kindOf, limitFor, precheck, quota, publicLimits, fmtMB };
