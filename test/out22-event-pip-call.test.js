'use strict';
const { readFileSync } = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { describe, it } = require('node:test');

const root = path.join(__dirname, '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');

describe('out22 event page parse, PiP actions, in-PiP call', () => {
  it('parses event.js (the gift-amount h() is closed)', () => {
    const r = spawnSync(process.execPath, ['--check', path.join(root, 'public/js/pages/event.js')], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr || r.stdout);
    const ev = read('public/js/pages/event.js');
    assert.match(ev, /class: 'gift-amount'/);
    assert.match(ev, /gift-cur-suffix' \}, giftCode\)\)\);/);
    assert.doesNotMatch(ev, /gift-cur-suffix' \}, giftCode\)\);/);
  });

  it('keeps header call/video/meeting icons and drops the second pill row', () => {
    const pip = read('public/js/app-pip.js');
    assert.match(pip, /Start a call/);
    assert.match(pip, /Start a video call/);
    assert.match(pip, /Start a meeting/);
    assert.match(pip, /softBtn\('phone'/);
    assert.match(pip, /softBtn\('video'/);
    assert.match(pip, /softBtn\('calendarPlus'/);
    assert.doesNotMatch(pip, /app-pip-acts/);
    assert.doesNotMatch(pip, /\}, 'Call'\)/);
    assert.doesNotMatch(pip, /\}, 'Video'\)/);
    const css = read('public/css/app.css');
    assert.doesNotMatch(css, /\.app-pip-acts/);
  });

  it('docks the call bar in the PiP window and moves it back when the PiP closes', () => {
    const call = read('public/js/messages/call.js');
    assert.match(call, /export function placeCallUi/);
    assert.match(call, /export function placeAllCallUi/);
    assert.match(call, /documentPictureInPicture/);
    assert.match(call, /pagehide/);
    assert.match(call, /resumeMedia/);
    assert.match(call, /classList\.toggle\('in-pip'/);
    assert.match(call, /placeCallUi\(el\)/);
    assert.doesNotMatch(call, /document\.body\.append\(el\)/);
    assert.match(read('public/js/app-pip.js'), /placeAllCallUi/);
    assert.match(read('public/css/app.css'), /\.call-bar\.in-pip/);
    assert.match(read('public/css/app.css'), /\.call-ring\.in-pip/);
  });

  it('bumps the cache versions', () => {
    assert.match(read('public/sw.js'), /VERSION = 'v97-2026-11-26'/);
    assert.match(read('public/index.html'), /app\.css\?v=83/);
    assert.match(read('public/index.html'), /app\.js\?v=83/);
  });
});
