// Integer credit units leave room for exact per-second metering and host/platform splits.
const rates = require('./rates');
const UNITS_PER_CREDIT = rates.UNITS_PER_CREDIT;
const fail = (status, message, extra) => Object.assign(new Error(message), { status, ...(extra || {}) });
const openMeetingConflict = (row) => fail(409, 'You already have an open meeting. End it before opening another.', {
  activeMeeting: { historyId: Number(row.history_id), code: row.code },
});
function pricePerCreditKobo() { return rates.pricePerCreditKobo(); }
// Kept as a live getter so tests and checkout always see the current env price.
function quote(credits) {
  const PRICE_PER_CREDIT_KOBO = pricePerCreditKobo();
  if (!Number.isSafeInteger(credits) || credits < 1 || !Number.isSafeInteger(credits * UNITS_PER_CREDIT) || !Number.isSafeInteger(credits * PRICE_PER_CREDIT_KOBO)) {
    throw fail(400, 'Choose a positive whole number of credits within the supported range');
  }
  const subtotal = credits * PRICE_PER_CREDIT_KOBO;
  const f = require('../../lib/money').withFee(subtotal);
  return { credits, priceKobo: subtotal, subtotalKobo: subtotal, feeKobo: f.fee, feePercent: f.percent, totalKobo: f.total, currency: 'NGN' };
}
function bundles() { return rates.bundles().map(quote); }
module.exports = {
  UNITS_PER_CREDIT,
  get PRICE_PER_CREDIT_KOBO() { return pricePerCreditKobo(); },
  get BUNDLES() { return bundles(); },
  pricePerCreditKobo,
  quote,
  fail,
  openMeetingConflict,
};
