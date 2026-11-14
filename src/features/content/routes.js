/**
 * Content: convert PPTX decks to slide images (room presenters or signed-in users).
 * JSON API routes (see src/core/router.js for the route() contract).
 */
module.exports = function routes(route, kit) {
  const { readRaw, rateLimit, getAuthUser, can, httpError, roomParticipant } = kit;

  // Convert office decks without blocking room signalling. Room credentials also support guest presenters.
  route('POST', '/api/convert/pptx', async (ctx) => {
    const rp = roomParticipant(ctx.req);
    const u = rp ? null : await getAuthUser(ctx.req, ctx.res);
    if (!rp && !u) throw httpError(401, 'Sign in or join a meeting to present');
    if (rp && !can(rp.meeting, rp.participant, 'screenShare')) throw httpError(403, 'The host controls who can present');
    const key = rp ? `room:${rp.code}:${rp.participant.id}` : `user:${u.id}`;
    if (!rateLimit('pptx:' + key, 4)) throw httpError(429, 'Please wait before converting another deck');
    const converter = require('../../venue/pptx');
    const mime = String(ctx.req.headers['content-type'] || '').split(';')[0].toLowerCase();
    if (!converter.MIMES.has(mime)) throw httpError(415, 'Choose a PPTX presentation');
    if (Number(ctx.req.headers['content-length']) > converter.MAX_BYTES) throw httpError(413, 'PPTX must be 50 MB or smaller');
    const buf = await readRaw(ctx.req, converter.MAX_BYTES);
    // Optional filename from query or header for nicer slide titles
    const qTitle = String(ctx.url.searchParams.get('title') || '').trim();
    const title = (qTitle || 'Slides').slice(0, 80);
    const out = await converter.convertPptxToSlides(buf, {
      ownerUserId: u ? u.id : null,
      ownerKey: rp ? `room:${rp.code}:${rp.participant.id}` : null,
      roomCode: rp ? rp.code : null,
      title,
    });
    return {
      contentType: 'slides',
      pages: out.pages,
      title: out.title,
      total: out.total,
      truncated: out.truncated,
    };
  });
};
