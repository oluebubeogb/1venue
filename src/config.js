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
const JWT_TTL = env('JWT_TTL', '30d');
const PUBLIC_URL = env('PUBLIC_URL', '').replace(/\/$/, '');
const APP_NAME = env('APP_NAME', '1venue');

const LIVEKIT_URL = env('LIVEKIT_URL');
const LIVEKIT_API_KEY = env('LIVEKIT_API_KEY');
const LIVEKIT_API_SECRET = env('LIVEKIT_API_SECRET');

// Collab Accounts SSO (shared cookies on COOKIE_DOMAIN)
const ACCOUNTS_URL = env('ACCOUNTS_URL', 'https://accounts.collab.name.ng').replace(/\/$/, '');
const ACCOUNTS_LOGIN_URL = env('ACCOUNTS_LOGIN_URL', ACCOUNTS_URL ? ACCOUNTS_URL + '/login' : '');
const ACCOUNTS_JWT_SECRET = env('ACCOUNTS_JWT_SECRET', env('ACCOUNTS_SECRET_KEY'));
const ACCOUNTS_ACCESS_COOKIE = env('ACCOUNTS_ACCESS_COOKIE', 'access_token');
const ACCOUNTS_REFRESH_COOKIE = env('ACCOUNTS_REFRESH_COOKIE', 'refresh_token');
const COOKIE_DOMAIN = env('COOKIE_DOMAIN', '');
const ALLOW_LOCAL_SIGNUP = bool('ALLOW_LOCAL_SIGNUP', true);

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
  screenMaxBitrate: int('SCREEN_MAX_BITRATE', 2_500_000),
  screenMaxFps: int('SCREEN_MAX_FPS', 15),
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
  perHour: int('UPLOAD_RATE_PER_HOUR', 120),
  chatInlineBytes: mb('CHAT_INLINE_MAX_MB', 0.6), // legacy data-URL attachments over WS
};

const BIBLE = {
  apiBase: env('BIBLE_API_BASE', 'https://bible.helloao.org/api').replace(/\/$/, ''),
  fallbackBase: env('BIBLE_FALLBACK_BASE', 'https://bible-api.com').replace(/\/$/, ''),
  defaultTranslation: env('BIBLE_DEFAULT_TRANSLATION', 'eng_kjv'),
  cacheDays: int('BIBLE_CACHE_DAYS', 30),
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
  env, int, bool,
  PORT, PUBLIC, JWT_SECRET, DEFAULT_SECRET, JWT_TTL, PUBLIC_URL, APP_NAME,
  LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET,
  ACCOUNTS_URL, ACCOUNTS_LOGIN_URL, ACCOUNTS_JWT_SECRET, ACCOUNTS_ACCESS_COOKIE, ACCOUNTS_REFRESH_COOKIE,
  COOKIE_DOMAIN, ALLOW_LOCAL_SIGNUP,
  MEETING_INACTIVITY_MS, MEETING_CLEANUP_INTERVAL_MS, MAX_PARTICIPANTS, MAX_AUDIENCE, DEFAULT_SPEAKER_SEATS,
  MEDIA, AI, STT, STORAGE, UPLOADS, BIBLE, RATE_LIMIT_PER_MIN, TRUST_PROXY, MIME,
};
