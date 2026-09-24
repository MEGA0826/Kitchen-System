// ═══════════════════════════════════════════════════════════
// DEMO MODE (module #23) — index.html only, active on ?demo=1
// The scan station has no login, so the public welcome page must never open the
// real kitchen: product names, worker names and stock levels are private. In demo
// mode every backend call is answered from the sample kitchen below, so NO request
// to Supabase or Apps Script is made at all, and nothing can be written.
// Browser storage is sandboxed too, so the demo neither reads a real session's
// cached data nor leaves demo data (or a saved worker name) behind.
// Loaded before the app code in index.html; a no-op unless ?demo is present.
// ═══════════════════════════════════════════════════════════
(function () {
  'use strict';
  try { if (!new URLSearchParams(location.search).has('demo')) return; } catch (e) { return; }

  window.KMEP_DEMO = true;
  try { document.title = 'Kitchen MEP — Demo'; } catch (e) {}   // before first paint

  // ── Sample kitchen — fictional; never real product, worker or business names ──
  const BUSINESS = 'Demo Kitchen';
  const WORKERS = [
    { name: 'Alex M.', rolle: 'Küchenchef', aktiv: true },
    { name: 'Sam K.', rolle: 'Koch', aktiv: true },
    { name: 'Jordan T.', rolle: 'Koch', aktiv: true },
    { name: 'Robin P.', rolle: 'Manager', aktiv: true },
  ];
  const PRODUCTS = {
    'MEP001': { name: 'Tomato Sauce', kategorie: 'Sauces', mepMax: 6, tagesziel: 4, gnSize: 'GN 1/2', gnWeight: 2.5, shelfLife: 3, done: 3, prog: 1 },
    'MEP002': { name: 'Garlic Confit', kategorie: 'Sauces', mepMax: 4, tagesziel: 2, gnSize: 'GN 1/6', gnWeight: 0.8, shelfLife: 5, done: 2, prog: 0 },
    'MEP003': { name: 'Diced Onions', kategorie: 'Vegetables', mepMax: 8, tagesziel: 6, gnSize: 'GN 1/3', gnWeight: 1.5, shelfLife: 2, done: 1, prog: 2 },
    'MEP004': { name: 'Mixed Salad, washed', kategorie: 'Vegetables', mepMax: 6, tagesziel: 5, gnSize: 'GN 1/2', gnWeight: 1.2, shelfLife: 1, done: 0, prog: 0 },
    'MEP005': { name: 'Marinated Chicken', kategorie: 'Proteins', mepMax: 5, tagesziel: 4, gnSize: 'GN 1/2', gnWeight: 3.0, shelfLife: 2, done: 4, prog: 0 },
    'MEP006': { name: 'Herb Butter', kategorie: 'Proteins', mepMax: 3, tagesziel: 2, gnSize: 'GN 1/6', gnWeight: 0.6, shelfLife: 7, done: 1, prog: 1 },
  };
  const PINS = { 'Koch': '1111', 'Küchenchef': '2222', 'Manager': '3333' };

  // Live counters so scanning behaves like the real app (memory only)
  const state = {};
  Object.entries(PRODUCTS).forEach(([c, p]) => { state[c] = { done: p.done, prog: p.prog }; });

  const iso = d => new Date(Date.now() + d * 86400000).toLocaleDateString('en-CA');
  const product = code => {
    const p = PRODUCTS[code], s = state[code];
    if (!p) return null;
    return {
      name: p.name, kategorie: p.kategorie, mepMax: p.mepMax, tagesziel: p.tagesziel,
      gnSize: p.gnSize, gnWeight: p.gnWeight, shelfLife: p.shelfLife, active: true,
      available: s.done, toProduce: Math.max(0, p.tagesziel - s.done - s.prog),
      inProgress: s.prog, doneCount: s.done, produceCount: s.done + s.prog,
      batches: s.done > 0 ? [{ expiryDate: iso(p.shelfLife), qty: s.done }] : [],
    };
  };
  const allProducts = () => {
    const o = {};
    Object.keys(PRODUCTS).forEach(c => { o[c] = product(c); });
    return o;
  };

  function scan(code, action) {
    const s = state[code]; if (!s) return;
    if (action === 'produce') s.prog++;
    else if (action === 'done') { if (s.prog > 0) s.prog--; s.done++; }
    else if (action === 'used' || action === 'waste') { if (s.done > 0) s.done--; }
    else if (action === 'undoScan') { if (s.done > 0) s.done--; }
  }

  // ── Fake backend ────────────────────────────────────────────────────────────
  function answer(url) {
    const u = new URL(url, location.href);
    const action = u.searchParams.get('action') || '';
    const code = u.searchParams.get('code') || '';
    if (u.pathname.indexOf('/rpc/verify_pin') >= 0) return null;   // handled by caller (POST)
    switch (action) {
      case 'allProducts': return allProducts();
      case 'getMepOverview': return { products: allProducts() };
      case 'workers':
      case 'allWorkers': return { workers: WORKERS };
      case 'mepStatus': return product(code) || { error: 'unknown code' };
      case 'getRolePINs': return { pins: PINS };
      case 'verifyPin': {
        const pin = u.searchParams.get('pin') || '';
        const role = Object.keys(PINS).find(r => PINS[r] === pin);
        return role ? { worker: { name: 'Demo ' + role, role: role } } : { error: 'Falscher PIN' };
      }
      case 'undoScan': scan(code, 'undoScan'); return { status: 'ok', demo: true };
      default:
        if (code && action) { scan(code, action); return { status: 'ok', demo: true }; }
        return { status: 'ok', demo: true };
    }
  }

  const realFetch = window.fetch.bind(window);
  const BACKEND = /script\.google\.com|\.supabase\.co/i;
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (!BACKEND.test(url)) return realFetch(input, init);      // fonts, icons, SW…
    let body;
    try {
      if (/\/rpc\/verify_pin/i.test(url)) {
        let pin = '';
        try { pin = JSON.parse((init && init.body) || '{}').p_pin || ''; } catch (e) {}
        const role = Object.keys(PINS).find(r => PINS[r] === pin);
        body = role ? [{ name: 'Demo ' + role, rolle: role }] : [];
      } else {
        body = answer(url);
      }
    } catch (e) { body = { error: 'demo' }; }
    return Promise.resolve(new Response(JSON.stringify(body), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    }));
  };
  // Offline scan queue replays with sendBeacon / navigator — block those too
  if (navigator.sendBeacon) {
    const realBeacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = function (url, data) { return BACKEND.test(String(url)) ? true : realBeacon(url, data); };
  }

  // ── Sandbox storage: no real cached data in, no demo data (or worker) out ────
  [localStorage, sessionStorage].forEach(store => {
    const mem = {};
    const get = store.getItem.bind(store), set = store.setItem.bind(store), del = store.removeItem.bind(store);
    store.getItem = k => (k === 'kmep_theme' || k === 'kmep_lang' ? get(k) : (k in mem ? mem[k] : null));
    store.setItem = (k, v) => { mem[k] = String(v); };
    store.removeItem = k => { delete mem[k]; };
    store._realSet = set; store._realDel = del;
  });

  // ── Badge it clearly ────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', function () {
    document.title = 'Kitchen MEP — ' + BUSINESS + ' (Demo)';
    const bar = document.createElement('div');
    bar.id = 'demoBar';
    bar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:99999;background:#1a1200;color:#fbbf24;' +
      'border-top:1px solid rgba(251,191,36,.45);font:500 12px/1.4 DM Mono,ui-monospace,monospace;' +
      'padding:9px 14px calc(9px + env(safe-area-inset-bottom));display:flex;gap:10px;align-items:center;justify-content:center;flex-wrap:wrap;text-align:center';
    bar.innerHTML = '<span>🎬 <b>Demo</b> — sample data only. Nothing is saved.</span>' +
      '<a href="welcome.html" style="color:#fbbf24;text-decoration:underline">Back to the intro</a>';
    document.body.appendChild(bar);
    const pad = document.createElement('style');
    pad.textContent = 'body{padding-bottom:64px !important}';
    document.head.appendChild(pad);
    // Replace the business name wherever the shell prints it
    document.querySelectorAll('[data-business],.biz-name,#bizName').forEach(el => { el.textContent = BUSINESS; });
  });
})();
