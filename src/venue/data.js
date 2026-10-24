/**
 * 1venue data access (PostgreSQL). All queries are parameterised.
 */
const crypto = require('crypto');
const { q, tx } = require('../../db');

const one = async (sql, p) => (await q(sql, p)).rows[0] || null;
const many = async (sql, p) => (await q(sql, p)).rows;

// ---------------------------------------------------------------- prefs
const PREF_DEFAULTS = { theme: 'system', accent: '#2563eb', accent2: null, fontScale: 1, reduceMotion: false, bibleTranslation: 'eng_kjv', captionLang: null, extra: {} };
function prefsOut(r) {
  if (!r) return { ...PREF_DEFAULTS };
  return {
    theme: r.theme, accent: r.accent, accent2: r.accent2, fontScale: Number(r.font_scale),
    reduceMotion: r.reduce_motion, bibleTranslation: r.bible_translation, captionLang: r.caption_lang,
    extra: r.extra || {},
  };
}
async function getPrefs(userId) {
  return prefsOut(await one('SELECT * FROM user_prefs WHERE user_id=$1', [userId]));
}
async function setPrefs(userId, p = {}) {
  const cur = await getPrefs(userId);
  const n = { ...cur, ...p };
  const hex = (v, d) => (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v : d);
  n.theme = ['system', 'light', 'dark'].includes(n.theme) ? n.theme : 'system';
  n.accent = hex(n.accent, '#2563eb');
  n.accent2 = n.accent2 ? hex(n.accent2, null) : null;
  n.fontScale = Math.min(1.5, Math.max(0.8, Number(n.fontScale) || 1));
  n.extra = n.extra && typeof n.extra === 'object' ? n.extra : {};
  const r = await one(`INSERT INTO user_prefs (user_id, theme, accent, accent2, font_scale, reduce_motion, bible_translation, caption_lang, extra, updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
    ON CONFLICT (user_id) DO UPDATE SET theme=EXCLUDED.theme, accent=EXCLUDED.accent, accent2=EXCLUDED.accent2,
      font_scale=EXCLUDED.font_scale, reduce_motion=EXCLUDED.reduce_motion, bible_translation=EXCLUDED.bible_translation,
      caption_lang=EXCLUDED.caption_lang, extra=EXCLUDED.extra, updated_at=NOW()
    RETURNING *`, [userId, n.theme, n.accent, n.accent2, n.fontScale, !!n.reduceMotion, String(n.bibleTranslation || 'eng_kjv').slice(0, 40), n.captionLang ? String(n.captionLang).slice(0, 12) : null, JSON.stringify(n.extra)]);
  return prefsOut(r);
}

// ---------------------------------------------------------------- users
function userCard(r) {
  if (!r) return null;
  return {
    id: r.id, name: r.display_name || (r.email ? r.email.split('@')[0] : r.username), handle: r.handle || null,
    avatarUrl: r.avatar_url || null, bio: r.bio || null,
    followers: r.followers != null ? Number(r.followers) : undefined,
    following: r.following != null ? Number(r.following) : undefined,
    events: r.events != null ? Number(r.events) : undefined,
    isFollowing: r.is_following != null ? !!r.is_following : undefined,
  };
}
async function getUserProfile(id, viewerId) {
  return userCard(await one(`SELECT u.*,
      (SELECT COUNT(*) FROM follows WHERE followee_id=u.id) AS followers,
      (SELECT COUNT(*) FROM follows WHERE follower_id=u.id) AS following,
      (SELECT COUNT(*) FROM events WHERE host_user_id=u.id AND visibility='public') AS events,
      EXISTS(SELECT 1 FROM follows WHERE follower_id=$2 AND followee_id=u.id) AS is_following
    FROM users u WHERE u.id=$1`, [id, viewerId || 0]));
}
async function updateProfile(id, { displayName, bio, handle, avatarUrl }) {
  if (handle != null && handle !== '' && !/^[a-z0-9_.]{3,30}$/i.test(handle)) {
    const e = new Error('Handle must be 3–30 letters, numbers, dots or underscores'); e.status = 400; throw e;
  }
  try {
    await q(`UPDATE users SET display_name=COALESCE($2, display_name), bio=COALESCE($3, bio),
      handle=CASE WHEN $4::text IS NULL THEN handle WHEN $4='' THEN NULL ELSE $4 END,
      avatar_url=COALESCE($5, avatar_url), updated_at=NOW() WHERE id=$1`,
    [id, displayName ? String(displayName).slice(0, 80) : null, bio != null ? String(bio).slice(0, 500) : null, handle == null ? null : String(handle), avatarUrl || null]);
  } catch (e) {
    if (e.code === '23505') { const x = new Error('That handle is taken'); x.status = 409; throw x; }
    throw e;
  }
  return getUserProfile(id, id);
}
async function searchUsers(term, limit = 8) {
  const t = `%${String(term).toLowerCase()}%`;
  return (await many(`SELECT * FROM users WHERE LOWER(COALESCE(display_name,'')) LIKE $1 OR LOWER(COALESCE(handle,'')) LIKE $1
     OR LOWER(username) LIKE $1 ORDER BY id DESC LIMIT $2`, [t, limit])).map(userCard);
}

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
    host: { id: r.host_user_id, name: r.host_name, avatarUrl: r.host_avatar || null },
    rsvps: r.rsvps != null ? Number(r.rsvps) : undefined,
    rsvped: r.rsvped != null ? !!r.rsvped : undefined,
    historyId: r.meeting_history_id || null,
    createdAt: r.created_at,
  };
}
const EVENT_SELECT = (viewer = '0') => `SELECT e.*, u.avatar_url AS host_avatar,
  (SELECT COUNT(*) FROM event_rsvps WHERE event_id=e.id) AS rsvps,
  EXISTS(SELECT 1 FROM event_rsvps WHERE event_id=e.id AND user_id=${viewer}) AS rsvped
  FROM events e JOIN users u ON u.id=e.host_user_id`;

async function uniqueEventCode() {
  const { generateCode } = require('../rooms/store');
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
  return (await many('SELECT * FROM event_speakers WHERE event_id=$1 ORDER BY sort_order, id', [eventId]))
    .map((r) => ({ id: Number(r.id), userId: r.user_id, name: r.display_name, headline: r.headline, avatarUrl: r.avatar_url }));
}
async function setSpeakers(eventId, list) {
  return tx(async (c) => {
    await c.query('DELETE FROM event_speakers WHERE event_id=$1', [eventId]);
    let i = 0;
    for (const s of (list || []).slice(0, 20)) {
      const name = String(s.name || '').trim().slice(0, 80);
      if (!name) continue;
      await c.query('INSERT INTO event_speakers (event_id, user_id, display_name, headline, avatar_url, sort_order) VALUES ($1,$2,$3,$4,$5,$6)',
        [eventId, s.userId || null, name, s.headline ? String(s.headline).slice(0, 140) : null, s.avatarUrl || null, i++]);
    }
  }).then(() => listSpeakers(eventId));
}

// ---------------------------------------------------------------- follows / posts
async function follow(followerId, followeeId, on = true) {
  if (followerId === followeeId) { const e = new Error('You cannot follow yourself'); e.status = 400; throw e; }
  if (on) await q('INSERT INTO follows (follower_id, followee_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [followerId, followeeId]);
  else await q('DELETE FROM follows WHERE follower_id=$1 AND followee_id=$2', [followerId, followeeId]);
  return on;
}
async function suggestedPeople(userId, limit = 6) {
  return (await many(`SELECT u.*, (SELECT COUNT(*) FROM follows WHERE followee_id=u.id) AS followers
    FROM users u WHERE u.id <> $1 AND NOT EXISTS (SELECT 1 FROM follows WHERE follower_id=$1 AND followee_id=u.id)
    AND EXISTS (SELECT 1 FROM events WHERE host_user_id=u.id AND visibility='public')
    ORDER BY followers DESC, u.id DESC LIMIT $2`, [userId || 0, limit])).map(userCard);
}
function postOut(r) {
  return {
    id: Number(r.id), kind: r.kind, body: r.body, media: r.media || [], likeCount: r.like_count, commentCount: r.comment_count,
    liked: !!r.liked, createdAt: r.created_at,
    author: { id: r.user_id, name: r.author_name, avatarUrl: r.author_avatar, handle: r.author_handle },
    event: r.event_id ? { id: Number(r.event_id), slug: r.ev_slug, title: r.ev_title, status: r.ev_status, category: r.ev_category, startsAt: r.ev_starts_at, theme: r.ev_theme || {} } : null,
  };
}
const POST_SELECT = `SELECT p.*, COALESCE(u.display_name, split_part(u.email,'@',1), u.username) AS author_name, u.avatar_url AS author_avatar, u.handle AS author_handle,
  e.slug AS ev_slug, e.title AS ev_title, e.status AS ev_status, e.category AS ev_category, e.starts_at AS ev_starts_at, e.theme AS ev_theme,
  EXISTS(SELECT 1 FROM post_likes l WHERE l.post_id=p.id AND l.user_id=$1) AS liked
  FROM posts p JOIN users u ON u.id=p.user_id LEFT JOIN events e ON e.id=p.event_id`;
async function createPost(userId, { kind = 'post', body, eventId, media }) {
  const b = body == null ? null : String(body).trim().slice(0, 4000);
  if (kind === 'post' && !b && !(media && media.length)) { const e = new Error('Write something first'); e.status = 400; throw e; }
  const r = await one('INSERT INTO posts (user_id, event_id, kind, body, media) VALUES ($1,$2,$3,$4,$5) RETURNING id',
    [userId, eventId || null, kind, b, JSON.stringify((media || []).slice(0, 4))]);
  return postOut(await one(`${POST_SELECT} WHERE p.id=$2`, [userId, r.id]));
}
async function feed(userId, { before, limit = 20 } = {}) {
  const rows = await many(`${POST_SELECT}
    WHERE (p.user_id=$1 OR p.user_id IN (SELECT followee_id FROM follows WHERE follower_id=$1)
      OR (p.kind IN ('event_live','event_scheduled','event_recap') AND e.visibility='public'))
      AND ($2::timestamptz IS NULL OR p.created_at < $2)
    ORDER BY p.created_at DESC LIMIT $3`, [userId || 0, before || null, Math.min(50, limit)]);
  return rows.map(postOut);
}
async function userTimeline(userId, viewerId, { before, limit = 20 } = {}) {
  const rows = await many(`${POST_SELECT} WHERE p.user_id=$2 AND ($3::timestamptz IS NULL OR p.created_at < $3)
    ORDER BY p.created_at DESC LIMIT $4`, [viewerId || 0, userId, before || null, Math.min(50, limit)]);
  return rows.map(postOut);
}
async function togglePostLike(postId, userId) {
  return tx(async (c) => {
    const d = await c.query('DELETE FROM post_likes WHERE post_id=$1 AND user_id=$2', [postId, userId]);
    if (d.rowCount) {
      const r = await c.query('UPDATE posts SET like_count=GREATEST(0, like_count-1) WHERE id=$1 RETURNING like_count', [postId]);
      return { liked: false, likeCount: r.rows[0] ? r.rows[0].like_count : 0 };
    }
    await c.query('INSERT INTO post_likes (post_id, user_id) VALUES ($1,$2)', [postId, userId]);
    const r = await c.query('UPDATE posts SET like_count=like_count+1 WHERE id=$1 RETURNING like_count', [postId]);
    return { liked: true, likeCount: r.rows[0] ? r.rows[0].like_count : 0 };
  });
}
async function deletePost(postId, userId) {
  return (await q('DELETE FROM posts WHERE id=$1 AND user_id=$2', [postId, userId])).rowCount > 0;
}

// ---------------------------------------------------------------- comments
function commentOut(r, viewerKey) {
  return {
    id: Number(r.id), parentId: r.parent_id ? Number(r.parent_id) : null, authorKey: r.author_key, authorName: r.author_name,
    userId: r.user_id, avatarUrl: r.avatar_url || null, body: r.status === 'hidden' ? '' : r.body, status: r.status,
    likeCount: r.like_count, replyCount: r.reply_count, liked: !!r.liked, createdAt: r.created_at,
    mine: viewerKey ? r.author_key === viewerKey : false,
  };
}
async function listComments(targetType, targetKey, { parentId = null, viewerKey = '', limit = 50, before } = {}) {
  const rows = await many(`SELECT c.*, u.avatar_url, EXISTS(SELECT 1 FROM comment_likes l WHERE l.comment_id=c.id AND l.liker_key=$3) AS liked
    FROM comments c LEFT JOIN users u ON u.id=c.user_id
    WHERE c.target_type=$1 AND c.target_key=$2 AND (CASE WHEN $4::bigint = 0 THEN c.parent_id IS NULL ELSE c.parent_id=$4 END) AND c.status <> 'hidden'
      AND ($5::timestamptz IS NULL OR c.created_at < $5)
    ORDER BY ${parentId ? 'c.created_at ASC' : 'c.created_at DESC'} LIMIT $6`,
  [targetType, String(targetKey), viewerKey, parentId || 0, before || null, Math.min(100, limit)]);
  return rows.map((r) => commentOut(r, viewerKey));
}
async function addComment({ targetType, targetKey, parentId, userId, authorKey, authorName, body, moderation, status }) {
  const text = String(body || '').trim().slice(0, 2000);
  if (!text) { const e = new Error('Comment is empty'); e.status = 400; throw e; }
  return tx(async (c) => {
    if (parentId) {
      const p = await c.query('UPDATE comments SET reply_count=reply_count+1 WHERE id=$1 AND target_type=$2 AND target_key=$3 RETURNING id', [parentId, targetType, String(targetKey)]);
      if (!p.rowCount) { const e = new Error('Reply target not found'); e.status = 404; throw e; }
    }
    const r = await c.query(`INSERT INTO comments (target_type, target_key, parent_id, user_id, author_key, author_name, body, status, moderation)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [targetType, String(targetKey), parentId || null, userId || null, authorKey, String(authorName || 'Guest').slice(0, 80), text, status || 'visible', moderation ? JSON.stringify(moderation) : null]);
    if (targetType === 'post' && !parentId) await c.query('UPDATE posts SET comment_count=comment_count+1 WHERE id=$1', [Number(targetKey) || 0]);
    return commentOut(r.rows[0], authorKey);
  });
}
async function toggleCommentLike(commentId, likerKey) {
  return tx(async (c) => {
    const d = await c.query('DELETE FROM comment_likes WHERE comment_id=$1 AND liker_key=$2', [commentId, likerKey]);
    if (d.rowCount) {
      const r = await c.query('UPDATE comments SET like_count=GREATEST(0, like_count-1) WHERE id=$1 RETURNING like_count, target_type, target_key', [commentId]);
      return { liked: false, likeCount: r.rows[0]?.like_count || 0, target: r.rows[0] };
    }
    await c.query('INSERT INTO comment_likes (comment_id, liker_key) VALUES ($1,$2)', [commentId, likerKey]);
    const r = await c.query('UPDATE comments SET like_count=like_count+1 WHERE id=$1 RETURNING like_count, target_type, target_key', [commentId]);
    return { liked: true, likeCount: r.rows[0]?.like_count || 0, target: r.rows[0] };
  });
}
async function hideComment(commentId) {
  await q("UPDATE comments SET status='hidden' WHERE id=$1", [commentId]);
}
async function getComment(id) { return one('SELECT * FROM comments WHERE id=$1', [id]); }

// ---------------------------------------------------------------- polls
async function pollResults(pollId, voterKey) {
  const p = await one('SELECT * FROM polls WHERE id=$1', [pollId]);
  if (!p) return null;
  const counts = await many('SELECT option_idx, COUNT(*)::int AS n FROM poll_votes WHERE poll_id=$1 GROUP BY option_idx', [pollId]);
  const voters = await one('SELECT COUNT(DISTINCT voter_key)::int AS n FROM poll_votes WHERE poll_id=$1', [pollId]);
  const mine = voterKey ? (await many('SELECT option_idx FROM poll_votes WHERE poll_id=$1 AND voter_key=$2', [pollId, voterKey])).map((r) => r.option_idx) : [];
  const tally = p.options.map((_, i) => (counts.find((c) => c.option_idx === i) || { n: 0 }).n);
  return { id: Number(p.id), question: p.question, options: p.options, multi: p.multi, anonymous: p.anonymous, status: p.status, tally, voters: voters.n, mine, createdAt: p.created_at };
}
async function createPoll({ code, historyId, question, options, multi, anonymous, createdBy }) {
  const opts = (options || []).map((o) => String(o).trim().slice(0, 120)).filter(Boolean);
  if (!question || opts.length < 2) { const e = new Error('A poll needs a question and at least 2 options'); e.status = 400; throw e; }
  const r = await one(`INSERT INTO polls (code, meeting_history_id, question, options, multi, anonymous, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [code, historyId || null, String(question).slice(0, 300), JSON.stringify(opts.slice(0, 10)), !!multi, anonymous !== false, createdBy || null]);
  return pollResults(r.id);
}
async function votePoll(pollId, voterKey, choices) {
  const p = await one('SELECT * FROM polls WHERE id=$1', [pollId]);
  if (!p || p.status !== 'open') { const e = new Error('Poll is closed'); e.status = 400; throw e; }
  const idx = [...new Set((Array.isArray(choices) ? choices : [choices]).map(Number))].filter((i) => i >= 0 && i < p.options.length);
  if (!idx.length) { const e = new Error('Choose an option'); e.status = 400; throw e; }
  await tx(async (c) => {
    await c.query('DELETE FROM poll_votes WHERE poll_id=$1 AND voter_key=$2', [pollId, voterKey]);
    for (const i of p.multi ? idx : idx.slice(0, 1)) await c.query('INSERT INTO poll_votes (poll_id, voter_key, option_idx) VALUES ($1,$2,$3)', [pollId, voterKey, i]);
  });
  return pollResults(pollId, voterKey);
}
async function closePoll(pollId) {
  await q("UPDATE polls SET status='closed', closed_at=NOW() WHERE id=$1", [pollId]);
  return pollResults(pollId);
}
async function listPolls(code, historyId, voterKey) {
  const rows = await many('SELECT id FROM polls WHERE code=$1 AND ($2::int IS NULL OR meeting_history_id=$2) ORDER BY created_at DESC LIMIT 30', [code, historyId || null]);
  return Promise.all(rows.map((r) => pollResults(r.id, voterKey)));
}

// ---------------------------------------------------------------- Q&A
function questionOut(r, voted) {
  return { id: Number(r.id), authorKey: r.author_key, authorName: r.author_name, body: r.body, upvotes: r.upvotes, status: r.status, aiAnswer: r.ai_answer, createdAt: r.created_at, voted: !!voted };
}
async function addQuestion({ code, historyId, authorKey, authorName, body }) {
  const t = String(body || '').trim().slice(0, 1000);
  if (!t) { const e = new Error('Question is empty'); e.status = 400; throw e; }
  return questionOut(await one('INSERT INTO questions (code, meeting_history_id, author_key, author_name, body) VALUES ($1,$2,$3,$4,$5) RETURNING *',
    [code, historyId || null, authorKey, String(authorName).slice(0, 80), t]));
}
async function upvoteQuestion(id, voterKey) {
  return tx(async (c) => {
    const d = await c.query('DELETE FROM question_votes WHERE question_id=$1 AND voter_key=$2', [id, voterKey]);
    if (d.rowCount) return questionOut((await c.query('UPDATE questions SET upvotes=GREATEST(0,upvotes-1) WHERE id=$1 RETURNING *', [id])).rows[0], false);
    await c.query('INSERT INTO question_votes (question_id, voter_key) VALUES ($1,$2)', [id, voterKey]);
    return questionOut((await c.query('UPDATE questions SET upvotes=upvotes+1 WHERE id=$1 RETURNING *', [id])).rows[0], true);
  });
}
async function setQuestionStatus(id, status, aiAnswer) {
  const r = await one('UPDATE questions SET status=COALESCE($2,status), ai_answer=COALESCE($3, ai_answer) WHERE id=$1 RETURNING *', [id, status || null, aiAnswer || null]);
  return r ? questionOut(r) : null;
}
async function listQuestions(code, historyId, voterKey) {
  const rows = await many(`SELECT qq.*, EXISTS(SELECT 1 FROM question_votes v WHERE v.question_id=qq.id AND v.voter_key=$3) AS voted
    FROM questions qq WHERE code=$1 AND ($2::int IS NULL OR meeting_history_id=$2) AND status <> 'dismissed'
    ORDER BY (status='live') DESC, (status='answered') ASC, upvotes DESC, created_at ASC LIMIT 200`, [code, historyId || null, voterKey || '']);
  return rows.map((r) => questionOut(r, r.voted));
}

// ---------------------------------------------------------------- transcripts / summaries
async function addTranscriptSegment({ historyId, code, speakerKey, speakerName, text, lang, source }) {
  const t = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 4000);
  if (!t || !historyId) return null;
  const r = await one(`INSERT INTO transcript_segments (meeting_history_id, code, speaker_key, speaker_name, text, lang, source)
    VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [historyId, code, speakerKey || null, String(speakerName || 'Speaker').slice(0, 80), t, lang || null,
    ['stt', 'webspeech', 'manual', 'import'].includes(source) ? source : 'stt']);
  return { id: Number(r.id), speakerName: r.speaker_name, text: r.text, lang: r.lang, source: r.source, at: r.spoken_at };
}
async function getTranscript(historyId, { after, limit = 5000 } = {}) {
  return (await many(`SELECT * FROM transcript_segments WHERE meeting_history_id=$1 AND ($2::bigint IS NULL OR id > $2) ORDER BY spoken_at, id LIMIT $3`,
    [historyId, after || null, limit])).map((r) => ({ id: Number(r.id), speakerName: r.speaker_name, speakerKey: r.speaker_key, text: r.text, lang: r.lang, source: r.source, at: r.spoken_at }));
}
/** "Name: text" lines, merging consecutive segments by the same speaker. */
function transcriptToText(segs) {
  const lines = [];
  for (const s of segs) {
    const last = lines[lines.length - 1];
    if (last && last.name === s.speakerName && new Date(s.at) - last.at < 20000) {
      last.text += ' ' + s.text; last.at = new Date(s.at);
    } else lines.push({ name: s.speakerName, text: s.text, at: new Date(s.at) });
  }
  return lines.map((l) => `${l.name}: ${l.text}`).join('\n');
}
async function saveSummary({ historyId, kind = 'summary', content, provider, model, userId }) {
  const r = await one(`INSERT INTO ai_summaries (meeting_history_id, kind, content, provider, model, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [historyId, kind, content, provider || null, model || null, userId || null]);
  return { id: Number(r.id), kind: r.kind, content: r.content, provider: r.provider, model: r.model, createdAt: r.created_at };
}
async function latestSummaries(historyId) {
  return (await many(`SELECT DISTINCT ON (kind) * FROM ai_summaries WHERE meeting_history_id=$1 ORDER BY kind, created_at DESC`, [historyId]))
    .map((r) => ({ id: Number(r.id), kind: r.kind, content: r.content, provider: r.provider, model: r.model, createdAt: r.created_at }));
}
async function getHistory(id) { return one('SELECT * FROM meeting_history WHERE id=$1', [id]); }
async function canAccessHistory(historyId, userId) {
  if (!userId) return false;
  return !!(await one(`SELECT 1 FROM meeting_history h WHERE h.id=$1 AND (h.host_user_id=$2 OR EXISTS
    (SELECT 1 FROM meeting_participants_log l WHERE l.meeting_history_id=h.id AND l.user_id=$2))`, [historyId, userId]));
}
async function logAiUsage({ useCase, provider, model, ok, latencyMs, error }) {
  await q('INSERT INTO ai_usage (use_case, provider, model, ok, latency_ms, error) VALUES ($1,$2,$3,$4,$5,$6)',
    [useCase, provider, model || null, !!ok, latencyMs || null, error ? String(error).slice(0, 500) : null]).catch(() => {});
}

// ---------------------------------------------------------------- files / whiteboards / bible cache
async function insertFile(f) {
  await q(`INSERT INTO files (id, owner_user_id, owner_key, driver, object_key, filename, mime, size_bytes, purpose, room_code) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [f.id, f.ownerUserId || null, f.ownerKey || null, f.driver, f.objectKey, f.filename, f.mime, f.size, f.purpose || 'attachment', f.roomCode || null]);
}
/** Bytes stored by a user, a guest key or a meeting (for quotas). */
async function fileUsage({ userId, ownerKey, roomCode } = {}) {
  const [col, val] = userId ? ['owner_user_id', userId] : ownerKey ? ['owner_key', ownerKey] : roomCode ? ['room_code', roomCode] : [];
  if (!col) return 0;
  const r = await one(`SELECT COALESCE(SUM(size_bytes),0)::bigint AS n FROM files WHERE ${col}=$1`, [val]);
  return Number(r && r.n) || 0;
}
async function getFile(id) { return one('SELECT * FROM files WHERE id=$1', [id]); }
async function getWhiteboard(userId, title = 'My board') {
  const r = await one('SELECT * FROM whiteboards WHERE user_id=$1 AND title=$2 ORDER BY updated_at DESC LIMIT 1', [userId, title]);
  return r ? { id: Number(r.id), title: r.title, data: r.data, updatedAt: r.updated_at } : { id: null, title, data: {}, updatedAt: null };
}
async function saveWhiteboard(userId, title = 'My board', data = {}) {
  // Legacy title-addressed save (the old single "Personal" board). Updates the newest board with that title.
  const t = String(title).slice(0, 80);
  const ex = await one('SELECT id FROM whiteboards WHERE user_id=$1 AND title=$2 ORDER BY updated_at DESC LIMIT 1', [userId, t]);
  const r = ex ? await one('UPDATE whiteboards SET data=$2, updated_at=NOW() WHERE id=$1 RETURNING *', [ex.id, JSON.stringify(data)])
    : await one('INSERT INTO whiteboards (user_id, title, data, updated_at) VALUES ($1,$2,$3,NOW()) RETURNING *', [userId, t, JSON.stringify(data)]);
  return { id: Number(r.id), title: r.title, updatedAt: r.updated_at };
}
async function listWhiteboards(userId) {
  return (await many(`SELECT id, title, updated_at, COALESCE(jsonb_array_length(CASE WHEN jsonb_typeof(data->'pages')='array' THEN data->'pages' END),1) AS pages
    FROM whiteboards WHERE user_id=$1 ORDER BY updated_at DESC LIMIT 200`, [userId]))
    .map((r) => ({ id: Number(r.id), title: r.title, updatedAt: r.updated_at, pages: Number(r.pages) || 1 }));
}
const boardOut = (r) => r && { id: Number(r.id), title: r.title, data: r.data || {}, updatedAt: r.updated_at };
async function createWhiteboard(userId, title, data = {}) {
  return boardOut(await one('INSERT INTO whiteboards (user_id, title, data) VALUES ($1,$2,$3) RETURNING *', [userId, String(title || 'Untitled board').slice(0, 80), JSON.stringify(data)]));
}
async function getWhiteboardById(userId, id) { return boardOut(await one('SELECT * FROM whiteboards WHERE id=$1 AND user_id=$2', [id, userId])); }
async function updateWhiteboard(userId, id, { title, data }) {
  return boardOut(await one(`UPDATE whiteboards SET title=COALESCE($3,title), data=COALESCE($4::jsonb,data), updated_at=NOW() WHERE id=$1 AND user_id=$2 RETURNING *`,
    [id, userId, title == null ? null : String(title).slice(0, 80), data == null ? null : JSON.stringify(data)]));
}
async function deleteWhiteboard(userId, id) { return !!(await one('DELETE FROM whiteboards WHERE id=$1 AND user_id=$2 RETURNING id', [id, userId])); }
async function bibleCacheGet(t, b, c, maxAgeDays) {
  const r = await one(`SELECT payload FROM bible_cache WHERE translation=$1 AND book=$2 AND chapter=$3 AND fetched_at > NOW() - ($4 || ' days')::interval`, [t, b, c, String(maxAgeDays)]);
  return r ? r.payload : null;
}
async function bibleCachePut(t, b, c, payload) {
  await q(`INSERT INTO bible_cache (translation, book, chapter, payload) VALUES ($1,$2,$3,$4)
    ON CONFLICT (translation, book, chapter) DO UPDATE SET payload=EXCLUDED.payload, fetched_at=NOW()`, [t, b, c, JSON.stringify(payload)]);
}

// ---------------------------------------------------------------- dashboard
async function dashboard(userId) {
  const stats = await one(`SELECT
      (SELECT COUNT(*) FROM meeting_history WHERE host_user_id=$1)::int AS hosted,
      (SELECT COUNT(DISTINCT meeting_history_id) FROM meeting_participants_log WHERE user_id=$1)::int AS attended,
      (SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(left_at, NOW()) - joined_at))),0) FROM meeting_participants_log WHERE user_id=$1 AND joined_at > NOW() - INTERVAL '30 days')::bigint AS seconds30,
      (SELECT COUNT(*) FROM follows WHERE followee_id=$1)::int AS followers,
      (SELECT COUNT(*) FROM follows WHERE follower_id=$1)::int AS following,
      (SELECT COALESCE(SUM(total_joins),0) FROM events WHERE host_user_id=$1)::int AS audience,
      (SELECT COALESCE(MAX(peak_viewers),0) FROM events WHERE host_user_id=$1)::int AS peak,
      (SELECT COUNT(*) FROM transcript_segments t JOIN meeting_history h ON h.id=t.meeting_history_id WHERE h.host_user_id=$1)::int AS transcript_lines`, [userId]);
  const activity = await many(`SELECT to_char(d, 'YYYY-MM-DD') AS day,
      (SELECT COUNT(*) FROM meeting_participants_log l WHERE l.user_id=$1 AND l.joined_at::date = d::date)::int AS n
    FROM generate_series(CURRENT_DATE - INTERVAL '13 days', CURRENT_DATE, INTERVAL '1 day') d ORDER BY d`, [userId]);
  return { stats, activity };
}

module.exports = {
  CATEGORIES, getPrefs, setPrefs, getUserProfile, updateProfile, searchUsers,
  createEvent, updateEvent, deleteEvent, getEventById, getEventBySlug, getEventByCode, discover, categoryCounts, myEvents, rsvpedEvents,
  toggleRsvp, markEventLive, markEventEnded, updateViewers, listSpeakers, setSpeakers,
  follow, suggestedPeople, createPost, feed, userTimeline, togglePostLike, deletePost,
  listComments, addComment, toggleCommentLike, hideComment, getComment,
  createPoll, votePoll, closePoll, listPolls, pollResults,
  addQuestion, upvoteQuestion, setQuestionStatus, listQuestions,
  addTranscriptSegment, getTranscript, transcriptToText, saveSummary, latestSummaries, getHistory, canAccessHistory, logAiUsage,
  insertFile, fileUsage, getFile, getWhiteboard, saveWhiteboard, listWhiteboards, createWhiteboard, getWhiteboardById, updateWhiteboard, deleteWhiteboard, bibleCacheGet, bibleCachePut, dashboard,
};
