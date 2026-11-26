'use strict';
const { readFileSync } = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { describe, it, test } = require('node:test');

const root = path.join(__dirname, '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const skip = process.env.DB_DRIVER !== 'sqlite' && !process.env.DATABASE_URL ? 'set DATABASE_URL or DB_DRIVER=sqlite' : false;
if (process.env.DB_DRIVER === 'sqlite') require('./helpers/server');

describe('out16 instant overlay and paid-usage helpers', () => {
  it('renames Free Entry and Paid Entry, drops price/duration, and links to ticketing', () => {
    const inst = read('public/js/instant.js');
    assert.match(inst, /Free Entry/);
    assert.match(inst, /Paid Entry/);
    assert.match(inst, /Need tickets\? Use ticketing/);
    assert.match(inst, /target: '_blank'/);
    assert.doesNotMatch(inst, /Host funded/);
    assert.doesNotMatch(inst, /Participant funded/);
    assert.doesNotMatch(inst, /Advertised duration/);
    assert.doesNotMatch(inst, /Entry price/);
    assert.doesNotMatch(inst, /Attendees sign in and pay/);
    assert.doesNotMatch(inst, /meetingDurationMin/);
    assert.doesNotMatch(inst, /meetingEntryPriceCredits/);
  });

  it('in-room switch, accept, low-balance and stay-in-call top-up exist', () => {
    const room = read('public/js/room/room.js');
    assert.match(room, /enablePaidEntry/);
    assert.match(room, /openPaidSwitchModal/);
    assert.match(room, /Accept and continue/);
    assert.match(room, /openInCallTopup/);
    assert.match(room, /window\.open\(start\.authorizationUrl/);
    assert.match(room, /openAuth\(\{ next:.*stay: true/);
    const ws = read('public/js/room/wsHandlers.js');
    assert.match(ws, /paid-entry-switch/);
    assert.match(ws, /paid-usage-low-balance/);
  });

  it('bills connected milliseconds, skips reconnect gaps, and splits 80/20', () => {
    const { debitable } = require('../src/features/wallet/usage');
    const { split } = require('../src/features/wallet/paid-entry');
    assert.equal(debitable(1000, 4000), 3000);
    assert.equal(debitable(4000, 1000), 0);
    const s = split(1000);
    assert.equal(s.host, 800);
    assert.equal(s.platform, 200);
    const odd = split(3);
    assert.equal(odd.host + odd.platform, 3);
    assert.equal(odd.host, 2);
  });

  it('bumps the cache versions', () => {
    assert.match(read('public/sw.js'), /VERSION = 'v97-2026-11-26'/);
    assert.match(read('public/index.html'), /app\.css\?v=83/);
    assert.match(read('public/index.html'), /app\.js\?v=83/);
  });
});

test('usage paid entry meters connected time, skips a reconnect gap, and pays the host 80%', { skip, timeout: 60000 }, async () => {
  const { boot, client, signupPayload } = require('./helpers/server');
  const db = require('../db');
  const usage = require('../src/features/wallet/usage');
  const { UNITS_PER_CREDIT: U } = require('../src/features/wallet/rules');
  const s = await boot();
  try {
    const host = client(s.base);
    const guest = client(s.base);
    const hp = signupPayload();
    const gp = signupPayload();
    await host.post('/api/signup', hp);
    await guest.post('/api/signup', gp);
    const hid = (await host.get('/api/session')).body.user.id;
    const gid = (await guest.get('/api/session')).body.user.id;
    await db.q('INSERT INTO credit_wallets(user_id,balance_units) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET balance_units=$2', [hid, 30 * U]);
    await db.q('INSERT INTO credit_wallets(user_id,balance_units) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET balance_units=$2', [gid, 30 * U]);
    const created = await host.post('/api/create', { name: 'Usage room', participantName: 'Ada', meetingAccessMode: 'paid_entry' });
    assert.equal(created.status, 200, JSON.stringify(created.body) + ' ' + s.output());
    assert.equal(created.body.paidEntry && created.body.paidEntry.model, 'usage');
    const code = created.body.code;
    const join = await guest.post('/api/join', { code, participantName: 'Pat Okon' });
    assert.equal(join.status, 200, JSON.stringify(join.body));
    const t0 = Date.now();
    const meters = async (userId) => (await db.q("SELECT * FROM paid_usage_meters WHERE code=$1 AND user_id=$2 AND state<>'closed'", [code, userId])).rows[0];
    let hostMeter = await meters(hid);
    let guestMeter = await meters(gid);
    assert.ok(hostMeter && guestMeter, 'meters should exist after create/join');
    hostMeter = await usage.applyPresence(hostMeter, true, t0);
    guestMeter = await usage.applyPresence(guestMeter, true, t0);
    hostMeter = (await usage.settleMeter(hostMeter, t0 + 60_000, { hostUserId: hid })).meter;
    guestMeter = (await usage.settleMeter(guestMeter, t0 + 60_000, { hostUserId: hid })).meter;
    const hostWallet = Number((await db.q('SELECT balance_units FROM credit_wallets WHERE user_id=$1', [hid])).rows[0].balance_units);
    const guestWallet = Number((await db.q('SELECT balance_units FROM credit_wallets WHERE user_id=$1', [gid])).rows[0].balance_units);
    const hostDebit = 30 * U - hostWallet;
    const guestDebit = 30 * U - guestWallet;
    assert.ok(hostDebit >= 80_000 && hostDebit <= 100_000, 'host debit ' + hostDebit);
    assert.ok(guestDebit >= 80_000 && guestDebit <= 100_000, 'guest debit ' + guestDebit);
    const earn = (await db.q('SELECT * FROM paid_meeting_earnings WHERE code=$1', [code])).rows[0];
    assert.ok(earn, 'host should have pending earnings from the participant');
    assert.equal(Number(earn.host_units), Math.floor(Number(earn.gross_units) * 0.8));
    assert.equal(Number(earn.host_units) + Number(earn.platform_units), Number(earn.gross_units));
    assert.equal(earn.state, 'pending');
    // Reconnect gap: drop guest for 20s, come back, bill 10s more. The gap must not be billed.
    const beforeGap = guestWallet;
    guestMeter = await usage.applyPresence(guestMeter, false, t0 + 61_000);
    guestMeter = (await usage.settleMeter(guestMeter, t0 + 61_000, { hostUserId: hid })).meter;
    guestMeter = await usage.applyPresence(guestMeter, true, t0 + 81_000);
    guestMeter = (await usage.settleMeter(guestMeter, t0 + 91_000, { hostUserId: hid })).meter;
    const afterGap = Number((await db.q('SELECT balance_units FROM credit_wallets WHERE user_id=$1', [gid])).rows[0].balance_units);
    const gapDebit = beforeGap - afterGap;
    assert.ok(gapDebit >= 12_000 && gapDebit <= 18_000, 'gap should not be billed, only the 10s after reconnect, got ' + gapDebit);
    await usage.finalizeUsage(code, t0 + 92_000);
    const settled = (await db.q('SELECT * FROM paid_meeting_earnings WHERE code=$1', [code])).rows[0];
    assert.equal(settled.state, 'available');
    const refunds = (await db.q("SELECT * FROM credit_ledger WHERE user_id=$1 AND kind='entry_refund'", [gid])).rows;
    assert.equal(refunds.length, 0);
  } finally {
    usage.clearPresenceForTest();
    await s.stop();
  }
});
