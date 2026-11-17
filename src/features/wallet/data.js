const crypto = require('node:crypto');
const { q, tx } = require('../../../db');
const { UNITS_PER_CREDIT: U, fail } = require('./rules');
const one = async (sql, args) => (await q(sql, args)).rows[0] || null;
const credits = (value) => Number(value) / U;
const paymentOut = (p) => ({ reference: p.reference, credits: credits(p.credit_units), priceKobo: Number(p.price_kobo), currency: p.currency, status: p.status, createdAt: p.created_at, paidAt: p.paid_at, authorizationUrl: p.authorization_url || null });
const getPayment = (ref) => one('SELECT * FROM credit_payments WHERE reference=$1', [ref]);
async function balance(userId) {
  const row = await one('SELECT balance_units FROM credit_wallets WHERE user_id=$1', [userId]);
  return credits(row ? row.balance_units : 0);
}
async function createPayment(user, quote, mode) {
  const ref = '1v-' + crypto.randomBytes(16).toString('hex');
  return one(`INSERT INTO credit_payments (reference,user_id,payer_email,credit_units,price_kobo,provider_mode)
    VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [ref, user.id, user.email.toLowerCase(), quote.credits * U, quote.priceKobo, mode]);
}
async function checkoutReady(ref, url) {
  await q('UPDATE credit_payments SET authorization_url=$2 WHERE reference=$1', [ref, url]);
}
async function mark(ref, status, error = null) {
  await q("UPDATE credit_payments SET status=$2,last_error=$3 WHERE reference=$1 AND status<>'paid'", [ref, status, error]);
}
async function settle(purchase, verified) {
  return tx(async (c) => {
    // Lock the account before the wallet so account deletion and settlement agree on ownership.
    const user = (await c.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [purchase.user_id])).rows[0];
    if (!user) throw fail(409, 'This payment needs support review because its account is unavailable');
    const payment = (await c.query('SELECT * FROM credit_payments WHERE reference=$1 FOR UPDATE', [purchase.reference])).rows[0];
    if (payment.status === 'paid') return paymentOut(payment);
    await require('./billing-data').reconcileLocked(c, user.id);
    await c.query('INSERT INTO credit_wallets(user_id) VALUES ($1) ON CONFLICT DO NOTHING', [user.id]);
    const wallet = (await c.query(`UPDATE credit_wallets SET balance_units=balance_units+$2,updated_at=NOW()
      WHERE user_id=$1 AND balance_units<=$3 RETURNING balance_units`, [user.id, Number(payment.credit_units), Number.MAX_SAFE_INTEGER - Number(payment.credit_units)])).rows[0];
    if (!wallet) throw fail(409, 'This purchase would exceed the wallet balance limit');
    const paid = (await c.query(`UPDATE credit_payments SET status='paid',provider_id=$2,amount_paid_kobo=$3,fee_paid_kobo=$4,paid_at=NOW(),last_error=NULL
      WHERE id=$1 RETURNING *`, [payment.id, String(verified.id), verified.amount, verified.fees])).rows[0];
    await c.query(`INSERT INTO credit_ledger(user_id,payment_id,kind,delta_units,balance_after_units)
      VALUES ($1,$2,'purchase',$3,$4)`, [user.id, payment.id, payment.credit_units, wallet.balance_units]);
    return paymentOut(paid);
  });
}
async function payments(userId, before) {
  if (before != null && (!/^\d{1,15}$/.test(String(before)) || Number(before) < 1)) throw fail(400, 'Invalid purchase page');
  const rows = (await q(`SELECT * FROM credit_payments WHERE user_id=$1 ${before ? 'AND id<$2' : ''} ORDER BY id DESC LIMIT 51`, before ? [userId, before] : [userId])).rows;
  const page = rows.slice(0, 50);
  return { payments: page.map(paymentOut), nextBefore: rows.length > 50 ? String(page[page.length - 1].id) : null };
}
async function history(userId, before) {
  if (before != null && (!/^\d{1,15}$/.test(String(before)) || Number(before) < 1)) throw fail(400, 'Invalid history page');
  const rows = (await q(`SELECT l.*,p.reference,b.code AS meeting_code FROM credit_ledger l LEFT JOIN credit_payments p ON p.id=l.payment_id LEFT JOIN credit_billing_sessions b ON b.id=l.billing_session_id
    WHERE l.user_id=$1 ${before ? 'AND l.id<$2' : ''} ORDER BY l.id DESC LIMIT 31`, before ? [userId, before] : [userId])).rows;
  const page = rows.slice(0, 30);
  return { entries: page.map((r) => ({ id: String(r.id), type: r.kind, credits: credits(r.delta_units), balanceAfter: credits(r.balance_after_units), reference: r.reference, meetingCode: r.meeting_code || null, createdAt: r.created_at })), nextBefore: rows.length > 30 ? String(page[page.length - 1].id) : null };
}
async function assertCanDelete(c, userId) {
  const wallet = (await c.query('SELECT balance_units FROM credit_wallets WHERE user_id=$1', [userId])).rows[0];
  const unsettled = (await c.query("SELECT 1 FROM credit_payments WHERE user_id=$1 AND status IN ('pending','review') LIMIT 1", [userId])).rows[0];
  const active = (await c.query("SELECT id FROM credit_billing_sessions WHERE user_id=$1 AND state<>'closed' LIMIT 1", [userId])).rows[0];
  if (Number(wallet?.balance_units || 0) > 0 || unsettled || active) throw fail(409, 'Resolve your credit balance and unfinished purchases before deleting your account. Please contact support if you need help.');
}
module.exports = { assertCanDelete, balance, createPayment, getPayment, checkoutReady, mark, settle, payments, history, paymentOut };
