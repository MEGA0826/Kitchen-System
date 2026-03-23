// Kitchen MEP — Service Worker v3
// Strategy:
//   Shell files (HTML, fonts) → Cache-first (offline works)
//   API calls (Apps Script)   → Network-first, no cache (always fresh data)

const CACHE     = "mep-shell-v4";
const API_HOST  = "script.google.com";

// Files to pre-cache on install — the app shell
const SHELL = [
  "/Kitchen-System/",
  "/Kitchen-System/index.html",
  "/Kitchen-System/dashboard.html",
  "/Kitchen-System/manifest.json",
  "/Kitchen-System/icons/icon-192.png",
  "/Kitchen-System/icons/icon-512.png",
  "https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Instrument+Serif:ital@0;1&display=swap"
];

// ── Install: pre-cache shell ──────────────────────────────────
self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

// ── Activate: delete old caches ───────────────────────────────
self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: route by request type ─────────────────────────────
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);

  // Never cache API calls — always go network
  if (url.hostname === API_HOST) {
    e.respondWith(
      fetch(e.request).catch(() =>
        new Response(JSON.stringify({ error: "Offline — no network" }),
          { headers: { "Content-Type": "application/json" } })
      )
    );
    return;
  }

  // Never cache POST requests
  if (e.request.method !== "GET") return;

  // Chrome DevTools requests — skip
  if (url.pathname.startsWith("/__")) return;

  // Shell files — cache first, fallback to network
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(response => {
        // Cache successful responses for shell files
        if (response.ok && (
          e.request.url.includes("/Kitchen-System/") ||
          e.request.url.includes("fonts.googleapis.com") ||
          e.request.url.includes("fonts.gstatic.com")
        )) {
          const clone = response.clone();
          caches.open(CACHE).then(cache => cache.put(e.request, clone));
        }
        return response;
      }).catch(() => {
        // Offline fallback for HTML pages
        if (e.request.headers.get("accept")?.includes("text/html")) {
          return caches.match("/Kitchen-System/index.html");
        }
      });
    })
  );
});

// ── Background sync: retry failed scans when back online ──────
self.addEventListener("sync", e => {
  if (e.tag === "retry-scans") {
    e.waitUntil(retrySavedScans());
  }
});

async function retrySavedScans() {
  // Future: read pending scans from IndexedDB and retry
  // For now just notify clients that sync happened
  const clients = await self.clients.matchAll();
  clients.forEach(client =>
    client.postMessage({ type: "SYNC_COMPLETE" })
  );
}
