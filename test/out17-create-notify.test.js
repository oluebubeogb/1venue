'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { boot, client, signupPayload } = require('./helpers/server');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

test('out17 create layout, gift currency, and versions', () => {
  const create = read('public/js/pages/create.js');
  assert.match(create, /create-grid/);
  assert.match(create, /create-col/);
  assert.match(create, /create-preview/);
  assert.match(create, /class: 'row wrap create-actions'/);
  const gridAt = create.indexOf('create-grid');
  const actionsAt = create.indexOf("class: 'row wrap create-actions'");
  assert.ok(gridAt >= 0 && actionsAt > gridAt, 'Publish / Go live sit after the columns');
  const col1 = create.indexOf("field('Title'");
  const colors = create.indexOf("field('Event colours'");
  const cover = create.indexOf("field('Cover'");
  const starts = create.indexOf("field('Starts'");
  const materials = create.indexOf("field('Materials'");
  const preview = create.indexOf("class: 'sticky col create-preview'");
  assert.ok(col1 < colors && colors < cover && cover < starts, 'colours and cover stay in column 1');
  assert.ok(starts < materials && materials < preview, 'schedule, seats and materials stay in column 2');
  assert.match(create, /Just need a quick call\?/);
  const css = read('public/css/src/20-pages/create.css');
  assert.match(css, /grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\) minmax\(260px, 360px\)/);
  assert.match(css, /@media \(max-width: 1100px\)/);
  assert.match(css, /@media \(max-width: 720px\)/);

  const ev = read('public/js/pages/event.js');
  assert.match(ev, /currencyParts/);
  assert.match(ev, /gift-cur-prefix/);
  assert.match(ev, /gift-cur-suffix/);
  assert.match(ev, /majorToBaseMinor/);
  assert.doesNotMatch(ev, /real money/);
  assert.doesNotMatch(ev, /not wallet credits/);
  assert.doesNotMatch(ev, /processing fee is added at checkout/);
  const money = read('public/js/money.js');
  assert.match(money, /export function currencyParts/);
  assert.match(money, /export function majorToBaseMinor/);

  assert.match(read('public/sw.js'), /VERSION = 'v97-2026-11-26'/);
  assert.match(read('public/index.html'), /app\.css\?v=83/);
  assert.match(read('public/index.html'), /app\.js\?v=83/);
  assert.match(read('src/config.js'), /NOTIFY_RETURN_AFTER_DAYS/);
});

test('welcome and return templates, and quiet-hours push gating', () => {
  const welcome = require('../src/features/messages/welcome');
  const user = { display_name: 'Ada Okon', username: 'adao' };
  const links = [
    { label: 'Create an event', href: 'https://example.test/create' },
    { label: 'Discover events', href: 'https://example.test/discover' },
  ];
  const w = welcome.templateWelcome(user, links);
  assert.match(w, /Welcome to 1venue, Ada/);
  assert.match(w, /https:\/\/example\.test\/create/);
  assert.match(w, /https:\/\/example\.test\/discover/);
  const back = welcome.templateReturn(user, {
    trending: [{ title: 'Youth night', href: 'https://example.test/e/youth-night' }],
    actions: [{ text: '1 pending speaker invite', href: 'https://example.test/dashboard' }],
  });
  assert.match(back, /Welcome back, Ada/);
  assert.match(back, /Youth night: https:\/\/example\.test\/e\/youth-night/);
  assert.match(back, /pending speaker invite: https:\/\/example\.test\/dashboard/);
  const empty = welcome.templateReturn(user, { trending: [], actions: [] });
  assert.doesNotMatch(empty, /Trending now/);
  assert.doesNotMatch(empty, /Waiting on you/);

  const noon = new Date('2026-11-23T12:00:00+01:00');
  const midnight = new Date('2026-11-23T00:30:00+01:00');
  assert.equal(welcome.shouldPush({}, noon), true);
  assert.equal(welcome.shouldPush({}, midnight), false);
  assert.equal(welcome.shouldPush({ notifications: { push: false } }, noon), false);
  assert.equal(welcome.shouldPush({ notifications: { quietStart: '11:00', quietEnd: '13:00' } }, noon), false);
});

const skip = process.env.DB_DRIVER !== 'sqlite' && !process.env.DATABASE_URL;

test('signup gets one welcome message; a later return includes trending links and actions', { skip, timeout: 20000 }, async () => {
  const prev = process.env.PUBLIC_URL;
  const prevAi = process.env.NOTIFY_AI_ENABLED;
  process.env.PUBLIC_URL = 'https://example.test';
  process.env.NOTIFY_AI_ENABLED = 'false';
  const s = await boot({ PUBLIC_URL: 'https://example.test', NOTIFY_AI_ENABLED: 'false', NOTIFY_RETURN_AFTER_DAYS: '3' });
  const notify = require('../src/features/messages/notify');
  const welcome = require('../src/features/messages/welcome');
  const service = require('../src/features/messages/service');
  const db = require('../db');
  const data = require('../src/venue/data');
  try {
    const u = client(s.base);
    const payload = signupPayload({ displayName: 'Ada Okon' });
    const su = await u.post('/api/signup', payload);
    assert.equal(su.status, 201, JSON.stringify(su.body));
    const id = (await u.get('/api/session')).body.user.id;
    let texts = [];
    for (let i = 0; i < 40; i++) {
      const { conversation } = await notify.ensureThread(id);
      const list = await service.listMessages(id, conversation.id, { limit: 20 });
      const msgs = list.messages || list || [];
      texts = msgs.map((m) => m.text || '').filter(Boolean);
      if (texts.some((t) => /Welcome to 1venue/i.test(t))) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.ok(texts.some((t) => /Welcome to 1venue, Ada/i.test(t)), texts.join('\n---\n'));
    assert.ok(texts.some((t) => /https:\/\/example\.test\/create/.test(t)));
    assert.ok(texts.some((t) => /https:\/\/example\.test\/discover/.test(t)));
    assert.equal(await welcome.sendWelcome(id), null, 'welcome is deduped');

    const tag = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const host = await db.createUser({ username: ('th' + tag).slice(0, 30), email: `th${tag}@ex.test`, passwordHash: 'hash', displayName: 'Trend Host' });
    await data.createEvent({ id: host.id, username: host.username, displayName: 'Trend Host' }, {
      title: 'Trending Youth Night ' + tag, category: 'talk_show', visibility: 'public',
      startsAt: new Date(Date.now() + 3600000).toISOString(),
    });
    const ago = new Date(Date.now() - 4 * 24 * 3600 * 1000).toISOString();
    await welcome.claim(id, { touchSeen: true });
    const extra = await notify.extraOf(id);
    extra.notifyLastSeenAt = ago;
    extra.notifyReturnAt = ago;
    await notify.patchExtra(id, extra);
    const sent = await welcome.sendReturn(id);
    assert.ok(sent, 'return message sent');
    const { conversation } = await notify.ensureThread(id);
    const list = await service.listMessages(id, conversation.id, { limit: 20 });
    const all = (list.messages || list || []).map((m) => m.text || '').join('\n');
    assert.match(all, /Welcome back, Ada|here is what I found|Trending now|Waiting on you|Youth Night|Beta Follow-up/i);
    assert.match(all, /https:\/\/example\.test\/e\//);
    assert.match(all, /credit balance is low|ready to move|profile is missing|unread chat|pending speaker|Upcoming:|Action items/i);
    assert.equal(await welcome.sendReturn(id), null, 'return is once per window');
  } finally {
    if (prev == null) delete process.env.PUBLIC_URL;
    else process.env.PUBLIC_URL = prev;
    if (prevAi == null) delete process.env.NOTIFY_AI_ENABLED;
    else process.env.NOTIFY_AI_ENABLED = prevAi;
    await s.stop();
  }
});
