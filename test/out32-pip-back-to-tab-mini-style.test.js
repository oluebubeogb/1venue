'use strict';
const { readFileSync } = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const vm = require('node:vm');
const { describe, it } = require('node:test');

const root = path.join(__dirname, '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');

function pipRuntime(videos) {
  const root = {};
  const document = { pictureInPictureEnabled: true, getElementById: () => ({ contains: () => true }) };
  const ctx = {
    document, fmtCode: (code) => code, setTimeout, clearTimeout,
    documentPictureInPicture: { requestWindow: () => assert.fail('mobile should request video PiP directly') },
  };
  const source = read('public/js/room/session.js').replace(/^import .*$/gm, '').replace(/^export /gm, '');
  vm.runInNewContext(source, ctx);
  const room = { root, isMobile: true, alive: true, inRoom: true, code: 'pip123', me: { id: 'me' }, stageR: { el: { querySelectorAll: () => videos } } };
  ctx._testSetLive(room);
  return { ctx, document, room };
}

function pipVideo(id, { screen = false, enabled = true } = {}) {
  const video = new EventTarget();
  Object.assign(video, {
    readyState: 1, videoWidth: 320,
    srcObject: { getVideoTracks: () => [{ readyState: 'live', enabled }] },
    closest: (selector) => selector === '.tile' ? { dataset: { id } } : screen && selector.includes('.tile.screen'),
  });
  return video;
}

describe('native PiP back-to-tab and styled mini call bar', () => {
  it('parses the changed front-end modules', () => {
    const f = 'public/js/room/session.js';
    const r = spawnSync(process.execPath, ['--check', path.join(root, f)], { encoding: 'utf8' });
    assert.equal(r.status, 0, `${f}: ${r.stderr || r.stdout}`);
  });

  it('bumps the service worker and cache-bust query', () => {
    assert.match(read('public/sw.js'), /VERSION = 'v97-2026-11-26'/);
    assert.match(read('public/index.html'), /app\.css\?v=83/);
    assert.match(read('public/index.html'), /app\.js\?v=83/);
  });

  it('treats a parked PiP close on a focused tab as return-to-meeting, not the mini bar', () => {
    const session = read('public/js/room/session.js');
    assert.match(session, /addEventListener\('pagehide'/);
    assert.match(session, /onPipClosed\(room\)/);
    assert.match(session, /function onPipClosed/);
    assert.match(session, /pip-close: back-to-tab/);
    assert.match(session, /returnToMeeting\(\)/);
    assert.match(session, /pip-close: close-x/);
    assert.match(session, /showMini\(room\)/);
    const closeFn = session.slice(session.indexOf('function onPipClosed'), session.indexOf('function copyStyles'));
    assert.match(closeFn, /returnToMeeting\(\)/);
    assert.match(closeFn, /visibilityState === 'visible'/);
    assert.match(closeFn, /showMini\(room\)/);
    // The previous pagehide path always showed the mini bar when parked.
    const hideStart = session.indexOf("addEventListener('pagehide'");
    const hide = session.slice(hideStart, session.indexOf('});', hideStart) + 3);
    assert.match(hide, /onPipClosed\(room\)/);
    assert.doesNotMatch(hide, /showMini/);
  });

  it('drops the green status dot and uses grey chips except for hang-up', () => {
    const session = read('public/js/room/session.js');
    assert.doesNotMatch(session, /lcb-dot/);
    assert.doesNotMatch(session, /mk\([^)]*'primary'\)/);
    assert.match(session, /mk\('login', 'Back to tab'/);
    assert.match(session, /mk\('phoneOff', 'Leave'[^]*'danger'\)/);
    const phase = read('public/css/src/10-components/phase3.css');
    assert.doesNotMatch(phase, /lcb-dot/);
    assert.doesNotMatch(phase, /button\.primary/);
    assert.match(phase, /\.live-call-mini \.lcb-btns button/);
    assert.match(phase, /appearance:\s*none/);
    assert.match(phase, /button\.danger/);
    const app = read('public/css/app.css');
    assert.match(app, /\.live-call-mini/);
    assert.match(app, /\.live-call-mini \.lcb-btns button/);
    assert.match(app, /appearance:\s*none/);
    assert.doesNotMatch(app, /\.live-call-bar \.lcb-dot/);
    assert.doesNotMatch(app, /\.lcb-btns button\.primary/);
  });

  it('gives the in-page mini bar the same live-call-bar class so chip styles apply everywhere', () => {
    const session = read('public/js/room/session.js');
    assert.match(session, /class: 'live-call-mini live-call-bar'/);
    assert.match(session, /closeMini\(\);\n  const url/);
  });

  it('opens the live shared screen directly on the mobile tap and clears native PiP on close', async () => {
    const self = pipVideo('me');
    const remote = pipVideo('speaker');
    const screen = pipVideo('sharer', { screen: true });
    const stale = pipVideo('old-screen', { screen: true, enabled: false });
    const { ctx, document, room } = pipRuntime([self, remote, stale, screen]);
    const requested = [];
    for (const video of [self, remote, stale, screen]) {
      video.requestPictureInPicture = async () => {
        requested.push(video);
        document.pictureInPictureElement = video;
      };
    }
    const opening = ctx.startAutoPip(room, 'command');
    assert.deepEqual(requested, [screen], 'the video API must run in the same turn as the tap');
    document.getElementById = (id) => id === 'view' ? { contains: () => true } : null;
    assert.equal(await opening, 'video');
    document.pictureInPictureElement = null;
    screen.dispatchEvent(new Event('leavepictureinpicture'));
    assert.equal(ctx.getLive().videoPip, null);
  });

  it('waits for the WebKit mode change and offers mini controls after a parked PiP closes', async () => {
    const self = pipVideo('me');
    const remote = pipVideo('speaker');
    const { ctx, document, room } = pipRuntime([self, remote]);
    let parked = false;
    let mini = false;
    document.getElementById = (id) => id === 'view' ? { contains: () => !parked } : null;
    ctx.showMini = () => { mini = parked; return mini; };
    remote.requestPictureInPicture = () => assert.fail('should use WebKit directly when it supports video PiP');
    remote.webkitPresentationMode = 'inline';
    remote.webkitSupportsPresentationMode = () => true;
    const requests = [];
    remote.webkitSetPresentationMode = (mode) => {
      requests.push(mode);
      queueMicrotask(() => {
        remote.webkitPresentationMode = mode;
        remote.dispatchEvent(new Event('webkitpresentationmodechanged'));
      });
    };
    const opening = ctx.startAutoPip(room, 'command');
    assert.deepEqual(requests, ['picture-in-picture']);
    assert.equal(await opening, 'video');
    parked = true;
    remote.webkitSetPresentationMode('inline');
    await Promise.resolve();
    assert.equal(ctx.getLive().videoPip, null);
    assert.equal(mini, true);
  });
});
