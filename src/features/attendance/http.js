/**
 * Attendance lists: generate, list, view, toggle public, share to timeline.
 * Raw HTTP handler (moved verbatim from the old src/http/routes.js chain).
 * Each block answers its path and returns; unmatched requests fall through (return false).
 */
const {
  db, config, parseBody, sendJSON, getAuthUser, 
} = require('../../core/http-kit');

module.exports = async function handle(req, res, parsed) {
  const urlPath = parsed.pathname;

  // ---------- Attendance lists ----------
  if (urlPath === '/api/attendance/generate' && req.method === 'POST') {
    const user = await getAuthUser(req, res);
    if (!user) return sendJSON(res, 401, { error: 'Not authenticated' });
    const body = await parseBody(req);
    const historyId = parseInt(body.historyId, 10);
    if (!historyId) return sendJSON(res, 400, { error: 'historyId required' });
    const meeting = await db.getMeetingHistoryById(historyId);
    if (!meeting || meeting.host_user_id !== user.id) return sendJSON(res, 403, { error: 'Only the host can generate an attendance list' });
    let share = await db.getAttendanceShareForHistory(historyId);
    if (!share) {
      share = await db.createAttendanceShare(historyId, user.id, body.public !== false);
    }
    return sendJSON(res, 200, {
      token: share.token,
      url: `/a/${share.token}`,
      isPublic: !!share.is_public,
      historyId,
    });
  }

  if (urlPath === '/api/attendance/list' && req.method === 'GET') {
    const user = await getAuthUser(req, res);
    if (!user) return sendJSON(res, 401, { error: 'Not authenticated' });
    const rows = await db.listAttendanceSharesForUser(user.id);
    return sendJSON(res, 200, {
      lists: rows.map((r) => ({
        token: r.token,
        url: `/a/${r.token}`,
        isPublic: !!r.is_public,
        historyId: r.meeting_history_id,
        name: r.name,
        code: r.code,
        createdAt: r.meeting_created,
        endedAt: r.ended_at,
        hostName: r.host_display_name,
      })),
    });
  }

  if (urlPath.startsWith('/api/attendance/') && req.method === 'GET' && urlPath.split('/').length === 4) {
    const token = urlPath.split('/').pop();
    const share = await db.getAttendanceShareByToken(token);
    if (!share) return sendJSON(res, 404, { error: 'Attendance list not found' });
    const meeting = await db.getMeetingHistoryById(share.meeting_history_id);
    if (!meeting) return sendJSON(res, 404, { error: 'Meeting not found' });
    // Private: only host or cohost (approximated as host for now; cohosts not stored in log)
    if (!share.is_public) {
      const user = await getAuthUser(req, res);
      if (!user || (user.id !== meeting.host_user_id)) {
        return sendJSON(res, 403, { error: 'This attendance list is private' });
      }
    }
    const logs = await db.getMeetingParticipantsLog(meeting.id);
    // Group by user_id or display_name
    const groups = new Map();
    for (const row of logs) {
      const key = row.user_id ? `u:${row.user_id}` : `n:${row.display_name}`;
      if (!groups.has(key)) {
        groups.set(key, {
          userId: row.user_id,
          name: row.display_name,
          joins: [],
          lefts: [],
          isHost: row.user_id === meeting.host_user_id,
        });
      }
      const g = groups.get(key);
      g.joins.push(row.joined_at);
      if (row.left_at) g.lefts.push(row.left_at);
    }
    const attendees = [];
    for (const g of groups.values()) {
      const joins = g.joins.sort();
      const lefts = g.lefts.sort();
      const lastLeft = lefts.length ? lefts[lefts.length - 1] : null;
      let durationMs = 0;
      // Pair joins with subsequent lefts roughly; simple sum of intervals
      for (let i = 0; i < joins.length; i++) {
        const start = new Date(joins[i]).getTime();
        const end = (lefts[i] ? new Date(lefts[i]).getTime() : Date.now());
        if (end > start) durationMs += end - start;
      }
      attendees.push({
        name: g.name,
        userId: g.userId,
        isHost: g.isHost,
        signIns: joins.map(t => new Date(t).toISOString()),
        signOut: lastLeft ? new Date(lastLeft).toISOString() : null,
        durationSec: Math.round(durationMs / 1000),
        interruptions: joins.length > 1,
      });
    }
    // Sort: host first, then by first join
    attendees.sort((a, b) => (b.isHost - a.isHost) || (a.signIns[0] || '').localeCompare(b.signIns[0] || ''));
    return sendJSON(res, 200, {
      meeting: {
        id: meeting.id,
        name: meeting.name,
        code: meeting.code,
        hostName: meeting.host_display_name,
        hostUserId: meeting.host_user_id,
        createdAt: meeting.created_at,
        endedAt: meeting.ended_at,
      },
      isPublic: !!share.is_public,
      attendees,
      token,
    });
  }

  if (urlPath === '/api/attendance/toggle' && req.method === 'POST') {
    const user = await getAuthUser(req, res);
    if (!user) return sendJSON(res, 401, { error: 'Not authenticated' });
    const body = await parseBody(req);
    const share = await db.getAttendanceShareByToken(body.token);
    if (!share) return sendJSON(res, 404, { error: 'Not found' });
    const meeting = await db.getMeetingHistoryById(share.meeting_history_id);
    if (!meeting || meeting.host_user_id !== user.id) return sendJSON(res, 403, { error: 'Forbidden' });
    const updated = await db.setAttendancePublic(body.token, body.public !== false);
    return sendJSON(res, 200, { isPublic: !!updated.is_public });
  }

  if (urlPath === '/api/attendance/share-timeline' && req.method === 'POST') {
    const user = await getAuthUser(req, res);
    if (!user) return sendJSON(res, 401, { error: 'Not authenticated' });
    const body = await parseBody(req);
    const share = await db.getAttendanceShareByToken(body.token);
    if (!share || !share.is_public) return sendJSON(res, 400, { error: 'Only public lists can be shared to the timeline' });
    const meeting = await db.getMeetingHistoryById(share.meeting_history_id);
    if (!meeting || meeting.host_user_id !== user.id) return sendJSON(res, 403, { error: 'Forbidden' });
    const url = `${config.PUBLIC_URL || ''}/a/${share.token}`;
    const post = await require('../../venue/data').createPost(user.id, {
      kind: 'post',
      body: `Attendance list for ${meeting.name} ${url}`,
    });
    return sendJSON(res, 200, { ok: true, postId: post.id, url });
  }

  return false;
};
