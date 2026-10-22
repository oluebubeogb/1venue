/** Run database migrations and exit (npm run migrate). */
const db = require('../db');
db.migrate()
  .then(() => db.close())
  .then(() => { console.log('[migrate] done'); process.exit(0); })
  .catch((e) => { console.error('[migrate] failed', e); process.exit(1); });
