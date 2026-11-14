'use strict';
// Username rules for local sign-up, availability checks, and Google auto-names.
// 3–30 lowercase letters, digits, underscore or period; cannot start or end with a period;
// cannot be a reserved route or system name. Compared case-insensitively.

const RESERVED = new Set([
  'admin', 'support', 'help', 'api', 'www', 'root', '1venue', 'settings', 'login', 'signup',
  'logout', 'venues', 'venue', 'v', 'r', 'j', 'm', 'e', 'u', 'me', 'discover', 'feed', 'bible',
  'dashboard', 'create', 'session', 'sessions', 'whiteboard', 'static', 'files', 'ws', 'profile',
  'home', 'css', 'js', 'brand', 'icons', 'plan', 'new', 'books', 'search', 'materials', 'privacy',
  'terms', 'forgot-password', 'reset-password', 'verify-email', 'account', 'auth', 'health',
  'about', 'contact', 'legal', 'status', 'null', 'undefined', 'owner', 'moderator', 'mod',
  'official', 'staff', 'system', 'test',
]);

function normalizeUsername(raw) {
  return String(raw || '').trim().toLowerCase();
}

/** @returns {{ ok: true, username: string } | { ok: false, reason: string, message: string }} */
function parseUsername(raw) {
  const username = normalizeUsername(raw);
  if (!username) return { ok: false, reason: 'required', message: 'Choose a username' };
  if (username.length < 3) return { ok: false, reason: 'too_short', message: 'Usernames need at least 3 characters' };
  if (username.length > 30) return { ok: false, reason: 'too_long', message: 'Usernames can be at most 30 characters' };
  if (username.startsWith('.') || username.endsWith('.')) {
    return { ok: false, reason: 'invalid', message: 'Usernames can’t start or end with a period' };
  }
  if (username.includes('..')) {
    return { ok: false, reason: 'invalid', message: 'Usernames can’t have consecutive periods' };
  }
  if (!/^[a-z0-9._]+$/.test(username)) {
    return { ok: false, reason: 'invalid', message: 'Use lowercase letters, numbers, underscores or periods' };
  }
  if (RESERVED.has(username)) return { ok: false, reason: 'reserved', message: 'That username is reserved' };
  return { ok: true, username };
}

function isValidUsername(raw) {
  return parseUsername(raw).ok;
}

/** Strip a display name or email local-part into a legal base (may still be reserved or short). */
function slugHint(hint) {
  let base = normalizeUsername(hint).replace(/[^a-z0-9._]/g, '').replace(/^\.+|\.+$/g, '').replace(/\.+/g, '.');
  if (base.length > 24) base = base.slice(0, 24).replace(/\.+$/g, '');
  return base;
}

module.exports = { RESERVED, normalizeUsername, parseUsername, isValidUsername, slugHint };
