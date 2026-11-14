/**
 * Demo data from the command line (same code as the /admin page).
 *   npm run seed            load (replaces any previous seed)
 *   npm run seed:remove     remove every seed row
 *   node scripts/seed.js status
 */
const db = require('../db');
const seed = require('../src/features/seed/seed');

const cmd = (process.argv[2] || 'load').toLowerCase();
const run = { load: seed.load, remove: seed.remove, status: seed.status }[cmd];
if (!run) { console.error('Usage: node scripts/seed.js [load|remove|status]'); process.exit(2); }
run()
  .then((r) => { console.log(`[seed] ${cmd}`, JSON.stringify(r, null, 2)); return db.close(); })
  .then(() => process.exit(0))
  .catch((e) => { console.error('[seed] failed:', e.message); process.exit(1); });
