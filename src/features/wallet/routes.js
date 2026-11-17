const data = require('./data');
const gateway = require('./paystack');
const { quote, BUNDLES, PRICE_PER_CREDIT_KOBO } = require('./rules');
module.exports = function routes(route, { requireUser, httpError, rateLimit }) {
  route('GET', '/api/wallet', async (ctx) => {
    const u = await requireUser(ctx.req, ctx.res);
    return { userId:u.id, ...await require('./billing-data').current(u.id), pricePerCreditKobo: PRICE_PER_CREDIT_KOBO, currency: 'NGN', bundles: BUNDLES, purchasesEnabled: gateway.enabled(), expires: false };
  });
  route('POST', '/api/wallet/quote', async (ctx) => {
    await requireUser(ctx.req, ctx.res);
    return { ...quote((await ctx.body()).credits), feeNotice: 'Paystack adds its processing fee at checkout. Fees do not buy additional credits.' };
  });
  route('POST', '/api/wallet/checkout', async (ctx) => {
    const u = await requireUser(ctx.req, ctx.res);
    if (!rateLimit('wallet-checkout:' + u.id, 10)) throw httpError(429, 'Please wait before starting another purchase');
    return { $status: 201, $body: await gateway.initialize(u, (await ctx.body()).credits) };
  });
  route('GET', '/api/wallet/payments', async (ctx) => {
    const u = await requireUser(ctx.req, ctx.res);
    return data.payments(u.id, ctx.url.searchParams.get('before'));
  });
  route('POST', '/api/wallet/payments/([A-Za-z0-9-]{1,80})/verify', async (ctx, [reference]) => {
    const u = await requireUser(ctx.req, ctx.res);
    const payment = await data.getPayment(reference);
    if (!payment || Number(payment.user_id) !== Number(u.id)) throw httpError(404, 'Payment not found');
    if (!rateLimit('wallet-verify:' + u.id, 40)) throw httpError(429, 'Please wait before checking again');
    return gateway.confirm(payment);
  });
  route('GET', '/api/wallet/transactions', async (ctx) => {
    const u = await requireUser(ctx.req, ctx.res);
    return data.history(u.id, ctx.url.searchParams.get('before'));
  });
};
