// Kitchen MEP — Service Worker v134
// Strategy: cache-first for static assets, network-first for API READS.
// API writes are never intercepted: serving a cached response for a write
// (e.g. a repeated produce/waste scan URL) would report success without
// anything being saved.

const CACHE_STATIC = "mep-static-v134";
const CACHE_API    = "mep-api-v134";

// Actions that involve slow AI processing — use a 90-second timeout
const SLOW_ACTIONS = new Set(["parsePdfVisionChunked", "parseMenuPdf", "parseRecipePdf"]);
// Actions that are transient (chunk upload) — never cache, no fallback needed
const NOCACHE_ACTIONS = new Set(["storeChunk"]);
// GAS READ actions — the only ones allowed to fall back to the API cache.
// Any action not listed here (all writes) bypasses the service worker.
const READ_ACTIONS = new Set([
  "scans", "archivedScans", "allProducts", "getProductsExtended", "getAllCodes",
  "inventory", "workers", "allWorkers", "getRolePINs",
  "getMenus", "getGRs", "getRecipes", "getDeductions",
  "getHACCPConfig", "getHACCPChecks", "getHACCPReport", "getHACCPTodayLogs",
  "getMepOverview", "getMepStock", "mepStatus", "getRequirements",
  "getSalesAnalysis", "archiveStats", "getArchiveStats", "reportPreview",
  "getAllItemsForMatching", "parsePdfVision"
]);

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

  // Google Apps Script API → reads: network-first with cache fallback (5 min TTL).
  // Writes (any action not in READ/SLOW/NOCACHE sets) are NOT intercepted —
  // they hit the network directly and fail loudly instead of being answered
  // from a stale cached response.
  if (url.hostname.includes("script.google.com")) {
    const action = url.searchParams.get("action") || "";
    // Transient chunk uploads — pass through directly, no caching
    if (NOCACHE_ACTIONS.has(action)) {
      e.respondWith(fetch(e.request));
      return;
    }
    if (READ_ACTIONS.has(action) || SLOW_ACTIONS.has(action)) {
      // Slow AI actions get a 90-second timeout; regular calls get 8 seconds
      const timeoutMs = SLOW_ACTIONS.has(action) ? 90000 : 8000;
      e.respondWith(networkFirstWithCache(e.request, CACHE_API, 300, timeoutMs));
    }
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

async function networkFirstWithCache(request, cacheName, maxAgeSeconds, timeoutMs) {
  timeoutMs = timeoutMs || 8000;
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request, { signal: AbortSignal.timeout(timeoutMs) });
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
