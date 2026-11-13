#!/usr/bin/env node
/**
 * Create a timestamped migration file.
 *
 *   npm run migration:new -- add_poll_colors                 -> migrations/20261113153000_add_poll_colors.sql
 *   npm run migration:new -- add_poll_colors --feature polls -> src/features/polls/migrations/…
 *
 * Timestamps are UTC (YYYYMMDDHHMMSS), so two people on two branches never collide.
 */
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const fi = args.indexOf('--feature');
const feature = fi >= 0 ? args.splice(fi, 2)[1] : null;
const name = String(args[0] || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
if (!name) {
  console.error('Usage: npm run migration:new -- <name> [--feature <id>]');
  process.exit(1);
}
const root = path.join(__dirname, '..');
let dir = path.join(root, 'migrations');
if (feature) {
  const fdir = path.join(root, 'src', 'features', feature);
  if (!fs.existsSync(fdir)) { console.error(`No feature folder src/features/${feature}`); process.exit(1); }
  dir = path.join(fdir, 'migrations');
}
fs.mkdirSync(dir, { recursive: true });
const ts = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
const file = path.join(dir, `${ts}_${name}.sql`);
fs.writeFileSync(file, `-- ${name}${feature ? ` (feature: ${feature})` : ''}\n-- Runs once, inside a transaction. Make it safe to run on a database that already has data.\n\n`);
console.log(path.relative(root, file));
