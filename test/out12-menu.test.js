import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const root = new URL('..', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');

describe('out12 account menu', () => {
  it('has no striped account-menu tints', () => {
    const css = read('public/css/src/10-components/modals.css');
    assert.doesNotMatch(css, /\.menu\.menu-account/);
    assert.doesNotMatch(css, /nth-of-type\(odd\)/);
    assert.doesNotMatch(read('public/js/app.js'), /menu-account/);
    assert.match(read('public/css/app.css'), /html\.menu-lock/);
  });

  it('mobile sheet can scroll and locks the page behind it', () => {
    const css = read('public/css/src/10-components/modals.css');
    assert.match(css, /\.menu\.menu-sheet \{[^}]*max-height: min\(88dvh,/s);
    assert.match(css, /\.menu\.menu-sheet \{[^}]*overflow-y: auto/s);
    assert.match(css, /\.menu\.menu-sheet \{[^}]*-webkit-overflow-scrolling: touch/s);
    assert.match(css, /\.menu\.menu-sheet \{[^}]*overscroll-behavior: contain/s);
    assert.match(css, /html\.menu-lock,\s*html\.menu-lock body \{[^}]*overflow: hidden/s);
    const ui = read('public/js/ui.js');
    assert.match(ui, /classList\.add\('menu-lock'\)/);
    assert.match(ui, /classList\.remove\('menu-lock'\)/);
    assert.match(ui, /body\.style\.top = `-\$\{lockedY\}px`/);
    assert.match(ui, /window\.scrollTo\(0, lockedY\)/);
    assert.match(ui, /unlockPage\(\); remove\(\)/);
  });

  it('dismisses a downward swipe and preserves scrolling inside the sheet', () => {
    const src = read('public/js/ui.js');
    const start = src.indexOf('export function swipeToClose');
    const end = src.indexOf('let sheetStack', start);
    const swipeToClose = new Function(src.slice(start, end).replace('export ', '') + 'return swipeToClose;')();
    const events = {};
    const panel = {
      ownerDocument: { defaultView: {} }, style: {}, scrollTop: 0,
      contains: () => true, addEventListener: (name, fn) => { events[name] = fn; },
    };
    const content = { closest: () => null, parentElement: panel, scrollTop: 40 };
    const grip = { closest: () => null, contains: (target) => target === grip };
    let dismissed = 0;
    let stoppedScroll = 0;
    swipeToClose(panel, () => dismissed++, { grip });
    const touch = (target, x, y) => ({
      target, touches: [{ clientX: x, clientY: y }], cancelable: true,
      preventDefault: () => stoppedScroll++,
    });
    events.touchstart(touch(content, 0, 0));
    events.touchmove(touch(content, 0, 120));
    events.touchend();
    assert.equal(dismissed, 0);
    assert.equal(stoppedScroll, 0);
    content.scrollTop = 0;
    events.touchstart(touch(content, 0, 150));
    events.touchmove(touch(content, 0, 20));
    events.touchend();
    assert.equal(dismissed, 0);
    assert.equal(stoppedScroll, 0);
    panel.scrollTop = 40;
    events.touchstart(touch(grip, 0, 0));
    events.touchmove(touch(grip, 0, 120));
    assert.equal(panel.style.translate, '0 120px');
    events.touchcancel();
    assert.equal(panel.style.translate, '');
    events.touchstart(touch(grip, 0, 0));
    events.touchmove(touch(grip, 0, 120));
    events.touchend();
    assert.equal(dismissed, 1);
  });

  it('bumps the cache versions', () => {
    assert.match(read('public/sw.js'), /VERSION = 'v97-2026-11-26'/);
    assert.match(read('public/index.html'), /app\.css\?v=83/);
  });
});
