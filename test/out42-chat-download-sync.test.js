'use strict';
const { readFileSync } = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { describe, it } = require('node:test');

const root = path.join(__dirname, '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');

function el(tag = 'div') {
  const n = {
    tagName: tag.toUpperCase(),
    children: [],
    parentNode: null,
    dataset: {},
    attrs: {},
    classList: { _s: new Set(), contains(c) { return n.classList._s.has(c); }, add(c) { n.classList._s.add(c); }, remove(c) { n.classList._s.delete(c); } },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(n.attrs, k) ? n.attrs[k] : (k.startsWith('data-') && n.dataset[k.slice(5)] != null ? String(n.dataset[k.slice(5)]) : null); },
    setAttribute(k, v) { n.attrs[k] = String(v); if (k === 'data-sig') n.dataset.sig = String(v); if (k === 'data-id') n.attrs['data-id'] = String(v); if (k === 'data-sync') n.attrs['data-sync'] = String(v); },
    appendChild(c) { if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = n; n.children.push(c); return c; },
    insertBefore(c, ref) {
      if (c.parentNode) c.parentNode.removeChild(c);
      c.parentNode = n;
      if (!ref) { n.children.push(c); return c; }
      const i = n.children.indexOf(ref);
      if (i < 0) n.children.push(c); else n.children.splice(i, 0, c);
      return c;
    },
    removeChild(c) { n.children = n.children.filter((x) => x !== c); c.parentNode = null; return c; },
    remove() { if (n.parentNode) n.parentNode.removeChild(n); },
    get firstChild() { return n.children[0] || null; },
    get nextSibling() {
      if (!n.parentNode) return null;
      const i = n.parentNode.children.indexOf(n);
      return i >= 0 ? n.parentNode.children[i + 1] || null : null;
    },
  };
  return n;
}

function loadSync() {
  const src = read('public/js/msg-sync.js').replace(/^import .*;\s*$/mg, '').replace(/^export /mg, '');
  const download = (name, data) => { loadSync.last = { name, data }; };
  const toastErr = () => {};
  const h = (tag) => el(tag);
  return new Function('download', 'toastErr', 'h', `${src}\nreturn { syncList, attDownloadName, canDownloadAtt, attUrl, nearBottom };`)(download, toastErr, h);
}

describe('out42 chat download and incremental messages', () => {
  it('adds Download to every message 3-dot menu and fetches R2 files as a blob', () => {
    const sync = read('public/js/msg-sync.js');
    assert.match(sync, /export async function downloadUrl/);
    assert.match(sync, /mode: 'cors'/);
    assert.match(sync, /searchParams\.set\('download'/);
    assert.match(read('public/js/pages/messages.js'), /canDownloadAtt\(a\).*Download/);
    assert.match(read('public/js/app-pip.js'), /canDownloadAtt\(m\.attachment\).*Download/);
    assert.match(read('public/js/room/panels.js'), /label: 'Download'/);
    assert.match(read('public/js/room/panels.js'), /msg-more/);
  });

  it('paints chats incrementally so existing video nodes are not recreated', () => {
    assert.match(read('public/js/pages/messages.js'), /syncList\(msgsEl/);
    assert.match(read('public/js/app-pip.js'), /syncList\(el/);
    assert.match(read('public/js/room/panels.js'), /function appendChat/);
    assert.match(read('src/features/chat/client/ws.js'), /appendChat\('all'/);
    assert.match(read('src/features/chat/client/ws.js'), /return false/);
    assert.match(read('src/features/privateChat/client/ws.js'), /return false/);
    assert.match(read('src/features/groupChat/client/ws.js'), /return false/);
    assert.match(read('public/js/pages/messages.js'), /chat-new-btn/);
    assert.match(read('public/js/app-pip.js'), /chat-new-btn/);
  });

  it('bumps the cache versions', () => {
    assert.match(read('public/sw.js'), /VERSION = 'v97-2026-11-26'/);
    assert.match(read('public/index.html'), /app\.css\?v=83/);
    assert.match(read('public/index.html'), /app\.js\?v=83/);
  });

  it('syncList keeps existing nodes, appends new ones, and patches in place', () => {
    const { syncList, attDownloadName, canDownloadAtt, attUrl, nearBottom } = loadSync();
    const root = el('div');
    const make = (id, sig) => { const n = el('div'); n.setAttribute('data-id', id); n.dataset.sig = sig; n.classList.add('msg-row'); n.text = sig; return n; };
    const a = make('1', 'hello');
    const r1 = syncList(root, [
      { key: '1', sig: 'hello', create: () => a },
    ]);
    assert.equal(root.children.length, 1);
    assert.equal(r1.appended[0], a);
    const r2 = syncList(root, [
      { key: '1', sig: 'hello', create: () => { throw new Error('must not recreate 1'); } },
      { key: '2', sig: 'hi', create: () => make('2', 'hi') },
    ]);
    assert.equal(root.children.length, 2);
    assert.equal(root.children[0], a, 'first node is reused');
    assert.equal(r2.appended.length, 1);
    assert.equal(r2.appended[0].getAttribute('data-id'), '2');
    let patched = 0;
    const r3 = syncList(root, [
      { key: '1', sig: 'hello!', create: () => { throw new Error('must patch, not replace'); }, patch: (n) => { patched++; n.text = 'hello!'; return true; } },
      { key: '2', sig: 'hi', create: () => { throw new Error('must keep 2'); } },
    ]);
    assert.equal(patched, 1);
    assert.equal(r3.patched[0], a);
    assert.equal(root.children[0], a);
    assert.equal(root.children[1].getAttribute('data-id'), '2');
    syncList(root, [
      { key: '2', sig: 'hi', create: () => { throw new Error('must keep 2'); } },
    ]);
    assert.equal(root.children.length, 1);
    assert.equal(root.children[0].getAttribute('data-id'), '2');

    assert.equal(attDownloadName({ name: 'Talk.mp4' }), 'Talk.mp4');
    assert.equal(attDownloadName({ kind: 'image', mime: 'image/jpeg' }), 'image.jpeg');
    assert.equal(canDownloadAtt({ url: 'https://files.1venue.live/x.mp4', name: 'x.mp4' }), true);
    assert.equal(canDownloadAtt({ kind: 'passage', url: 'https://example' }), false);
    assert.equal(attUrl({ url: 'https://files.1venue.live/a' }), 'https://files.1venue.live/a');
    const box = { scrollHeight: 400, clientHeight: 200, scrollTop: 180 };
    assert.equal(nearBottom(box, 80), true);
    box.scrollTop = 10;
    assert.equal(nearBottom(box, 80), false);
  });
});
