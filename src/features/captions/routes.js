/**
 * Speech-to-text chunks from room participants (live captions).
 * JSON API routes (see src/core/router.js for the route() contract).
 */
module.exports = function routes(route, kit) {
  const { config, readRaw, rateLimit, store, data, stt, httpError, roomParticipant } = kit;

  // ------------------------------------------------------------ speech-to-text
  route('POST', '/api/stt', async (ctx) => {
    const rp = roomParticipant(ctx.req, ctx.url.searchParams.get('code'));
    if (!rp) throw httpError(401, 'Join the room to send captions');
    if (!rateLimit(`stt:${rp.participant.id}`, 40)) throw httpError(429, 'Caption rate limit');
    const buf = await readRaw(ctx.req, config.STT.maxChunkBytes);
    const lang = ctx.url.searchParams.get('lang') || 'en';
    const mime = String(ctx.req.headers['content-type'] || 'audio/webm').split(';')[0];
    const out = await stt().transcribe(buf, mime, lang);
    const text = out && out.text;
    if (text) {
      const p = rp.participant;
      store.broadcast(rp.code, { type: 'caption', participantId: p.id, name: p.name, text, final: true, lang, at: Date.now() });
      if (rp.meeting.transcribe !== false) await data.addTranscriptSegment({ historyId: rp.meeting.historyId, code: rp.code, speakerKey: p.userId ? `u:${p.userId}` : `p:${p.id}`, speakerName: p.name, text, lang, source: 'stt' });
    }
    return { text: text || '', provider: out && out.provider };
  });
};
