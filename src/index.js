/**
 * 1venue server: HTTP routes, WebSocket hub, LiveKit tokens, and lifecycle jobs.
 * Migrations run automatically (with an advisory lock) before traffic is accepted.
 */
const http = require('http');
const db = require('../db');
const config = require('./config');
const { createRequestHandler } = require('./http/routes');
const { attachWebSocket } = require('./ws/hub');
const { cleanupInactiveMeetings, syncViewerCounts, pruneLeftParticipants } = require('./rooms/lifecycle');
const snapshot = require('./rooms/snapshot');
const { allMeetings } = require('./rooms/store');
const { isLiveKitConfigured } = require('./livekit/tokens');
const { features } = require('./lib/features');
const metrics = require('./core/metrics');

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
          res.end(JSON.stringify({ error: err.status ? err.message : 'Something went wrong on our side — please try again' }));
        } catch (_) {}
      }
    });
  });
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 66000;
  const wss = attachWebSocket(server);

  await new Promise((resolve) => server.listen(config.PORT, '0.0.0.0', resolve));
  console.log(`${config.APP_NAME} is running at http://0.0.0.0:${config.PORT}`);
  console.log('[features]', JSON.stringify(features));
  if (!isLiveKitConfigured()) console.warn('[WARN] LiveKit is not configured (LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET). Audio and video are disabled.');
  else console.log(`[LiveKit] ${config.LIVEKIT_URL}`);
  if (config.JWT_SECRET === config.DEFAULT_SECRET) console.warn('[WARN] JWT_SECRET is the default. Set a long random JWT_SECRET in production.');
  {
    const mail = require('./features/mail/mailer');
    const google = require('./features/auth/google');
    console.log(`[auth] local accounts${google.enabled() ? ' + Google sign-in' : ''}; email ${mail.configured() ? 'via SMTP ' + mail.settings().host : 'NOT configured (links are only logged)'}`);
    if (mail.configured()) mail.verify().catch(() => {});
  }

  const timers = [
    setInterval(() => { cleanupInactiveMeetings(); snapshot.expireSnapshots().catch(() => {}); }, config.MEETING_CLEANUP_INTERVAL_MS),
    setInterval(syncViewerCounts, 15000),
    setInterval(pruneLeftParticipants, 60_000),
  ];
  const metricsLog = metrics.startLogger();
  if (metricsLog) timers.push(metricsLog);
  timers.forEach((t) => t.unref());

  // Graceful shutdown (deploys, restarts). Live meetings are NOT ended: they are snapshotted to
  // Postgres and every client is told to reconnect. Media keeps flowing through LiveKit meanwhile,
  // and the next process restores each room when its people reconnect (src/rooms/snapshot.js).
  let stopping = false;
  const shutdown = async (sig) => {
    if (stopping) return;
    stopping = true;
    const force = setTimeout(() => process.exit(0), 8000); // Docker sends SIGKILL after 10s
    force.unref();
    console.log(`[shutdown] ${sig}: snapshotting ${allMeetings().size} live room(s)`);
    server.close(); // stop accepting new connections
    timers.forEach((t) => clearInterval(t));
    try { console.log(`[shutdown] saved ${await snapshot.snapshotAll()} snapshot(s)`); } catch (e) { console.error('[shutdown] snapshot failed', e.message); }
    wss.notifyRestart(config.RESTART.shutdownGraceMs);
    await new Promise((r) => setTimeout(r, Math.min(config.RESTART.shutdownGraceMs, 5000)));
    for (const ws of wss.clients) { try { ws.terminate(); } catch (_) {} }
    await db.close().catch(() => {});
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  return server;
}

module.exports = { start };
if (require.main === module) start();
