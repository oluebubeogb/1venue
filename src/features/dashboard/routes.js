/**
 * Dashboard and global search.
 * JSON API routes (see src/core/router.js for the route() contract).
 */
module.exports = function routes(route, kit) {
  const { getAuthUser, data, bible, requireUser, liveInfo } = kit;

  // ------------------------------------------------------------ dashboard & search
  route('GET', '/api/dashboard', async (ctx) => {
    const u = await requireUser(ctx.req, ctx.res);
    const [dash, hosting, going, live, history, people, profile] = await Promise.all([
      data.dashboard(u.id), data.myEvents(u.id), data.rsvpedEvents(u.id), data.discover({ status: 'live', limit: 8, viewerId: u.id }),
      require('../../../db').getHistoryForUser(u.id).catch(() => []), data.suggestedPeople(u.id, 5), data.getUserProfile(u.id, u.id),
    ]);
    return { ...dash, profile, hosting: hosting.slice(0, 12).map((e) => ({ ...e, live: liveInfo(e) })), going, live: live.map((e) => ({ ...e, live: liveInfo(e) })), history: (history || []).slice(0, 10), people };
  });
  route('GET', '/api/search', async (ctx) => {
    const qy = String(ctx.url.searchParams.get('q') || '').trim();
    if (qy.length < 2) return { events: [], people: [] };
    const u = await getAuthUser(ctx.req, ctx.res);
    const [events, people] = await Promise.all([data.discover({ q: qy, limit: 6, viewerId: u && u.id }), data.searchUsers(qy, 5)]);
    const ref = bible().parseReference(qy);
    return { events, people, scripture: ref ? { reference: `${ref.bookName} ${ref.chapter}${ref.verses ? ':' + ref.verses[0] + (ref.verses.length > 1 ? '-' + ref.verses[ref.verses.length - 1] : '') : ''}` } : null };
  });
};
