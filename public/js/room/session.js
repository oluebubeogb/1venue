/** Keep a joined meeting alive across SPA navigations, auto pop-out, and a local call-audio mute. */
import { h } from '../ui.js';
import { icon } from '../icons.js';
import { fmtCode } from './intent.js';

let live = null;
let shell = { setRoomMode() {} };
let pendingWin = null;
let noGesture = false;
let guardsOn = false;

export function bindShell(s) { if (s) shell = { ...shell, ...s }; }
export function getLive() { return live; }
export function liveUrl(room) { return '/' + fmtCode((room && room.code) || (live && live.code) || ''); }
export function trackLiveMeeting(room) {
  if (live?.room === room) return;
  if (live?.room) {
    try { live.room.destroy(); } catch { /* A stale room must not block the new one. */ }
  }
  live = { room, code: room.code, url: liveUrl(room), autoPip: null };
}
export function isLiveMeeting(room) {
  const r = room || (live && live.room);
  return !!(r && r.alive && r.inRoom && r.root && !r._leaving);
}
export function canResume(params) {
  if (!live || !live.room || !live.room.alive || !live.room.inRoom) return false;
  const code = params && params.code ? fmtCode(params.code) : '';
  return !!(code && fmtCode(live.code) === code);
}
export function isMeetingDest(dest) {
  if (!dest || !isLiveMeeting()) return false;
  const path = String(dest).split('#')[0].split('?')[0].replace(/\/$/, '') || '/';
  return fmtCode(path) === fmtCode(live.code || (live.room && live.room.code));
}

export function pageApi(room) {
  return {
    unmount() { room.destroy(); },
    canParkLive() { return isLiveMeeting(room); },
    parkLive() { return park(room); },
  };
}

export function holder() {
  let el = document.getElementById('live-meeting-hold');
  if (!el) {
    el = h('div', { id: 'live-meeting-hold', 'aria-hidden': 'true' });
    document.body.append(el);
  }
  return el;
}

function dbg(...args) { try { console.debug('[auto-pip]', ...args); } catch { /* */ } }

export function destFromClick(e) {
  if (!e || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || (e.button && e.button !== 0)) return null;
  const t = e.target;
  const a = t && t.closest ? t.closest('a[href]') : null;
  if (!a || a.target) return null;
  if (a.hasAttribute && a.hasAttribute('download')) return null;
  let url;
  try { url = new URL(a.getAttribute('href') || a.href, location.href); } catch { return null; }
  if (url.origin !== location.origin) return null;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/files/') || url.pathname.startsWith('/auth/')) return null;
  if (/^\/(privacy|terms)(\.html)?\/?$/.test(url.pathname)) return null;
  return url.pathname + url.search + url.hash;
}

/** Call requestWindow in the same turn as the user gesture. Never await before this. */
export function primeAutoPip(reason, dest) {
  dbg(reason, dest || '');
  if (!isLiveMeeting()) { dbg('skip: not-in-call'); return null; }
  if (dest && isMeetingDest(dest)) { dbg('skip: dest-is-meeting'); return null; }
  if (noGesture || reason === 'popstate') {
    dbg('no-gesture', reason);
    return null;
  }
  if (hasVideoPip()) return null;
  if (pendingWin) { dbg('already-pending'); return pendingWin; }
  if (hasPip()) { dbg('already-open'); return Promise.resolve(currentPip()); }
  const api = typeof documentPictureInPicture !== 'undefined' ? documentPictureInPicture : null;
  if (!api || typeof api.requestWindow !== 'function') { dbg('unsupported'); return null; }
  try {
    dbg('requestWindow', reason);
    const otherPopOut = api.window;
    if (otherPopOut && !otherPopOut.closed) otherPopOut.close();
    const p = api.requestWindow({ width: 420, height: 300 });
    pendingWin = Promise.resolve(p).catch((err) => {
      dbg('request-rejected', err && (err.message || err));
      return null;
    });
    return pendingWin;
  } catch (err) {
    dbg('request-threw', err && (err.message || err));
    return null;
  }
}

export function installAutoPipGuards(root) {
  const doc = root || (typeof document !== 'undefined' ? document : null);
  const win = (root && root.defaultView) || (typeof window !== 'undefined' ? window : null);
  if (!doc || !doc.addEventListener) return;
  if (doc._autoPipGuards) return;
  doc._autoPipGuards = true;
  guardsOn = true;
  doc.addEventListener('click', (e) => {
    const dest = destFromClick(e);
    if (!dest) return;
    if (!isLiveMeeting()) return;
    if (isMeetingDest(dest)) return;
    // Synchronous, capturing, before any navigate/route await.
    primeAutoPip('click', dest);
  }, true);
  if (win && win.addEventListener) {
    win.addEventListener('popstate', () => {
      if (!isLiveMeeting()) return;
      noGesture = true;
      dbg('popstate');
    }, true);
  }
}

export function park(room) {
  if (!isLiveMeeting(room) && !(room && room.alive && room.inRoom && room.root && !room._leaving)) {
    dbg('park-skipped', 'not-live');
    return false;
  }
  trackLiveMeeting(room);
  if (room.root && room.root.parentNode !== holder()) holder().append(room.root);
  try { shell.setRoomMode && shell.setRoomMode(false); } catch { /* ignore */ }
  live.code = room.code;
  live.url = liveUrl(room);
  if (hasVideoPip()) {
    closeMini();
    noGesture = false;
    return true;
  }
  const skipWin = noGesture;
  noGesture = false;
  if (skipWin) {
    dbg('park-mini-fallback');
    restoreStage(room);
    showMini(room);
  } else {
    attachAutoPip(room, pendingWin || primeAutoPip('park'));
  }
  syncChrome(room);
  return true;
}

export async function resume(view, params) {
  if (!canResume(params)) return null;
  const room = live.room;
  room.view = view;
  restoreStage(room);
  if (room.root) view.append(room.root);
  closeMini();
  closeAutoPip();
  try { shell.setRoomMode && shell.setRoomMode(true); } catch { /* ignore */ }
  try { room.renderStage(true); room.paintHead(true); } catch { /* ignore */ }
  try { document.title = (room.code ? fmtCode(room.code) : 'New room') + ' · 1venue'; } catch { /* ignore */ }
  return pageApi(room);
}

export function release(room) {
  if (!live || (room && live.room !== room)) return;
  restoreStage(live.room);
  closeMini();
  closeAutoPip();
  const hold = document.getElementById('live-meeting-hold');
  if (hold) hold.remove();
  unbindMediaSession();
  live = null;
  pendingWin = null;
  noGesture = false;
}

export function bindMediaSession(room) {
  if (!room || typeof navigator === 'undefined' || !navigator.mediaSession) {
    dbg('mediasession-missing');
    return;
  }
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: room.roomName || '1venue meeting',
      artist: '1venue',
      artwork: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
    });
  } catch { /* */ }
  try {
    if (navigator.mediaSession.setMicrophoneActive) navigator.mediaSession.setMicrophoneActive(!!(room.media && room.media.mic));
    if (navigator.mediaSession.setCameraActive) navigator.mediaSession.setCameraActive(!!(room.media && room.media.cam));
  } catch { /* */ }
  try {
    navigator.mediaSession.setActionHandler('enterpictureinpicture', () => {
      dbg('mediasession');
      return startAutoPip(room, 'mediasession');
    });
    dbg('mediasession-registered', !!(room.media && (room.media.mic || room.media.cam)));
  } catch (err) {
    dbg('mediasession-unsupported', err && (err.message || err));
  }
  if (room._visPip) return;
  room._visPip = () => {
    if (document.visibilityState !== 'hidden') return;
    if (!room.alive || !room.inRoom || room._leaving) return;
    setTimeout(() => {
      if (document.visibilityState !== 'hidden' || !room.alive || room._leaving) return;
      if (hasPip()) return;
      dbg('visibility-fallback-notify');
      notifyReturn(room);
    }, 500);
  };
  document.addEventListener('visibilitychange', room._visPip);
}

function unbindMediaSession() {
  if (typeof navigator === 'undefined' || !navigator.mediaSession) return;
  try { navigator.mediaSession.setActionHandler('enterpictureinpicture', null); } catch { /* */ }
}

function hasPip() {
  try {
    const w = currentPip();
    return !!(w && !w.closed);
  } catch { return false; }
}
function currentPip() {
  try {
    if (live && live.autoPip && !live.autoPip.closed) return live.autoPip;
    return null;
  } catch { return null; }
}

export function startAutoPip(room, reason = 'start') {
  if (!room || !room.alive) return Promise.resolve('none');
  if (hasPip()) { dbg('already-open', reason); return Promise.resolve('auto'); }
  if (hasVideoPip()) return Promise.resolve('video');
  const explicit = reason === 'command' || reason === 'shortcut';
  if (explicit) noGesture = false;
  if (reason === 'popstate' || noGesture) {
    noGesture = false;
    return Promise.resolve(showMini(room) ? 'mini' : 'none');
  }
  const p = pendingWin || primeAutoPip(reason);
  return attachAutoPip(room, p, { videoFallback: explicit || reason === 'mediasession' });
}

function attachAutoPip(room, winP, { videoFallback = false } = {}) {
  const session = live;
  const fallback = async () => {
    if (!isLiveMeeting(room) || live !== session) return 'none';
    if (videoFallback && await openVideoPip(room)) {
      closeMini();
      return 'video';
    }
    return live === session && showMini(room) ? 'mini' : 'none';
  };
  if (!winP) return fallback();
  return Promise.resolve(winP).then((w) => {
    if (w && currentPip() === w && live === session) return 'auto';
    if (pendingWin !== winP || live !== session || !isLiveMeeting(room)) {
      if (w && !w.closed && currentPip() !== w) w.close();
      return 'none';
    }
    pendingWin = null;
    if (!w || w.closed) return fallback();
    try {
      fillAutoPip(w, room);
      moveStage(w, room);
    } catch (err) {
      dbg('attach-failed', err && err.message);
      restoreStage(room);
      w.close();
      return fallback();
    }
    session.autoPip = w;
    closeMini();
    if (!w._autoPipHide) {
      w._autoPipHide = true;
      w.addEventListener('pagehide', () => {
        if (live === session && session.autoPip === w) {
          session.autoPip = null;
          onPipClosed(room);
        }
      });
    }
    return 'auto';
  });
}

async function openVideoPip(room) {
  const session = live;
  const stage = room.stageR?.el;
  if (!stage || session?.room !== room) return false;
  const videos = [...stage.querySelectorAll('video')].filter((video) =>
    video.readyState >= 2 && video.videoWidth > 0 && !video.disablePictureInPicture);
  const video = videos.find((candidate) => candidate.closest('.present:not([hidden]), .tile-main'))
    || videos.find((candidate) => candidate.closest('.tile')?.dataset.id !== room.me?.id)
    || videos[0];
  if (!video) return false;
  if (hasVideoPip()) return true;

  session.videoPip = video;
  try {
    if (document.pictureInPictureEnabled && typeof video.requestPictureInPicture === 'function') {
      try {
        await video.requestPictureInPicture();
        if (session.videoPip === video && live === session) {
          video.addEventListener('leavepictureinpicture', () => {
            if (live !== session || session.videoPip !== video) return;
            session.videoPip = null;
            showMini(room);
          }, { once: true });
          return true;
        }
        if (document.pictureInPictureElement === video) await document.exitPictureInPicture();
        return false;
      } catch { /* Try the WebKit video API when available. */ }
    }
    if (live === session && session.videoPip === video
      && video.webkitSupportsPresentationMode?.('picture-in-picture')) {
      video.webkitSetPresentationMode('picture-in-picture');
      return true;
    }
  } catch { /* Keep the meeting controls available when the browser declines. */ }
  if (session.videoPip === video) session.videoPip = null;
  return false;
}

function hasVideoPip() {
  const video = live?.videoPip;
  return !!video && (document.pictureInPictureElement === video || video.webkitPresentationMode === 'picture-in-picture');
}

function isParked(room) {
  if (!room) return false;
  const view = document.getElementById('view');
  return !room.root || !view || !view.contains(room.root);
}

/** Native PiP title-bar "Back to tab" focuses this tab then closes the window.
 *  The close (X) button does not focus us if the tab is in the background.
 *  When we cannot tell them apart (tab already visible), treat a parked live
 *  call as return-to-meeting, matching the in-PiP footer button. */
function onPipClosed(room) {
  restoreStage(room);
  if (!room || !room.alive || !room.inRoom || room._leaving) {
    dbg('pip-close: ended');
    closeMini();
    return;
  }
  if (!isParked(room)) {
    dbg('pip-close: already-on-meeting');
    return;
  }
  const go = () => {
    const visible = document.visibilityState === 'visible';
    const focused = typeof document.hasFocus !== 'function' || document.hasFocus();
    if (visible && focused) {
      dbg('pip-close: back-to-tab');
      returnToMeeting();
    } else {
      dbg('pip-close: close-x');
      showMini(room);
    }
  };
  setTimeout(go, 0);
}

function copyStyles(win) {
  try {
    [...document.styleSheets].forEach((ss) => {
      try {
        const st = win.document.createElement('style');
        st.textContent = [...ss.cssRules].map((r) => r.cssText).join('\n');
        win.document.head.append(st);
      } catch {
        if (ss.href) { const l = win.document.createElement('link'); l.rel = 'stylesheet'; l.href = ss.href; win.document.head.append(l); }
      }
    });
  } catch { /* */ }
}

function copyTheme(doc) {
  try { doc.documentElement.dataset.theme = document.documentElement.dataset.theme; } catch { /* */ }
  try {
    const src = getComputedStyle(document.documentElement);
    const root = doc.documentElement.style;
    for (const k of ['--bg', '--text', '--muted', '--line', '--s1', '--s2', '--accent', '--accent-2', '--accent-ink', '--accent-action']) {
      const v = src.getPropertyValue(k); if (v) root.setProperty(k, v);
    }
  } catch { /* */ }
}

function fillAutoPip(win, room) {
  const doc = win.document;
  if (!doc.body.querySelector('.meet-pip')) {
    copyTheme(doc);
    copyStyles(win);
    doc.documentElement.style.height = '100%';
    doc.body.style.cssText = 'margin:0;height:100%;background:var(--bg,#111);color:var(--text,#eee);font:14px/1.4 system-ui,sans-serif;overflow:hidden;';
    const style = doc.createElement('style');
    style.textContent = pipCss();
    doc.head.append(style);
    const root = doc.createElement('div');
    root.className = 'meet-pip';
    const stageHost = doc.createElement('div');
    stageHost.className = 'meet-pip-stage';
    const slot = doc.createElement('div');
    slot.className = 'meet-pip-bar';
    root.append(stageHost, slot);
    doc.body.append(root);
    import('../pip-hotkey.js').then((m) => m.installPipHotkey(doc, { inPip: true })).catch(() => {});
  }
  const slot = doc.body.querySelector('.meet-pip-bar') || doc.body.querySelector('.meet-pip');
  mountBar(slot, room, doc);
}

function pipCss() {
  return `.meet-pip{display:flex;flex-direction:column;height:100%;min-height:0;background:var(--bg,#111);color:inherit}
.meet-pip-stage{flex:1;min-height:0;overflow:hidden;position:relative;background:#0b0d12}
.meet-pip-stage > *{width:100%;height:100%}
.meet-pip-bar,.live-call-bar{display:flex;align-items:center;gap:.45rem;width:100%;box-sizing:border-box;padding:.45rem .55rem;background:var(--s1,#1a1a1a);color:inherit;flex:none}
.lcb-who{flex:1;min-width:0;display:flex;flex-direction:column}
.lcb-who b{font-size:.86rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lcb-who span{font-size:.72rem;color:var(--muted,#888)}
.lcb-flag{font-size:.68rem;font-weight:700;color:#fff;background:color-mix(in srgb,var(--accent,#2563eb) 80%,#000);border-radius:99px;padding:.05rem .4rem;margin-left:.25rem}
.lcb-btns{display:flex;gap:.25rem;flex:none}
.lcb-btns button{width:34px;height:34px;border:0;border-radius:10px;cursor:pointer;color:inherit;background:color-mix(in srgb,var(--text,#fff) 12%,transparent);display:grid;place-items:center}
.lcb-btns button.off{opacity:.7}
.lcb-btns button.danger{background:#dc2626;color:#fff}`;
}

function moveStage(win, room) {
  const stageEl = room && room.stageR && room.stageR.el;
  if (!stageEl || !win || !win.document) return;
  try {
    const host = win.document.querySelector('.meet-pip-stage');
    if (!host) return;
    if (stageEl.parentNode !== host) {
      if (!live.placeholder) {
        const ph = stageEl.ownerDocument.createElement('div');
        ph.className = 'pip-placeholder';
        ph.textContent = 'Playing in picture-in-picture';
        live.placeholder = ph;
      }
      if (stageEl.parentNode) stageEl.replaceWith(live.placeholder);
      host.append(stageEl);
      live.stageEl = stageEl;
      host.querySelectorAll('video, audio').forEach((el) => { try { el.play && el.play(); } catch { /* */ } });
      try { room.renderStage && room.renderStage(true); } catch { /* */ }
      dbg('stage-moved');
    }
  } catch (err) { dbg('stage-move-failed', err && (err.message || err)); }
}

function restoreStage(room) {
  const r = room || (live && live.room);
  const stageEl = (live && live.stageEl) || (r && r.stageR && r.stageR.el);
  const ph = live && live.placeholder;
  if (!stageEl || !ph || !ph.parentNode) {
    if (live) { live.stageEl = null; live.placeholder = null; }
    return;
  }
  try { ph.replaceWith(stageEl); } catch { /* */ }
  if (live) { live.stageEl = null; live.placeholder = null; }
  try { r && r.renderStage && r.renderStage(true); } catch { /* */ }
}

function mountBar(host, room, doc) {
  if (!host) return;
  host.replaceChildren();
  const bar = (doc || document).createElement('div');
  bar.className = 'live-call-bar';
  host.append(bar);
  paintBar(bar, room, doc || document);
}

function paintBar(bar, room, doc) {
  if (!bar) return;
  const d = doc || bar.ownerDocument || document;
  const mk = (ic, tip, fn, cls) => {
    const b = d.createElement('button');
    b.type = 'button';
    b.className = cls || '';
    b.setAttribute('aria-label', tip);
    b.title = tip;
    b.innerHTML = icon(ic, { size: 16 });
    b.onclick = (e) => { e.preventDefault(); fn(); syncChrome(room); };
    return b;
  };
  const muted = !!room.callMuted;
  const who = d.createElement('div');
  who.className = 'lcb-who';
  who.innerHTML = `<b></b><span></span>`;
  who.querySelector('b').textContent = room.roomName || 'Meeting';
  const sub = who.querySelector('span');
  sub.textContent = timerText(room);
  if (muted) {
    const flag = d.createElement('em');
    flag.className = 'lcb-flag';
    flag.textContent = 'Call muted';
    sub.append(' ', flag);
  }
  const btns = d.createElement('div');
  btns.className = 'lcb-btns';
  const back = mk('login', 'Back to tab', () => returnToMeeting(d), '');
  back.setAttribute('aria-label', 'Back to tab');
  back.title = 'Back to tab';
  btns.append(
    back,
    mk(room.media && room.media.mic ? 'mic' : 'micOff', 'Microphone', () => room.toggleMic(), room.media && room.media.mic ? '' : 'off'),
    mk(muted ? 'volumeOff' : 'volume', muted ? 'Unmute call audio' : 'Mute call audio', () => room.toggleCallAudio(), muted ? 'off' : ''),
    mk('phoneOff', 'Leave', () => { room._leaving = true; closeAutoPip(); closeMini(); room.leave(); }, 'danger'),
  );
  bar.replaceChildren(who, btns);
  bar._room = room;
}

export function syncChrome(room) {
  const r = room || (live && live.room);
  if (!r) return;
  const nodes = [];
  const mini = document.getElementById('live-call-mini');
  if (mini && isParked(r)) nodes.push(mini);
  else if (mini) closeMini();
  try {
    const w = currentPip();
    if (w && w.document) w.document.querySelectorAll('.live-call-bar').forEach((el) => nodes.push(el));
  } catch { /* */ }
  for (const el of nodes) paintBar(el, r, el.ownerDocument);
}

function timerText(room) {
  const secs = Math.max(0, Math.floor((Date.now() - (room.startedAt || Date.now())) / 1000));
  const h = Math.floor(secs / 3600);
  return `${h ? h + ':' : ''}${String(Math.floor(secs / 60) % 60).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;
}

function showMini(room) {
  if (!isLiveMeeting(room) || !isParked(room)) {
    closeMini();
    return false;
  }
  closeMini();
  const bar = h('div', { id: 'live-call-mini', class: 'live-call-mini live-call-bar', role: 'dialog', 'aria-label': 'Meeting in progress' });
  document.body.append(bar);
  paintBar(bar, room, document);
  return true;
}

function closeMini() {
  const el = document.getElementById('live-call-mini');
  if (el) el.remove();
}

function closeAutoPip() {
  const video = live?.videoPip;
  if (live) live.videoPip = null;
  try {
    if (video && document.pictureInPictureElement === video) document.exitPictureInPicture().catch(() => {});
    else if (video?.webkitPresentationMode === 'picture-in-picture') video.webkitSetPresentationMode('inline');
  } catch { /* The browser may have already closed the video. */ }
  try {
    if (live && live.autoPip && !live.autoPip.closed) live.autoPip.close();
  } catch { /* */ }
  if (live) live.autoPip = null;
  pendingWin = null;
}

export function returnToMeeting(pipDoc) {
  closeMini();
  const url = (live && live.url) || (live && live.room && liveUrl(live.room));
  let focused = false;
  try { window.focus(); focused = !!(document.hasFocus && document.hasFocus()); } catch { focused = false; }
  if (url && (location.pathname.replace(/\/$/, '') !== url)) {
    import('../app.js').then((m) => m.navigate(url)).catch(() => {});
  } else {
    restoreStage(live && live.room);
    closeAutoPip();
  }
  if (!focused) import('../bring-main.js').then((b) => b.bringMainToFront(pipDoc && pipDoc.defaultView ? pipDoc : (pipDoc || null), { url })).catch(() => {});
}

function notifyReturn(room) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  try {
    const n = new Notification('Meeting in progress', {
      body: 'Tap to return to the call',
      tag: '1venue-meeting',
      icon: '/icons/icon-192.png',
    });
    n.onclick = () => { try { window.focus(); } catch { /* */ } returnToMeeting(); n.close(); };
  } catch { /* */ }
}

/** Test hook: install a live meeting without joining one. */
export function _testSetLive(room) {
  live = room ? { room, code: room.code, url: liveUrl(room) } : null;
  pendingWin = null;
  noGesture = false;
}
