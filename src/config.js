/**
 * 1venue configuration. Every setting comes from env. See .env.example.
 */
const path = require('path');

const env = (k, d = '') => (process.env[k] === undefined || process.env[k] === '' ? d : process.env[k]);
const int = (k, d) => {
  const n = parseInt(env(k, ''), 10);
  return Number.isFinite(n) ? n : d;
};
const bool = (k, d) => {
  const v = env(k, '');
  if (v === '') return d;
  return !['0', 'false', 'off', 'no'].includes(String(v).toLowerCase());
};

const PORT = int('PORT', 3000);
const PUBLIC = path.join(__dirname, '..', 'public');
const DEFAULT_SECRET = 'change-me-in-production-1venue-secret-key-32chars';
const JWT_SECRET = env('JWT_SECRET', DEFAULT_SECRET);
const PUBLIC_URL = env('PUBLIC_URL', '').replace(/\/$/, '');
const APP_NAME = env('APP_NAME', '1venue');

const LIVEKIT_URL = env('LIVEKIT_URL');
const LIVEKIT_API_KEY = env('LIVEKIT_API_KEY');
const LIVEKIT_API_SECRET = env('LIVEKIT_API_SECRET');

// Accounts (local email/password + optional Google). See docs/AUTH.md.
const AUTH = {
  accessTtlSec: int('AUTH_ACCESS_TTL_MIN', 15) * 60, // short-lived access JWT (cookie)
  refreshTtlDays: int('AUTH_REFRESH_TTL_DAYS', 30), // idle limit: each refresh extends it
  sessionMaxDays: int('AUTH_SESSION_MAX_DAYS', 90), // absolute limit per sign-in
  bcryptCost: Math.min(15, Math.max(4, int('BCRYPT_COST', 12))),
  passwordMin: Math.max(8, int('AUTH_PASSWORD_MIN', 8)),
  requireVerifiedEmail: bool('AUTH_REQUIRE_VERIFIED_EMAIL', false), // false = allow, show a banner
  verifyTtlHours: int('AUTH_VERIFY_TTL_HOURS', 48),
  resetTtlMin: int('AUTH_RESET_TTL_MIN', 60),
  ratePerMin: int('AUTH_RATE_PER_MIN', 20), // per IP for sign-in / sign-up / reset endpoints
  // Secure cookies unless PUBLIC_URL is plain http (local dev)
  cookieSecure: bool('AUTH_COOKIE_SECURE', !/^http:\/\//i.test(env('PUBLIC_URL', ''))),
  google: {
    clientId: env('GOOGLE_CLIENT_ID', ''),
    clientSecret: env('GOOGLE_CLIENT_SECRET', ''),
    discoveryUrl: env('GOOGLE_DISCOVERY_URL', 'https://accounts.google.com/.well-known/openid-configuration'),
    allowSignup: bool('GOOGLE_ALLOW_SIGNUP', true),
  },
};
const ALLOW_LOCAL_SIGNUP = bool('ALLOW_LOCAL_SIGNUP', true);
// When set (e.g. 1venue.example.com), requests for any other host (www., old domain) get a 301 there.
const CANONICAL_HOST = env('CANONICAL_HOST', '').replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase();

const MEETING_INACTIVITY_MS = int('MEETING_INACTIVITY_HOURS', 12) * 60 * 60 * 1000;
const MEETING_CLEANUP_INTERVAL_MS = 15 * 60 * 1000;
const MAX_PARTICIPANTS = int('MAX_PARTICIPANTS', 50);
const MAX_AUDIENCE = int('MAX_AUDIENCE', 300); // stage events: listeners beyond speaker seats
const DEFAULT_SPEAKER_SEATS = int('DEFAULT_SPEAKER_SEATS', 4);

// Media quality caps, tuned for a small server and SFU
const MEDIA = {
  videoMaxBitrate: int('VIDEO_MAX_BITRATE', 1_200_000),
  videoMaxFps: int('VIDEO_MAX_FPS', 24),
  videoResolution: env('VIDEO_RESOLUTION', '720p'),
  screenMaxBitrate: int('SCREEN_MAX_BITRATE', 1_200_000),
  screenMaxFps: int('SCREEN_MAX_FPS', 12),
  audioPreset: env('AUDIO_PRESET', 'speech'), // speech | music | musicHighQuality
  simulcast: bool('SIMULCAST', true),
  dynacast: bool('DYNACAST', true),
  adaptiveStream: bool('ADAPTIVE_STREAM', true),
};

// AI: two OpenAI-compatible providers with automatic fallback
const AI = {
  primary: {
    name: env('AI_PRIMARY_NAME', 'runpod'),
    baseUrl: env('AI_PRIMARY_BASE_URL').replace(/\/$/, ''),
    apiKey: env('AI_PRIMARY_API_KEY'),
    model: env('AI_PRIMARY_MODEL'),
  },
  secondary: {
    name: env('AI_SECONDARY_NAME', 'secondary'),
    baseUrl: env('AI_SECONDARY_BASE_URL').replace(/\/$/, ''),
    apiKey: env('AI_SECONDARY_API_KEY'),
    model: env('AI_SECONDARY_MODEL'),
  },
  timeoutMs: int('AI_TIMEOUT_MS', 45_000),
  maxTokens: int('AI_MAX_TOKENS', 900),
  mock: bool('AI_MOCK', false),
};

// Speech-to-text: an OpenAI-compatible /audio/transcriptions endpoint with fallback
const STT = {
  provider: env('STT_PROVIDER', 'auto'), // auto | natlas | whisper | webspeech | off
  primary: {
    name: env('STT_PRIMARY_NAME', 'N-ATLaS'),
    baseUrl: env('STT_PRIMARY_BASE_URL').replace(/\/$/, ''),
    apiKey: env('STT_PRIMARY_API_KEY'),
    model: env('STT_PRIMARY_MODEL', 'NCAIR1/NigerianAccentedEnglish'),
  },
  secondary: {
    name: env('STT_SECONDARY_NAME', 'Whisper'),
    baseUrl: env('STT_SECONDARY_BASE_URL').replace(/\/$/, ''),
    apiKey: env('STT_SECONDARY_API_KEY'),
    model: env('STT_SECONDARY_MODEL', 'whisper-1'),
  },
  chunkSeconds: int('STT_CHUNK_SECONDS', 8),
  maxChunkBytes: int('STT_MAX_CHUNK_BYTES', 2_000_000),
  timeoutMs: int('STT_TIMEOUT_MS', 30_000),
};

// Storage: VPS disk by default, S3-compatible when STORAGE_DRIVER=s3
const STORAGE = {
  driver: env('STORAGE_DRIVER', 'local'),
  localDir: env('STORAGE_DIR', path.join(__dirname, '..', 'data', 'uploads')),
  maxUploadBytes: int('MAX_UPLOAD_MB', 25) * 1024 * 1024,
  s3: {
    endpoint: env('S3_ENDPOINT').replace(/\/$/, ''),
    region: env('S3_REGION', 'us-east-1'),
    bucket: env('S3_BUCKET'),
    accessKeyId: env('S3_ACCESS_KEY_ID'),
    secretAccessKey: env('S3_SECRET_ACCESS_KEY'),
    forcePathStyle: bool('S3_FORCE_PATH_STYLE', true),
    publicBaseUrl: env('S3_PUBLIC_BASE_URL').replace(/\/$/, ''),
  },
};

// Upload limits. Lean defaults; every value can be tuned by env. 0 disables a type.
const mb = (k, d) => Math.round(Number(env(k, String(d))) * 1024 * 1024);
const UPLOADS = {
  maxImageBytes: mb('UPLOAD_MAX_IMAGE_MB', 8),
  maxPdfBytes: mb('UPLOAD_MAX_PDF_MB', 20),
  maxAudioBytes: mb('UPLOAD_MAX_AUDIO_MB', 10),
  maxVideoBytes: mb('UPLOAD_MAX_VIDEO_MB', 0), // video uploads are off: they would stream through the app server
  maxOtherBytes: mb('UPLOAD_MAX_OTHER_MB', 10),
  userQuotaBytes: mb('UPLOAD_USER_QUOTA_MB', 250),
  guestQuotaBytes: mb('UPLOAD_GUEST_QUOTA_MB', 30),
  meetingCapBytes: mb('UPLOAD_MEETING_CAP_MB', 150),
  perMinute: int('UPLOAD_RATE_PER_MIN', 12),
  contentPerMinute: int('UPLOAD_CONTENT_RATE_PER_MIN', 240),
  contentPerHour: int('UPLOAD_CONTENT_RATE_PER_HOUR', 480),
  perHour: int('UPLOAD_RATE_PER_HOUR', 120),
  chatInlineBytes: mb('CHAT_INLINE_MAX_MB', 0), // legacy data-URL attachments over WS; 0 = off (clients upload to /api/files)
};

const BIBLE = {
  apiBase: env('BIBLE_API_BASE', 'https://bible.helloao.org/api').replace(/\/$/, ''),
  fallbackBase: env('BIBLE_FALLBACK_BASE', 'https://bible-api.com').replace(/\/$/, ''),
  defaultTranslation: env('BIBLE_DEFAULT_TRANSLATION', 'eng_kjv'),
  cacheDays: int('BIBLE_CACHE_DAYS', 30),
};

// Memory guards for live rooms (all state lives in this process; see docs/ARCHITECTURE.md)
const MEMORY = {
  wsHeartbeatMs: int('WS_HEARTBEAT_MS', 30_000), // ping every socket; drop ones that miss a pong (0 disables)
  leftPruneMs: int('LEFT_PARTICIPANT_PRUNE_MINUTES', 10) * 60 * 1000, // forget people who left (0 disables)
  wbMaxStrokes: int('WB_MAX_STROKES', 1000), // shared whiteboard strokes kept per room / shared board page
  wbMaxPoints: int('WB_MAX_POINTS', 2000), // points kept per stroke
  timelineMaxItems: int('SCREEN_TIMELINE_MAX_ITEMS', 10),
  timelineMaxChars: int('SCREEN_TIMELINE_MAX_CHARS', 1_500_000), // ~1.1 MB JPEG per snapshot
};

// Graceful restarts: live rooms are snapshotted on SIGTERM and restored when people reconnect
const RESTART = {
  restoreMaxMs: int('MEETING_RESTORE_MAX_MINUTES', 30) * 60 * 1000, // older snapshots are ended instead
  shutdownGraceMs: int('SHUTDOWN_GRACE_MS', 1500), // time for "server-restarting" frames to flush
};

// Monitoring: GET /metrics (Prometheus text) needs METRICS_TOKEN as a Bearer token; unset = /metrics is 404.
const METRICS = {
  token: env('METRICS_TOKEN', ''),
  log: bool('METRICS_LOG', true), // one compact "[metrics] …" log line per interval
  logIntervalMs: int('METRICS_LOG_INTERVAL_MS', 60_000),
};

const RATE_LIMIT_PER_MIN = int('RATE_LIMIT_PER_MIN', 240);
const TRUST_PROXY = bool('TRUST_PROXY', true);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json',
  '.webm': 'audio/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.pdf': 'application/pdf',
};

module.exports = {
  env, int, bool, METRICS,
  PORT, PUBLIC, JWT_SECRET, DEFAULT_SECRET, PUBLIC_URL, APP_NAME,
  LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET,
  AUTH, ALLOW_LOCAL_SIGNUP, CANONICAL_HOST,
  MEETING_INACTIVITY_MS, MEETING_CLEANUP_INTERVAL_MS, MAX_PARTICIPANTS, MAX_AUDIENCE, DEFAULT_SPEAKER_SEATS,
  MEDIA, AI, STT, STORAGE, UPLOADS, BIBLE, MEMORY, RESTART, RATE_LIMIT_PER_MIN, TRUST_PROXY, MIME,
};
