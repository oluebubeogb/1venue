'use strict';
const { readFileSync } = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { describe, it } = require('node:test');

const root = path.join(__dirname, '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const check = (f) => {
  const r = spawnSync(process.execPath, ['--check', path.join(root, f)], { encoding: 'utf8' });
  assert.equal(r.status, 0, `${f}: ${r.stderr || r.stdout}`);
};

describe('O pops out and returns to the tab', () => {
  it('parses the changed front-end modules', () => {
    for (const f of [
      'public/js/pip-hotkey.js',
      'public/js/app.js',
      'public/js/app-pip.js',
      'public/js/room/session.js',
      'public/js/room/room.js',
      'public/js/room/tools.js',
    ]) check(f);
  });

  it('bumps the service worker and cache-bust query', () => {
    assert.match(read('public/sw.js'), /VERSION = 'v97-2026-11-26'/);
    assert.match(read('public/index.html'), /app\.css\?v=83/);
    assert.match(read('public/index.html'), /app\.js\?v=83/);
  });

  it('registers a capture keydown for O, skips typing, and requests the window in the same turn', () => {
    const hot = read('public/js/pip-hotkey.js');
    assert.match(hot, /addEventListener\('keydown'/);
    assert.match(hot, /true\)/);
    assert.match(hot, /toLowerCase\(\) === 'o'/);
    assert.match(hot, /isComposing/);
    assert.match(hot, /keyCode === 229/);
    assert.match(hot, /tag === 'INPUT'/);
    assert.match(hot, /TEXTAREA/);
    assert.match(hot, /SELECT/);
    assert.match(hot, /isContentEditable/);
    assert.match(hot, /metaKey \|\| e\.ctrlKey \|\| e\.altKey/);
    assert.match(hot, /requestWindow/);
    assert.match(hot, /startAutoPip\(room, 'shortcut'\)/);
    assert.match(hot, /returnToMeeting\(pipDoc\)/);
    const app = read('public/js/app.js');
    assert.match(app, /installPipHotkey\(document\)/);
    assert.match(app, /id: 'popout'/);
    assert.match(app, /kbd: 'O'/);
    assert.match(app, /\['O', 'Pop out \/ back to tab'\]/);
  });

  it('wires the room command and leaves O out of the room shortcut map', () => {
    const room = read('public/js/room/room.js');
    assert.match(room, /id: 'r-pip'[^]*kbd: 'O'/);
    assert.match(room, /popOutMeeting\(\)/);
    assert.match(room, /if \(k === 'o'\) return;/);
    assert.doesNotMatch(room, /map = \{[^}]*\bo:/);
    const tools = read('public/js/room/tools.js');
    assert.match(tools, /\['O', 'Pop out \/ back to tab'\]/);
    const session = read('public/js/room/session.js');
    assert.match(session, /installPipHotkey\(doc, \{ inPip: true \}\)/);
    const pip = read('public/js/app-pip.js');
    assert.match(pip, /export async function popOut\(existing\)/);
    assert.match(pip, /installPipHotkey\(win\.document, \{ inPip: true \}\)/);
  });
});
