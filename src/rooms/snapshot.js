/**
 * Graceful-restart support for live rooms.
 *
 * All live room state lives in this process (src/rooms/store.js). On SIGTERM we
 * write every live meeting to `meeting_snapshots` (JSONB) instead of ending it.
 * The next process restores a meeting lazily, the first time anyone asks for its
 * code (WebSocket register, /api/join, /api/meeting/:code). Lazy restore matters
 * on Coolify: a rolling deploy starts the new container *before* the old one gets
 * SIGTERM, so the snapshot may be written after the new process has booted.
 *
 * Snapshots older than RESTART.restoreMaxMs are never restored; the periodic
 * cleanup ends those meetings properly (history, event, venue) instead.
 */
const db = require('../../db');
const config = require('../config');
const { normCode } = require('../lib/codes');
const store = require('./store');

// JSON with Map/Set support; timers and functions are dropped.
function replacer(key, v) {
  if (v instanceof Map) return { __map: [...v.entries()] };
  if (v instanceof Set) return { __set: [...v.values()] };
  if (typeof v === 'function') return undefined;
  if (v && typeof v === 'object' && v.constructor && /^(Timeout|Immediate)$/.test(v.constructor.name)) return undefined;
  return v;
}
function reviver(key, v) {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    if (Array.isArray(v.__map) && Object.keys(v).length === 1) return new Map(v.__map);
    if (Array.isArray(v.__set) && Object.keys(v).length === 1) return new Set(v.__set);
  }
  return v;
}
const serialize = (meeting) => JSON.stringify(meeting, replacer);
const deserialize = (json) => JSON.parse(typeof json === 'string' ? json : JSON.stringify(json), reviver);

/** Write every live meeting. Called once from the SIGTERM handler. */
async function snapshotAll() {
  let n = 0;
  for (const [code, meeting] of store.allMeetings()) {
    try {
      await db.q(
        `INSERT INTO meeting_snapshots (code, history_id, state) VALUES ($1, $2, $3::jsonb)
         ON CONFLICT (code) DO UPDATE SET history_id = EXCLUDED.history_id, state = EXCLUDED.state, created_at = NOW()`,
        [code, meeting.historyId || null, serialize(meeting)]
      );
      n++;
    } catch (e) {
      console.warn('[snapshot] save', code, e.message);
    }
  }
  return n;
}

const inflight = new Map();
/** Return the live meeting for `code`, restoring it from a snapshot if needed. */
function getOrRestoreMeeting(code) {
  const c = normCode(code);
  const live = store.getMeeting(c);
  if (live) return Promise.resolve(live);
  if (!c) return Promise.resolve(null);
  if (!inflight.has(c)) {
    inflight.set(c, restore(c).catch((e) => { console.warn('[snapshot] restore', c, e.message); return null; }).finally(() => inflight.delete(c)));
  }
  return inflight.get(c);
}

async function restore(code) {
  const r = await db.q(
    `SELECT s.state, s.created_at, h.ended_at FROM meeting_snapshots s
       LEFT JOIN meeting_history h ON h.id = s.history_id WHERE s.code = $1`,
    [code]
  );
  const row = r.rows[0];
  if (!row) return null;
  if (row.ended_at || Date.now() - new Date(row.created_at).getTime() > config.RESTART.restoreMaxMs) return null; // the sweep ends it
  if (store.getMeeting(code)) return store.getMeeting(code);
  const meeting = deserialize(row.state);
  if (!(meeting.participants instanceof Map)) meeting.participants = new Map();
  if (meeting.content) { meeting.content.slideshow = false; delete meeting.content.slideshowTimer; }
  meeting.lastActivity = Date.now();
  meeting.restoredAt = Date.now();
  store.setMeeting(code, meeting);
  await db.q('DELETE FROM meeting_snapshots WHERE code = $1', [code]).catch(() => {});
  console.log(`[snapshot] restored ${code} (${meeting.participants.size} participants)`);
  return meeting;
}

/** A brand-new meeting reuses a code that still has a snapshot: close the old session first. */
async function discardSnapshot(code) {
  const r = await db.q('DELETE FROM meeting_snapshots WHERE code = $1 RETURNING history_id', [normCode(code)]).catch(() => ({ rows: [] }));
  for (const row of r.rows) if (row.history_id) await db.endMeetingHistory(row.history_id).catch(() => {});
}

/** End meetings whose snapshot was never picked up (nobody came back in time). */
async function expireSnapshots() {
  const r = await db.q(
    `DELETE FROM meeting_snapshots WHERE created_at < NOW() - ($1::text || ' milliseconds')::interval RETURNING code, history_id, state`,
    [String(config.RESTART.restoreMaxMs)]
  ).catch(() => ({ rows: [] }));
  for (const row of r.rows) {
    if (store.getMeeting(row.code)) continue;
    // Put it back just long enough for endMeeting() to close history, artifact, schedule, event and venue.
    const m = deserialize(row.state);
    if (!(m.participants instanceof Map)) m.participants = new Map();
    if (m.content) delete m.content.slideshowTimer;
    store.setMeeting(row.code, m);
    await require('./lifecycle').endMeeting(row.code, 'restart-expired').catch(() => store.deleteMeeting(row.code));
    console.log(`[snapshot] expired ${row.code}`);
  }
}

module.exports = { snapshotAll, getOrRestoreMeeting, discardSnapshot, expireSnapshots, serialize, deserialize };
