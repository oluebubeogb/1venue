/**
 * JSON API router. Features register routes from src/features/<id>/routes.js:
 *
 *   module.exports = function routes(route, kit) {
 *     route('GET', '/api/things/(\\d+)', async (ctx, [id]) => ({ id }));   // returned value -> 200 JSON
 *   };
 *
 * ctx = { req, res, url, origin, body(limit) }. Throw kit.httpError(status, msg) for errors.
 * Return { raw, type, headers } to send text/SVG instead of JSON.
 * Routes are matched in feature order, then in the order a feature registers them.
 */
const config = require('../config');
const { parseBody, sendJSON, sendText } = require('../lib/http');

const routes = [];

function route(method, pattern, handler, feature = null) {
  routes.push({ method, pattern, re: new RegExp(`^${pattern}$`), handler, feature });
}

let loaded = false;
function load() {
  if (loaded) return;
  loaded = true;
  const kit = require('./http-kit');
  for (const f of require('./features').list()) {
    if (!f.routes) continue;
    require(f.routes)((method, pattern, handler) => route(method, pattern, handler, f.id), kit);
  }
}

/** Answer /api/* requests that match a registered route. Returns true when handled. */
async function dispatch(req, res, parsed) {
  load();
  const path = parsed.pathname;
  if (!path.startsWith('/api/')) return false;
  for (const r of routes) {
    if (r.method !== req.method) continue;
    const m = path.match(r.re);
    if (!m) continue;
    const proto = (config.TRUST_PROXY && req.headers['x-forwarded-proto']) || 'http';
    const origin = config.PUBLIC_URL || `${String(proto).split(',')[0]}://${req.headers.host}`;
    const ctx = { req, res, url: parsed, origin, body: (limit) => parseBody(req, limit || 256 * 1024) };
    try {
      const out = await r.handler(ctx, m.slice(1));
      if (out && out.raw !== undefined) sendText(res, 200, out.raw, out.type, out.headers || {});
      else sendJSON(res, 200, out === undefined ? { ok: true } : out);
    } catch (e) {
      const status = e.status || 500;
      if (status >= 500) console.error('[api]', req.method, path, e);
      sendJSON(res, status, { error: status >= 500 && !e.expose ? (e.message || 'Server error') : e.message, ...(e.fallback ? { fallback: e.fallback } : {}) });
    }
    return true;
  }
  return false;
}

function list() { load(); return routes.map(({ method, pattern, feature }) => ({ method, pattern, feature })); }

module.exports = { route, dispatch, list, load };
