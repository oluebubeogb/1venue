'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

describe('out36 marketplace filters, materials table, titles, seed', () => {
  it('command bar says Marketplace, not Explore', () => {
    const app = read('public/js/app.js');
    assert.match(app, /short: 'Marketplace'/);
    assert.match(app, /label: 'Marketplace'/);
    assert.doesNotMatch(app, /Explore marketplace/);
    assert.doesNotMatch(app, /short: 'Explore'/);
  });

  it('market page uses Discover-style filters and has no helper subtitle or host id', () => {
    const js = read('public/js/pages/market.js');
    assert.match(js, /filterBar/);
    assert.match(js, /from '\.\/discover\.js'/);
    assert.match(js, /All types/);
    assert.match(js, /Any payment/);
    assert.match(js, /data-lab': 'Min'/);
    assert.match(js, /data-lab': 'Max'/);
    assert.match(js, /mk-head/);
    assert.doesNotMatch(js, /platform keeps|host gets|Free and paid materials hosts have chosen to list/i);
    assert.doesNotMatch(js, /host user id|hostId|Host user/i);
    assert.doesNotMatch(js, />Filter</);
    assert.doesNotMatch(js, /<select/);
  });

  it('materials library is a striped table with mark, bulk actions, and lightbox thumbs', () => {
    const js = read('public/js/pages/materials.js');
    assert.match(js, /mat-lib-table/);
    assert.match(js, /mat-lib-mark/);
    assert.match(js, /Select all/);
    assert.match(js, /bulkList/);
    assert.match(js, /bulkPrice/);
    assert.match(js, /bulkDelete/);
    assert.match(js, /data-lightbox/);
    assert.match(js, /stopPropagation/);
    const css = read('public/css/src/20-pages/materials.css');
    assert.match(css, /nth-child\(odd\)/);
    assert.match(css, /nth-child\(even\)/);
    assert.match(css, /cursor: zoom-in/);
  });

  it('router sets a title for each path so a parked meeting cannot leak its code', () => {
    const app = read('public/js/app.js');
    assert.match(app, /export function setPageTitle/);
    assert.match(app, /export function titleForPath/);
    assert.match(app, /setPageTitle\(titleForPath\(path\)\)/);
    assert.match(app, /Marketplace/);
    assert.match(app, /Dashboard/);
    const session = read('public/js/room/session.js');
    assert.match(session, /document\.title = \(room\.code \? fmtCode\(room\.code\) : 'New room'\) \+ ' · 1venue'/);
    const { titleForPath } = evalTitles(app);
    assert.equal(titleForPath('/dashboard'), 'Dashboard');
    assert.equal(titleForPath('/market'), 'Marketplace');
    assert.equal(titleForPath('/materials'), 'Materials');
    assert.equal(titleForPath('/discover'), 'Discover');
    assert.equal(titleForPath('/y5yi87'), '1venue');
    assert.equal(titleForPath('/fau826'), '1venue');
    assert.equal(titleForPath('/r/abc123'), '1venue');
    assert.equal(titleForPath('/'), '1venue');
  });

  it('seed adds listed marketplace items for existing demo users', () => {
    const fix = read('src/features/seed/fixtures.js');
    assert.match(fix, /const MARKET = \[/);
    assert.match(fix, /Sunday Worship Chord Charts/);
    assert.match(fix, /adaeze/);
    assert.match(fix, /emeka/);
    const seed = read('src/features/seed/seed.js');
    assert.match(seed, /F\.MARKET/);
    assert.match(seed, /listed, category, for_sale, price_kobo/);
    const F = require(path.join(root, 'src/features/seed/fixtures.js'));
    assert.ok(F.MARKET.length >= 10);
    const owners = new Set(F.MARKET.map((row) => row[0]));
    for (const k of owners) assert.ok(F.USERS.some((u) => u.key === k), k + ' is a seed user');
    const kinds = new Set(F.MARKET.map((row) => row[2]));
    assert.ok(kinds.has('slides') && kinds.has('image'));
    assert.ok(F.MARKET.some((row) => row[4] == null) && F.MARKET.some((row) => row[4] > 0));
    const cats = new Set(F.MARKET.map((row) => row[3]));
    assert.ok(cats.size >= 5);
  });

  it('cache versions are v87 / ?v=83', () => {
    assert.match(read('public/sw.js'), /VERSION = 'v97-2026-11-26'/);
    assert.match(read('public/index.html'), /app\.css\?v=83/);
    assert.match(read('public/index.html'), /app\.js\?v=83/);
  });
});

function evalTitles(src) {
  const start = src.indexOf('const PAGE_TITLES = [');
  const end = src.indexOf('export async function route') !== -1 ? src.indexOf('async function route()') : -1;
  const fnStart = src.indexOf('export function titleForPath');
  const chunk = src.slice(start, src.indexOf('async function route()'));
  const js = chunk.replace('export function titleForPath', 'function titleForPath') + '\nexports.titleForPath = titleForPath;\n';
  const m = { exports: {} };
  // eslint-disable-next-line no-new-func
  Function('exports', js)(m.exports);
  return m.exports;
}
