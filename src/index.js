/**
 * 1venue server: HTTP routes, WebSocket hub, LiveKit tokens, and lifecycle jobs.
 * Migrations run automatically (with an advisory lock) before traffic is accepted.
 */
const http = require('http');
const db = require('../db');
const config = require('./config');
const { createRequestHandler } = require('./http/routes');
const { attachWebSocket } = require('./ws/hub');
const { cleanupInactiveMeetings, syncViewerCounts, endMeeting } = require('./rooms/lifecycle');
const { allMeetings } = require('./rooms/store');
const { isLiveKitConfigured } = require('./livekit/tokens');
const { features } = require('./lib/features');

async function start() {
  if (process.env.AUTO_MIGRATE !== 'false') {
    await db.ensureReady();
  }
  const handleRequest = createRequestHandler();
  const server = http.createServer((req, res) => {
    Promise.resolve(handleRequest(req, res)).catch((err) => {
      console.error('[http]', req.method, req.url, err);
      if (!res.headersSent) {
        try {
          res.writeHead(err.status || 500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.status ? err.message : 'Server error' }));
        } catch (_) {}
      }
    });
  });
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 66000;
  attachWebSocket(server);

  await new Promise((resolve) => server.listen(config.PORT, '0.0.0.0', resolve));
  console.log(`${config.APP_NAME} is running at http://0.0.0.0:${config.PORT}`);
  console.log('[features]', JSON.stringify(features));
  if (!isLiveKitConfigured()) console.warn('[WARN] LiveKit is not configured (LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET). Audio and video are disabled.');
  else console.log(`[LiveKit] ${config.LIVEKIT_URL}`);
  if (config.JWT_SECRET === config.DEFAULT_SECRET) console.warn('[WARN] JWT_SECRET is the default. Set a long random JWT_SECRET in production.');
  console.log(config.ACCOUNTS_URL ? `[Accounts] SSO via ${config.ACCOUNTS_URL}` : '[Accounts] ACCOUNTS_URL not set; local accounts only');

  const timers = [
    setInterval(cleanupInactiveMeetings, config.MEETING_CLEANUP_INTERVAL_MS),
    setInterval(syncViewerCounts, 15000),
  ];
  timers.forEach((t) => t.unref());

  let stopping = false;
  const shutdown = async (sig) => {
    if (stopping) return;
    stopping = true;
    console.log(`[shutdown] ${sig}: closing rooms`);
    server.close();
    for (const [code] of allMeetings()) await endMeeting(code, 'server-restart').catch(() => {});
    await db.close().catch(() => {});
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  return server;
}

module.exports = { start };
if (require.main === module) start();
