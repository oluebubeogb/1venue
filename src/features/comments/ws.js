/** Room plugin: comments. Turn off with FEATURE_COMMENTS=false. */
const data = require('../../venue/data');
const { mod, active, voterKey, err, limited } = require('../../core/room-helpers');

// ------------------------------------------------------------------ comments
function commentTarget(meeting, code) {
  return meeting.eventId ? { type: 'event', key: String(meeting.eventId) } : { type: 'room', key: `${code}:${meeting.historyId || 0}` };
}
const commentsPlugin = {
  id: 'comments',
  register(ctx) {
    const { broadcast } = ctx;
    ctx.onRegister((ws, meeting, pid) => {
      const p = meeting.participants.get(pid);
      const t = commentTarget(meeting, meeting.code || '');
      data.listComments(t.type, t.key, { viewerKey: p ? voterKey(p) : '', limit: 60 })
        .then((comments) => { try { ws.send(JSON.stringify({ type: 'comments', comments })); } catch (_) {} }).catch(() => {});
    });
    ctx.onWs('comment-add', async ({ msg, participantId: pid, meeting, meetingCode }) => {
      const p = active(meeting, pid);
      if (!p || limited(pid, 'comment', 1500)) return;
      const t = commentTarget(meeting, meetingCode);
      let moderation = null;
      const ai = require('../venue/ai');
      if (ai.status().enabled && meeting.settings && meeting.settings.aiModeration !== false) {
        moderation = await ai.moderate(msg.body).catch(() => null);
        if (moderation && !moderation.allowed) return err(ctx, pid, `Comment held: ${moderation.reason || 'community guidelines'}`);
      }
      try {
        const comment = await data.addComment({ targetType: t.type, targetKey: t.key, parentId: msg.parentId || null, userId: p.userId, authorKey: voterKey(p), authorName: p.name, body: msg.body, moderation });
        broadcast(meetingCode, { type: 'comment-new', comment: { ...comment, mine: false } });
      } catch (e) { err(ctx, pid, e.message); }
    });
    ctx.onWs('comment-like', async ({ msg, participantId: pid, meeting, meetingCode }) => {
      const p = active(meeting, pid);
      if (!p) return;
      const r = await data.toggleCommentLike(Number(msg.id), voterKey(p));
      ctx.sendToParticipant(pid, { type: 'comment-liked', id: Number(msg.id), liked: r.liked });
      broadcast(meetingCode, { type: 'comment-likes', id: Number(msg.id), likeCount: r.likeCount });
    });
    ctx.onWs('comment-replies', async ({ msg, participantId: pid, meeting, ws }) => {
      const p = active(meeting, pid);
      if (!p) return;
      const t = commentTarget(meeting, meeting.code || '');
      const replies = await data.listComments(t.type, t.key, { parentId: Number(msg.id), viewerKey: voterKey(p) });
      ws.send(JSON.stringify({ type: 'comment-replies', id: Number(msg.id), replies }));
    });
    ctx.onWs('comment-hide', async ({ msg, participantId: pid, meeting, meetingCode }) => {
      const c = await data.getComment(Number(msg.id));
      const p = active(meeting, pid);
      if (!c || !p || !(mod(meeting, pid) || c.author_key === voterKey(p))) return;
      await data.hideComment(c.id);
      broadcast(meetingCode, { type: 'comment-hidden', id: Number(c.id) });
    });
  },
};

module.exports = commentsPlugin;
