// ═══════════════════════════════════════════════════════════
// DEVICE LOCK (module #24) — index.html only
// The scan station has no login, so anyone with the URL could read the kitchen's
// products, staff and stock. This gate asks for the shared kitchen PIN before any
// backend call is allowed through, and remembers the device for LOCK_DAYS.
//
// The PIN lives server-side (app_settings, unreadable with the anon key) and is
// checked by the verify_access_pin RPC — it is never sent to or stored in the
// browser. Only the "unlocked until" timestamp is kept locally, so a device that
// has been unlocked once keeps working offline.
//
// ⚠️ Scope: this is a deterrent, not access control. The page still carries the
// data URLs, so someone technical can call them directly. Real protection needs
// server-side auth (Supabase RLS + a real session) — see BILLING.md / MIGRATION.md.
//
// Inert until an owner sets a PIN (Dashboard → Admin → Kitchen device PIN), so
// deploying this never locks the kitchen out.
// ═══════════════════════════════════════════════════════════
(function () {
  'use strict';
  if (window.KMEP_DEMO) return;                      // the demo has no real data to protect
  try { if (new URLSearchParams(location.search).has('demo')) return; } catch (e) {}

  var CFG = window.KMEP_CONFIG || {};
  var SB_URL = CFG.SB_URL || '', SB_KEY = CFG.SB_KEY || '';
  if (!SB_URL || !SB_KEY) return;                    // can't verify → don't strand the kitchen

  var LOCK_DAYS = 30;
  var UNLOCK_KEY = 'kmep_unlock';                    // {until:ms}
  var CONFIGURED_KEY = 'kmep_lock_on';               // cached "a PIN exists" — fail closed offline
  var MAX_TRIES = 5, COOLDOWN_MS = 30000;

  var realFetch = window.fetch.bind(window);
  var BACKEND = /script\.google\.com|\.supabase\.co/i;

  function unlockedUntil() {
    try {
      var v = JSON.parse(localStorage.getItem(UNLOCK_KEY) || 'null');
      return v && typeof v.until === 'number' ? v.until : 0;
    } catch (e) { return 0; }
  }
  function isUnlocked() { return unlockedUntil() > Date.now(); }
  function storeUnlock() {
    try {
      localStorage.setItem(UNLOCK_KEY, JSON.stringify({ until: Date.now() + LOCK_DAYS * 86400000 }));
    } catch (e) {}
  }
  function rpc(fn, body) {
    return realFetch(SB_URL + '/rest/v1/rpc/' + fn, {
      method: 'POST',
      headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    }).then(function (r) { return r.ok ? r.json() : Promise.reject(new Error(r.status)); });
  }

  // "Lock now" — usable from the role drawer at any time
  window.kmepLockDevice = function () {
    try { localStorage.removeItem(UNLOCK_KEY); } catch (e) {}
    try { sessionStorage.removeItem('productMap'); sessionStorage.removeItem('mepOverview'); } catch (e) {}
    location.reload();
  };
  window.kmepLockState = function () {
    return { unlocked: isUnlocked(), until: unlockedUntil(), configured: localStorage.getItem(CONFIGURED_KEY) === '1' };
  };

  // "Lock this device" only makes sense once a PIN exists to unlock it again
  function revealLockButton() {
    var b = document.getElementById('lockDeviceBtn');
    if (b && localStorage.getItem(CONFIGURED_KEY) === '1') b.style.display = '';
  }
  document.addEventListener('DOMContentLoaded', revealLockButton);

  if (isUnlocked()) {                                // still within the 30 days
    // Re-check in the background so a PIN set on another device starts gating this
    // one at the next reload, and so the Lock button appears.
    rpc('access_pin_is_set').then(function (on) {
      try { localStorage.setItem(CONFIGURED_KEY, on ? '1' : '0'); } catch (e) {}
      revealLockButton();
    }).catch(function () {});
    return;
  }

  // ── Locked: hold every backend call until the gate is decided ───────────────
  // Held, not rejected: if no PIN is configured the calls simply proceed, so the
  // app never has to deal with errors or a reload.
  var release, gate = new Promise(function (r) { release = r; });
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    if (!BACKEND.test(url)) return realFetch(input, init);
    return gate.then(function (open) {
      return open ? realFetch(input, init)
                  : Promise.reject(new Error('Kitchen MEP: device locked'));
    });
  };
  // Cached API responses from before the lock must not render either
  try { sessionStorage.removeItem('productMap'); sessionStorage.removeItem('mepOverview'); } catch (e) {}

  var overlayShown = false;
  function openGate() { overlayShown = true; if (document.body) render(); else document.addEventListener('DOMContentLoaded', render); }
  function passThrough() { release(true); if (overlayShown) removeOverlay(); }

  // Decide: is a PIN configured at all?
  var known = null;
  try { known = localStorage.getItem(CONFIGURED_KEY); } catch (e) {}
  if (known === '1') openGate();                     // known to be gated → ask immediately
  rpc('access_pin_is_set').then(function (on) {
    try { localStorage.setItem(CONFIGURED_KEY, on ? '1' : '0'); } catch (e) {}
    if (on) { if (!overlayShown) openGate(); }
    else passThrough();                              // no PIN set yet → gate stays inert
  }).catch(function () {
    // Offline/unreachable: keep the gate only if we already knew one exists,
    // otherwise let the app run rather than bricking a device that may be fine.
    if (known === '1') { if (!overlayShown) openGate(); }
    else passThrough();
  });

  // ── UI ─────────────────────────────────────────────────────────────────────
  var entry = '', tries = 0, blockedUntil = 0;

  function removeOverlay() {
    var el = document.getElementById('kmepLock');
    if (el) el.remove();
    document.documentElement.style.overflow = '';
  }

  function render() {
    if (document.getElementById('kmepLock')) return;
    document.documentElement.style.overflow = 'hidden';
    var biz = CFG.businessName || 'Kitchen MEP';
    var el = document.createElement('div');
    el.id = 'kmepLock';
    el.innerHTML =
      '<style>' +
      '#kmepLock{position:fixed;inset:0;z-index:2147483647;background:#0f0f0d;color:#e8e8e8;' +
      'font-family:"DM Mono",ui-monospace,monospace;display:flex;align-items:center;justify-content:center;padding:20px}' +
      '#kmepLock .box{width:100%;max-width:320px;text-align:center}' +
      '#kmepLock .ttl{font-size:15px;font-weight:500;margin:14px 0 2px}' +
      '#kmepLock .sub{font-size:11.5px;color:#7a7a7a;letter-spacing:.4px}' +
      '#kmepLock .dots{display:flex;gap:14px;justify-content:center;margin:26px 0 10px}' +
      '#kmepLock .dot{width:13px;height:13px;border-radius:50%;border:1.5px solid #4a4a46;transition:.15s}' +
      '#kmepLock .dot.on{background:#e8a020;border-color:#e8a020}' +
      '#kmepLock .msg{min-height:18px;font-size:11.5px;color:#f87171;margin-bottom:12px}' +
      '#kmepLock .pad{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}' +
      '#kmepLock button{padding:16px 0;font-size:20px;font-family:inherit;color:#e8e8e8;background:#1a1a18;' +
      'border:1px solid #2e2e2a;border-radius:12px;cursor:pointer;-webkit-tap-highlight-color:transparent}' +
      '#kmepLock button:active{background:#2a2a26}' +
      '#kmepLock button.wide{grid-column:span 1;font-size:15px;color:#9a9a9a}' +
      '#kmepLock .foot{margin-top:18px;font-size:10.5px;color:#5a5a58;line-height:1.6}' +
      '</style>' +
      '<div class="box">' +
      '<div style="font-size:30px">🔒</div>' +
      '<div class="ttl">' + esc(biz) + '</div>' +
      '<div class="sub">Kitchen PIN</div>' +
      '<div class="dots" id="kmepLockDots"><i class="dot"></i><i class="dot"></i><i class="dot"></i><i class="dot"></i></div>' +
      '<div class="msg" id="kmepLockMsg"></div>' +
      '<div class="pad" id="kmepLockPad"></div>' +
      '<div class="foot">Ask your manager for the kitchen PIN.</div>' +
      '</div>';
    document.body.appendChild(el);

    var pad = el.querySelector('#kmepLockPad');
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].forEach(function (k) {
      var b = document.createElement('button');
      if (k === '') { b.style.visibility = 'hidden'; b.disabled = true; }
      b.textContent = k;
      if (k === '⌫') b.className = 'wide';
      b.addEventListener('click', function () { key(k); });
      pad.appendChild(b);
    });
    document.addEventListener('keydown', onKey);
  }

  function onKey(e) {
    if (!document.getElementById('kmepLock')) return;
    if (/^[0-9]$/.test(e.key)) key(e.key);
    else if (e.key === 'Backspace') key('⌫');
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
  function msg(t) { var m = document.getElementById('kmepLockMsg'); if (m) m.textContent = t || ''; }
  function dots() {
    var d = document.querySelectorAll('#kmepLockDots .dot');
    for (var i = 0; i < d.length; i++) d[i].classList.toggle('on', i < entry.length);
  }

  function key(k) {
    if (Date.now() < blockedUntil) return;
    if (k === '⌫') entry = entry.slice(0, -1);
    else if (entry.length < 4) entry += k;
    dots();
    if (entry.length === 4) submit();
  }

  function submit() {
    var pin = entry;
    msg('');
    rpc('verify_access_pin', { p_pin: pin }).then(function (ok) {
      if (ok === true) {
        storeUnlock();
        try { localStorage.setItem(CONFIGURED_KEY, '1'); } catch (e) {}
        msg('');
        location.reload();                            // clean boot with the gate open
        return;
      }
      entry = ''; dots();
      tries++;
      if (tries >= MAX_TRIES) {
        blockedUntil = Date.now() + COOLDOWN_MS;
        tries = 0;
        msg('Too many attempts — wait 30 s');
        setTimeout(function () { msg(''); }, COOLDOWN_MS);
      } else {
        msg('Wrong PIN');
      }
    }).catch(function () {
      entry = ''; dots();
      msg('No connection — try again');
    });
  }
})();
