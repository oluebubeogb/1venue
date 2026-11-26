'use strict';
const { describe, it, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const skip = process.env.DB_DRIVER !== 'sqlite' && !process.env.DATABASE_URL ? 'set DATABASE_URL or DB_DRIVER=sqlite' : false;
if (process.env.DB_DRIVER === 'sqlite') require('./helpers/server');

describe('session certificates, profile visibility, and Open notifications', () => {
  it('wires in-meeting tools, session certs, profile tab, and the Open button', () => {
    assert.match(read('public/js/room/tools.js'), /certs\(\) \{/);
    assert.match(read('public/js/room/tools.js'), /host or a co-host/);
    assert.match(read('public/js/room/panels.js'), /\['certs', 'Certificates'/);
    assert.match(read('src/features/certificates/routes.js'), /isLiveManager/);
    assert.match(read('src/features/certificates/routes.js'), /\/api\/sessions\/.+\/certs\/manual/);
    assert.match(read('src/features/certificates/routes.js'), /\/api\/certs\/\(\[A-Z0-9\]\{10\}\)\/visibility/);
    assert.match(read('public/js/pages/session.js'), /certsPanel/);
    assert.match(read('public/js/pages/session.js'), /Certificates/);
    assert.match(read('public/js/pages/profile.js'), /\['certs', 'Certificates'/);
    assert.match(read('public/js/pages/profile.js'), /isPublic/);
    const msg = read('public/js/pages/messages.js');
    assert.match(msg, /msg-card-open/);
    assert.match(msg, /join \? 'Join' : 'Open'/);
    assert.match(msg, /certificate: 'graduation'/);
    assert.doesNotMatch(msg, /p\.type === 'schedule' \|\| p\.type === 'event' \? 'Open' : 'Join'/);
    assert.match(read('public/sw.js'), /VERSION = 'v97-2026-11-26'/);
    assert.match(read('public/index.html'), /app\.css\?v=83/);
    assert.ok(fs.existsSync(path.join(__dirname, '..', 'migrations/sqlite/032_cert_public_manual.sql')));
    assert.ok(fs.existsSync(path.join(__dirname, '..', 'src/features/certificates/migrations/20261126120000_cert_public_manual.sql')));
  });

  it('parses typed names and optional emails for manual certificates', () => {
    const { parsePeople } = require('../src/features/certificates/service');
    const people = parsePeople({ names: 'Ada Lovelace, ada@example.com\nChinedu Okoye <chinedu@okoye.test>\nJust A Name\n' });
    assert.equal(people.length, 3);
    assert.deepEqual(people[0], { name: 'Ada Lovelace', email: 'ada@example.com' });
    assert.deepEqual(people[1], { name: 'Chinedu Okoye', email: 'chinedu@okoye.test' });
    assert.deepEqual(people[2], { name: 'Just A Name', email: '' });
  });
});

test('hosts can issue, mail-link, and toggle visibility of certificates', { skip, timeout: 90000 }, async () => {
  const { boot, client, signupPayload } = require('./helpers/server');
  const s = await boot();
  try {
    const host = client(s.base);
    const guest = client(s.base);
    const hp = signupPayload();
    const gp = signupPayload();
    await host.post('/api/signup', hp);
    await guest.post('/api/signup', gp);
    const guestName = (await guest.get('/api/session')).body.user.username;

    const created = await host.post('/api/create', { name: 'Cert session room', participantName: 'Host Ada' });
    assert.equal(created.status, 200, JSON.stringify(created.body));
    const code = created.body.code;
    const save = await host.post(`/api/rooms/${code}/certs`, {
      enabled: true, design: 'classic', minMinutes: 1,
      titleKind: 'attendance', programme: 'Evening Session', issuerName: 'Harmon House',
      signatories: [{ name: 'Ada', role: 'Host' }],
    });
    assert.equal(save.status, 200, JSON.stringify(save.body));
    assert.equal(save.body.certs.enabled, true);

    const hist = await host.get('/api/history?limit=5');
    assert.equal(hist.status, 200, JSON.stringify(hist.body));
    const session = (hist.body.history || hist.body || []).find((x) => String(x.code).toUpperCase() === String(code).toUpperCase())
      || (hist.body.history || [])[0];
    assert.ok(session && session.id, JSON.stringify(hist.body));
    const sid = session.id;

    const manual = await host.post(`/api/sessions/${sid}/certs/manual`, { names: 'Pat Okon, pat@example.com\nAmaka Eze' });
    assert.equal(manual.status, 200, JSON.stringify(manual.body));
    assert.equal(manual.body.count, 2);
    assert.equal(manual.body.issued[0].source, 'manual');
    assert.equal(manual.body.issued[0].userId, null);
    const cert = manual.body.issued.find((c) => c.attendeeName === 'Pat Okon') || manual.body.issued[0];
    assert.ok(cert.code);
    assert.ok(cert.url.includes('/cert/' + cert.code));

    const pub = await guest.get('/api/certs/' + cert.code);
    assert.equal(pub.status, 200);
    assert.equal(pub.body.attendeeName, cert.attendeeName);

    const list = await host.get(`/api/sessions/${sid}/certs`);
    assert.equal(list.status, 200, JSON.stringify(list.body));
    assert.equal(list.body.certs.enabled, true);
    assert.ok(list.body.issued.length >= 2);

    const forbidden = await guest.post(`/api/sessions/${sid}/certs/manual`, { names: 'Intruder' });
    assert.equal(forbidden.status, 403);

    // Attendance issue for a signed-in guest after writing a long-enough log row.
    const db = require('../db');
    const gid = (await guest.get('/api/session')).body.user.id;
    const hid = (await host.get('/api/session')).body.user.id;
    await db.q('INSERT INTO meeting_participants_log(meeting_history_id,user_id,display_name,participant_id,joined_at,left_at) VALUES($1,$2,$3,$4,$5,$6)',
      [sid, gid, 'Guest Person', 'g1', new Date(Date.now() - 20 * 60 * 1000).toISOString(), new Date().toISOString()]);
    const issued = await host.post(`/api/sessions/${sid}/certs/issue`, {});
    assert.equal(issued.status, 200, JSON.stringify(issued.body));
    assert.ok(issued.body.count >= 1);
    const guestCert = issued.body.issued.find((c) => Number(c.userId) === Number(gid));
    assert.ok(guestCert, JSON.stringify(issued.body));
    assert.equal(guestCert.isPublic, false);

    const vis = await guest.patch(`/api/certs/${guestCert.code}/visibility`, { isPublic: true });
    assert.equal(vis.status, 200, JSON.stringify(vis.body));
    assert.equal(vis.body.cert.isPublic, true);

    const hostVis = await host.patch(`/api/certs/${guestCert.code}/visibility`, { isPublic: false });
    assert.equal(hostVis.status, 403);

    const profile = await host.get(`/api/users/${guestName}/certs`);
    assert.equal(profile.status, 200, JSON.stringify(profile.body));
    assert.equal(profile.body.isMe, false);
    assert.ok(profile.body.certs.some((c) => c.code === guestCert.code));

    const privateManual = await host.get(`/api/users/${hid}/certs`);
    // host has no account certs from this run; just ensure the endpoint works
    assert.equal(privateManual.status, 200);
    const mine = await guest.get(`/api/users/${gid}/certs`);
    assert.equal(mine.status, 200);
    assert.equal(mine.body.isMe, true);
    assert.ok(mine.body.certs.some((c) => c.code === guestCert.code));
  } finally { await s.stop(); }
});
