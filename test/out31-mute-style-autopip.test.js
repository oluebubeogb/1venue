'use strict';
const { readFileSync } = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { describe, it, before } = require('node:test');
const { pathToFileURL } = require('node:url');

const root = path.join(__dirname, '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');

describe('out31 mute-call style and sync auto-pip', () => {
  it('parses the changed front-end modules', () => {
    for (const f of [
      'public/js/app.js',
      'public/js/room/session.js',
      'public/js/room/room.js',
    ]) {
      const r = spawnSync(process.execPath, ['--check', path.join(root, f)], { encoding: 'utf8' });
      assert.equal(r.status, 0, `${f}: ${r.stderr || r.stdout}`);
    }
  });

  it('bumps the service worker and cache-bust query', () => {
    assert.match(read('public/sw.js'), /VERSION = 'v97-2026-11-26'/);
    assert.match(read('public/index.html'), /app\.css\?v=83/);
    assert.match(read('public/index.html'), /app\.js\?v=83/);
  });

  it('uses the same command-bar toggle as the other chips, only when the call is muted', () => {
    const room = read('public/js/room/room.js');
    assert.match(room, /id: 'r-spk'/);
    assert.match(room, /active: \(\) => !!R\.callMuted/);
    assert.doesNotMatch(room, /id: 'r-spk'[^]*active: \(\) => !R\.callMuted/);
    const css = read('public/css/src/10-components/command-bar.css');
    assert.match(css, /\.cmd-act\.on \{/);
  });

  it('primes Document PiP from a capturing click and from navigate, before any await', () => {
    const app = read('public/js/app.js');
    assert.match(app, /primeAutoPip\('navigate', to\)/);
    assert.match(app, /installAutoPipGuards\(\)/);
    const session = read('public/js/room/session.js');
    assert.match(session, /addEventListener\('click'/);
    assert.match(session, /true\)/);
    assert.match(session, /primeAutoPip\('click', dest\)/);
    assert.match(session, /requestWindow/);
    assert.match(session, /console\.debug\('\[auto-pip\]'/);
    assert.match(session, /popstate/);
    assert.match(session, /enterpictureinpicture/);
    assert.match(session, /setMicrophoneActive/);
    const room = read('public/js/room/room.js');
    assert.match(room, /bindMediaSession\(this\)/);
  });

  it('calls requestWindow synchronously when a Settings link is clicked mid-meeting', async () => {
    const calls = [];
    const listeners = { capture: [], bubble: [] };
    const chain = [];
    const el = (tag, attrs = {}) => {
      const node = {
        tagName: String(tag).toUpperCase(),
        attrs,
        parent: null,
        children: [],
        get href() { return this.attrs.href; },
        get target() { return this.attrs.target || ''; },
        getAttribute(k) { return this.attrs[k]; },
        hasAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k); },
        closest(sel) {
          let n = this;
          while (n) {
            if (sel === 'a[href]' && n.tagName === 'A' && n.attrs && n.attrs.href) return n;
            n = n.parent;
          }
          return null;
        },
        append(...kids) { for (const k of kids) { k.parent = this; this.children.push(k); } },
        addEventListener() {},
        querySelector() { return null; },
        querySelectorAll() { return []; },
        createElement(t) { return el(t); },
        createElementNS(_, t) { return el(t); },
      };
      return node;
    };
    const body = el('body');
    const doc = el('document');
    doc.body = body;
    body.parent = doc;
    doc.defaultView = null;
    doc.addEventListener = (type, fn, opts) => {
      if (type !== 'click') return;
      const cap = opts === true || (opts && opts.capture);
      (cap ? listeners.capture : listeners.bubble).push(fn);
    };
    doc._autoPipGuards = false;
    const loc = { href: 'https://1venue.live/yet27b', origin: 'https://1venue.live', pathname: '/yet27b', search: '', hash: '' };
    const pipWin = { closed: false, document: doc, addEventListener() {} };
    const dpi = {
      window: null,
      requestWindow(opts) { calls.push({ at: 'sync', opts }); this.window = pipWin; return Promise.resolve(pipWin); },
    };

    const setGlobal = (key, value) => {
      try { global[key] = value; return; } catch { /* getter-only */ }
      try { Object.defineProperty(global, key, { value, configurable: true, writable: true }); } catch { /* */ }
    };
    const prev = {
      document: global.document,
      window: global.window,
      location: global.location,
      documentPictureInPicture: global.documentPictureInPicture,
    };
    const gWindow = { document: doc, addEventListener() {}, location: loc, documentPictureInPicture: dpi, focus() {}, navigator: { mediaSession: { setActionHandler() {}, metadata: null } } };
    setGlobal('document', doc);
    setGlobal('window', gWindow);
    setGlobal('location', loc);
    setGlobal('documentPictureInPicture', dpi);
    doc.defaultView = gWindow;

    try {
      const mod = await import(pathToFileURL(path.join(root, 'public/js/room/session.js')).href + '?t=' + Date.now());
      const room = { alive: true, inRoom: true, root: el('div'), code: 'yet27b', roomName: 'Test', _leaving: false, media: { mic: true, cam: false }, stageR: { el: el('div') } };
      mod._testSetLive(room);
      mod.installAutoPipGuards(doc);
      const a = el('a', { href: '/settings' });
      body.append(a);
      const ev = { type: 'click', target: a, button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false };
      const before = calls.length;
      for (const fn of listeners.capture) fn(ev);
      assert.equal(calls.length, before + 1, 'requestWindow must run in the capturing click listener, before any await');
      let later = false;
      await Promise.resolve().then(() => { later = true; });
      assert.equal(later, true);
      assert.equal(calls.length, 1, 'must not request a second window after a microtask');
    } finally {
      const restore = (key, value) => {
        try { if (value === undefined) delete global[key]; else global[key] = value; } catch { /* */ }
      };
      restore('document', prev.document);
      restore('window', prev.window);
      restore('location', prev.location);
      restore('documentPictureInPicture', prev.documentPictureInPicture);
    }
  });
});
