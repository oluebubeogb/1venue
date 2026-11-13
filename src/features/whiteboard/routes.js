/**
 * Personal whiteboards (saved boards).
 * JSON API routes (see src/core/router.js for the route() contract).
 */
module.exports = function routes(route, kit) {
  const { rateLimit, data, httpError, requireUser, int } = kit;

  // ------------------------------------------------------------ personal whiteboards
  route('GET', '/api/whiteboards', async (ctx) => ({ boards: await data.listWhiteboards((await requireUser(ctx.req, ctx.res)).id) }));
  route('GET', '/api/whiteboards/board', async (ctx) => data.getWhiteboard((await requireUser(ctx.req, ctx.res)).id, ctx.url.searchParams.get('title') || 'My board'));
  route('PUT', '/api/whiteboards/board', async (ctx) => {
    const u = await requireUser(ctx.req, ctx.res);
    const b = await ctx.body(2e6);
    return data.saveWhiteboard(u.id, b.title || 'My board', { strokes: Array.isArray(b.strokes) ? b.strokes.slice(-5000) : [], bg: b.bg || null });
  });
  // Board document: { version: 2, bg, activePage, pages: [{ strokes: [{ tool, color, width, points: [[x, y, w]] }], images: [{ url, x, y, w, h }], texts: [{ x, y, text, size, color }] }] }
  function cleanBoard(d) {
    if (!d || typeof d !== 'object') return null;
    const pages = (Array.isArray(d.pages) ? d.pages : [{ strokes: d.strokes || [] }]).slice(0, 50).map((p) => ({
      strokes: Array.isArray(p && p.strokes) ? p.strokes.slice(-6000) : [],
      images: Array.isArray(p && p.images) ? p.images.slice(0, 40).filter((i) => i && typeof i.url === 'string' && /^(\/files\/|data:image\/)/.test(i.url) && i.url.length < 1_500_000) : [],
      texts: Array.isArray(p && p.texts) ? p.texts.slice(0, 300).filter((t) => t && typeof t.text === 'string').map((t) => ({ ...t, text: t.text.slice(0, 2000) })) : [],
    }));
    return { version: 2, bg: typeof d.bg === 'string' ? d.bg.slice(0, 20) : 'dots', activePage: Math.max(0, Math.min(pages.length - 1, Number(d.activePage) || 0)), pages: pages.length ? pages : [{ strokes: [], images: [], texts: [] }] };
  }
  route('POST', '/api/whiteboards', async (ctx) => {
    const u = await requireUser(ctx.req, ctx.res);
    if (!rateLimit(`wb:${u.id}`, 30)) throw httpError(429, 'Slow down a little');
    const b = await ctx.body(6e6);
    if ((await data.listWhiteboards(u.id)).length >= 200) throw httpError(400, 'You have 200 boards — delete some first');
    return data.createWhiteboard(u.id, String(b.title || 'Untitled board').trim() || 'Untitled board', cleanBoard(b.data) || cleanBoard({}));
  });
  route('GET', '/api/whiteboards/(\\d+)', async (ctx, [id]) => {
    const u = await requireUser(ctx.req, ctx.res);
    const b = await data.getWhiteboardById(u.id, int(id));
    if (!b) throw httpError(404, 'Board not found');
    return b;
  });
  route('PUT', '/api/whiteboards/(\\d+)', async (ctx, [id]) => {
    const u = await requireUser(ctx.req, ctx.res);
    const b = await ctx.body(6e6);
    const out = await data.updateWhiteboard(u.id, int(id), { title: typeof b.title === 'string' && b.title.trim() ? b.title.trim() : null, data: b.data ? cleanBoard(b.data) : null });
    if (!out) throw httpError(404, 'Board not found');
    return { id: out.id, title: out.title, updatedAt: out.updatedAt };
  });
  route('DELETE', '/api/whiteboards/(\\d+)', async (ctx, [id]) => {
    const u = await requireUser(ctx.req, ctx.res);
    if (!(await data.deleteWhiteboard(u.id, int(id)))) throw httpError(404, 'Board not found');
    return { ok: true };
  });
};
