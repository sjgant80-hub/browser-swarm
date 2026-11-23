// sw.js: after the first visit, the page, its kernels and its data load from this device; the model is cached by WebLLM itself
const CACHE = 'browser-swarm-v1';
const CORE = ['./', 'index.html', 'manifest.webmanifest', 'SEAL2.json', 'SEAL3.json', 'data/suite.json', 'data/test2.json', 'data/settings2.json', 'data/settings3.json', 'data/adoption.json', 'data/gates.json', 'data/corpus.json', 'data/banking-index.json', 'data/departments.json', 'data/settings.json', 'data/prices.json', 'data/published.json'];
self.addEventListener('install', (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).catch(() => {})));
self.addEventListener('activate', (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))));
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  // network first, so a published run appears as soon as it is published; the cache when offline
  e.respondWith(fetch(e.request).then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {}); return r; }).catch(() => caches.match(e.request)));
});
