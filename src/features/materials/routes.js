/**
 * Materials: pre-loaded decks, attachable to events.
 * JSON API routes (see src/core/router.js for the route() contract).
 */
module.exports = function routes(route, kit) {
  const { getAuthUser, data, httpError, requireUser } = kit;

  // ------------------------------------------------------------ materials (preload decks)
  route('GET', '/api/materials', async (ctx) => {
    const u = await requireUser(ctx.req, ctx.res);
    return { materials: await data.listMaterials(u.id) };
  });
  route('POST', '/api/materials', async (ctx) => {
    const u = await requireUser(ctx.req, ctx.res);
    const b = await ctx.body();
    return data.createMaterial(u.id, b);
  });
  route('GET', '/api/materials/(\\d+)', async (ctx, [id]) => {
    const u = await requireUser(ctx.req, ctx.res);
    const m = await data.getMaterial(Number(id), u.id);
    if (!m) throw httpError(404, 'Material not found');
    return m;
  });
  route('PATCH', '/api/materials/(\\d+)', async (ctx, [id]) => {
    const u = await requireUser(ctx.req, ctx.res);
    const m = await data.updateMaterial(Number(id), u.id, await ctx.body());
    if (!m) throw httpError(404, 'Material not found');
    return m;
  });
  route('DELETE', '/api/materials/(\\d+)', async (ctx, [id]) => {
    const u = await requireUser(ctx.req, ctx.res);
    if (!(await data.deleteMaterial(Number(id), u.id))) throw httpError(404, 'Material not found');
    return { ok: true };
  });
  route('GET', '/api/events/(\\d+)/materials', async (ctx, [id]) => {
    const u = await getAuthUser(ctx.req, ctx.res);
    const ev = await data.getEventById(Number(id), u?.id);
    if (!ev) throw httpError(404, 'Event not found');
    // public scheduled events can expose material list to host only for now
    if (!u || ev.host.id !== u.id) throw httpError(403, 'Only the host can manage event materials');
    return { materials: await data.listEventMaterials(Number(id)) };
  });
  route('PUT', '/api/events/(\\d+)/materials', async (ctx, [id]) => {
    const u = await requireUser(ctx.req, ctx.res);
    const b = await ctx.body();
    return { materials: await data.setEventMaterials(Number(id), u.id, b.materialIds || b.ids || []) };
  });
};
