// Small UI toolkit: DOM builder, API, toasts, sheets, menus, tooltips, formatting.
import { icon } from './icons.js';

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

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
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}
export const frag = (html) => document.createRange().createContextualFragment(html);
export const I = (name, size, cls) => frag(icon(name, { size, cls }));

export async function api(path, { method = 'GET', body, headers = {}, raw = false } = {}) {
  const opts = { method, credentials: 'include', headers: { ...headers } };
  if (body !== undefined) {
    if (body instanceof Blob || body instanceof ArrayBuffer) opts.body = body;
    else { opts.body = JSON.stringify(body); opts.headers['Content-Type'] = 'application/json'; }
  }
  let res;
  try { res = await fetch(path, opts); } catch (e) { const err = new Error(navigator.onLine === false ? 'You are offline — check your connection and try again' : 'Could not reach 1venue — check your connection and try again'); err.status = 0; err.cause = e; throw err; }
  if (raw) return res;
  let data = null;
  try { data = await res.json(); } catch { /* empty */ }
  if (!res.ok) {
    const err = new Error(errText(data && (data.error || data.message)) || HTTP_MSG[res.status] || (res.status >= 500 ? 'Something went wrong on our side — please try again' : `Request failed (${res.status})`));
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
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 260); }, ms);
  return t;
}
const HTTP_MSG = { 401: 'Please sign in to continue', 403: 'You don’t have permission to do that', 404: 'We couldn’t find that', 413: 'That file is too large', 429: 'Slow down a little — try again in a moment' };
/* Turn anything thrown or returned into a readable sentence (never "[object Object]"). */
export function errText(e) {
  if (e == null || e === '') return '';
  if (typeof e === 'string') return e;
  if (typeof e === 'number') return HTTP_MSG[e] || `Error ${e}`;
  if (Array.isArray(e)) return e.map(errText).filter(Boolean).join(', ');
  if (typeof e === 'object') { const m = e.message ?? e.error ?? e.detail ?? e.msg ?? e.reason; if (m != null && m !== e) return errText(m); try { const j = JSON.stringify(e); return j && j !== '{}' ? j.slice(0, 160) : 'Something went wrong'; } catch { return 'Something went wrong'; } }
  return String(e);
}
export const toastErr = (e) => toast(errText(e) || 'Something went wrong', { icon: 'alert', group: 'admin' });

let sheetStack = [];
export function sheet({ title = '', icon: ic, group = '', body, wide = false, onClose } = {}) {
  const scrim = h('div', { class: 'scrim' });
  const closeBtn = h('button', { class: 'icon-btn', 'aria-label': 'Close', 'data-tip': 'Close', html: icon('x') });
  const head = h('div', { class: 'sh-head' }, h('h3', { 'data-group': group }, ic ? h('span', { style: { color: 'var(--g, var(--accent))', display: 'flex' }, html: icon(ic) }) : null, title), closeBtn);
  const bodyEl = h('div', { class: 'sh-body' });
  const el = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title, style: wide ? { width: 'min(860px, 100%)' } : null }, h('div', { class: 'grab' }), head, bodyEl);
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
  // swipe-down to dismiss (mobile gesture)
  let y0 = null, dy = 0;
  const start = (e) => { if (bodyEl.scrollTop > 0 && !e.target.closest('.grab,.sh-head')) return; y0 = e.touches[0].clientY; dy = 0; el.style.transition = 'none'; };
  const move = (e) => { if (y0 == null) return; dy = Math.max(0, e.touches[0].clientY - y0); if (dy > 0) el.style.transform = `translate(-50%, ${dy}px)`; };
  const end = () => { if (y0 == null) return; el.style.transition = ''; if (dy > 110) close(); else el.style.transform = ''; y0 = null; };
  el.addEventListener('touchstart', start, { passive: true }); el.addEventListener('touchmove', move, { passive: true }); el.addEventListener('touchend', end);
  document.body.append(scrim, el);
  const api_ = { el, body: bodyEl, close, setTitle: (t) => { head.querySelector('h3').lastChild.textContent = t; } };
  sheetStack.push(api_);
  setTimeout(() => { const f = el.querySelector('input,textarea,select'); if (f && matchMedia('(hover:hover)').matches) f.focus(); }, 60);
  return api_;
}
export const closeTopSheet = () => { const s = sheetStack[sheetStack.length - 1]; if (s) { s.close(); return true; } return false; };

export function menu(anchor, items) {
  document.querySelectorAll('.menu').forEach((m) => m.remove());
  const m = h('div', { class: 'menu', role: 'menu' });
  for (const it of items) {
    if (it === '-') { m.append(h('hr')); continue; }
    if (!it || it.hidden) continue;
    m.append(h('button', { role: 'menuitem', 'data-group': it.group || '', onclick: () => { m.remove(); it.run(); } }, it.icon ? I(it.icon, 18) : null, h('span', { class: 'grow' }, it.label), it.hint ? h('span', { class: 'tiny faint' }, it.hint) : null));
  }
  document.body.append(m);
  const r = anchor.getBoundingClientRect(); const mw = m.offsetWidth, mh = m.offsetHeight;
  let x = Math.min(r.left, innerWidth - mw - 8), y = r.bottom + 6;
  if (y + mh > innerHeight - 8) y = Math.max(8, r.top - mh - 6);
  m.style.left = Math.max(8, x) + 'px'; m.style.top = y + 'px';
  setTimeout(() => document.addEventListener('pointerdown', function off(e) { if (!m.contains(e.target)) { m.remove(); document.removeEventListener('pointerdown', off); } }), 0);
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
  document.addEventListener('scroll', hide, true); document.addEventListener('pointerdown', () => { clearTimeout(timer); hide(); });
}

export function hue(s) { let x = 0; for (const c of String(s || '?')) x = (x * 31 + c.charCodeAt(0)) % 360; return x; }
export const initials = (n) => String(n || '?').trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase() || '?';
export function avatar(name, url, cls = '') {
  const el = h('span', { class: `av ${cls}`, style: { '--h': hue(name) }, title: name || '' });
  if (url) el.append(h('img', { src: url, alt: '', loading: 'lazy', onerror: (e) => { e.target.remove(); el.textContent = initials(name); } }));
  else el.textContent = initials(name);
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
/** Upload a File/Blob to /api/files (raw body). headers: room credentials when uploading as a guest. */
export async function uploadFile(file, { purpose = 'attachment', headers = {} } = {}) {
  const res = await fetch('/api/files?purpose=' + encodeURIComponent(purpose), {
    method: 'POST', body: file, credentials: 'include',
    headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name || 'upload'), ...headers },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || 'Upload failed'); e.status = res.status; throw e; }
  return data;
}
