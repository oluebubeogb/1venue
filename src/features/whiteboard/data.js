const { USE_PG } = require('../../../db');
/**
 * whiteboard queries (PostgreSQL, parameterised). Split out of src/venue/data.js;
 * src/venue/data.js still re-exports everything for older call sites.
 */
const { one, many } = require('../../core/db');

async function getWhiteboard(userId, title = 'My board') {
  const r = await one('SELECT * FROM whiteboards WHERE user_id=$1 AND title=$2 ORDER BY updated_at DESC LIMIT 1', [userId, title]);
  return r ? { id: Number(r.id), title: r.title, data: r.data, updatedAt: r.updated_at } : { id: null, title, data: {}, updatedAt: null };
}
async function saveWhiteboard(userId, title = 'My board', data = {}) {
  // Legacy title-addressed save (the old single "Personal" board). Updates the newest board with that title.
  const t = String(title).slice(0, 80);
  const ex = await one('SELECT id FROM whiteboards WHERE user_id=$1 AND title=$2 ORDER BY updated_at DESC LIMIT 1', [userId, t]);
  const r = ex ? await one('UPDATE whiteboards SET data=$2, updated_at=NOW() WHERE id=$1 RETURNING *', [ex.id, JSON.stringify(data)])
    : await one('INSERT INTO whiteboards (user_id, title, data, updated_at) VALUES ($1,$2,$3,NOW()) RETURNING *', [userId, t, JSON.stringify(data)]);
  return { id: Number(r.id), title: r.title, updatedAt: r.updated_at };
}
async function listWhiteboards(userId) {
  const pageCount = USE_PG
    ? "COALESCE(jsonb_array_length(CASE WHEN jsonb_typeof(data->'pages')='array' THEN data->'pages' END),1)"
    : "COALESCE(json_array_length(data, '$.pages'),1)";
  return (await many(`SELECT id, title, updated_at, ${pageCount} AS pages
    FROM whiteboards WHERE user_id=$1 ORDER BY updated_at DESC LIMIT 200`, [userId]))
    .map((r) => ({ id: Number(r.id), title: r.title, updatedAt: r.updated_at, pages: Number(r.pages) || 1 }));
}
const boardOut = (r) => r && { id: Number(r.id), title: r.title, data: r.data || {}, updatedAt: r.updated_at };
async function createWhiteboard(userId, title, data = {}) {
  return boardOut(await one('INSERT INTO whiteboards (user_id, title, data) VALUES ($1,$2,$3) RETURNING *', [userId, String(title || 'Untitled board').slice(0, 80), JSON.stringify(data)]));
}
async function getWhiteboardById(userId, id) { return boardOut(await one('SELECT * FROM whiteboards WHERE id=$1 AND user_id=$2', [id, userId])); }
async function updateWhiteboard(userId, id, { title, data }) {
  return boardOut(await one(`UPDATE whiteboards SET title=COALESCE($3,title), data=COALESCE($4::jsonb,data), updated_at=NOW() WHERE id=$1 AND user_id=$2 RETURNING *`,
    [id, userId, title == null ? null : String(title).slice(0, 80), data == null ? null : JSON.stringify(data)]));
}
async function deleteWhiteboard(userId, id) { return !!(await one('DELETE FROM whiteboards WHERE id=$1 AND user_id=$2 RETURNING id', [id, userId])); }

module.exports = { getWhiteboard, saveWhiteboard, listWhiteboards, boardOut, createWhiteboard, getWhiteboardById, updateWhiteboard, deleteWhiteboard };
