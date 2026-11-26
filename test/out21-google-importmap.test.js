'use strict';
const { readFileSync } = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { describe, it } = require('node:test');

const root = path.join(__dirname, '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');

describe('out21 Google button: one app.js module instance', () => {
  it('maps /js/app.js to the cache-busted entry so login shares the booted state', () => {
    const html = read('public/index.html');
    const src = html.match(/src="(\/js\/app\.js\?v=\d+)"/);
    assert.ok(src, 'app.js script src with ?v=');
    const mapped = html.match(/<script type="importmap">\s*\{\s*"imports":\s*\{\s*"\/js\/app\.js":\s*"(\/js\/app\.js\?v=\d+)"/);
    assert.ok(mapped, 'import map for /js/app.js');
    assert.equal(mapped[1], src[1], 'import map must point at the same URL as the entry script');
    // the map must come before the module entry
    assert.ok(html.indexOf('type="importmap"') < html.indexOf('src="' + src[1] + '"'));
  });

  it('bumps the cache versions', () => {
    assert.match(read('public/sw.js'), /VERSION = 'v97-2026-11-26'/);
    assert.match(read('public/index.html'), /app\.css\?v=83/);
    assert.match(read('public/index.html'), /app\.js\?v=83/);
  });
});
