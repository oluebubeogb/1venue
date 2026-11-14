'use strict';
require('./helpers/server');
// Polls: listPolls/pollResults now batch their queries (2 instead of 1 + 4 per poll).
// This compares the new output with the old one-poll-at-a-time implementation on real data.
const test = require('node:test');
const assert = require('node:assert/strict');

const skip = !process.env.DATABASE_URL && process.env.DB_DRIVER !== 'sqlite' ? 'set DATABASE_URL' : false;

// The previous implementation, verbatim, as the reference.
function oldImpl({ one, many }) {
  async function pollResults(pollId, voterKey) {
    const p = await one('SELECT * FROM polls WHERE id=$1', [pollId]);
    if (!p) return null;
    const counts = await many('SELECT option_idx, COUNT(*)::int AS n FROM poll_votes WHERE poll_id=$1 GROUP BY option_idx', [pollId]);
    const voters = await one('SELECT COUNT(DISTINCT voter_key)::int AS n FROM poll_votes WHERE poll_id=$1', [pollId]);
    const mine = voterKey ? (await many('SELECT option_idx FROM poll_votes WHERE poll_id=$1 AND voter_key=$2', [pollId, voterKey])).map((r) => r.option_idx) : [];
    const tally = p.options.map((_, i) => (counts.find((c) => c.option_idx === i) || { n: 0 }).n);
    return { id: Number(p.id), question: p.question, options: p.options, multi: p.multi, anonymous: p.anonymous, status: p.status, tally, voters: voters.n, mine, createdAt: p.created_at };
  }
  async function listPolls(code, historyId, voterKey) {
    const rows = await many('SELECT id FROM polls WHERE code=$1 AND ($2::int IS NULL OR meeting_history_id=$2) ORDER BY created_at DESC LIMIT 30', [code, historyId || null]);
    return Promise.all(rows.map((r) => pollResults(r.id, voterKey)));
  }
  return { pollResults, listPolls };
}
// `mine` had no ORDER BY before (row order); compare it as a set.
const norm = (list) => JSON.parse(JSON.stringify(list, (k, v) => (k === 'mine' && Array.isArray(v) ? [...v].sort((a, b) => a - b) : v)));

test('listPolls / pollResults: batched output equals the old per-poll output', { skip }, async () => {
  const dbh = require('../src/core/db');
  const polls = require('../src/features/polls/data');
  const old = oldImpl(dbh);
  const code = 'pt' + Date.now().toString(36);
  const made = [];
  made.push(await polls.createPoll({ code, question: 'Single choice?', options: ['a', 'b', 'c'] }));
  made.push(await polls.createPoll({ code, question: 'Multi?', options: ['x', 'y', 'z', 'w'], multi: true, anonymous: false }));
  made.push(await polls.createPoll({ code, question: 'No votes yet', options: ['1', '2'] }));
  made.push(await polls.createPoll({ code, question: 'Closed one', options: ['yes', 'no'] }));
  await polls.votePoll(made[0].id, 'u:1', 1);
  await polls.votePoll(made[0].id, 'u:2', 1);
  await polls.votePoll(made[0].id, 'p:3', 2);
  await polls.votePoll(made[1].id, 'u:1', [3, 0, 2]);
  await polls.votePoll(made[1].id, 'u:2', [0]);
  await polls.votePoll(made[3].id, 'u:1', 0);
  await polls.closePoll(made[3].id);

  for (const voter of ['u:1', 'u:2', 'p:3', 'nobody', '', undefined]) {
    assert.deepEqual(norm(await polls.listPolls(code, null, voter)), norm(await old.listPolls(code, null, voter)), `listPolls voter=${voter}`);
    for (const p of made) assert.deepEqual(norm(await polls.pollResults(p.id, voter)), norm(await old.pollResults(p.id, voter)), `pollResults ${p.id} voter=${voter}`);
  }
  assert.equal(await polls.pollResults(987654321), null);
  assert.deepEqual(await polls.listPolls('no-such-code-' + code, null, 'u:1'), []);

  const list = await polls.listPolls(code, null, 'u:1');
  assert.equal(list.length, 4);
  const multi = list.find((p) => p.question === 'Multi?');
  assert.deepEqual(multi.tally, [2, 0, 1, 1]);
  assert.equal(multi.voters, 2);
  assert.deepEqual(multi.mine, [0, 2, 3]);
});

test('listPolls issues 2 queries however many polls there are', { skip: skip || (process.env.DB_DRIVER === 'sqlite' ? 'PostgreSQL pool instrumentation' : false) }, async () => {
  const db = require('../db');
  const polls = require('../src/features/polls/data');
  const code = 'pq' + Date.now().toString(36);
  for (let i = 0; i < 6; i++) await polls.createPoll({ code, question: 'Q' + i, options: ['a', 'b'] });
  const pool = db.getPool ? db.getPool() : null;
  const realQuery = pool.query.bind(pool);
  let n = 0;
  pool.query = (...a) => { n++; return realQuery(...a); };
  try { await polls.listPolls(code, null, 'u:9'); } finally { pool.query = realQuery; }
  assert.equal(n, 2);
});

test.after(async () => { if (!skip) await require('../db').close(); });
