// Small UI toolkit: DOM builder, API, toasts, sheets, menus, tooltips, formatting.
import { icon } from './icons.js';
import { menuPosition } from './menu-pos.js';
import { kidsOf, installSafeDom } from './safe-text.js';
installSafeDom();

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const URL_RE = /\b((?:https?:\/\/|www\.)[^\s<]+)/gi;
const URL_TRAIL = /[),.;:!?\]\}'"]+$/;

/** Turn bare URLs (and www.) into links. Opens in a new tab. Mentions and site-relative paths are optional. */
export function linkify(s, { mentions = false, siteBase = '' } = {}) {
  let t = String(s || '');
  if (siteBase) {
    const base = String(siteBase).replace(/\/$/, '');
    t = t.replace(/(^|[\s:(])(\/(?:e|v|u|a|messages|settings|discover|wallet|dashboard|host|books|cert)[^\s<]*)/g, (_, pre, path) => pre + base + path);
  }
  let html = esc(t).replace(URL_RE, (raw) => {
    const m = URL_TRAIL.exec(raw);
    const trail = m ? m[0] : '';
    const url = trail ? raw.slice(0, -trail.length) : raw;
    if (!url) return raw;
    const href = /^www\./i.test(url) ? 'https://' + url : url;
    if (!/^https?:\/\//i.test(href)) return raw;
    return `<a class="msg-link" href="${href}" target="_blank" rel="noopener noreferrer">${url}</a>${trail}`;
  });
  if (mentions) html = html.replace(/(^|\s)@([\w.-]{2,30})/g, '$1<b class="mention">@$2</b>');
  return html;
}


/** Canonical profile path: username → handle → id. */
export function profilePath(u) {
  if (u == null) return '/me';
  if (typeof u === 'string' || typeof u === 'number') return `/u/${encodeURIComponent(String(u))}`;
  const key = u.username || u.handle || u.id; // public page is /u/<username>
  return key != null ? `/u/${encodeURIComponent(String(key))}` : '/me';
}

export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  if (props) for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') { for (const [sk, sv] of Object.entries(v)) if (sv != null) { if (sk.startsWith('--')) el.style.setProperty(sk, sv); else el.style[sk] = sv; } }
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kidsOf(...kids)) {
    if (kid && (kid instanceof Node || kid.nodeType)) el.append(kid);
    else if (typeof kid === 'string' || typeof kid === 'number') el.append(document.createTextNode(String(kid)));
  }
  return el;
}
export const frag = (html) => document.createRange().createContextualFragment(html);
export const I = (name, size, cls) => frag(icon(name, { size, cls }));

export async function api(path, { method = 'GET', body, headers = {}, raw = false, signal, timeoutMs } = {}) {
  const opts = { method, credentials: 'include', headers: { ...headers } };
  if (body !== undefined) {
    if (body instanceof Blob || body instanceof ArrayBuffer) opts.body = body;
    else { opts.body = JSON.stringify(body); opts.headers['Content-Type'] = 'application/json'; }
  }
  let res;
  const ctrl = timeoutMs ? new AbortController() : null;
  const timer = timeoutMs ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  if (signal || ctrl) {
    if (signal && ctrl) signal.addEventListener('abort', () => ctrl.abort(), { once: true });
    opts.signal = ctrl ? ctrl.signal : signal;
  }
  try { res = await fetch(path, opts); } catch (e) { const err = new Error(e.name === 'AbortError' ? 'That took too long, try again' : (navigator.onLine === false ? 'You are offline - check your connection and try again' : 'Could not reach 1venue - check your connection and try again')); err.status = 0; err.cause = e; throw err; }
  finally { if (timer) clearTimeout(timer); }
  if (raw) return res;
  let data = null;
  try { data = await res.json(); } catch { /* empty */ }
  if (!res.ok) {
    const err = new Error(errText(data && (data.error || data.message)) || HTTP_MSG[res.status] || (res.status >= 500 ? 'Something went wrong on our side - please try again' : `Request failed (${res.status})`));
    err.status = res.status; err.data = data; throw err;
  }
  return data;
}

export function toast(msg, { icon: ic = 'info', group = '', ms = 3200, action = null } = {}) {
  let host = $('#toasts');
  if (!host) { host = h('div', { id: 'toasts', role: 'status', 'aria-live': 'polite' }); document.body.append(host); }
  const t = h('div', { class: 'toast', 'data-group': group }, I(ic, 18), h('span', { class: 'grow' }, msg));
  if (action) t.append(h('button', { class: 'btn sm toast-act', type: 'button', onclick: () => { t.remove(); action.run(); } }, action.label));
  host.append(t);
  while (host.children.length > 3) host.firstChild.remove();
  if (ms > 0) setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 260); }, ms);
  return t;
}
const HTTP_MSG = { 401: 'Please sign in to continue', 402: 'Add credits to continue.', 403: 'You don’t have permission to do that', 404: 'We couldn’t find that', 413: 'That file is too large', 429: 'Slow down a little - try again in a moment' };
/* Turn anything thrown or returned into a readable sentence (never "[object Object]"). */
export function errText(e) {
  if (e == null || e === '') return '';
  if (typeof e === 'string') return e;
  if (typeof e === 'number') return HTTP_MSG[e] || `Error ${e}`;
  if (Array.isArray(e)) return e.map(errText).filter(Boolean).join(', ');
  if (typeof e === 'object') { const m = e.message ?? e.error ?? e.detail ?? e.msg ?? e.reason; if (m != null && m !== e) return errText(m); try { const j = JSON.stringify(e); return j && j !== '{}' ? j.slice(0, 160) : 'Something went wrong'; } catch { return 'Something went wrong'; } }
  return String(e);
}
/**
 * Report a browser-side failure to the server log ("[client] <area> error {...}") and show it.
 * Fire-and-forget: never throws, never blocks the UI. extra: { step, file, mime, size, pages }.
 */
export function reportClientError(area, e, extra = {}, { silent = false } = {}) {
  const message = errText(e) || (e && e.message) || String(e || 'Unknown error');
  try {
    const body = JSON.stringify({ area, message: message.slice(0, 300), status: e && e.status, page: location.pathname, build: (document.querySelector('link[href*="app.css"]')?.getAttribute('href') || '').replace(/^.*\?/, ''), ...extra });
    const blob = new Blob([body], { type: 'application/json' });
    if (!(navigator.sendBeacon && navigator.sendBeacon('/api/client-log', blob))) fetch('/api/client-log', { method: 'POST', body, headers: { 'Content-Type': 'application/json' }, credentials: 'include', keepalive: true }).catch(() => {});
  } catch { /* never let reporting break the page */ }
  console.warn(`[${area}]`, extra.step || '', message, e);
  if (!silent) toast(message, { icon: 'alert', group: 'admin', ms: 7000 });
  return message;
}
export function toastErr(e) {
  const msg = errText(e) || 'Something went wrong';
  if (e && e.status === 402) {
    return toast(msg, { icon: 'alert', group: 'admin', ms: 7000, action: { label: 'Add credits', run: () => location.assign('/wallet') } });
  }
  return toast(msg, { icon: 'alert', group: 'admin' });
}

export function swipeToClose(panel, close, { grip, maxWidth } = {}) {
  const win = panel.ownerDocument.defaultView || window;
  let start = null;
  let distance = 0;
  const reset = () => {
    start = null;
    distance = 0;
    panel.style.translate = '';
  };

  panel.addEventListener('touchstart', (event) => {
    reset();
    if (event.touches.length !== 1 || (maxWidth && !win.matchMedia(`(max-width: ${maxWidth}px)`).matches)) return;
    const target = event.target;
    if (target.closest('input, textarea, select, [contenteditable="true"]')) return;
    if (!grip?.contains(target)) {
      // A gesture that starts in scrolled content belongs to that scroll area.
      for (let node = target; node && panel.contains(node); node = node.parentElement) {
        if (node.scrollTop > 1) return;
      }
    }
    const touch = event.touches[0];
    start = { x: touch.clientX, y: touch.clientY };
  }, { passive: true });

  panel.addEventListener('touchmove', (event) => {
    if (!start) return;
    if (event.touches.length !== 1) { reset(); return; }
    const touch = event.touches[0];
    const dy = touch.clientY - start.y;
    const dx = Math.abs(touch.clientX - start.x);
    if (!distance) {
      if (Math.max(Math.abs(dy), dx) < 8) return;
      if (dy <= dx || !event.cancelable) { reset(); return; }
    }
    if (event.cancelable) event.preventDefault();
    distance = Math.max(0, dy);
    panel.style.translate = `0 ${distance}px`;
  }, { passive: false });

  panel.addEventListener('touchend', () => {
    const dismiss = distance >= 90;
    reset();
    if (dismiss) close();
  });
  panel.addEventListener('touchcancel', reset);
}

let sheetStack = [];
export function sheet({ title = '', icon: ic, group = '', body, wide = false, onClose } = {}) {
  const scrim = h('div', { class: 'scrim' });
  const closeBtn = h('button', { class: 'icon-btn', 'aria-label': 'Close', 'data-tip': 'Close', html: icon('x') });
  const head = h('div', { class: 'sh-head' }, h('h3', { 'data-group': group }, ic ? h('span', { style: { color: 'var(--g, var(--accent))', display: 'flex' }, html: icon(ic) }) : null, title), closeBtn);
  const bodyEl = h('div', { class: 'sh-body' });
  const grip = h('div', { class: 'grab sheet-grip', 'aria-hidden': 'true' });
  const el = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title, style: wide ? { width: 'min(860px, 100%)' } : null }, grip, head, bodyEl);
  if (body) bodyEl.append(body instanceof Node ? body : frag(body));
  let closed = false;
  const close = () => {
    if (closed) return; closed = true;
    el.classList.add('closing'); scrim.style.opacity = '0'; scrim.style.transition = 'opacity .2s';
    setTimeout(() => { el.remove(); scrim.remove(); }, 230);
    sheetStack = sheetStack.filter((s) => s.el !== el);
    onClose && onClose();
  };
  scrim.onclick = close; closeBtn.onclick = close;
  swipeToClose(el, close, { grip });
  document.body.append(scrim, el);
  const api_ = { el, body: bodyEl, close, setTitle: (t) => { head.querySelector('h3').lastChild.textContent = t; } };
  sheetStack.push(api_);
  setTimeout(() => { const f = el.querySelector('input,textarea,select'); if (f && matchMedia('(hover:hover)').matches) f.focus(); }, 60);
  return api_;
}
export const closeTopSheet = () => { const s = sheetStack[sheetStack.length - 1]; if (s) { s.close(); return true; } return false; };

/**
 * Popover menu. Viewport-aware (see menu-pos.js): flips left / up near the edges, stays 8px inside the
 * screen and scrolls when it is too tall. On phones it is a bottom sheet instead. Pass { header } for
 * extra content on top (e.g. quick reactions) so it is measured before the menu is placed.
 */
export function menu(anchor, items, { header = null, sheet: asSheet, cls = '' } = {}) {
  const doc = (anchor && anchor.ownerDocument) || document;
  const win = doc.defaultView || window;
  if (asSheet == null) asSheet = doc === document && isMobile();
  doc.querySelectorAll('.menu').forEach((x) => x.remove());
  const m = h('div', { class: 'menu' + (asSheet ? ' menu-sheet' : '') + (cls ? ' ' + cls : ''), role: 'menu' });
  const grip = asSheet ? h('div', { class: 'sheet-grip menu-sheet-grip', 'aria-hidden': 'true' }) : null;
  if (grip) m.append(grip);
  if (header) m.append(header);
  for (const it of items) {
    if (it === '-') { m.append(h('hr')); continue; }
    if (!it || it.hidden) continue;
    m.append(h('button', { role: 'menuitem', 'data-group': it.group || '', onclick: () => { m.remove(); it.run(); } }, it.icon ? I(it.icon, 18) : null, h('span', { class: 'grow' }, it.label), it.hint ? h('span', { class: 'tiny faint' }, it.hint) : null));
  }
  const back = asSheet ? h('div', { class: 'menu-backdrop', onclick: () => m.remove() }) : null;
  let lockedY = 0;
  const lockPage = () => {
    if (!asSheet || document.documentElement.classList.contains('menu-lock')) return;
    lockedY = window.scrollY;
    document.documentElement.classList.add('menu-lock');
    document.body.style.top = `-${lockedY}px`;
  };
  const unlockPage = () => {
    if (!document.documentElement.classList.contains('menu-lock')) return;
    document.documentElement.classList.remove('menu-lock');
    document.body.style.top = '';
    window.scrollTo(0, lockedY);
  };
  const place = () => {
    if (asSheet || !m.isConnected) return;
    m.style.maxHeight = ''; m.style.maxWidth = '';
    const p = menuPosition(anchor.getBoundingClientRect(), m.offsetWidth, m.offsetHeight, win.innerWidth, win.innerHeight);
    m.style.left = p.left + 'px'; m.style.top = p.top + 'px';
    if (p.maxHeight) m.style.maxHeight = p.maxHeight + 'px';
    if (p.maxWidth) m.style.maxWidth = p.maxWidth + 'px';
    m.dataset.flipX = p.flipX ? '1' : ''; m.dataset.flipY = p.flipY ? '1' : '';
  };
  const onKey = (e) => { if (e.key === 'Escape') m.remove(); };
  const onScroll = (e) => { if (!m.contains(e.target)) place(); };
  const off = (e) => { if (!m.contains(e.target) && e.target !== back) m.remove(); };
  const remove = m.remove.bind(m);
  m.remove = () => { unlockPage(); remove(); back && back.remove(); win.removeEventListener('resize', place); win.removeEventListener('keydown', onKey); win.removeEventListener('scroll', onScroll, true); doc.removeEventListener('pointerdown', off); };
  if (grip) swipeToClose(m, () => m.remove(), { grip });
  if (back) (doc.body || doc.documentElement).append(back);
  (doc.body || doc.documentElement).append(m);
  lockPage();
  place();
  win.addEventListener('resize', place); win.addEventListener('keydown', onKey); win.addEventListener('scroll', onScroll, true);
  setTimeout(() => { if (m.isConnected) doc.addEventListener('pointerdown', off); }, 0);
  m.place = place;
  return m;
}

export function confirmDlg(text, { ok = 'Confirm', danger = false } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const s = sheet({ title: 'Please confirm', icon: danger ? 'alert' : 'info', group: danger ? 'admin' : '', onClose: () => { if (!done) resolve(false); } });
    s.body.append(h('p', { class: 'muted', style: { marginBottom: '1rem' } }, text),
      h('div', { class: 'row', style: { justifyContent: 'flex-end' } },
        h('button', { class: 'btn ghost', onclick: () => s.close() }, 'Cancel'),
        h('button', { class: `btn ${danger ? 'danger' : 'primary'}`, onclick: () => { done = true; resolve(true); s.close(); } }, ok)));
  });
}
export function promptDlg(title, { value = '', placeholder = '', ok = 'Save', multiline = false } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const s = sheet({ title, icon: 'pen', onClose: () => { if (!done) resolve(null); } });
    const inp = multiline ? h('textarea', { class: 'textarea', placeholder }) : h('input', { class: 'input', placeholder });
    inp.value = value;
    const submit = () => { done = true; resolve(inp.value); s.close(); };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !multiline) submit(); });
    s.body.append(inp, h('div', { class: 'row', style: { justifyContent: 'flex-end', marginTop: '1rem' } }, h('button', { class: 'btn ghost', onclick: () => s.close() }, 'Cancel'), h('button', { class: 'btn primary', onclick: submit }, ok)));
  });
}

/* Tooltips: one floating node, coloured by the nearest data-group (function group). */
export function initTooltips() {
  const tip = h('div', { id: 'tip', role: 'tooltip' }); document.body.append(tip);
  let cur = null, timer = null;
  const hide = () => { tip.classList.remove('show'); cur = null; };
  const show = (el) => {
    const text = el.getAttribute('data-tip'); if (!text) return;
    cur = el;
    const g = el.closest('[data-group]'); tip.dataset.group = g ? g.dataset.group : '';
    tip.innerHTML = esc(text) + (el.dataset.kbd ? `<kbd>${esc(el.dataset.kbd)}</kbd>` : '');
    const r = el.getBoundingClientRect(); tip.style.left = '0px'; tip.style.top = '0px';
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let top = r.top - th - 8; if (top < 8) top = r.bottom + 8;
    tip.style.left = Math.max(8, Math.min(innerWidth - tw - 8, r.left + r.width / 2 - tw / 2)) + 'px'; tip.style.top = top + 'px';
    tip.classList.add('show');
  };
  document.addEventListener('pointerover', (e) => {
    if (e.pointerType === 'touch') return;
    const el = e.target.closest('[data-tip]');
    if (el === cur) return;
    clearTimeout(timer); hide();
    if (el) timer = setTimeout(() => show(el), 280);
  });
  // touch: long-press shows the tooltip
  let lp = null;
  document.addEventListener('touchstart', (e) => { const el = e.target.closest('[data-tip]'); if (!el) return; lp = setTimeout(() => { show(el); setTimeout(hide, 1600); }, 480); }, { passive: true });
  document.addEventListener('touchend', () => clearTimeout(lp), { passive: true });
  document.addEventListener('focusin', (e) => {
    const el = e.target.closest && e.target.closest('[data-tip]');
    if (!el) return;
    // keyboard focus only - pointer hover already handled above
    if (e.target.matches && e.target.matches(':focus-visible')) { clearTimeout(timer); show(el); }
  });
  document.addEventListener('focusout', (e) => {
    if (cur && e.target.closest && e.target.closest('[data-tip]') === cur) hide();
  });
  document.addEventListener('scroll', hide, true); document.addEventListener('pointerdown', () => { clearTimeout(timer); hide(); });
}

export function hue(s) { let x = 0; for (const c of String(s || '?')) x = (x * 31 + c.charCodeAt(0)) % 360; return x; }
export const initials = (n) => String(n || '?').trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase() || '?';
export function avatar(name, url, cls = '') {
  const el = h('span', { class: `av ${cls}`, style: { '--h': hue(name) }, title: name || '' });
  let src = url;
  if (src) {
    try { src = new URL(src, document.baseURI).href; } catch { /* keep */ }
    el.append(h('img', { src, alt: '', loading: 'lazy', onerror: (e) => { e.target.remove(); el.textContent = initials(name); } }));
  } else el.textContent = initials(name);
  return el;
}
export function timeAgo(d) {
  const t = typeof d === 'number' ? d : Date.parse(d); if (!t) return '';
  const s = Math.round((Date.now() - t) / 1000);
  if (s < -60) { const m = -s / 60; if (m < 60) return `in ${Math.round(m)}m`; if (m < 1440) return `in ${Math.round(m / 60)}h`; return fmtDate(t); }
  if (s < 45) return 'just now'; if (s < 3600) return `${Math.round(s / 60)}m`; if (s < 86400) return `${Math.round(s / 3600)}h`; if (s < 604800) return `${Math.round(s / 86400)}d`;
  return fmtDate(t, { year: undefined });
}
export const fmtDate = (d, o = {}) => new Date(d).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', ...o });
export const fmtDur = (sec) => { sec = Math.max(0, Math.round(sec || 0)); const hh = Math.floor(sec / 3600), mm = Math.floor((sec % 3600) / 60), ss = sec % 60; return hh ? `${hh}h ${mm}m` : mm ? `${mm}m ${ss ? ss + 's' : ''}`.trim() : `${ss}s`; };
export const fmtNum = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + 'k' : String(n || 0));
export async function copy(text, label = 'Copied') {
  try { await navigator.clipboard.writeText(text); } catch { const t = h('textarea', { style: { position: 'fixed', opacity: 0 } }); t.value = text; document.body.append(t); t.select(); document.execCommand('copy'); t.remove(); }
  toast(label, { icon: 'copy', group: 'content' });
}
export function download(name, data, type = 'text/plain') {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const a = h('a', { href: URL.createObjectURL(blob), download: name }); document.body.append(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
/* Minimal, safe markdown (escape first, then format) for AI summaries. */
export function md(src) {
  const lines = esc(src || '').split(/\r?\n/); let out = '', inList = false;
  const inline = (s) => s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/(^|\W)\*(.+?)\*(?=\W|$)/g, '$1<em>$2</em>').replace(/`([^`]+)`/g, '<code>$1</code>');
  for (const l of lines) {
    const li = l.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)/);
    if (li) { if (!inList) { out += '<ul>'; inList = true; } out += `<li>${inline(li[1])}</li>`; continue; }
    if (inList) { out += '</ul>'; inList = false; }
    const hd = l.match(/^(#{1,4})\s+(.*)/);
    if (hd) out += `<h3>${inline(hd[2])}</h3>`; else if (l.trim()) out += `<p>${inline(l)}</p>`;
  }
  if (inList) out += '</ul>';
  return out;
}
export const debounce = (fn, ms = 250) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
export const isMobile = () => matchMedia('(max-width: 820px)').matches;
export function readFileAsDataUrl(file) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); }); }
/**
 * What kind of deck a picked file is: 'pdf' | 'pptx' | 'image' | 'ppt' | 'keynote' | null.
 * Uses the name and type first, then the first bytes, because phones (Drive / Files / WhatsApp) often
 * hand over files with an empty type or no extension.
 */
export async function deckKind(f) {
  const n = String(f.name || '').toLowerCase(), t = String(f.type || '').toLowerCase();
  if (t === 'application/pdf' || n.endsWith('.pdf')) return 'pdf';
  if (t.includes('presentationml') || n.endsWith('.pptx') || n.endsWith('.ppsx')) return 'pptx';
  if (t.startsWith('image/') && !t.includes('svg')) return 'image';
  if (n.endsWith('.ppt') || t === 'application/vnd.ms-powerpoint') return 'ppt';
  if (/\.(docx?|csv|tsv|xlsx?)$/.test(n) || t.includes('wordprocessingml') || t.includes('spreadsheetml') || t === 'application/msword' || t === 'text/csv' || t === 'application/vnd.ms-excel') return 'doc';
  if (n.endsWith('.key') || t.includes('keynote')) return 'keynote';
  try {
    const b = new Uint8Array(await f.slice(0, 8).arrayBuffer());
    const hex = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
    if (hex.startsWith('25504446')) return 'pdf'; // %PDF
    if (hex.startsWith('504b0304')) return 'pptx'; // zip container (PPTX); the server checks it really is one
    if (hex.startsWith('d0cf11e0')) return 'ppt';
    if (/^(ffd8ff|89504e47|47494638|52494646)/.test(hex)) return 'image';
  } catch { /* unreadable */ }
  return null;
}
export const DECK_HELP = { ppt: 'Old .ppt files aren’t supported. Save it as PPTX or PDF and try again.', keynote: 'Keynote files aren’t supported. Export it as PDF or PPTX and try again.' };
/** True for a video by MIME type or a common extension (phones sometimes send no type). */
export function isVideoFile(file) {
  if (!file) return false;
  if (String(file.type || '').toLowerCase().startsWith('video/')) return true;
  return /\.(mp4|webm|mov|m4v|mkv|ogv)$/i.test(file.name || '');
}
/** Upload a File/Blob to /api/files (raw body). Videos go through the direct-to-R2 presign path. headers: room credentials when uploading as a guest. */
export async function uploadFile(file, { purpose = 'attachment', headers = {}, onProgress, signal, direct = false } = {}) {
  if (!direct && isVideoFile(file)) {
    const { uploadVideo } = await import('./video-upload.js');
    return uploadVideo(file, { purpose, headers, onProgress, signal, profile: purpose === 'content' ? 'material' : 'chat' });
  }
  let res;
  try {
    res = await fetch('/api/files?purpose=' + encodeURIComponent(purpose), {
      method: 'POST', body: file, credentials: 'include',
      headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name || 'upload'), ...headers },
    });
  } catch (err) {
    console.warn('[upload] network error', file.name, err);
    throw new Error(`Upload of ${file.name || 'file'} failed: network error. Check your connection and try again.`);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(data.error || (res.status === 413 ? 'That file is too big for the server' : `Upload failed (HTTP ${res.status})`));
    e.status = res.status; console.warn('[upload] failed', res.status, data.error || ''); throw e;
  }
  if (!data.url) throw new Error('Upload finished but the server returned no file link');
  return data;
}
