// Database queries for this feature. Tables come from ./migrations.
const { one } = require('../../core/db');

async function countThings(userId) {
  const r = await one('SELECT COUNT(*)::int AS n FROM users WHERE id = $1', [userId]);
  return r ? r.n : 0;
}

module.exports = { countThings };
