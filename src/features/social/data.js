/**
 * social queries (PostgreSQL, parameterised). Split out of src/venue/data.js;
 * src/venue/data.js still re-exports everything for older call sites.
 */
const { q, tx, one, many } = require('../../core/db');

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
  const { publicUsername, isInternalUsername } = require('../../lib/auth');
  const raw = r.username || null;
  const uname = publicUsername(raw) || (!isInternalUsername(raw) ? raw : null);
  return {
    id: r.id,
    username: uname,
    name: r.display_name || uname || (r.email ? r.email.split('@')[0] : raw),
    handle: r.handle || uname || null,
    avatarUrl: r.avatar_url || null, bio: r.bio || null,
    followers: r.followers != null ? Number(r.followers) : undefined,
    following: r.following != null ? Number(r.following) : undefined,
    eventCount: r.events != null ? Number(r.events) : undefined,
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
  const { publicUsername } = require('../../lib/auth');
  const authorU = publicUsername(r.author_username) || r.author_handle || null;
  return {
    id: Number(r.id), kind: r.kind, body: r.body, media: r.media || [], likeCount: r.like_count, commentCount: r.comment_count,
    liked: !!r.liked, createdAt: r.created_at,
    author: { id: r.user_id, username: authorU, name: r.author_name, avatarUrl: r.author_avatar, handle: r.author_handle || authorU },
    event: r.event_id ? { id: Number(r.event_id), slug: r.ev_slug, title: r.ev_title, status: r.ev_status, category: r.ev_category, startsAt: r.ev_starts_at, theme: r.ev_theme || {}, coverUrl: r.ev_cover_url || null } : null,
  };
}
const POST_SELECT = `SELECT p.*, COALESCE(u.display_name, split_part(u.email,'@',1), u.username) AS author_name, u.avatar_url AS author_avatar, u.handle AS author_handle, u.username AS author_username,
  e.slug AS ev_slug, e.title AS ev_title, e.status AS ev_status, e.category AS ev_category, e.starts_at AS ev_starts_at, e.theme AS ev_theme, e.cover_url AS ev_cover_url,
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

module.exports = { PREF_DEFAULTS, prefsOut, getPrefs, setPrefs, userCard, getUserProfile, updateProfile, searchUsers, follow, suggestedPeople, postOut, POST_SELECT, createPost, feed, userTimeline, togglePostLike, deletePost };
