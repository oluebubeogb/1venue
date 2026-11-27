// Image lightbox: one reusable full-screen viewer for content images (materials, chat and message
// photos, feed posts). Left / right across the images in the same group, swipe on touch, arrow keys,
// Esc, a counter, focus trapping, and no animation when the user prefers reduced motion.
//
// Opt in:  <img data-lightbox>, or any of the classes in SELECTOR. Group: the nearest [data-lb-group],
// else the nearest post / message list / card. Avatars and icons are never matched.
// The viewer is built in the image's document so it also works inside Document Picture-in-Picture.
import { icon } from './icons.js';
import { downloadUrl } from './msg-sync.js';

const SELECTOR = 'img[data-lightbox], img.msg-img, img.feed-post-img, img.mat-page-img, img.post-img, img.app-pip-att, .prose img';
const GROUP = '[data-lb-group], .feed-post, .msg-list, .msgs, .chat-list, .mat-pages, .app-pip-msgs, article, .card';
const SKIP = '.avatar, .ava, .ico-tile, .icon-btn, [data-lightbox="off"], .no-lightbox';
let cur = null;

function fileName(it) {
  const raw = (it && (it.alt || it.src)) || 'image';
  try {
    const base = decodeURIComponent(new URL(it.src, document.baseURI).pathname.split('/').pop() || '');
    if (base && /\.[a-z0-9]{2,5}$/i.test(base)) return base;
  } catch { /* */ }
  const fromAlt = String(it && it.alt || '').replace(/[^\w.-]+/g, '_').replace(/^_|_$/g, '');
  return fromAlt || 'image';
}

/** Open a viewer over `images` ([{ src, alt }]) at `index`. Returns { close }. Built in `doc`. */
export function openLightbox(images, index = 0, { returnFocus, doc } = {}) {
  if (cur) cur.close();
  if (!images.length) return null;
  const d = doc || (returnFocus && returnFocus.ownerDocument) || document;
  const win = d.defaultView || window;
  let i = Math.max(0, Math.min(index, images.length - 1));
  const reduce = (win.matchMedia ? win.matchMedia('(prefers-reduced-motion: reduce)').matches : false);
  const el = (tag, cls) => { const n = d.createElement(tag); if (cls) n.className = cls; return n; };
  const img = el('img', 'lb-img'); img.decoding = 'async';
  const counter = el('div', 'lb-count'); counter.setAttribute('aria-live', 'polite');
  const cap = el('div', 'lb-cap');
  const btn = (cls, label, ic) => { const b = el('button', `lb-btn ${cls}`); b.type = 'button'; b.setAttribute('aria-label', label); b.innerHTML = icon(ic, { size: 22 }); return b; };
  const prev = btn('lb-prev', 'Previous image', 'chevronLeft'), next = btn('lb-next', 'Next image', 'chevronRight');
  const close = btn('lb-close', 'Close', 'x');
  const dl = btn('lb-dl', 'Download', 'download');
  const stage = el('div', 'lb-stage'); stage.append(img);
  const tools = el('div', 'lb-tools'); tools.append(dl, close);
  const top = el('div', 'lb-top'); top.append(counter, tools);
  const root = el('div', 'lb' + (reduce ? ' reduce' : ''));
  root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', 'Image viewer');
  root.append(top, stage, prev, next, cap);
  const many = images.length > 1;
  prev.hidden = next.hidden = !many;

  function show(n, dir = 0) {
    i = (n + images.length) % images.length;
    const it = images[i];
    img.src = it.src; img.alt = it.alt || '';
    counter.textContent = many ? `${i + 1} / ${images.length}` : '';
    cap.textContent = it.alt || ''; cap.hidden = !it.alt;
    if (!reduce && dir) { img.classList.remove('from-l', 'from-r'); void img.offsetWidth; img.classList.add(dir > 0 ? 'from-r' : 'from-l'); }
    if (many) for (const k of [i + 1, i - 1]) { const p = new (win.Image || Image)(); p.src = images[(k + images.length) % images.length].src; }
  }
  const go = (dlt) => { if (many) show(i + dlt, dlt); };
  prev.onclick = (e) => { e.stopPropagation(); go(-1); };
  next.onclick = (e) => { e.stopPropagation(); go(1); };
  close.onclick = (e) => { e.stopPropagation(); api.close(); };
  dl.onclick = (e) => {
    e.stopPropagation();
    const image = images[i];
    downloadUrl(image.src, fileName(image));
  };
  stage.addEventListener('click', (e) => { if (e.target === stage) api.close(); });
  root.addEventListener('click', (e) => { if (e.target === root) api.close(); });

  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); api.close(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
    else if (e.key === 'Tab') {
      const f = [close, dl, prev, next].filter((b) => !b.hidden);
      const at = f.indexOf(d.activeElement);
      e.preventDefault();
      f[(at + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus();
    }
  };
  let x0 = null, y0 = 0, dx = 0, dy = 0;
  stage.addEventListener('touchstart', (e) => { if (e.touches.length !== 1) { x0 = null; return; } x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; dx = dy = 0; }, { passive: true });
  stage.addEventListener('touchmove', (e) => { if (x0 == null) return; dx = e.touches[0].clientX - x0; dy = e.touches[0].clientY - y0; if (!reduce) img.style.transform = Math.abs(dx) > Math.abs(dy) ? `translateX(${dx}px)` : dy > 0 ? `translateY(${dy}px)` : ''; }, { passive: true });
  stage.addEventListener('touchend', () => {
    if (x0 == null) return; img.style.transform = ''; x0 = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) go(dx < 0 ? 1 : -1);
    else if (dy > 90) api.close();
  });

  const html = d.documentElement;
  const prevOverflow = html.style.overflow;
  html.style.overflow = 'hidden';
  d.addEventListener('keydown', onKey, true);
  (d.body || html).append(root);
  show(i);
  requestAnimationFrame(() => { root.classList.add('in'); close.focus({ preventScroll: true }); });

  const api = {
    close() {
      if (cur !== api) return; cur = null;
      d.removeEventListener('keydown', onKey, true);
      html.style.overflow = prevOverflow;
      root.classList.remove('in');
      setTimeout(() => root.remove(), reduce ? 0 : 180);
      try { returnFocus && returnFocus.focus && returnFocus.focus({ preventScroll: true }); } catch { /* */ }
    },
  };
  cur = api;
  return api;
}

/** Images in the same group as `el`, and el's index among them. */
export function groupOf(el) {
  const d = (el && el.ownerDocument) || document;
  const g = el.closest(GROUP) || el.parentElement || d.body;
  const list = [...g.querySelectorAll(SELECTOR)].filter((x) => !x.closest(SKIP) && x.src);
  const idx = list.indexOf(el);
  return { images: (idx < 0 ? [el] : list).map((x) => ({ src: x.currentSrc || x.src, alt: x.alt || '' })), index: Math.max(0, idx) };
}

const inited = new WeakSet();
/** One delegated listener per document (main app and each PiP window). */
export function initLightbox(doc = document) {
  if (!doc || inited.has(doc)) return;
  inited.add(doc);
  doc.addEventListener('click', (e) => {
    const el = e.target.closest && e.target.closest(SELECTOR);
    if (!el || el.closest(SKIP) || el.closest('a[href]') || el.closest('.lb')) return;
    e.preventDefault(); e.stopPropagation();
    const { images, index } = groupOf(el);
    openLightbox(images, index, { returnFocus: el, doc: el.ownerDocument || doc });
  }, true);
  doc.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches(SELECTOR)) { e.preventDefault(); e.target.click(); }
  });
}
export const LIGHTBOX_SELECTOR = SELECTOR;
