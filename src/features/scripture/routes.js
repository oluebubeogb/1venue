/**
 * Bible / Qur’an passages and books.
 * JSON API routes (see src/core/router.js for the route() contract).
 */
module.exports = function routes(route, kit) {
  const { config, clientIp, rateLimit, bible, httpError } = kit;

  // ------------------------------------------------------------ Bible
  route('GET', '/api/bible/translations', async () => ({ translations: bible().TRANSLATIONS, default: config.BIBLE.defaultTranslation }));
  route('GET', '/api/bible/books', async () => ({ books: bible().BOOKS }));
  route('GET', '/api/bible/passage', async (ctx) => {
    if (!rateLimit(`b:${clientIp(ctx.req)}`, 120)) throw httpError(429, 'Too many requests');
    return bible().passage(ctx.url.searchParams.get('ref'), ctx.url.searchParams.get('t'));
  });
  // Book ids: 3-letter USFM (GEN, JHN) or Qur’an Q001–Q114
  route('GET', '/api/bible/([\\w.-]+)/([\\w]{2,8})/(\\d{1,3})', async (ctx, [t, b, c]) => {
    if (!rateLimit(`b:${clientIp(ctx.req)}`, 120)) throw httpError(429, 'Too many requests');
    return { ...(await bible().chapter(t, b, c)), _cache: true };
  });
};
