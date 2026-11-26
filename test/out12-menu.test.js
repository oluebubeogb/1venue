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
    assert.match(css, /\.menu\.menu-sheet \{[^}]*max-height: calc\(100dvh - env\(safe-area-inset-top, 0px\) - env\(safe-area-inset-bottom, 0px\)\)/s);
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

  it('bumps the cache versions', () => {
    assert.match(read('public/sw.js'), /VERSION = 'v97-2026-11-26'/);
    assert.match(read('public/index.html'), /app\.css\?v=83/);
  });
});
