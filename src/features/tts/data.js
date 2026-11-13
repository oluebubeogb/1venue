/** tts queries: the generated-audio cache. */
const { q, one } = require('../../core/db');

async function getCached(hash) {
  const r = await one(`SELECT c.hash, c.chars, f.* FROM tts_cache c JOIN files f ON f.id = c.file_id WHERE c.hash = $1`, [hash]);
  if (r) q('UPDATE tts_cache SET hits = hits + 1, last_used_at = NOW() WHERE hash = $1', [hash]).catch(() => {});
  return r;
}

async function putCached({ hash, fileId, lang, voice, model, chars }) {
  await q(`INSERT INTO tts_cache (hash, file_id, lang, voice, model, chars) VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (hash) DO NOTHING`, [hash, fileId, lang, voice, model, chars]);
}

module.exports = { getCached, putCached };
