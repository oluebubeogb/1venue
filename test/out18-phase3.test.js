'use strict';
const { readFileSync } = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { describe, it, test } = require('node:test');

const root = path.join(__dirname, '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const skip = process.env.DB_DRIVER !== 'sqlite' && !process.env.DATABASE_URL ? 'set DATABASE_URL or DB_DRIVER=sqlite' : false;
if (process.env.DB_DRIVER === 'sqlite') require('./helpers/server');

describe('out18 gift note, materials, certs, perks, pip', () => {
  it('removes the gift helper note and keeps currency affixes', () => {
    const ev = read('public/js/pages/event.js');
    const gift = read('public/js/gift.js');
    assert.match(gift, /gift-cur-prefix/);
    assert.match(gift, /gift-cur-suffix/);
    assert.match(ev, /openGiftSheet/);
    assert.doesNotMatch(ev, /real money/);
    assert.doesNotMatch(ev, /not wallet credits/);
    assert.doesNotMatch(ev, /processing fee is added at checkout/);
    assert.doesNotMatch(gift, /real money/);
  });

  it('suggests VIP perks from name and price rank', () => {
    const { suggestPerks, earlyEntryBlock, EARLY_MS } = require('../src/features/commerce/perks');
    const [vip, mid, free] = suggestPerks([
      { name: 'VIP', priceKobo: 200000 },
      { name: 'Regular', priceKobo: 50000 },
      { name: 'Free', priceKobo: 0 },
    ]);
    assert.equal(vip.badge && vip.skipWaitingRoom && vip.priorityQa && vip.earlyEntry && vip.backstage, true);
    assert.equal(mid.badge, true);
    assert.equal(mid.backstage, false);
    assert.equal(free.badge, false);
    const start = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const ev = { starts_at: start };
    assert.ok(earlyEntryBlock(ev, { perks: {} }));
    assert.equal(earlyEntryBlock(ev, { isHost: true, perks: {} }), null);
    const soon = { starts_at: new Date(Date.now() + EARLY_MS / 2).toISOString() };
    assert.equal(earlyEntryBlock(soon, { perks: { earlyEntry: true } }), null);
    assert.ok(earlyEntryBlock(soon, { perks: {} }));
  });

  it('applies a live-only call discount and a 20% materials fee default', () => {
    const { promoPrice } = require('../src/features/materials/sale');
    const { PLATFORM_KEYS } = require('../src/lib/plans');
    assert.equal(promoPrice(10000, 50, true), 5000);
    assert.equal(promoPrice(10000, 50, false), 10000);
    assert.equal(PLATFORM_KEYS.materialsFeeBps[0], 2000);
  });

  it('builds a PDF for each certificate design', async () => {
    const { certificatePdf } = require('../src/features/certificates/pdf');
    for (const design of ['classic', 'modern', 'minimal', 'elegant']) {
      const buf = await certificatePdf({ name: 'Ada Lovelace', title: 'Music as Inner Peace', date: '1 January 2026', host: 'Host', code: 'ABCDE12345', url: 'https://1venue.live/cert/ABCDE12345', accent: '#7c3aed', design });
      assert.ok(buf.length > 200);
      assert.equal(buf.subarray(0, 5).toString(), '%PDF-');
    }
  });

  it('wires user-menu fullscreen and pop-out, and auto perk toggles', () => {
    const app = read('public/js/app.js');
    assert.match(app, /Pop out 1venue/);
    assert.match(app, /toggleFullscreen/);
    assert.match(app, /app-pip\.js/);
    assert.match(app, /pages\/cert\.js/);
    const host = read('public/js/pages/host.js');
    assert.match(host, /Skip the waiting room/);
    assert.match(host, /perks/);
    const tools = read('public/js/room/tools.js');
    assert.match(tools, /material-offer/);
    assert.match(tools, /material-overlay/);
    assert.match(tools, /certs/);
    assert.match(read('public/js/pages/create.js'), /certEditor/);
    assert.match(read('public/js/pages/materials.js'), /mat-lib-table|saleEditor/);
  });

  it('bumps the cache versions', () => {
    assert.match(read('public/sw.js'), /VERSION = 'v97-2026-11-26'/);
    assert.match(read('public/index.html'), /app\.css\?v=83/);
    assert.match(read('public/index.html'), /app\.js\?v=83/);
  });
});

test('material credit purchase, 20% host cut, and certificate dedupe', { skip, timeout: 60000 }, async () => {
  const { boot, client, signupPayload } = require('./helpers/server');
  const db = require('../db');
  const { UNITS_PER_CREDIT: U, PRICE_PER_CREDIT_KOBO } = require('../src/features/wallet/rules');
  const s = await boot();
  try {
    const host = client(s.base);
    const buyer = client(s.base);
    await host.post('/api/signup', signupPayload());
    await buyer.post('/api/signup', signupPayload());
    const hid = (await host.get('/api/session')).body.user.id;
    const bid = (await buyer.get('/api/session')).body.user.id;
    await db.q('INSERT INTO credit_wallets(user_id,balance_units) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET balance_units=$2', [bid, 30 * U]);
    const created = await host.post('/api/materials', { title: 'Deck', kind: 'image', payload: { url: 'https://example.com/x.png' } });
    // image payload may reject non-stored url — fall back to a pdf-less path via SQL
    let mid;
    if (created.status < 300 && created.body && created.body.id) mid = created.body.id;
    else {
      const row = (await db.q("INSERT INTO materials(owner_user_id,title,kind,payload) VALUES($1,'Deck','slides',$2) RETURNING id", [hid, JSON.stringify({ pages: ['https://example.com/p.png'] })])).rows[0];
      mid = row.id;
    }
    const sale = await host.post(`/api/materials/${mid}/sale`, { forSale: true, priceKobo: PRICE_PER_CREDIT_KOBO, callDiscountPct: 0 });
    assert.equal(sale.status, 200, JSON.stringify(sale.body));
    const before = (await db.q('SELECT balance_units FROM credit_wallets WHERE user_id=$1', [bid])).rows[0];
    const buy = await buyer.post(`/api/materials/${mid}/buy`, { method: 'credits' });
    assert.equal(buy.status, 200, JSON.stringify(buy.body) + ' ' + s.output());
    assert.equal(buy.body.feeKobo, Math.round(PRICE_PER_CREDIT_KOBO * 0.2));
    const after = (await db.q('SELECT balance_units FROM credit_wallets WHERE user_id=$1', [bid])).rows[0];
    assert.equal(Number(after.balance_units), Number(before.balance_units) - U);
    const ledger = (await db.q("SELECT COALESCE(SUM(net_kobo),0) AS n FROM host_ledger WHERE host_user_id=$1 AND kind='sale'", [hid])).rows[0];
    assert.equal(Number(ledger.n), PRICE_PER_CREDIT_KOBO - Math.round(PRICE_PER_CREDIT_KOBO * 0.2));
    const again = await buyer.post(`/api/materials/${mid}/buy`, { method: 'credits' });
    assert.equal(again.status, 409);

    const { issueForMeeting, getByCode } = require('../src/features/certificates/service');
    const hist = (await db.q("INSERT INTO meeting_history(code, name, host_user_id) VALUES('CERT01','Cert event',$1) RETURNING id", [hid])).rows[0];
    await db.q('INSERT INTO meeting_participants_log(meeting_history_id,user_id,display_name,participant_id,joined_at,left_at) VALUES($1,$2,$3,$4,$5,$6)',
      [hist.id, bid, 'Buyer', 'p1', new Date(Date.now() - 20 * 60 * 1000).toISOString(), new Date().toISOString()]);
    const issued = await issueForMeeting({ historyId: hist.id, name: 'Cert event', hostName: 'Host', settings: { certs: { enabled: true, design: 'modern', minMinutes: 10 }, theme: { accent: '#2563eb' } } });
    assert.ok(issued.length >= 1, 'expected a certificate');
    const cert = await getByCode(issued[0].code);
    assert.equal(cert.attendeeName, 'Buyer');
    const second = await issueForMeeting({ historyId: hist.id, name: 'Cert event', hostName: 'Host', settings: { certs: { enabled: true, design: 'modern', minMinutes: 10 } } });
    assert.equal(second.length, 0);
  } finally { await s.stop(); }
});
