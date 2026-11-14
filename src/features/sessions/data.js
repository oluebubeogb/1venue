/**
 * sessions queries (PostgreSQL, parameterised). Split out of src/venue/data.js;
 * src/venue/data.js still re-exports everything for older call sites.
 */
const { one, many } = require('../../core/db');

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

module.exports = { addTranscriptSegment, getTranscript, transcriptToText, saveSummary, latestSummaries, getHistory, canAccessHistory };
