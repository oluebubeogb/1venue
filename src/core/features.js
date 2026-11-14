/**
 * Feature discovery. Every folder in src/features/ (except names starting with "_" or ".")
 * is a feature. Nothing is registered by hand: add a folder and it is picked up.
 *
 *   src/features/<id>/
 *     index.js        { id, order }                     optional manifest (order defaults to 1000)
 *     ws.js           { id, register(ctx) }             WebSocket plugin   (see src/core/plugin-registry.js)
 *     routes.js       (route, kit) => { route(...) }    JSON API routes    (see src/core/router.js)
 *     http.js         async (req, res, parsed) => {}    raw HTTP handler   (streams, non-/api paths)
 *     data.js         query functions                   (re-exported by src/venue/data.js)
 *     migrations/     YYYYMMDDHHMMSS_name.sql           picked up by db.js migrate()
 *     client/ws.js    browser module: onMessage(type, fn) handlers for room WebSocket messages
 *     client/*.css    styles, concatenated into /features/features.css
 *
 * FEATURE_<ID>=false (e.g. FEATURE_GROUP_CHAT=false) turns a feature's WebSocket plugin off,
 * exactly like the old hand-written plugin list did. Its HTTP routes stay on (pages outside
 * rooms use them).
 */
const fs = require('fs');
const path = require('path');
const { features: flags } = require('../lib/features');

const FEATURES_DIR = path.join(__dirname, '..', 'features');
const exists = (p) => { try { fs.accessSync(p); return true; } catch { return false; } };
const envName = (id) => 'FEATURE_' + id.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase();

function isEnabled(id) {
  if (Object.prototype.hasOwnProperty.call(flags, id)) return flags[id] !== false;
  const v = process.env[envName(id)];
  if (v === undefined || v === '') return true;
  return !['0', 'false', 'off', 'no'].includes(String(v).toLowerCase());
}

let cache = null;
function list() {
  if (cache) return cache;
  cache = fs.readdirSync(FEATURES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !/^[_.]/.test(d.name))
    .map((d) => {
      const dir = path.join(FEATURES_DIR, d.name);
      const meta = exists(path.join(dir, 'index.js')) ? require(path.join(dir, 'index.js')) : {};
      const clientDir = path.join(dir, 'client');
      return {
        id: meta.id || d.name,
        name: d.name,
        order: Number.isFinite(meta.order) ? meta.order : 1000,
        dir,
        meta,
        ws: exists(path.join(dir, 'ws.js')) ? path.join(dir, 'ws.js') : null,
        routes: exists(path.join(dir, 'routes.js')) ? path.join(dir, 'routes.js') : null,
        http: exists(path.join(dir, 'http.js')) ? path.join(dir, 'http.js') : null,
        data: exists(path.join(dir, 'data.js')) ? path.join(dir, 'data.js') : null,
        migrations: exists(path.join(dir, 'migrations')) ? path.join(dir, 'migrations') : null,
        clientWs: exists(path.join(clientDir, 'ws.js')),
        clientCss: exists(clientDir) ? fs.readdirSync(clientDir).filter((f) => f.endsWith('.css')).sort() : [],
      };
    })
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  return cache;
}

/** Register every feature's WebSocket plugin with the registry (in feature order). */
function registerWsPlugins(registerPlugin) {
  for (const f of list()) if (f.ws) registerPlugin(require(f.ws));
}

/** Raw HTTP handlers, in feature order. */
function httpHandlers() {
  return list().filter((f) => f.http).map((f) => ({ id: f.id, handle: require(f.http) }));
}

module.exports = { list, isEnabled, envName, registerWsPlugins, httpHandlers, FEATURES_DIR };
