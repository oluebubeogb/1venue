// Whiteboard core: board model, stroke painters (pencil / pen / airbrush / eraser), page rendering and
// file formats (.mwb v1 + v2, PNG, PDF). No DOM besides offscreen canvases, so it is reusable everywhere.

export const VW = 1600, VH = 1000; // virtual page size; every board looks the same on every screen
export const TOOLS = {
  pencil: { label: 'Pencil', icon: 'pencil', width: 1.5, min: 1, max: 5 },
  pen: { label: 'Pen', icon: 'penTool', width: 3, min: 1, max: 14 },
  brush: { label: 'Airbrush', icon: 'brush', width: 34, min: 10, max: 120 },
  eraser: { label: 'Eraser', icon: 'eraser', width: 28, min: 8, max: 120 },
};
export const BGS = ['dots', 'grid', 'lines', 'plain'];
const MAX_PAGES = 50;

// 'ink' follows the paper: near-black on light paper, near-white on dark paper, so boards read in both themes.
let INK = '#111827';
export const setInkTheme = (dark) => { INK = dark ? '#e8edf5' : '#111827'; };
export const inkOf = (c) => (c === 'ink' ? INK : c);
const LEGACY_INK = new Set(['#111827', '#111', '#111111', '#000', '#000000']);
const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);
const clampN = (v, a, b) => Math.max(a, Math.min(b, v));
export const uid = () => Math.random().toString(36).slice(2, 10);
export const emptyPage = () => ({ strokes: [], images: [], texts: [] });

function cleanStroke(s) {
  if (!s || !Array.isArray(s.points) || !s.points.length) return null;
  const tool = s.erase ? 'eraser' : TOOLS[s.tool] ? s.tool : 'pen';
  const points = s.points.map((p) => Array.isArray(p) ? [num(p[0]), num(p[1]), clampN(num(p[2], 1), 0.1, 3)] : p && typeof p === 'object' ? [num(p.x), num(p.y), 1] : null).filter(Boolean);
  if (!points.length) return null;
  return { id: String(s.id || uid()), tool, color: typeof s.color === 'string' ? (LEGACY_INK.has(s.color.toLowerCase()) ? 'ink' : s.color.slice(0, 32)) : 'ink', width: clampN(num(s.width, TOOLS[tool].width), 0.5, 200), points };
}
const okUrl = (u) => typeof u === 'string' && /^(\/files\/|data:image\/)/.test(u);
function cleanPage(p) {
  p = p || {};
  return {
    strokes: (Array.isArray(p.strokes) ? p.strokes : []).map(cleanStroke).filter(Boolean),
    images: (Array.isArray(p.images) ? p.images : []).filter((i) => i && okUrl(i.url)).map((i) => ({ id: String(i.id || uid()), url: i.url, x: num(i.x), y: num(i.y), w: Math.max(8, num(i.w, 400)), h: Math.max(8, num(i.h, 300)) })),
    texts: (Array.isArray(p.texts) ? p.texts : []).filter((t) => t && String(t.text || '').trim()).map((t) => ({ id: String(t.id || uid()), x: num(t.x), y: num(t.y), text: String(t.text).slice(0, 2000), size: clampN(num(t.size, 32), 8, 200), color: typeof t.color === 'string' ? (LEGACY_INK.has(t.color.toLowerCase()) ? 'ink' : t.color.slice(0, 32)) : 'ink', bold: !!t.bold })),
  };
}

/** v1 (.mwb from the original Meet app): 1920x1080 canvas, points {x,y}, base width × tool factor, optional PNG snapshot. */
export function fromV1(d) {
  const S = VW / 1920;
  const eff = (tool, b) => (tool === 'pencil' ? Math.max(1, b) : tool === 'pen' ? Math.max(2, b * 2.5) : tool === 'brush' ? Math.max(5, b * 6) : tool === 'eraser' ? Math.max(12, b * 8) : b);
  const pages = (d.boards || []).map((b) => {
    const page = emptyPage();
    if (b && typeof b.snapshot === 'string' && b.snapshot.startsWith('data:image/')) {
      // The snapshot is the exact picture (v1 undo only rewound the bitmap), so it is the source of truth.
      page.images.push({ id: uid(), url: b.snapshot, x: 0, y: 0, w: VW, h: 1080 * S });
    } else {
      for (const s of (b && b.strokes) || []) {
        const tool = s.erase || s.tool === 'eraser' ? 'eraser' : TOOLS[s.tool] ? s.tool : 'pen';
        const st = cleanStroke({ tool, color: s.color, width: eff(tool, num(s.baseWidth || s.width, 2)) * S, points: (s.points || []).map((p) => [num(p.x) * S, num(p.y) * S, 1]) });
        if (st) { if (tool === 'brush') st.width *= 1.4; page.strokes.push(st); }
      }
    }
    for (const t of (b && b.texts) || []) {
      const text = String(t.text || '').trim();
      if (text) page.texts.push({ id: uid(), x: num(t.x) * S, y: num(t.y) * S, text, size: num(t.fontSize, 18) * S * 1.6, color: t.color || 'ink', bold: /bold|[6-9]00/.test(String(t.fontWeight || '')) });
    }
    return page;
  });
  return { version: 2, bg: 'plain', pages: pages.length ? pages : [emptyPage()], activePage: clampN(num(d.activeBoard), 0, Math.max(0, pages.length - 1)) };
}

/** Accepts anything we have ever stored or exported and returns a v2 board. */
export function normalizeBoard(d) {
  if (typeof d === 'string') { try { d = JSON.parse(d); } catch { d = null; } }
  if (Array.isArray(d)) d = { strokes: d };
  if (!d || typeof d !== 'object') d = {};
  if (Array.isArray(d.boards)) return fromV1(d);
  const pages = (Array.isArray(d.pages) ? d.pages : [{ strokes: d.strokes || [], images: d.images || [], texts: d.texts || [] }]).slice(0, MAX_PAGES).map(cleanPage);
  return { version: 2, bg: BGS.includes(d.bg) ? d.bg : 'dots', pages: pages.length ? pages : [emptyPage()], activePage: clampN(num(d.activePage), 0, Math.max(0, pages.length - 1)) };
}
export const pageEmpty = (p) => !p || (!p.strokes.length && !p.images.length && !p.texts.length);

// ------------------------------------------------------------------ capture model (pressure + speed)
/** Width multiplier for a new point. pressure 0..1 (0.5 for mouse/touch), speed in virtual px/ms. */
export function pointWidth(tool, pressure, speed, prev) {
  const v = Math.min(speed, 6);
  let w;
  if (tool === 'pen') w = (0.55 + pressure * 0.9) * clampN(1.18 - v * 0.13, 0.55, 1.18);
  else if (tool === 'pencil') w = (0.7 + pressure * 0.6) * clampN(1.1 - v * 0.08, 0.7, 1.1);
  else if (tool === 'brush') w = (0.5 + pressure) * clampN(1.22 - v * 0.16, 0.45, 1.22);
  else w = 1;
  if (prev != null) w = prev + (w - prev) * 0.35; // low-pass so width breathes instead of jittering
  return Math.round(w * 100) / 100;
}

// ------------------------------------------------------------------ painters
function rng(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function hashStr(str) { let x = 2166136261; for (const c of String(str)) x = Math.imul(x ^ c.charCodeAt(0), 16777619); return x >>> 0; }
const sprites = new Map();
function brushSprite(color) {
  if (sprites.has(color)) return sprites.get(color);
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'); const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.fillStyle = color; g.fillRect(0, 0, 1, 1); const [r, gg, b] = g.getImageData(0, 0, 1, 1).data; g.clearRect(0, 0, 1, 1);
  gr.addColorStop(0, `rgba(${r},${gg},${b},1)`); gr.addColorStop(0.45, `rgba(${r},${gg},${b},.55)`); gr.addColorStop(1, `rgba(${r},${gg},${b},0)`);
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  if (sprites.size > 40) sprites.clear();
  sprites.set(color, c); return c;
}

/** Incremental painter: seg(i) draws the piece ending at point i, end() finishes. Full render = seg(1..n-1)+end(),
 *  so live drawing and redraws are pixel-identical (grain/dabs use a seeded RNG per stroke). px = virtual units per screen px. */
export function painter(ctx, s0, px = 1) {
  const s = { ...s0, color: inkOf(s0.color) };
  const P = s.points, base = s.width, tool = s.tool;
  const rand = rng(hashStr(s.id || '') ^ Math.round(P[0][0] * 7 + P[0][1] * 13));
  let carry = 0;
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  function line(i) {
    ctx.save();
    ctx.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over';
    ctx.strokeStyle = s.color; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const a = P[i - 1], b = P[i];
    ctx.lineWidth = Math.max(px * 0.9, base * (tool === 'eraser' ? 1 : (a[2] + b[2]) / 2));
    ctx.beginPath();
    if (i === 1) { ctx.moveTo(a[0], a[1]); const m = P.length > 1 ? mid(a, b) : b; ctx.lineTo(m[0], m[1]); }
    else { const m0 = mid(P[i - 2], a), m1 = mid(a, b); ctx.moveTo(m0[0], m0[1]); ctx.quadraticCurveTo(a[0], a[1], m1[0], m1[1]); }
    ctx.stroke(); ctx.restore();
  }
  function pencil(i) {
    const a = P[i - 1], b = P[i]; const dx = b[0] - a[0], dy = b[1] - a[1]; const len = Math.hypot(dx, dy);
    const step = px * 0.55; ctx.save(); ctx.fillStyle = s.color;
    let t = carry;
    for (; t <= len; t += step) {
      const f = len ? t / len : 0; const w = a[2] + (b[2] - a[2]) * f; const size = Math.max(px * 0.9, base * w);
      ctx.globalAlpha = (0.28 + rand() * 0.62) * clampN(w, 0.5, 1.1);
      const x = a[0] + dx * f + (rand() - 0.5) * size * 0.7, y = a[1] + dy * f + (rand() - 0.5) * size * 0.7;
      const sz = size * (0.6 + rand() * 0.6); ctx.fillRect(x - sz / 2, y - sz / 2, sz, sz);
    }
    carry = t - len;
    ctx.restore();
  }
  function brush(i) {
    const a = P[i - 1], b = P[i]; const dx = b[0] - a[0], dy = b[1] - a[1]; const len = Math.hypot(dx, dy);
    const spr = brushSprite(s.color); ctx.save();
    let t = carry;
    while (t <= len) {
      const f = len ? t / len : 0; const w = a[2] + (b[2] - a[2]) * f; const r = Math.max(px * 2, base * w / 2);
      ctx.globalAlpha = clampN(0.05 + 0.07 * w, 0.03, 0.2);
      const j = r * 0.12; ctx.drawImage(spr, a[0] + dx * f - r + (rand() - 0.5) * j, a[1] + dy * f - r + (rand() - 0.5) * j, r * 2, r * 2);
      t += Math.max(px, r * 0.22);
    }
    carry = t - len; ctx.restore();
  }
  function dot() {
    const [x, y, w] = P[0]; ctx.save();
    if (tool === 'brush') { const r = Math.max(px * 2, base * w / 2); ctx.globalAlpha = 0.15; ctx.drawImage(brushSprite(s.color), x - r, y - r, r * 2, r * 2); }
    else { ctx.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over'; ctx.fillStyle = s.color; ctx.globalAlpha = tool === 'pencil' ? 0.8 : 1; ctx.beginPath(); ctx.arc(x, y, Math.max(px * 0.5, base * (tool === 'eraser' ? 1 : w) / 2), 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
  }
  return {
    seg(i) { if (i < 1 || i >= P.length) return; if (tool === 'pencil') pencil(i); else if (tool === 'brush') brush(i); else line(i); },
    end() {
      if (P.length === 1) return dot();
      if (tool === 'pen' || tool === 'eraser') {
        const a = P[P.length - 2], b = P[P.length - 1], m = mid(a, b);
        ctx.save(); ctx.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over'; ctx.strokeStyle = s.color; ctx.lineCap = 'round';
        ctx.lineWidth = Math.max(px * 0.9, base * (tool === 'eraser' ? 1 : b[2])); ctx.beginPath(); ctx.moveTo(m[0], m[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); ctx.restore();
      }
    },
  };
}
export function drawStroke(ctx, s, px = 1) { const p = painter(ctx, s, px); for (let i = 1; i < s.points.length; i++) p.seg(i); p.end(); }

export const textFont = (t) => `${t.bold ? 700 : 500} ${t.size}px Inter, system-ui, sans-serif`;
export function drawTexts(ctx, texts) {
  ctx.save(); ctx.textBaseline = 'top';
  for (const t of texts) { ctx.font = textFont(t); ctx.fillStyle = inkOf(t.color); String(t.text).split('\n').forEach((ln, i) => ctx.fillText(ln, t.x, t.y + i * t.size * 1.25)); }
  ctx.restore();
}
export function textBox(ctx, t) { ctx.save(); ctx.font = textFont(t); const lines = String(t.text).split('\n'); const w = Math.max(...lines.map((l) => ctx.measureText(l).width), 10); ctx.restore(); return { x: t.x, y: t.y, w, h: lines.length * t.size * 1.25 }; }

const imgCache = new Map();
export function loadImg(url, onload) {
  let im = imgCache.get(url);
  if (!im) { im = new Image(); im.decoding = 'async'; im.src = url; imgCache.set(url, im); if (imgCache.size > 200) imgCache.delete(imgCache.keys().next().value); }
  if (!im.complete && onload) im.addEventListener('load', onload, { once: true });
  return im;
}
export function drawImages(ctx, images, onload) { for (const i of images) { const im = loadImg(i.url, onload); if (im.complete && im.naturalWidth) ctx.drawImage(im, i.x, i.y, i.w, i.h); } }

export function paperColor(dark) { return dark ? '#0f141d' : '#ffffff'; }
export function drawPaper(ctx, bg, dark) {
  ctx.fillStyle = paperColor(dark); ctx.fillRect(0, 0, VW, VH);
  if (bg === 'plain') return;
  ctx.save(); ctx.fillStyle = ctx.strokeStyle = dark ? 'rgba(255,255,255,.10)' : 'rgba(15,23,42,.10)'; ctx.lineWidth = 1;
  if (bg === 'dots') { for (let x = 40; x < VW; x += 40) for (let y = 40; y < VH; y += 40) ctx.fillRect(x - 1.2, y - 1.2, 2.4, 2.4); }
  else { ctx.beginPath(); if (bg === 'grid') for (let x = 40; x < VW; x += 40) { ctx.moveTo(x, 0); ctx.lineTo(x, VH); } for (let y = bg === 'lines' ? 80 : 40; y < VH; y += bg === 'lines' ? 48 : 40) { ctx.moveTo(0, y); ctx.lineTo(VW, y); } ctx.stroke(); }
  ctx.restore();
}

/** Flattened page as a canvas (for PNG / PDF / thumbnails). Waits for images. */
export async function renderPage(page, { bg = 'plain', dark = false, scale = 1 } = {}) {
  await Promise.all(page.images.map((i) => new Promise((r) => { const im = loadImg(i.url); if (im.complete) r(); else { im.addEventListener('load', r, { once: true }); im.addEventListener('error', r, { once: true }); } })));
  setInkTheme(dark);
  const out = document.createElement('canvas'); out.width = Math.round(VW * scale); out.height = Math.round(VH * scale);
  const o = out.getContext('2d'); o.scale(scale, scale); drawPaper(o, bg, dark); drawImages(o, page.images); drawTexts(o, page.texts);
  const ink = document.createElement('canvas'); ink.width = out.width; ink.height = out.height;
  const k = ink.getContext('2d'); k.scale(scale, scale); for (const s of page.strokes) drawStroke(k, s, 1 / scale);
  o.setTransform(1, 0, 0, 1, 0, 0); o.drawImage(ink, 0, 0);
  return out;
}

// ------------------------------------------------------------------ files
const enc = new TextEncoder();
export const isGzip = (u8) => u8.length > 2 && u8[0] === 0x1f && u8[1] === 0x8b;
async function streamBytes(u8, stream) { return new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(stream)).arrayBuffer()); }

/** .mwb v2 = gzip(JSON). Images on our server are inlined so the file is self-contained. */
export async function toMwb(doc, { title = 'Whiteboard', inline = true } = {}) {
  const pages = await Promise.all(doc.pages.map(async (p) => ({ ...p, images: await Promise.all(p.images.map(async (i) => ({ ...i, url: inline && i.url.startsWith('/files/') ? await toDataUrl(i.url).catch(() => i.url) : i.url }))) })));
  const json = JSON.stringify({ format: 'mwb', version: 2, app: '1venue', title, exportedAt: new Date().toISOString(), bg: doc.bg, activePage: doc.activePage || 0, size: [VW, VH], pages });
  if (typeof CompressionStream === 'function') return new Blob([await streamBytes(enc.encode(json), new CompressionStream('gzip'))], { type: 'application/x-mwb' });
  return new Blob([json], { type: 'application/json' });
}
export async function fromMwbBytes(u8) {
  if (isGzip(u8)) {
    if (typeof DecompressionStream !== 'function') throw new Error('This browser cannot open compressed boards');
    u8 = await streamBytes(u8, new DecompressionStream('gzip'));
  }
  let d; try { d = JSON.parse(new TextDecoder().decode(u8)); } catch { throw new Error('That file is not a whiteboard (.mwb)'); }
  if (!d || (d.format && d.format !== 'mwb') || (!Array.isArray(d.boards) && !Array.isArray(d.pages) && !Array.isArray(d.strokes))) throw new Error('That file is not a whiteboard (.mwb)');
  return { title: typeof d.title === 'string' ? d.title : null, doc: normalizeBoard(d) };
}
async function toDataUrl(url) { const b = await (await fetch(url)).blob(); return await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(b); }); }

/** Minimal PDF: one JPEG per page, 16:10 landscape. */
export async function toPdf(canvases) {
  const W = 960, H = 600; const parts = []; const offsets = []; let len = 0;
  const push = (x) => { const b = typeof x === 'string' ? enc.encode(x) : x; parts.push(b); len += b.length; };
  const obj = (n, body) => { offsets[n] = len; push(`${n} 0 obj\n`); body(); push('\nendobj\n'); };
  const n = canvases.length; const kids = canvases.map((_, i) => `${3 + i * 3} 0 R`).join(' ');
  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  obj(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'));
  obj(2, () => push(`<< /Type /Pages /Kids [${kids}] /Count ${n} >>`));
  for (let i = 0; i < n; i++) {
    const c = canvases[i]; const id = 3 + i * 3;
    const jpg = new Uint8Array(await (await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9))).arrayBuffer());
    const content = `q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q`;
    obj(id, () => push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /Im0 ${id + 2} 0 R >> >> /Contents ${id + 1} 0 R >>`));
    obj(id + 1, () => push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`));
    obj(id + 2, () => { push(`<< /Type /XObject /Subtype /Image /Width ${c.width} /Height ${c.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>\nstream\n`); push(jpg); push('\nendstream'); });
  }
  const xref = len; const total = 3 + n * 3;
  push(`xref\n0 ${total}\n0000000000 65535 f \n`);
  for (let i = 1; i < total; i++) push(String(offsets[i]).padStart(10, '0') + ' 00000 n \n');
  push(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
  return new Blob(parts, { type: 'application/pdf' });
}
