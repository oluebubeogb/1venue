/** Single-key O: pop out the app or a live meeting, and return to the tab from inside the pop-out. */
import { isLiveMeeting, getLive, returnToMeeting } from './room/session.js';

const APP_PIP_SIZE = { width: 380, height: 640, disallowReturnToOpener: false };

function isTyping(e, doc) {
  if (!e || e.metaKey || e.ctrlKey || e.altKey) return true;
  if (e.isComposing || e.keyCode === 229) return true;
  const el = (doc && doc.activeElement) || (typeof document !== 'undefined' && document.activeElement);
  if (!el) return false;
  const tag = String(el.tagName || '').toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (el.isContentEditable) return true;
  return false;
}

function isO(e) {
  return !!e && !e.repeat && String(e.key || '').toLowerCase() === 'o';
}

function closePip(pipDoc) {
  try { window.focus(); } catch { /* */ }
  import('./bring-main.js').then((b) => b.bringMainToFront(pipDoc || null)).catch(() => {});
  try {
    const w = (pipDoc && pipDoc.defaultView) || (typeof documentPictureInPicture !== 'undefined' && documentPictureInPicture.window);
    if (w && !w.closed) w.close();
  } catch { /* */ }
}

export function openPopOut() {
  if (isLiveMeeting()) {
    const live = getLive();
    const room = live && live.room;
    if (room) return room.popOutMeeting('shortcut');
  }
  const api = typeof documentPictureInPicture !== 'undefined' ? documentPictureInPicture : null;
  if (!api || typeof api.requestWindow !== 'function') {
    import('./app-pip.js').then((m) => m.popOut()).catch(() => {});
    return null;
  }
  if (api.window && !api.window.closed) return Promise.resolve(api.window);
  try {
    const winP = api.requestWindow(APP_PIP_SIZE);
    import('./app-pip.js').then((m) => m.popOut(winP)).catch(() => {});
    return winP;
  } catch {
    import('./app-pip.js').then((m) => m.popOut()).catch(() => {});
    return null;
  }
}

function onKey(e, { inPip, pipDoc } = {}) {
  if (isTyping(e, pipDoc) || !isO(e)) return;
  e.preventDefault();
  e.stopPropagation();
  if (inPip) {
    if (isLiveMeeting()) returnToMeeting(pipDoc);
    else closePip(pipDoc);
    return;
  }
  openPopOut();
}

export function installPipHotkey(doc, { inPip } = {}) {
  const d = doc || (typeof document !== 'undefined' ? document : null);
  if (!d || !d.addEventListener || d._pipHotkey) return;
  d._pipHotkey = true;
  d.addEventListener('keydown', (e) => onKey(e, { inPip, pipDoc: d }), true);
}

export { isTyping as _isTypingForTest };
