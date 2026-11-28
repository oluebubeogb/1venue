'use strict';
// Instant meeting is an overlay (not a page) with sign-in style inputs; the feed composer mic is a
// strict tap-to-talk toggle that never listens on focus and never restarts itself.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('instant meeting opens as an overlay from anywhere, with the log-in look', () => {
  const inst = read('public/js/instant.js');
  assert.match(inst, /class: 'au-scrim im-scrim'/, 'same blurred scrim as log in');
  assert.match(inst, /class: 'au-modal im-modal', role: 'dialog', 'aria-modal': 'true'/);
  assert.match(inst, /class: 'au-pill pj-field'/);
  assert.match(inst, /placeholder: 'Meeting name'/);
  assert.doesNotMatch(inst, /Start a room right now/);
  assert.match(inst, /accessMode: 'host_funded'/, 'free entry is the default');
  assert.match(inst, /paid \? 'Paid Entry' : 'Free Entry'/, 'the toggle shows the current entry label');
  assert.match(inst, /opts\.accessMode === 'host_funded' \? 'paid_entry' : 'host_funded'/, 'the toggle switches between access modes');
  assert.match(inst, /meetingAccessMode: opts\.accessMode/, 'the selected mode is passed to meeting setup');
  assert.match(inst, /checkCircle/);
  assert.match(inst, /e\.key === 'Escape'/); assert.match(inst, /e\.key === 'Tab'/, 'focus trap');
  assert.match(inst, /venue\.intent/); assert.match(inst, /navigate\('\/new'\)/);

  const app = read('public/js/app.js');
  assert.match(app, /url\.searchParams\.get\('instant'\)[^\n]*openInstantOverlay\(\)/, 'in-app links open the overlay over the current page');
  assert.match(app, /id: 'instant'[^\n]*run: \(\) => openInstantOverlay\(\)/, 'command bar opens the overlay');

  const create = read('public/js/pages/create.js');
  assert.match(create, /if \(params\.instant\) return instantDeepLink\(view\)/, 'old /create?instant=1 links still work');
  assert.doesNotMatch(create, /function instant\(view\)/, 'no dedicated page any more');

  const css = read('public/css/app.css');
  assert.match(css, /\.au-scrim \{[^}]*backdrop-filter:[^;]*blur/);
  assert.match(css, /\.im-togs \{/);

  const src = read('public/css/src/10-components/modals.css');
  const im = src.slice(src.indexOf('/* Instant meeting overlay'), src.indexOf('@media (min-width: 821px)'));
  assert.match(im, /\.im-badge \{[\s\S]*color: var\(--accent\)/);
  assert.match(im, /color-mix\(in srgb, var\(--accent\)/);
  assert.match(im, /\.im-tog-fund \.im-tog/);
  assert.match(im, /im-tog-badge/);
  assert.match(im, /\.im-modal \.au-primary \{[\s\S]*background: var\(--accent-action, var\(--accent\)\)/);
  assert.match(im, /color: #fff/);
  assert.doesNotMatch(im, /var\(--brand\)|#7c3aed/);
});

test('feed composer mic: tap-to-talk only, clear on state, stops on typing / blur / post / silence, no auto-restart', () => {
  const feed = read('public/js/pages/feed.js');
  assert.match(feed, /'data-voice': 'off'/, 'the composer never listens just because it is focused');
  assert.match(feed, /'aria-pressed': 'false'/);
  assert.match(feed, /listenOn\(ta, \{\s*manual: true/);
  assert.match(feed, /stopListening\(ta, 'user'\)/, 'second tap turns it off');
  assert.match(feed, /stopListening\(ta, 'posted'\)/, 'posting turns it off');
  assert.match(feed, /'Listening'/);

  const voice = read('public/js/voice.js');
  assert.match(voice, /addEventListener\('beforeinput', this\.onUserEdit\)/, 'typing / deleting / pasting stops it');
  assert.match(voice, /this\.stop\('silence'\)/);
  assert.match(voice, /if \(!el\.isConnected\) return this\.stop\('gone'\)/, 'leaving the page stops it');
  assert.match(voice, /sr\.onend = \(\) => \{ if \(this\.manual\) \{ this\.stop\('ended'\); return; \}/, 'never restarts after onend');
  assert.match(voice, /export function stopListening/);

  const { voiceKind } = require('../public/js/voice-fields.js');
  const ta = { tagName: 'TEXTAREA', dataset: { voice: 'off' }, closest: () => null, getAttribute: () => null };
  assert.equal(voiceKind(ta), null, 'focus-to-talk skips the composer');

  const css = read('public/css/app.css');
  assert.match(css, /\.feed-compose \.icon-btn\.feed-mic\.on \{[^}]*background: #e11d48/, 'obvious red on state (beats room.css .icon-btn.sm)');
});

test('sitewide mic toggle: shows on hover / focus, never readonly or blurs, typing keeps dictation going', () => {
  const voice = read('public/js/voice.js');
  assert.match(voice, /function initMic\(\)/);
  assert.match(voice, /addEventListener\('pointerdown', keep\)/, 'tapping the mic never steals focus');
  assert.match(voice, /addEventListener\('touchend', \(e\) => \{ e\.preventDefault\(\)/, 'iOS: no synthetic click, no blur');
  assert.match(voice, /listenOn\(el, \{ keepTyping: true/);
  assert.match(voice, /dropInterim\(\)/, 'interim words are lifted out before your keystroke lands');
  assert.doesNotMatch(voice, /readOnly\s*=\s*true|setAttribute\('readonly'/, 'the field is never made readonly');
  assert.doesNotMatch(voice, /addEventListener\('focusin', \(e\) => \{ const el = e\.target; if \(voiceKind\(el\)\) begin\(el\); \}\)/, 'no auto-listening on focus');
  const css = read('public/css/app.css');
  assert.match(css, /\.vmic\.on \{[^}]*background: var\(--accent-action, var\(--accent\)\)/, 'on state follows the contrast-safe theme accent');
});
