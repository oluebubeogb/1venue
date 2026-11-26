'use strict';
const { readFileSync } = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { describe, it } = require('node:test');

const root = path.join(__dirname, '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');

describe('out24 verified badge, meeting focus, unread type, tone, pinned Notification', () => {
  it('parses the changed front-end modules', () => {
    for (const f of [
      'public/js/app-pip.js', 'public/js/instant.js', 'public/js/bring-main.js',
      'public/js/messages/live.js', 'public/js/messages/tones.js', 'public/js/messages/call.js',
      'public/js/pages/messages.js', 'public/js/app.js',
    ]) {
      const r = spawnSync(process.execPath, ['--check', path.join(root, f)], { encoding: 'utf8' });
      assert.equal(r.status, 0, `${f}: ${r.stderr || r.stdout}`);
    }
  });

  it('keeps the verified badge attached to the name in the PiP and main Messages views', () => {
    const pip = read('public/js/app-pip.js');
    assert.match(pip, /class: 'who-name'/);
    assert.match(pip, /verifiedDot\(c\.peer/);
    assert.match(pip, /pinMark\(c\)/);
    const msg = read('public/js/pages/messages.js');
    assert.match(msg, /class: 'msg-item-who who-name'/);
    assert.match(msg, /class: 'who-name'/);
    const css = read('public/css/src/00-base/40-utilities.css') + read('public/css/src/10-components/phase3.css') + read('public/css/src/20-pages/messages.css');
    assert.match(css, /\.who-name \{/);
    assert.match(css, /\.who-name \.verified-dot/);
    assert.doesNotMatch(read('public/css/src/10-components/phase3.css'), /\.app-pip-row-top \.ellipsis \{ flex: 1/);
  });

  it('opens instant meeting setup in the PiP and focuses the main tab as a fallback', () => {
    const pip = read('public/js/app-pip.js');
    assert.match(pip, /openInstant\(\{ doc: pipDoc, name, thread: conv\.id \}\)/);
    assert.match(pip, /openInstantOverlay\(\{ doc: win\.document \}\)/);
    assert.match(pip, /bringMainToFront\(pipDoc\)/);
    const inst = read('public/js/instant.js');
    assert.match(inst, /openInstant\(\{ onClose, doc, name, thread \}/);
    assert.match(inst, /mount\.append\(scrim, modal\)/);
    assert.match(inst, /bringMainToFront\(owner\)/);
    const bring = read('public/js/bring-main.js');
    assert.match(bring, /window\.focus\(\)/);
    assert.match(bring, /Continue in the 1venue tab/);
    assert.match(bring, /document\.title/);
    const call = read('public/js/messages/call.js');
    assert.match(call, /bringMainToFront/);
  });

  it('uses the site font and a light weight for unread names and previews', () => {
    const pipCss = read('public/css/src/10-components/phase3.css');
    assert.doesNotMatch(pipCss, /\.app-pip-row\.unread b \{ font-weight: 800/);
    assert.match(pipCss, /\.app-pip-row\.unread b \{ font-weight: 600/);
    assert.match(pipCss, /\.app-pip-row\.unread \.app-pip-row-sub \{ font-weight: 500/);
    assert.match(pipCss, /font-family: inherit/);
    const msgCss = read('public/css/src/20-pages/messages.css');
    assert.match(msgCss, /\.msg-item\.unread b, \.page-messages \.msg-item\.unread \.msg-item-bot > span\.ellipsis \{ font-family: inherit/);
    assert.match(msgCss, /\.msg-item\.unread \.msg-item-top b \{ color: var\(--text\); font-weight: 600/);
    assert.match(msgCss, /\.msg-item\.unread \.msg-item-bot > span\.ellipsis \{ color: var\(--text\); font-weight: 500/);
  });

  it('plays the incoming message tone even when that chat is already open, with a 1.5s throttle', () => {
    const live = read('public/js/messages/live.js');
    assert.match(live, /playMessageTone/);
    assert.doesNotMatch(live, /if \(!mine && !\(surfaceVisible\(\) && watching\(m\.conversationId\)\)\) \{[\s\S]*playMessageTone/);
    assert.match(live, /m\.message\.kind !== 'call' && m\.message\.kind !== 'system' && !m\.muted/);
    const tones = read('public/js/messages/tones.js');
    assert.match(tones, /Date\.now\(\) - lastMsg < 1500/);
    assert.match(tones, /documentPictureInPicture/);
    assert.match(tones, /export function unlockTones/);
    const pip = read('public/js/app-pip.js');
    assert.match(pip, /unlockTones/);
  });

  it('pins the Notification conversation at the top of the PiP list, including after live updates', () => {
    const pip = read('public/js/app-pip.js');
    assert.match(pip, /function isNotifyConv/);
    assert.match(pip, /user === 'notification'/);
    assert.match(pip, /peer\.system || peer\.isSystem/);
    assert.match(pip, /function pinFirst/);
    assert.match(pip, /convList = pinFirst\(/);
    assert.match(pip, /icon\('pin'/);
    assert.match(pip, /app-pip-pin/);
    const css = read('public/css/src/10-components/phase3.css');
    assert.match(css, /\.app-pip-pin/);
  });

  it('bumps the cache versions', () => {
    assert.match(read('public/sw.js'), /VERSION = 'v97-2026-11-26'/);
    assert.match(read('public/index.html'), /app\.css\?v=83/);
    assert.match(read('public/index.html'), /app\.js\?v=83/);
  });
});
