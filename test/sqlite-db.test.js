'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'venue-sqlite-db-'));
process.env.DB_DRIVER = 'sqlite';
process.env.SQLITE_PATH = path.join(dir, 'venue.sqlite');
const db = require('../db');

test.after(async () => { await db.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('sqlite starts from an empty file with the current feature tables', async () => {
  await db.ensureReady();
  assert.equal(fs.existsSync(process.env.SQLITE_PATH), true);
  const r = await db.q("SELECT name FROM sqlite_master WHERE type='table'");
  const names = new Set(r.rows.map((x) => x.name));
  for (const name of ['users', 'meeting_history', 'events', 'venues', 'transcript_segments', 'whiteboards', 'materials', 'attendance_shares', 'venue_admins']) assert.ok(names.has(name), name);
});

test('sqlite query binds repeated numbered placeholders and reports row counts', async () => {
  const r = await db.q('SELECT $1 AS first, $2 AS second, $1 AS repeated', ['Ada', 'Bea']);
  assert.deepEqual(r.rows[0], { first: 'Ada', second: 'Bea', repeated: 'Ada' });
  const inserted = await db.q('INSERT INTO users (username, email, password_hash) VALUES ($1,$2,$3) RETURNING id', ['ada', 'ada@example.test', 'hash']);
  assert.equal(inserted.rowCount, 1);
  assert.ok(inserted.rows[0].id > 0);
  assert.equal((await db.q('UPDATE users SET display_name=$2 WHERE id=$1', [inserted.rows[0].id, 'Ada'])).rowCount, 1);
});

test('sqlite transactions roll back failed writes', async () => {
  await assert.rejects(db.tx(async (client) => {
    await client.query('INSERT INTO users (username,email,password_hash) VALUES ($1,$2,$3)', ['rollback', 'rollback@example.test', 'hash']);
    throw new Error('abort');
  }), /abort/);
  assert.equal((await db.q('SELECT id FROM users WHERE username=$1', ['rollback'])).rows.length, 0);
});

test('sqlite enforces case-insensitive account uniqueness like deployment', async () => {
  await assert.rejects(
    db.createUser({ username: 'ADA', email: 'another@example.test', passwordHash: 'hash' }),
    (e) => e.code === '23505'
  );
  await assert.rejects(
    db.createUser({ username: 'other', email: 'ADA@example.test', passwordHash: 'hash' }),
    (e) => e.code === '23505'
  );
});

test('sqlite reports an invalid local file path without falling back to PostgreSQL', () => {
  const blocker = path.join(dir, 'blocker');
  fs.writeFileSync(blocker, 'file');
  const run = spawnSync(process.execPath, ['-e', "try { Promise.resolve(require('./db').ensureReady()).catch(e => { console.error(e.message); process.exitCode = 1; }); } catch (e) { console.error(e.message); process.exitCode = 1; }"], {
    cwd: path.join(__dirname, '..'), encoding: 'utf8',
    env: { ...process.env, SQLITE_PATH: path.join(blocker, 'venue.sqlite'), DATABASE_URL: '' },
  });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /SQLite database.*venue\.sqlite/);
  assert.doesNotMatch(run.stderr, /DATABASE_URL is required/);
});

test('sqlite foreign-key errors use the database error code expected by API handlers', async () => {
  await assert.rejects(
    db.q('INSERT INTO event_rsvps (event_id,user_id) VALUES ($1,$2)', [999999, 999999]),
    (e) => e.code === '23503'
  );
});

test('sqlite keeps data across a close and migration restart', async () => {
  await db.close();
  await db.ensureReady();
  assert.equal((await db.q('SELECT username FROM users WHERE username=$1', ['ada'])).rows[0].username, 'ada');
  assert.deepEqual(await db.migrate({ log: () => {} }), []);
});
