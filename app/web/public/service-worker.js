const CACHE_NAME = 'freecast-shell-v1';
const PRECACHE_URLS = ['./', './manifest.webmanifest', './favicon.svg'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async cache => {
      const shellResponse = await fetch('./');
      if (!shellResponse.ok) throw new Error('Unable to precache the app shell.');
      const shell = await shellResponse.text();
      await cache.put('./', new Response(shell, {
        status: shellResponse.status,
        statusText: shellResponse.statusText,
        headers: shellResponse.headers
      }));
      const assets = Array.from(shell.matchAll(/(?:href|src)="([^"]+\.(?:js|css)(?:\?[^"]*)?)"/g))
        .map(match => new URL(match[1], self.location).toString());
      await cache.addAll([...PRECACHE_URLS.slice(1), ...assets]);
    })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key =>
        (key.startsWith('freecast-shell-') || key.startsWith('rrpg-shell-')) && key !== CACHE_NAME
      ).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/') || url.pathname === '/ws') return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response.ok) caches.open(CACHE_NAME).then(cache => cache.put('./', response.clone()));
          return response;
        })
        .catch(() => caches.match(new URL('./', self.location).toString()))
    );
    return;
  }

  if (url.pathname.startsWith('/assets/') || ['script', 'style', 'image', 'font'].includes(request.destination)) {
    event.respondWith(
      caches.match(url.toString()).then(cached => cached || fetch(request).then(response => {
        if (response.ok) caches.open(CACHE_NAME).then(cache => cache.put(request, response.clone()));
        return response;
      }))
    );
  }
});
