/**
 * Events & discovery: categories, discover, CRUD, RSVP, speakers, QR codes.
 * JSON API routes (see src/core/router.js for the route() contract).
 */
module.exports = function routes(route, kit) {
  const { URL, getAuthUser, data, qr, httpError, requireUser, int, attach, liveInfo } = kit;

  // ------------------------------------------------------------ events & discovery
  route('GET', '/api/categories', async () => ({ categories: data.CATEGORIES, counts: await data.categoryCounts() }));
  route('GET', '/api/discover', async (ctx) => {
    const u = await getAuthUser(ctx.req, ctx.res);
    const s = ctx.url.searchParams;
    const events = await data.discover({ q: s.get('q'), category: s.get('category'), status: s.get('status'), tag: s.get('tag'), limit: int(s.get('limit'), 24), offset: int(s.get('offset'), 0), viewerId: u && u.id });
    return { events: events.map((e) => ({ ...e, live: liveInfo(e) })) };
  });
  route('GET', '/api/events/mine', async (ctx) => {
    const u = await requireUser(ctx.req, ctx.res);
    const [hosting, going] = await Promise.all([data.myEvents(u.id), data.rsvpedEvents(u.id)]);
    return { hosting: hosting.map((e) => ({ ...e, live: liveInfo(e) })), going };
  });
  route('POST', '/api/events', async (ctx) => {
    const u = await requireUser(ctx.req, ctx.res);
    const b = await ctx.body();
    const ev = await data.createEvent(u, b);
    if (Array.isArray(b.speakers)) ev.speakers = await data.setSpeakers(ev.id, b.speakers);
    return ev;
  });
  route('GET', '/api/events/([\\w-]+)', async (ctx, [slug]) => {
    const u = await getAuthUser(ctx.req, ctx.res);
    const ev = await data.getEventBySlug(slug, u && u.id);
    if (!ev || (ev.visibility === 'private' && (!u || u.id !== ev.host.id))) {
      // rooms look up their (optional) event by code: answer quietly instead of 404
      if (new URL(ctx.req.url, 'http://x').searchParams.get('optional') === '1') return null;
      throw httpError(404, 'Event not found');
    }
    return { ...ev, speakers: await data.listSpeakers(ev.id), live: liveInfo(ev), isHost: !!(u && u.id === ev.host.id) };
  });
  route('PATCH', '/api/events/(\\d+)', async (ctx, [id]) => {
    const u = await requireUser(ctx.req, ctx.res);
    const b = await ctx.body();
    const ev = await data.updateEvent(int(id), u.id, b);
    if (!ev) throw httpError(404, 'Event not found or not yours');
    if (Array.isArray(b.speakers)) ev.speakers = await data.setSpeakers(ev.id, b.speakers);
    return ev;
  });
  route('DELETE', '/api/events/(\\d+)', async (ctx, [id]) => {
    const u = await requireUser(ctx.req, ctx.res);
    if (!(await data.deleteEvent(int(id), u.id))) throw httpError(404, 'Event not found or not yours');
    return { ok: true };
  });
  route('POST', '/api/events/(\\d+)/rsvp', async (ctx, [id]) => ({ going: await data.toggleRsvp(int(id), (await requireUser(ctx.req, ctx.res)).id) }));
  route('PUT', '/api/events/(\\d+)/speakers', async (ctx, [id]) => {
    const u = await requireUser(ctx.req, ctx.res);
    const ev = await data.getEventById(int(id), u.id);
    if (!ev || ev.host.id !== u.id) throw httpError(403, 'Only the host can edit speakers');
    return { speakers: await data.setSpeakers(ev.id, (await ctx.body()).speakers) };
  });
  route('GET', '/api/events/([\\w-]+)/qr\\.svg', async (ctx, [slug]) => {
    const ev = await data.getEventBySlug(slug);
    if (!ev || ev.visibility === 'private') throw httpError(404, 'Event not found');
    const s = ctx.url.searchParams;
    const when = ev.status === 'live' ? 'LIVE now' : ev.startsAt ? new Date(ev.startsAt).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: s.get('tz') || 'Africa/Lagos' }) : '';
    const svg = qr().svg(`${ctx.origin}/e/${ev.slug}`, { accent: ev.theme.accent, accent2: ev.theme.accent2, title: ev.title, category: ev.category, when, subtitle: `by ${ev.host.name}`, seed: ev.slug, dark: s.get('dark') === '1', frame: s.get('frame') !== '0' });
    return { raw: svg, type: 'image/svg+xml; charset=utf-8', headers: { 'Cache-Control': 'public, max-age=300', ...(s.get('download') ? attach(`${ev.slug}-qr.svg`) : {}) } };
  });
  route('GET', '/api/qr\\.svg', async (ctx) => {
    const s = ctx.url.searchParams;
    const text = String(s.get('text') || '').slice(0, 600);
    if (!text) throw httpError(400, 'text is required');
    const svg = qr().svg(text, { accent: s.get('accent') || undefined, accent2: s.get('accent2') || undefined, title: s.get('title') || '', subtitle: s.get('subtitle') || '', category: s.get('category') || '', when: s.get('when') || '', dark: s.get('dark') === '1', frame: s.get('frame') !== '0' });
    return { raw: svg, type: 'image/svg+xml; charset=utf-8', headers: { 'Cache-Control': 'public, max-age=600' } };
  });
};
