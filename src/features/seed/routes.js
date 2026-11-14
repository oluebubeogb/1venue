/**
 * Admin-only demo data controls (the /admin page).
 *   GET    /api/admin/seed   status + seed accounts
 *   POST   /api/admin/seed   load (replaces any previous seed)
 *   DELETE /api/admin/seed   remove every seed row
 * Admins are the confirmed emails in ADMIN_EMAILS.
 */
const seed = require('./seed');

module.exports = function routes(route, kit) {
  const { requireUser, httpError } = kit;
  const admin = async (ctx) => {
    const u = await requireUser(ctx.req, ctx.res);
    if (!u.isAdmin) throw httpError(403, 'Admins only. Add your email to ADMIN_EMAILS and confirm it.');
    return u;
  };
  route('GET', '/api/admin/seed', async (ctx) => { await admin(ctx); return seed.status(); });
  route('POST', '/api/admin/seed', async (ctx) => { const u = await admin(ctx); const r = await seed.load(); console.log(`[seed] loaded by user ${u.id}`, JSON.stringify(r)); return { ok: true, loaded: r, ...(await seed.status()) }; });
  route('DELETE', '/api/admin/seed', async (ctx) => { const u = await admin(ctx); const r = await seed.remove(); console.log(`[seed] removed by user ${u.id}`, JSON.stringify(r)); return { ok: true, removed: r, ...(await seed.status()) }; });
};
