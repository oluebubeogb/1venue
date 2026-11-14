/**
 * comments queries (PostgreSQL, parameterised). Split out of src/venue/data.js;
 * src/venue/data.js still re-exports everything for older call sites.
 */
const { q, tx, one, many } = require('../../core/db');

// ---------------------------------------------------------------- comments
function commentOut(r, viewerKey) {
  return {
    id: Number(r.id), parentId: r.parent_id ? Number(r.parent_id) : null, authorKey: r.author_key, authorName: r.author_name,
    userId: r.user_id, username: r.username || null, avatarUrl: r.avatar_url || null, body: r.status === 'hidden' ? '' : r.body, status: r.status,
    likeCount: r.like_count, replyCount: r.reply_count, liked: !!r.liked, createdAt: r.created_at,
    mine: viewerKey ? r.author_key === viewerKey : false,
  };
}
async function listComments(targetType, targetKey, { parentId = null, viewerKey = '', limit = 50, before } = {}) {
  const rows = await many(`SELECT c.*, u.avatar_url, u.username, EXISTS(SELECT 1 FROM comment_likes l WHERE l.comment_id=c.id AND l.liker_key=$3) AS liked
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

module.exports = { commentOut, listComments, addComment, toggleCommentLike, hideComment, getComment };
