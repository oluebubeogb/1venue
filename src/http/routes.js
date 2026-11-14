/**
 * HTTP entry point. This file only wires the pipeline; the handlers live with their features:
 *
 *   OPTIONS / rate limits
 *   -> JSON API table routes      src/features/<id>/routes.js   (src/core/router.js)
 *   -> feature raw handlers       src/features/<id>/http.js     (streams, non-/api paths)
 *   -> /health, /metrics, /ready
 *   -> core auth + room routes    src/core/auth-routes.js, src/core/room-routes.js
 *   -> static files               src/http/static.js
 */
const { URL } = require('url');
const db = require('../../db');
const config = require('../config');
const { sendJSON, clientIp, rateLimit, BASE_HEADERS, corsFor } = require('../lib/http');
const { meetings } = require('../rooms/store');
const router = require('../core/router');
const features = require('../core/features');
const authRoutes = require('../core/auth-routes');
const roomRoutes = require('../core/room-routes');
const { serveStatic } = require('./static');
const metrics = require('../core/metrics');

const { PORT, LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET } = config;

const handled = (res, r) => r === true || res.headersSent || res.writableEnded;

function createRequestHandler() {
  router.load();
  const featureHandlers = features.httpHandlers();

  return async function handleRequest(req, res) {
    const parsed = new URL(req.url, `http://localhost:${PORT}`);
    const urlPath = parsed.pathname;

    // CANONICAL_HOST: 301 every other host name (www., an old domain) to the canonical one.
    // Health checks stay reachable on any host (Docker/Coolify call them by IP or container name).
    if (config.CANONICAL_HOST && !/^\/(health|ready|metrics|api\/health)$/.test(urlPath)) {
      const host = String((config.TRUST_PROXY && req.headers['x-forwarded-host']) || req.headers.host || '').split(',')[0].trim().toLowerCase().replace(/:\d+$/, '');
      if (host && host !== config.CANONICAL_HOST) {
        res.writeHead(301, { Location: `https://${config.CANONICAL_HOST}${req.url}`, 'Cache-Control': 'public, max-age=3600' });
        return res.end();
      }
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(204, { ...BASE_HEADERS, ...corsFor(req) });
      return res.end();
    }

    if (urlPath.startsWith('/api/')) {
      const ip = clientIp(req);
      if (!rateLimit('api:' + ip, config.RATE_LIMIT_PER_MIN)) {
        return sendJSON(res, 429, { error: 'Too many requests. Slow down a little.' });
      }
      if (/^\/api\/(login|signup|logout|auth\/)/.test(urlPath) && req.method !== 'GET' && !rateLimit('auth:' + ip, config.AUTH.ratePerMin)) {
        return sendJSON(res, 429, { error: 'Too many sign-in attempts. Try again in a minute.' });
      }
    }

    // Feature JSON APIs (events, discovery, social, bible, AI, transcripts, files, QR, prefs...)
    if (await router.dispatch(req, res, parsed)) return;

    // Feature raw handlers (file downloads, session history, schedule, attendance...)
    for (const h of featureHandlers) {
      if (handled(res, await h.handle(req, res, parsed))) return;
    }

    // Liveness: the process is up and serving. No DB call, so a slow database never gets the
    // container killed by Docker/Coolify healthchecks.
    if (urlPath === '/health') {
      return sendJSON(res, 200, {
        ok: true,
        app: config.APP_NAME,
        livekitConfigured: !!(LIVEKIT_API_KEY && LIVEKIT_API_SECRET && LIVEKIT_URL),
        uptime: Math.round(process.uptime()),
        liveRooms: meetings.size,
      });
    }

    // Prometheus metrics (protected by METRICS_TOKEN; 404 when unset)
    if (metrics.handle(req, res, urlPath)) return;

    // Readiness: can we serve real traffic (database reachable)? /api/health is kept as an alias.
    if (urlPath === '/ready' || urlPath === '/api/health') {
      let dbOk = false;
      try { await db.q('SELECT 1'); dbOk = true; } catch (_) {}
      return sendJSON(res, dbOk ? 200 : 503, {
        ok: dbOk,
        app: config.APP_NAME,
        livekitConfigured: !!(LIVEKIT_API_KEY && LIVEKIT_API_SECRET && LIVEKIT_URL),
        db: dbOk ? (db.USE_PG ? 'postgresql' : 'sqlite') : 'unreachable',
        uptime: Math.round(process.uptime()),
        liveRooms: meetings.size,
      });
    }

    if (handled(res, await authRoutes(req, res, parsed))) return;
    if (handled(res, await roomRoutes(req, res, parsed))) return;

    return serveStatic(req, res, urlPath);
  };
}

module.exports = { createRequestHandler };
