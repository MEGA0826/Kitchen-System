/* Kitchen MEP — js/api.js
 * Unified API client: Supabase-first routing with GAS fallback.
 * Replaces the inline sbGet/sbPost/sbPatch/sbDelete + get()/adminCall() pair
 * in dashboard.html with one client that adds: request timeout, retry with
 * backoff (reads only), in-flight deduplication, and a short read cache.
 *
 * Classic script (no build step): exposes window.Api.
 * Adoption (Phase 1): <script src="js/api.js"></script> before the inline
 * block, then replace `get(params)` call sites with `Api.call(params)`.
 */
(function () {
  "use strict";

  const GAS_URL = "https://script.google.com/macros/s/AKfycbz1aiIySe0-JwsLE4Vq8GyVwxS_7aRxyX48fvAWxP1cBeeOKFUK0w0mf7WCoe-9T8IHtQ/exec";
  const SB_URL  = "https://clntikfffmjytexvzubq.supabase.co";
  const SB_KEY  = window.SB_KEY || ""; // set by the page; never commit new keys here

  const TIMEOUT_MS   = 15000;
  const RETRIES      = 2;        // reads only — writes are never retried blindly
  const CACHE_TTL_MS = 30000;    // short read cache; UI polling stays authoritative

  /** Actions that mutate data. Never retried, never cached, never deduped. */
  const WRITE_ACTIONS = new Set([
    "produce", "done", "waste", "used", "undoScan",
    "saveProduct", "deleteProduct", "saveProductPriority",
    "saveInventory", "deleteInventory",
    "saveWorker", "deleteWorker",
    "saveMenu", "deleteMenu", "saveGR", "deleteGR",
    "saveRecipe", "deleteRecipe", "saveMenuMep", "deleteMenuMep",
    "saveHACCPZone", "deleteHACCPZone", "saveHACCPTask", "deleteHACCPTask",
    "saveHACCPCheck", "saveHACCPTemp",
    "markOrdered", "archiveNow", "reportSendNow",
    "importSalesCSV", "importSalesFromDrive", "importParsedRecipe", "storeChunk"
  ]);

  class ApiError extends Error {
    constructor(message, { status, action, backend } = {}) {
      super(message);
      this.name = "ApiError";
      this.status = status;
      this.action = action;
      this.backend = backend; // "supabase" | "gas"
    }
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  async function fetchJson(url, options = {}, timeoutMs = TIMEOUT_MS) {
    const res = await fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) {
      throw new ApiError(await res.text().catch(() => res.statusText), { status: res.status });
    }
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  async function withRetry(fn, retries) {
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try { return await fn(); }
      catch (e) {
        lastErr = e;
        // Client errors (4xx) are not transient — fail immediately.
        if (e instanceof ApiError && e.status >= 400 && e.status < 500) throw e;
        if (attempt < retries) await sleep(300 * Math.pow(2, attempt));
      }
    }
    throw lastErr;
  }

  // ── Supabase REST ──────────────────────────────────────────────────────────
  function sbHeaders(extraPrefer) {
    const h = {
      apikey: SB_KEY,
      Authorization: "Bearer " + SB_KEY,
      "Content-Type": "application/json",
      Prefer: extraPrefer || "return=representation"
    };
    return h;
  }

  const sb = {
    get: (table, query) =>
      fetchJson(`${SB_URL}/rest/v1/${table}?${query}`, { headers: sbHeaders() }),
    post: (table, body, upsert) =>
      fetchJson(`${SB_URL}/rest/v1/${table}`, {
        method: "POST",
        headers: sbHeaders(upsert ? "resolution=merge-duplicates,return=representation" : undefined),
        body: JSON.stringify(body)
      }),
    patch: (table, query, body) =>
      fetchJson(`${SB_URL}/rest/v1/${table}?${query}`, {
        method: "PATCH", headers: sbHeaders(), body: JSON.stringify(body)
      }),
    delete: (table, query) =>
      fetchJson(`${SB_URL}/rest/v1/${table}?${query}`, {
        method: "DELETE", headers: sbHeaders()
      })
  };

  // ── Row mapping ────────────────────────────────────────────────────────────
  /** snake_case → camelCase for one Supabase row; replaces the per-action
   *  hand-written field maps (drift between them caused missing-field bugs). */
  function mapRow(row, aliases = {}) {
    const out = {};
    for (const [k, v] of Object.entries(row)) {
      const camel = k.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
      out[camel] = v;
    }
    for (const [target, source] of Object.entries(aliases)) out[target] = out[source];
    return out;
  }

  // ── Action registry ────────────────────────────────────────────────────────
  /** Actions migrated to Supabase register here (same idea as _sbActions).
   *  Everything else routes to GAS. */
  const handlers = {};
  function register(action, fn) { handlers[action] = fn; }

  // ── Read cache + in-flight dedupe ─────────────────────────────────────────
  const readCache = new Map();  // key → { at, data }
  const inFlight  = new Map();  // key → Promise

  function cacheKey(params) { return new URLSearchParams(params).toString(); }

  // ── Public entry point ────────────────────────────────────────────────────
  /** Drop-in replacement for get()/adminCall(). Same params, same result
   *  shapes. Reads are deduped, cached briefly, and retried; writes go out
   *  exactly once and surface their errors. */
  async function call(params, { fresh = false } = {}) {
    const action  = params.action || "";
    const isWrite = WRITE_ACTIONS.has(action);
    const key     = cacheKey(params);

    if (!isWrite && !fresh) {
      const hit = readCache.get(key);
      if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;
      const pending = inFlight.get(key);
      if (pending) return pending;
    }

    const exec = async () => {
      if (handlers[action]) {
        try {
          return await handlers[action](params);
        } catch (e) {
          console.warn(`[Api] Supabase '${action}' failed, falling back to GAS:`, e);
        }
      }
      const run = () => fetchJson(GAS_URL + "?" + new URLSearchParams(params));
      return isWrite ? run() : withRetry(run, RETRIES);
    };

    if (isWrite) return exec();

    const promise = exec()
      .then(data => { readCache.set(key, { at: Date.now(), data }); return data; })
      .finally(() => inFlight.delete(key));
    inFlight.set(key, promise);
    return promise;
  }

  function invalidate(actionPrefix) {
    for (const key of readCache.keys()) {
      if (!actionPrefix || key.includes("action=" + actionPrefix)) readCache.delete(key);
    }
  }

  window.Api = { call, register, sb, mapRow, invalidate, ApiError, GAS_URL, SB_URL };
})();
