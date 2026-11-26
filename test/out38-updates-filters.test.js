'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const skip = !process.env.DATABASE_URL && process.env.DB_DRIVER !== 'sqlite' ? 'set DATABASE_URL or DB_DRIVER=sqlite' : false;

describe('out38 auto-update and marketplace filter icons', () => {
  it('cache versions are v89 / ?v=83', () => {
    assert.match(read('public/sw.js'), /VERSION = 'v97-2026-11-26'/);
    assert.match(read('public/index.html'), /app\.css\?v=83/);
    assert.match(read('public/index.html'), /app\.js\?v=83/);
    assert.match(read('public/index.html'), /name="app-version" content="v97-2026-11-26"/);
    assert.match(read('public/index.html'), /data-asset="75"/);
  });

  it('service worker still skipWaiting and clients.claim', () => {
    const sw = read('public/sw.js');
    assert.match(sw, /self\.skipWaiting\(\)/);
    assert.match(sw, /self\.clients\.claim\(\)/);
  });

  it('filterBar passes icon HTML via html: like Discover, not as text children', () => {
    const js = read('public/js/pages/discover.js');
    const bar = js.slice(js.indexOf('export function filterBar'), js.indexOf('export async function mount'));
    assert.match(bar, /html:\s*icon\(ico,\s*\{\s*size:\s*14\s*\}\)/);
    assert.match(bar, /html:\s*icon\('chevronDown',\s*\{\s*size:\s*12\s*\}\)/);
    assert.doesNotMatch(bar, /icon\(ico,\s*14\)/);
    assert.doesNotMatch(bar, /\},\s*ico \? icon\(/);
    const picker = js.slice(js.indexOf('export function filterPicker'), js.indexOf('export function filterBar'));
    assert.match(picker, /html:\s*icon\(/);
  });

  it('no icon\(\) HTML string is passed as an h\(\) or append child in public/js', () => {
    const dir = path.join(root, 'public/js');
    const bad = [];
    const walk = (d) => {
      for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, ent.name);
        if (ent.isDirectory()) walk(p);
        else if (ent.isFile() && ent.name.endsWith('.js')) {
          const t = fs.readFileSync(p, 'utf8');
          // icon(...) as a positional child of h(...): ", icon(" or "} , icon(" after props, not html:
          for (const [i, line] of t.split(/\n/).entries()) {
            if (/html:\s*icon\(/.test(line)) continue;
            if (/\bfrag\(\s*icon\(/.test(line) || /\bI\(\s*['"]/.test(line)) continue;
            if (/,\s*icon\([^)]*\)\s*[,)]/.test(line) && /h\(|append\(/.test(line)) {
              bad.push(`${path.relative(dir, p)}:${i + 1}: ${line.trim()}`);
            }
          }
        }
      }
    };
    walk(dir);
    assert.deepEqual(bad, [], bad.join('\n'));
  });

  it('Min/Max inputs stay Discover-style pills', () => {
    const market = read('public/js/pages/market.js');
    assert.match(market, /class: 'dz-num'/);
    assert.match(market, /dz-num-wrap/);
    const css = read('public/css/src/20-pages/market.css');
    assert.match(css, /\.dz-num-wrap\s*\{[^}]*height:\s*34px/s);
    assert.match(css, /\.mk-filters \.dz-dd \.dz-ic/);
    const dz = read('public/css/src/20-pages/discover.css');
    assert.match(dz, /\.dz-dd\s*\{[^}]*height:\s*34px/s);
  });

  it('client listens for SW updates, polls /api/version, and reloads safely', () => {
    const js = read('public/js/updates.js');
    assert.match(js, /serviceWorker\.register\('\/sw\.js'\)/);
    assert.match(js, /updatefound/);
    assert.match(js, /controllerchange/);
    assert.match(js, /reg\.update\(/);
    assert.match(js, /visibilitychange/);
    assert.match(js, /\/api\/version/);
    assert.match(js, /Update ready/);
    assert.match(js, /isUpdateBlocked/);
    assert.match(js, /applyPendingIfSafe/);
    assert.match(js, /reloadForImportError/);
    assert.match(js, /does not provide an export/);
    const app = read('public/js/app.js');
    assert.match(app, /initUpdates/);
    assert.match(app, /applyPendingIfSafe/);
    assert.match(app, /reloadForImportError/);
    assert.doesNotMatch(app, /navigator\.serviceWorker\.register\('\/sw\.js'\)/);
  });

  it('import map remaps every public/js module to the asset query', () => {
    const { injectShell, importMapJson, readBuild, moduleUrls } = require(path.join(root, 'src/lib/build'));
    const b = readBuild();
    assert.equal(b.version, 'v97-2026-11-26');
    assert.equal(b.asset, '75');
    const map = importMapJson();
    assert.equal(map.imports['/js/app.js'], '/js/app.js?v=83');
    assert.equal(map.imports['/js/material-sale.js'], '/js/material-sale.js?v=83');
    assert.equal(map.imports['/js/pages/market.js'], '/js/pages/market.js?v=83');
    assert.ok(moduleUrls().includes('/js/updates.js'));
    const html = injectShell(read('public/index.html'));
    assert.match(html, /"\/js\/material-sale\.js":"\/js\/material-sale\.js\?v=83"/);
    assert.match(html, /name="app-version" content="v97-2026-11-26"/);
  });

  it('GET /api/version and the served shell include the versioned import map', { skip }, async () => {
    const { boot, client } = require('./helpers/server');
    const s = await boot();
    try {
      const ver = await client(s.base).get('/api/version');
      assert.equal(ver.status, 200);
      assert.equal(ver.body.version, 'v97-2026-11-26');
      assert.equal(String(ver.body.asset), '75');
      const home = await fetch(s.base + '/', { headers: { 'Accept-Encoding': 'identity' } });
      assert.equal(home.status, 200);
      const html = await home.text();
      assert.match(html, /"\/js\/material-sale\.js":"\/js\/material-sale\.js\?v=83"/);
      assert.match(html, /"\/js\/pages\/market\.js":"\/js\/pages\/market\.js\?v=83"/);
      assert.match(html, /src="\/js\/app\.js\?v=83"/);
    } finally {
      await s.stop();
    }
  });
});
