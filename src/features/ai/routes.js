/**
 * AI helpers: ask, catch-up, translate, titles, scripture detection.
 * JSON API routes (see src/core/router.js for the route() contract).
 */
module.exports = function routes(route, kit) {
  const { config, clientIp, rateLimit, getAuthUser, data, ai, bible, httpError, roomParticipant, int } = kit;

  // ------------------------------------------------------------ AI
  async function aiGuard(ctx) {
    if (!require('../../lib/features').features.ai) throw httpError(404, 'AI is disabled');
    const u = await getAuthUser(ctx.req, ctx.res);
    const rp = roomParticipant(ctx.req);
    if (!u && !rp) throw httpError(401, 'Sign in or join a room to use AI');
    if (!rateLimit(`ai:${clientIp(ctx.req)}`, 30)) throw httpError(429, 'AI rate limit, try again in a minute');
    return { u, rp };
  }
  async function roomContext(rp) {
    if (!rp || !rp.meeting.historyId) return '';
    return data.transcriptToText(await data.getTranscript(rp.meeting.historyId, { limit: 1500 }));
  }
  const aiOut = (r) => ({ text: r.text, provider: r.provider, model: r.model, mock: !!r.mock });
  route('POST', '/api/ai/ask', async (ctx) => {
    const { rp } = await aiGuard(ctx);
    const b = await ctx.body();
    if (!b.question) throw httpError(400, 'Ask a question');
    const context = (await roomContext(rp)) || (rp ? `Session: ${rp.meeting.name}` : '');
    return aiOut(await ai().ask(String(b.question).slice(0, 1000), context));
  });
  route('POST', '/api/ai/catchup', async (ctx) => {
    const { rp } = await aiGuard(ctx);
    if (!rp) throw httpError(400, 'Catch-up works inside a room');
    const segs = rp.meeting.historyId ? await data.getTranscript(rp.meeting.historyId, { limit: 2000 }) : [];
    const minutes = Math.min(60, Math.max(2, int((await ctx.body()).minutes, 10)));
    const since = Date.now() - minutes * 60000;
    const recent = data.transcriptToText(segs.filter((s) => new Date(s.at).getTime() >= since));
    if (!recent) return { text: 'Nothing has been said in that window yet, or captions are off.', provider: 'local', mock: true };
    return aiOut(await ai().catchUp(recent, minutes));
  });
  route('POST', '/api/ai/translate', async (ctx) => {
    await aiGuard(ctx);
    const b = await ctx.body();
    return aiOut(await ai().translate(String(b.text || ''), String(b.lang || 'English').slice(0, 30)));
  });
  route('POST', '/api/ai/title', async (ctx) => {
    await aiGuard(ctx);
    const b = await ctx.body();
    const r = await ai().titleDescription(String(b.notes || ''), b.category);
    let out = {};
    try { out = JSON.parse(String(r.text).replace(/^```(json)?|```$/g, '').trim()); } catch (_) { out = { title: String(r.text).split('\n')[0].slice(0, 80), description: String(r.text).slice(0, 400) }; }
    const tags = Array.isArray(out.tags)
      ? out.tags.map((t) => String(t).trim().toLowerCase().replace(/^#/, '').slice(0, 32)).filter(Boolean).slice(0, 12)
      : [];
    return { title: out.title || '', description: out.description || '', tags, provider: r.provider, mock: !!r.mock };
  });
  route('POST', '/api/ai/scripture', async (ctx) => {
    await aiGuard(ctx);
    const b = await ctx.body();
    const query = String(b.query || '').slice(0, 300);
    const corpus = String(b.corpus || 'bible').toLowerCase() === 'quran' ? 'quran' : 'bible';
    let translation = b.translation || null;
    // Keep hydration inside the active corpus
    if (corpus === 'quran' && !/^quran_/i.test(translation || '')) translation = 'quran_en_sahih';
    if (corpus === 'bible' && /^quran_/i.test(translation || '')) translation = config.BIBLE?.defaultTranslation || 'eng_kjv';

    const r = await ai().scripture(query, translation, corpus);
    const parsed = String(r.text).split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
      const [ref, why] = l.replace(/^[-*\d.\s]+/, '').split('|').map((x) => (x || '').trim());
      return bible().parseReference(ref) ? { reference: ref, why: why || '' } : null;
    }).filter(Boolean).slice(0, 6);

    // Drop cross-corpus accidents (e.g. Bible refs while in Qur’an mode)
    const filtered = parsed.filter((item) => {
      const p = bible().parseReference(item.reference);
      if (!p) return false;
      const book = bible().BOOKS.find((x) => x.id === p.book);
      const isQ = book && book.testament === 'Quran';
      return corpus === 'quran' ? isQ : !isQ;
    });

    const refs = [];
    for (const item of filtered) {
      try {
        let tryTr = translation;
        let p;
        try {
          p = await bible().passage(item.reference, tryTr);
        } catch (err) {
          // Deuterocanonical hits when the active translation lacks them → load via WEBc
          const parsedRef = bible().parseReference(item.reference);
          const book = parsedRef && bible().BOOKS.find((x) => x.id === parsedRef.book);
          if (corpus === 'bible' && book && book.testament === 'DC') {
            tryTr = 'eng_webc';
            p = await bible().passage(item.reference, tryTr);
          } else throw err;
        }
        const verses = (p.verses || []).map((v) => ({
          v: v.v,
          text: String(v.text).replace(/^¶\s*/, '').trim(),
        }));
        const text = verses.map((v) => `${v.v} ${v.text}`).join(' ');
        refs.push({
          reference: p.reference || item.reference,
          why: item.why,
          text,
          verses: verses.slice(0, 8),
          translation: p.translation?.id || tryTr,
          short: p.translation?.short || '',
          book: p.book,
          chapter: p.chapter,
          selected: p.selected || null,
          deuterocanon: !!(bible().BOOKS.find((x) => x.id === p.book)?.testament === 'DC'),
        });
      } catch {
        refs.push({ reference: item.reference, why: item.why, text: '', verses: [] });
      }
    }
    return { refs, query, corpus, provider: r.provider, mock: !!r.mock };
  });
};
