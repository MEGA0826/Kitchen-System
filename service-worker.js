// Kitchen MEP — Service Worker v21
// Handles: background sync for offline scan queue, icon caching only

const CACHE = "mep-v21";
const PRECACHE = [
  "/Kitchen-System/icons/icon-192.png",
  "/Kitchen-System/icons/icon-512.png"
];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);

  // Never intercept: Google APIs, HTML pages
  if (
    url.hostname.includes("google") ||
    url.hostname.includes("googleapis") ||
    e.request.headers.get("accept")?.includes("text/html") ||
    url.pathname.endsWith(".html")
  ) return;

  // Cache icons only
  if (url.pathname.includes("/icons/")) {
    e.respondWith(
      caches.match(e.request)
        .then(cached => cached || fetch(e.request))
    );
  }
});

// Background sync — retry offline scans when connection returns
self.addEventListener("sync", e => {
  if (e.tag === "retry-scans") {
    e.waitUntil(
      self.clients.matchAll().then(clients => {
        clients.forEach(client =>
          client.postMessage({ type: "SYNC_COMPLETE" })
        );
      })
    );
  }
});
