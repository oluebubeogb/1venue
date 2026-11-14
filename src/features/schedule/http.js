/**
 * Schedule: create/list/delete/start scheduled meetings.
 * Raw HTTP handler.
 * Each block answers its path and returns; unmatched requests fall through (return false).
 */
const {
  db, normCode, codeLink, parseBody, sendJSON, getAuthUser, meetings, generateCode, publicErr,
} = require('../../core/http-kit');

module.exports = async function handle(req, res, parsed) {
  const urlPath = parsed.pathname;

  // ----- Schedule APIs (logged-in) -----
  if (urlPath === '/api/schedule' && req.method === 'POST') {
    try {
      const authUser = await getAuthUser(req, res);
      if (!authUser || !authUser.id) return sendJSON(res, 401, { error: 'Login required to schedule' });
      const body = await parseBody(req);
      const name = String(body.name || 'Scheduled meeting').trim().slice(0, 80) || 'Scheduled meeting';
      const scheduledStart = body.scheduledStart || body.start;
      if (!scheduledStart) return sendJSON(res, 400, { error: 'scheduledStart required (ISO datetime)' });
      const startDate = new Date(scheduledStart);
      if (Number.isNaN(startDate.getTime())) return sendJSON(res, 400, { error: 'Invalid scheduledStart' });
      let scheduledEnd = body.scheduledEnd || body.end || null;
      if (scheduledEnd) {
        const endDate = new Date(scheduledEnd);
        if (Number.isNaN(endDate.getTime())) scheduledEnd = null;
        else scheduledEnd = endDate.toISOString();
      }
      const code = generateCode();
      const row = await db.createScheduledMeeting({
        code,
        name,
        hostUserId: authUser.id,
        hostDisplayName: authUser.displayName || authUser.username || null,
        scheduledStart: startDate.toISOString(),
        scheduledEnd,
      });
      return sendJSON(res, 201, {
        id: row.id,
        code: row.code,
        name: row.name,
        scheduledStart: row.scheduled_start,
        scheduledEnd: row.scheduled_end,
        status: row.status,
        link: codeLink(row.code),
      });
    } catch (e) {
      console.error('[schedule]', e);
      return sendJSON(res, 400, { error: publicErr(e, 'Bad request') });
    }
  }

  if (urlPath === '/api/schedule' && req.method === 'GET') {
    try {
      const authUser = await getAuthUser(req, res);
      if (!authUser || !authUser.id) return sendJSON(res, 401, { error: 'Login required' });
      const rows = await db.getScheduledForUser(authUser.id, 50);
      return sendJSON(res, 200, {
        meetings: rows.map((r) => ({
          id: r.id,
          code: r.code,
          name: r.name,
          scheduledStart: r.scheduled_start,
          scheduledEnd: r.scheduled_end,
          status: r.status,
          createdAt: r.created_at,
          startedAt: r.started_at,
          endedAt: r.ended_at,
          link: codeLink(r.code),
          isLive: meetings.has(normCode(r.code)),
        })),
      });
    } catch (e) {
      return sendJSON(res, 500, { error: publicErr(e, 'Failed') });
    }
  }

  if (urlPath.startsWith('/api/schedule/') && req.method === 'DELETE') {
    try {
      const authUser = await getAuthUser(req, res);
      if (!authUser || !authUser.id) return sendJSON(res, 401, { error: 'Login required' });
      const id = parseInt(urlPath.split('/').pop(), 10);
      if (!id) return sendJSON(res, 400, { error: 'Invalid id' });
      await db.deleteScheduled(id, authUser.id);
      return sendJSON(res, 200, { ok: true });
    } catch (e) {
      return sendJSON(res, 400, { error: publicErr(e, 'Bad request') });
    }
  }

  if (urlPath === '/api/schedule/start' && req.method === 'POST') {
    try {
      const authUser = await getAuthUser(req, res);
      if (!authUser || !authUser.id) return sendJSON(res, 401, { error: 'Login required' });
      const body = await parseBody(req);
      const id = body.id;
      const row = await db.getScheduledById(id);
      if (!row || row.host_user_id !== authUser.id) {
        return sendJSON(res, 404, { error: 'Scheduled meeting not found' });
      }
      return sendJSON(res, 200, {
        code: row.code,
        name: row.name,
        scheduledId: row.id,
      });
    } catch (e) {
      return sendJSON(res, 400, { error: publicErr(e, 'Bad request') });
    }
  }

  return false;
};
