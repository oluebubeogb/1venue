/**
 * Private chat: cross-meeting DM threads for signed-in users.
 * Raw HTTP handler (moved verbatim from the old src/http/routes.js chain).
 * Each block answers its path and returns; unmatched requests fall through (return false).
 */
const {
  db, sendJSON, getAuthUser,
} = require('../../core/http-kit');

module.exports = async function handle(req, res, parsed) {
  const urlPath = parsed.pathname;

  /* ─── Private DM history (cross-meeting, logged-in users) ─── */
  if (urlPath === '/api/dm/threads' && req.method === 'GET') {
    const user = await getAuthUser(req, res);
    if (!user) return sendJSON(res, 401, { error: 'Not authenticated' });
    try {
      const threads = await db.listDmThreadsForUser(user.id, 50);
      const out = [];
      for (const t of threads) {
        let peerName = t.guest_display_name || 'Guest';
        let peerUserId = null;
        let peerIsGuest = !!(t.peer_is_guest === true || t.peer_is_guest === 1);
        if (!peerIsGuest) {
          peerUserId = t.user_a_id === user.id ? t.user_b_id : t.user_a_id;
          if (peerUserId) {
            try {
              const peer = await db.getUserById(peerUserId);
              if (peer) peerName = peer.username || peer.email || ('User ' + peerUserId);
            } catch (_) {}
          }
        }
        const msgs = await db.getDmMessages(t.id, 1);
        const last = msgs[msgs.length - 1];
        out.push({
          threadId: t.id,
          peerUserId,
          peerName,
          peerIsGuest,
          lastText: last ? last.body : '',
          lastAt: t.last_message_at || t.created_at,
        });
      }
      return sendJSON(res, 200, { threads: out });
    } catch (e) {
      console.error('[dm/threads]', e);
      return sendJSON(res, 500, { error: 'Failed to load DM threads' });
    }
  }

  if (urlPath.match(/^\/api\/dm\/threads\/\d+$/) && req.method === 'GET') {
    const user = await getAuthUser(req, res);
    if (!user) return sendJSON(res, 401, { error: 'Not authenticated' });
    const threadId = parseInt(urlPath.split('/').pop(), 10);
    if (!threadId) return sendJSON(res, 400, { error: 'Invalid thread' });
    try {
      const thread = await db.getDmThreadById(threadId);
      if (!thread) return sendJSON(res, 404, { error: 'Thread not found' });
      const isMember =
        thread.user_a_id === user.id ||
        thread.user_b_id === user.id;
      if (!isMember) return sendJSON(res, 403, { error: 'Forbidden' });
      const messages = await db.getDmMessages(threadId, 200);
      return sendJSON(res, 200, {
        threadId,
        peerIsGuest: !!(thread.peer_is_guest === true || thread.peer_is_guest === 1),
        guestDisplayName: thread.guest_display_name || null,
        messages: messages.map((m) => ({
          id: m.id,
          fromUserId: m.sender_user_id,
          fromName: m.sender_name,
          text: m.body,
          at: m.created_at,
          meetingCode: m.meeting_code,
          isMe: m.sender_user_id === user.id,
        })),
      });
    } catch (e) {
      console.error('[dm/thread]', e);
      return sendJSON(res, 500, { error: 'Failed to load messages' });
    }
  }

  if (urlPath === '/api/dm/with-user' && req.method === 'GET') {
    const user = await getAuthUser(req, res);
    if (!user) return sendJSON(res, 401, { error: 'Not authenticated' });
    const urlObj = new URL(req.url, 'http://localhost');
    const peerUserId = parseInt(urlObj.searchParams.get('userId') || '', 10);
    if (!peerUserId) return sendJSON(res, 400, { error: 'userId required' });
    try {
      const thread = await db.findOrCreateDmThread(user.id, peerUserId);
      const messages = await db.getDmMessages(thread.id, 200);
      return sendJSON(res, 200, {
        threadId: thread.id,
        messages: messages.map((m) => ({
          id: m.id,
          fromUserId: m.sender_user_id,
          fromName: m.sender_name,
          text: m.body,
          at: m.created_at,
          meetingCode: m.meeting_code,
          isMe: m.sender_user_id === user.id,
        })),
      });
    } catch (e) {
      console.error('[dm/with-user]', e);
      return sendJSON(res, 500, { error: 'Failed to load DM' });
    }
  }

  return false;
};
