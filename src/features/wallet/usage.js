/**
 * Per-usage Paid Entry metering. Everyone (host included) is billed from their
 * own credits at the room rate (MEETING_ROOM_CREDITS_PER_MIN, default 1.5)
 * for time actually connected to LiveKit. Reconnect gaps up to ~30s are not billed.
 * A 2-minute low-balance grace, then removal. Participant usage: host share is
 * PAID_ENTRY_HOST_SHARE_BPS (default 80%), the rest is platform. The host's own
 * usage is a platform charge (the room rate).
 */
const db = require('../../../db');
const config = require('../../config');
const { fail, openMeetingConflict, UNITS_PER_CREDIT: U } = require('./rules');
const rates = require('./rates');
const split = (net) => rates.splitHostShare(net);

const one = async (sql, args) => (await db.q(sql, args)).rows[0] || null;
const many = async (sql, args) => (await db.q(sql, args)).rows;

const reconnectMs = () => config.WALLET_USAGE.reconnectGraceMs;
const graceMs = () => config.WALLET_USAGE.lowBalanceGraceMs;
const switchMs = () => config.WALLET_USAGE.switchAcceptMs;

/** 1 credit = 1 minute = 60_000 units, so 1 unit is 1 millisecond. */
function debitable(fromMs, toMs) {
  return Math.max(0, Math.floor(toMs) - Math.floor(fromMs));
}

function isUsage(sessionOrMeeting) {
  if (!sessionOrMeeting) return false;
  if (sessionOrMeeting.billing_model) return sessionOrMeeting.billing_model === 'usage';
  const pe = sessionOrMeeting.paidEntry || sessionOrMeeting;
  return !!(pe && (pe.model === 'usage' || pe.billingModel === 'usage'));
}

function publicPaid(session) {
  if (!session) return null;
  const usage = session.billing_model === 'usage';
  return {
    enabled: true,
    model: usage ? 'usage' : 'entry',
    entryCredits: usage ? null : Number(session.entry_units) / U,
    durationMin: usage ? null : Number(session.duration_min),
    startedMs: Number(session.started_ms),
    advertisedEndMs: usage ? null : Number(session.advertised_end_ms),
    runtimeEndMs: usage ? null : Number(session.runtime_end_ms),
    rateCreditsPerMin: rates.roomCreditsPerMin(),
    switchDeadlineMs: session.switch_deadline_ms == null ? null : Number(session.switch_deadline_ms),
  };
}

async function openUsage({ code, historyId, hostUserId, startedMs = Date.now(), ownerId = null }) {
  const far = startedMs + 100 * 365 * 24 * 3600 * 1000;
  return db.tx(async (c) => {
    await c.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [hostUserId]);
    const openRoom = (await c.query(`SELECT code, history_id FROM credit_billing_sessions WHERE user_id=$1 AND state='active'
      UNION ALL SELECT code, history_id FROM paid_meeting_sessions WHERE host_user_id=$1 AND state='active' LIMIT 1`, [hostUserId])).rows[0];
    if (openRoom) throw openMeetingConflict(openRoom);
    const row = (await c.query(`INSERT INTO paid_meeting_sessions(code,history_id,host_user_id,entry_units,duration_min,started_ms,advertised_end_ms,runtime_end_ms,billing_model,owner_id,owner_heartbeat_ms)
      VALUES($1,$2,$3,1,1,$4,$5,$5,'usage',$6,$4) RETURNING *`, [code, historyId, hostUserId, startedMs, far, ownerId])).rows[0];
    return publicPaid(row);
  }).catch((e) => {
    if (e.code === '23505') throw fail(409, 'You already have an open meeting. End it before opening another.');
    throw e;
  });
}

async function session(code) {
  return one('SELECT * FROM paid_meeting_sessions WHERE code=$1', [code]);
}

/**
 * Admit a signed-in user for usage billing: no upfront charge. Creates the
 * entry + meter. Billing starts when they are marked connected (or immediately
 * for the host).
 */
async function acceptUsage({ code, userId, participantId, isHost = false, now = Date.now(), startNow = false }) {
  if (!userId) throw fail(401, 'Sign in before joining this paid-entry meeting');
  return db.tx(async (c) => {
    if (!(await c.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [userId])).rows[0]) {
      throw fail(401, 'Sign in before joining this paid-entry meeting');
    }
    const sess = (await c.query('SELECT * FROM paid_meeting_sessions WHERE code=$1 FOR UPDATE', [code])).rows[0];
    if (!sess || sess.state !== 'active') throw fail(410, 'This paid-entry meeting has ended');
    if (sess.billing_model !== 'usage') throw fail(409, 'This meeting uses prepaid entry');
    await c.query('INSERT INTO credit_wallets(user_id) VALUES($1) ON CONFLICT DO NOTHING', [userId]);
    const wallet = (await c.query('SELECT balance_units FROM credit_wallets WHERE user_id=$1 FOR UPDATE', [userId])).rows[0];
    const balance = Number(wallet?.balance_units || 0);
    if (!isHost && balance < 1) throw fail(402, 'Add credits to your wallet to join this paid-entry meeting.');
    if (isHost && balance < 1) throw fail(402, 'Add credits to your wallet to host a paid-entry meeting.');
    let entry = (await c.query('SELECT * FROM paid_meeting_entries WHERE code=$1 AND user_id=$2 FOR UPDATE', [code, userId])).rows[0];
    if (entry) {
      await c.query('UPDATE paid_meeting_entries SET participant_id=$2,last_kicked_at_ms=NULL WHERE id=$1', [entry.id, participantId]);
    } else {
      entry = (await c.query(`INSERT INTO paid_meeting_entries(code,user_id,participant_id,entry_units,accepted_at_ms)
        VALUES($1,$2,$3,0,$4) RETURNING *`, [code, userId, participantId, now])).rows[0];
    }
    let meter = (await c.query("SELECT * FROM paid_usage_meters WHERE code=$1 AND user_id=$2 AND state<>'closed' FOR UPDATE", [code, userId])).rows[0];
    const live = startNow ? 'active' : 'active';
    if (meter) {
      await c.query(`UPDATE paid_usage_meters SET participant_id=$2,entry_id=$3,is_host=$4,state=$5,accepted_ms=COALESCE(accepted_ms,$6),
        connected_since_ms=CASE WHEN $7 THEN $6 ELSE connected_since_ms END,
        accounted_ms=CASE WHEN $7 THEN $6 ELSE accounted_ms END
        WHERE id=$1`, [meter.id, participantId, entry.id, !!isHost, live, now, startNow]);
    } else {
      meter = (await c.query(`INSERT INTO paid_usage_meters(code,entry_id,user_id,participant_id,is_host,state,accepted_ms,connected_since_ms,accounted_ms,last_seen_ms)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8,$8) RETURNING *`, [code, entry.id, userId, participantId, !!isHost, live, now, startNow ? now : 0])).rows[0];
    }
    return { charged: false, credits: 0, model: 'usage', entryId: Number(entry.id), meterId: Number(meter.id) };
  });
}

async function offerSwitch({ code, hostUserId, now = Date.now(), ownerId = null }) {
  const deadline = now + switchMs();
  const far = now + 100 * 365 * 24 * 3600 * 1000;
  return db.tx(async (c) => {
    if (!(await c.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [hostUserId])).rows[0]) throw fail(401, 'Sign in to switch this meeting to Paid Entry');
    await c.query('INSERT INTO credit_wallets(user_id) VALUES($1) ON CONFLICT DO NOTHING', [hostUserId]);
    const wallet = (await c.query('SELECT balance_units FROM credit_wallets WHERE user_id=$1 FOR UPDATE', [hostUserId])).rows[0];
    if (Number(wallet?.balance_units || 0) < 1) throw fail(402, 'Add credits to your wallet before switching to Paid Entry.');
    const existing = (await c.query('SELECT * FROM paid_meeting_sessions WHERE code=$1 FOR UPDATE', [code])).rows[0];
    if (existing && existing.state === 'active' && existing.billing_model === 'usage') {
      return { session: publicPaid(existing), already: true };
    }
    if (existing && existing.state === 'active') throw fail(409, 'This meeting already has prepaid paid entry');
    const history = (await c.query('SELECT history_id, user_id FROM credit_billing_sessions WHERE code=$1 AND state=$2', [code, 'active'])).rows[0]
      || (await c.query('SELECT id AS history_id FROM meeting_history WHERE code=$1 ORDER BY id DESC LIMIT 1', [code])).rows[0];
    if (!history) throw fail(404, 'Meeting not found');
    const row = (await c.query(`INSERT INTO paid_meeting_sessions(code,history_id,host_user_id,entry_units,duration_min,started_ms,advertised_end_ms,runtime_end_ms,billing_model,owner_id,owner_heartbeat_ms,switch_deadline_ms)
      VALUES($1,$2,$3,1,1,$4,$5,$5,'usage',$6,$4,$7) RETURNING *`, [code, history.history_id || history.id, hostUserId, now, far, ownerId, deadline])).rows[0];
    if (history.user_id != null || true) {
      await c.query(`UPDATE credit_billing_sessions SET deferred=1, accounted_ms=GREATEST(accounted_ms,$2) WHERE code=$1 AND state='active'`, [code, now]);
    }
    return { session: publicPaid(row), deadlineMs: deadline };
  });
}

async function claimSession(code, ownerId, now = Date.now()) {
  const adopt = config.RESTART.adoptGraceMs;
  return db.tx(async (c) => {
    const row = (await c.query('SELECT * FROM paid_meeting_sessions WHERE code=$1 FOR UPDATE', [code])).rows[0];
    if (!row || row.state !== 'active' || row.billing_model !== 'usage') return null;
    if (row.owner_id && String(row.owner_id) !== String(ownerId)) {
      const worker = (await c.query('SELECT * FROM credit_billing_workers WHERE id=$1', [row.owner_id])).rows[0];
      if (worker && !worker.stopped && now - Number(worker.heartbeat_ms) < adopt) return null;
    }
    return (await c.query('UPDATE paid_meeting_sessions SET owner_id=$2, owner_heartbeat_ms=$3 WHERE code=$1 RETURNING *', [code, ownerId, now])).rows[0];
  });
}

async function applyPresence(meter, connected, now) {
  const grace = reconnectMs();
  if (connected) {
    if (meter.state === 'closed' || meter.state === 'pending') return meter;
    if (meter.state === 'paused' || (meter.disconnected_ms && !meter.connected_since_ms)) {
      // Resume now; never bill the gap (whether it was 2s or 40s).
      return one(`UPDATE paid_usage_meters SET state=CASE WHEN state='grace' THEN 'grace' ELSE 'active' END,
        connected_since_ms=$2, accounted_ms=$2, last_seen_ms=$2, disconnected_ms=NULL WHERE id=$1 AND state<>'closed' RETURNING *`, [meter.id, now]);
    }
    if (meter.state === 'active' || meter.state === 'grace') {
      if (!Number(meter.connected_since_ms)) {
        return one('UPDATE paid_usage_meters SET connected_since_ms=$2, accounted_ms=CASE WHEN accounted_ms=0 THEN $2 ELSE accounted_ms END, last_seen_ms=$2 WHERE id=$1 RETURNING *', [meter.id, now]);
      }
      return one('UPDATE paid_usage_meters SET last_seen_ms=$2 WHERE id=$1 RETURNING *', [meter.id, now]);
    }
    return meter;
  }
  // disconnected
  if (meter.state === 'closed' || meter.state === 'pending' || meter.state === 'paused') return meter;
  if (!Number(meter.connected_since_ms)) return meter; // not seen on the media server yet
  if (meter.disconnected_ms && now - Number(meter.disconnected_ms) <= grace && meter.state !== 'active') return meter;
  const through = Number(meter.connected_since_ms) ? now : Number(meter.accounted_ms);
  return one(`UPDATE paid_usage_meters SET state='paused', disconnected_ms=$2, last_seen_ms=$2 WHERE id=$1 AND state<>'closed' RETURNING *`, [meter.id, through]);
}

async function settleMeter(meter, now, { end = false, hostUserId } = {}) {
  if (!meter || meter.state === 'closed' || meter.state === 'pending') return { meter, kick: false, debit: 0 };
  const connected = meter.state === 'active' || meter.state === 'grace'
    ? Number(meter.connected_since_ms) && !meter.disconnected_ms
    : false;
  const endpoint = connected ? now : (Number(meter.disconnected_ms) || Number(meter.accounted_ms) || now);
  const from = Math.max(Number(meter.accounted_ms) || 0, Number(meter.connected_since_ms) || 0);
  const elapsed = debitable(from, endpoint);
  return db.tx(async (c) => {
    const row = (await c.query('SELECT * FROM paid_usage_meters WHERE id=$1 FOR UPDATE', [meter.id])).rows[0];
    if (!row || row.state === 'closed' || row.state === 'pending') return { meter: row, kick: false, debit: 0 };
    if (row.user_id) await c.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [row.user_id]);
    const wallet = row.user_id ? (await c.query('SELECT balance_units FROM credit_wallets WHERE user_id=$1 FOR UPDATE', [row.user_id])).rows[0] : null;
    const available = Math.max(0, Number(wallet?.balance_units || 0));
    const already = Math.max(Number(row.accounted_ms) || 0, Number(row.connected_since_ms) || 0);
    const endAt = row.state === 'paused' ? (Number(row.disconnected_ms) || already) : (Number(row.connected_since_ms) && !row.disconnected_ms ? now : (Number(row.disconnected_ms) || already));
    if (row.user_id) await require('./spend').syncPlanLocked(c, row.user_id, new Date(now));
    const walletFresh = row.user_id ? (await c.query('SELECT * FROM credit_wallets WHERE user_id=$1 FOR UPDATE', [row.user_id])).rows[0] : wallet;
    const available2 = Math.max(0, Number(walletFresh?.balance_units || 0));
    const elapsed = debitable(already, endAt);
    const want = rates.paidEntryUnitsForElapsed(elapsed);
    const debit = Math.min(want, available2);
    const through = already + (want ? Math.floor(elapsed * (debit / want)) : elapsed);
    const balance = available2 - debit;
    if (debit > 0 && row.user_id && row.entry_id) {
      const planUnits = Math.max(0, Number(walletFresh.plan_balance_units || 0));
      const nextPlan = Math.max(0, planUnits - Math.min(planUnits, debit));
      const nextUsed = Number(walletFresh.period_used_units || 0) + debit;
      await c.query('UPDATE credit_wallets SET balance_units=$2,plan_balance_units=$3,period_used_units=$4,updated_at=NOW() WHERE user_id=$1', [row.user_id, balance, nextPlan, nextUsed]);
      await c.query(`INSERT INTO credit_ledger(user_id,paid_entry_id,through_ms,kind,delta_units,balance_after_units)
        VALUES($1,$2,$3,'participant_usage',$4,$5)`, [row.user_id, row.entry_id, through, -debit, balance]);
      await c.query('UPDATE paid_meeting_entries SET entry_units=entry_units+$2 WHERE id=$1', [row.entry_id, debit]);
      if (!row.is_host) {
        const sess = (await c.query('SELECT host_user_id FROM paid_meeting_sessions WHERE code=$1', [row.code])).rows[0];
        const hid = hostUserId || sess?.host_user_id;
        const parts = split(debit);
        const earning = (await c.query('SELECT * FROM paid_meeting_earnings WHERE entry_id=$1 FOR UPDATE', [row.entry_id])).rows[0];
        if (earning) {
          await c.query('UPDATE paid_meeting_earnings SET gross_units=gross_units+$2, host_units=host_units+$3, platform_units=platform_units+$4 WHERE id=$1',
            [earning.id, debit, parts.host, parts.platform]);
        } else {
          await c.query(`INSERT INTO paid_meeting_earnings(entry_id,code,host_user_id,gross_units,host_units,platform_units,state)
            VALUES($1,$2,$3,$4,$5,$6,'pending')`, [row.entry_id, row.code, hid, debit, parts.host, parts.platform]);
        }
      }
    }
    let state = row.state;
    let graceUntil = row.grace_until_ms == null ? null : Number(row.grace_until_ms);
    let kick = false;
    if (end) {
      state = 'closed';
    } else if (row.state !== 'paused' && balance === 0 && (want > debit || available2 === 0)) {
      if (!graceUntil) graceUntil = now + graceMs();
      state = 'grace';
      if (now >= graceUntil) { kick = true; state = 'closed'; }
    } else if (row.state === 'grace' && balance > 0) {
      state = 'active';
      graceUntil = null;
    } else if (row.state === 'grace' && graceUntil && now >= graceUntil) {
      kick = true;
      state = 'closed';
    }
    const updated = (await c.query(`UPDATE paid_usage_meters SET accounted_ms=$2, billed_units=billed_units+$3, state=$4, grace_until_ms=$5 WHERE id=$1 RETURNING *`,
      [row.id, through, debit, state, graceUntil])).rows[0];
    return { meter: updated, kick, debit, graceUntilMs: graceUntil, lowBalance: state === 'grace' };
  });
}

async function finalizeUsage(code, endedMs = Date.now(), { skipUnaccounted = false } = {}) {
  if (!skipUnaccounted) {
    const meters = await many("SELECT * FROM paid_usage_meters WHERE code=$1 AND state<>'closed'", [code]);
    for (const m of meters) {
      await settleMeter(m, endedMs, { end: true }).catch((e) => console.warn('[usage] finalize', m.id, e.message));
    }
  }
  await db.tx(async (c) => {
    await c.query("UPDATE paid_meeting_sessions SET state='settled', ended_ms=$2 WHERE code=$1 AND state='active'", [code, endedMs]);
    await c.query("UPDATE paid_usage_meters SET state='closed' WHERE code=$1 AND state<>'closed'", [code]);
    await c.query("UPDATE paid_meeting_earnings SET state='available', settled_at=NOW() WHERE code=$1 AND state='pending' AND gross_units>0", [code]);
  });
}

async function connectedIdentities(meeting) {
  const room = meeting?.mediaRoom || meeting?.code;
  const { roomClient } = require('../../livekit/cleanup');
  const client = roomClient();
  if (client && room) {
    try {
      const list = await client.listParticipants(room);
      return new Set((list || []).map((p) => p.identity || p.sid).filter(Boolean));
    } catch (e) {
      if (e && (e.status === 404 || e.code === 'not_found' || e.statusCode === 404)) return new Set();
      console.warn('[usage] listParticipants', meeting.code, e.message);
    }
  }
  // No LiveKit (local/dev/tests): treat ACTIVE in-process participants as connected.
  const ids = new Set();
  if (meeting?.participants) {
    for (const [id, p] of meeting.participants) if (p && p.status === 'ACTIVE') ids.add(id);
  }
  if (presenceOverride.has(meeting?.code)) return presenceOverride.get(meeting.code);
  return ids;
}

const presenceOverride = new Map();
function setPresenceForTest(code, ids) { presenceOverride.set(code, new Set(ids || [])); }
function clearPresenceForTest(code) { if (code) presenceOverride.delete(code); else presenceOverride.clear(); }

async function kickParticipant(meeting, participantId, reason) {
  if (!meeting || !participantId) return;
  const p = meeting.participants.get(participantId);
  if (p) p.status = 'LEFT';
  try {
    const { getClient, deleteClient } = require('../../rooms/store');
    const { broadcast } = require('../../rooms/store');
    const ws = getClient(participantId);
    if (ws) {
      ws.send(JSON.stringify({ type: 'kicked', reason: reason || 'credits', paidUsage: true }));
      ws.close();
      deleteClient(participantId);
    }
    // store.broadcast may differ; use hub broadcast if needed
  } catch (e) { console.warn('[usage] kick send', e.message); }
  try {
    const { roomClient } = require('../../livekit/cleanup');
    const client = roomClient();
    if (client && meeting.mediaRoom) await client.removeParticipant(meeting.mediaRoom, participantId);
  } catch (e) {
    if (!(e && (e.status === 404 || e.code === 'not_found'))) console.warn('[usage] removeParticipant', e.message);
  }
}

async function tick({ ownerId, now = Date.now() } = {}) {
  const rows = await many(`SELECT p.* FROM paid_meeting_sessions p JOIN meeting_history h ON h.id=p.history_id
    WHERE p.state='active' AND p.billing_model='usage' AND h.ended_at IS NULL`, []);
  const due = [];
  const store = require('../../rooms/store');
  for (const row of rows) {
    const claimed = await claimSession(row.code, ownerId, now).catch(() => null);
    if (!claimed) continue;
    due.push(claimed);
  }
  // Sweep switch deadlines even if we just claimed.
  for (const sess of due) {
    let meeting = store.getMeeting(sess.code);
    if (!meeting) {
      try { meeting = await require('../../rooms/snapshot').getOrRestoreMeeting(sess.code); } catch { meeting = null; }
    }
    if (!meeting || Number(meeting.historyId) !== Number(sess.history_id)) continue;
    const connected = await connectedIdentities(meeting);
    const meters = await many("SELECT * FROM paid_usage_meters WHERE code=$1 AND state<>'closed'", [sess.code]);
    for (const m of meters) {
      const isOn = connected.has(m.participant_id);
      let cur = m;
      if (m.state !== 'pending') cur = await applyPresence(m, isOn, now) || m;
      // Pending people who missed the switch deadline are removed.
      if (m.state === 'pending' && sess.switch_deadline_ms && now >= Number(sess.switch_deadline_ms)) {
        await db.q("UPDATE paid_usage_meters SET state='closed' WHERE id=$1", [m.id]);
        if (meeting) await kickParticipant(meeting, m.participant_id, 'switch-timeout');
        continue;
      }
      if (cur.state === 'pending') continue;
      const result = await settleMeter(cur, now, { hostUserId: sess.host_user_id }).catch((e) => {
        console.warn('[usage] settle', m.id, e.message);
        return { meter: cur, kick: false };
      });
      if (result.lowBalance && meeting) {
        try {
          const { getClient } = require('../../rooms/store');
          const ws = getClient(result.meter.participant_id);
          if (ws) ws.send(JSON.stringify({ type: 'paid-usage-low-balance', graceUntilMs: result.graceUntilMs, remainingCredits: 0 }));
        } catch { /* */ }
      }
      if (result.kick && meeting) await kickParticipant(meeting, result.meter.participant_id, 'credits');
    }
  }
}

async function mediaGate(code, participant) {
  if (!participant || !participant.userId) return { ok: false, status: 401, error: 'Sign in to continue in this paid-entry meeting' };
  const meter = await one("SELECT * FROM paid_usage_meters WHERE code=$1 AND user_id=$2 AND state<>'closed'", [code, participant.userId]);
  if (!meter || meter.state === 'pending') return { ok: false, status: 403, error: 'Accept Paid Entry to continue' };
  if (meter.state === 'closed') return { ok: false, status: 410, error: 'Your paid-entry session has ended' };
  if (meter.state === 'grace') {
    const left = Math.max(0, Number(meter.grace_until_ms) - Date.now());
    if (left <= 0) return { ok: false, status: 402, error: 'Add credits to continue', topUp: true, graceUntilMs: Number(meter.grace_until_ms) };
    return { ok: true, ttl: Math.max(1, Math.min(60, Math.ceil(left / 1000))), graceUntilMs: Number(meter.grace_until_ms) };
  }
  const bal = Number((await one('SELECT balance_units FROM credit_wallets WHERE user_id=$1', [participant.userId]))?.balance_units || 0);
  return { ok: true, ttl: Math.max(1, Math.min(60, Math.floor(bal / 1000) || 15)) };
}

async function markPending(code, { userId, participantId, now = Date.now() }) {
  if (!userId) {
    await db.q(`INSERT INTO paid_usage_meters(code,user_id,participant_id,is_host,state) VALUES($1,NULL,$2,false,'pending')`, [code, participantId]);
    return;
  }
  const existing = await one("SELECT * FROM paid_usage_meters WHERE code=$1 AND user_id=$2 AND state<>'closed'", [code, userId]);
  if (existing) {
    await db.q('UPDATE paid_usage_meters SET participant_id=$2, state=$3 WHERE id=$1', [existing.id, participantId, existing.accepted_ms ? existing.state : 'pending']);
    return existing;
  }
  return one(`INSERT INTO paid_usage_meters(code,user_id,participant_id,is_host,state) VALUES($1,$2,$3,false,'pending') RETURNING *`, [code, userId, participantId]);
}

module.exports = {
  debitable, isUsage, publicPaid, openUsage, session, acceptUsage, offerSwitch,
  claimSession, applyPresence, settleMeter, finalizeUsage, connectedIdentities,
  tick, markPending, mediaGate, setPresenceForTest, clearPresenceForTest, kickParticipant,
  reconnectMs, graceMs, switchMs,
};
