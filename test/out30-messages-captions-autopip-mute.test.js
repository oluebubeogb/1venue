'use strict';
const { readFileSync } = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { describe, it } = require('node:test');

const root = path.join(__dirname, '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');

describe('out30 chat switch, captions stick, auto pop-out, mute call audio', () => {
  it('parses the changed front-end modules', () => {
    for (const f of [
      'public/js/app.js',
      'public/js/pages/messages.js',
      'public/js/room/session.js',
      'public/js/room/room.js',
      'public/js/room/panels.js',
      'public/js/room/tools.js',
      'public/js/bring-main.js',
      'src/features/captions/client/ws.js',
    ]) {
      const r = spawnSync(process.execPath, ['--check', path.join(root, f)], { encoding: 'utf8' });
      assert.equal(r.status, 0, `${f}: ${r.stderr || r.stdout}`);
    }
  });

  it('bumps the service worker and cache-bust query', () => {
    assert.match(read('public/sw.js'), /VERSION = 'v97-2026-11-26'/);
    assert.match(read('public/index.html'), /app\.css\?v=83/);
    assert.match(read('public/index.html'), /app\.js\?v=83/);
    assert.match(read('public/index.html'), /room\.css\?v=22/);
  });

  it('keeps the Messages list mounted and only swaps the thread when the conversation id changes', () => {
    const app = read('public/js/app.js');
    assert.match(app, /currentPage\.update === 'function'/);
    assert.match(app, /currentPage\.holds && currentPage\.holds\(path, params\)/);
    const msg = read('public/js/pages/messages.js');
    assert.match(msg, /holds\(path, params\)/);
    assert.match(msg, /params\.id !== 'new'/);
    assert.match(msg, /async update\(params\)/);
    assert.match(msg, /function highlightList\(/);
    assert.match(msg, /threadPane\.classList\.add\('is-loading'\)/);
    assert.match(msg, /if \(seq !== openSeq\) return;/);
    assert.doesNotMatch(msg, /paintList\(\); markRead/);
    const css = read('public/css/src/20-pages/messages.css');
    assert.match(css, /\.msg-pane-thread\.is-loading::after/);
  });

  it('appends caption lines at the bottom and shows New lines when the user has scrolled up', () => {
    const tools = read('public/js/room/tools.js');
    assert.match(tools, /export function pushCaptionLine/);
    assert.match(tools, /New lines ↓/);
    assert.match(tools, /list\._follow !== false/);
    const panels = read('public/js/room/panels.js');
    assert.match(panels, /function appendCaption\(/);
    const ws = read('src/features/captions/client/ws.js');
    assert.match(ws, /R\.panel\.appendCaption/);
    assert.doesNotMatch(ws, /R\.panel\.refresh\(\); return false/);
    const css = read('public/css/room.css');
    assert.match(css, /\.cap-new-lines/);
  });

  it('parks a live meeting on SPA navigation, auto-pops out, and Back to tab stays in the same tab', () => {
    const app = read('public/js/app.js');
    assert.match(app, /currentPage\.parkLive/);
    assert.match(app, /session\.canResume\(params\)/);
    assert.match(app, /session\.resume\(view, params\)/);
    const session = read('public/js/room/session.js');
    assert.match(session, /documentPictureInPicture\.requestWindow/);
    assert.match(session, /enterpictureinpicture/);
    assert.match(session, /export function returnToMeeting/);
    assert.match(session, /function notifyReturn/);
    assert.match(session, /live-meeting-hold/);
    assert.match(session, /live-call-mini/);
    assert.doesNotMatch(session, /window\.open\(/);
    const bring = read('public/js/bring-main.js');
    assert.match(bring, /Back to tab/);
    assert.match(bring, /bringMainToFront\(pipDoc, \{ url \} = \{\}\)/);
    const room = read('public/js/room/room.js');
    assert.match(room, /this\._leaving = true/);
    assert.match(room, /bindMediaSession\(this\)/);
  });

  it('mutes remote call audio locally and leaves ringtones and the mic alone', () => {
    const room = read('public/js/room/room.js');
    assert.match(room, /setCallMuted\(/);
    assert.match(room, /toggleCallAudio\(/);
    assert.match(room, /id: 'r-spk'/);
    assert.match(room, /'Call muted'/);
    assert.match(room, /t\.setVolume\(this\.callMuted \? 0 : 1\)/);
    assert.match(room, /a\.muted = this\.callMuted/);
    // mic path is still toggleMic, not setCallMuted
    assert.match(room, /async toggleMic\(force\)/);
    const tones = read('public/js/messages/tones.js');
    assert.match(tones, /export function startRingtone/);
    assert.doesNotMatch(tones, /callMuted/);
    const chime = read('public/js/room/wsHandlers.js');
    assert.match(chime, /export \{ chime \}/);
    assert.match(read('public/js/room/room.js'), /chime\(/);
  });
});
