const CACHE_NAME = "mep-cache-v1";
const ROOT = "/Kitchen-System";

const ASSETS = [
  `${ROOT}/`,
  `${ROOT}/index.html`,
  `${ROOT}/manifest.json`,
  `${ROOT}/js/main.js`,
  `${ROOT}/js/api.js`,
  `${ROOT}/js/state.js`,
  `${ROOT}/js/ui.js`,
  `${ROOT}/icons/icon-192.png`,
  `${ROOT}/icons/icon-512.png`
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(key => key !== CACHE_NAME && caches.delete(key)))
    )
  );
});

self.addEventListener("fetch", event => {
  event.respondWith(
    caches.match(event.request).then(cached => {
      return (
        cached ||
        fetch(event.request).catch(() =>
          caches.match(`${ROOT}/index.html`)
        )
      );
    })
  );
});
