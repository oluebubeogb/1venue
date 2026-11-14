/**
 * Venues: permanent rooms at /v/{slug}, admins and audit log.
 * JSON API routes (see src/core/router.js for the route() contract).
 */
module.exports = function routes(route, kit) {
  const { codes, normCode, getAuthUser, store, data, httpError, requireUser, int } = kit;

  // ------------------------------------------------------------ permanent venues (/v/{slug})
  const venueName = (v) => { const n = String(v || '').trim().slice(0, 60); if (n.length < 2) throw httpError(400, 'Venue name must be at least 2 characters'); return n; };
  // Live = meeting exists in this process OR DB says the venue was opened recently (other replica / poll race).
  function venueLive(v) {
    const m = store.getMeeting(v.code);
    if (m) {
      const hostIn = [...m.participants.values()].some((p) => p.status === 'ACTIVE' && (p.role === 'host' || p.role === 'cohost'));
      return { meetingName: m.name, hostIn, open: true };
    }
    const openedMs = v.openedAt ? new Date(v.openedAt).getTime() : 0;
    if (openedMs && Date.now() - openedMs < require('../../config').MEETING_INACTIVITY_MS) return { meetingName: v.name, hostIn: true, open: true, fromDb: true };
    return null;
  }
  route('GET', '/api/venues', async (ctx) => {
    const u = await requireUser(ctx.req, ctx.res);
    return { venues: (await data.myVenues(u.id)).map((v) => ({ ...v, live: venueLive(v) })) };
  });
  route('POST', '/api/venues', async (ctx) => {
    const u = await requireUser(ctx.req, ctx.res);
    const b = await ctx.body();
    const custom = b.customSlug || b.slug || b.custom || null;
    return data.createVenue(u.id, venueName(b.name), custom, { suffix: b.suffix === true });
  });
  route('GET', '/api/venues/by-code/([A-Za-z0-9-]{4,16})', async (ctx, [code]) => {
    const v = await data.getVenueByCode(normCode(code));
    if (!v) return { venue: null };
    const u = await getAuthUser(ctx.req, ctx.res);
    return { venue: { slug: v.slug, name: v.name, code: v.code, isOwner: !!(u && u.id === v.ownerUserId), live: venueLive(v) } };
  });
  const SLUG = '([A-Za-z0-9]{2,16}(?:-venue)?)';
  route('GET', '/api/venues/plan', async (ctx) => {
    const u = await requireUser(ctx.req, ctx.res);
    return { plan: await data.getUserPlan(u.id), plans: codes.PLANS };
  });

  // Admins & audit — registered before /api/venues/:slug so "admins"/"audit" are not treated as slugs
  async function requireVenueOwnerBySlug(ctx, slug) {
    const u = await requireUser(ctx.req, ctx.res);
    const v = await data.getVenueBySlug(String(slug || '').toLowerCase());
    if (!v || v.ownerUserId !== u.id) throw httpError(404, 'Venue not found');
    return { u, v };
  }
  route('GET', '/api/venues/admins', async (ctx) => {
    const slug = ctx.url.searchParams.get('slug') || '';
    const { v } = await requireVenueOwnerBySlug(ctx, slug);
    return { admins: await data.listVenueAdmins(v.id) };
  });
  route('POST', '/api/venues/admins', async (ctx) => {
    const b = await ctx.body();
    const { u, v } = await requireVenueOwnerBySlug(ctx, b.slug);
    return data.addVenueAdmins(v.id, u.id, b.usernames || b.names || '');
  });
  route('DELETE', '/api/venues/admins', async (ctx) => {
    const b = await ctx.body();
    const { u, v } = await requireVenueOwnerBySlug(ctx, b.slug);
    const ok = await data.removeVenueAdmin(v.id, u.id, int(b.userId));
    if (!ok) throw httpError(404, 'Admin not found');
    return { ok: true };
  });
  route('GET', '/api/venues/audit', async (ctx) => {
    const slug = ctx.url.searchParams.get('slug') || '';
    const { v } = await requireVenueOwnerBySlug(ctx, slug);
    return { audit: await data.getVenueAudit(v.id) };
  });

  route('GET', `/api/venues/${SLUG}`, async (ctx, [slug]) => {
    const v = await data.getVenueBySlug(slug.toLowerCase());
    if (!v) throw httpError(404, 'Venue not found');
    const u = await getAuthUser(ctx.req, ctx.res);
    const isOwner = !!(u && u.id === v.ownerUserId);
    return { slug: v.slug, name: v.name, code: v.code, isOwner, isCustom: v.isCustom, plan: isOwner ? await data.getUserPlan(u.id) : undefined, live: venueLive(v) };
  });
  route('PATCH', `/api/venues/${SLUG}`, async (ctx, [slug]) => {
    const u = await requireUser(ctx.req, ctx.res);
    const v = await data.getVenueBySlug(slug.toLowerCase());
    if (!v || v.ownerUserId !== u.id) throw httpError(404, 'Venue not found');
    const b = await ctx.body();
    let out = v;
    if (b.name != null) out = await data.renameVenue(v.id, u.id, venueName(b.name));
    const custom = b.customSlug || b.slug;
    if (custom) out = await data.setVenueSlug(v.id, u.id, custom, { suffix: b.suffix === true });
    return out;
  });
  route('GET', `/api/venues/${SLUG}/meetings`, async (ctx, [slug]) => {
    const u = await requireUser(ctx.req, ctx.res);
    const v = await data.getVenueBySlug(slug.toLowerCase());
    if (!v || v.ownerUserId !== u.id) throw httpError(404, 'Venue not found');
    return { meetings: await data.venueMeetings(v.code) };
  });
};
