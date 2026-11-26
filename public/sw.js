/* 1venue service worker: offline app shell, stale-while-revalidate for static assets, network-only for API/WS/media. */
const VERSION = 'v97-2026-11-26';
const SHELL = `shell-${VERSION}`;
const ASSETS = `assets-${VERSION}`;
const PRECACHE = ['/', '/offline.html', '/css/app.css', '/css/room.css', '/js/app.js', '/js/ui.js', '/js/money.js', '/js/menu-pos.js', '/js/icons.js', '/js/commands.js', '/js/pwa.js', '/js/quran-cmd.js', '/brand/logo.svg', '/brand/mark-white.svg', '/manifest.webmanifest', '/icons/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => ![SHELL, ASSETS].includes(k)).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/files/') || url.pathname.startsWith('/auth/') || url.pathname === '/health') return;
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then((res) => { const copy = res.clone(); caches.open(SHELL).then((c) => c.put('/', copy)); return res; })
      .catch(() => caches.match('/').then((r) => r || caches.match('/offline.html'))));
    return;
  }
  if (/\.(js|css)$/.test(url.pathname)) { // network-first so new builds show immediately
    e.respondWith(caches.open(ASSETS).then((c) => fetch(req, { cache: 'no-cache' }).then((res) => { if (res.ok) c.put(req, res.clone()); return res; }).catch(() => c.match(req))));
    return;
  }
  if (/\.(svg|png|webmanifest|woff2?)$/.test(url.pathname)) {
    e.respondWith(caches.open(ASSETS).then(async (c) => {
      const hit = await c.match(req);
      const net = fetch(req).then((res) => { if (res.ok) c.put(req, res.clone()); return res; }).catch(() => hit);
      return hit || net;
    }));
  }
});

// Web Push (Messages): only fires when the server has VAPID keys and the user turned notifications on.
const callOpts = (d) => ({
  body: d.body || '', tag: d.tag || `call-${d.callId}`, renotify: true, requireInteraction: true, vibrate: [300, 150, 300, 150, 300],
  icon: d.icon || '/icons/icon-192.png', badge: '/icons/icon-192.png',
  actions: [{ action: 'answer', title: 'Answer' }, { action: 'decline', title: 'Decline' }],
  data: { kind: 'call', callId: d.callId, url: d.url || '/messages' },
});
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: '1venue', body: e.data && e.data.text() }; }
  const call = d.kind === 'call';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (wins) => {
    if (d.kind === 'call-end') { // missed / answered elsewhere: swap the ringing notification for a quiet one
      const old = await self.registration.getNotifications({ tag: d.tag });
      old.forEach((n) => n.close());
      return self.registration.showNotification(d.title || 'Missed call', { body: d.body || '', tag: d.replaceTag || d.tag, icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', data: { url: d.url || '/messages' } });
    }
    // A tab in view already shows the message or the ringing sheet.
    if (wins.some((w) => w.focused && w.visibilityState === 'visible')) return undefined;
    if (call) return self.registration.showNotification(d.title || 'Incoming call', callOpts(d));
    return self.registration.showNotification(d.title || '1venue', {
      body: d.body || '', tag: d.tag || undefined, renotify: !!d.tag,
      icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', data: { url: d.url || '/messages' },
    });
  }));
});
// Focus the tab that is ringing (it gets the button press too), else any 1venue tab, else open one.
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const data = e.notification.data || {};
  const url = data.url || '/messages';
  if (data.kind === 'call' && data.callId) {
    const action = e.action || 'open';
    e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (wins) => {
      const mine = wins.filter((x) => new URL(x.url).origin === location.origin);
      mine.forEach((w) => w.postMessage({ type: 'call-action', action, callId: data.callId }));
      if (action === 'decline') {
        if (!mine.length) await fetch(`/api/messages/calls/${encodeURIComponent(data.callId)}/decline`, { method: 'POST', credentials: 'include' }).catch(() => {});
        return undefined;
      }
      const w = mine.find((x) => x.visibilityState === 'visible') || mine.find((x) => new URL(x.url).pathname.startsWith('/messages')) || mine[0];
      if (w) return w.focus().catch(() => self.clients.openWindow(url));
      return self.clients.openWindow(action === 'answer' ? url + (url.includes('?') ? '&' : '?') + 'answer=1' : url);
    }));
    return;
  }
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
    const w = wins.find((x) => new URL(x.url).origin === location.origin);
    if (w) return w.focus().then(() => w.navigate ? w.navigate(url) : undefined).catch(() => self.clients.openWindow(url));
    return self.clients.openWindow(url);
  }));
});
