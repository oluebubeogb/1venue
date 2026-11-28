// Detect a new deploy and swap it in: auto-reload when it is safe, otherwise a Reload toast.
import { toast } from './ui.js';
import { getLive } from './room/session.js';
import { pendingSessionRecording } from './room/recorder.js';
let callApi = null;
import('./messages/call.js').then((m) => { callApi = m; }).catch(() => {});

const FLAG = 'venue.reloadedFor';
const IMPORT_FLAG = 'venue.importReload';
let pending = null;
let toastShown = false;
let extraBlocked = null;

function localBuild() {
  const m = document.querySelector('meta[name="app-version"]');
  return { version: (m && m.content) || '', asset: (m && m.dataset.asset) || '' };
}

export function isStaleModuleError(e) {
  const m = String((e && (e.message || e)) || '');
  if (!e) return false;
  if (e.name === 'SyntaxError' || e instanceof SyntaxError) return true;
  return /does not provide an export/i.test(m)
    || /Failed to fetch dynamically imported module/i.test(m)
    || /error loading dynamically imported module/i.test(m)
    || /Failed to resolve module/i.test(m);
}

export function isUpdateBlocked() {
  if (document.body.classList.contains('in-room')) return true;
  const sessionId = location.pathname.match(/^\/session\/(\d+)\/?$/)?.[1];
  if (sessionId && pendingSessionRecording(sessionId)) return true;
  try { if (getLive()) return true; } catch { /* ignore */ }
  try {
    const w = typeof documentPictureInPicture !== 'undefined' && documentPictureInPicture.window;
    if (w && !w.closed) return true;
  } catch { /* ignore */ }
  try { if (callApi && (callApi.inCall() || callApi.isRinging())) return true; } catch { /* ignore */ }
  if (document.querySelector('[data-work="1"], #live-meeting-hold, .live-call-mini, .app-pip-call, .wa-rec:not([hidden])')) return true;
  if (extraBlocked && extraBlocked()) return true;
  return false;
}

async function hardReload(key) {
  const id = key || 'update';
  if (sessionStorage.getItem(FLAG) === id) return false;
  sessionStorage.setItem(FLAG, id);
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
    if (window.caches) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch { /* still reload */ }
  location.reload();
  return true;
}

function offerOrReload(remote) {
  const loc = localBuild();
  const key = remote ? `${remote.version}:${remote.asset}` : `${loc.version}:${loc.asset}:sw`;
  pending = remote || loc;
  if (!isUpdateBlocked()) return hardReload(key);
  if (toastShown) return false;
  toastShown = true;
  toast('Update ready', { icon: 'refresh', group: 'update', ms: 0, action: { label: 'Reload', run: () => hardReload(key) } });
  return false;
}

/** If a deploy is waiting and the page is now safe, apply it (call from navigate/route). */
export function applyPendingIfSafe() {
  if (!pending) return false;
  if (isUpdateBlocked()) return false;
  const loc = localBuild();
  const key = pending.version ? `${pending.version}:${pending.asset}` : `${loc.version}:${loc.asset}:sw`;
  hardReload(key);
  return true;
}

export function reloadForImportError(e) {
  if (!isStaleModuleError(e)) return false;
  if (sessionStorage.getItem(IMPORT_FLAG) === '1') return false;
  sessionStorage.setItem(IMPORT_FLAG, '1');
  hardReload('import');
  return true;
}

export function noteRouteOk() {
  sessionStorage.removeItem(IMPORT_FLAG);
}

async function checkRemote() {
  try {
    const r = await fetch('/api/version', { cache: 'no-store' });
    if (!r.ok) return;
    const v = await r.json();
    const loc = localBuild();
    if (!v || !v.version) return;
    if (v.version !== loc.version || String(v.asset) !== String(loc.asset)) offerOrReload(v);
  } catch { /* offline */ }
}

export function initUpdates({ blocked } = {}) {
  extraBlocked = blocked || null;
  if (location.protocol === 'file:') return;
  if ('serviceWorker' in navigator) {
    let hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('/sw.js').catch(() => {});
    navigator.serviceWorker.ready.then((reg) => {
      const poke = () => { reg.update().catch(() => {}); checkRemote(); };
      document.addEventListener('visibilitychange', () => { if (!document.hidden) poke(); });
      setInterval(poke, 60 * 1000);
      if (reg.waiting && hadController) offerOrReload(null);
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        if (!w) return;
        w.addEventListener('statechange', () => {
          if (w.state === 'installed' && navigator.serviceWorker.controller) offerOrReload(null);
        });
      });
    }).catch(() => {});
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController) { hadController = true; return; }
      offerOrReload(null);
    });
  } else {
    document.addEventListener('visibilitychange', () => { if (!document.hidden) checkRemote(); });
    setInterval(checkRemote, 60 * 1000);
  }
  checkRemote();
}
