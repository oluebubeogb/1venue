/**
 * Recording: recording state for a meeting.
 * Raw HTTP handler.
 * Each block answers its path and returns; unmatched requests fall through (return false).
 */
const {
  db, normCode, sendJSON, meetings, publicErr,
} = require('../../core/http-kit');

module.exports = async function handle(req, res, parsed) {
  const urlPath = parsed.pathname;

  // Recording state for a meeting
  if (urlPath === '/api/recording' && req.method === 'GET') {
    try {
      const code = normCode(parsed.searchParams.get('code'));
      const meeting = meetings.get(code);
      const active = meeting?.recording || null;
      const past = code ? await db.getRecordingsForCode(code, 10) : [];
      return sendJSON(res, 200, { recording: active, past });
    } catch (e) {
      return sendJSON(res, 500, { error: publicErr(e, 'Failed') });
    }
  }

  return false;
};
