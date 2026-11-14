/**
 * Activity: recent activity for a meeting.
 * Raw HTTP handler.
 * Each block answers its path and returns; unmatched requests fall through (return false).
 */
const {
  db, normCode, sendJSON, meetings, publicErr,
} = require('../../core/http-kit');

module.exports = async function handle(req, res, parsed) {
  const urlPath = parsed.pathname;

  // ----- Phase 2: activity -----
  if (urlPath === '/api/activity' && req.method === 'GET') {
    try {
      const code = normCode(parsed.searchParams.get('code'));
      if (!code) return sendJSON(res, 400, { error: 'code required' });
      const meeting = meetings.get(code);
      const live = meeting && Array.isArray(meeting.activityLive) ? meeting.activityLive.slice(-50) : [];
      const rows = await db.getActivityForCode(code, 100);
      return sendJSON(res, 200, {
        live,
        history: rows.map((r) => ({
          id: r.id,
          at: r.at,
          actorName: r.actor_name,
          eventType: r.event_type,
          detail: r.detail,
        })),
      });
    } catch (e) {
      return sendJSON(res, 500, { error: publicErr(e, 'Failed') });
    }
  }

  return false;
};
