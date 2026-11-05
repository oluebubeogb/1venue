/** Meeting codes (6 lowercase alnum, e.g. y5yi87) and venue slug rules shared across the server. */
const crypto = require('crypto');
const CODE_CH = 'abcdefghjkmnpqrstuvwxyz23456789';
const CODE_RE = /^[a-z0-9]{6}$/;
const normCode = (c) => String(c || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const isCode = (c) => CODE_RE.test(normCode(c));
const randCode = (n = 6) => Array.from(crypto.randomBytes(n), (b) => CODE_CH[b % CODE_CH.length]).join('');
const codeLink = (c) => `/${normCode(c)}`;

// plans: free < premium < slug3 < slug2
const PLANS = ['free', 'premium', 'slug3', 'slug2'];
const planRank = (p) => Math.max(0, PLANS.indexOf(String(p || 'free')));
const RESERVED = new Set(['api', 'www', 'new', 'login', 'signup', 'logout', 'venues', 'venue', 'v', 'r', 'j', 'm', 'e', 'u', 'me', 'admin', 'settings', 'discover', 'feed', 'bible', 'dashboard', 'create', 'session', 'sessions', 'whiteboard', 'static', 'files', 'ws', 'profile', 'home', 'help', 'css', 'js', 'brand', 'icons', 'plan']);
const slugifyBase = (s) => String(s || '').toLowerCase().replace(/-venue$/, '').replace(/[^a-z0-9]/g, '');
const SLUG_ROUTE_RE = /^(?:[a-z0-9]{2,16}|[a-z0-9]{5}-venue)$/;

/** Resolve a user's requested custom slug for their plan. Returns { slug } or throws {status,message}. */
function customSlug(input, plan, { suffix } = {}) {
  const base = slugifyBase(input);
  const r = planRank(plan);
  const err = (m) => { const e = new Error(m); e.status = 400; throw e; };
  if (!base) err('Enter letters or numbers for your custom link');
  if (RESERVED.has(base)) err('That link is reserved — try another');
  if (base.length > 16) err('Custom links can be at most 16 characters');
  // Free tier, or premium+ explicitly asking for the -venue style
  if (r === 0 || suffix === true) {
    if (base.length !== 5) err('Free custom links must be exactly 5 letters/numbers (we add -venue)');
    return { slug: `${base}-venue`, base };
  }
  if (base.length === 2 && r < 3) err('2-character links need the slug2 package');
  if (base.length === 3 && r < 2) err('3-character links need the slug3 package');
  if (base.length < 2) err('Custom links need at least 2 characters');
  if (base.length === 6) err('6-character links look like meeting codes — pick another length');
  if (base.length === 7 && /\d/.test(base) && /[a-z]/.test(base)) err('That shape is reserved for auto links — add or remove a character');
  return { slug: base, base };
}

module.exports = { CODE_CH, CODE_RE, normCode, isCode, randCode, codeLink, PLANS, planRank, RESERVED, slugifyBase, customSlug, SLUG_ROUTE_RE };
