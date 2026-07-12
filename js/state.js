/* Kitchen MEP — js/state.js
 * Single application store. Replaces the mutable globals in dashboard.html
 * (allScans, allProducts, allInventory, scanStats, window.todayScanStats,
 * allWorkersAdmin) and the ad-hoc sessionStorage caching in initFromCache().
 *
 * Views subscribe to slices instead of being invoked by name from every
 * writer — that is what removes the "which render function must I remember
 * to call" class of bugs.
 *
 * Classic script (no build step): exposes window.Store.
 */
(function () {
  "use strict";

  const PERSIST_KEYS = ["products", "inventory", "scans"];
  const STORAGE_PREFIX = "dash_";

  const state = {
    products: {},   // code → product
    inventory: [],
    scans: [],
    workers: [],    // NOTE: must never contain PINs once the backend stops sending them
    role: sessionStorage.getItem("dashRole") || null
  };

  const listeners = new Map(); // key → Set<fn>
  let scanStatsCache = null;   // invalidated whenever scans change

  function get(key) { return state[key]; }

  function set(key, value) {
    state[key] = value;
    if (key === "scans") scanStatsCache = null;
    if (PERSIST_KEYS.includes(key)) persist(key);
    emit(key);
  }

  function subscribe(key, fn) {
    if (!listeners.has(key)) listeners.set(key, new Set());
    listeners.get(key).add(fn);
    return () => listeners.get(key).delete(fn); // unsubscribe handle
  }

  function emit(key) {
    const subs = listeners.get(key);
    if (!subs) return;
    for (const fn of subs) {
      try { fn(state[key]); }
      catch (e) { console.error(`[Store] subscriber for '${key}' threw:`, e); }
    }
  }

  // ── Persistence (same sessionStorage keys the dashboard uses today) ───────
  function persist(key) {
    try {
      sessionStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(state[key]));
    } catch (e) {
      // Quota exceeded on large scan lists is survivable — cache is an optimization.
      console.warn(`[Store] persist '${key}' failed:`, e);
    }
  }

  /** Call once at boot, before the first fetch, so the UI paints instantly. */
  function hydrate() {
    for (const key of PERSIST_KEYS) {
      try {
        const raw = sessionStorage.getItem(STORAGE_PREFIX + key);
        if (raw) state[key] = JSON.parse(raw);
      } catch (e) {
        console.warn(`[Store] hydrate '${key}' failed:`, e);
        sessionStorage.removeItem(STORAGE_PREFIX + key);
      }
    }
    scanStatsCache = null;
  }

  // ── Derived data ───────────────────────────────────────────────────────────
  /** Per-product counts of today's scans. Computed once per scans update —
   *  replaces buildScanStats() maintaining scanStats AND window.todayScanStats
   *  in parallel. */
  function todayScanStats() {
    if (scanStatsCache) return scanStatsCache;
    const todayKey = new Date().toLocaleDateString("en-CA");
    const stats = {};
    for (const s of state.scans) {
      if (!s.timestamp) continue;
      if (new Date(s.timestamp).toLocaleDateString("en-CA") !== todayKey) continue;
      const code = s.code || "";
      const entry = stats[code] || (stats[code] = { produce: 0, done: 0, waste: 0, used: 0, total: 0 });
      if (s.action in entry) entry[s.action]++;
      entry.total++;
    }
    scanStatsCache = stats;
    return stats;
  }

  window.Store = { get, set, subscribe, hydrate, todayScanStats };
})();
