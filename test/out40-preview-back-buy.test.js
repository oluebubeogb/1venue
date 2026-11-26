'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');

describe('out40 preview back link and buy on material page', () => {
  it('cache versions are v89 / ?v=83', () => {
    assert.match(read('public/sw.js'), /VERSION = 'v97-2026-11-26'/);
    assert.match(read('public/index.html'), /app\.css\?v=83/);
    assert.match(read('public/index.html'), /app\.js\?v=83/);
  });

  it('market and materials links pass from= and stash the return path', () => {
    const sale = read('public/js/material-sale.js');
    assert.match(sale, /export function resolveMaterialBack/);
    assert.match(sale, /export function stashMaterialReturn/);
    assert.match(sale, /export function materialOpenAttrs/);
    assert.match(sale, /\?from=\$\{from\}/);
    assert.match(read('public/js/pages/market.js'), /materialCard\(m, \{ from: 'market' \}\)/);
    assert.match(read('public/js/pages/market.js'), /syncMarketUrl/);
    assert.match(read('public/js/pages/market.js'), /takeMaterialReturnScroll\('\/market'\)/);
    const lib = read('public/js/pages/materials.js');
    assert.match(lib, /materialOpenAttrs\(m\.id, 'materials'\)/);
    assert.match(lib, /tab=purchased/);
    assert.match(lib, /takeMaterialReturnScroll\('\/materials'\)/);
  });

  it('material page back link follows from= or listed/owner fallback, and Buy unlocks in place', () => {
    const js = read('public/js/pages/material.js');
    assert.match(js, /resolveMaterialBack/);
    assert.match(js, /back\.label/);
    assert.match(js, /startBuy/);
    assert.match(js, /goLogin\(location\.pathname \+ location\.search\)/);
    assert.match(js, /buyLabel/);
    assert.match(js, /canBuy/);
    assert.doesNotMatch(js, /location\.reload/);
    assert.match(js, /onBought:[\s\S]*api\('\/api\/materials\/' \+ id\)[\s\S]*paint\(\)/);
    assert.doesNotMatch(js, /state\.user \? h\('a'[\s\S]*Materials/);
  });

  it('resolveMaterialBack prefers from= and stashed filters, else owner → Materials and listed → Marketplace', () => {
    const src = read('public/js/material-sale.js');
    const start = src.indexOf('export function resolveMaterialBack');
    const end = src.indexOf('export function materialOpenAttrs');
    assert.ok(start >= 0 && end > start);
    const fn = src.slice(start, end).replace('export function', 'function');
    const ctx = { module: { exports: {} }, URLSearchParams };
    vm.runInNewContext(fn + '\nmodule.exports = { resolveMaterialBack };', ctx);
    const { resolveMaterialBack } = ctx.module.exports;
    const listed = { listed: true, owner: false };
    const owner = { listed: true, owner: true, canEdit: true };
    const same = (a, b) => assert.equal(JSON.stringify(a), JSON.stringify(b));
    const stashM = { id: 3, href: '/market?q=psalm&type=document', label: 'Marketplace', scroll: 240 };
    same(resolveMaterialBack(listed, { id: 3, search: '?from=market', stashed: stashM }), { href: '/market?q=psalm&type=document', label: 'Marketplace', scroll: 240 });
    const stashL = { id: 8, href: '/materials?tab=purchased', label: 'Materials', scroll: 12 };
    same(resolveMaterialBack(owner, { id: 8, search: '?from=materials', stashed: stashL }), { href: '/materials?tab=purchased', label: 'Materials', scroll: 12 });
    same(resolveMaterialBack(owner, { id: 1, search: '', stashed: null }), { href: '/materials', label: 'Materials' });
    same(resolveMaterialBack(listed, { id: 2, search: '', stashed: null }), { href: '/market', label: 'Marketplace' });
    same(resolveMaterialBack({ listed: false, owner: false }, { id: 4, search: '', stashed: null }), { href: '/materials', label: 'Materials' });
  });
});
