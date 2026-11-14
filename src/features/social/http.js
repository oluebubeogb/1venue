/**
 * Public profile pages: GET /u/:username (raw HTTP handler).
 * Serves the SPA shell with the person's name, bio and photo in <title> and Open Graph tags so
 * shared links preview properly. /u/<id>, /u/<handle> and other letter cases 301 to the
 * canonical lower-case /u/<username>. Unknown people get the shell with a real 404 status.
 */
const fs = require('fs');
const path = require('path');
const { config } = require('../../core/http-kit');
const { one } = require('../../core/db');

let shell = { mtimeMs: 0, html: '' };
function indexHtml() {
  const file = path.join(config.PUBLIC, 'index.html');
  const st = fs.statSync(file);
  if (st.mtimeMs !== shell.mtimeMs) shell = { mtimeMs: st.mtimeMs, html: fs.readFileSync(file, 'utf8') };
  return shell.html;
}
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function findUser(key) {
  if (/^\d+$/.test(key)) return one('SELECT id, username, display_name, bio, avatar_url FROM users WHERE id=$1', [Number(key)]);
  return (await one('SELECT id, username, display_name, bio, avatar_url FROM users WHERE LOWER(username)=LOWER($1)', [key]))
    || one('SELECT id, username, display_name, bio, avatar_url FROM users WHERE LOWER(handle)=LOWER($1) LIMIT 1', [key]);
}

function render(u, origin) {
  let html = indexHtml();
  const name = u ? (u.display_name || u.username) : 'Profile not found';
  const title = u ? `${name} (@${u.username}) — 1venue` : 'Profile not found — 1venue';
  const desc = u ? (u.bio || `${name} is on 1venue: live events, rooms and community.`).slice(0, 200) : 'This profile does not exist on 1venue.';
  const url = u ? `${origin}/u/${encodeURIComponent(u.username)}` : '';
  const img = u && u.avatar_url ? (/^https?:\/\//.test(u.avatar_url) ? u.avatar_url : origin + u.avatar_url) : `${origin}/icons/icon-512.png`;
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`)
    .replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${esc(desc)}">`)
    .replace(/<meta property="og:title" content="[^"]*"><meta property="og:image" content="[^"]*">/,
      `<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:image" content="${esc(img)}"><meta property="og:type" content="profile">${u ? `<meta property="og:url" content="${esc(url)}"><link rel="canonical" href="${esc(url)}">` : '<meta name="robots" content="noindex">'}`);
  return html;
}

module.exports = async function handle(req, res, parsed) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  const m = /^\/u\/([^/]{1,64})\/?$/.exec(parsed.pathname);
  if (!m) return false;
  let key;
  try { key = decodeURIComponent(m[1]); } catch { key = m[1]; }
  if (!/^[\w.-]{1,64}$/.test(key)) key = '';
  const u = key ? await findUser(key).catch(() => null) : null;
  if (u && u.username && key !== u.username) {
    res.writeHead(301, { Location: `/u/${encodeURIComponent(u.username)}${parsed.search || ''}`, 'Cache-Control': 'no-cache' });
    res.end();
    return true;
  }
  const origin = config.PUBLIC_URL || `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}`;
  const body = render(u, origin);
  res.writeHead(u ? 200 : 404, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin' });
  res.end(req.method === 'HEAD' ? undefined : body);
  return true;
};
