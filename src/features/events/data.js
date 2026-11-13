/**
 * events queries (PostgreSQL, parameterised). Split out of src/venue/data.js;
 * src/venue/data.js still re-exports everything for older call sites.
 */
const crypto = require('crypto');
const { q, tx, one, many } = require('../../core/db');
const { createPost } = require('../social/data');

// ---------------------------------------------------------------- events
const CATEGORIES = ['talk_show', 'presentation', 'seminar', 'sermon', 'webinar', 'workshop', 'meeting', 'concert', 'class', 'other'];
function slugify(s) {
  const base = String(s || 'event').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'event';
  return `${base.length < 3 ? base + '-ev' : base}-${crypto.randomBytes(3).toString('hex')}`;
}
function eventOut(r) {
  if (!r) return null;
  return {
    id: Number(r.id), slug: r.slug, code: r.code, title: r.title, description: r.description, category: r.category,
    tags: r.tags || [], language: r.language, visibility: r.visibility, status: r.status,
    startsAt: r.starts_at, endsAt: r.ends_at, startedAt: r.started_at, endedAt: r.ended_at,
    coverUrl: r.cover_url, theme: r.theme || {}, speakerSeats: r.speaker_seats, settings: r.settings || {},
    templateSlug: r.template_slug, liveViewers: r.live_viewers, peakViewers: r.peak_viewers, totalJoins: r.total_joins,
    host: { id: r.host_user_id, username: (require('../../lib/auth').publicUsername(r.host_username) || r.host_username || null), name: r.host_name, avatarUrl: r.host_avatar || null },
    rsvps: r.rsvps != null ? Number(r.rsvps) : undefined,
    rsvped: r.rsvped != null ? !!r.rsvped : undefined,
    historyId: r.meeting_history_id || null,
    createdAt: r.created_at,
  };
}
const EVENT_SELECT = (viewer = '0') => `SELECT e.*, u.avatar_url AS host_avatar, u.username AS host_username,
  (SELECT COUNT(*) FROM event_rsvps WHERE event_id=e.id) AS rsvps,
  EXISTS(SELECT 1 FROM event_rsvps WHERE event_id=e.id AND user_id=${viewer}) AS rsvped
  FROM events e JOIN users u ON u.id=e.host_user_id`;

async function uniqueEventCode() {
  const { generateCode } = require('../../rooms/store');
  for (let i = 0; i < 20; i++) {
    const c = generateCode();
    if (!(await one('SELECT 1 FROM events WHERE code=$1', [c]))) return c;
  }
  throw new Error('Could not allocate event code');
}
function validateEventInput(b, partial = false) {
  const out = {};
  if (!partial || b.title != null) {
    const t = String(b.title || '').trim();
    if (t.length < 2 || t.length > 120) { const e = new Error('Title must be 2–120 characters'); e.status = 400; throw e; }
    out.title = t;
  }
  if (b.description != null) out.description = String(b.description).slice(0, 5000);
  if (b.category != null) out.category = CATEGORIES.includes(b.category) ? b.category : 'other';
  if (b.tags != null) out.tags = (Array.isArray(b.tags) ? b.tags : String(b.tags).split(','))
    .map((t) => String(t).trim().toLowerCase().replace(/^#/, '')).filter(Boolean).slice(0, 12).map((t) => t.slice(0, 32));
  if (b.language != null) out.language = String(b.language).slice(0, 12) || 'en';
  if (b.visibility != null) out.visibility = ['public', 'unlisted', 'private'].includes(b.visibility) ? b.visibility : 'public';
  if (b.startsAt !== undefined) out.starts_at = b.startsAt ? new Date(b.startsAt) : null;
  if (b.endsAt !== undefined) out.ends_at = b.endsAt ? new Date(b.endsAt) : null;
  for (const k of ['starts_at', 'ends_at']) if (out[k] && isNaN(out[k])) { const e = new Error('Invalid date'); e.status = 400; throw e; }
  if (out.starts_at && out.ends_at && out.ends_at < out.starts_at) { const e = new Error('End must be after start'); e.status = 400; throw e; }
  if (b.coverUrl !== undefined) out.cover_url = b.coverUrl ? String(b.coverUrl).slice(0, 500) : null;
  if (b.theme != null) {
    const hex = (v) => (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v : undefined);
    out.theme = JSON.stringify({ accent: hex(b.theme.accent), accent2: hex(b.theme.accent2) });
  }
  if (b.speakerSeats != null) out.speaker_seats = Math.min(50, Math.max(1, parseInt(b.speakerSeats, 10) || 4));
  if (b.settings != null && typeof b.settings === 'object') out.settings = JSON.stringify(b.settings);
  if (b.templateSlug != null) out.template_slug = String(b.templateSlug).slice(0, 40);
  return out;
}
async function createEvent(user, b) {
  const v = validateEventInput(b);
  const code = await uniqueEventCode();
  const r = await one(`INSERT INTO events (slug, code, host_user_id, host_name, title, description, category, tags, language, visibility,
      status, starts_at, ends_at, cover_url, theme, speaker_seats, settings, template_slug)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING id`,
  [slugify(v.title), code, user.id, user.displayName || user.username, v.title, v.description || null, v.category || 'meeting',
    v.tags || [], v.language || 'en', v.visibility || 'public', b.status === 'draft' ? 'draft' : 'scheduled',
    v.starts_at || null, v.ends_at || null, v.cover_url || null, v.theme || '{}', v.speaker_seats || 4, v.settings || '{}', v.template_slug || null]);
  const ev = await getEventById(r.id, user.id);
  if (ev.visibility === 'public' && ev.status === 'scheduled') {
    await createPost(user.id, { kind: 'event_scheduled', eventId: ev.id, body: ev.title }).catch(() => {});
  }
  return ev;
}
async function updateEvent(id, userId, b) {
  const v = validateEventInput(b, true);
  if (b.status && ['draft', 'scheduled', 'cancelled'].includes(b.status)) v.status = b.status;
  const keys = Object.keys(v);
  if (!keys.length) return getEventById(id, userId);
  const sets = keys.map((k, i) => `${k}=$${i + 3}`).join(', ');
  const r = await q(`UPDATE events SET ${sets}, updated_at=NOW() WHERE id=$1 AND host_user_id=$2`, [id, userId, ...keys.map((k) => v[k])]);
  if (!r.rowCount) return null;
  return getEventById(id, userId);
}
async function deleteEvent(id, userId) {
  return (await q('DELETE FROM events WHERE id=$1 AND host_user_id=$2', [id, userId])).rowCount > 0;
}
async function getEventById(id, viewerId) {
  return eventOut(await one(`${EVENT_SELECT('$2')} WHERE e.id=$1`, [id, viewerId || 0]));
}
async function getEventBySlug(slug, viewerId) {
  return eventOut(await one(`${EVENT_SELECT('$2')} WHERE e.slug=$1 OR e.code=UPPER(REPLACE($1,'-',''))`, [slug, viewerId || 0]));
}
async function getEventByCode(code) {
  return eventOut(await one(`${EVENT_SELECT()} WHERE e.code=$1`, [code]));
}
/**
 * Discovery: full-text + trigram fuzzy search across public events.
 */
async function discover({ q: term, category, status, tag, limit = 24, offset = 0, viewerId } = {}) {
  const where = ["e.visibility='public'", "e.status <> 'draft'", "e.status <> 'cancelled'"];
  const params = [viewerId || 0];
  let rank = 'e.started_at DESC NULLS LAST, e.starts_at ASC NULLS LAST';
  if (status === 'live') where.push("e.status='live'");
  else if (status === 'upcoming') where.push("e.status='scheduled'");
  else if (status === 'past') where.push("e.status='ended'");
  if (category && CATEGORIES.includes(category)) { params.push(category); where.push(`e.category=$${params.length}`); }
  if (tag) { params.push(String(tag).toLowerCase()); where.push(`$${params.length} = ANY(e.tags)`); }
  if (term && String(term).trim()) {
    const t = String(term).trim().slice(0, 100);
    params.push(t);
    const i = params.length;
    where.push(`(e.search @@ plainto_tsquery('simple', $${i}) OR e.title % $${i} OR e.title ILIKE '%' || $${i} || '%' OR e.host_name ILIKE '%' || $${i} || '%')`);
    rank = `(e.status='live') DESC, ts_rank(e.search, plainto_tsquery('simple', $${i})) + similarity(e.title, $${i}) DESC`;
  } else {
    rank = `(e.status='live') DESC, (e.status='scheduled') DESC, ${rank}`;
  }
  params.push(Math.min(60, limit), Math.max(0, offset));
  const rows = await many(`${EVENT_SELECT('$1')} WHERE ${where.join(' AND ')} ORDER BY ${rank} LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
  return rows.map(eventOut);
}
async function categoryCounts() {
  return many(`SELECT category, COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status='live')::int AS live
    FROM events WHERE visibility='public' AND status IN ('live','scheduled','ended') GROUP BY category ORDER BY live DESC, total DESC`);
}
async function myEvents(userId) {
  return (await many(`${EVENT_SELECT('$1')} WHERE e.host_user_id=$1 ORDER BY COALESCE(e.starts_at, e.created_at) DESC LIMIT 100`, [userId])).map(eventOut);
}
async function rsvpedEvents(userId) {
  return (await many(`${EVENT_SELECT('$1')} JOIN event_rsvps r ON r.event_id=e.id AND r.user_id=$1
    WHERE e.status IN ('scheduled','live') ORDER BY e.starts_at NULLS LAST LIMIT 50`, [userId])).map(eventOut);
}
async function toggleRsvp(eventId, userId) {
  const del = await q('DELETE FROM event_rsvps WHERE event_id=$1 AND user_id=$2', [eventId, userId]);
  if (del.rowCount) return false;
  await q('INSERT INTO event_rsvps (event_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [eventId, userId]);
  return true;
}
async function markEventLive(eventId, { code, historyId }) {
  const ev = await one(`UPDATE events SET status='live', started_at=NOW(), ended_at=NULL, meeting_history_id=$2, updated_at=NOW()
    WHERE id=$1 RETURNING *`, [eventId, historyId]);
  if (historyId) await q('UPDATE meeting_history SET event_id=$1 WHERE id=$2', [eventId, historyId]);
  if (ev && ev.visibility === 'public') await createPost(ev.host_user_id, { kind: 'event_live', eventId, body: ev.title }).catch(() => {});
  return ev;
}
async function markEventEnded(eventId) {
  await q(`UPDATE events SET status='ended', ended_at=NOW(), live_viewers=0, updated_at=NOW() WHERE id=$1 AND status='live'`, [eventId]);
}
async function updateViewers(eventId, live, joinedDelta = 0) {
  await q(`UPDATE events SET live_viewers=$2, peak_viewers=GREATEST(peak_viewers,$2), total_joins=total_joins+$3 WHERE id=$1`, [eventId, live, joinedDelta]);
}
async function listSpeakers(eventId) {
  return (await many(`SELECT es.*, u.username
    FROM event_speakers es LEFT JOIN users u ON u.id=es.user_id
    WHERE es.event_id=$1 ORDER BY es.sort_order, es.id`, [eventId]))
    .map((r) => {
      const { publicUsername } = require('../../lib/auth');
      return { id: Number(r.id), userId: r.user_id, username: publicUsername(r.username) || r.username || null, name: r.display_name, headline: r.headline, avatarUrl: r.avatar_url, email: r.email || null };
    });
}
async function setSpeakers(eventId, list) {
  return tx(async (c) => {
    await c.query('DELETE FROM event_speakers WHERE event_id=$1', [eventId]);
    let i = 0;
    for (const s of (list || []).slice(0, 20)) {
      const name = String(s.name || '').trim().slice(0, 80);
      if (!name) continue;
      await c.query('INSERT INTO event_speakers (event_id, user_id, display_name, headline, avatar_url, email, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [eventId, s.userId || null, name, s.headline ? String(s.headline).slice(0, 140) : null, s.avatarUrl || null, s.email ? String(s.email).toLowerCase().slice(0, 200) : null, i++]);
    }
  }).then(() => listSpeakers(eventId));
}

async function syncSpeakerInvites(userId, email) {
  if (!email) return 0;
  const r = await q(
    `UPDATE event_speakers SET user_id=$1, avatar_url=COALESCE(avatar_url, (SELECT avatar_url FROM users WHERE id=$1)), display_name=COALESCE(NULLIF(display_name,''), (SELECT COALESCE(display_name, username) FROM users WHERE id=$1))
     WHERE user_id IS NULL AND lower(email)=lower($2)`,
    [userId, String(email).trim()]
  );
  return r.rowCount || 0;
}

module.exports = { CATEGORIES, slugify, eventOut, EVENT_SELECT, uniqueEventCode, validateEventInput, createEvent, updateEvent, deleteEvent, getEventById, getEventBySlug, getEventByCode, discover, categoryCounts, myEvents, rsvpedEvents, toggleRsvp, markEventLive, markEventEnded, updateViewers, listSpeakers, setSpeakers, syncSpeakerInvites };
