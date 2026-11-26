'use strict';
const { readFileSync } = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { describe, it } = require('node:test');

const root = path.join(__dirname, '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');

describe('out29 pop-out unread badge and in-flow call row', () => {
  it('parses the changed front-end modules', () => {
    for (const f of ['public/js/app-pip.js', 'public/js/messages/call.js']) {
      const r = spawnSync(process.execPath, ['--check', path.join(root, f)], { encoding: 'utf8' });
      assert.equal(r.status, 0, `${f}: ${r.stderr || r.stdout}`);
    }
  });

  it('bumps the service worker and cache-bust query', () => {
    assert.match(read('public/sw.js'), /VERSION = 'v97-2026-11-26'/);
    assert.match(read('public/index.html'), /app\.css\?v=83/);
    assert.match(read('public/index.html'), /app\.js\?v=83/);
  });

  it('badges the Chats tab with live unread, excluding muted, archived and the open thread', () => {
    const pip = read('public/js/app-pip.js');
    assert.match(pip, /function pipUnreadTotal\(/);
    assert.match(pip, /c\.muted \|\| c\.archived/);
    assert.match(pip, /openId != null && Number\(c\.id\) === openId/);
    assert.match(pip, /n > 99 \? '99\+' : String\(n\)/);
    assert.match(pip, /class: 'app-pip-tab-count'/);
    assert.match(pip, /tabBtn\('chats', 'Chats', 'messages', unreadBadge\(pipUnreadTotal\(\)\)\)/);
    assert.match(pip, /on\('unread', \(r\) => \{ applyUnreadMap\(r && r\.conversations\); paintBar\(\); \}\)/);
    assert.match(pip, /if \(!mine && !open && !m\.muted && !c\.muted && !c\.archived\) c\.unread/);
    assert.match(pip, /paintBar\(\);\s*\n\s*if \(current === 'chats' && !sub\)/s);
    assert.match(pip, /if \(c\) c\.unread = 0;\s*\n\s*paintBar\(\);/s);
    const css = read('public/css/src/10-components/phase3.css');
    assert.match(css, /\.app-pip-tab-count/);
  });

  it('places incoming and active call UI in a top in-flow slot, not docked over the composer', () => {
    const pip = read('public/js/app-pip.js');
    assert.match(pip, /class: 'app-pip-call'/);
    assert.match(pip, /root\.append\(callSlot, bar, body\)/);
    const call = read('public/js/messages/call.js');
    assert.match(call, /document\.querySelector\('\.app-pip-call'\)/);
    assert.match(call, /host\.classList\.contains\('app-pip-call'\)/);
    assert.match(call, /if \(pipWin\(\)\) return null;/);
    assert.match(call, /resumeMedia\(el\)/);
    const src = read('public/css/src/10-components/call.css');
    const built = read('public/css/app.css');
    for (const css of [src, built]) {
      assert.match(css, /\.call-bar\.in-pip/);
      assert.match(css, /\.call-ring\.in-pip/);
      assert.match(css, /position:\s*relative/);
      assert.doesNotMatch(css, /\.call-bar\.in-pip[^{]*\{[^}]*bottom:\s*8px/s);
      assert.doesNotMatch(css, /\.call-ring\.in-pip[^{]*\{[^}]*top:\s*8px/s);
    }
    const phase = read('public/css/src/10-components/phase3.css');
    assert.match(phase, /\.app-pip-call \{/);
    assert.match(phase, /\.app-pip-call:empty/);
    assert.match(phase, /\.app-pip-body \{ flex: 1; min-height: 0;/);
  });
});
