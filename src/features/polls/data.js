const { USE_PG } = require('../../../db');
/**
 * polls queries (PostgreSQL, parameterised). Split out of src/venue/data.js;
 * src/venue/data.js still re-exports everything for older call sites.
 */
const { q, tx, one, many } = require('../../core/db');

// ---------------------------------------------------------------- polls
/**
 * Results for many polls in two queries (poll rows are passed in, or fetched by id):
 * one aggregate over poll_votes gives per-option counts, distinct voters and "my" choices.
 * Output per poll is identical to the old one-poll-at-a-time version (`mine` is sorted).
 */
async function resultsFor(polls, voterKey) {
  if (!polls.length) return [];
  const ids = polls.map((p) => p.id);
  const rows = await many(
    `SELECT v.poll_id, v.option_idx, COUNT(*)::int AS n, ${USE_PG ? 'BOOL_OR(v.voter_key = $2)' : 'MAX(v.voter_key = $2)'} AS mine, d.voters
       FROM poll_votes v
       JOIN (SELECT poll_id, COUNT(DISTINCT voter_key)::int AS voters FROM poll_votes WHERE ${USE_PG ? 'poll_id = ANY($1::bigint[])' : 'poll_id IN (SELECT value FROM json_each($1))'} GROUP BY poll_id) d
         ON d.poll_id = v.poll_id
      WHERE ${USE_PG ? 'v.poll_id = ANY($1::bigint[])' : 'v.poll_id IN (SELECT value FROM json_each($1))'}
      GROUP BY v.poll_id, v.option_idx, d.voters
      ORDER BY v.poll_id, v.option_idx`,
    [ids, voterKey || null]);
  const byPoll = new Map();
  for (const r of rows) {
    const k = String(r.poll_id);
    if (!byPoll.has(k)) byPoll.set(k, { counts: new Map(), voters: r.voters, mine: [] });
    const e = byPoll.get(k);
    e.counts.set(r.option_idx, r.n);
    if (voterKey && r.mine) e.mine.push(r.option_idx);
  }
  return polls.map((p) => {
    const e = byPoll.get(String(p.id)) || { counts: new Map(), voters: 0, mine: [] };
    const tally = p.options.map((_, i) => e.counts.get(i) || 0);
    return { id: Number(p.id), question: p.question, options: p.options, multi: p.multi, anonymous: p.anonymous, status: p.status, tally, voters: e.voters, mine: e.mine, createdAt: p.created_at };
  });
}
async function pollResults(pollId, voterKey) {
  const p = await one('SELECT * FROM polls WHERE id=$1', [pollId]);
  if (!p) return null;
  return (await resultsFor([p], voterKey))[0];
}
async function createPoll({ code, historyId, question, options, multi, anonymous, createdBy }) {
  const opts = (options || []).map((o) => String(o).trim().slice(0, 120)).filter(Boolean);
  if (!question || opts.length < 2) { const e = new Error('A poll needs a question and at least 2 options'); e.status = 400; throw e; }
  const r = await one(`INSERT INTO polls (code, meeting_history_id, question, options, multi, anonymous, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [code, historyId || null, String(question).slice(0, 300), JSON.stringify(opts.slice(0, 10)), !!multi, anonymous !== false, createdBy || null]);
  return pollResults(r.id);
}
async function votePoll(pollId, voterKey, choices) {
  const p = await one('SELECT * FROM polls WHERE id=$1', [pollId]);
  if (!p || p.status !== 'open') { const e = new Error('Poll is closed'); e.status = 400; throw e; }
  const idx = [...new Set((Array.isArray(choices) ? choices : [choices]).map(Number))].filter((i) => i >= 0 && i < p.options.length);
  if (!idx.length) { const e = new Error('Choose an option'); e.status = 400; throw e; }
  await tx(async (c) => {
    await c.query('DELETE FROM poll_votes WHERE poll_id=$1 AND voter_key=$2', [pollId, voterKey]);
    for (const i of p.multi ? idx : idx.slice(0, 1)) await c.query('INSERT INTO poll_votes (poll_id, voter_key, option_idx) VALUES ($1,$2,$3)', [pollId, voterKey, i]);
  });
  return pollResults(pollId, voterKey);
}
async function closePoll(pollId) {
  await q("UPDATE polls SET status='closed', closed_at=NOW() WHERE id=$1", [pollId]);
  return pollResults(pollId);
}
async function listPolls(code, historyId, voterKey) {
  const polls = await many('SELECT * FROM polls WHERE code=$1 AND ($2::int IS NULL OR meeting_history_id=$2) ORDER BY created_at DESC LIMIT 30', [code, historyId || null]);
  return resultsFor(polls, voterKey);
}

module.exports = { pollResults, createPoll, votePoll, closePoll, listPolls };
