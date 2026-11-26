'use strict';
const { readFileSync } = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { describe, it } = require('node:test');

const root = path.join(__dirname, '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');

describe('out23 PiP avatars, composer, live, search', () => {
  it('parses the changed front-end modules', () => {
    for (const f of [
      'public/js/app-pip.js', 'public/js/composer.js', 'public/js/messages/live.js',
      'public/js/pages/messages.js', 'public/js/ui.js', 'public/js/emoji.js',
    ]) {
      const r = spawnSync(process.execPath, ['--check', path.join(root, f)], { encoding: 'utf8' });
      assert.equal(r.status, 0, `${f}: ${r.stderr || r.stdout}`);
    }
  });

  it('uses an icon-only Chats / Meeting / New message bar, no Notifications tab', () => {
    const pip = read('public/js/app-pip.js');
    assert.match(pip, /tabBtn\('chats', 'Chats'/);
    assert.match(pip, /tabBtn\('meeting', 'Meeting'/);
    assert.match(pip, /softBtn\('plus', 'New message'/);
    assert.doesNotMatch(pip, /tabBtn\('notifications'/);
    assert.match(pip, /title: label/);
    const css = read('public/css/src/10-components/phase3.css');
    assert.match(css, /pip-soft/);
    assert.match(css, /color-mix\(in srgb, var\(--text\) 8%, var\(--s2\)\)/);
  });

  it('shows avatars in the list, thread header, and group-message first-of-run only', () => {
    const pip = read('public/js/app-pip.js');
    assert.match(pip, /function pipAvatar/);
    assert.match(pip, /function convAvatar/);
    assert.match(pip, /convAvatar\(c, 'sm'\)/);
    assert.match(pip, /showName = !m\.mine && c\.type !== 'dm' && !grouped/);
    assert.match(pip, /memberAv\(/);
    assert.match(pip, /new URL\((src|url|href), document\.baseURI\)/);
    const ui = read('public/js/ui.js');
    assert.match(ui, /new URL\(src, document\.baseURI\)/);
  });

  it('fixes PiP scroll: flex column, message list scrolls, composer is a fixed footer', () => {
    const css = read('public/css/src/10-components/phase3.css') + read('public/css/app.css');
    assert.match(css, /\.app-pip \{[^}]*height: 100%/);
    assert.match(css, /\.app-pip-body \{[^}]*overflow: hidden/);
    assert.match(css, /\.app-pip-msgs \{[^}]*overflow: auto/);
    assert.match(css, /overscroll-behavior:\s*contain/);
    assert.match(css, /\.app-pip-foot \{[^}]*flex:\s*none/);
  });

  it('reuses the main pill composer with dictation, voice notes, attachments and an icon send', () => {
    const pip = read('public/js/app-pip.js');
    assert.match(pip, /pillComposer\(/);
    assert.match(pip, /dictate:\s*true/);
    assert.match(pip, /voice:\s*true/);
    assert.match(pip, /uploadFile/);
    const comp = read('public/js/composer.js');
    assert.match(comp, /dictate = false/);
    assert.match(comp, /onActivity/);
    assert.match(comp, /listenOn\(ta/);
    assert.match(comp, /onActivity && onActivity\('recording'\)/);
  });

  it('updates the PiP list and open thread from the live socket, with unread badges', () => {
    const pip = read('public/js/app-pip.js');
    assert.match(pip, /setPipConversation/);
    assert.match(pip, /on\('message'/);
    assert.match(pip, /bumpList/);
    assert.match(pip, /markThreadRead/);
    assert.match(pip, /app-pip-count/);
    const live = read('public/js/messages/live.js');
    assert.match(live, /export function setPipConversation/);
    assert.match(live, /pipOpen\(\)/);
    assert.match(live, /watching\(/);
  });

  it('shows typing and recording indicators in the main window and the PiP', () => {
    const msg = read('public/js/pages/messages.js');
    assert.match(msg, /recording voice…/);
    assert.match(msg, /m\.state === 'recording'/);
    assert.match(msg, /onActivity:/);
    const pip = read('public/js/app-pip.js');
    assert.match(pip, /recording voice…/);
    assert.match(pip, /on\('typing'/);
    const sock = read('src/features/messages/socket.js');
    assert.match(sock, /msg\.type === 'recording'/);
    const svc = read('src/features/messages/service.js');
    assert.match(svc, /async function relayTyping\(me, convId, state = 'typing'\)/);
  });

  it('searches people and messages together with token AND then OR', () => {
    const pip = read('public/js/app-pip.js');
    assert.match(pip, /\/api\/messages\/search/);
    assert.match(pip, /\/api\/users\/search/);
    assert.match(pip, /section\('People'\)/);
    assert.match(pip, /section\('Messages'\)/);
    assert.match(pip, /openThread\(r\.conversationId, m\.id\)/);
    const search = read('src/features/messages/power.js');
    assert.match(search, /sender_name/);
    assert.match(search, /filters\('OR'\)/);
  });

  it('bumps the cache versions', () => {
    assert.match(read('public/sw.js'), /VERSION = 'v97-2026-11-26'/);
    assert.match(read('public/index.html'), /app\.css\?v=83/);
    assert.match(read('public/index.html'), /app\.js\?v=83/);
  });
});
