'use strict';
// Profile fields (location, website, socials), the paid "profile" promo placement and pricing,
// and the /u page layout (About in main, right rail).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { boot, client, signupPayload } = require('./helpers/server');
const plans = require('../src/lib/plans');
const fields = require('../src/features/social/profile-fields');

const skip = !process.env.DATABASE_URL && process.env.DB_DRIVER !== 'sqlite' ? 'set DATABASE_URL or DB_DRIVER=sqlite' : false;
const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('profile field normalisation: https URLs and handles, rejects unsafe input', () => {
  assert.equal(fields.normalizeWebsite('example.com/about'), 'https://example.com/about');
  assert.equal(fields.normalizeWebsite('http://Example.com/a'), 'https://example.com/a');
  assert.equal(fields.normalizeLocation('  Enugu, Nigeria  '), 'Enugu, Nigeria');
  assert.equal(fields.normalizeSocial('x', '@adaeze'), 'https://x.com/adaeze');
  assert.equal(fields.normalizeSocial('instagram', 'https://instagram.com/adaeze.okafor/'), 'https://instagram.com/adaeze.okafor');
  assert.equal(fields.normalizeSocial('tiktok', 'choirleader'), 'https://www.tiktok.com/@choirleader');
  assert.equal(fields.normalizeSocial('youtube', '@GraceChapel'), 'https://www.youtube.com/@GraceChapel');
  assert.equal(fields.normalizeSocial('linkedin', 'https://www.linkedin.com/in/adaeze-okafor'), 'https://www.linkedin.com/in/adaeze-okafor');
  for (const bad of ['javascript:alert(1)', 'data:text/html,hi', 'http://localhost', 'https://127.0.0.1/', 'not a site']) {
    assert.throws(() => fields.normalizeWebsite(bad), (e) => e.status === 400, bad);
  }
  assert.throws(() => fields.normalizeSocial('x', 'https://example.com/x'), (e) => e.status === 400);
  assert.throws(() => fields.normalizeSocial('youtube', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'), (e) => e.status === 400);
  assert.throws(() => fields.normalizeSocial('linkedin', 'https://linkedin.com/feed'), (e) => e.status === 400);
  assert.equal(fields.normalizeCoverUrl('/uploads/covers/a.jpg'), '/uploads/covers/a.jpg');
  assert.equal(fields.normalizeCoverUrl('https://cdn.example.com/c.jpg'), 'https://cdn.example.com/c.jpg');
  assert.equal(fields.normalizeCoverUrl(''), null);
  assert.throws(() => fields.normalizeCoverUrl('javascript:alert(1)'), (e) => e.status === 400);
  const patch = fields.normalizeProfilePatch({ location: 'Enugu', website: 'gracechapel.live', socials: { x: '@adaeze', instagram: '' }, coverUrl: '/uploads/covers/a.jpg' });
  assert.equal(patch.coverUrl, '/uploads/covers/a.jpg');
  assert.equal(patch.location, 'Enugu');
  assert.equal(patch.website, 'https://gracechapel.live');
  assert.deepEqual(patch.socials, { x: 'https://x.com/adaeze' });
});

test('profile placement is priced at ₦150/day by default and follows PROMO_RATE_PROFILE_KOBO', () => {
  const s = plans.envDefaults();
  assert.ok(plans.PROMO_PLACEMENTS.includes('profile'));
  assert.equal(plans.promoPricing(s).profile, 15000);
  assert.equal(plans.promoQuote(s, { days: 2, placements: ['profile'] }).priceKobo, 30000);
  assert.equal(plans.promoQuote(s, { days: 3, placements: ['discover', 'feed', 'venues', 'books'] }).priceKobo, 300000, 'legacy four still ₦1,000/day');
  const prev = process.env.PROMO_RATE_PROFILE_KOBO;
  process.env.PROMO_RATE_PROFILE_KOBO = '20000';
  try {
    const e = plans.envDefaults();
    assert.equal(plans.promoPricing(e).profile, 20000);
    assert.equal(plans.promoQuote(e, { days: 1, placements: ['profile'] }).dayKobo, 20000);
  } finally {
    if (prev == null) delete process.env.PROMO_RATE_PROFILE_KOBO;
    else process.env.PROMO_RATE_PROFILE_KOBO = prev;
  }
});

test('profile page source: About in main, rail stacks under 1024px, edit has socials, Promote lists Profile', () => {
  const js = read('public/js/pages/profile.js');
  assert.match(js, /profile-layout/);
  assert.match(js, /About/);
  assert.match(js, /Next up/);
  assert.match(js, /Similar hosts/);
  assert.match(js, /Venues they use/);
  assert.match(js, /Promote your profile/);
  assert.match(js, /placement.*profile|profileUserId/);
  assert.match(js, /socialInputs|Instagram/);
  const css = read('public/css/src/20-pages/profile.css');
  assert.match(css, /grid-template-columns:\s*minmax\(0,\s*1fr\)\s*320px/);
  assert.match(css, /@media \(max-width:\s*1023px\)/);
  assert.match(css, /profile-about-facts/);
  assert.match(css, /profile-about-fact::before/);
  assert.doesNotMatch(css, /\.profile-about-row \+ \.profile-about-row/);
  assert.match(js, /profile-about-facts/);
  assert.match(js, /Add links/);
  assert.doesNotMatch(js, /Add Instagram/);
  assert.match(js, /profile-cover/);
  assert.match(js, /coverUrl/);
  assert.match(css, /profile-cover/);
  assert.match(css, /margin-top:\s*-/);
  const host = read('public/js/pages/host.js');
  assert.match(host, /profile:\s*\[\s*'Profile rail'/);
  const admin = read('public/js/pages/admin.js');
  assert.match(admin, /\['profile',\s*'Profile rail \(kobo\/day\)'\]/);
  assert.match(admin, /\['profile',\s*'Profile'\]/);
  assert.match(read('public/index.html'), /app\.css\?v=83/);
  assert.match(read('public/sw.js'), /VERSION = 'v97-2026-11-26'/);
});


test('users can save website and socials; the profile rail returns upcoming, stats, venues and similar hosts', { skip, timeout: 60000 }, async () => {
  const s = await boot();
  try {
  const a = client(s.base);
  const body = signupPayload({ displayName: 'Adaeze Profile' });
  assert.equal((await a.post('/api/signup', body)).status, 201);
  const saved = await a.patch('/api/profile', {
    displayName: 'Adaeze Profile',
    bio: 'Worship leader in Enugu.',
    location: 'Enugu, Nigeria',
    website: 'example.com/adaeze',
    socials: { x: '@adaezeprofile', instagram: 'adaezeprofile' },
    coverUrl: '/uploads/covers/adaeze.jpg',
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.location, 'Enugu, Nigeria');
  assert.equal(saved.body.coverUrl, '/uploads/covers/adaeze.jpg');
  const cleared = await a.patch('/api/profile', { coverUrl: '' });
  assert.equal(cleared.status, 200, JSON.stringify(cleared.body));
  assert.equal(cleared.body.coverUrl, null);
  const recoved = await a.patch('/api/profile', { coverUrl: '/uploads/covers/adaeze.jpg' });
  assert.equal(recoved.body.coverUrl, '/uploads/covers/adaeze.jpg');
  const badCover = await a.patch('/api/profile', { coverUrl: 'javascript:alert(1)' });
  assert.equal(badCover.status, 400);
  assert.equal(saved.body.website, 'https://example.com/adaeze');
  assert.equal(saved.body.socials.x, 'https://x.com/adaezeprofile');
  assert.equal(saved.body.socials.instagram, 'https://www.instagram.com/adaezeprofile');

  const rejected = await a.patch('/api/profile', { website: 'javascript:alert(1)' });
  assert.equal(rejected.status, 400);

  const username = saved.body.username;
  const page = await a.get(`/api/users/${username}`);
  assert.equal(page.status, 200, JSON.stringify(page.body));
  assert.equal(page.body.isMe, true);
  assert.ok(page.body.stats);
  assert.equal(typeof page.body.stats.eventsHosted, 'number');
  assert.equal(typeof page.body.stats.attendeesReached, 'number');
  assert.ok(Array.isArray(page.body.upcoming));
  assert.ok(Array.isArray(page.body.venues));
  assert.ok(Array.isArray(page.body.similarHosts));
  assert.ok(page.body.createdAt);
  } finally { await s.stop(); }
});

test('profile placement is accepted, priced, delivered (others first, own as fallback) and counts views/clicks', { skip, timeout: 90000 }, async () => {
  const s = await boot();
  try {
  const db = require('../db');
  const hostA = client(s.base);
  const hostB = client(s.base);
  const bodyA = signupPayload();
  const bodyB = signupPayload();
  assert.equal((await hostA.post('/api/signup', bodyA)).status, 201);
  assert.equal((await hostB.post('/api/signup', bodyB)).status, 201);
  const userA = (await hostA.get('/api/session')).body.user;
  const userB = (await hostB.get('/api/session')).body.user;

  async function ev(c, title) {
    const r = await c.post('/api/events', {
      title, visibility: 'public', category: 'meeting',
      startsAt: new Date(Date.now() + 864e5).toISOString(),
    });
    assert.ok(r.status === 200 || r.status === 201, JSON.stringify(r.body));
    return r.body.event || r.body;
  }
  const evA = await ev(hostA, 'Alpha Praise Night');
  const evB = await ev(hostB, 'Beta Tech Talk');
  const evB2 = await ev(hostB, 'Beta Follow-up');

  const quote = await hostB.get('/api/promote/quote?days=3&placements=profile');
  assert.equal(quote.status, 200, JSON.stringify(quote.body));
  assert.equal(quote.body.priceKobo ?? quote.body.subtotalKobo, 45000);

  const starts = new Date(Date.now() - 60_000).toISOString();
  async function insertPromo(ownerId, eventId, placements, weight) {
    const r = await db.q(
      `INSERT INTO promotions (target_type, event_id, placements, starts_at, active, weight, owner_user_id, review_status)
       VALUES ('event', $1, $2, $3, true, $4, $5, 'approved') RETURNING id`,
      [eventId, placements, starts, weight, ownerId],
    );
    return r.rows[0].id;
  }
  const ownId = Number(await insertPromo(userA.id, evA.id, ['profile'], 10));
  const otherId = Number(await insertPromo(userB.id, evB.id, ['profile'], 5));
  const feedOnlyId = Number(await insertPromo(userB.id, evB2.id, ['feed'], 1));
  // PGlite is a shared database across the suite; keep only this test's rows live.
  await db.q('UPDATE promotions SET active=false WHERE id != $1 AND id != $2 AND id != $3', [ownId, otherId, feedOnlyId]);

  const rail = await hostA.get(`/api/promotions?placement=profile&profileUserId=${userA.id}&limit=3`);
  assert.equal(rail.status, 200, JSON.stringify(rail.body));
  const ids = (rail.body.items || []).map((it) => Number(it.id));
  assert.ok(ids.includes(otherId), 'other host profile promo present: ' + JSON.stringify(ids));
  assert.ok(!ids.includes(ownId), 'own promo skipped when others exist: ' + JSON.stringify(ids));
  assert.ok(ids.includes(feedOnlyId), 'non-profile promo used as fallback: ' + JSON.stringify(ids));

  const seen = await hostA.post('/api/promotions/seen', { ids: [otherId] });
  assert.equal(seen.status, 200);
  const click = await hostA.post(`/api/promotions/${otherId}/click`, {});
  assert.equal(click.status, 200);
  const row = (await db.q('SELECT views, clicks FROM promotions WHERE id=$1', [otherId])).rows[0];
  assert.ok(Number(row.views) >= 1, 'view counted');
  assert.ok(Number(row.clicks) >= 1, 'click counted');

  const ok = await db.q(
    `INSERT INTO promotions (target_type, event_id, placements, starts_at, active, weight, owner_user_id, review_status)
     VALUES ('event', $1, $2, $3, true, 0, $4, 'approved') RETURNING id`,
    [evB.id, ['discover', 'profile'], starts, userB.id],
  );
  assert.ok(ok.rows[0].id);
  } finally { await s.stop(); }
});
