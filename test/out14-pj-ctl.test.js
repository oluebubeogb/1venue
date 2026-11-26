import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const root = new URL('..', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');

describe('out14 prejoin preview toggles', () => {
  it('uses theme shades for the control bar and on/off states', () => {
    const css = read('public/css/room.css');
    const ctl = css.match(/\.pj-ctl \{[^}]+\}/s)[0];
    assert.match(ctl, /color-mix\(in srgb, var\(--accent\) 16%/);
    assert.match(ctl, /backdrop-filter: blur/);
    const on = css.match(/\.pj-btn \{[^}]+\}/s)[0];
    assert.match(on, /var\(--accent\) 20%, var\(--s1\)/);
    assert.match(on, /var\(--accent\) 80%, var\(--text\)/);
    const off = css.match(/\.pj-btn\.off \{[^}]+\}/s)[0];
    assert.match(off, /var\(--accent\) 82%/);
    assert.match(off, /var\(--accent\) 22%, #fff/);
    assert.doesNotMatch(off, /#e11d48|#f43f5e|red/i);
    assert.match(css, /\.pj-btn:hover,\s*\.pj-btn:focus-visible \{[^}]*box-shadow: 0 0 0 3px color-mix\(in srgb, var\(--accent\)/s);
    const room = read('public/js/room/room.js');
    assert.match(room, /micOff/);
    assert.match(room, /videoOff/);
    assert.match(room, /volumeOff/);
  });

  it('bumps the cache versions', () => {
    assert.match(read('public/sw.js'), /VERSION = 'v97-2026-11-26'/);
    assert.match(read('public/index.html'), /room\.css\?v=20/);
  });
});
