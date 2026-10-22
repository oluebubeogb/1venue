import { icon } from '../icons.js';
import { h, api, toast, toastErr, download, debounce } from '../ui.js';
import { state, requireLogin } from '../app.js';
import { registerCommands, unregisterCommands } from '../commands.js';

/** A personal vector whiteboard. Used by the /whiteboard page and inside rooms (share-to-view). */
export function createBoard({ strokes = [], bg = 'dots', onChange, readOnly = false } = {}) {
  const COLORS = ['#111827', '#2563eb', '#16a34a', '#dc2626', '#f59e0b', '#9333ea', '#ffffff'];
  let color = getComputedStyle(document.documentElement).getPropertyValue('--fg').trim() || '#111827', width = 4, tool = 'pen';
  const redo = [];
  const canvas = h('canvas', { class: 'wb-canvas', 'aria-label': 'Whiteboard' });
  const wrap = h('div', { class: `wb wb-bg-${bg}` }, canvas);
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0, dpr = 1, cur = null;
  const VW = 1600, VH = 1000; // virtual coordinate space, so boards look the same on every screen
  function fit() { const r = wrap.getBoundingClientRect(); dpr = window.devicePixelRatio || 1; W = r.width; H = r.height; canvas.width = W * dpr; canvas.height = H * dpr; draw(); }
  const scale = () => Math.min(W / VW, H / VH) || 1;
  function drawStroke(s) {
    const k = scale(); if (s.points.length < 2) return;
    ctx.globalCompositeOperation = s.tool === 'eraser' ? 'destination-out' : 'source-over';
    ctx.strokeStyle = s.color; ctx.lineWidth = s.width * k; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(s.points[0][0] * k, s.points[0][1] * k);
    for (let i = 1; i < s.points.length - 1; i++) { const [x1, y1] = s.points[i], [x2, y2] = s.points[i + 1]; ctx.quadraticCurveTo(x1 * k, y1 * k, ((x1 + x2) / 2) * k, ((y1 + y2) / 2) * k); }
    const l = s.points[s.points.length - 1]; ctx.lineTo(l[0] * k, l[1] * k); ctx.stroke();
  }
  function draw() { ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H); strokes.forEach(drawStroke); if (cur) drawStroke(cur); ctx.globalCompositeOperation = 'source-over'; }
  const pt = (e) => { const r = canvas.getBoundingClientRect(); const k = scale(); return [Math.round((e.clientX - r.left) / k), Math.round((e.clientY - r.top) / k)]; };
  if (!readOnly) {
    canvas.addEventListener('pointerdown', (e) => { canvas.setPointerCapture(e.pointerId); cur = { tool, color, width: tool === 'eraser' ? width * 5 : width * (e.pressure && e.pointerType === 'pen' ? 0.5 + e.pressure : 1), points: [pt(e)] }; });
    canvas.addEventListener('pointermove', (e) => { if (!cur) return; cur.points.push(pt(e)); draw(); });
    const up = () => { if (!cur) return; if (cur.points.length > 1) { strokes.push(cur); redo.length = 0; onChange && onChange(strokes, cur); } cur = null; draw(); };
    canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  }
  const ro = new ResizeObserver(fit); ro.observe(wrap);
  const api_ = {
    el: wrap, get strokes() { return strokes; },
    set strokes(v) { strokes = v || []; draw(); },
    append(s) { strokes.push(...s); draw(); },
    setTool(t) { tool = t; }, setColor(c) { color = c; tool = 'pen'; }, setWidth(w) { width = w; },
    undo() { if (strokes.length) { redo.push(strokes.pop()); draw(); onChange && onChange(strokes, null, true); } },
    redo() { if (redo.length) { strokes.push(redo.pop()); draw(); onChange && onChange(strokes, null, true); } },
    clear() { strokes = []; draw(); onChange && onChange(strokes, null, true); },
    png() { return new Promise((r) => canvas.toBlob(r, 'image/png')); },
    destroy() { ro.disconnect(); },
    COLORS,
  };
  return api_;
}

export function boardToolbar(b, extra = []) {
  const bar = h('div', { class: 'wb-tools' });
  const tools = [['pen', 'pen', 'Pen'], ['eraser', 'eraser', 'Eraser']];
  const tb = tools.map(([t, ic, l]) => h('button', { class: `icon-btn${t === 'pen' ? ' on' : ''}`, 'data-group': 'content', 'data-tip': l, 'aria-label': l, html: icon(ic), onclick: (e) => { b.setTool(t); tb.forEach((x) => x.classList.remove('on')); e.currentTarget.classList.add('on'); } }));
  const sw = b.COLORS.map((c) => h('button', { class: 'wb-color', style: { background: c }, 'aria-label': 'Colour ' + c, onclick: () => { b.setColor(c); tb.forEach((x, i) => x.classList.toggle('on', i === 0)); } }));
  const width = h('input', { type: 'range', min: 1, max: 16, value: 4, 'aria-label': 'Stroke width', style: { width: '80px' } });
  width.oninput = () => b.setWidth(Number(width.value));
  bar.append(...tb, h('span', { class: 'sep' }), ...sw, h('span', { class: 'sep' }), width, h('span', { class: 'sep' }),
    h('button', { class: 'icon-btn', 'data-tip': 'Undo', 'aria-label': 'Undo', html: icon('undo'), onclick: () => b.undo() }),
    h('button', { class: 'icon-btn', 'data-tip': 'Redo', 'aria-label': 'Redo', html: icon('redo'), onclick: () => b.redo() }),
    h('button', { class: 'icon-btn', 'data-group': 'admin', 'data-tip': 'Clear board', 'aria-label': 'Clear', html: icon('trash'), onclick: () => b.clear() }), ...extra);
  return bar;
}

export async function mount(view) {
  if (!requireLogin('Sign in to use your personal whiteboard')) return;
  const saved = await api('/api/whiteboards/board?title=Personal').catch(() => null);
  const status = h('span', { class: 'tiny faint' }, saved?.updatedAt ? 'Saved' : 'Not saved yet');
  const save = debounce(async () => { try { status.textContent = 'Saving…'; await api('/api/whiteboards/board', { method: 'PUT', body: { title: 'Personal', strokes: b.strokes, bg: 'dots' } }); status.textContent = 'Saved'; } catch (e) { status.textContent = 'Save failed'; toastErr(e); } }, 800);
  const b = createBoard({ strokes: saved?.strokes || [], onChange: save });
  const onKey = (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? b.redo() : b.undo(); } };
  document.addEventListener('keydown', onKey);
  const exp = h('button', { class: 'icon-btn', 'data-group': 'content', 'data-tip': 'Export PNG', 'aria-label': 'Export PNG', html: icon('download'), onclick: () => b.png().then((x) => download('whiteboard.png', x)) });
  view.append(h('div', { class: 'page-head row between wrap' }, h('div', null, h('h1', { html: icon('board', { size: 28 }) + 'My whiteboard' }), h('p', { class: 'muted small' }, 'Private to you and autosaved. In a room, use “Share my board” so others can view it live.')), status),
    h('div', { class: 'wb-page card layer' }, boardToolbar(b, [exp]), b.el));
  registerCommands('page', [
    { id: 'wb-undo', label: 'Undo stroke', icon: 'undo', group: 'content', run: () => b.undo() },
    { id: 'wb-clear', label: 'Clear whiteboard', icon: 'trash', group: 'admin', run: () => b.clear() },
    { id: 'wb-export', label: 'Export whiteboard as PNG', icon: 'download', group: 'content', run: () => b.png().then((x) => download('whiteboard.png', x)) },
    { id: 'wb-eraser', label: 'Eraser', icon: 'eraser', group: 'content', run: () => b.setTool('eraser') },
  ]);
  return { unmount: () => { document.removeEventListener('keydown', onKey); b.destroy(); unregisterCommands('page'); } };
}
