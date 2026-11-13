/**
 * Session transcripts and AI summaries.
 * JSON API routes (see src/core/router.js for the route() contract).
 */
module.exports = function routes(route, kit) {
  const { clientIp, rateLimit, data, ai, httpError, int, attach, roomParticipant, getAuthUser, publicUser } = kit;

  /** Room members (live) or past attendees (signed in) may read a session. */
  async function historyAccess(req, res, historyId) {
    const h = await data.getHistory(historyId);
    if (!h) throw httpError(404, 'Session not found');
    const rp = roomParticipant(req, h.code);
    if (rp && rp.meeting.historyId === historyId) return { h, by: rp.participant.name, userId: rp.participant.userId };
    const u = await getAuthUser(req, res);
    if (u && (await data.canAccessHistory(historyId, u.id))) return { h, by: publicUser(u).displayName, userId: u.id };
    throw httpError(u ? 403 : 401, u ? 'You did not attend this session' : 'Sign in to continue');
  }

  // ------------------------------------------------------------ transcripts & summaries
  route('GET', '/api/sessions/(\\d+)', async (ctx, [id]) => {
    const { h } = await historyAccess(ctx.req, ctx.res, int(id));
    const [segments, summaries] = await Promise.all([data.getTranscript(h.id, { limit: 3000 }), data.latestSummaries(h.id)]);
    return { id: h.id, code: h.code, name: h.name, startedAt: h.created_at, endedAt: h.ended_at, segments, summaries };
  });
  route('GET', '/api/sessions/(\\d+)/transcript\\.txt', async (ctx, [id]) => {
    const { h } = await historyAccess(ctx.req, ctx.res, int(id));
    const text = data.transcriptToText(await data.getTranscript(h.id));
    const head = `${h.name || 'Session'} (${h.code})\n${new Date(h.created_at).toUTCString()}\n\n`;
    return { raw: head + (text || '(no transcript yet)') + '\n', type: 'text/plain; charset=utf-8', headers: attach(`${(h.name || 'transcript').slice(0, 40)}-transcript.txt`) };
  });
  route('POST', '/api/sessions/(\\d+)/summary', async (ctx, [id]) => {
    const { h, userId } = await historyAccess(ctx.req, ctx.res, int(id));
    if (!rateLimit(`ai:${clientIp(ctx.req)}`, 20)) throw httpError(429, 'AI rate limit, try again in a minute');
    const kind = (await ctx.body()).kind === 'action_items' ? 'action_items' : 'summary';
    const transcript = data.transcriptToText(await data.getTranscript(h.id));
    if (!transcript) throw httpError(400, 'There is no transcript to summarise yet');
    const r = kind === 'summary' ? await ai().summarize(transcript, h.name) : await ai().actionItems(transcript);
    return data.saveSummary({ historyId: h.id, kind, content: r.text, provider: r.provider, model: r.model, userId });
  });
  route('GET', '/api/sessions/(\\d+)/summary\\.md', async (ctx, [id]) => {
    const { h } = await historyAccess(ctx.req, ctx.res, int(id));
    const sums = await data.latestSummaries(h.id);
    if (!sums.length) throw httpError(404, 'No summary yet');
    const md = `# ${h.name || 'Session'}\n\n_${new Date(h.created_at).toUTCString()} · ${h.code}_\n\n` + sums.map((s) => `## ${s.kind === 'summary' ? 'Summary' : 'Action items'}\n\n${s.content}\n`).join('\n');
    return { raw: md, type: 'text/markdown; charset=utf-8', headers: attach(`${(h.name || 'session').slice(0, 40)}-summary.md`) };
  });
};
