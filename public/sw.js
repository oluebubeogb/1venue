/* 1venue service worker: offline app shell, stale-while-revalidate for static assets, network-only for API/WS/media. */
const VERSION = 'v2-2026-10-24';
const SHELL = `shell-${VERSION}`;
const ASSETS = `assets-${VERSION}`;
const PRECACHE = ['/', '/offline.html', '/css/app.css', '/css/room.css', '/js/app.js', '/js/ui.js', '/js/icons.js', '/js/commands.js', '/js/pwa.js', '/brand/logo.svg', '/brand/mark-white.svg', '/manifest.webmanifest', '/icons/icon-192.png'];

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
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/files/') || url.pathname === '/health') return;
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then((res) => { const copy = res.clone(); caches.open(SHELL).then((c) => c.put('/', copy)); return res; })
      .catch(() => caches.match('/').then((r) => r || caches.match('/offline.html'))));
    return;
  }
  if (/\.(js|css|svg|png|webmanifest|woff2?)$/.test(url.pathname)) {
    e.respondWith(caches.open(ASSETS).then(async (c) => {
      const hit = await c.match(req);
      const net = fetch(req).then((res) => { if (res.ok) c.put(req, res.clone()); return res; }).catch(() => hit);
      return hit || net;
    }));
  }
});
