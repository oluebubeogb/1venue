'use strict';
// Demo seed (admin load / one-click remove), public profiles at /u/:username, the auth overlay
// copy, and the Qur'an command-bar matcher. DB parts need DATABASE_URL.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { boot, client, signupPayload } = require('./helpers/server');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const skip = !process.env.DATABASE_URL ? 'set DATABASE_URL' : false;
const tokenOf = (link) => new URL(link).searchParams.get('token');

test('auth pages: overlay + one-page sign-up, no wordy helper text', () => {
  const js = read('public/js/pages/login.js');
  assert.match(js, /export function openAuth/);
  assert.match(js, /Log in or sign up/);
  assert.match(js, /\/auth\/google\/start\?next=/);
  for (const gone of ['Free. Host and join events in minutes', 'At least 8 characters', 'A short sentence is easy to remember', 'You can still join any room as a guest', 'Welcome back']) {
    assert.ok(!js.includes(gone), `removed: ${gone}`);
  }
  const css = read('public/css/app.css');
  assert.match(css, /\.au-scrim\s*\{[^}]*backdrop-filter:[^;]*blur\(/, 'overlay blurs the page behind it');
});

test('quran in the command bar: list, number, name, Arabic, ayah', async () => {
  const { surahCommands, looksLikeQuran } = await import('../public/js/quran-cmd.js');
  const { BOOKS } = require('../src/venue/bible.js');
  const surahs = BOOKS.filter((b) => b.surah);
  assert.equal(surahs.length, 114);
  assert.ok(surahs.every((s) => s.nameAr && /[\u0600-\u06FF]/.test(s.nameAr)), 'every surah has an Arabic name');
  let went = '';
  const go = (p) => { went = p; };
  assert.equal(surahCommands('/quran', surahs, go).length, 114);
  assert.equal(surahCommands('q', surahs, go).length, 114);
  const q18 = surahCommands('q 18', surahs, go);
  assert.equal(q18.length, 1); assert.match(q18[0].label, /Al-Kahf/); assert.match(q18[0].label, /الكهف/);
  q18[0].run(); assert.equal(went, '/books?corpus=quran&ref=Al-Kahf');
  const k10 = surahCommands('kahf 10', surahs, go); k10[0].run();
  assert.equal(went, '/books?corpus=quran&ref=' + encodeURIComponent('Al-Kahf 10'));
  assert.match(surahCommands('2:255', surahs, go)[0].label, /Al-Baqarah.*ayah 255/);
  assert.match(surahCommands('الكهف', surahs, go)[0].label, /Al-Kahf/);
  assert.match(surahCommands('surah yasin', surahs, go)[0].label, /Ya-?Sin/i);
  assert.match(surahCommands('q cave', surahs, go)[0].label, /Al-Kahf/, 'by English meaning');
  assert.equal(surahCommands('settings', surahs, go).length, 0);
  assert.equal(surahCommands('John 3:16', surahs, go).length, 0, 'Bible refs are left alone');
  assert.equal(looksLikeQuran('/q'), true); assert.equal(looksLikeQuran('kahf'), false);
});

test('seed: admin-only, loads 10 complete accounts, removes cleanly; /u/:username public pages', { skip, timeout: 120000 }, async () => {
  const admin = signupPayload();
  const s = await boot({ ADMIN_EMAILS: `someone@else.test, ${admin.email.toUpperCase()}` });
  const db = require('../db');
  try {
    const c = client(s.base);
    const su = await c.post('/api/signup', admin);
    assert.ok(su.status === 200 || su.status === 201, String(su.status));
    assert.equal((await c.get('/api/admin/seed')).status, 403, 'unconfirmed email is not admin');
    const link = await s.mailLink(admin.email, /Confirm your email/);
    assert.equal((await c.post('/api/auth/verify-email', { token: tokenOf(link) })).status, 200);
    assert.equal((await c.get('/api/session')).body.user.isAdmin, true);

    const otherBody = signupPayload();
    const other = client(s.base); await other.post('/api/signup', otherBody);
    assert.equal((await other.post('/api/admin/seed')).status, 403, 'non-admin cannot load');
    assert.equal((await client(s.base).del('/api/admin/seed')).status, 401);

    // a real post that must survive seed removal
    await c.post('/api/posts', { body: 'real content stays' });
    const realIds = [admin.username, otherBody.username];

    const loaded = await c.post('/api/admin/seed');
    assert.equal(loaded.status, 200, JSON.stringify(loaded.body));
    assert.equal(loaded.body.users, 10);
    assert.ok(loaded.body.events >= 10 && loaded.body.posts >= 10 && loaded.body.sessions >= 3, JSON.stringify(loaded.body));
    const rows = (await db.q('SELECT * FROM users WHERE is_seed')).rows;
    assert.equal(rows.length, 10);
    for (const u of rows) {
      for (const k of ['username', 'display_name', 'email', 'avatar_url', 'bio', 'phone', 'password_hash', 'email_verified_at']) assert.ok(u[k], `${u.username}.${k}`);
      assert.match(u.email, /@seed\.1venue\.live$/);
    }
    const li = await client(s.base).post('/api/login', { login: rows[0].username, password: '@1venued' });
    assert.equal(li.status, 200, 'seed password works');

    // public profile pages
    const name = rows[0].username;
    const page = await fetch(`${s.base}/u/${name}`);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /<meta property="og:type" content="profile"/);
    assert.match(html, new RegExp(`<link rel="canonical" href="[^"]*/u/${name.replace('.', '\\.')}"`));
    const upper = await fetch(`${s.base}/u/${name.toUpperCase()}`, { redirect: 'manual' });
    assert.equal(upper.status, 301); assert.equal(new URL(upper.headers.get('location'), s.base).pathname, `/u/${name}`);
    const byId = await fetch(`${s.base}/u/${rows[0].id}`, { redirect: 'manual' });
    assert.equal(byId.status, 301);
    const none = await fetch(`${s.base}/u/nobody_here_${Date.now()}`);
    assert.equal(none.status, 404); assert.match(await none.text(), /noindex/);

    // reload is idempotent, then one-click remove
    assert.equal((await c.post('/api/admin/seed')).body.users, 10);
    const removed = await c.del('/api/admin/seed');
    assert.equal(removed.status, 200);
    assert.equal(removed.body.loaded, false);
    assert.equal((await db.q('SELECT COUNT(*)::int n FROM users WHERE is_seed')).rows[0].n, 0);
    assert.equal((await db.q('SELECT COUNT(*)::int n FROM seed_rows')).rows[0].n, 0);
    // other test files create users concurrently, so check our own real rows instead of totals
    assert.equal((await db.q('SELECT COUNT(*)::int n FROM users WHERE username = ANY($1) AND NOT is_seed', [realIds])).rows[0].n, 2, 'real users survive');
    assert.equal((await db.q("SELECT COUNT(*)::int n FROM posts p JOIN users u ON u.id=p.user_id WHERE u.username=$1 AND p.body='real content stays'", [admin.username])).rows[0].n, 1, 'real post survives');
    assert.equal((await db.q("SELECT COUNT(*)::int n FROM users WHERE email LIKE '%@seed.1venue.live'")).rows[0].n, 0);
    assert.equal((await fetch(`${s.base}/u/${name}`)).status, 404);
  } finally {
    await client(s.base).get('/health');
    await require('../src/features/seed/seed').remove().catch(() => {});
    await s.stop(); await db.close().catch(() => {});
  }
});
