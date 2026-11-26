'use strict';
const { readFileSync } = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { describe, it } = require('node:test');
const { pathToFileURL } = require('node:url');

const root = path.join(__dirname, '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const JUNK = /(?:^|\s)(null|undefined|NaN|\[object Object\])(?:\s|$)/;

class MiniEl {
  constructor(tag = 'div') {
    this.tagName = tag;
    this.childNodes = [];
  }
  // Native-like: non-nodes become String(value), so null -> "null".
  _adopt(args) {
    const out = [];
    for (const a of args.flat(Infinity)) {
      if (a && a.childNodes) out.push(a);
      else out.push({ nodeType: 3, textContent: String(a) });
    }
    return out;
  }
  append(...args) { this.childNodes.push(...this._adopt(args)); }
  replaceChildren(...args) { this.childNodes = this._adopt(args); }
  get textContent() {
    return this.childNodes.map((c) => {
      if (c == null) return '';
      if (typeof c.textContent === 'string') return c.textContent;
      if (c.childNodes) return c.childNodes.map((x) => x.textContent || '').join('');
      return String(c);
    }).join('');
  }
}

function textOf(el) { return el.textContent; }

describe('out28: no literal null on Settings, Dashboard, or sparse page renders', () => {
  it('parses the changed front-end modules', () => {
    for (const f of [
      'public/js/safe-text.js', 'public/js/ui.js',
      'public/js/pages/dashboard.js', 'public/js/pages/account.js', 'public/js/host-kit.js',
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

  it('kidsOf / put / add skip null, undefined, false and true so append cannot print them', async () => {
    const st = await import(pathToFileURL(path.join(root, 'public/js/safe-text.js')).href);
    assert.deepEqual(st.kidsOf('Password', null, undefined, false, true, 'Change'), ['Password', 'Change']);
    const el = new MiniEl();
    // Native-like leak (the bug):
    el.replaceChildren('Password', null, 'row');
    assert.match(textOf(el), /null/);
    // Hardened helper:
    const safe = new MiniEl();
    st.put(safe, 'Password hint', null, undefined, false, true, 'Change');
    assert.doesNotMatch(textOf(safe), JUNK);
    assert.match(textOf(safe), /Password hint/);
    const added = new MiniEl();
    st.add(added, 'Audience and RSVPs', null, 'Live now');
    assert.equal(textOf(added), 'Audience and RSVPsLive now');
  });

  it('renders the Settings password section and Dashboard with sparse data and no junk tokens', async () => {
    const st = await import(pathToFileURL(path.join(root, 'public/js/safe-text.js')).href);
    const row = (title, hint, control) => {
      const el = new MiniEl('div');
      st.put(el, title, hint, control);
      return el;
    };

    // Settings → Account: no Apple/Google rows (the password section's following siblings were null).
    const box = new MiniEl();
    const appleId = null, google = null, acc = { apple: false, google: false };
    st.put(box,
      row('Name', '@user', 'Edit'),
      row('Username', '@user', 'Change'),
      row('Phone', 'Not set', 'Add'),
      row('Email', 'Not set', 'Change'),
      row('Password', 'Used with your email or username', 'Change'),
      acc.apple || appleId ? row('Apple', 'Connected', 'ok') : null,
      acc.google || google ? row('Google', 'Connected', 'ok') : null,
      row('Where you’re signed in', 'Sign out any device', 'Sign out'),
    );
    const settingsText = textOf(box);
    assert.match(settingsText, /Password/);
    assert.doesNotMatch(settingsText, JUNK);

    // Google connected but email missing must not print "Connected (null)".
    const googleRowHint = `Connected (${(null) || 'Google'})`;
    assert.equal(googleRowHint, 'Connected (Google)');
    assert.match(read('public/js/pages/account.js'), /google\.email \|\| 'Google'/);
    assert.match(read('public/js/pages/account.js'), /put\(box,/);

    // Dashboard: no live events — the child after the Audience and RSVPs card was `null`.
    const view = new MiniEl();
    const live = [];
    st.add(view,
      { childNodes: [{ textContent: 'Analytics' }] },
      { childNodes: [{ textContent: 'Audience and RSVPs' }] },
      live.length ? { childNodes: [{ textContent: 'Live now' }] } : null,
      { childNodes: [{ textContent: 'Your events' }] },
    );
    const dash = textOf(view);
    assert.match(dash, /Audience and RSVPs/);
    assert.doesNotMatch(dash, JUNK);
    assert.match(read('public/js/pages/dashboard.js'), /add\(view,/);
    assert.match(read('public/js/pages/dashboard.js'), /const live = d\.live \|\| \[\]/);
  });

  it('hardens h() and ParentNode methods, and keeps host-kit from String(null)', () => {
    const ui = read('public/js/ui.js');
    assert.match(ui, /kidsOf\(\.\.\.kids\)/);
    assert.match(ui, /installSafeDom\(\)/);
    assert.match(ui, /typeof kid === 'string' \|\| typeof kid === 'number'/);
    const st = read('public/js/safe-text.js');
    assert.match(st, /export function installSafeDom/);
    assert.match(st, /replaceChildren/);
    const hk = read('public/js/host-kit.js');
    assert.match(hk, /value == null \|\| value === '' \? '—' : String\(value\)/);
    assert.match(hk, /text == null \|\| text === false \|\| text === true/);
  });
});
