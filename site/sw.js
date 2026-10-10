/* Bus Jam service worker: cache-first offline play. Bump CACHE on every release. */
var CACHE = 'bus-jam-v3';
var ASSETS = ['./', 'index.html', 'style.css', 'manifest.webmanifest', 'js/game.js', 'js/core.js', 'js/levels.js', 'js/lib/three.module.min.js', 'icons/icon.svg'];
self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(ASSETS.map(function (u) { return new Request(u, { cache: 'reload' }); })); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf('bus-jam-') === 0 && k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  var url = new URL(e.request.url);
  var scopePath = new URL(self.registration.scope).pathname;
  if (url.origin !== location.origin || url.pathname.indexOf(scopePath) !== 0) return;
  // Caches are shared per origin and another game's worker may clear them: refill on every page open if anything is missing.
  if (e.request.mode === 'navigate') e.waitUntil(caches.open(CACHE).then(function (c) { return c.match('js/lib/three.module.min.js').then(function (h) { return h || c.addAll(ASSETS); }); }).catch(function () {}));
  e.respondWith(caches.open(CACHE).then(function (c) {
    return c.match(e.request, { ignoreSearch: true }).then(function (hit) {
      var net = fetch(e.request).then(function (res) { if (res && res.ok) c.put(e.request, res.clone()); return res; });
      if (hit) { net.catch(function () {}); return hit; }
      return net.catch(function () { return c.match('index.html'); });
    });
  }));
});
