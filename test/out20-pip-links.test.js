'use strict';
const { readFileSync } = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { describe, it } = require('node:test');

const root = path.join(__dirname, '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');

describe('out20 pip theme, chat actions, links, google, events', () => {
  it('copies site theme into the PiP and keeps it in sync', () => {
    const pip = read('public/js/app-pip.js');
    assert.match(pip, /function applyTheme/);
    assert.match(pip, /function copyStyles/);
    assert.match(pip, /function watchTheme/);
    assert.match(pip, /dataset\.theme/);
    assert.match(pip, /style\.cssText/);
    assert.match(pip, /new URL\('\+',? *location\.href\)|new URL\('\/', location\.href\)/);
    assert.match(pip, /clone\.href = absUrl/);
    assert.match(pip, /MutationObserver/);
    assert.match(pip, /addEventListener\('prefs'/);
    const css = read('public/css/src/10-components/phase3.css');
    assert.match(css, /\.app-pip \{[^}]*background: var\(--bg\)/);
    assert.match(css, /\.pip-tab\.on \{[^}]*var\(--accent\)/);
    assert.doesNotMatch(css, /#1a2340|#0b1020/);
  });

  it('adds a + for new messages and instant meetings, and call/meeting in a thread', () => {
    const pip = read('public/js/app-pip.js');
    assert.match(pip, /plusAction/);
    assert.match(pip, /openInstantOverlay/);
    assert.match(pip, /\/api\/messages\/new/);
    assert.match(pip, /Username or email/);
    assert.match(pip, /startCallFor/);
    assert.match(pip, /startMeetingFor/);
    assert.match(pip, /venue\.intent/);
    assert.match(pip, /Start a call/);
    assert.match(pip, /Start a meeting/);
    assert.doesNotMatch(pip, /win\.close\(\); navigate\(c\.id/);
  });

  it('styles chat links with accent colour and no underline', () => {
    const css = read('public/css/src/10-components/phase3.css') + read('public/css/src/20-pages/messages.css') + read('public/css/room.css');
    assert.match(css, /a\.msg-link/);
    assert.match(css, /\.msg-txt a/);
    assert.match(css, /\.bubble \.txt a/);
    assert.match(css, /\.app-pip-bubble a/);
    assert.match(css, /text-decoration:\s*none/);
    // own-bubble links stay distinct from body text
    assert.match(css, /msg-row\.mine .msg-bubble a[\s\S]*color-mix/);
    assert.match(css, /\.msg\.mine \.bubble a[\s\S]*color-mix/);
    // no underline on these chat-link rules
    const chat = css.match(/a\.msg-link[\s\S]{0,400}text-decoration:\s*([^;]+)/);
    assert.ok(chat && chat[1].includes('none'));
  });

  it('linkifies http(s) and www URLs, strips trailing punctuation, and opens a new tab', async () => {
    const { linkify } = await import('../public/js/ui.js');
    const html = linkify('See www.example.com/a, and https://1venue.live/e/demo.');
    assert.match(html, /class="msg-link"/);
    assert.match(html, /href="https:\/\/www\.example\.com\/a"/);
    assert.match(html, /href="https:\/\/1venue\.live\/e\/demo"/);
    assert.match(html, /target="_blank"/);
    assert.match(html, /rel="noopener noreferrer"/);
    assert.match(html, /example\.com\/a<\/a>,/);
    assert.match(html, /demo<\/a>\./);
    const mentioned = linkify('hi @ada', { mentions: true });
    assert.match(mentioned, /<b class="mention">@ada<\/b>/);
  });

  it('parses event tags, theme and settings whether they arrive as objects or JSON strings', () => {
    const { eventOut } = require('../src/features/events/data');
    const ev = eventOut({
      id: 1, slug: 'demo', code: 'abc123', title: 'Python for Beginners: Week 3',
      tags: '["python","beginners"]', theme: '{"accent":"#2563eb"}', settings: '{"certs":{"enabled":true}}',
      host_user_id: 2, host_name: 'Host', speaker_seats: 4,
    });
    assert.deepEqual(ev.tags, ['python', 'beginners']);
    assert.equal(ev.theme.accent, '#2563eb');
    assert.equal(ev.settings.certs.enabled, true);
    const ev2 = eventOut({
      id: 2, slug: 'demo-2', code: 'abc124', title: 'Talk',
      tags: ['live'], theme: { accent: '#111111' }, settings: {},
      host_user_id: 2, host_name: 'Host', speaker_seats: 4,
    });
    assert.deepEqual(ev2.tags, ['live']);
    const ev3 = eventOut({
      id: 3, slug: 'demo-3', code: 'abc125', title: 'Talk',
      tags: 'not-json,ok', theme: 'nope', settings: 'nope',
      host_user_id: 2, host_name: 'Host', speaker_seats: 4,
    });
    assert.ok(Array.isArray(ev3.tags));
    assert.equal(typeof ev3.theme, 'object');
    assert.equal(typeof ev3.settings, 'object');
    assert.match(read('public/js/pages/event.js'), /Array\.isArray\(ev\.tags\)/);
  });

  it('keeps Google auth flags on /api/config when later fields fail', () => {
    const src = read('src/core/auth-routes.js');
    assert.match(src, /Auth flags are computed first/);
    assert.match(src, /const auth = \{/);
    assert.match(src, /google: !!google\.enabled\(\)/);
    assert.match(src, /safe\(\(\) => require\('\.\.\/venue\/ai'\)\.status\(\)/);
    const login = read('public/js/pages/login.js');
    assert.match(login, /Continue with Google/);
    assert.match(login, /state\.config\?\.auth/);
  });

  it('bumps the cache versions', () => {
    assert.match(read('public/sw.js'), /VERSION = 'v97-2026-11-26'/);
    assert.match(read('public/index.html'), /app\.css\?v=83/);
    assert.match(read('public/index.html'), /app\.js\?v=83/);
    assert.match(read('public/index.html'), /room\.css\?v=21/);
  });
});
