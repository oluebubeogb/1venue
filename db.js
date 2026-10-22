/**
 * 1venue data layer: PostgreSQL only.
 * Meet's query API is kept intact (same function names and shapes) so the
 * plugins and routes inherited from Meet keep working. Schema changes live in
 * /migrations as numbered SQL files. They are applied once, in order, under an
 * advisory lock, so several replicas can boot at the same time safely.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL || '';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const MIGRATIONS_DIR = path.join(__dirname, 'migrations');
const USE_PG = true;
const DB_PATH = null;

let pool = null;
let ready = null;

function nowIso() {
  return new Date().toISOString();
}

function slugArtifact() {
  return crypto.randomBytes(8).toString('base64url').slice(0, 12);
}

function getPool() {
  if (!pool) {
    if (!DATABASE_URL) {
      throw new Error('DATABASE_URL is required (postgres://user:pass@host:5432/db)');
    }
    const ssl = /sslmode=require|ssl=true/i.test(DATABASE_URL) || process.env.DATABASE_SSL === 'true'
      ? { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED === 'true' }
      : undefined;
    pool = new Pool({
      connectionString: DATABASE_URL,
      max: parseInt(process.env.DATABASE_POOL_MAX || '10', 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      ssl,
    });
    pool.on('error', (e) => console.error('[db] pool error', e.message));
  }
  return pool;
}

async function migrate({ log = console.log } = {}) {
  const p = getPool();
  const client = await p.connect();
  try {
    await client.query('SELECT pg_advisory_lock(77141880)');
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    const done = new Set((await client.query('SELECT version FROM schema_migrations')).rows.map((r) => r.version));
    const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
    const applied = [];
    for (const f of files) {
      if (done.has(f)) continue;
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations(version) VALUES ($1)', [f]);
        await client.query('COMMIT');
        applied.push(f);
        log(`[db] migrated ${f}`);
      } catch (e) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${f} failed: ${e.message}`);
      }
    }
    return applied;
  } finally {
    try { await client.query('SELECT pg_advisory_unlock(77141880)'); } catch (_) {}
    client.release();
  }
}

function ensureReady() {
  if (!ready) {
    ready = (async () => {
      getPool();
      if (process.env.AUTO_MIGRATE !== 'false') await migrate();
    })().catch((e) => {
      ready = null;
      throw e;
    });
  }
  return ready;
}

async function q(text, params = []) {
  await ensureReady();
  return getPool().query(text, params);
}

async function tx(fn) {
  await ensureReady();
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function close() {
  if (pool) await pool.end();
  pool = null;
  ready = null;
}

/* ───────────────────────── API (async) ───────────────────────── */

async function createUser({ username, email, passwordHash }) {
  await ensureReady();
  const r = await q(
    `INSERT INTO users (username, email, password_hash) VALUES ($1,$2,$3) RETURNING id, username, email, created_at`,
    [username, email, passwordHash]
  );
  return r.rows[0];
}

async function getUserById(id) {
  await ensureReady();
  const r = await q(`SELECT id, username, email, created_at FROM users WHERE id = $1`, [id]);
  return r.rows[0] || null;
}

async function getUserByEmail(email) {
  await ensureReady();
  const r = await q(
    `SELECT id, username, email, password_hash, created_at FROM users WHERE LOWER(email) = LOWER($1)`,
    [email]
  );
  return r.rows[0] || null;
}

async function getUserByUsername(username) {
  await ensureReady();
  const r = await q(
    `SELECT id, username, email, password_hash, created_at FROM users WHERE LOWER(username) = LOWER($1)`,
    [username]
  );
  return r.rows[0] || null;
}

async function findUserByLogin(login) {
  const byEmail = await getUserByEmail(login);
  if (byEmail) return byEmail;
  return getUserByUsername(login);
}

async function startMeetingHistory({ code, name, hostUserId, hostDisplayName }) {
  await ensureReady();
  const r = await q(
    `INSERT INTO meeting_history (code, name, host_user_id, host_display_name, max_participants)
     VALUES ($1,$2,$3,$4,1) RETURNING id`,
    [code, name, hostUserId || null, hostDisplayName || null]
  );
  return r.rows[0].id;
}

async function logParticipantJoin({ meetingHistoryId, userId, displayName, participantId }) {
  await ensureReady();
  const r = await q(
    `INSERT INTO meeting_participants_log (meeting_history_id, user_id, display_name, participant_id)
     VALUES ($1,$2,$3,$4) RETURNING id`,
    [meetingHistoryId, userId || null, displayName, participantId || null]
  );
  return r.rows[0].id;
}

async function logParticipantLeave({ meetingHistoryId, participantId }) {
  await ensureReady();
  await q(
    `UPDATE meeting_participants_log SET left_at = NOW()
     WHERE meeting_history_id = $1 AND participant_id = $2 AND left_at IS NULL`,
    [meetingHistoryId, participantId]
  );
  return;
}

async function updateMaxParticipants(meetingHistoryId, count) {
  await ensureReady();
  await q(
    `UPDATE meeting_history SET max_participants = GREATEST(max_participants, $1) WHERE id = $2`,
    [count, meetingHistoryId]
  );
  return;
}

async function endMeetingHistory(meetingHistoryId) {
  await ensureReady();
  await q(`UPDATE meeting_history SET ended_at = NOW() WHERE id = $1 AND ended_at IS NULL`, [meetingHistoryId]);
  await q(
    `UPDATE meeting_participants_log SET left_at = NOW() WHERE meeting_history_id = $1 AND left_at IS NULL`,
    [meetingHistoryId]
  );
  return;
}

async function getHistoryForUser(userId, limit = 50) {
  await ensureReady();
  const r = await q(
    `SELECT DISTINCT
      mh.id, mh.code, mh.name, mh.host_user_id, mh.host_display_name,
      mh.created_at, mh.ended_at, mh.max_participants,
      CASE WHEN mh.host_user_id = $1 THEN 1 ELSE 0 END AS was_host
    FROM meeting_history mh
    LEFT JOIN meeting_participants_log mpl ON mpl.meeting_history_id = mh.id
    WHERE mh.host_user_id = $1 OR mpl.user_id = $1
    ORDER BY mh.created_at DESC
    LIMIT $2`,
    [userId, limit]
  );
  return r.rows;
}

async function getMeetingParticipantsLog(meetingHistoryId) {
  await ensureReady();
  const r = await q(
    `SELECT id, user_id, display_name, participant_id, joined_at, left_at
     FROM meeting_participants_log WHERE meeting_history_id = $1 ORDER BY joined_at ASC`,
    [meetingHistoryId]
  );
  return r.rows;
}

async function getMeetingHistoryById(id) {
  await ensureReady();
  const r = await q(`SELECT * FROM meeting_history WHERE id = $1`, [id]);
  return r.rows[0] || null;
}

async function createScheduledMeeting({ code, name, hostUserId, hostDisplayName, scheduledStart, scheduledEnd }) {
  await ensureReady();
  const r = await q(
    `INSERT INTO scheduled_meetings (code, name, host_user_id, host_display_name, scheduled_start, scheduled_end, status)
     VALUES ($1,$2,$3,$4,$5,$6,'scheduled') RETURNING *`,
    [code, name, hostUserId, hostDisplayName || null, scheduledStart, scheduledEnd || null]
  );
  return r.rows[0];
}

async function getScheduledById(id) {
  await ensureReady();
  const r = await q(`SELECT * FROM scheduled_meetings WHERE id = $1`, [id]);
  return r.rows[0] || null;
}

async function getScheduledByCode(code) {
  await ensureReady();
  const r = await q(`SELECT * FROM scheduled_meetings WHERE code = $1`, [code]);
  return r.rows[0] || null;
}

async function getScheduledForUser(userId, limit = 50) {
  await ensureReady();
  const r = await q(
    `SELECT * FROM scheduled_meetings WHERE host_user_id = $1
     ORDER BY CASE status WHEN 'scheduled' THEN 0 WHEN 'live' THEN 1 WHEN 'ended' THEN 2 ELSE 3 END,
              scheduled_start ASC
     LIMIT $2`,
    [userId, limit]
  );
  return r.rows;
}

async function updateScheduledStatus(id, status, extra = {}) {
  await ensureReady();
  const sets = ['status = $1'];
  const vals = [status];
  let i = 2;
  if (extra.startedAt) {
    sets.push(`started_at = $${i++}`);
    vals.push(extra.startedAt);
  }
  if (extra.endedAt) {
    sets.push(`ended_at = $${i++}`);
    vals.push(extra.endedAt);
  }
  vals.push(id);
  await q(`UPDATE scheduled_meetings SET ${sets.join(', ')} WHERE id = $${i}`, vals);
  return getScheduledById(id);
}

async function deleteScheduled(id, userId) {
  await ensureReady();
  const r = await q(`DELETE FROM scheduled_meetings WHERE id = $1 AND host_user_id = $2`, [id, userId]);
  return { changes: r.rowCount };
}

async function logActivity({ meetingHistoryId, code, actorId, actorName, eventType, detail }) {
  await ensureReady();
  const detailStr = detail ? (typeof detail === 'string' ? detail : JSON.stringify(detail)) : null;
  const r = await q(
    `INSERT INTO meeting_activity (meeting_history_id, code, actor_id, actor_name, event_type, detail)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [meetingHistoryId || null, code, actorId || null, actorName || null, eventType, detailStr]
  );
  return r.rows[0].id;
}

async function getActivityForCode(code, limit = 100) {
  await ensureReady();
  const r = await q(`SELECT * FROM meeting_activity WHERE code = $1 ORDER BY id DESC LIMIT $2`, [code, limit]);
  return r.rows;
}

async function getActivityForMeeting(meetingHistoryId, limit = 200) {
  await ensureReady();
  const r = await q(
    `SELECT * FROM meeting_activity WHERE meeting_history_id = $1 ORDER BY id ASC LIMIT $2`,
    [meetingHistoryId, limit]
  );
  return r.rows;
}

async function startRecording({ meetingHistoryId, code, startedByUserId, startedByName, options }) {
  await ensureReady();
  const opt = options ? JSON.stringify(options) : null;
  const r = await q(
    `INSERT INTO meeting_recordings (meeting_history_id, code, started_by_user_id, started_by_name, options_json, status)
     VALUES ($1,$2,$3,$4,$5,'recording') RETURNING *`,
    [meetingHistoryId || null, code, startedByUserId || null, startedByName || null, opt]
  );
  return r.rows[0];
}

async function getRecordingById(id) {
  await ensureReady();
  const r = await q(`SELECT * FROM meeting_recordings WHERE id = $1`, [id]);
  return r.rows[0] || null;
}

async function stopRecording(id, extra = {}) {
  await ensureReady();
  await q(
    `UPDATE meeting_recordings SET ended_at = NOW(), status = 'stopped',
      file_path = COALESCE($2, file_path), file_url = COALESCE($3, file_url)
     WHERE id = $1 AND status = 'recording'`,
    [id, extra.filePath || null, extra.fileUrl || null]
  );
  return getRecordingById(id);
}

async function getActiveRecordingForCode(code) {
  await ensureReady();
  const r = await q(
    `SELECT * FROM meeting_recordings WHERE code = $1 AND status = 'recording' ORDER BY id DESC LIMIT 1`,
    [code]
  );
  return r.rows[0] || null;
}

async function getRecordingsForCode(code, limit = 20) {
  await ensureReady();
  const r = await q(`SELECT * FROM meeting_recordings WHERE code = $1 ORDER BY id DESC LIMIT $2`, [code, limit]);
  return r.rows;
}

async function listTemplates() {
  await ensureReady();
  const r = await q(`SELECT * FROM meeting_templates ORDER BY sort_order ASC, id ASC`);
  return r.rows;
}

async function getTemplateBySlug(slug) {
  await ensureReady();
  const r = await q(`SELECT * FROM meeting_templates WHERE slug = $1`, [slug]);
  return r.rows[0] || null;
}

async function upsertMembership({ code, userId, participantId, displayName, role, status, email }) {
  await ensureReady();
  let existing = null;
  if (userId) {
    const r = await q(`SELECT * FROM meeting_membership WHERE code = $1 AND user_id = $2`, [code, userId]);
    existing = r.rows[0];
  } else if (participantId) {
    const r = await q(`SELECT * FROM meeting_membership WHERE code = $1 AND participant_id = $2`, [code, participantId]);
    existing = r.rows[0];
  }
  if (existing) {
    await q(
      `UPDATE meeting_membership SET
        display_name = COALESCE($1, display_name),
        role = COALESCE($2, role),
        status = COALESCE($3, status),
        participant_id = COALESCE($4, participant_id),
        email = COALESCE($5, email),
        updated_at = NOW()
       WHERE id = $6`,
      [displayName || null, role || null, status || null, participantId || null, email || null, existing.id]
    );
    const r = await q(`SELECT * FROM meeting_membership WHERE id = $1`, [existing.id]);
    return r.rows[0];
  }
  const r = await q(
    `INSERT INTO meeting_membership (code, user_id, participant_id, display_name, role, status, email)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [code, userId || null, participantId || null, displayName || null, role || 'participant', status || 'ACTIVE', email || null]
  );
  return r.rows[0];
}

async function getMembership(code, { userId, participantId } = {}) {
  await ensureReady();
  if (userId) {
    const r = await q(`SELECT * FROM meeting_membership WHERE code = $1 AND user_id = $2`, [code, userId]);
    return r.rows[0] || null;
  }
  if (participantId) {
    const r = await q(`SELECT * FROM meeting_membership WHERE code = $1 AND participant_id = $2`, [code, participantId]);
    return r.rows[0] || null;
  }
  return null;
}

async function listMembership(code) {
  await ensureReady();
  const r = await q(`SELECT * FROM meeting_membership WHERE code = $1 ORDER BY updated_at DESC`, [code]);
  return r.rows;
}

async function setMembershipStatus(code, { userId, participantId, status }) {
  await ensureReady();
  if (userId) {
    await q(`UPDATE meeting_membership SET status = $1, updated_at = NOW() WHERE code = $2 AND user_id = $3`, [
      status,
      code,
      userId,
    ]);
  } else if (participantId) {
    await q(`UPDATE meeting_membership SET status = $1, updated_at = NOW() WHERE code = $2 AND participant_id = $3`, [
      status,
      code,
      participantId,
    ]);
  }
  return;
}

/* ─── Artifacts (Phase 1) ─── */

async function createArtifact({ meetingHistoryId, shortCode, isPublic = false }) {
  await ensureReady();
  const slug = slugArtifact();
  const r = await q(
    `INSERT INTO meeting_artifacts (meeting_history_id, short_code, artifact_slug, is_live, is_public)
     VALUES ($1,$2,$3,false,$4) RETURNING *`,
    [meetingHistoryId || null, shortCode, slug, !!isPublic]
  );
  return r.rows[0];
}

async function getArtifactById(id) {
  await ensureReady();
  const r = await q(`SELECT * FROM meeting_artifacts WHERE id = $1`, [id]);
  return r.rows[0] || null;
}

async function getArtifactBySlug(shortCode, slug) {
  await ensureReady();
  const r = await q(
    `SELECT * FROM meeting_artifacts WHERE short_code = $1 AND artifact_slug = $2`,
    [shortCode, slug]
  );
  return r.rows[0] || null;
}

async function getArtifactForHistory(meetingHistoryId) {
  await ensureReady();
  const r = await q(
    `SELECT * FROM meeting_artifacts WHERE meeting_history_id = $1 ORDER BY id DESC LIMIT 1`,
    [meetingHistoryId]
  );
  return r.rows[0] || null;
}

async function setArtifactLive(artifactId, isLive) {
  await ensureReady();
  await q(`UPDATE meeting_artifacts SET is_live = $1, updated_at = NOW() WHERE id = $2`, [!!isLive, artifactId]);
  return getArtifactById(artifactId);
}

async function setArtifactPublic(artifactId, isPublic) {
  await ensureReady();
  await q(`UPDATE meeting_artifacts SET is_public = $1, updated_at = NOW() WHERE id = $2`, [!!isPublic, artifactId]);
  return getArtifactById(artifactId);
}

async function getChatForArtifact(artifactId, limit = 500) {
  await ensureReady();
  const r = await q(
    `SELECT * FROM chat_messages WHERE artifact_id = $1 ORDER BY id ASC LIMIT $2`,
    [artifactId, limit]
  );
  return r.rows;
}

async function upsertPersonalNote({ artifactId, userId, content }) {
  await ensureReady();
  const r = await q(
    `INSERT INTO personal_notes (artifact_id, user_id, content)
     VALUES ($1,$2,$3)
     ON CONFLICT (artifact_id, user_id) DO UPDATE SET content = EXCLUDED.content, updated_at = NOW()
     RETURNING *`,
    [artifactId, userId, content || '']
  );
  return r.rows[0];
}

async function getPersonalNote(artifactId, userId) {
  await ensureReady();
  const r = await q(`SELECT * FROM personal_notes WHERE artifact_id = $1 AND user_id = $2`, [artifactId, userId]);
  return r.rows[0] || null;
}

async function getRecordingsForHistory(meetingHistoryId) {
  await ensureReady();
  const r = await q(
    `SELECT * FROM meeting_recordings WHERE meeting_history_id = $1 ORDER BY id ASC`,
    [meetingHistoryId]
  );
  return r.rows;
}

/** Ensure artifact exists for an ended meeting; create if missing. */
async function ensureArtifactForHistory(meetingHistoryId, shortCode) {
  let art = await getArtifactForHistory(meetingHistoryId);
  if (art) return art;
  return createArtifact({ meetingHistoryId, shortCode });
}

/* ───────────────────────── Extended chat helpers ───────────────────────── */

async function saveChatMessage({
  meetingHistoryId,
  artifactId,
  sessionId,
  senderId,
  senderName,
  senderUserId,
  body,
  attachments,
  groupId,
}) {
  await ensureReady();
  const r = await q(
    `INSERT INTO chat_messages
      (meeting_history_id, artifact_id, session_id, sender_id, sender_name, sender_user_id, body, attachments, group_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [
      meetingHistoryId || null,
      artifactId || null,
      sessionId || null,
      senderId || null,
      senderName || null,
      senderUserId || null,
      body || null,
      attachments ? JSON.stringify(attachments) : null,
      groupId || null,
    ]
  );
  return r.rows[0];
}

async function getChatForHistory(meetingHistoryId, limit = 500) {
  await ensureReady();
  const r = await q(
    `SELECT * FROM chat_messages WHERE meeting_history_id = $1 AND (group_id IS NULL OR group_id = '') ORDER BY id ASC LIMIT $2`,
    [meetingHistoryId, limit]
  );
  return r.rows;
}

async function getChatForGroup(groupId, limit = 500) {
  await ensureReady();
  const r = await q(
    `SELECT * FROM chat_messages WHERE group_id = $1 ORDER BY id ASC LIMIT $2`,
    [groupId, limit]
  );
  return r.rows;
}

/** Find or create a DM thread between two logged-in users (order-independent). */
async function findOrCreateDmThread(userAId, userBId) {
  await ensureReady();
  const a = Math.min(userAId, userBId);
  const b = Math.max(userAId, userBId);
  let r = await q(
    `SELECT * FROM dm_threads WHERE user_a_id = $1 AND user_b_id = $2 AND peer_is_guest = FALSE LIMIT 1`,
    [a, b]
  );
  if (r.rows[0]) return r.rows[0];
  r = await q(
    `INSERT INTO dm_threads (user_a_id, user_b_id, peer_is_guest) VALUES ($1,$2,FALSE) RETURNING *`,
    [a, b]
  );
  return r.rows[0];
}

/** DM thread between a logged-in user and a guest (keyed by guest participant id or stable guest key). */
async function findOrCreateGuestDmThread(userId, guestKey, guestDisplayName) {
  await ensureReady();
  let r = await q(
    `SELECT * FROM dm_threads WHERE user_a_id = $1 AND guest_key = $2 AND peer_is_guest = TRUE LIMIT 1`,
    [userId, guestKey]
  );
  if (r.rows[0]) return r.rows[0];
  r = await q(
    `INSERT INTO dm_threads (user_a_id, guest_key, guest_display_name, peer_is_guest)
     VALUES ($1,$2,$3,TRUE) RETURNING *`,
    [userId, guestKey, guestDisplayName || 'Guest']
  );
  return r.rows[0];
}

async function saveDmMessage({
  threadId,
  senderUserId,
  senderParticipantId,
  senderName,
  body,
  meetingCode,
}) {
  await ensureReady();
  const r = await q(
    `INSERT INTO dm_messages (thread_id, sender_user_id, sender_participant_id, sender_name, body, meeting_code)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [
      threadId,
      senderUserId || null,
      senderParticipantId || null,
      senderName || 'User',
      body || '',
      meetingCode || null,
    ]
  );
  await q(`UPDATE dm_threads SET last_message_at = NOW() WHERE id = $1`, [threadId]);
  return r.rows[0];
}

async function getDmMessages(threadId, limit = 200) {
  await ensureReady();
  const r = await q(
    `SELECT * FROM dm_messages WHERE thread_id = $1 ORDER BY id ASC LIMIT $2`,
    [threadId, limit]
  );
  return r.rows;
}

async function listDmThreadsForUser(userId, limit = 50) {
  await ensureReady();
  const r = await q(
    `SELECT * FROM dm_threads
     WHERE user_a_id = $1 OR user_b_id = $1
     ORDER BY COALESCE(last_message_at, created_at) DESC
     LIMIT $2`,
    [userId, limit]
  );
  return r.rows;
}

async function getDmThreadById(threadId) {
  await ensureReady();
  const r = await q(`SELECT * FROM dm_threads WHERE id = $1`, [threadId]);
  return r.rows[0] || null;
}

async function createChatGroup({ id, meetingCode, meetingHistoryId, title, createdByParticipantId, createdByUserId }) {
  await ensureReady();
  const r = await q(
    `INSERT INTO chat_groups (id, meeting_code, meeting_history_id, title, created_by_participant_id, created_by_user_id)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [id, meetingCode, meetingHistoryId || null, title, createdByParticipantId || null, createdByUserId || null]
  );
  return r.rows[0];
}

async function addChatGroupMember({ groupId, participantId, userId, displayName }) {
  await ensureReady();
  await q(
    `INSERT INTO chat_group_members (group_id, participant_id, user_id, display_name)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (group_id, participant_id) DO UPDATE SET display_name = EXCLUDED.display_name, user_id = EXCLUDED.user_id`,
    [groupId, participantId, userId || null, displayName || null]
  );
  return;
}

async function removeChatGroupMember(groupId, participantId) {
  await ensureReady();
  await q(`DELETE FROM chat_group_members WHERE group_id = $1 AND participant_id = $2`, [
    groupId,
    participantId,
  ]);
  return;
}

async function listChatGroupMembers(groupId) {
  await ensureReady();
  const r = await q(`SELECT * FROM chat_group_members WHERE group_id = $1`, [groupId]);
  return r.rows;
}

async function getChatGroup(groupId) {
  await ensureReady();
  const r = await q(`SELECT * FROM chat_groups WHERE id = $1`, [groupId]);
  return r.rows[0] || null;
}

module.exports = {
  ensureReady,
  migrate,
  q,
  tx,
  close,
  getPool,
  USE_PG,
  DB_PATH,
  DATABASE_URL: DATABASE_URL || null,
  DATA_DIR,
  // users
  createUser,
  getUserById,
  getUserByEmail,
  getUserByUsername,
  findUserByLogin,
  // history
  startMeetingHistory,
  logParticipantJoin,
  logParticipantLeave,
  updateMaxParticipants,
  endMeetingHistory,
  getHistoryForUser,
  getMeetingParticipantsLog,
  getMeetingHistoryById,
  // scheduled
  createScheduledMeeting,
  getScheduledById,
  getScheduledByCode,
  getScheduledForUser,
  updateScheduledStatus,
  deleteScheduled,
  // activity
  logActivity,
  getActivityForCode,
  getActivityForMeeting,
  // recordings
  startRecording,
  getRecordingById,
  stopRecording,
  getActiveRecordingForCode,
  getRecordingsForCode,
  getRecordingsForHistory,
  // templates
  listTemplates,
  getTemplateBySlug,
  // membership
  upsertMembership,
  getMembership,
  listMembership,
  setMembershipStatus,
  // artifacts
  createArtifact,
  getArtifactById,
  getArtifactBySlug,
  getArtifactForHistory,
  setArtifactLive,
  setArtifactPublic,
  ensureArtifactForHistory,
  saveChatMessage,
  getChatForArtifact,
  getChatForHistory,
  getChatForGroup,
  findOrCreateDmThread,
  findOrCreateGuestDmThread,
  saveDmMessage,
  getDmMessages,
  listDmThreadsForUser,
  getDmThreadById,
  createChatGroup,
  addChatGroupMember,
  removeChatGroupMember,
  listChatGroupMembers,
  getChatGroup,
  upsertPersonalNote,
  getPersonalNote,
};
