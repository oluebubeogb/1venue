const { USE_PG } = require('../../../db');
/**
 * qa queries (PostgreSQL, parameterised). Split out of src/venue/data.js;
 * src/venue/data.js still re-exports everything for older call sites.
 */
const { tx, one, many } = require('../../core/db');

// ---------------------------------------------------------------- Q&A
function questionOut(r, voted) {
  let hostAnswers = [];
  try { hostAnswers = Array.isArray(r.host_answers) ? r.host_answers : (typeof r.host_answers === 'string' ? JSON.parse(r.host_answers) : []); } catch { hostAnswers = []; }
  return { id: Number(r.id), authorKey: r.author_key, authorName: r.author_name, body: r.body, upvotes: r.upvotes, status: r.status, aiAnswer: r.ai_answer, hostAnswers, createdAt: r.created_at, voted: !!voted };
}
async function addQuestion({ code, historyId, authorKey, authorName, body }) {
  const t = String(body || '').trim().slice(0, 1000);
  if (!t) { const e = new Error('Question is empty'); e.status = 400; throw e; }
  return questionOut(await one('INSERT INTO questions (code, meeting_history_id, author_key, author_name, body) VALUES ($1,$2,$3,$4,$5) RETURNING *',
    [code, historyId || null, authorKey, String(authorName).slice(0, 80), t]));
}
async function upvoteQuestion(id, voterKey) {
  return tx(async (c) => {
    const d = await c.query('DELETE FROM question_votes WHERE question_id=$1 AND voter_key=$2', [id, voterKey]);
    if (d.rowCount) return questionOut((await c.query('UPDATE questions SET upvotes=GREATEST(0,upvotes-1) WHERE id=$1 RETURNING *', [id])).rows[0], false);
    await c.query('INSERT INTO question_votes (question_id, voter_key) VALUES ($1,$2)', [id, voterKey]);
    return questionOut((await c.query('UPDATE questions SET upvotes=upvotes+1 WHERE id=$1 RETURNING *', [id])).rows[0], true);
  });
}
async function setQuestionStatus(id, status, aiAnswer) {
  const r = await one('UPDATE questions SET status=COALESCE($2,status), ai_answer=COALESCE($3, ai_answer) WHERE id=$1 RETURNING *', [id, status || null, aiAnswer || null]);
  return r ? questionOut(r) : null;
}
async function addHostAnswer(id, text, byName) {
  const t = String(text || '').trim().slice(0, 2000);
  if (!t) return null;
  const ans = { id: 'ha-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6), text: t, by: String(byName || 'Host').slice(0, 80), at: new Date().toISOString() };
  const r = USE_PG
    ? await one(`UPDATE questions SET host_answers = host_answers || $2::jsonb WHERE id=$1 RETURNING *`, [id, JSON.stringify([ans])])
    : await one(`UPDATE questions SET host_answers=json_insert(host_answers,'$[#]',json($2)) WHERE id=$1 RETURNING *`, [id, JSON.stringify(ans)]);
  return r ? questionOut(r) : null;
}
async function editHostAnswer(id, answerId, text) {
  const t = String(text || '').trim().slice(0, 2000);
  if (!t) return null;
  if (!USE_PG) {
    return tx(async (c) => {
      const row = (await c.query('SELECT * FROM questions WHERE id=$1', [id])).rows[0];
      if (!row) return null;
      const answers = (row.host_answers || []).map((a) => a.id === answerId ? { ...a, text: t } : a);
      const updated = (await c.query('UPDATE questions SET host_answers=$2 WHERE id=$1 RETURNING *', [id, JSON.stringify(answers)])).rows[0];
      return questionOut(updated);
    });
  }
  const r = await one(`UPDATE questions SET host_answers = (
    SELECT COALESCE(jsonb_agg(CASE WHEN (elem->>'id') = $3 THEN jsonb_set(elem, '{text}', to_jsonb($4::text)) ELSE elem END), '[]'::jsonb)
    FROM jsonb_array_elements(host_answers) elem
  ) WHERE id=$1 RETURNING *`, [id, null, answerId, t]);
  return r ? questionOut(r) : null;
}
async function deleteHostAnswer(id, answerId) {
  if (!USE_PG) {
    return tx(async (c) => {
      const row = (await c.query('SELECT * FROM questions WHERE id=$1', [id])).rows[0];
      if (!row) return null;
      const answers = (row.host_answers || []).filter((a) => a.id !== answerId);
      const updated = (await c.query('UPDATE questions SET host_answers=$2 WHERE id=$1 RETURNING *', [id, JSON.stringify(answers)])).rows[0];
      return questionOut(updated);
    });
  }
  const r = await one(`UPDATE questions SET host_answers = (
    SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb)
    FROM jsonb_array_elements(host_answers) elem
    WHERE (elem->>'id') <> $2
  ) WHERE id=$1 RETURNING *`, [id, answerId]);
  return r ? questionOut(r) : null;
}
async function listQuestions(code, historyId, voterKey) {
  const rows = await many(`SELECT qq.*, EXISTS(SELECT 1 FROM question_votes v WHERE v.question_id=qq.id AND v.voter_key=$3) AS voted
    FROM questions qq WHERE code=$1 AND ($2::int IS NULL OR meeting_history_id=$2) AND status <> 'dismissed'
    ORDER BY (status='live') DESC, (status='answered') ASC, upvotes DESC, created_at ASC LIMIT 200`, [code, historyId || null, voterKey || '']);
  return rows.map((r) => questionOut(r, r.voted));
}

module.exports = { questionOut, addQuestion, upvoteQuestion, setQuestionStatus, addHostAnswer, editHostAnswer, deleteHostAnswer, listQuestions };
