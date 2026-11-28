/**
 * Host end (live or orphaned) and admin end-in-2-min warning.
 * Warning deadline is stored on meeting_history so it survives a restart.
 */
const db = require('../../db');
const { getMeeting, allMeetings, getClient } = require('./store');
const { endMeeting } = require('./lifecycle');

const END_IN_MS = 120000;

function fail(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

function norm(code) {
  return String(code || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function codeMatchSql() {
  return "lower(replace(replace(code,'-',''),' ',''))";
}

function countActive(meeting) {
  if (!meeting || !meeting.participants) return 0;
  let n = 0;
  for (const p of meeting.participants.values()) if (p.status === 'ACTIVE') n++;
  return n;
}

function isHostUser(meeting, history, user) {
  if (!user) return false;
  const uid = Number(user.id);
  if (history && history.host_user_id != null && Number(history.host_user_id) === uid) return true;
  if (meeting && meeting.hostUserId != null && Number(meeting.hostUserId) === uid) return true;
  if (meeting && meeting.participants) {
    for (const p of meeting.participants.values()) {
      if (Number(p.userId) === uid && (p.role === 'host' || p.isHost)) return true;
    }
  }
  return false;
}

function warningFromRow(h) {
  if (!h) return null;
  const deadlineMs = h.end_warning_deadline_ms != null ? Number(h.end_warning_deadline_ms) : null;
  const keptAt = h.end_warning_kept_at || null;
  const requestedBy = h.end_warning_requested_by != null ? Number(h.end_warning_requested_by) : null;
  if (!deadlineMs && !keptAt) return null;
  return { deadlineMs: deadlineMs || null, keptAt, requestedBy };
}

function publicWarning(history, meeting) {
  const w = (meeting && meeting.endWarning) || warningFromRow(history);
  if (!w) return null;
  if (w.keptAt && !w.deadlineMs) return { status: 'kept', keptAt: w.keptAt };
  if (w.cancelledAt && !w.deadlineMs) return { status: 'cancelled', cancelledAt: w.cancelledAt };
  if (!w.deadlineMs) return null;
  return {
    status: 'pending',
    deadlineMs: w.deadlineMs,
    remainingMs: Math.max(0, w.deadlineMs - Date.now()),
    requestedBy: w.requestedBy || null,
  };
}

function warningFor(meeting) {
  if (!meeting) return null;
  return publicWarning({ end_warning_deadline_ms: meeting.endWarning && meeting.endWarning.deadlineMs, end_warning_kept_at: meeting.endWarning && meeting.endWarning.keptAt, end_warning_requested_by: meeting.endWarning && meeting.endWarning.requestedBy }, meeting);
}

function broadcast(code, msg) {
  const meeting = getMeeting(code);
  if (!meeting) return;
  const payload = JSON.stringify(msg);
  for (const [pid] of meeting.participants) {
    const ws = getClient(pid);
    if (ws && ws.readyState === 1) {
      try { ws.send(payload); } catch (_) {}
    }
  }
}

async function findHistoryByCodeOrId(code, historyId) {
  if (historyId) {
    return (await db.q('SELECT * FROM meeting_history WHERE id=$1', [historyId])).rows[0] || null;
  }
  if (!code) return null;
  const n = norm(code);
  return (await db.q(
    `SELECT * FROM meeting_history WHERE ${codeMatchSql()}=$1 ORDER BY created_at DESC LIMIT 1`,
    [n]
  )).rows[0] || null;
}

async function findOpenHistory(code) {
  if (!code) return null;
  return (await db.q(
    `SELECT * FROM meeting_history WHERE ended_at IS NULL AND ${codeMatchSql()}=$1 ORDER BY created_at DESC LIMIT 1`,
    [norm(code)]
  )).rows[0] || null;
}

async function persistWarning(historyId, { deadlineMs = null, keptAt = null, requestedBy = null } = {}) {
  await db.q(
    `UPDATE meeting_history
        SET end_warning_deadline_ms=$2,
            end_warning_kept_at=$3,
            end_warning_requested_by=$4
      WHERE id=$1`,
    [historyId, deadlineMs == null ? null : Number(deadlineMs), keptAt, requestedBy]
  );
}

async function settleOrphanBilling(history, reason) {
  const rows = (await db.q(
    "SELECT * FROM credit_billing_sessions WHERE history_id=$1 AND state<>'closed'",
    [history.id]
  )).rows;
  const billingData = require('../features/wallet/billing-data');
  for (const row of rows) {
    if (row.state === 'active') {
      await billingData.settle(row.id, { now: Number(row.accounted_ms), endReason: reason, skipAutoTopup: true });
    } else {
      await db.q(
        "UPDATE credit_billing_sessions SET state='closed' WHERE id=$1 AND state<>'closed'",
        [row.id]
      );
    }
  }
  const paid = (await db.q(
    "SELECT code FROM paid_meeting_sessions WHERE history_id=$1 AND state='active'",
    [history.id]
  )).rows[0];
  if (paid) {
    const endedMs = history.ended_at ? new Date(history.ended_at).getTime() : Date.now();
    await require('../features/wallet/paid-entry').settle(paid.code, endedMs, { skipUnaccounted: true });
  }
}

async function reconcileEndedHostMeetings(userId) {
  const rows = (await db.q(
    `SELECT h.id, h.code, h.ended_at FROM meeting_history h
       JOIN (
         SELECT history_id FROM credit_billing_sessions WHERE user_id=$1 AND state='active'
         UNION
         SELECT history_id FROM paid_meeting_sessions WHERE host_user_id=$1 AND state='active'
       ) billing ON billing.history_id=h.id
       WHERE h.ended_at IS NOT NULL`,
    [userId]
  )).rows;
  for (const history of rows) {
    const meeting = getMeeting(history.code);
    if (meeting && Number(meeting.historyId) === Number(history.id)) continue;
    await settleOrphanBilling(history, 'history-ended');
  }
}

async function closeOrphan(history, reason) {
  await settleOrphanBilling(history, reason);
  await db.endMeetingHistory(history.id);
  try { await db.ensureArtifactForHistory(history.id, history.code); } catch (_) {}
  await db.q('DELETE FROM meeting_snapshots WHERE history_id=$1', [history.id]);
}

async function closeMeeting(history, reason) {
  const meeting = getMeeting(history.code);
  await persistWarning(history.id, { deadlineMs: null, keptAt: null, requestedBy: null });
  if (meeting) {
    if (meeting.endWarning) delete meeting.endWarning;
    await endMeeting(history.code, reason);
    return { ended: true, onServer: true };
  }
  await closeOrphan(history, reason);
  return { ended: true, onServer: false };
}

async function endByHost(code, user, { historyId } = {}) {
  if (!user) throw fail(401, 'Sign in to continue');
  const h = await findHistoryByCodeOrId(code, historyId);
  if (!h) throw fail(404, 'Meeting not found');
  const live = getMeeting(h.code);
  const meeting = Number(live?.historyId) === Number(h.id) ? live : null;
  if (!isHostUser(meeting, h, user)) throw fail(403, 'Only the host can end this meeting');
  if (!meeting && h.ended_at) {
    await settleOrphanBilling(h, 'history-ended');
    return { ok: true, alreadyEnded: true, endedAt: h.ended_at };
  }
  if (meeting) {
    await persistWarning(h.id, {});
    await endMeeting(h.code, 'host-ended');
    return { ok: true, ended: true, onServer: true };
  }
  await closeOrphan(h, 'host-ended');
  return { ok: true, ended: true, onServer: false };
}

function resolveWaitMs(ms) {
  const n = Number(ms);
  if (process.env.NODE_ENV === 'test' && Number.isFinite(n) && n > 0) return Math.min(END_IN_MS, Math.max(1, Math.floor(n)));
  return END_IN_MS;
}

async function scheduleEndIn(code, { admin, ms } = {}) {
  const h = await findOpenHistory(code);
  if (!h) throw fail(404, 'No open meeting with that code');
  const wait = resolveWaitMs(ms);
  const deadlineMs = Date.now() + wait;
  const requestedBy = admin && admin.id != null ? Number(admin.id) : null;
  const meeting = getMeeting(h.code);
  const warning = { deadlineMs, keptAt: null, requestedBy };
  if (meeting) meeting.endWarning = warning;
  await persistWarning(h.id, warning);
  broadcast(h.code, { type: 'end-warning', deadlineMs, remainingMs: wait });
  return { ok: true, warning: publicWarning({ ...h, end_warning_deadline_ms: deadlineMs, end_warning_kept_at: null, end_warning_requested_by: requestedBy }, meeting) };
}

async function keepAlive(code, { meeting, user, participant } = {}) {
  const m = meeting || getMeeting(code);
  const h = (m && m.historyId && await findHistoryByCodeOrId(null, m.historyId)) || await findOpenHistory(code);
  if (!h || h.ended_at) throw fail(404, 'Meeting not found');
  const inRoom = !!(m && (participant || (user && [...m.participants.values()].some((p) => Number(p.userId) === Number(user.id)))));
  if (!inRoom) {
    if (!m) throw fail(409, 'This meeting is not live on the server');
    throw fail(403, 'Join the meeting to keep it live');
  }
  const current = publicWarning(h, m);
  if (!current || current.status !== 'pending') {
    return { ok: true, kept: !!(current && current.status === 'kept'), warning: current };
  }
  const keptAt = new Date().toISOString();
  if (m) m.endWarning = { deadlineMs: null, keptAt, requestedBy: current.requestedBy || null };
  await persistWarning(h.id, { deadlineMs: null, keptAt, requestedBy: current.requestedBy || null });
  broadcast(h.code, { type: 'end-warning-cancelled', kept: true });
  return { ok: true, kept: true, warning: { status: 'kept', keptAt } };
}

async function cancelEnd(code) {
  const h = await findOpenHistory(code);
  if (!h) throw fail(404, 'Meeting not found');
  const m = getMeeting(h.code);
  const current = publicWarning(h, m);
  if (!current || current.status !== 'pending') {
    return { ok: true, cancelled: false, warning: current };
  }
  const cancelledAt = new Date().toISOString();
  if (m) m.endWarning = { deadlineMs: null, keptAt: null, cancelledAt };
  await persistWarning(h.id, { deadlineMs: null, keptAt: null, requestedBy: null });
  broadcast(h.code, { type: 'end-warning-cancelled', kept: false });
  return { ok: true, cancelled: true, warning: { status: 'cancelled', cancelledAt } };
}

function shapeOpen(h) {
  const meeting = getMeeting(h.code);
  const onServer = !!meeting;
  const startedAt = h.created_at;
  return {
    historyId: h.id,
    code: h.code,
    name: h.name,
    host: h.host_display_name || h.host_user_display_name || h.host_username || null,
    hostUserId: h.host_user_id,
    participantCount: onServer ? countActive(meeting) : 0,
    onServer,
    startedAt,
    durationMs: Math.max(0, Date.now() - new Date(startedAt).getTime()),
    link: '/' + String(h.code).toLowerCase(),
    warning: publicWarning(h, meeting),
  };
}

async function listOpen() {
  const rows = (await db.q(
    `SELECT h.*, u.username AS host_username, u.display_name AS host_user_display_name
       FROM meeting_history h
       LEFT JOIN users u ON u.id = h.host_user_id
      WHERE h.ended_at IS NULL
      ORDER BY h.created_at DESC
      LIMIT 200`
  )).rows;
  return rows.map(shapeOpen);
}

let ticking = false;
async function tick(now = Date.now()) {
  if (ticking) return;
  ticking = true;
  try {
    const rows = (await db.q(
      `SELECT * FROM meeting_history
        WHERE ended_at IS NULL
          AND end_warning_deadline_ms IS NOT NULL
          AND end_warning_deadline_ms <= $1`,
      [now]
    )).rows;
    const seen = new Set();
    for (const h of rows) {
      seen.add(norm(h.code));
      try { await closeMeeting(h, 'admin-countdown'); }
      catch (e) { console.error('[end-control] expire', h.code, e.message); }
    }
    for (const [code, meeting] of allMeetings()) {
      const w = meeting.endWarning;
      if (!w || !w.deadlineMs || w.keptAt || w.cancelledAt) continue;
      if (seen.has(norm(code))) continue;
      if (w.deadlineMs > now) continue;
      try {
        const h = await findHistoryByCodeOrId(code, meeting.historyId);
        if (h && !h.ended_at) await closeMeeting(h, 'admin-countdown');
      } catch (e) { console.error('[end-control] expire-mem', code, e.message); }
    }
  } finally {
    ticking = false;
  }
}

async function hydrate(now = Date.now()) {
  const rows = (await db.q(
    `SELECT * FROM meeting_history
      WHERE ended_at IS NULL AND (end_warning_deadline_ms IS NOT NULL OR end_warning_kept_at IS NOT NULL)`
  )).rows;
  for (const h of rows) {
    const meeting = getMeeting(h.code);
    if (!meeting) continue;
    const w = warningFromRow(h);
    if (w) meeting.endWarning = w;
  }
  await tick(now);
}

module.exports = {
  END_IN_MS,
  endByHost,
  reconcileEndedHostMeetings,
  scheduleEndIn,
  keepAlive,
  cancelEnd,
  listOpen,
  tick,
  hydrate,
  warningFor,
  publicWarning,
  isHostUser,
  findHistoryByCodeOrId,
  findOpenHistory,
};
