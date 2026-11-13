/**
 * Social: prefs & profile, feed, posts, people, users, follows.
 * JSON API routes (see src/core/router.js for the route() contract).
 */
module.exports = function routes(route, kit) {
  const { rateLimit, getAuthUser, data, httpError, requireUser, int, liveInfo } = kit;

  // ------------------------------------------------------------ prefs & profile
  route('GET', '/api/prefs', async (ctx) => {
    const u = await getAuthUser(ctx.req, ctx.res);
    return u ? data.getPrefs(u.id) : { ...(await data.getPrefs(0)), anonymous: true };
  });
  route('PUT', '/api/prefs', async (ctx) => data.setPrefs((await requireUser(ctx.req, ctx.res)).id, await ctx.body()));
  route('PATCH', '/api/profile', async (ctx) => {
    const u = await requireUser(ctx.req, ctx.res);
    await data.updateProfile(u.id, await ctx.body());
    return data.getUserProfile(u.id, u.id);
  });

  // ------------------------------------------------------------ social
  route('GET', '/api/feed', async (ctx) => {
    const u = await getAuthUser(ctx.req, ctx.res);
    return { posts: await data.feed(u ? u.id : 0, { before: ctx.url.searchParams.get('before') }) };
  });
  route('POST', '/api/posts', async (ctx) => {
    const u = await requireUser(ctx.req, ctx.res);
    if (!rateLimit(`p:${u.id}`, 10)) throw httpError(429, 'Slow down a little');
    const b = await ctx.body();
    return data.createPost(u.id, { kind: 'post', body: b.body, eventId: b.eventId, media: normalizePostMedia(b.media) });
  });
  route('POST', '/api/posts/(\\d+)/like', async (ctx, [id]) => data.togglePostLike(int(id), (await requireUser(ctx.req, ctx.res)).id));
  route('DELETE', '/api/posts/(\\d+)', async (ctx, [id]) => {
    if (!(await data.deletePost(int(id), (await requireUser(ctx.req, ctx.res)).id))) throw httpError(404, 'Post not found');
    return { ok: true };
  });
  route('GET', '/api/people/suggested', async (ctx) => {
    const u = await getAuthUser(ctx.req, ctx.res);
    return { people: await data.suggestedPeople(u && u.id) };
  });
  route('GET', '/api/users/search', async (ctx) => ({ users: await data.searchUsers(ctx.url.searchParams.get('q') || '', 10) }));
  async function resolveUserId(idOrName) {
    if (/^\d+$/.test(idOrName)) return int(idOrName);
    const db = require('../../../db');
    const byName = await db.getUserByUsername(idOrName);
    if (byName) return byName.id;
    // collab internal usernames are u{hex8}_{public}; accept the public form + handle
    const row = await db.q(
      `SELECT id FROM users
       WHERE LOWER(COALESCE(handle,'')) = LOWER($1)
          OR username ~* ('^[uU][0-9a-fA-F]{8}_' || $1 || '$')
       LIMIT 1`,
      [idOrName]
    ).then((r) => r.rows[0]).catch(() => null);
    return row ? row.id : null;
  }
  route('GET', '/api/users/([\\w.-]+)', async (ctx, [idOrName]) => {
    const u = await getAuthUser(ctx.req, ctx.res);
    const uid = await resolveUserId(idOrName);
    const p = await data.getUserProfile(uid, u && u.id);
    if (!p) throw httpError(404, 'User not found');
    const events = (await data.myEvents(p.id)).filter((e) => e.visibility === 'public' && e.status !== 'draft');
    return { ...p, isMe: !!(u && u.id === p.id), events: events.slice(0, 12).map((e) => ({ ...e, live: liveInfo(e) })) };
  });
  route('GET', '/api/users/([\\w.-]+)/timeline', async (ctx, [idOrName]) => {
    const uid = await resolveUserId(idOrName);
    const u = await getAuthUser(ctx.req, ctx.res);
    return { posts: await data.userTimeline(uid, u && u.id, { before: ctx.url.searchParams.get('before') }) };
  });
  route('POST', '/api/users/(\\d+)/follow', async (ctx, [id]) => {
    const u = await requireUser(ctx.req, ctx.res);
    const b = await ctx.body();
    return { following: await data.follow(u.id, int(id), b.on !== false) };
  });

  // Post attachments: uploaded images (/files/… or https) and Bible passage cards.
  function normalizePostMedia(list) {
    if (!Array.isArray(list)) return [];
    const str = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
    const out = [];
    for (const m of list) {
      if (!m || typeof m !== 'object') continue;
      if (m.type === 'passage') {
        const reference = str(m.reference, 80), text = str(m.text, 1500);
        if (!reference || !text) continue;
        const translation = str(m.translation, 40).replace(/[^\w-]/g, '');
        out.push({ type: 'passage', reference, text, translation, short: str(m.short, 16), url: `/books?ref=${encodeURIComponent(reference)}${translation ? `&t=${translation}` : ''}${/^quran_/i.test(translation || '') ? '&corpus=quran' : ''}` });
      } else if (typeof m.url === 'string' && /^\/files\/|^https:\/\//.test(m.url)) out.push({ url: m.url.slice(0, 500), mime: str(m.mime, 80) });
    }
    return out.slice(0, 4);
  }
};
