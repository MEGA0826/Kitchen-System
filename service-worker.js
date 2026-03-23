// Kitchen MEP — Service Worker v5
// Strategy: cache ONLY icons and fonts. Never intercept HTML or API calls.

const CACHE = "mep-v5";

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
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);

  // NEVER intercept: API calls, HTML pages, anything from script.google.com
  // Let the browser handle these directly — no service worker interference
  if (
    url.hostname.includes("google") ||
    url.hostname.includes("googleapis") ||
    e.request.headers.get("accept")?.includes("text/html") ||
    url.pathname.endsWith(".html")
  ) {
    return; // browser handles it natively
  }

  // Cache only icons
  if (url.pathname.includes("/icons/")) {
    e.respondWith(
      caches.match(e.request).then(cached => cached || fetch(e.request))
    );
  }
});
