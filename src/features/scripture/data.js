/**
 * scripture queries (PostgreSQL, parameterised). Split out of src/venue/data.js;
 * src/venue/data.js still re-exports everything for older call sites.
 */
const { q, one } = require('../../core/db');

async function bibleCacheGet(t, b, c, maxAgeDays) {
  const r = await one(`SELECT payload FROM bible_cache WHERE translation=$1 AND book=$2 AND chapter=$3 AND fetched_at > NOW() - ($4 || ' days')::interval`, [t, b, c, String(maxAgeDays)]);
  return r ? r.payload : null;
}
async function bibleCachePut(t, b, c, payload) {
  await q(`INSERT INTO bible_cache (translation, book, chapter, payload) VALUES ($1,$2,$3,$4)
    ON CONFLICT (translation, book, chapter) DO UPDATE SET payload=EXCLUDED.payload, fetched_at=NOW()`, [t, b, c, JSON.stringify(payload)]);
}

module.exports = { bibleCacheGet, bibleCachePut };
