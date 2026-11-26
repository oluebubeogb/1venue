import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const root = new URL('..', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');

describe('out13 profile promoted card spacing', () => {
  it('gives promoted tiles a consistent at-rest gap', () => {
    const css = read('public/css/src/20-pages/profile.css');
    assert.match(css, /\.profile-promo-tiles \{[^}]*display: flex/s);
    assert.match(css, /\.profile-promo-tiles \{[^}]*gap: 0\.875rem/s);
    assert.match(css, /\.profile-promo-tiles > \.ev-tile,\s*\.profile-promo-tiles > \.promo-card,\s*\.profile-promo-tiles > \.card \{[^}]*margin: 0/s);
    assert.match(read('public/css/src/10-components/promoted.css'), /\.promo-inline-rows \{[^}]*gap: 0\.875rem/s);
    assert.doesNotMatch(read('public/css/src/10-components/promoted.css'), /gap: 0\.1rem/);
    assert.match(read('public/css/app.css'), /\.profile-promo-tiles \{[^}]*gap: 0\.875rem/s);
  });

  it('bumps the cache versions', () => {
    assert.match(read('public/sw.js'), /VERSION = 'v97-2026-11-26'/);
    assert.match(read('public/index.html'), /app\.css\?v=83/);
  });
});
