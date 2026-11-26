'use strict';
const { readFileSync } = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { describe, it } = require('node:test');

const root = path.join(__dirname, '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');

describe('out25 PiP search/composer/media, scripture search, captions, auto-record, theme ink', () => {
  it('parses the changed front-end modules', () => {
    for (const f of [
      'public/js/app-pip.js', 'public/js/composer.js', 'public/js/ui.js',
      'public/js/pages/bible.js', 'public/js/pages/settings.js', 'public/js/pages/messages.js',
      'public/js/app.js', 'public/js/room/captions.js', 'public/js/room/recorder.js',
      'public/js/room/room.js', 'public/js/room/wsHandlers.js', 'public/js/room/tools.js',
      'public/js/appearance.mjs',
    ]) {
      const r = spawnSync(process.execPath, ['--check', path.join(root, f)], { encoding: 'utf8' });
      assert.equal(r.status, 0, `${f}: ${r.stderr || r.stdout}`);
    }
  });

  it('puts the PiP search icon inside the bordered field', () => {
    const pip = read('public/js/app-pip.js');
    assert.match(pip, /app-pip-search-box/);
    assert.doesNotMatch(pip, /h\('div', \{ class: 'app-pip-search' \}, h\('span', \{ class: 'i'/);
    const css = read('public/css/src/10-components/phase3.css');
    assert.match(css, /\.app-pip-search-box \{/);
    assert.match(css, /border: 1px solid var\(--line\)/);
  });

  it('moves PiP voice typing to the end of the input, smaller, with a listening pulse, and opens the file picker in the PiP document', () => {
    const comp = read('public/js/composer.js');
    assert.match(comp, /dictateEnd/);
    assert.match(comp, /function pickFile/);
    assert.match(comp, /pill\.ownerDocument/);
    assert.match(comp, /doc\.createElement\('input'\)/);
    assert.match(comp, /classList\.toggle\('listening', dictating\)/);
    const pip = read('public/js/app-pip.js');
    assert.match(pip, /dictateEnd:\s*true/);
    const css = read('public/css/src/10-components/composer.css');
    assert.match(css, /wa-listen/);
    assert.match(css, /\.wa-ib\.listening/);
  });

  it('adds a visible Bible and Qur’an search button and submits on Enter, form submit, and change', () => {
    const bible = read('public/js/pages/bible.js');
    assert.match(bible, /enterkeyhint: 'search'/);
    assert.match(bible, /class: 'bt-go'/);
    assert.match(bible, /type: 'submit'/);
    assert.match(bible, /addEventListener\('change', runSearch\)/);
    assert.match(bible, /class: 'bible-tools card layer', role: 'search'/);
    const css = read('public/css/src/20-pages/bible.css');
    assert.match(css, /\.bible-tools \.bt-search/);
    assert.match(css, /\.bible-tools \.bt-go/);
  });

  it('renders PiP images, files and voice notes with absolute URLs and scrolls to the last message', () => {
    const pip = read('public/js/app-pip.js');
    assert.match(pip, /function scrollEnd/);
    assert.match(pip, /app-pip-voice-wrap/);
    assert.match(pip, /app-pip-file/);
    assert.match(pip, /target: '_blank'/);
    assert.match(pip, /absUrl\(a\.url\)/);
    const msg = read('public/js/pages/messages.js');
    assert.match(msg, /querySelectorAll\('img, audio, video'\)/);
  });

  it('adds WhatsApp-style reply, hover actions and a viewport-clamped menu in the PiP and main window', () => {
    const pip = read('public/js/app-pip.js');
    assert.match(pip, /app-pip-hover/);
    assert.match(pip, /startReply/);
    assert.match(pip, /replyToId/);
    assert.match(pip, /QUICK\.slice\(0, 6\)/);
    assert.match(pip, /icon\('moreHorizontal'/);
    assert.match(pip, /bindSwipe/);
    const ui = read('public/js/ui.js');
    assert.match(ui, /anchor && anchor\.ownerDocument/);
    assert.match(ui, /win\.innerWidth, win\.innerHeight/);
  });

  it('keeps meeting STT auto-running, hides the overlay by default, and adds settings plus an in-meeting CC toggle', () => {
    const cap = read('public/js/room/captions.js');
    assert.match(cap, /const want = !this\.optOut && supported && R\.isSpeaker\(R\.me\.id\) && !!R\.media/);
    const room = read('public/js/room/room.js');
    assert.match(room, /extraPref\('showMeetingCaptions'/);
    assert.match(room, /setShowCaptions/);
    assert.match(room, /Show captions overlay/);
    const set = read('public/js/pages/settings.js');
    assert.match(set, /Show live captions in meetings/);
    assert.match(set, /setExtraPref\('showMeetingCaptions'/);
  });

  it('auto-records on the host and every co-host device, with one Recording indicator and a Stop & save control', () => {
    const rec = read('public/js/room/recorder.js');
    assert.match(rec, /async startLocal/);
    assert.match(rec, /captureStream/);
    assert.match(rec, /trySave/);
    const room = read('public/js/room/room.js');
    assert.match(room, /maybeAutoRecord/);
    assert.match(room, /isMod\(\)/);
    assert.match(room, /announceRecording/);
    assert.match(room, /anyoneRecording/);
    assert.match(room, /'Recording'/);
    assert.match(room, /Stop & save recording/);
    const set = read('public/js/pages/settings.js');
    assert.match(set, /autoRecordMeetings/);
    const ws = read('src/features/captions/ws.js');
    assert.match(ws, /local-recording/);
  });

  it('forces white content on theme/accent backgrounds', () => {
    const ink = read('public/js/appearance.mjs');
    assert.match(ink, /return '#fff'/);
    assert.doesNotMatch(ink, /#0f172a/);
    const css = read('public/css/src/00-base/40-utilities.css');
    assert.match(css, /color: #fff/);
    assert.match(css, /\.page-messages \.msg-row\.mine \.msg-bubble/);
  });

  it('bumps the cache versions', () => {
    assert.match(read('public/sw.js'), /VERSION = 'v97-2026-11-26'/);
    assert.match(read('public/index.html'), /app\.css\?v=83/);
    assert.match(read('public/index.html'), /app\.js\?v=83/);
  });
});
