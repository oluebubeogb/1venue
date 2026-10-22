// PWA install: captures beforeinstallprompt, shows the banner in strategic moments
// (after the first page view, after leaving a room, on the dashboard), with iOS Add-to-Home instructions.
import { LOGO, icon } from './icons.js';
import { h, sheet, toast } from './ui.js';

let deferred = null;
const KEY = 'venue.install.dismissed';
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const snoozed = () => Date.now() - Number(localStorage.getItem(KEY) || 0) < 3 * 86400e3;
export const canInstall = () => !isStandalone() && (!!deferred || isIOS());

export function initPwa() {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; setTimeout(() => maybeShowBanner('first-visit'), 6000); });
  window.addEventListener('appinstalled', () => { deferred = null; document.querySelector('.install:not(.inline)')?.remove(); toast('1venue installed', { icon: 'check' }); });
  if (isIOS() && !isStandalone()) setTimeout(() => maybeShowBanner('first-visit'), 8000);
}
export function maybeShowBanner(reason = '') {
  if (!canInstall() || snoozed() || document.body.classList.contains('in-room') || document.querySelector('.install:not(.inline)')) return;
  document.body.append(banner(false, reason));
}
export function inlineBanner(reason = '') { return canInstall() ? banner(true, reason) : null; }
function banner(inline, reason) {
  const copy = reason === 'after-room' ? 'Rejoin faster next time — install 1venue.' : reason === 'dashboard' ? 'Get live alerts and one-tap joining.' : 'Faster, full-screen, works offline.';
  const el = h('div', { class: `install${inline ? ' inline' : ''}`, role: 'region', 'aria-label': 'Install app' },
    h('div', { class: 'logo-tile', html: LOGO(30) }),
    h('div', { class: 'grow' }, h('strong', null, 'Install 1venue'), h('div', { class: 'small', style: { opacity: '.85' } }, copy)),
    h('button', { class: 'btn sm', onclick: () => { promptInstall(); } }, isIOS() && !deferred ? 'How to' : 'Install'),
    inline ? null : h('button', { class: 'icon-btn x', 'aria-label': 'Dismiss', html: icon('x', { size: 18 }), onclick: () => { localStorage.setItem(KEY, Date.now()); el.remove(); } }));
  return el;
}
export async function promptInstall() {
  if (isStandalone()) return toast('1venue is already installed', { icon: 'check' });
  if (deferred) { deferred.prompt(); const r = await deferred.userChoice.catch(() => null); deferred = null; document.querySelector('.install:not(.inline)')?.remove(); if (r?.outcome === 'dismissed') localStorage.setItem(KEY, Date.now()); return; }
  const s = sheet({ title: 'Install 1venue', icon: 'install' });
  const steps = isIOS()
    ? [['share', 'Tap the Share button in Safari’s toolbar'], ['plus', 'Scroll and choose “Add to Home Screen”'], ['check', 'Tap “Add” — 1venue opens full-screen like a native app']]
    : [['moreV', 'Open your browser menu (⋮ or ⋯)'], ['install', 'Choose “Install app” or “Add to Home screen”'], ['check', 'Launch 1venue from your home screen or dock']];
  s.body.append(h('div', { class: 'layer' }, steps.map(([ic, t], i) => h('div', { class: 'set-row' }, h('span', { class: 'ico', style: { '--g': 'var(--accent)' }, html: icon(ic) }), h('span', null, h('strong', null, `${i + 1}. `), t)))));
}
