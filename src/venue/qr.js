/**
 * Colourful, one-of-a-kind QR codes. Each code takes the event owner's theme
 * colours, uses error-correction level H so the 1venue mark can sit in the
 * centre, and gets a module shape and gradient angle derived from the event
 * itself, so no two venues look alike. A caption strip carries event hints.
 */
const QRCode = require('qrcode');
const logo = require('./logo');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const HEX = /^#[0-9a-f]{6}$/i;
function hash(str) { let h = 2166136261; for (const ch of String(str)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function mix(a, b, t) {
  const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('');
}
function lum(h) { const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255); return 0.2126 * r + 0.7152 * g + 0.0722 * b; }
const CAT_EMOJI = { sermon: '✝', talk_show: '🎙', seminar: '🎓', presentation: '📊', workshop: '🛠', concert: '🎵', meeting: '👥', conference: '🏛', other: '✦' };

/**
 * @param {string} text  URL to encode
 * @param {object} o  { accent, accent2, title, subtitle, category, when, seed, frame (bool), dark (bool) }
 */
function svg(text, o = {}) {
  const qr = QRCode.create(String(text), { errorCorrectionLevel: 'H' });
  const n = qr.modules.size;
  const data = qr.modules.data;
  const accent = HEX.test(o.accent || '') ? o.accent : '#2563eb';
  const accent2 = HEX.test(o.accent2 || '') ? o.accent2 : mix(accent, '#db2777', 0.65);
  const deep = mix(accent, '#0b1020', 0.45);
  // keep modules dark enough to scan on white (and light enough on dark)
  const ink = (c) => (o.dark ? mix(c, '#ffffff', 0.25) : (lum(c) > 0.42 ? mix(c, '#0b1020', 0.35) : c));
  const g1 = ink(accent), g2 = ink(accent2);
  const seed = hash(o.seed || text);
  const shape = ['dot', 'round', 'diamond', 'squircle'][seed % 4];
  const angle = (seed >> 3) % 360;
  const cell = 10, quiet = 3;
  const frame = o.frame !== false;
  const size = (n + quiet * 2) * cell;
  const captionH = frame ? 96 : 0;
  const W = size, H = size + captionH;
  const bg = o.dark ? '#0b1020' : '#ffffff';
  const inFinder = (r, c) => (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);
  const logoCells = Math.ceil(n * 0.22) | 1;
  const lo = Math.floor((n - logoCells) / 2), hi = lo + logoCells;
  const inLogo = (r, c) => r >= lo - 1 && r <= hi && c >= lo - 1 && c <= hi;

  let mods = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!data[r * n + c] || inFinder(r, c) || inLogo(r, c)) continue;
      const x = (c + quiet) * cell, y = (r + quiet) * cell, h = cell / 2;
      if (shape === 'dot') mods += `<circle cx="${x + h}" cy="${y + h}" r="${h * 0.86}"/>`;
      else if (shape === 'diamond') mods += `<path d="M${x + h} ${y + 0.4}L${x + cell - 0.4} ${y + h}L${x + h} ${y + cell - 0.4}L${x + 0.4} ${y + h}Z"/>`;
      else if (shape === 'squircle') mods += `<rect x="${x + 0.6}" y="${y + 0.6}" width="${cell - 1.2}" height="${cell - 1.2}" rx="3.2"/>`;
      else mods += `<rect x="${x + 0.3}" y="${y + 0.3}" width="${cell - 0.6}" height="${cell - 0.6}" rx="1.8"/>`;
    }
  }
  const finder = (r, c) => {
    const x = (c + quiet) * cell, y = (r + quiet) * cell;
    return `<rect x="${x + 5}" y="${y + 5}" width="${cell * 7 - 10}" height="${cell * 7 - 10}" rx="18" fill="none" stroke="url(#qg)" stroke-width="10"/>`
      + `<rect x="${x + cell * 2}" y="${y + cell * 2}" width="${cell * 3}" height="${cell * 3}" rx="9" fill="${deep}"/>`;
  };
  const cx = size / 2, lr = (logoCells / 2 + 0.6) * cell;
  const t = esc((o.title || '').slice(0, 42));
  const sub = esc([CAT_EMOJI[o.category] || '', o.when || '', o.subtitle || ''].filter(Boolean).join('  ·  ').slice(0, 64));
  const txt = o.dark ? '#f8fafc' : '#0f172a';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="QR code${t ? ' for ' + t : ''}">
<defs>
<linearGradient id="qg" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="${size}" y2="${size}" gradientTransform="rotate(${angle} ${cx} ${cx})"><stop offset="0" stop-color="${g1}"/><stop offset=".55" stop-color="${mix(g1, g2, 0.5)}"/><stop offset="1" stop-color="${g2}"/></linearGradient>
<radialGradient id="halo" cx="50%" cy="50%" r="60%"><stop offset="0" stop-color="${accent}" stop-opacity=".10"/><stop offset="1" stop-color="${accent2}" stop-opacity="0"/></radialGradient>
</defs>
<rect width="${W}" height="${H}" rx="28" fill="${bg}"/>
<rect width="${W}" height="${size}" rx="28" fill="url(#halo)"/>
<g fill="url(#qg)">${mods}</g>
${finder(0, 0)}${finder(0, n - 7)}${finder(n - 7, 0)}
<circle cx="${cx}" cy="${cx}" r="${lr}" fill="${bg}" stroke="url(#qg)" stroke-width="3"/>
<svg x="${cx - lr * 0.78}" y="${cx - lr * 0.8}" width="${lr * 1.56}" height="${lr * 1.56}" viewBox="${logo.VIEWBOX}">${logo.markPaths(o.dark ? '#ffffff' : deep)}</svg>
${frame ? `<rect x="18" y="${size - 6}" width="${W - 36}" height="${captionH - 14}" rx="18" fill="url(#qg)" opacity=".12"/>
<text x="${W / 2}" y="${size + 30}" text-anchor="middle" font-family="Inter,Segoe UI,system-ui,sans-serif" font-size="22" font-weight="700" fill="${txt}">${t || '1venue'}</text>
<text x="${W / 2}" y="${size + 60}" text-anchor="middle" font-family="Inter,Segoe UI,system-ui,sans-serif" font-size="15" fill="${mix(txt, accent, 0.45)}">${sub || 'Scan to join on 1venue'}</text>` : ''}
</svg>`;
}

module.exports = { svg };
