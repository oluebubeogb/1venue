/** Incremental chat list sync and attachment download (R2-safe). */
import { h, download, toastErr } from './ui.js';

export function nearBottom(el, px = 80) {
  if (!el) return true;
  return el.scrollHeight - el.clientHeight - el.scrollTop < px;
}

export function attUrl(a) {
  if (!a) return '';
  return a.url || a.dataUrl || a.href || a.src || '';
}

export function attDownloadName(a) {
  if (!a) return 'download';
  if (a.name) return String(a.name).replace(/[\\/:*?"<>|]+/g, '_').slice(0, 120);
  const url = String(attUrl(a));
  try {
    const path = decodeURIComponent(new URL(url, typeof location !== 'undefined' ? location.href : 'https://local/').pathname.split('/').pop() || '');
    if (path && path !== '/') return path.slice(0, 120);
  } catch { /* ignore */ }
  const kind = a.kind || ((a.mime || '').split('/')[0]) || 'file';
  const sub = (a.mime && a.mime.includes('/') && !/octet-stream/.test(a.mime)) ? a.mime.split('/')[1].split(';')[0] : '';
  const ext = sub || (kind === 'image' ? 'jpg' : kind === 'video' || kind === 'voice' ? 'webm' : 'bin');
  return `${kind}.${ext}`;
}

export function canDownloadAtt(a) {
  if (!a || a.kind === 'passage' || a.kind === 'material') return false;
  return !!attUrl(a);
}

/** Fetch a (possibly cross-origin R2) file as a blob and save it; fall back to ?download. */
export async function downloadUrl(url, name) {
  const filename = String(name || 'download').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 120) || 'download';
  if (!url) return;
  if (String(url).startsWith('data:') || String(url).startsWith('blob:')) {
    const a = h('a', { href: url, download: filename });
    document.body.append(a); a.click(); a.remove();
    return;
  }
  try {
    const res = await fetch(url, { mode: 'cors', credentials: 'same-origin' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const blob = await res.blob();
    download(filename, blob, blob.type || 'application/octet-stream');
  } catch (e) {
    try {
      const u = new URL(url, location.href);
      u.searchParams.set('download', filename);
      const a = h('a', { href: u.href, download: filename, target: '_blank', rel: 'noopener' });
      document.body.append(a); a.click(); a.remove();
    } catch (e2) {
      toastErr(e2.message || e.message || 'Could not download');
    }
  }
}

export function downloadAtt(a) {
  if (!canDownloadAtt(a)) return;
  return downloadUrl(attUrl(a), attDownloadName(a));
}

/**
 * Keep existing nodes, append new ones, patch or replace changed ones, remove gone ones.
 * items: { key, sig, create(), patch?(node) }  — patch should return false to replace the node.
 * Slot rows (day headers, empty, load-older) set slot: true and use data-sync as the key.
 */
export function syncList(el, items, { keyAttr = 'data-id' } = {}) {
  const prev = new Map();
  for (const n of [...el.children]) {
    const k = n.getAttribute('data-sync') || n.getAttribute(keyAttr);
    if (k) prev.set(String(k), n);
    else n.remove();
  }
  const appended = [];
  const patched = [];
  const ordered = [];
  for (const item of items) {
    const key = String(item.key);
    let node = prev.get(key);
    if (node) prev.delete(key);
    if (node && String(node.dataset.sig || '') === String(item.sig)) {
      ordered.push(node);
      continue;
    }
    if (node && item.patch) {
      const ok = item.patch(node);
      if (ok !== false) {
        node.dataset.sig = String(item.sig);
        patched.push(node);
        ordered.push(node);
        continue;
      }
    }
    if (node) node.remove();
    node = item.create();
    if (item.slot) node.setAttribute('data-sync', key);
    else if (!node.getAttribute(keyAttr)) node.setAttribute(keyAttr, key);
    node.dataset.sig = String(item.sig);
    ordered.push(node);
    appended.push(node);
  }
  for (const n of prev.values()) n.remove();
  let cursor = el.firstChild;
  for (const node of ordered) {
    if (node !== cursor) el.insertBefore(node, cursor);
    cursor = node.nextSibling;
  }
  return { appended, patched };
}

export function markEnter(nodes, cls = 'msg-enter') {
  for (const n of nodes) {
    if (!n || !n.classList) continue;
    n.classList.add(cls);
    const done = () => n.classList.remove(cls);
    n.addEventListener('animationend', done, { once: true });
    setTimeout(done, 400);
  }
}
