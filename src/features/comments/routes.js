/**
 * Comments on events and posts.
 * JSON API routes (see src/core/router.js for the route() contract).
 */
module.exports = function routes(route, kit) {
  const { rateLimit, getAuthUser, data, ai, httpError, requireUser, int } = kit;

  // ------------------------------------------------------------ comments (events, posts)
  const TARGETS = { events: 'event', posts: 'post' };
  route('GET', '/api/(events|posts)/(\\d+)/comments', async (ctx, [kind, id]) => {
    const u = await getAuthUser(ctx.req, ctx.res);
    return { comments: await data.listComments(TARGETS[kind], id, { viewerKey: u ? `u:${u.id}` : '', before: ctx.url.searchParams.get('before') }) };
  });
  route('POST', '/api/(events|posts)/(\\d+)/comments', async (ctx, [kind, id]) => {
    const u = await requireUser(ctx.req, ctx.res);
    if (!rateLimit(`c:${u.id}`, 20)) throw httpError(429, 'Slow down a little');
    const b = await ctx.body();
    let moderation = null;
    if (ai().status().enabled) {
      moderation = await ai().moderate(b.body).catch(() => null);
      if (moderation && !moderation.allowed) throw httpError(422, `Comment held: ${moderation.reason || 'community guidelines'}`);
    }
    return data.addComment({ targetType: TARGETS[kind], targetKey: id, parentId: b.parentId || null, userId: u.id, authorKey: `u:${u.id}`, authorName: u.displayName, body: b.body, moderation });
  });
  route('GET', '/api/comments/(\\d+)/replies', async (ctx, [id]) => {
    const u = await getAuthUser(ctx.req, ctx.res);
    const c = await data.getComment(int(id));
    if (!c) throw httpError(404, 'Comment not found');
    return { replies: await data.listComments(c.target_type, c.target_key, { parentId: c.id, viewerKey: u ? `u:${u.id}` : '' }) };
  });
  route('POST', '/api/comments/(\\d+)/like', async (ctx, [id]) => {
    const u = await requireUser(ctx.req, ctx.res);
    const r = await data.toggleCommentLike(int(id), `u:${u.id}`);
    return { liked: r.liked, likeCount: r.likeCount };
  });
  route('DELETE', '/api/comments/(\\d+)', async (ctx, [id]) => {
    const u = await requireUser(ctx.req, ctx.res);
    const c = await data.getComment(int(id));
    if (!c) throw httpError(404, 'Comment not found');
    let allowed = c.author_key === `u:${u.id}`;
    if (!allowed && c.target_type === 'event') { const ev = await data.getEventById(int(c.target_key)); allowed = ev && ev.host.id === u.id; }
    if (!allowed) throw httpError(403, 'Not allowed');
    await data.hideComment(c.id);
    return { ok: true };
  });
};
