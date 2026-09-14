/* MAYA V1 — minimal service worker (PWA fallback + offline shell).
   Only runs in browsers; the Android wrapper does not require it. */
const CACHE = 'maya-v1-cache-v1';
const SHELL = ['index.html', 'style.css', 'script.js', 'manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if(e.request.method !== 'GET') return;                 // never cache AI POSTs
  if(url.pathname.startsWith('/api/')) return;           // API always live
  e.respondWith(
    caches.match(e.request).then(hit =>
      hit || fetch(e.request).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return res;
      }).catch(() => caches.match('index.html'))
    )
  );
});
