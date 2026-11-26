'use strict';
// Large post-redenomination balances must settle and allow a meeting to end.
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, client, signupPayload } = require('./helpers/server');
const db = require('../db');
const skip = process.env.DB_DRIVER !== 'sqlite' && !process.env.DATABASE_URL;

test('PAYSTACK_PASS_FEES_CONFIRMED is case-insensitive and trimmed', () => {
  const { passFeesConfirmed } = require('../src/features/wallet/paystack');
  const prev = process.env.PAYSTACK_PASS_FEES_CONFIRMED;
  try {
    process.env.PAYSTACK_PASS_FEES_CONFIRMED = ' TRUE ';
    assert.equal(passFeesConfirmed(), true);
    process.env.PAYSTACK_PASS_FEES_CONFIRMED = 'TRUE';
    assert.equal(passFeesConfirmed(), true);
    process.env.PAYSTACK_PASS_FEES_CONFIRMED = 'True';
    assert.equal(passFeesConfirmed(), true);
    process.env.PAYSTACK_PASS_FEES_CONFIRMED = 'false';
    assert.equal(passFeesConfirmed(), false);
    process.env.PAYSTACK_PASS_FEES_CONFIRMED = '';
    assert.equal(passFeesConfirmed(), false);
  } finally {
    if (prev === undefined) delete process.env.PAYSTACK_PASS_FEES_CONFIRMED;
    else process.env.PAYSTACK_PASS_FEES_CONFIRMED = prev;
  }
});

test('a wallet above the int4 limit can be settled and the meeting can still end', { skip, timeout: 60000 }, async () => {
  const s = await boot();
  const host = client(s.base);
  try {
    const signup = await host.post('/api/signup', signupPayload());
    assert.ok([200, 201].includes(signup.status), JSON.stringify(signup.body));
    const userId = (await host.get('/api/session')).body.user.id;
    const big = 9855470165; // ~164k credits; overflows PostgreSQL integer
    await db.q('UPDATE credit_wallets SET balance_units=$2 WHERE user_id=$1', [userId, big]);
    const opened = await host.post('/api/create', { name: 'Overflow settle' });
    assert.equal(opened.status, 200, JSON.stringify(opened.body));
    const code = opened.body.code;
    const session = (await db.q('SELECT * FROM credit_billing_sessions WHERE user_id=$1 AND state=$2', [userId, 'active'])).rows[0];
    assert.ok(session);
    // Bill past the free window so settle writes the wallet.
    const now = Date.now();
    await db.q('UPDATE credit_billing_sessions SET free_until_ms=$2, accounted_ms=$2 WHERE id=$1', [session.id, now - 60 * 1000]);
    const data = require('../src/features/wallet/billing-data');
    const settled = await data.settle(session.id, { now, publishers: 2, viewers: 0 });
    assert.ok(settled, 'settle should return a session');
    const wallet = (await db.q('SELECT balance_units FROM credit_wallets WHERE user_id=$1', [userId])).rows[0];
    assert.ok(Number(wallet.balance_units) > 2_147_483_647, 'balance stays above the int4 max');
    assert.ok(Number(wallet.balance_units) < big, 'usage was debited');
    const ended = await host.post(`/api/meeting/${code}/end`);
    assert.ok(ended.status === 200 || ended.status === 204, JSON.stringify(ended.body));
  } finally {
    await s.stop();
  }
});

test('billing.end does not throw when settle fails', async () => {
  const data = require('../src/features/wallet/billing-data');
  const billing = require('../src/features/wallet/billing');
  const orig = data.settle;
  data.settle = async () => { throw new Error('value "9855470165" is out of range for type integer'); };
  try {
    const out = await billing.end({ billingId: 83, code: 'cdry5w' }, 'ended');
    assert.equal(out, null);
  } finally { data.settle = orig; }
});
