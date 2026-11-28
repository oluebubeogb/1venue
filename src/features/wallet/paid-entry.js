/** Paid meeting admission, proportional refunds and host credit earnings. */
const db = require('../../../db');
const { fail, openMeetingConflict, UNITS_PER_CREDIT: U } = require('./rules');

const one = async (sql, args) => (await db.q(sql, args)).rows[0] || null;
const units = (credits) => {
  const n = Number(credits);
  if (!Number.isSafeInteger(n) || n < 1 || n > Math.floor(Number.MAX_SAFE_INTEGER / U)) throw fail(400, 'Entry price must be a positive whole number of credits');
  return n * U;
};
const split = (net) => {
  const host = Math.floor(net * 0.8);
  return { host, platform: net - host };
};
const sessionOut = (r) => r && ({ code: r.code, historyId: Number(r.history_id), hostUserId: Number(r.host_user_id), entryUnits: Number(r.entry_units), entryCredits: Number(r.entry_units) / U, durationMin: Number(r.duration_min), startedMs: Number(r.started_ms), advertisedEndMs: Number(r.advertised_end_ms), runtimeEndMs: Number(r.runtime_end_ms), endedMs: r.ended_ms == null ? null : Number(r.ended_ms), state: r.state, billingModel: r.billing_model || 'entry', switchDeadlineMs: r.switch_deadline_ms == null ? null : Number(r.switch_deadline_ms) });

async function open({ code, historyId, hostUserId, entryCredits, durationMin, startedMs = Date.now() }) {
  const duration = Number(durationMin);
  if (!Number.isInteger(duration) || duration < 1 || duration > 720) throw fail(400, 'Advertised duration must be 1 to 720 minutes');
  const entryUnits = units(entryCredits);
  const end = startedMs + duration * 60000;
  return db.tx(async (c) => {
    await c.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [hostUserId]);
    const openRoom = (await c.query(`SELECT code, history_id FROM credit_billing_sessions WHERE user_id=$1 AND state='active'
      UNION ALL SELECT code, history_id FROM paid_meeting_sessions WHERE host_user_id=$1 AND state='active' LIMIT 1`, [hostUserId])).rows[0];
    if (openRoom) throw openMeetingConflict(openRoom);
    const row = (await c.query(`INSERT INTO paid_meeting_sessions(code,history_id,host_user_id,entry_units,duration_min,started_ms,advertised_end_ms,runtime_end_ms)
      VALUES($1,$2,$3,$4,$5,$6,$7,$7) RETURNING *`, [code, historyId, hostUserId, entryUnits, duration, startedMs, end])).rows[0];
    return sessionOut(row);
  }).catch((e) => {
    if (e.code === '23505') throw fail(409, 'You already have an open meeting. End it before opening another.');
    throw e;
  });
}

const get = async (code) => sessionOut(await one('SELECT * FROM paid_meeting_sessions WHERE code=$1', [code]));
const admission = (code, userId) => one('SELECT * FROM paid_meeting_entries WHERE code=$1 AND user_id=$2', [code, userId]);

/** Charge once per signed-in account and meeting. Reacceptance clears a prior kick marker. */
async function accept({ code, userId, participantId, now = Date.now() }) {
  if (!userId) throw fail(401, 'Sign in before joining this paid-entry meeting');
  const peek = await one('SELECT billing_model, state FROM paid_meeting_sessions WHERE code=$1', [code]);
  if (peek && peek.billing_model === 'usage') return require('./usage').acceptUsage({ code, userId, participantId, now, startNow: false });
  return db.tx(async (c) => {
    const user = (await c.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [userId])).rows[0];
    if (!user) throw fail(401, 'Sign in before joining this paid-entry meeting');
    const session = (await c.query('SELECT * FROM paid_meeting_sessions WHERE code=$1 FOR UPDATE', [code])).rows[0];
    if (!session || session.state !== 'active') throw fail(410, 'This paid-entry meeting has ended');
    const prior = (await c.query('SELECT * FROM paid_meeting_entries WHERE code=$1 AND user_id=$2 FOR UPDATE', [code, userId])).rows[0];
    if (prior) {
      await c.query('UPDATE paid_meeting_entries SET participant_id=$2,last_kicked_at_ms=NULL WHERE id=$1', [prior.id, participantId]);
      return { charged: false, credits: Number(prior.entry_units) / U };
    }
    await c.query('INSERT INTO credit_wallets(user_id) VALUES($1) ON CONFLICT DO NOTHING', [userId]);
    const wallet = (await c.query('SELECT balance_units FROM credit_wallets WHERE user_id=$1 FOR UPDATE', [userId])).rows[0];
    const balance = Number(wallet?.balance_units || 0);
    if (balance < Number(session.entry_units)) throw fail(402, `You need ${Number(session.entry_units) / U} credits to join. Add credits to your wallet, then ask the host to accept you again.`);
    const next = balance - Number(session.entry_units);
    await c.query('UPDATE credit_wallets SET balance_units=$2,updated_at=NOW() WHERE user_id=$1', [userId, next]);
    const entry = (await c.query(`INSERT INTO paid_meeting_entries(code,user_id,participant_id,entry_units,accepted_at_ms)
      VALUES($1,$2,$3,$4,$5) RETURNING *`, [code, userId, participantId, session.entry_units, now])).rows[0];
    await c.query(`INSERT INTO credit_ledger(user_id,paid_entry_id,kind,delta_units,balance_after_units)
      VALUES($1,$2,'entry',$3,$4)`, [userId, entry.id, -Number(session.entry_units), next]);
    const portions = split(Number(session.entry_units));
    await c.query(`INSERT INTO paid_meeting_earnings(entry_id,code,host_user_id,gross_units,host_units,platform_units)
      VALUES($1,$2,$3,$4,$5,$6)`, [entry.id, code, session.host_user_id, session.entry_units, portions.host, portions.platform]);
    return { charged: true, credits: Number(session.entry_units) / U };
  });
}

async function markKicked(code, userId, now = Date.now()) {
  if (!userId) return false;
  const row = await one('UPDATE paid_meeting_entries SET last_kicked_at_ms=$3 WHERE code=$1 AND user_id=$2 RETURNING id', [code, userId, now]);
  return !!row;
}

/** Host buys additional room time at the existing 1 credit per minute rate. Entry charges remain one-time. */
async function extend({ code, hostUserId, minutes, now = Date.now() }) {
  const addMinutes = Number(minutes);
  if (!Number.isInteger(addMinutes) || addMinutes < 1 || addMinutes > 120) throw fail(400, 'Choose 1 to 120 extra minutes');
  const cost = addMinutes * U;
  return db.tx(async (c) => {
    if (!(await c.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [hostUserId])).rows[0]) throw fail(404, 'Host account not found');
    const session = (await c.query('SELECT * FROM paid_meeting_sessions WHERE code=$1 FOR UPDATE', [code])).rows[0];
    if (!session || session.state !== 'active') throw fail(410, 'This paid-entry meeting has ended');
    if (Number(session.host_user_id) !== Number(hostUserId)) throw fail(403, 'Only the host can extend this meeting');
    if (now >= Number(session.runtime_end_ms)) throw fail(410, 'This meeting has already reached its advertised end time');
    await c.query('INSERT INTO credit_wallets(user_id) VALUES($1) ON CONFLICT DO NOTHING', [hostUserId]);
    const wallet = (await c.query('SELECT balance_units FROM credit_wallets WHERE user_id=$1 FOR UPDATE', [hostUserId])).rows[0];
    const balance = Number(wallet.balance_units);
    if (balance < cost) throw fail(402, `You need ${addMinutes} credits to extend this meeting. Add credits to your wallet first.`);
    const next = balance - cost;
    const extension = (await c.query(`INSERT INTO paid_meeting_extensions(code,host_user_id,minutes,units,created_ms)
      VALUES($1,$2,$3,$4,$5) RETURNING id`, [code, hostUserId, addMinutes, cost, now])).rows[0];
    await c.query('UPDATE credit_wallets SET balance_units=$2,updated_at=NOW() WHERE user_id=$1', [hostUserId, next]);
    await c.query(`INSERT INTO credit_ledger(user_id,paid_extension_id,kind,delta_units,balance_after_units)
      VALUES($1,$2,'extension',$3,$4)`, [hostUserId, extension.id, -cost, next]);
    const updated = (await c.query('UPDATE paid_meeting_sessions SET runtime_end_ms=runtime_end_ms+$2 WHERE code=$1 RETURNING *', [code, addMinutes * 60000])).rows[0];
    return { session: sessionOut(updated), balanceCredits: next / U, addedMinutes: addMinutes, creditsCharged: addMinutes };
  });
}

/** Refund unused advertised room time and release the host's 80% share after the room ends. */
async function settle(code, endedMs = Date.now(), { skipUnaccounted = false } = {}) {
  const peek = await one('SELECT * FROM paid_meeting_sessions WHERE code=$1', [code]);
  if (!peek) return null;
  if (peek.state === 'settled') return sessionOut(peek);
  if (peek.billing_model === 'usage') {
    await require('./usage').finalizeUsage(code, endedMs, { skipUnaccounted });
    return sessionOut(await one('SELECT * FROM paid_meeting_sessions WHERE code=$1', [code]));
  }
  return db.tx(async (c) => {
    const session = (await c.query('SELECT * FROM paid_meeting_sessions WHERE code=$1 FOR UPDATE', [code])).rows[0];
    if (!session) return null;
    if (session.state === 'settled') return sessionOut(session);
    const rows = (await c.query(`SELECT e.*,g.id AS earning_id FROM paid_meeting_entries e
      JOIN paid_meeting_earnings g ON g.entry_id=e.id WHERE e.code=$1 ORDER BY e.id FOR UPDATE`, [code])).rows;
    const durationMs = Number(session.duration_min) * 60000;
    const end = Math.min(Number(endedMs), Number(session.advertised_end_ms));
    for (const entry of rows) {
      const refundAt = entry.last_kicked_at_ms == null ? end : Math.min(end, Number(entry.last_kicked_at_ms));
      const remainingMs = Math.max(0, Number(session.advertised_end_ms) - refundAt);
      const refund = Math.min(Number(entry.entry_units), Math.floor(Number(entry.entry_units) * remainingMs / durationMs));
      let after = null;
      if (refund > Number(entry.refund_units)) {
        const delta = refund - Number(entry.refund_units);
        await c.query('INSERT INTO credit_wallets(user_id) VALUES($1) ON CONFLICT DO NOTHING', [entry.user_id]);
        const wallet = (await c.query('SELECT balance_units FROM credit_wallets WHERE user_id=$1 FOR UPDATE', [entry.user_id])).rows[0];
        after = Number(wallet?.balance_units || 0) + delta;
        if (after > Number.MAX_SAFE_INTEGER) throw fail(409, 'Refund would exceed the wallet balance limit');
        await c.query('UPDATE credit_wallets SET balance_units=$2,updated_at=NOW() WHERE user_id=$1', [entry.user_id, after]);
        await c.query(`INSERT INTO credit_ledger(user_id,paid_entry_id,kind,delta_units,balance_after_units)
          VALUES($1,$2,'entry_refund',$3,$4)`, [entry.user_id, entry.id, delta, after]);
      }
      const refundable = Math.max(Number(entry.refund_units), refund);
      const portions = split(Math.max(0, Number(entry.entry_units) - refundable));
      await c.query('UPDATE paid_meeting_entries SET refund_units=$2 WHERE id=$1', [entry.id, refundable]);
      await c.query(`UPDATE paid_meeting_earnings SET refund_units=$2,host_units=$3,platform_units=$4,state='available',settled_at=NOW() WHERE id=$1`, [entry.earning_id, refundable, portions.host, portions.platform]);
    }
    const updated = (await c.query(`UPDATE paid_meeting_sessions SET state='settled',ended_ms=$2 WHERE code=$1 RETURNING *`, [code, endedMs])).rows[0];
    return sessionOut(updated);
  });
}

async function earnings(userId) {
  const row = await one(`SELECT
    COALESCE(SUM(CASE WHEN state='pending' THEN host_units-transferred_units ELSE 0 END),0) AS pending_units,
    COALESCE(SUM(CASE WHEN state='available' THEN host_units-transferred_units ELSE 0 END),0) AS available_units,
    COALESCE(SUM(refund_units),0) AS refunded_units
    FROM paid_meeting_earnings WHERE host_user_id=$1`, [userId]);
  return { pendingCredits: Number(row.pending_units) / U, availableCredits: Number(row.available_units) / U, refundedCredits: Number(row.refunded_units) / U };
}

async function transfer(userId, credits) {
  const amount = Number(credits) * U;
  if (!Number.isSafeInteger(amount) || amount < 1) throw fail(400, 'Enter a positive credit amount');
  return db.tx(async (c) => {
    if (!(await c.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [userId])).rows[0]) throw fail(404, 'Account not found');
    const rows = (await c.query(`SELECT * FROM paid_meeting_earnings WHERE host_user_id=$1 AND state='available'
      AND host_units>transferred_units ORDER BY id FOR UPDATE`, [userId])).rows;
    let available = rows.reduce((sum, r) => sum + Number(r.host_units) - Number(r.transferred_units), 0);
    if (available < amount) throw fail(409, 'That amount is not available to transfer yet');
    await c.query('INSERT INTO credit_wallets(user_id) VALUES($1) ON CONFLICT DO NOTHING', [userId]);
    const wallet = (await c.query('SELECT balance_units FROM credit_wallets WHERE user_id=$1 FOR UPDATE', [userId])).rows[0];
    const balance = Number(wallet.balance_units) + amount;
    if (balance > Number.MAX_SAFE_INTEGER) throw fail(409, 'Transfer would exceed the wallet balance limit');
    const transferRow = (await c.query('INSERT INTO paid_meeting_transfers(user_id,units) VALUES($1,$2) RETURNING id', [userId, amount])).rows[0];
    await c.query('UPDATE credit_wallets SET balance_units=$2,updated_at=NOW() WHERE user_id=$1', [userId, balance]);
    await c.query(`INSERT INTO credit_ledger(user_id,paid_transfer_id,kind,delta_units,balance_after_units)
      VALUES($1,$2,'earning_transfer',$3,$4)`, [userId, transferRow.id, amount, balance]);
    let left = amount;
    for (const row of rows) {
      if (!left) break;
      const take = Math.min(left, Number(row.host_units) - Number(row.transferred_units));
      await c.query('UPDATE paid_meeting_earnings SET transferred_units=transferred_units+$2 WHERE id=$1', [row.id, take]);
      left -= take;
    }
    return { credits: Number(amount) / U, balanceCredits: balance / U };
  });
}

async function tick(now = Date.now()) {
  const usage = require('./usage');
  const ownerId = require('./billing').ownerId;
  await usage.tick({ ownerId, now }).catch((e) => console.warn('[paid usage]', e.message));
  const rows = (await db.q("SELECT code FROM paid_meeting_sessions WHERE state='active' AND COALESCE(billing_model,'entry')<>'usage' AND runtime_end_ms<=$1", [now])).rows;
  const due = new Set(rows.map((row) => row.code));
  for (const [code, meeting] of require('../../rooms/store').allMeetings()) {
    if (meeting._paidEndRequested) due.add(code);
  }
  for (const code of due) {
    let meeting = require('../../rooms/store').getMeeting(code);
    if (!meeting) meeting = await require('../../rooms/snapshot').getOrRestoreMeeting(code).catch(() => null);
    if (meeting) await require('../../rooms/lifecycle').endMeeting(code, meeting._paidEndRequested?.reason || 'advertised-duration-ended').catch((e) => console.warn('[paid entry]', code, e.message));
    else {
      await settle(code, now).catch((e) => console.warn('[paid entry settle]', code, e.message));
      const row = await one('SELECT history_id FROM paid_meeting_sessions WHERE code=$1', [code]).catch(() => null);
      if (row?.history_id) await db.endMeetingHistory(row.history_id).catch(() => {});
    }
  }
}

module.exports = { open, get, admission, accept, markKicked, extend, settle, earnings, transfer, tick, units, split, sessionOut };
