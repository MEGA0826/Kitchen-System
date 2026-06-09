// Kitchen MEP — Service Worker v73
// Strategy: cache-first for static assets, network-first for API calls

const CACHE_STATIC = "mep-static-v73";
const CACHE_API    = "mep-api-v73";

const PRECACHE = [
  "/Kitchen-System/index.html",
  "/Kitchen-System/dashboard.html",
  "/Kitchen-System/manifest.json",
  "/Kitchen-System/icons/icon-96.png",
  "/Kitchen-System/icons/icon-192.png",
  "/Kitchen-System/icons/icon-512.png",
  "/Kitchen-System/icons/apple-touch-icon.png",
  "/Kitchen-System/icons/favicon.ico",
  "/Kitchen-System/icons/favicon.svg"
];

// ── Install: precache all static assets ─────────────────────────────────────
self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE_STATIC)
      .then(c => c.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

// ── Activate: purge old caches ───────────────────────────────────────────────
self.addEventListener("activate", e => {
  const keep = [CACHE_STATIC, CACHE_API];
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => !keep.includes(k)).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// ── Fetch: strategy per resource type ───────────────────────────────────────
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);

  // Skip non-GET and cross-origin except Google Fonts
  if (e.request.method !== "GET") return;

  // Google Apps Script API → network-first with API cache fallback (5 min TTL)
  if (url.hostname.includes("script.google.com")) {
    e.respondWith(networkFirstWithCache(e.request, CACHE_API, 300));
    return;
  }

  // Google Fonts → cache-first (long lived)
  if (url.hostname.includes("fonts.googleapis.com") || url.hostname.includes("fonts.gstatic.com")) {
    e.respondWith(cacheFirst(e.request, CACHE_STATIC));
    return;
  }

  // Skip other cross-origin requests
  if (url.origin !== self.location.origin) return;

  // Static assets (HTML, icons, JS, CSS) → stale-while-revalidate
  e.respondWith(staleWhileRevalidate(e.request, CACHE_STATIC));
});

// ── Cache strategies ─────────────────────────────────────────────────────────
async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(cacheName);
    cache.put(request, response.clone());
  }
  return response;
}

async function staleWhileRevalidate(request, cacheName) {
  const cache  = await caches.open(cacheName);
  const cached = await cache.match(request);
  // Fetch in background and update cache
  const fetchPromise = fetch(request).then(response => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => null);
  return cached || fetchPromise;
}

async function networkFirstWithCache(request, cacheName, maxAgeSeconds) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request, { signal: AbortSignal.timeout(8000) });
    if (response.ok) {
      const toCache = response.clone();
      // Store with timestamp header for TTL checking
      const headers = new Headers(toCache.headers);
      headers.set("sw-cached-at", Date.now().toString());
      const body = await toCache.blob();
      cache.put(request, new Response(body, { status: response.status, headers }));
    }
    return response;
  } catch {
    // Network failed — try cache with TTL check
    const cached = await cache.match(request);
    if (cached) {
      const cachedAt = Number(cached.headers.get("sw-cached-at") || 0);
      if ((Date.now() - cachedAt) / 1000 < maxAgeSeconds) return cached;
    }
    return cached || new Response(JSON.stringify({ error: "offline" }), {
      status: 503,
      headers: { "Content-Type": "application/json" }
    });
  }
}

// ── Background sync — retry offline scans ───────────────────────────────────
self.addEventListener("sync", e => {
  if (e.tag === "retry-scans") {
    e.waitUntil(
      self.clients.matchAll().then(clients =>
        clients.forEach(c => c.postMessage({ type: "SYNC_COMPLETE" }))
      )
    );
  }
});

// ── Push notifications (future: low-stock alerts, shift reminders) ───────────
self.addEventListener("push", e => {
  const data = e.data?.json() || { title: "Kitchen MEP", body: "New alert" };
  e.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/Kitchen-System/icons/icon-192.png",
      badge: "/Kitchen-System/icons/icon-96.png",
      tag: data.tag || "mep-alert",
      data: { url: data.url || "/Kitchen-System/index.html" }
    })
  );
});

self.addEventListener("notificationclick", e => {
  e.notification.close();
  e.waitUntil(clients.openWindow(e.notification.data?.url || "/Kitchen-System/index.html"));
});
