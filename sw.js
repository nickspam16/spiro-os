// Service worker: instant opens with self-healing updates.
// STALE-WHILE-REVALIDATE — serve cached shell immediately for speed, but always fetch
// the network copy in the background and update the cache, so a new index.html deploy
// reaches the user on their next open WITHOUT needing this file to change. (Previously
// cache-first-only meant index.html updates never propagated unless CACHE was bumped —
// that stranded users on stale builds. Fixed here.) cache:'reload' at install still
// bypasses the CDN max-age so a fresh SW version can't cache a stale index.html.
// CACHE IS DELIBERATELY UNVERSIONED (2026-07-30). It used to carry a vNN that had to be bumped by
// hand on every single deploy, enforced by a CI rule — and that rule was written for the OLD
// cache-first worker, where index.html genuinely could not reach users without a new cache name.
// This worker has been stale-while-revalidate since (see above): every open refreshes the cached
// copy from the network in the background, so app updates propagate on their own. The bump was
// solving a problem this file had already fixed, at a cost of one manual edit per deploy and a red
// CI run every time it was forgotten — which was most times.
// Adding or removing a SHELL asset still requires editing this file, and that edit is itself what
// triggers install/addAll, so the shell list stays correct without a version number to maintain.
const CACHE = 'spiro-os';
const SHELL = ['./index.html', './manifest.json', './icon.png', './supabase.js',
  './assets/ns-logo.svg', './assets/icon-192.png', './assets/icon-512.png',
  './assets/icon-192-maskable.png', './assets/icon-512-maskable.png',
  './assets/icon-180.png', './assets/icon-167.png', './assets/icon-152.png', './assets/icon-120.png',
  './assets/favicon.png', './assets/favicon-16.png', './assets/favicon-32.png', './assets/favicon-48.png'];
const SCOPE_PATH = new URL(self.registration.scope).pathname;
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.origin === location.origin && url.pathname.startsWith(SCOPE_PATH) && e.request.method === 'GET') {
    e.respondWith(caches.open(CACHE).then(cache => cache.match(e.request).then(hit => {
      const net = fetch(e.request).then(res => {
        if (res && res.ok) cache.put(e.request, res.clone());   // refresh cache for next open
        return res;
      }).catch(() => hit);                                       // offline -> fall back to cache
      return hit || net;                                         // instant if cached, else network
    })));
  }
});
