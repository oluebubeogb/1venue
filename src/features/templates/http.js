/**
 * Templates: list meeting templates.
 * Raw HTTP handler.
 * Each block answers its path and returns; unmatched requests fall through (return false).
 */
const {
  db, sendJSON, publicErr,
} = require('../../core/http-kit');

module.exports = async function handle(req, res, parsed) {
  const urlPath = parsed.pathname;

  // ----- Phase 2: templates -----
  if (urlPath === '/api/templates' && req.method === 'GET') {
    try {
      const rows = await db.listTemplates();
      return sendJSON(res, 200, {
        templates: rows.map((r) => ({
          id: r.id,
          slug: r.slug,
          name: r.name,
          description: r.description,
          settings: (() => { try { return JSON.parse(r.settings_json || '{}'); } catch { return {}; } })(),
        })),
      });
    } catch (e) {
      return sendJSON(res, 500, { error: publicErr(e, 'Failed') });
    }
  }

  return false;
};
