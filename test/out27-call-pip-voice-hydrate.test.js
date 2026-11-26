'use strict';
const { readFileSync } = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { describe, it } = require('node:test');
const { pathToFileURL } = require('node:url');

const root = path.join(__dirname, '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');

class MiniNode {
  constructor(doc, type, name) {
    this.ownerDocument = doc;
    this.nodeType = type;
    this.nodeName = name;
    this.childNodes = [];
    this.parentNode = null;
    this._attrs = {};
    this._class = '';
    this.style = {};
    this._born = doc;
  }
  get children() { return this.childNodes.filter((n) => n.nodeType === 1); }
  get className() { return this._class; }
  set className(v) { this._class = String(v || ''); }
  get classList() {
    const self = this;
    const toks = () => new Set(self._class.split(/\s+/).filter(Boolean));
    return {
      contains: (c) => toks().has(c),
      toggle(c, on) {
        const set = toks();
        const should = on == null ? !set.has(c) : !!on;
        if (should) set.add(c); else set.delete(c);
        self._class = [...set].join(' ');
      },
      add(c) { this.toggle(c, true); },
    };
  }
  get dataset() {
    const self = this;
    return new Proxy({}, {
      get(_, k) {
        const attr = 'data-' + String(k).replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
        return self._attrs[attr];
      },
      set(_, k, v) {
        const attr = 'data-' + String(k).replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
        self._attrs[attr] = String(v);
        return true;
      },
    });
  }
  setAttribute(k, v) { this._attrs[k] = String(v); if (k === 'class') this._class = String(v); }
  getAttribute(k) { return k === 'class' ? this._class : (Object.prototype.hasOwnProperty.call(this._attrs, k) ? this._attrs[k] : null); }
  append(...nodes) {
    for (let n of nodes.flat()) {
      if (n == null || n === false) continue;
      if (!n.nodeType) n = this.ownerDocument.createTextNode(String(n));
      if (n.parentNode) n.parentNode._remove(n);
      n.ownerDocument = this.ownerDocument;
      n.parentNode = this;
      this.childNodes.push(n);
    }
  }
  appendChild(n) { this.append(n); return n; }
  _remove(n) { this.childNodes = this.childNodes.filter((x) => x !== n); n.parentNode = null; }
  remove() { if (this.parentNode) this.parentNode._remove(this); }
  replaceWith(n) {
    const p = this.parentNode; if (!p) return;
    const i = p.childNodes.indexOf(this);
    if (n.parentNode) n.parentNode._remove(n);
    n.ownerDocument = p.ownerDocument;
    n.parentNode = p;
    p.childNodes[i] = n;
    this.parentNode = null;
  }
  addEventListener() {}
  set hidden(v) { this._hidden = !!v; if (v) this.setAttribute('hidden', ''); else delete this._attrs.hidden; }
  get hidden() { return !!this._hidden; }
  set innerHTML(v) { this._inner = String(v); }
  get innerHTML() { return this._inner || ''; }
  get textContent() {
    if (this._text != null && !this.childNodes.length) return this._text;
    return this.childNodes.map((c) => c.textContent).join('');
  }
  set textContent(v) { this._text = String(v); this.childNodes = []; }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  querySelectorAll(sel) {
    const out = [];
    const walk = (n) => {
      if (n.nodeType === 1 && match(n, sel)) out.push(n);
      (n.childNodes || []).forEach(walk);
    };
    this.childNodes.forEach(walk);
    return out;
  }
}

function match(el, sel) {
  const m = sel.match(/^(\w+)?((?:\.[-\w]+)*)(?:\[([^\]]+)\])?$/);
  if (!m) return false;
  if (m[1] && el.nodeName !== m[1].toLowerCase()) return false;
  if (m[2] && !m[2].slice(1).split('.').filter(Boolean).every((c) => el.classList.contains(c))) return false;
  if (m[3] && el.getAttribute(m[3]) == null) return false;
  return true;
}

class MiniDoc extends MiniNode {
  constructor() {
    super(null, 9, '#document');
    this.ownerDocument = this;
    this.body = this.createElement('body');
    this.documentElement = this.createElement('html');
    this.documentElement.append(this.body);
  }
  createElement(tag) {
    const el = new MiniNode(this, 1, String(tag).toLowerCase());
    if (tag === 'audio') {
      el.preload = '';
      el.playsInline = false;
      el.paused = true;
      el.duration = NaN;
      el.currentTime = 0;
      el.src = '';
      el.play = async () => { el.paused = false; };
      el.pause = () => { el.paused = true; };
    }
    return el;
  }
  createTextNode(t) {
    const n = new MiniNode(this, 3, '#text');
    n.textContent = t;
    return n;
  }
  adoptNode(n) {
    if (n.parentNode) n.parentNode._remove(n);
    const adopt = (x) => { x.ownerDocument = this; (x.childNodes || []).forEach(adopt); };
    adopt(n);
    return n;
  }
}

function paintSlot(vp, message, buildDoc) {
  const a = vp.pickVoiceAtt(message) || message.attachment;
  const slot = vp.voiceSlot(a, { doc: buildDoc, onAccent: !!message.mine });
  const msgs = buildDoc.createElement('div');
  msgs.className = 'app-pip-msgs';
  const bubble = buildDoc.createElement('div');
  bubble.className = 'app-pip-bubble';
  bubble.append(slot);
  msgs.append(bubble);
  return msgs;
}

function assertPlayer(root, pipDoc, label) {
  const play = root.querySelector('.vp-play');
  const time = root.querySelector('.vp-time');
  const audio = root.querySelector('audio');
  assert.ok(play, `${label}: expected a play button`);
  assert.ok(time, `${label}: expected a duration label`);
  assert.match(String(time.textContent || time._text || '0:00'), /\d+:\d{2}/, `${label}: duration`);
  assert.ok(audio, `${label}: expected an audio element`);
  assert.equal(audio._born, pipDoc, `${label}: audio must be created in the PiP document, not adopted from the opener`);
  assert.ok(root.querySelector('.vp'), `${label}: expected .vp player`);
}

describe('out27 incoming call keeps the app pop-out, STT alignment, voice hydrate', () => {
  it('parses the changed front-end modules', () => {
    for (const f of [
      'public/js/app-pip.js', 'public/js/composer.js', 'public/js/voice-player.js',
      'public/js/pages/messages.js', 'public/js/messages/call-alert.js', 'public/js/messages/tones.js',
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

  it('never opens a second Document PiP when the app pop-out is already open', () => {
    const alert = read('public/js/messages/call-alert.js');
    assert.match(alert, /hasAppPip/);
    assert.match(alert, /pip: !!hidden && !!hasPiP && !!activation && !hasAppPip/);
    assert.match(alert, /if \(hasAppPip\(\)\) return;/);
    assert.match(alert, /requestWindow\(\{ width: 320, height: 150 \}\)/);
    const call = read('public/js/messages/call.js');
    assert.match(call, /placeCallUi/);
    assert.match(call, /class: 'call-ring'/);
    assert.match(call, /call-btn decline/);
    assert.match(call, /call-btn accept/);
    const css = read('public/css/src/10-components/call.css');
    assert.match(css, /\.call-ring\.in-pip/);
    assert.match(css, /position: relative/);
    const tones = read('public/js/messages/tones.js');
    assert.match(tones, /documentPictureInPicture/);
    assert.match(tones, /ringtone\.mp3/);
    assert.match(tones, /pipAudio/);
  });

  it('pins the STT mic to the bottom-right of the field and keeps the placeholder on one line', () => {
    const css = read('public/css/src/10-components/composer.css');
    assert.match(css, /textarea::placeholder \{[^}]*white-space: nowrap/s);
    assert.match(css, /text-overflow: ellipsis/);
    assert.match(css, /\.wa-ib\.wa-dictate \{[^}]*bottom: 7px/s);
    assert.doesNotMatch(css, /\.wa-ib\.wa-dictate \{[^}]*top: 50%/s);
    assert.match(css, /align-items: flex-end/);
  });

  it('renders a real voice message through initial thread load and live-append in the pip renderer', async () => {
    const vp = await import(pathToFileURL(path.join(root, 'public/js/voice-player.js')).href);
    const slim = { kind: 'voice', name: 'Voice note', mime: 'audio/webm;codecs=opus', size: 18432, url: '/files/vn_abc123.webm' };
    const msg = { id: 91, kind: 'text', text: '', mine: true, fromUserId: 7, attachment: slim };

    assert.equal(vp.isVoiceAtt(slim), true);
    assert.equal(vp.pickVoiceAtt(msg), slim);
    assert.ok(vp.pickVoiceAtt({ attachment: { kind: 'audio', mime: 'audio/webm', url: '/files/a.webm' } }));
    assert.ok(vp.pickVoiceAtt({ attachments: [slim] }));
    assert.ok(vp.pickVoiceAtt({ kind: 'voice_note', url: '/files/z.webm' }));

    // Initial thread load: slots are built in the opener, then the view is
    // inserted into the PiP document, then hydrated (the out27 order).
    const openerA = new MiniDoc();
    const pipA = new MiniDoc();
    const treeA = paintSlot(vp, msg, openerA);
    const adoptedA = pipA.adoptNode(treeA);
    pipA.body.append(adoptedA);
    const nA = vp.hydrateVoicePlayers(adoptedA, pipA);
    assert.equal(nA, 1, 'initial load should hydrate one player');
    assertPlayer(adoptedA, pipA, 'initial thread load');

    // Live-append: the thread already lives in the PiP document.
    const openerB = new MiniDoc();
    const pipB = new MiniDoc();
    const treeB = paintSlot(vp, msg, openerB);
    const adoptedB = pipB.adoptNode(treeB);
    pipB.body.append(adoptedB);
    const nB = vp.hydrateVoicePlayers(adoptedB, pipB);
    assert.equal(nB, 1, 'live append should hydrate one player');
    assertPlayer(adoptedB, pipB, 'live append');

    // Root-cause check: hydrating in the opener (out26) creates audio in the wrong document.
    const openerC = new MiniDoc();
    const pipC = new MiniDoc();
    const treeC = paintSlot(vp, msg, openerC);
    vp.hydrateVoicePlayers(treeC, openerC);
    const audioBefore = treeC.querySelector('audio');
    assert.equal(audioBefore._born, openerC, 'out26 order births audio in the opener');
    const adoptedC = pipC.adoptNode(treeC);
    pipC.body.append(adoptedC);
    assert.equal(adoptedC.querySelector('audio')._born, openerC, 'adopting later does not recreate the audio');

    const pip = read('public/js/app-pip.js');
    assert.match(pip, /hydrateVoicePlayers\(root, win\.document\)/);
    assert.match(pip, /if \(root\.ownerDocument !== win\.document\) return;/);
    assert.match(pip, /if \(thread && thread\.msgsEl\) hydrateVoice\(thread\.msgsEl\)/);
    assert.match(pip, /voiceSlot\(/);
    assert.doesNotMatch(pip, /mountVoicePlayers/);
    const msgSrc = read('public/js/pages/messages.js');
    assert.match(msgSrc, /voicePlayer\(/);
    assert.match(msgSrc, /pickVoiceAtt/);
  });
});
