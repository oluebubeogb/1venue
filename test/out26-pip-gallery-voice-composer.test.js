'use strict';
const { readFileSync } = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { describe, it } = require('node:test');
const { pathToFileURL } = require('node:url');

const root = path.join(__dirname, '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');

describe('out26 gallery, bubble gap, voice player, STT mic, send button', () => {
  it('parses the changed front-end modules', () => {
    for (const f of [
      'public/js/app-pip.js', 'public/js/composer.js', 'public/js/lightbox.js',
      'public/js/voice-player.js', 'public/js/pages/messages.js',
    ]) {
      const r = spawnSync(process.execPath, ['--check', path.join(root, f)], { encoding: 'utf8' });
      assert.equal(r.status, 0, `${f}: ${r.stderr || r.stdout}`);
    }
  });

  it('bumps the service worker and cache-bust query', () => {
    assert.match(read('public/sw.js'), /VERSION = 'v97-2026-11-26'/);
    assert.match(read('public/index.html'), /app\.css\?v=83/);
    assert.match(read('public/index.html'), /app\.js\?v=83/);
  });

  it('opens chat images in an in-document lightbox with download, and not a new tab', () => {
    const lb = read('public/js/lightbox.js');
    assert.match(lb, /img\.app-pip-att/);
    assert.match(lb, /\.app-pip-msgs/);
    assert.match(lb, /function initLightbox\(doc = document\)/);
    assert.match(lb, /WeakSet/);
    assert.match(lb, /Download/);
    assert.match(lb, /a\.download/);
    const pip = read('public/js/app-pip.js');
    assert.match(pip, /initLightbox\(win\.document\)/);
    assert.match(pip, /class: 'app-pip-att msg-img'/);
    assert.doesNotMatch(pip, /app-pip-att-link/);
    const msg = read('public/js/pages/messages.js');
    assert.match(msg, /class: 'msg-img'/);
  });

  it('keeps own PiP bubbles flush to the right by overlaying the hover toolbar and using a thin scrollbar', () => {
    const css = read('public/css/src/10-components/phase3.css');
    assert.match(css, /max-width: calc\(100% - 4px\)/);
    assert.match(css, /\.app-pip-hover \{[^}]*position: absolute/s);
    assert.match(css, /scrollbar-width: thin/);
    const pip = read('public/js/app-pip.js');
    assert.match(pip, /h\('div', \{ class: 'app-pip-col' \}, bubble, reacts, hover\)/);
  });

  it('traces a real slim() voice-note attachment through the player helpers', async () => {
    const mod = await import(pathToFileURL(path.join(root, 'public/js/voice-player.js')).href);
    const slim = { kind: 'voice', name: 'Voice note', mime: 'audio/webm;codecs=opus', size: 18432, url: '/files/vn_abc123.webm' };
    assert.equal(mod.isVoiceAtt(slim), true);
    assert.match(mod.attUrl(slim), /\/files\/vn_abc123\.webm$/);
    assert.equal(mod.isVoiceAtt({ kind: 'image', mime: 'image/jpeg', url: '/files/p.jpg' }), false);
    assert.equal(mod.isVoiceAtt({ mime: 'audio/webm', url: '/files/x.webm' }), true);
    const pip = read('public/js/app-pip.js');
    assert.match(pip, /hydrateVoicePlayers/);
    assert.match(pip, /voiceSlot\(/);
    assert.match(pip, /root\.ownerDocument/);
    assert.match(read('public/js/voice-player.js'), /data-voice-url/);
    assert.doesNotMatch(pip, /h\('audio', \{ class: 'app-pip-voice', controls: true/);
    const msg = read('public/js/pages/messages.js');
    assert.match(msg, /voicePlayer\(/);
    assert.doesNotMatch(msg, /h\('audio', \{ class: 'msg-voice', controls: true/);
  });

  it('places the STT mic inside the field, shows it only while focused or listening, and uses the site listening colour', () => {
    const comp = read('public/js/composer.js');
    assert.match(comp, /wa-dictate/);
    assert.match(comp, /mousedown.*preventDefault/s);
    assert.match(comp, /no-vmic/);
    assert.match(comp, /paintDictateVis/);
    assert.match(comp, /doc\.activeElement === ta/);
    const css = read('public/css/src/10-components/composer.css');
    assert.match(css, /\.wa-ib\.wa-dictate/);
    assert.match(css, /animation: vmicRing/);
    assert.match(css, /accent-action/);
    const msg = read('public/js/pages/messages.js');
    assert.match(msg, /dictate: true/);
  });

  it('crossfades send and record icons in a fixed-size button without rewriting innerHTML', () => {
    const comp = read('public/js/composer.js');
    assert.match(comp, /wa-act-ic ic-mic/);
    assert.match(comp, /wa-act-ic ic-send/);
    assert.doesNotMatch(comp, /act\.innerHTML = icon\(/);
    const css = read('public/css/src/10-components/composer.css');
    assert.match(css, /\.wa-act \.wa-act-ic/);
    assert.match(css, /\[data-mode="send"\] \.ic-send/);
    assert.doesNotMatch(css, /wa-act\.ready svg/);
    assert.doesNotMatch(css, /@keyframes wa-pop/);
  });
});
