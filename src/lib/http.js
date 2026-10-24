const zlib = require('zlib');

function readRaw(req, limit = 1e6) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error('Body too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function parseBody(req, limit = 1e6) {
  const buf = await readRaw(req, limit);
  if (!buf.length) return {};
  try {
    return JSON.parse(buf.toString('utf8'));
  } catch {
    throw Object.assign(new Error('Invalid JSON'), { status: 400 });
  }
}

// CORS: only origins listed in CORS_ORIGINS (comma separated, default the app domain) get
// credentialed cross-origin access. Same-origin requests never need CORS headers.
const CORS_ORIGINS = String(process.env.CORS_ORIGINS || process.env.PUBLIC_URL || 'https://venue.collab.name.ng')
  .split(',').map((x) => x.trim().replace(/\/$/, '')).filter(Boolean);
function corsFor(req) {
  const o = req && req.headers && req.headers.origin;
  if (!o) return {};
  if (CORS_ORIGINS.includes('*') || CORS_ORIGINS.includes(o)) return { 'Access-Control-Allow-Origin': o, 'Access-Control-Allow-Credentials': 'true', Vary: 'Origin' };
  return {};
}
const BASE_HEADERS = {
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Participant-Id, X-File-Name, X-Room-Code, X-Room-Credential',
  'X-Content-Type-Options': 'nosniff',
};

function sendJSON(res, status, data, extraHeaders = {}) {
  if (res.headersSent) return;
  const body = JSON.stringify(data);
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...BASE_HEADERS, ...corsFor(res.req), ...extraHeaders };
  const ae = (res.req && res.req.headers['accept-encoding']) || '';
  if (body.length > 2048 && /\bgzip\b/.test(ae)) {
    headers['Content-Encoding'] = 'gzip';
    headers.Vary = headers.Vary ? headers.Vary + ', Accept-Encoding' : 'Accept-Encoding';
    res.writeHead(status, headers);
    return res.end(zlib.gzipSync(body, { level: 5 }));
  }
  res.writeHead(status, headers);
  res.end(body);
}

function sendText(res, status, text, type = 'text/plain; charset=utf-8', extraHeaders = {}) {
  if (res.headersSent) return;
  res.writeHead(status, { 'Content-Type': type, ...BASE_HEADERS, ...corsFor(res.req), ...extraHeaders });
  res.end(text);
}

function getBearerToken(req) {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() || null : null;
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidUsername(username) {
  return /^[a-zA-Z0-9_]{3,24}$/.test(username);
}

function clientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  if (xf) return String(xf).split(',')[0].trim();
  return req.socket.remoteAddress || '';
}

// Tiny in-memory fixed-window rate limiter, keyed by ip and bucket
const buckets = new Map();
function rateLimit(key, perMin) {
  const now = Date.now();
  const win = Math.floor(now / 60000);
  const k = key + ':' + win;
  const n = (buckets.get(k) || 0) + 1;
  buckets.set(k, n);
  if (buckets.size > 20000) {
    for (const kk of buckets.keys()) if (!kk.endsWith(':' + win)) buckets.delete(kk);
  }
  return n <= perMin;
}

module.exports = {
  corsFor,
  readRaw,
  parseBody,
  sendJSON,
  sendText,
  getBearerToken,
  isValidEmail,
  isValidUsername,
  clientIp,
  rateLimit,
  BASE_HEADERS,
};
