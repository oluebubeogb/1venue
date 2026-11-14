'use strict';
// Phone numbers are stored in E.164. Local sign-up requires one; Google accounts can add
// one later in Settings. We do not verify by SMS yet (phone_verified stays false).
const { parsePhoneNumberFromString, getCountries, getCountryCallingCode } = require('libphonenumber-js');

const DEFAULT_COUNTRY = 'NG';

function countryCallingCode(iso) {
  try { return '+' + getCountryCallingCode(String(iso || DEFAULT_COUNTRY).toUpperCase()); }
  catch { return '+234'; }
}

/** @returns {{ ok: true, e164: string, country: string } | { ok: false, reason: string, message: string }} */
function normalizePhone(input, country = DEFAULT_COUNTRY) {
  const raw = String(input || '').trim();
  if (!raw) return { ok: false, reason: 'required', message: 'Enter your phone number' };
  const iso = String(country || DEFAULT_COUNTRY).trim().toUpperCase() || DEFAULT_COUNTRY;
  const phone = parsePhoneNumberFromString(raw, iso);
  if (!phone || !phone.isValid()) return { ok: false, reason: 'invalid', message: 'Enter a valid phone number' };
  return { ok: true, e164: phone.number, country: phone.country || iso };
}

function phoneCountries() {
  const preferred = ['NG', 'GH', 'KE', 'ZA', 'EG', 'US', 'GB', 'CA', 'IN', 'AE', 'DE', 'FR', 'NL', 'AU', 'BR'];
  const rest = getCountries().filter((c) => !preferred.includes(c)).sort();
  return [...preferred, ...rest].map((iso) => ({ iso, dial: countryCallingCode(iso) }));
}

module.exports = { DEFAULT_COUNTRY, normalizePhone, countryCallingCode, phoneCountries };
