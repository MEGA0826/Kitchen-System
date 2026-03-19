const CACHE_NAME = "mep-cache-v1";

const ASSETS = [
  "/",
  "/index.html",
  "/manifest.json",
  "/js/main.js",
  "/js/api.js",
  "/js/state.js",
  "/js/ui.js",
  "/icons/icon-192.png",
  "/icons/icon-512.png"
];

// Install: cache everything
self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
});

// Activate: remove old caches
self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.map(key => key !== CACHE_NAME && caches.delete(key))
      )
    )
  );
});

// Fetch: serve from cache first, fallback to network
self.addEventListener("fetch", event => {
  event.respondWith(
    caches.match(event.request).then(cached => {
      return (
        cached ||
        fetch(event.request).catch(() =>
          caches.match("/index.html")
        )
      );
    })
  );
});
