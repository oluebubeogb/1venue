'use strict';
const { describe, it, test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const skip = process.env.DB_DRIVER !== 'sqlite' && !process.env.DATABASE_URL ? 'set DATABASE_URL or DB_DRIVER=sqlite' : false;
if (process.env.DB_DRIVER === 'sqlite') require('./helpers/server');

describe('out39 marketplace materials can be opened', () => {
  it('cache versions are v89 / ?v=83', () => {
    assert.match(read('public/sw.js'), /VERSION = 'v97-2026-11-26'/);
    assert.match(read('public/index.html'), /app\.css\?v=83/);
    assert.match(read('public/index.html'), /app\.js\?v=83/);
  });

  it('viewableMaterial allows listed marketplace items, not only event attachments', () => {
    const js = read('src/features/materials/data.js');
    const fn = js.slice(js.indexOf('async function viewableMaterial'), js.indexOf('function analysisOut'));
    assert.match(fn, /m\.listed = TRUE/);
    assert.match(fn, /event_materials/);
    assert.match(fn, /withAccess/);
  });
});

test('listed free and paid materials open for anonymous and signed-in non-owners', { skip, timeout: 60000 }, async () => {
  const { boot, client, signupPayload } = require('./helpers/server');
  const db = require('../db');
  const { UNITS_PER_CREDIT: U, PRICE_PER_CREDIT_KOBO } = require('../src/features/wallet/rules');
  const s = await boot({ BILLING_WORKER: 'false', REMINDER_WORKER: 'false', REPLAY_WORKER: 'false' });
  try {
    const host = client(s.base);
    const buyer = client(s.base);
    const anon = client(s.base);
    await host.post('/api/signup', signupPayload());
    await buyer.post('/api/signup', signupPayload());
    const hid = (await host.get('/api/session')).body.user.id;
    const bid = (await buyer.get('/api/session')).body.user.id;
    await db.q('INSERT INTO credit_wallets(user_id,balance_units) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET balance_units=$2', [bid, 30 * U]);

    const pages = ['https://example.com/p1.png', 'https://example.com/p2.png'];
    const free = (await db.q(
      "INSERT INTO materials(owner_user_id,title,kind,payload,listed,category,for_sale,price_kobo) VALUES($1,'Free notes','slides',$2,TRUE,'Study',FALSE,NULL) RETURNING id",
      [hid, JSON.stringify({ pages })]
    )).rows[0];
    const paid = (await db.q(
      "INSERT INTO materials(owner_user_id,title,kind,payload,listed,category,for_sale,price_kobo) VALUES($1,'Paid deck','slides',$2,TRUE,'Teaching',TRUE,$3) RETURNING id",
      [hid, JSON.stringify({ pages }), PRICE_PER_CREDIT_KOBO]
    )).rows[0];
    const hidden = (await db.q(
      "INSERT INTO materials(owner_user_id,title,kind,payload,listed,category) VALUES($1,'Private deck','slides',$2,FALSE,'Study') RETURNING id",
      [hid, JSON.stringify({ pages })]
    )).rows[0];

    // Unlisted stays private
    assert.equal((await anon.get(`/api/materials/${hidden.id}`)).status, 401);
    assert.equal((await buyer.get(`/api/materials/${hidden.id}`)).status, 404);
    assert.equal((await host.get(`/api/materials/${hidden.id}`)).status, 200);

    // Free listed: public preview is the full material
    for (const c of [anon, buyer]) {
      const r = await c.get(`/api/materials/${free.id}`);
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.equal(r.body.locked, false);
      assert.equal(r.body.canEdit, false);
      assert.deepEqual(r.body.payload.pages, pages);
    }
    const ownFree = await host.get(`/api/materials/${free.id}`);
    assert.equal(ownFree.status, 200);
    assert.equal(ownFree.body.canEdit, true);
    assert.equal(ownFree.body.locked, false);

    // Paid listed: preview (first page) until purchase, then full
    for (const c of [anon, buyer]) {
      const r = await c.get(`/api/materials/${paid.id}`);
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.equal(r.body.locked, true);
      assert.equal(r.body.forSale, true);
      assert.deepEqual(r.body.payload.pages, [pages[0]]);
      assert.equal(r.body.payload.pages.length, 1);
    }
    const buy = await buyer.post(`/api/materials/${paid.id}/buy`, { method: 'credits' });
    assert.equal(buy.status, 200, JSON.stringify(buy.body));
    const after = await buyer.get(`/api/materials/${paid.id}`);
    assert.equal(after.status, 200);
    assert.equal(after.body.locked, false);
    assert.equal(after.body.purchased, true);
    assert.deepEqual(after.body.payload.pages, pages);
    const stillLocked = await anon.get(`/api/materials/${paid.id}`);
    assert.equal(stillLocked.status, 200);
    assert.equal(stillLocked.body.locked, true);
    assert.deepEqual(stillLocked.body.payload.pages, [pages[0]]);
  } finally {
    await s.stop();
  }
});
