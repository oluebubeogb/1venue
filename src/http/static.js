/**
 * Static file server for the SPA.
 * - Text assets are gzip-compressed and cached in memory (small footprint).
 * - sw.js and HTML are always revalidated; /vendor and /icons are long-cached.
 * - Unknown paths without an extension fall back to index.html (client router).
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const config = require('../config');

const ROOT = config.PUBLIC;
const VENDOR = {
  '/vendor/livekit-client.umd.js': path.join(path.dirname(require.resolve('livekit-client')), 'livekit-client.umd.js'),
};
const gzCache = new Map(); // filePath -> { mtimeMs, gz, raw }
const COMPRESSIBLE = new Set(['.html', '.css', '.js', '.mjs', '.json', '.svg', '.webmanifest', '.txt', '.map']);

function cacheControl(urlPath, ext) {
  if (urlPath === '/sw.js' || ext === '.html') return 'no-cache';
  if (urlPath.startsWith('/vendor/') || urlPath.startsWith('/icons/') || urlPath.startsWith('/fonts/')) {
    return 'public, max-age=604800, immutable';
  }
  return 'public, max-age=300, must-revalidate';
}

function send(req, res, filePath, urlPath) {
  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) return notFound(req, res, urlPath);
    const ext = path.extname(filePath).toLowerCase();
    const type = config.MIME[ext] || 'application/octet-stream';
    const etag = `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
    const headers = {
      'Content-Type': type,
      'Cache-Control': cacheControl(urlPath, ext),
      ETag: etag,
      'X-Content-Type-Options': 'nosniff',
    };
    if (ext === '.html') {
      headers['Referrer-Policy'] = 'strict-origin-when-cross-origin';
      headers['Permissions-Policy'] = 'camera=(self), microphone=(self), display-capture=(self), picture-in-picture=(self)';
    }
    if (urlPath === '/sw.js') headers['Service-Worker-Allowed'] = '/';
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, headers);
      return res.end();
    }
    const wantsGz = /\bgzip\b/.test(req.headers['accept-encoding'] || '') && COMPRESSIBLE.has(ext);
    if (wantsGz && st.size > 1024) {
      let c = gzCache.get(filePath);
      if (!c || c.mtimeMs !== st.mtimeMs) {
        const raw = fs.readFileSync(filePath);
        c = { mtimeMs: st.mtimeMs, gz: zlib.gzipSync(raw, { level: 7 }) };
        gzCache.set(filePath, c);
      }
      headers['Content-Encoding'] = 'gzip';
      headers.Vary = 'Accept-Encoding';
      headers['Content-Length'] = c.gz.length;
      res.writeHead(200, headers);
      return res.end(req.method === 'HEAD' ? undefined : c.gz);
    }
    headers['Content-Length'] = st.size;
    res.writeHead(200, headers);
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(filePath).pipe(res);
  });
}

function notFound(req, res, urlPath) {
  // Asset-looking paths 404; app routes get the SPA shell
  if (path.extname(urlPath) && !urlPath.endsWith('.html')) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end('Not found');
  }
  return send(req, res, path.join(ROOT, 'index.html'), '/index.html');
}

function serveStatic(req, res, urlPath) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain' });
    return res.end('Method not allowed');
  }
  if (urlPath.startsWith('/api/')) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Not found' }));
  }
  if (VENDOR[urlPath]) return send(req, res, VENDOR[urlPath], urlPath);
  let p = urlPath === '/' ? '/index.html' : urlPath;
  let decoded;
  try { decoded = decodeURIComponent(p); } catch (_) { decoded = p; }
  const filePath = path.join(ROOT, path.normalize(decoded).replace(/^(\.\.[/\\])+/, ''));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  return send(req, res, filePath, urlPath);
}

module.exports = { serveStatic };
