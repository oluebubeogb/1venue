'use strict';
const { readFileSync } = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { describe, it, test } = require('node:test');

const root = path.join(__dirname, '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const skip = process.env.DB_DRIVER !== 'sqlite' && !process.env.DATABASE_URL ? 'set DATABASE_URL or DB_DRIVER=sqlite' : false;
if (process.env.DB_DRIVER === 'sqlite') require('./helpers/server');

describe('out35 marketplace and 15-minute videos', () => {
  it('adds a marketplace page, Explore command, and list-on-marketplace editor', () => {
    assert.match(read('public/js/app.js'), /pages\/market\.js/);
    assert.match(read('public/js/app.js'), /short: 'Marketplace'/);
    assert.match(read('public/js/pages/market.js'), /\/api\/market/);
    assert.match(read('public/js/material-sale.js'), /List on marketplace/);
    assert.match(read('public/js/material-sale.js'), /MARKET_CATEGORIES/);
  });

  it('accepts video uploads with compression, progress, cancel, and an inline player', () => {
    const up = read('public/js/video-upload.js');
    assert.match(up, /compressVideo/);
    assert.match(up, /VideoEncoder/);
    assert.match(up, /MediaRecorder/);
    assert.match(up, /\/api\/files\/presign/);
    assert.match(up, /onProgress/);
    assert.match(up, /signal/);
    assert.match(read('public/js/composer.js'), /video\/\*/);
    assert.match(read('public/js/materials-lib.js'), /video\/\*/);
    assert.match(read('public/js/video-player.js'), /videoPlayer/);
    assert.match(read('public/js/room/panels.js'), /isVideoAtt/);
    assert.match(read('public/js/pages/messages.js'), /isVideoAtt/);
    assert.match(read('public/js/app-pip.js'), /hydrateVideoPlayers/);
    assert.match(read('public/js/pages/material.js'), /kind === 'video'/);
  });

  it('bumps the cache versions', () => {
    assert.match(read('public/sw.js'), /VERSION = 'v97-2026-11-26'/);
    assert.match(read('public/index.html'), /app\.css\?v=83/);
    assert.match(read('public/index.html'), /app\.js\?v=83/);
  });
});

test('marketplace is opt-in and filterable; video presign is gated', { skip, timeout: 60000 }, async () => {
  const { boot, client, signupPayload } = require('./helpers/server');
  const db = require('../db');
  const s = await boot({ BILLING_WORKER: 'false', REMINDER_WORKER: 'false', REPLAY_WORKER: 'false' });
  try {
    const host = client(s.base);
    const buyer = client(s.base);
    await host.post('/api/signup', signupPayload());
    await buyer.post('/api/signup', signupPayload());
    const hid = (await host.get('/api/session')).body.user.id;
    const listed = (await db.q("INSERT INTO materials(owner_user_id,title,kind,payload,listed,category,for_sale,price_kobo) VALUES($1,'Listed talk','slides',$2,TRUE,'Teaching',TRUE,10000) RETURNING id",
      [hid, JSON.stringify({ pages: ['https://example.com/p.png'] })])).rows[0];
    const hidden = (await db.q("INSERT INTO materials(owner_user_id,title,kind,payload,listed,category) VALUES($1,'Private deck','slides',$2,FALSE,'Study') RETURNING id",
      [hid, JSON.stringify({ pages: ['https://example.com/p.png'] })])).rows[0];
    const free = (await db.q("INSERT INTO materials(owner_user_id,title,kind,payload,listed,category,for_sale,price_kobo) VALUES($1,'Free notes','slides',$2,TRUE,'Study',FALSE,NULL) RETURNING id",
      [hid, JSON.stringify({ pages: ['https://example.com/p.png'] })])).rows[0];

    const all = await buyer.get('/api/market');
    assert.equal(all.status, 200, JSON.stringify(all.body) + ' ' + s.output());
    const ids = (all.body.materials || []).map((m) => Number(m.id));
    assert.ok(ids.includes(Number(listed.id)));
    assert.ok(ids.includes(Number(free.id)));
    assert.ok(!ids.includes(Number(hidden.id)));

    const teaching = await buyer.get('/api/market?category=Teaching&price=paid');
    assert.equal(teaching.status, 200, JSON.stringify(teaching.body));
    const tIds = (teaching.body.materials || []).map((m) => Number(m.id));
    assert.deepEqual(tIds, [Number(listed.id)]);

    const videos = await buyer.get('/api/market?type=video');
    assert.equal(videos.status, 200);
    assert.equal((videos.body.materials || []).length, 0);

    const searched = await buyer.get('/api/market?q=Listed');
    assert.equal((searched.body.materials || []).some((m) => Number(m.id) === Number(listed.id)), true);

    const sale = await host.post(`/api/materials/${hidden.id}/sale`, { listed: true, category: 'Music', forSale: false });
    assert.equal(sale.status, 200, JSON.stringify(sale.body));
    assert.equal(!!sale.body.listed, true);
    assert.equal(sale.body.category, 'Music');
    const after = await buyer.get('/api/market?category=Music');
    assert.ok((after.body.materials || []).some((m) => Number(m.id) === Number(hidden.id)));

    const presign = await host.post('/api/files/presign', { filename: 'clip.webm', mime: 'video/webm', size: 1000, durationSec: 12, purpose: 'chat' });
    assert.ok(presign.status === 503 || presign.status === 201 || presign.status === 200, JSON.stringify(presign.body));
    if (presign.status >= 400) assert.match(String(presign.body && presign.body.error || ''), /object storage|S3|R2|not available|need/i);

    const tooLong = await host.post('/api/files/presign', { filename: 'long.webm', mime: 'video/webm', size: 1000, durationSec: 2000, purpose: 'chat' });
    assert.equal(tooLong.status, 413, JSON.stringify(tooLong.body));

    const tooBig = await host.post('/api/files/presign', { filename: 'huge.webm', mime: 'video/webm', size: 300 * 1024 * 1024, durationSec: 60, purpose: 'chat' });
    assert.equal(tooBig.status, 413, JSON.stringify(tooBig.body));
  } finally { await s.stop(); }
});
