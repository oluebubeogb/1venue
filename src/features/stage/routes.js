/**
 * Live room helpers: stage state REST mirror, end-of-session summary.
 * JSON API routes (see src/core/router.js for the route() contract).
 */
module.exports = function routes(route, kit) {
  const { normCode, store, isModerator, stage, httpError, roomParticipant } = kit;

  // ------------------------------------------------------------ live room helpers (REST mirror for slow clients)
  route('GET', '/api/rooms/([A-Za-z0-9-]+)/stage', async (ctx, [code]) => {
    const m = store.getMeeting(normCode(code));
    if (!m) throw httpError(404, 'Room not live');
    return stage.state(m);
  });
  route('POST', '/api/rooms/([A-Za-z0-9-]+)/end-summary', async (ctx, [code]) => {
    const rp = roomParticipant(ctx.req, code);
    if (!rp || !isModerator(rp.participant)) throw httpError(403, 'Hosts only');
    return { historyId: rp.meeting.historyId };
  });
};
