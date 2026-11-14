/** Local SQLite backend. Kept behind DB_DRIVER=sqlite; production uses pg. */
const fs = require('fs');
const path = require('path');
const { AsyncLocalStorage } = require('node:async_hooks');
const transactionContext = new AsyncLocalStorage();

const JSON_COLUMNS = new Set(['attachments', 'data', 'ev_theme', 'extra', 'host_answers', 'media', 'moderation', 'options', 'payload', 'settings', 'tags', 'theme']);
const BOOL_COLUMNS = new Set(['anonymous', 'is_custom', 'is_following', 'is_live', 'is_public', 'multi', 'ok', 'peer_is_guest', 'reduce_motion', 'rsvped']);
const MIGRATIONS = path.join(__dirname, '..', '..', 'migrations', 'sqlite');
const DB_PATH = path.resolve(process.env.SQLITE_PATH || path.join(__dirname, '..', '..', 'data', 'venue.sqlite'));
let handle = null;
let ready = false;
let queue = Promise.resolve();

function open() {
  if (handle) return handle;
  let Database;
  try { Database = require('better-sqlite3'); }
  catch (e) { throw new Error('SQLite mode needs development dependencies: run npm install'); }
  try {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    handle = new Database(DB_PATH);
  } catch (e) { throw new Error(`SQLite database could not open ${DB_PATH}: ${e.message}`); }
  handle.pragma('foreign_keys = ON');
  handle.pragma('journal_mode = WAL');
  handle.pragma('busy_timeout = 5000');
  handle.function('GREATEST', { varargs: true }, (...v) => Math.max(...v.filter((x) => x != null)));
  handle.function('LEAST', { varargs: true }, (...v) => Math.min(...v.filter((x) => x != null)));
  handle.function('split_part', (value, delimiter, part) => String(value || '').split(String(delimiter))[Number(part) - 1] || '');
  handle.function('regexp', (pattern, value) => value != null && new RegExp(String(pattern), 'i').test(String(value)) ? 1 : 0);
  return handle;
}

function migrate({ log = console.log } = {}) {
  const d = open();
  d.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)');
  const done = new Set(d.prepare('SELECT version FROM schema_migrations').all().map((r) => r.version));
  const files = fs.readdirSync(MIGRATIONS).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
  const applied = [];
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS, f), 'utf8');
    try {
      d.transaction(() => {
        d.exec(sql);
        d.prepare('INSERT INTO schema_migrations(version) VALUES (?)').run(f);
      })();
    } catch (e) { throw new Error(`SQLite migration ${f} failed: ${e.message}`); }
    applied.push(f);
    log(`[db] sqlite migrated ${f}`);
  }
  return applied;
}

function ensureReady() {
  if (!ready) { migrate(); ready = true; }
  return Promise.resolve();
}

function sqlAndParams(sql, params) {
  const values = [];
  const converted = String(sql)
    .replace(/\$([1-9]\d*)/g, (_, n) => { values.push(params[Number(n) - 1]); return '?'; })
    .replace(/::(?:timestamptz|timestamp|bigint|smallint|integer|int|text|jsonb|json|date|numeric|boolean)\b/gi, '')
    .replace(/\bNOW\(\)/gi, "strftime('%Y-%m-%dT%H:%M:%fZ','now')")
    .replace(/\bILIKE\b/gi, 'LIKE');
  return [converted, values.map((v) => v == null ? null : v instanceof Date ? v.toISOString() : typeof v === 'boolean' ? Number(v) : typeof v === 'object' && !Buffer.isBuffer(v) ? JSON.stringify(v) : v)];
}

function shape(row) {
  for (const [key, value] of Object.entries(row)) {
    if (JSON_COLUMNS.has(key) && typeof value === 'string') {
      try { row[key] = JSON.parse(value); } catch (_) {}
    } else if (BOOL_COLUMNS.has(key) && value != null) row[key] = !!value;
  }
  return row;
}

function directQuery(sql, params = []) {
  const [text, args] = sqlAndParams(sql, params);
  try {
    const stmt = open().prepare(text);
    if (stmt.reader) {
      const rows = stmt.all(...args).map(shape);
      return { rows, rowCount: rows.length };
    }
    const result = stmt.run(...args);
    return { rows: [], rowCount: result.changes };
  } catch (e) {
    if (e.code === 'SQLITE_CONSTRAINT_UNIQUE' || e.code === 'SQLITE_CONSTRAINT_PRIMARYKEY') e.code = '23505';
    else if (e.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') e.code = '23503';
    else if (e.code === 'SQLITE_CONSTRAINT_CHECK' || e.code === 'SQLITE_CONSTRAINT_TRIGGER') e.code = '23514';
    else if (e.code === 'SQLITE_CONSTRAINT_NOTNULL') e.code = '23502';
    throw e;
  }
}

function enqueue(fn) {
  const pending = queue.then(fn);
  queue = pending.catch(() => {});
  return pending;
}

async function q(sql, params = []) {
  const context = transactionContext.getStore();
  if (context) {
    if (!context.active) throw new Error('SQLite transaction has finished');
    return directQuery(sql, params);
  }
  await ensureReady();
  return enqueue(() => directQuery(sql, params));
}

async function tx(fn) {
  if (transactionContext.getStore()) throw new Error('Nested SQLite transactions are not supported');
  await ensureReady();
  return enqueue(async () => {
    const d = open();
    const context = { active: true };
    d.exec('BEGIN IMMEDIATE');
    try {
      const value = await transactionContext.run(context, () => fn({ query: async (sql, params = []) => {
        if (!context.active) throw new Error('SQLite transaction has finished');
        return directQuery(sql, params);
      } }));
      d.exec('COMMIT');
      return value;
    } catch (e) { d.exec('ROLLBACK'); throw e; }
    finally { context.active = false; }
  });
}

async function close() {
  await queue;
  if (handle) handle.close();
  handle = null; ready = false; queue = Promise.resolve();
}

module.exports = { DB_PATH, ensureReady, migrate, q, tx, close };
