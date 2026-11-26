'use strict';
const { describe, it, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const skip = !process.env.DATABASE_URL && process.env.DB_DRIVER !== 'sqlite' ? 'set DATABASE_URL or DB_DRIVER=sqlite' : false;

describe('out37 seed reload, promotions types, marketplace card and cart', () => {
  it('demo reset no longer calls the user-facing account-deletion guard', () => {
    const seed = read('src/features/seed/seed.js');
    assert.match(seed, /purgeSeedFinance/);
    assert.match(seed, /DELETE FROM credit_ledger/);
    assert.match(seed, /DELETE FROM material_purchases/);
    assert.match(seed, /DELETE FROM credit_wallets/);
    assert.doesNotMatch(seed, /require\('\.\.\/wallet\/data'\)\.assertCanDelete/);
    assert.match(read('src/features/wallet/data.js'), /Resolve your credit balance and unfinished purchases/);
    assert.match(read('src/features/auth/deletion.js'), /assertCanDelete/);
  });

  it('promotions queries cast parameters and do not leave an unused \$1', () => {
    const js = read('src/features/promotions/data.js');
    assert.match(js, /\$\{params\.length\}::text = ANY\(p\.placements\)/);
    assert.match(js, /\$1::text = ANY\(p\.placements\)/);
    assert.match(js, /params\.push\(ownerId\)/);
    assert.match(js, /LIMIT \$\$\{params\.length\}::int/);
    assert.doesNotMatch(js, /const params = \[ownerId\]/);
  });

  it('exports materialCard and uses a cart icon for Marketplace', () => {
    assert.match(read('public/js/material-sale.js'), /export function materialCard/);
    assert.match(read('public/js/pages/market.js'), /import \{ materialCard \}/);
    assert.match(read('public/js/icons.js'), /\bcart:/);
    const app = read('public/js/app.js');
    assert.match(app, /id: 'market'[\s\S]*icon: 'cart'/);
    assert.doesNotMatch(app, /id: 'market'[\s\S]*icon: 'grid'/);
    assert.match(read('public/js/pages/market.js'), /icon\('cart'\)/);
    assert.doesNotMatch(read('public/js/pages/market.js'), /icon\('grid'\)/);
    assert.match(read('public/sw.js'), /VERSION = 'v97-2026-11-26'/);
    assert.match(read('public/index.html'), /app\.css\?v=83/);
    assert.match(read('public/index.html'), /app\.js\?v=83/);
  });

  it('named ESM imports in public/js all resolve to an export', () => {
    const r = spawnSync(process.execPath, [path.join(root, 'scripts/check-esm-exports.js')], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /check:esm-exports ok/);
  });
});

test('reloading demo data works after seed users have credits; the delete guard still blocks real users', { skip, timeout: 120000 }, async () => {
  const { boot, client, signupPayload } = require('./helpers/server');
  const admin = signupPayload();
  const s = await boot({ ADMIN_EMAILS: admin.email });
  const db = require('../db');
  try {
    const c = client(s.base);
    assert.ok([200, 201].includes((await c.post('/api/signup', admin)).status));
    const tokenOf = (link) => new URL(link).searchParams.get('token');
    const link = await s.mailLink(admin.email, /Confirm your email/);
    assert.equal((await c.post('/api/auth/verify-email', { token: tokenOf(link) })).status, 200);

    const loaded = await c.post('/api/admin/seed');
    assert.equal(loaded.status, 200, JSON.stringify(loaded.body));
    const seedUser = (await db.q('SELECT id FROM users WHERE is_seed ORDER BY id LIMIT 1')).rows[0];
    assert.ok(seedUser);
    const units = 60 * 60000;
    await db.q('INSERT INTO credit_wallets(user_id,balance_units) VALUES($1,$2) ON CONFLICT (user_id) DO UPDATE SET balance_units=$2', [seedUser.id, units]);
    await db.q("INSERT INTO credit_ledger(user_id,kind,delta_units,balance_after_units) VALUES($1,'welcome',$2,$2) ON CONFLICT DO NOTHING", [seedUser.id, units]);
    const mat = (await db.q("SELECT id FROM materials WHERE owner_user_id=$1 LIMIT 1", [seedUser.id])).rows[0];
    if (mat) {
      await db.q("INSERT INTO material_purchases(material_id,user_id,paid_with,price_kobo,fee_kobo) VALUES($1,$2,'credits',10000,0) ON CONFLICT DO NOTHING", [mat.id, seedUser.id]);
    }

    const reloaded = await c.post('/api/admin/seed');
    assert.equal(reloaded.status, 200, JSON.stringify(reloaded.body));
    assert.equal(reloaded.body.users, 10);

    const me = (await c.get('/api/session')).body.user;
    await db.tx(async (txc) => {
      await assert.rejects(
        () => require('../src/features/wallet/data').assertCanDelete(txc, me.id),
        (e) => e && e.status === 409 && /Resolve your credit balance/.test(e.message),
      );
    });

    const promo = require('../src/features/promotions/data');
    const rows = await promo.liveForProfile(me.id, { limit: 2, viewerId: me.id });
    assert.ok(Array.isArray(rows));
  } finally {
    await require('../src/features/seed/seed').remove().catch(() => {});
    await s.stop();
    await db.close().catch(() => {});
  }
});
