/**
 * files queries (PostgreSQL, parameterised). Split out of src/venue/data.js;
 * src/venue/data.js still re-exports everything for older call sites.
 */
const { q, one } = require('../../core/db');

// ---------------------------------------------------------------- files / whiteboards / bible cache
async function insertFile(f) {
  await q(`INSERT INTO files (id, owner_user_id, owner_key, driver, object_key, filename, mime, size_bytes, purpose, room_code) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [f.id, f.ownerUserId || null, f.ownerKey || null, f.driver, f.objectKey, f.filename, f.mime, f.size, f.purpose || 'attachment', f.roomCode || null]);
}
/** Bytes stored by a user, a guest key or a meeting (for quotas). */
async function fileUsage({ userId, ownerKey, roomCode } = {}) {
  const [col, val] = userId ? ['owner_user_id', userId] : ownerKey ? ['owner_key', ownerKey] : roomCode ? ['room_code', roomCode] : [];
  if (!col) return 0;
  const r = await one(`SELECT COALESCE(SUM(size_bytes),0)::bigint AS n FROM files WHERE ${col}=$1`, [val]);
  return Number(r && r.n) || 0;
}
async function getFile(id) { return one('SELECT * FROM files WHERE id=$1', [id]); }

module.exports = { insertFile, fileUsage, getFile };
