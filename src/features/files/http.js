/**
 * Files: GET /files/<id>/<name> downloads (local disk, or S3/R2 streamed when no public URL).
 * Raw HTTP handler (moved verbatim from the old src/http/routes.js chain).
 * Each block answers its path and returns; unmatched requests fall through (return false).
 */
const {
  sendJSON, data, storage, attach,
} = require('../../core/http-kit');

module.exports = async function handle(req, res, parsed) {
  const urlPath = parsed.pathname;

  // File downloads (local disk driver, or S3 proxied when there is no public URL)
  const fm = urlPath.match(/^\/files\/([\w-]{10,40})\/[^/]+$/);
  if (fm && req.method === 'GET') {
    const row = await data.getFile(fm[1]);
    if (!row) { sendJSON(res, 404, { error: 'File not found' }); return true; }
    try {
      const f = await storage().open(row);
      const inline = /^(image|audio|video)\//.test(row.mime) || row.mime === 'application/pdf';
      const headers = {
        'Content-Type': row.mime, 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': row.mime === 'application/pdf' ? "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'self'" : "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox",
        ...(inline ? {} : attach(row.filename)),
      };
      if (f.stream) { res.writeHead(200, { ...headers, ...(f.size != null ? { 'Content-Length': f.size } : {}) }); f.stream.on('error', () => res.destroy()); f.stream.pipe(res); }
      else { res.writeHead(200, headers); res.end(f.buffer); }
    } catch (e) { sendJSON(res, 404, { error: 'File missing from storage' }); }
    return true;
  }

  return false;
};
