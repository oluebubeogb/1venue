/**
 * Process and room metrics.
 *
 *   GET /metrics                Prometheus text format, needs "Authorization: Bearer $METRICS_TOKEN"
 *                               (404 when METRICS_TOKEN is unset, 401 on a wrong token)
 *   "[metrics] …" log line      every METRICS_LOG_INTERVAL_MS (60 s) unless METRICS_LOG=false
 */
const crypto = require('crypto');
const config = require('../config');
const store = require('../rooms/store');

const counters = { wsDeadTerminated: 0 };
let wss = null;

function setWss(server) { wss = server; }
function incDeadSockets(n = 1) { counters.wsDeadTerminated += n; }

function snapshot() {
  const mem = process.memoryUsage();
  let participants = 0;
  for (const ws of store.clients.values()) if (ws && ws.readyState === 1) participants++;
  return {
    rss: mem.rss,
    heapUsed: mem.heapUsed,
    heapTotal: mem.heapTotal,
    liveRooms: store.meetings.size,
    participants,
    sockets: wss ? wss.clients.size : 0,
    deadSockets: counters.wsDeadTerminated,
    uptime: Math.round(process.uptime()),
  };
}

const METRICS = [
  ['process_resident_memory_bytes', 'gauge', 'Resident set size in bytes.', 'rss'],
  ['nodejs_heap_used_bytes', 'gauge', 'V8 heap used in bytes.', 'heapUsed'],
  ['nodejs_heap_total_bytes', 'gauge', 'V8 heap allocated in bytes.', 'heapTotal'],
  ['venue_live_rooms', 'gauge', 'Meetings held in memory by this process.', 'liveRooms'],
  ['venue_connected_participants', 'gauge', 'Participants with an open room WebSocket.', 'participants'],
  ['venue_open_websockets', 'gauge', 'Open WebSocket connections (including not yet registered).', 'sockets'],
  ['venue_ws_dead_sockets_terminated_total', 'counter', 'Sockets terminated by the heartbeat because they stopped answering pings.', 'deadSockets'],
  ['process_uptime_seconds', 'gauge', 'Seconds since the process started.', 'uptime'],
];

function prometheus(s = snapshot()) {
  const lines = [];
  for (const [name, type, help, key] of METRICS) lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`, `${name} ${s[key]}`);
  return lines.join('\n') + '\n';
}

const mb = (b) => Math.round(b / 1048576);
function logLine(s = snapshot()) {
  return `[metrics] rss=${mb(s.rss)}MB heap=${mb(s.heapUsed)}/${mb(s.heapTotal)}MB rooms=${s.liveRooms} participants=${s.participants} sockets=${s.sockets} dead_sockets_total=${s.deadSockets} uptime=${s.uptime}s`;
}

function tokenOk(header) {
  const want = Buffer.from(`Bearer ${config.METRICS.token}`);
  const got = Buffer.from(String(header || ''));
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

/** Answers GET /metrics. Returns true when the request was for /metrics. */
function handle(req, res, urlPath) {
  if (urlPath !== '/metrics') return false;
  if (!config.METRICS.token) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
    return true;
  }
  if (!tokenOk(req.headers.authorization)) {
    res.writeHead(401, { 'Content-Type': 'text/plain', 'WWW-Authenticate': 'Bearer' });
    res.end('Unauthorized');
    return true;
  }
  const body = prometheus();
  res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(req.method === 'HEAD' ? undefined : body);
  return true;
}

function startLogger() {
  if (!config.METRICS.log || !(config.METRICS.logIntervalMs > 0)) return null;
  const t = setInterval(() => console.log(logLine()), config.METRICS.logIntervalMs);
  t.unref();
  return t;
}

module.exports = { setWss, incDeadSockets, snapshot, prometheus, logLine, handle, startLogger, counters };
