const { USE_PG } = require('../../../db');
/**
 * dashboard queries (PostgreSQL, parameterised). Split out of src/venue/data.js;
 * src/venue/data.js still re-exports everything for older call sites.
 */
const { one, many } = require('../../core/db');

// ---------------------------------------------------------------- dashboard
async function dashboard(userId) {
  if (!USE_PG) {
    const stats = await one(`SELECT
      (SELECT COUNT(*) FROM meeting_history WHERE host_user_id=$1) AS hosted,
      (SELECT COUNT(DISTINCT meeting_history_id) FROM meeting_participants_log WHERE user_id=$1) AS attended,
      (SELECT COALESCE(SUM((julianday(COALESCE(left_at, strftime('%Y-%m-%dT%H:%M:%fZ','now'))) - julianday(joined_at))*86400),0) FROM meeting_participants_log WHERE user_id=$1 AND joined_at > datetime('now','-30 days')) AS seconds30,
      (SELECT COUNT(*) FROM follows WHERE followee_id=$1) AS followers,
      (SELECT COUNT(*) FROM follows WHERE follower_id=$1) AS following,
      ((SELECT COALESCE(SUM(total_joins),0) FROM events WHERE host_user_id=$1) + (SELECT COUNT(*) FROM meeting_participants_log l JOIN meeting_history h ON h.id=l.meeting_history_id WHERE h.host_user_id=$1)) AS audience,
      MAX((SELECT COALESCE(MAX(peak_viewers),0) FROM events WHERE host_user_id=$1),(SELECT COALESCE(MAX(max_participants),0) FROM meeting_history WHERE host_user_id=$1)) AS peak,
      (SELECT COUNT(*) FROM transcript_segments t JOIN meeting_history h ON h.id=t.meeting_history_id WHERE h.host_user_id=$1) AS transcript_lines`, [userId]);
    const activity = await many(`WITH RECURSIVE days(day,n) AS (SELECT date('now','-13 days'),0 UNION ALL SELECT date(day,'+1 day'),n+1 FROM days WHERE n<13)
      SELECT day,(SELECT COUNT(*) FROM meeting_participants_log l WHERE l.user_id=$1 AND date(l.joined_at)=day) AS n FROM days ORDER BY day`, [userId]);
    return { stats, activity };
  }
  // Audience/peak include venue + instant meetings (meeting_history), not only scheduled events.
  // Transcripts count segments from any meeting the user hosted.
  const stats = await one(`SELECT
      (SELECT COUNT(*) FROM meeting_history WHERE host_user_id=$1)::int AS hosted,
      (SELECT COUNT(DISTINCT meeting_history_id) FROM meeting_participants_log WHERE user_id=$1)::int AS attended,
      (SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(left_at, NOW()) - joined_at))),0) FROM meeting_participants_log WHERE user_id=$1 AND joined_at > NOW() - INTERVAL '30 days')::bigint AS seconds30,
      (SELECT COUNT(*) FROM follows WHERE followee_id=$1)::int AS followers,
      (SELECT COUNT(*) FROM follows WHERE follower_id=$1)::int AS following,
      (
        (SELECT COALESCE(SUM(total_joins),0) FROM events WHERE host_user_id=$1)
        + (SELECT COALESCE(SUM(
             (SELECT COUNT(*) FROM meeting_participants_log mpl WHERE mpl.meeting_history_id = mh.id)
           ), 0) FROM meeting_history mh WHERE mh.host_user_id=$1)
      )::int AS audience,
      GREATEST(
        (SELECT COALESCE(MAX(peak_viewers),0) FROM events WHERE host_user_id=$1),
        (SELECT COALESCE(MAX(max_participants),0) FROM meeting_history WHERE host_user_id=$1)
      )::int AS peak,
      (SELECT COUNT(*) FROM transcript_segments t
         JOIN meeting_history h ON h.id=t.meeting_history_id
        WHERE h.host_user_id=$1)::int AS transcript_lines`, [userId]);
  const activity = await many(`SELECT to_char(d, 'YYYY-MM-DD') AS day,
      (SELECT COUNT(*) FROM meeting_participants_log l WHERE l.user_id=$1 AND l.joined_at::date = d::date)::int AS n
    FROM generate_series(CURRENT_DATE - INTERVAL '13 days', CURRENT_DATE, INTERVAL '1 day') d ORDER BY d`, [userId]);
  return { stats, activity };
}

module.exports = { dashboard };
