/**
 * ai queries (PostgreSQL, parameterised). Split out of src/venue/data.js;
 * src/venue/data.js still re-exports everything for older call sites.
 */
const { q } = require('../../core/db');

async function logAiUsage({ useCase, provider, model, ok, latencyMs, error }) {
  await q('INSERT INTO ai_usage (use_case, provider, model, ok, latency_ms, error) VALUES ($1,$2,$3,$4,$5,$6)',
    [useCase, provider, model || null, !!ok, latencyMs || null, error ? String(error).slice(0, 500) : null]).catch(() => {});
}

module.exports = { logAiUsage };
