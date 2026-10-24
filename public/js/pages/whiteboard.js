import { icon } from '../icons.js';
import { h, api, toast, toastErr, download, debounce, menu, confirmDlg, promptDlg, timeAgo, uploadFile, isMobile } from '../ui.js';
import { requireLogin } from '../app.js';
import { registerCommands, unregisterCommands } from '../commands.js';
import { VW, VH, TOOLS, BGS, uid, emptyPage, normalizeBoard, pageEmpty, pointWidth, painter, drawStroke, drawTexts, textBox, drawImages, drawPaper, setInkTheme, inkOf, renderPage, toMwb, fromMwbBytes, toPdf } from '../wbcore.js';

export const COLORS = ['ink', '#2563eb', '#16a34a', '#dc2626', '#f59e0b', '#9333ea'];
const isDark = () => document.documentElement.dataset.theme === 'dark';
const LS = 'venue.wb.prefs';
const prefs = (() => { try { return JSON.parse(localStorage.getItem(LS)) || {}; } catch { return {}; } })();
const savePrefs = () => { try { localStorage.setItem(LS, JSON.stringify(prefs)); } catch {} };
const slug = (s) => String(s || 'whiteboard').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'whiteboard';

/** Image file → URL on the board: uploaded when we can, otherwise a downscaled data URL. */
async function imageUrl(file, upload) {
  if (upload) { try { const r = await upload(file); if (r && r.url) return r.url; } catch (e) { if (e && e.status && e.status !== 401) throw e; } }
  const url = URL.createObjectURL(file);
  try {
    const im = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('That image could not be read')); i.src = url; });
    const k = Math.min(1, 1400 / Math.max(im.naturalWidth, im.naturalHeight));
    const c = document.createElement('canvas'); c.width = Math.round(im.naturalWidth * k); c.height = Math.round(im.naturalHeight * k);
    c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
    return c.toDataURL(file.type === 'image/png' && file.size < 300000 ? 'image/png' : 'image/jpeg', 0.85);
  } finally { URL.revokeObjectURL(url); }
}
const imgSize = (url) => new Promise((res) => { const i = new Image(); i.onload = () => res([i.naturalWidth, i.naturalHeight]); i.onerror = () => res([800, 600]); i.src = url; });

/**
 * A multi-page vector whiteboard (pencil / pen / airbrush / eraser with pressure + speed, text, images).
 * onChange(board, info) fires after every edit: info.type is 'stroke' (info.stroke), 'page' or 'full'.
 */
export function createBoard({ doc, strokes, onChange, onPage, readOnly = false, upload = null, pages: multi = true } = {}) {
  let D = normalizeBoard(doc || { strokes: strokes || [] });
  let pi = Math.min(D.activePage || 0, D.pages.length - 1);
  let tool = ['pencil', 'pen', 'brush'].includes(prefs.tool) ? prefs.tool : 'pen';
  let color = prefs.color || 'ink';
  const widths = { ...Object.fromEntries(Object.entries(TOOLS).map(([k, v]) => [k, v.width])), ...(prefs.widths || {}) };
  const undoS = [], redoS = [];
  const mk = (cls) => h('canvas', { class: 'wb-layer ' + cls });
  const paper = mk('wb-paper'), ink = mk('wb-ink'), live = mk('wb-live');
  const pageTag = h('span', { class: 'wb-pagetag', hidden: true });
  const wrap = h('div', { class: 'wb', tabindex: '0', 'aria-label': 'Whiteboard' }, paper, ink, live, pageTag);
  const pc = paper.getContext('2d'), ic = ink.getContext('2d'), lc = live.getContext('2d');
  let W = 0, H = 0, dpr = 1, k = 1, ox = 0, oy = 0, cur = null, curP = null, last = null, sel = null, drag = null, editing = null;
  const page = () => D.pages[pi];
  const emit = (info) => { onChange && onChange(api_, info); };
  const T = (c) => c.setTransform(dpr * k, 0, 0, dpr * k, dpr * ox, dpr * oy);
  const clip = (c) => { c.beginPath(); c.rect(0, 0, VW, VH); c.clip(); };

  function fit() {
    const r = wrap.getBoundingClientRect(); if (!r.width || !r.height) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2); W = r.width; H = r.height;
    const pad = W < 560 ? 4 : 12; k = Math.min((W - pad * 2) / VW, (H - pad * 2) / VH); ox = (W - VW * k) / 2; oy = (H - VH * k) / 2;
    for (const c of [paper, ink, live]) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
    drawAll();
  }
  function drawPaperLayer() {
    pc.setTransform(1, 0, 0, 1, 0, 0); pc.clearRect(0, 0, paper.width, paper.height); T(pc);
    pc.save(); pc.shadowColor = 'rgba(15,23,42,.12)'; pc.shadowBlur = 18 / k; pc.shadowOffsetY = 3 / k; pc.fillStyle = '#000'; pc.fillRect(0, 0, VW, VH); pc.restore();
    pc.save(); clip(pc); drawPaper(pc, D.bg, isDark()); drawImages(pc, page().images, () => drawPaperLayer()); drawTexts(pc, page().texts.filter((t) => !editing || t.id !== editing.id)); pc.restore();
  }
  function drawInk() {
    setInkTheme(isDark());
    ic.setTransform(1, 0, 0, 1, 0, 0); ic.clearRect(0, 0, ink.width, ink.height); T(ic); ic.save(); clip(ic);
    for (const s of page().strokes) drawStroke(ic, s, 1 / k);
    ic.restore();
  }
  function selBox() {
    if (!sel) return null; const p = page();
    if (sel.kind === 'image') { const o = p.images.find((x) => x.id === sel.id); return o && { x: o.x, y: o.y, w: o.w, h: o.h, o }; }
    const o = p.texts.find((x) => x.id === sel.id); if (!o) return null; return { ...textBox(lc, o), o };
  }
  function drawLive() {
    lc.setTransform(1, 0, 0, 1, 0, 0); lc.clearRect(0, 0, live.width, live.height); T(lc);
    const b = selBox(); if (!b) return;
    lc.save(); lc.strokeStyle = '#2563eb'; lc.lineWidth = 1.5 / k; lc.setLineDash([6 / k, 4 / k]); lc.strokeRect(b.x - 4 / k, b.y - 4 / k, b.w + 8 / k, b.h + 8 / k);
    if (sel.kind === 'image') { lc.setLineDash([]); lc.fillStyle = '#fff'; const s = 12 / k; lc.fillRect(b.x + b.w - s / 2, b.y + b.h - s / 2, s, s); lc.strokeRect(b.x + b.w - s / 2, b.y + b.h - s / 2, s, s); }
    lc.restore();
  }
  function drawAll() { if (!W) return; drawPaperLayer(); drawInk(); drawLive(); updateTag(); }
  function updateTag() { pageTag.hidden = D.pages.length < 2; pageTag.textContent = `${pi + 1} / ${D.pages.length}`; onPage && queueMicrotask(() => onPage(pi, D.pages.length)); }

  const snap = () => ({ pi, strokes: page().strokes.slice(), images: page().images.map((o) => ({ ...o })), texts: page().texts.map((o) => ({ ...o })) });
  const restore = (s) => { pi = Math.min(s.pi, D.pages.length - 1); Object.assign(D.pages[pi], { strokes: s.strokes, images: s.images, texts: s.texts }); };
  const pushUndo = () => { undoS.push(snap()); if (undoS.length > 80) undoS.shift(); redoS.length = 0; };

  const pt = (e) => { const r = wrap.getBoundingClientRect(); return [Math.round(((e.clientX - r.left - ox) / k) * 10) / 10, Math.round(((e.clientY - r.top - oy) / k) * 10) / 10]; };
  const pressure = (e) => (e.pointerType === 'pen' && e.pressure > 0 ? e.pressure : 0.5);
  function hit([x, y]) {
    const p = page();
    for (let i = p.texts.length - 1; i >= 0; i--) { const b = textBox(lc, p.texts[i]); if (x >= b.x - 6 && x <= b.x + b.w + 6 && y >= b.y - 6 && y <= b.y + b.h + 6) return { kind: 'text', id: p.texts[i].id }; }
    for (let i = p.images.length - 1; i >= 0; i--) { const o = p.images[i]; if (x >= o.x && x <= o.x + o.w && y >= o.y && y <= o.y + o.h) return { kind: 'image', id: o.id }; }
    return null;
  }
  function startText([x, y], existing) {
    finishText();
    const t = existing || { id: uid(), x, y: y - 16, text: '', size: 34, color, bold: false };
    const inp = h('textarea', { class: 'wb-text-in', rows: 1, placeholder: 'Type…', 'aria-label': 'Text on board' });
    inp.value = t.text;
    Object.assign(inp.style, { left: ox + t.x * k + 'px', top: oy + t.y * k + 'px', fontSize: t.size * k + 'px', color: inkOf(t.color), fontWeight: t.bold ? 700 : 500 });
    const grow = () => { inp.style.height = 'auto'; inp.style.height = inp.scrollHeight + 'px'; inp.style.width = Math.max(80, Math.min(W - (ox + t.x * k) - 8, inp.scrollWidth + 12)) + 'px'; };
    inp.addEventListener('input', grow);
    inp.addEventListener('keydown', (e) => { if (e.key === 'Escape' || (e.key === 'Enter' && !e.shiftKey)) { e.preventDefault(); finishText(); } e.stopPropagation(); });
    inp.addEventListener('blur', () => setTimeout(finishText, 0));
    editing = { id: t.id, t, inp, isNew: !existing };
    wrap.append(inp); drawPaperLayer(); setTimeout(() => { inp.focus(); grow(); }, 0);
  }
  function finishText() {
    if (!editing) return; const { t, inp, isNew } = editing; editing = null; inp.remove();
    const text = inp.value.replace(/\s+$/, '');
    if (text !== t.text || isNew) {
      pushUndo(); const p = page();
      if (!text) p.texts = p.texts.filter((x) => x.id !== t.id);
      else if (isNew) p.texts.push({ ...t, text }); else t.text = text;
      emit({ type: 'full' });
    }
    drawPaperLayer();
  }

  if (!readOnly) {
    wrap.addEventListener('pointerdown', (e) => {
      if (e.button > 0 || e.target.closest('.wb-text-in')) return;
      const p = pt(e);
      if (tool === 'text') { e.preventDefault(); const hh = hit(p); const ex = hh && hh.kind === 'text' ? page().texts.find((x) => x.id === hh.id) : null; startText(p, ex); return; }
      finishText(); wrap.focus({ preventScroll: true });
      wrap.setPointerCapture(e.pointerId);
      if (tool === 'move') {
        const b = selBox(); const hs = 14 / k;
        if (b && sel.kind === 'image' && Math.abs(p[0] - (b.x + b.w)) < hs && Math.abs(p[1] - (b.y + b.h)) < hs) { pushUndo(); drag = { mode: 'resize', o: b.o, start: p, w: b.o.w, h: b.o.h, moved: false }; return; }
        sel = hit(p); drawLive();
        const nb = selBox(); if (nb) { pushUndo(); drag = { mode: 'move', o: nb.o, start: p, x: nb.o.x, y: nb.o.y, moved: false }; }
        return;
      }
      sel = null; drawLive();
      cur = { id: uid(), tool, color: tool === 'eraser' ? '#000' : color, width: widths[tool], points: [[p[0], p[1], pointWidth(tool, pressure(e), 0, null)]] };
      last = { t: e.timeStamp, x: p[0], y: p[1] };
      T(ic); ic.save(); clip(ic); curP = painter(ic, cur, 1 / k);
    });
    wrap.addEventListener('pointermove', (e) => {
      if (drag) {
        const p = pt(e); const dx = p[0] - drag.start[0], dy = p[1] - drag.start[1]; drag.moved = drag.moved || Math.abs(dx) + Math.abs(dy) > 1;
        if (drag.mode === 'move') { drag.o.x = drag.x + dx; drag.o.y = drag.y + dy; }
        else { const r = drag.h / drag.w; drag.o.w = Math.max(40, drag.w + dx); drag.o.h = drag.o.w * r; }
        drawPaperLayer(); drawLive(); return;
      }
      if (!cur) return;
      const evs = (e.getCoalescedEvents && e.getCoalescedEvents()) || [e];
      for (const ev of evs.length ? evs : [e]) {
        const p = pt(ev); const P = cur.points; const lp = P[P.length - 1];
        const d = Math.hypot(p[0] - lp[0], p[1] - lp[1]); if (d < 0.9 / k) continue;
        const dt = Math.max(1, ev.timeStamp - last.t); const speed = d / dt; last.t = ev.timeStamp;
        P.push([p[0], p[1], pointWidth(tool, pressure(ev), speed, lp[2])]); curP.seg(P.length - 1);
      }
    });
    const up = () => {
      if (drag) { const moved = drag.moved; drag = null; if (moved) emit({ type: 'full' }); else undoS.pop(); return; }
      if (!cur) return; curP.end(); ic.restore();
      const s = cur; cur = null; curP = null;
      pushUndo(); page().strokes.push(s); emit({ type: 'stroke', stroke: s });
    };
    wrap.addEventListener('pointerup', up); wrap.addEventListener('pointercancel', up);
    wrap.addEventListener('keydown', (e) => {
      if (editing) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && sel) { e.preventDefault(); pushUndo(); const p = page(); p.images = p.images.filter((x) => x.id !== sel.id); p.texts = p.texts.filter((x) => x.id !== sel.id); sel = null; drawAll(); emit({ type: 'full' }); }
      if (e.key === 'Enter' && sel && sel.kind === 'text') { e.preventDefault(); const t = page().texts.find((x) => x.id === sel.id); sel = null; drawLive(); startText([t.x, t.y], t); }
    });
    wrap.addEventListener('dragover', (e) => { if ([...(e.dataTransfer?.items || [])].some((i) => i.kind === 'file')) { e.preventDefault(); wrap.classList.add('drop'); } });
    wrap.addEventListener('dragleave', () => wrap.classList.remove('drop'));
    wrap.addEventListener('drop', (e) => { e.preventDefault(); wrap.classList.remove('drop'); const f = e.dataTransfer?.files?.[0]; if (f) api_.importFile(f).catch(toastErr); });
  }
  const ro = new ResizeObserver(() => { finishText(); fit(); }); ro.observe(wrap);
  const mo = new MutationObserver(() => drawAll()); mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  // Imported boards carry images inline; move them to file storage so saved boards and live frames stay small.
  async function liftImages(pages) {
    let n = 0;
    for (const pg of pages) for (const im of pg.images || []) {
      if (!/^data:image\//.test(im.url) || im.url.length < 60000) continue;
      try { const bl = await (await fetch(im.url)).blob(); const r = await upload(new File([bl], 'board-image.' + (bl.type.split('/')[1] || 'png'), { type: bl.type })); if (r && r.url) { im.url = r.url; n++; } } catch { /* keep inline copy */ }
    }
    return n;
  }
  const api_ = {
    el: wrap, multi, readOnly, VW, VH,
    get doc() { return { version: 2, bg: D.bg, activePage: pi, pages: D.pages }; },
    set doc(v) { D = normalizeBoard(v); pi = Math.min(D.activePage || 0, D.pages.length - 1); undoS.length = redoS.length = 0; sel = null; drawAll(); },
    get pageIndex() { return pi; }, get pageCount() { return D.pages.length; }, get page() { return page(); },
    setPage(i, silent) { finishText(); const n = Math.max(0, Math.min(D.pages.length - 1, i)); if (n === pi) return; pi = n; sel = null; drawAll(); if (!silent) emit({ type: 'page' }); },
    addPage() { if (D.pages.length >= 50) return toast('A board can have up to 50 pages', { icon: 'info' }); D.pages.splice(pi + 1, 0, emptyPage()); pi += 1; sel = null; undoS.length = redoS.length = 0; drawAll(); emit({ type: 'full' }); },
    async removePage() {
      if (!pageEmpty(page()) && !(await confirmDlg(`Delete page ${pi + 1} and everything on it?`, { ok: 'Delete page', danger: true }))) return;
      if (D.pages.length === 1) D.pages[0] = emptyPage(); else D.pages.splice(pi, 1);
      pi = Math.min(pi, D.pages.length - 1); sel = null; undoS.length = redoS.length = 0; drawAll(); emit({ type: 'full' });
    },
    get strokes() { return page().strokes; },
    set strokes(v) { page().strokes = normalizeBoard({ strokes: v || [] }).pages[0].strokes; drawInk(); },
    append(list) { const n = normalizeBoard({ strokes: list }).pages[0].strokes; page().strokes.push(...n); T(ic); ic.save(); clip(ic); setInkTheme(isDark()); n.forEach((s) => drawStroke(ic, s, 1 / k)); ic.restore(); },
    get tool() { return tool; }, get color() { return color; }, get width() { return widths[tool] || 0; },
    setTool(t) { finishText(); tool = t; sel = null; drawLive(); wrap.dataset.tool = t; prefs.tool = t; savePrefs(); },
    setColor(c) { color = c; prefs.color = c; savePrefs(); if (tool === 'eraser' || tool === 'move') api_.setTool('pen'); if (sel && sel.kind === 'text') { pushUndo(); const t = page().texts.find((x) => x.id === sel.id); if (t) { t.color = c; drawPaperLayer(); emit({ type: 'full' }); } } },
    setWidth(w) { if (TOOLS[tool]) { widths[tool] = w; prefs.widths = { ...widths }; savePrefs(); } },
    get bg() { return D.bg; }, setBg(b) { D.bg = BGS.includes(b) ? b : 'dots'; drawPaperLayer(); emit({ type: 'full' }); },
    undo() { finishText(); const s = undoS.pop(); if (!s) return; redoS.push(snap()); restore(s); sel = null; drawAll(); emit({ type: 'full' }); },
    redo() { const s = redoS.pop(); if (!s) return; undoS.push(snap()); restore(s); drawAll(); emit({ type: 'full' }); },
    clear() { if (pageEmpty(page())) return; pushUndo(); D.pages[pi] = emptyPage(); sel = null; drawAll(); emit({ type: 'full' }); },
    async addImage(url) {
      const [nw, nh] = await imgSize(url); const s = Math.min((VW * 0.6) / nw, (VH * 0.6) / nh, 1.5);
      pushUndo(); const o = { id: uid(), url, w: Math.round(nw * s), h: Math.round(nh * s) }; o.x = Math.round((VW - o.w) / 2); o.y = Math.round((VH - o.h) / 2);
      page().images.push(o); sel = { kind: 'image', id: o.id }; if (!readOnly) api_.setTool('move'); drawAll(); emit({ type: 'full' });
    },
    /** Images go on the current page; .mwb files (v1 or v2) add their pages after this one. */
    async importFile(file) {
      if (/^image\//.test(file.type)) { toast('Adding image…', { icon: 'image' }); return api_.addImage(await imageUrl(file, upload)); }
      if (file.size > 25 * 1024 * 1024) throw new Error('That board file is too big (max 25 MB)');
      const { doc: nd, title } = await fromMwbBytes(new Uint8Array(await file.arrayBuffer()));
      if (D.pages.length === 1 && pageEmpty(D.pages[0])) { D = { ...nd, bg: nd.bg }; pi = 0; }
      else {
        const blank = pageEmpty(page()); const room = 50 - D.pages.length + (blank ? 1 : 0); if (room <= 0) throw new Error('This board already has 50 pages');
        if (blank) D.pages.splice(pi, 1, ...nd.pages.slice(0, room)); else { D.pages.splice(pi + 1, 0, ...nd.pages.slice(0, room)); pi += 1; }
      }
      undoS.length = redoS.length = 0; sel = null; drawAll(); emit({ type: 'full' });
      if (upload) liftImages(nd.pages).then((n) => { if (n) { drawAll(); emit({ type: 'full' }); } });
      toast(`Imported ${nd.pages.length} page${nd.pages.length === 1 ? '' : 's'}${title ? ' from “' + title + '”' : ''}`, { icon: 'check', group: 'content' });
      return { title, pages: nd.pages.length };
    },
    png() { return renderPage(page(), { bg: D.bg, dark: false, scale: 1.25 }).then((c) => { setInkTheme(isDark()); return new Promise((r) => c.toBlob(r, 'image/png')); }); },
    async pdf() { const cs = []; for (const p of D.pages) cs.push(await renderPage(p, { bg: D.bg, dark: false, scale: 1 })); setInkTheme(isDark()); return toPdf(cs); },
    mwb(title) { return toMwb(api_.doc, { title }); },
    thumb(i = pi) { return renderPage(D.pages[i], { bg: D.bg, dark: isDark(), scale: 0.15 }).then((c) => { setInkTheme(isDark()); return c; }); },
    redraw: () => drawAll(), focus: () => wrap.focus({ preventScroll: true }),
    destroy() { finishText(); ro.disconnect(); mo.disconnect(); },
    COLORS,
  };
  wrap.dataset.tool = tool;
  return api_;
}

/** One compact row: tools · colours · size · undo/redo · pages · image · more. */
export function boardToolbar(b, { extra = [], title = () => 'whiteboard', files = true, pages = b.multi !== false, clear = true, history = true, tools = null, compact = false } = {}) {
  const bar = h('div', { class: 'wb-tools' + (compact ? ' compact' : '') });
  const tdefs = [['pencil', 'pencil', 'Pencil · grainy, 1px', 'P'], ['pen', 'penTool', 'Pen · smooth', 'N'], ['brush', 'brush', 'Airbrush · soft', 'B'], ['eraser', 'eraser', 'Eraser', 'E'], ['text', 'type', 'Text', 'T'], ['move', 'move', 'Select & move', 'V']];
  const tb = {};
  const size = h('input', { type: 'range', class: 'wb-size', 'aria-label': 'Size', 'data-tip': 'Size' });
  const dot = h('span', { class: 'wb-size-dot' });
  const syncSize = () => { const t = TOOLS[b.tool]; size.disabled = !t; if (t) { size.min = t.min; size.max = t.max; size.step = t.max <= 5 ? 0.5 : 1; size.value = b.width; } const px = t ? Math.max(3, Math.min(18, (b.width / t.max) * 18)) : 3; dot.style.width = dot.style.height = px + 'px'; };
  const setTool = (t) => { b.setTool(t); Object.entries(tb).forEach(([k, el]) => el.classList.toggle('on', k === t)); syncSize(); };
  for (const [t, ic, l, key] of tdefs.filter(([t]) => !tools || tools.includes(t))) tb[t] = h('button', { class: 'icon-btn' + (b.tool === t ? ' on' : ''), type: 'button', 'data-group': 'content', 'data-tip': `${l} (${key})`, 'aria-label': l, html: icon(ic, { size: 18 }), onclick: () => setTool(t) });
  size.oninput = () => { b.setWidth(Number(size.value)); syncSize(); };
  const sws = [];
  const markColor = () => sws.forEach((el) => el.classList.toggle('on', el.dataset.c === b.color));
  for (const c of COLORS) sws.push(h('button', { class: 'wb-color' + (c === 'ink' ? ' ink' : ''), type: 'button', 'data-c': c, style: c === 'ink' ? {} : { background: c }, 'aria-label': c === 'ink' ? 'Ink' : 'Colour ' + c, onclick: () => { b.setColor(c); if (!['pencil', 'pen', 'brush', 'text'].includes(b.tool)) setTool('pen'); markColor(); } }));
  const custom = h('input', { type: 'color', class: 'wb-color custom', 'aria-label': 'Custom colour', 'data-tip': 'Custom colour', value: /^#/.test(b.color) ? b.color : '#0ea5e9' });
  custom.oninput = () => { b.setColor(custom.value); markColor(); };
  const fileIn = h('input', { type: 'file', accept: 'image/*,.mwb,application/json,application/gzip', hidden: true, onchange: () => { const f = fileIn.files[0]; fileIn.value = ''; if (f) b.importFile(f).catch(toastErr); } });
  const pageLbl = h('span', { class: 'wb-pg tiny' });
  const prev = h('button', { class: 'icon-btn sm', type: 'button', 'data-tip': 'Previous page', 'aria-label': 'Previous page', html: icon('chevronLeft', { size: 16 }), onclick: () => b.setPage(b.pageIndex - 1) });
  const next = h('button', { class: 'icon-btn sm', type: 'button', 'data-tip': 'Next page', 'aria-label': 'Next page', html: icon('chevronRight', { size: 16 }), onclick: () => b.setPage(b.pageIndex + 1) });
  const syncPages = () => { pageLbl.textContent = `${b.pageIndex + 1}/${b.pageCount}`; prev.disabled = b.pageIndex === 0; next.disabled = b.pageIndex >= b.pageCount - 1; };
  const exportAs = async (kind) => {
    try {
      const name = slug(title());
      if (kind === 'png') download(`${name}-p${b.pageIndex + 1}.png`, await b.png());
      else if (kind === 'pdf') { toast('Preparing PDF…', { icon: 'download' }); download(`${name}.pdf`, await b.pdf()); }
      else download(`${name}.mwb`, await b.mwb(title()));
    } catch (e) { toastErr(e); }
  };
  const more = h('button', { class: 'icon-btn', type: 'button', 'data-tip': 'Board menu', 'aria-label': 'Board menu', html: icon('more', { size: 18 }),
    onclick: (e) => menu(e.currentTarget, [
      files ? { label: 'Open .mwb or image…', icon: 'upload', group: 'content', run: () => fileIn.click() } : null,
      { label: 'Download board (.mwb)', icon: 'download', group: 'content', hint: 'all pages', run: () => exportAs('mwb') },
      { label: 'Download PDF', icon: 'fileText', group: 'content', hint: 'all pages', run: () => exportAs('pdf') },
      { label: 'Download PNG', icon: 'image', group: 'content', hint: 'this page', run: () => exportAs('png') },
      '-',
      ...BGS.map((g) => ({ label: `Background: ${g[0].toUpperCase() + g.slice(1)}`, icon: b.bg === g ? 'check' : 'grid', run: () => b.setBg(g) })),
      clear ? '-' : null,
      clear ? { label: 'Clear this page', icon: 'trash', group: 'admin', run: async () => { if (await confirmDlg('Clear everything on this page?', { ok: 'Clear', danger: true })) b.clear(); } } : null,
    ].filter(Boolean)) });
  const sep = () => h('span', { class: 'sep' });
  bar.append(...Object.values(tb), sep(), ...sws, custom, sep(), h('span', { class: 'wb-sizebox' }, dot, size));
  if (history) bar.append(sep(),
    h('button', { class: 'icon-btn', type: 'button', 'data-tip': 'Undo (Ctrl+Z)', 'aria-label': 'Undo', html: icon('undo', { size: 18 }), onclick: () => b.undo() }),
    h('button', { class: 'icon-btn', type: 'button', 'data-tip': 'Redo (Ctrl+Shift+Z)', 'aria-label': 'Redo', html: icon('redo', { size: 18 }), onclick: () => b.redo() }));
  if (pages) bar.append(sep(), h('span', { class: 'wb-pages' }, prev, pageLbl, next,
    h('button', { class: 'icon-btn sm', type: 'button', 'data-tip': 'Add page', 'aria-label': 'Add page', html: icon('plus', { size: 16 }), onclick: () => b.addPage() }),
    h('button', { class: 'icon-btn sm', type: 'button', 'data-tip': 'Delete page', 'aria-label': 'Delete page', html: icon('minus', { size: 16 }), onclick: () => b.removePage() })));
  if (files) bar.append(sep(), h('button', { class: 'icon-btn', type: 'button', 'data-group': 'content', 'data-tip': 'Add image', 'aria-label': 'Add image', html: icon('image', { size: 18 }), onclick: () => { fileIn.accept = 'image/*'; fileIn.click(); setTimeout(() => { fileIn.accept = 'image/*,.mwb,application/json,application/gzip'; }, 500); } }), fileIn);
  bar.append(more, ...extra);
  syncSize(); markColor(); syncPages();
  bar.sync = () => { syncPages(); syncSize(); markColor(); Object.entries(tb).forEach(([k, el]) => el.classList.toggle('on', k === b.tool)); };
  bar.setTool = setTool; bar.tools = Object.keys(tb); bar.history = history;
  return bar;
}

/** Keyboard shortcuts while a board is on screen. Returns an unbind function. */
export function boardKeys(b, bar) {
  const map = { p: 'pencil', n: 'pen', b: 'brush', e: 'eraser', t: 'text', v: 'move' };
  const onKey = (e) => {
    const tag = (e.target && e.target.tagName) || ''; if (/INPUT|TEXTAREA|SELECT/.test(tag) || e.target.isContentEditable) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { if (bar && bar.history === false) return; e.preventDefault(); e.shiftKey ? b.redo() : b.undo(); bar && bar.sync(); return; }
    if (!e.ctrlKey && !e.metaKey && !e.altKey && map[e.key.toLowerCase()] && (!bar || !bar.tools || bar.tools.includes(map[e.key.toLowerCase()])) && (e.target === document.body || e.target === b.el)) { bar ? bar.setTool(map[e.key.toLowerCase()]) : b.setTool(map[e.key.toLowerCase()]); }
  };
  document.addEventListener('keydown', onKey);
  return () => document.removeEventListener('keydown', onKey);
}

// ------------------------------------------------------------------ /whiteboard page: your saved boards
export async function mount(view) {
  if (!requireLogin('Sign in to use your whiteboards')) return;
  let boards = [], cur = null, dirty = false, saving = null;
  const status = h('span', { class: 'tiny faint wb-status' }, '');
  const titleEl = h('button', { class: 'wb-title', type: 'button', 'data-tip': 'Rename', onclick: () => rename(cur) });
  const listEl = h('div', { class: 'wb-list' });
  const side = h('aside', { class: 'wb-side' + (isMobile() || localStorage.getItem('venue.wb.side') === '0' ? ' hidden' : '') },
    h('div', { class: 'wb-side-head' }, h('b', { class: 'grow' }, 'My boards'), h('button', { class: 'btn sm primary', type: 'button', html: icon('plus', { size: 15 }) + '<span>New</span>', onclick: () => createNew() })),
    listEl, h('p', { class: 'tiny faint wb-side-note' }, 'Boards are private and autosaved. In a meeting, open “My board” → “Open saved board” to present one live.'));
  const toggleSide = () => { side.classList.toggle('hidden'); localStorage.setItem('venue.wb.side', side.classList.contains('hidden') ? '0' : '1'); };
  const b = createBoard({ doc: {}, upload: (f) => uploadFile(f, { purpose: 'whiteboard' }), onChange: () => { dirty = true; status.textContent = 'Editing…'; save(); }, onPage: () => bar && bar.sync() });
  const bar = boardToolbar(b, { title: () => (cur && cur.title) || 'whiteboard' });
  const unbind = boardKeys(b, bar);
  const flush = async () => {
    if (!cur || !dirty) return; dirty = false; const id = cur.id;
    status.textContent = 'Saving…';
    saving = api(`/api/whiteboards/${id}`, { method: 'PUT', body: { data: b.doc } })
      .then((r) => { status.textContent = 'Saved'; const it = boards.find((x) => x.id === id); if (it) { it.updatedAt = r.updatedAt; it.pages = b.pageCount; } renderList(); })
      .catch((e) => { dirty = true; status.textContent = 'Not saved'; toastErr(e); });
    await saving;
  };
  const save = debounce(flush, 900);
  const beforeUnload = (e) => { if (dirty) { flush(); e.preventDefault(); e.returnValue = ''; } };
  window.addEventListener('beforeunload', beforeUnload);

  function renderList() {
    listEl.replaceChildren(...boards.map((x) => h('div', { class: 'wb-item' + (cur && cur.id === x.id ? ' on' : ''), role: 'button', tabindex: '0', onclick: () => open(x.id), onkeydown: (e) => { if (e.key === 'Enter') open(x.id); } },
      h('span', { class: 'wb-item-ic', html: icon('board', { size: 16 }) }),
      h('span', { class: 'grow wb-item-txt' }, h('b', { class: 'ellipsis' }, x.title), h('small', { class: 'faint' }, `${x.pages || 1} page${(x.pages || 1) === 1 ? '' : 's'} · ${x.updatedAt ? timeAgo(x.updatedAt) : 'new'}`)),
      h('button', { class: 'icon-btn sm', type: 'button', 'aria-label': 'Board options', html: icon('moreV', { size: 15 }), onclick: (e) => { e.stopPropagation(); menu(e.currentTarget, [
        { label: 'Open', icon: 'board', run: () => open(x.id) },
        { label: 'Rename', icon: 'pen', run: () => rename(x) },
        { label: 'Duplicate', icon: 'copy', run: () => duplicate(x) },
        '-',
        { label: 'Delete', icon: 'trash', group: 'admin', run: () => remove(x) },
      ]); } }))));
    if (!boards.length) listEl.append(h('p', { class: 'small muted', style: { padding: '.6rem' } }, 'No boards yet.'));
  }
  async function open(id) {
    await flush();
    try {
      const r = await api(`/api/whiteboards/${id}`);
      cur = { id: r.id, title: r.title }; b.doc = r.data; dirty = false;
      titleEl.textContent = r.title; status.textContent = r.updatedAt ? 'Saved' : '';
      history.replaceState(history.state, '', `/whiteboard?id=${r.id}`);
      renderList(); bar.sync(); if (isMobile()) side.classList.add('hidden');
    } catch (e) { toastErr(e); }
  }
  async function createNew(title, data) {
    await flush();
    const name = title || (await promptDlg('Name your board', { value: `Board ${boards.length + 1}`, ok: 'Create' }));
    if (name == null) return;
    try {
      const r = await api('/api/whiteboards', { method: 'POST', body: { title: name.trim() || 'Untitled board', data: data || { version: 2, bg: 'dots', pages: [{ strokes: [], images: [], texts: [] }] } } });
      boards.unshift({ id: r.id, title: r.title, updatedAt: r.updatedAt, pages: (r.data.pages || []).length || 1 }); await open(r.id);
    } catch (e) { toastErr(e); }
  }
  async function rename(x) {
    if (!x) return; const name = await promptDlg('Rename board', { value: x.title, ok: 'Rename' });
    if (!name || !name.trim() || name.trim() === x.title) return;
    try { await api(`/api/whiteboards/${x.id}`, { method: 'PUT', body: { title: name.trim() } }); x.title = name.trim(); const it = boards.find((y) => y.id === x.id); if (it) it.title = x.title; if (cur && cur.id === x.id) { cur.title = x.title; titleEl.textContent = x.title; } renderList(); } catch (e) { toastErr(e); }
  }
  async function duplicate(x) { try { const r = await api(`/api/whiteboards/${x.id}`); await createNew(`${x.title} (copy)`, normalizeBoard(r.data)); } catch (e) { toastErr(e); } }
  async function remove(x) {
    if (!(await confirmDlg(`Delete “${x.title}”? This can’t be undone.`, { ok: 'Delete board', danger: true }))) return;
    try {
      await api(`/api/whiteboards/${x.id}`, { method: 'DELETE' });
      boards = boards.filter((y) => y.id !== x.id);
      if (cur && cur.id === x.id) { cur = null; dirty = false; if (boards[0]) await open(boards[0].id); else await createNew('My board'); }
      renderList(); toast('Board deleted', { icon: 'trash' });
    } catch (e) { toastErr(e); }
  }

  view.append(h('div', { class: 'wbp' }, side,
    h('section', { class: 'wb-main card layer' },
      h('div', { class: 'wb-head' },
        h('button', { class: 'icon-btn', type: 'button', 'data-tip': 'My boards', 'aria-label': 'My boards', html: icon('layers', { size: 18 }), onclick: toggleSide }),
        titleEl, status, h('span', { class: 'grow' }),
        h('button', { class: 'btn sm ghost', type: 'button', html: icon('plus', { size: 15 }) + '<span>New board</span>', onclick: () => createNew() })),
      bar, b.el)));

  try {
    boards = (await api('/api/whiteboards')).boards || [];
    const want = Number(new URLSearchParams(location.search).get('id'));
    if (want && boards.some((x) => x.id === want)) await open(want);
    else if (boards[0]) await open(boards[0].id);
    else await createNew('My board');
  } catch (e) { toastErr(e); }
  renderList();

  registerCommands('page', [
    { id: 'wb-new', label: 'New whiteboard', icon: 'plus', group: 'content', run: () => createNew() },
    { id: 'wb-page', label: 'Add a page', icon: 'plus', group: 'content', keywords: ['page'], run: () => b.addPage() },
    { id: 'wb-undo', label: 'Undo', icon: 'undo', group: 'content', run: () => b.undo() },
    { id: 'wb-pencil', label: 'Pencil', icon: 'pencil', group: 'content', run: () => bar.setTool('pencil') },
    { id: 'wb-pen', label: 'Pen', icon: 'penTool', group: 'content', run: () => bar.setTool('pen') },
    { id: 'wb-brush', label: 'Airbrush', icon: 'brush', group: 'content', run: () => bar.setTool('brush') },
    { id: 'wb-eraser', label: 'Eraser', icon: 'eraser', group: 'content', run: () => bar.setTool('eraser') },
    { id: 'wb-pdf', label: 'Download board as PDF', icon: 'fileText', group: 'content', run: async () => download(`${slug(cur && cur.title)}.pdf`, await b.pdf()) },
    { id: 'wb-mwb', label: 'Download board (.mwb)', icon: 'download', group: 'content', run: async () => download(`${slug(cur && cur.title)}.mwb`, await b.mwb(cur && cur.title)) },
  ]);
  return { unmount: () => { flush(); unbind(); window.removeEventListener('beforeunload', beforeUnload); b.destroy(); unregisterCommands('page'); } };
}
