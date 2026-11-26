'use strict';
const { createServer } = require('node:http');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { describe, it, test } = require('node:test');

const root = path.join(__dirname, '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const skip = process.env.DB_DRIVER !== 'sqlite' && !process.env.DATABASE_URL ? 'set DATABASE_URL or DB_DRIVER=sqlite' : false;
// Pin SQLITE_PATH before any module opens the default local file.
if (process.env.DB_DRIVER === 'sqlite') require('./helpers/server');

describe('out34 materials buy, purchased tab, gifts', () => {
  it('exports commerce.initialize', () => {
    const c = require('../src/features/commerce/service');
    assert.equal(typeof c.initialize, 'function');
    assert.equal(typeof c.donateCredits, 'function');
  });

  it('removes 80% and platform-keeps copy', () => {
    const sale = read('public/js/material-sale.js');
    const create = read('public/js/pages/create.js');
    const wallet = read('public/js/pages/wallet.js');
    assert.doesNotMatch(sale, /platform keeps/i);
    assert.doesNotMatch(sale, /the rest goes to the host/i);
    assert.doesNotMatch(create, /80%/);
    assert.doesNotMatch(wallet, /80%/);
    assert.doesNotMatch(create, /You receive 80/);
    assert.doesNotMatch(wallet, /Your share is 80/);
  });

  it('adds a Purchased tab, Open after buy, and a credit gift sheet', () => {
    const mats = read('public/js/pages/materials.js');
    assert.match(mats, /filter=purchased/);
    assert.match(mats, /Purchased/);
    const sale = read('public/js/material-sale.js');
    assert.match(sale, /label: 'Open'/);
    assert.match(read('public/js/gift.js'), /method === 'credits'/);
    assert.match(read('public/js/pages/event.js'), /openGiftSheet/);
    assert.match(read('public/js/room/room.js'), /r-gift/);
    assert.match(read('public/js/app.js'), /claimCommerceReturn/);
  });

  it('bumps the cache versions', () => {
    assert.match(read('public/sw.js'), /VERSION = 'v97-2026-11-26'/);
    assert.match(read('public/index.html'), /app\.css\?v=83/);
    assert.match(read('public/index.html'), /app\.js\?v=83/);
  });
});

test('material card buy starts Paystack checkout', { skip, timeout: 60000 }, async () => {
  const { boot, client, signupPayload } = require('./helpers/server');
  const db = require('../db');
  const { PRICE_PER_CREDIT_KOBO } = require('../src/features/wallet/rules');
  const secretKey = 'sk_test_fixture';
  let initialized = 0;
  const gateway = createServer((req, res) => {
    const reply = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      let b = {}; try { b = JSON.parse(raw || '{}'); } catch {}
      if (req.url === '/transaction/initialize') {
        initialized++;
        return reply(200, { status: true, data: { reference: b.reference, authorization_url: `https://checkout.paystack.com/${b.reference}`, access_code: 'x' } });
      }
      reply(404, { status: false });
    });
  });
  await new Promise((r) => gateway.listen(0, '127.0.0.1', r));
  const apiUrl = `http://127.0.0.1:${gateway.address().port}`;
  const s = await boot({
    PAYSTACK_SECRET_KEY: secretKey,
    PAYSTACK_PASS_FEES_CONFIRMED: 'true',
    PAYSTACK_API_URL: apiUrl,
    BILLING_WORKER: 'false',
    REMINDER_WORKER: 'false',
    REPLAY_WORKER: 'false',
  });
  try {
    const host = client(s.base);
    const buyer = client(s.base);
    await host.post('/api/signup', signupPayload());
    await buyer.post('/api/signup', signupPayload());
    const hid = (await host.get('/api/session')).body.user.id;
    const created = await host.post('/api/materials', { title: 'Deck', kind: 'image', payload: { url: 'https://example.com/x.png' } });
    let mid;
    if (created.status < 300 && created.body && created.body.id) mid = created.body.id;
    else {
      const row = (await db.q("INSERT INTO materials(owner_user_id,title,kind,payload) VALUES($1,'Deck','slides',$2) RETURNING id", [hid, JSON.stringify({ pages: ['https://example.com/p.png'] })])).rows[0];
      mid = row.id;
    }
    const sale = await host.post(`/api/materials/${mid}/sale`, { forSale: true, priceKobo: Math.max(5000, PRICE_PER_CREDIT_KOBO * 5), callDiscountPct: 0 });
    assert.equal(sale.status, 200, JSON.stringify(sale.body));
    const buy = await buyer.post(`/api/materials/${mid}/buy`, { method: 'paystack' });
    assert.equal(buy.status, 200, JSON.stringify(buy.body) + ' ' + s.output());
    assert.ok(buy.body.authorizationUrl && buy.body.authorizationUrl.includes('checkout.paystack.com'), JSON.stringify(buy.body));
    assert.equal(buy.body.kind, 'material');
    assert.equal(buy.body.materialId, Number(mid));
    assert.ok(initialized >= 1, 'Paystack initialize should be called');
  } finally {
    await s.stop();
    await new Promise((r) => gateway.close(r));
  }
});

test('purchased materials list and credit gifts', { skip, timeout: 60000 }, async () => {
  const { boot, client, signupPayload } = require('./helpers/server');
  const db = require('../db');
  const { UNITS_PER_CREDIT: U, PRICE_PER_CREDIT_KOBO } = require('../src/features/wallet/rules');
  const s = await boot({ BILLING_WORKER: 'false', REMINDER_WORKER: 'false', REPLAY_WORKER: 'false' });
  try {
    const host = client(s.base);
    const buyer = client(s.base);
    await host.post('/api/signup', signupPayload());
    await buyer.post('/api/signup', signupPayload());
    const hid = (await host.get('/api/session')).body.user.id;
    const bid = (await buyer.get('/api/session')).body.user.id;
    await db.q('INSERT INTO credit_wallets(user_id,balance_units) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET balance_units=$2', [bid, 30 * U]);

    const created = await host.post('/api/materials', { title: 'Deck', kind: 'image', payload: { url: 'https://example.com/x.png' } });
    let mid;
    if (created.status < 300 && created.body && created.body.id) mid = created.body.id;
    else {
      const row = (await db.q("INSERT INTO materials(owner_user_id,title,kind,payload) VALUES($1,'Deck','slides',$2) RETURNING id", [hid, JSON.stringify({ pages: ['https://example.com/p.png'] })])).rows[0];
      mid = row.id;
    }
    assert.equal((await host.post(`/api/materials/${mid}/sale`, { forSale: true, priceKobo: Math.max(5000, PRICE_PER_CREDIT_KOBO * 5), callDiscountPct: 0 })).status, 200);
    assert.equal((await buyer.get('/api/materials?filter=purchased')).body.materials.length, 0);
    const buy = await buyer.post(`/api/materials/${mid}/buy`, { method: 'credits' });
    assert.equal(buy.status, 200, JSON.stringify(buy.body));
    const purchased = (await buyer.get('/api/materials?filter=purchased')).body.materials;
    assert.equal(purchased.length, 1);
    assert.equal(Number(purchased[0].id), Number(mid));
    assert.equal(purchased[0].purchased, true);
    assert.equal(purchased[0].locked, false);
    const open = await buyer.get(`/api/materials/${mid}`);
    assert.equal(open.status, 200);
    assert.equal(open.body.locked, false);

    await db.q("INSERT INTO subscriptions (user_id, plan, billing_interval, status, source) VALUES ($1, 'organisation', 'month', 'comp', 'admin')", [hid]);
    const ev = await host.post('/api/events', { title: 'Gift night', category: 'seminar', visibility: 'public', startsAt: new Date(Date.now() + 2 * 864e5).toISOString() });
    assert.ok(ev.status < 300, JSON.stringify(ev.body) + ' ' + s.output());
    const eid = ev.body.id || (ev.body.event && ev.body.event.id);
    assert.ok(eid, JSON.stringify(ev.body));
    const plans = require('../src/lib/plans');
    const feeBps = plans.platform(await plans.getSettings()).feeBps;
    const before = Number((await db.q('SELECT balance_units FROM credit_wallets WHERE user_id=$1', [bid])).rows[0].balance_units);
    const hostBefore = Number((await db.q('SELECT COALESCE(balance_units,0) AS b FROM credit_wallets WHERE user_id=$1', [hid])).rows[0]?.b || 0);
    const gift = await buyer.post(`/api/events/${eid}/donate`, { method: 'credits', credits: 10 });
    assert.ok(gift.status === 201 || gift.status === 200, JSON.stringify(gift.body) + ' ' + s.output());
    assert.equal(gift.body.credits, 10);
    const after = Number((await db.q('SELECT balance_units FROM credit_wallets WHERE user_id=$1', [bid])).rows[0].balance_units);
    assert.equal(after, before - 10 * U);
    const hostWallet = Number((await db.q('SELECT balance_units FROM credit_wallets WHERE user_id=$1', [hid])).rows[0].balance_units);
    const splitUnits = plans.feeSplit(10 * U, feeBps);
    assert.equal(hostWallet, hostBefore + splitUnits.net);
    const led = (await db.q("SELECT kind, delta_units FROM credit_ledger WHERE user_id IN ($1,$2) AND kind='gift' ORDER BY id", [bid, hid])).rows;
    assert.equal(led.length, 2);
    const hostLedger = (await db.q("SELECT net_kobo FROM host_ledger WHERE host_user_id=$1 AND kind='donation' ORDER BY id DESC LIMIT 1", [hid])).rows[0];
    const splitKobo = plans.feeSplit(10 * PRICE_PER_CREDIT_KOBO, feeBps);
    assert.equal(Number(hostLedger.net_kobo), splitKobo.net);
    const self = await host.post(`/api/events/${eid}/donate`, { method: 'credits', credits: 10 });
    assert.equal(self.status, 400);
    const poor = await buyer.post(`/api/events/${eid}/donate`, { method: 'credits', credits: 99999 });
    assert.equal(poor.status, 402);
  } finally { await s.stop(); }
});
