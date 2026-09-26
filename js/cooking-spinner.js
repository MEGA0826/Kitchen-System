// ═══════════════════════════════════════════════════════════
// COOKING SPINNER (module #25) — the save indicator in the recipe editors
// A pan tossing food while a save is in flight, flipping to a plated dish with a
// tick when it lands. Pure inline SVG + CSS: nothing to download, works offline,
// and it keeps animating while the request is out because it never touches JS
// timers for the motion itself.
//
//   kmepCookStart('menuPopup')   → show over that dialog (or the screen if omitted)
//   await kmepCookDone()         → flip to "ready", hold ~950 ms, then remove
//   kmepCookFail()               → remove at once, so the error message is visible
//
// Safe to call twice; a second start replaces the first. Honours reduced motion.
// ═══════════════════════════════════════════════════════════
(function () {
  'use strict';
  const ID = 'kmepCook';

  function styles() {
    if (document.getElementById(ID + 'Css')) return;
    const st = document.createElement('style');
    st.id = ID + 'Css';
    st.textContent = `
#${ID}{position:fixed;inset:0;z-index:2000;display:flex;align-items:center;justify-content:center;
  background:rgba(8,10,15,.72);backdrop-filter:blur(2px);animation:kcFade .18s ease-out}
#${ID}.anchored{position:absolute}
#${ID} .kcBox{display:flex;flex-direction:column;align-items:center;gap:10px}
#${ID} .kcCap{font-family:'DM Mono',ui-monospace,monospace;font-size:12px;letter-spacing:.06em;
  color:#e8a020;text-transform:uppercase}
#${ID}.ok .kcCap{color:#34d399}
@keyframes kcFade{from{opacity:0}to{opacity:1}}
#${ID} .pan{animation:kcToss 1.15s ease-in-out infinite;transform-origin:64px 74px}
#${ID} .bit{animation:kcHop 1.15s ease-in-out infinite}
#${ID} .bit2{animation:kcHop 1.15s ease-in-out infinite;animation-delay:.12s}
#${ID} .steam,#${ID} .steam2{animation:kcRise 1.9s ease-out infinite}
#${ID} .steam2{animation-delay:.55s}
@keyframes kcToss{0%,100%{transform:rotate(-13deg)}45%{transform:rotate(9deg)}}
@keyframes kcHop{0%,100%{transform:translate(0,0)}40%{transform:translate(5px,-19px)}70%{transform:translate(2px,-5px)}}
@keyframes kcRise{0%{opacity:0;transform:translateY(4px) scaleX(.85)}25%{opacity:.85}100%{opacity:0;transform:translateY(-22px) scaleX(1.25)}}
/* the plate arrives first, then the food, the garnish and finally the tick, so the
   eye lands on the dish rather than the badge; the steam keeps rising so the result
   reads as just-cooked instead of a frozen success icon */
#${ID} .plate{animation:kcPlate .5s cubic-bezier(.34,1.56,.64,1) both}
#${ID} .food {animation:kcFood .42s cubic-bezier(.34,1.56,.64,1) .12s both}
#${ID} .garn {animation:kcGarn .34s ease-out .3s both}
#${ID} .wisp {animation:kcWisp 2.2s ease-out .35s infinite}
#${ID} .wisp2{animation:kcWisp 2.2s ease-out .95s infinite}
#${ID} .badge{animation:kcBadge .4s cubic-bezier(.34,1.56,.64,1) .34s both}
#${ID} .tick {animation:kcDraw .3s ease-out .5s both}
@keyframes kcPlate{0%{opacity:0;transform:translateY(9px) scale(.9)}100%{opacity:1;transform:none}}
@keyframes kcFood {0%{opacity:0;transform:translateY(7px) scale(.7)}100%{opacity:1;transform:none}}
@keyframes kcGarn {0%{opacity:0;transform:scale(.4)}100%{opacity:1;transform:none}}
@keyframes kcWisp {0%{opacity:0;transform:translateY(3px) scaleX(.8)}25%{opacity:.7}100%{opacity:0;transform:translateY(-20px) scaleX(1.3)}}
@keyframes kcBadge{0%{opacity:0;transform:scale(.4)}100%{opacity:1;transform:none}}
@keyframes kcDraw{from{stroke-dashoffset:26}to{stroke-dashoffset:0}}
@media (prefers-reduced-motion:reduce){#${ID} *{animation:none!important}}
`;
    document.head.appendChild(st);
  }

  const COOKING = `
<g class="cookset">
  <ellipse class="steam"  cx="58" cy="52" rx="5" ry="7" fill="#6b7280" opacity="0"/>
  <ellipse class="steam2" cx="70" cy="50" rx="4" ry="6" fill="#6b7280" opacity="0"/>
  <g class="pan">
    <path d="M34 64 h60 a4 4 0 0 1 4 4 v3 a22 22 0 0 1 -22 22 h-24 a22 22 0 0 1 -22 -22 v-3 a4 4 0 0 1 4 -4 z"
          fill="#151820" stroke="#e2e8f0" stroke-width="3"/>
    <path d="M98 68 h22" stroke="#e2e8f0" stroke-width="5" stroke-linecap="round"/>
  </g>
  <circle class="bit"  cx="56" cy="62" r="5.5" fill="#e8a020"/>
  <circle class="bit2" cx="72" cy="62" r="4"   fill="#9ca3af"/>
</g>`;

  const READY = `
<g class="done">
  <ellipse class="wisp"  cx="57" cy="60" rx="4.5" ry="7" fill="#9ca3af" opacity="0"/>
  <ellipse class="wisp2" cx="72" cy="58" rx="4"   ry="6" fill="#9ca3af" opacity="0"/>
  <g class="plate">
    <ellipse cx="64" cy="82" rx="41" ry="13" fill="#151820" stroke="#e2e8f0" stroke-width="3"/>
    <ellipse cx="64" cy="80" rx="28" ry="8.5" fill="none" stroke="#3a4152" stroke-width="1.6"/>
  </g>
  <g class="food">
    <path d="M48 79 q7 -15 16 -15 q9 0 16 15 z" fill="#1f1505" stroke="#e8a020" stroke-width="2.4" stroke-linejoin="round"/>
    <circle cx="58" cy="72" r="2.6" fill="#e8a020" opacity=".55"/>
  </g>
  <g class="garn">
    <path d="M70 66 q6 -5 11 -2 q-4 6 -11 2 z" fill="#34d399"/>
    <circle cx="55" cy="66" r="2.6" fill="#f87171"/>
  </g>
  <g class="badge">
    <circle cx="100" cy="40" r="14.5" fill="#071f14" stroke="#34d399" stroke-width="2.5"/>
    <path class="tick" d="M93.5 40 l4.5 5 l8.5 -9.5" fill="none" stroke="#34d399" stroke-width="3.2"
          stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="26"/>
  </g>
</g>`;

  function svg(inner, label) {
    return `<svg viewBox="0 0 128 104" width="132" height="108" role="img" aria-label="${label}">${inner}</svg>`;
  }

  window.kmepCookStart = function (anchor, caption) {
    styles();
    window.kmepCookStop();
    const el = document.createElement('div');
    el.id = ID;
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.innerHTML = `<div class="kcBox">${svg(COOKING, 'Saving')}<div class="kcCap">${caption || 'Speichern…'}</div></div>`;
    // Sit inside the dialog when there is one, so it covers the form and not the
    // whole screen; fixed full-screen otherwise. Takes an id or an element.
    const host = typeof anchor === 'string' ? document.getElementById(anchor)
               : (anchor && anchor.appendChild ? anchor : null);
    if (host) {
      const pos = getComputedStyle(host).position;
      if (pos === 'static') host.style.position = 'relative';
      el.classList.add('anchored');
      host.appendChild(el);
    } else {
      document.body.appendChild(el);
    }
    return el;
  };

  window.kmepCookStop = function () {
    const el = document.getElementById(ID);
    if (el) el.remove();
  };

  // Flip to the plated dish, hold, then clear. Await it before closing the dialog.
  window.kmepCookDone = function (caption, holdMs) {
    const el = document.getElementById(ID);
    if (!el) return Promise.resolve();
    el.classList.add('ok');
    el.innerHTML = `<div class="kcBox">${svg(READY, 'Saved')}<div class="kcCap">${caption || 'Fertig'}</div></div>`;
    const hold = typeof holdMs === 'number' ? holdMs : 950;   // plate+food+garnish+tick ≈ 800 ms
    return new Promise(r => setTimeout(() => { window.kmepCookStop(); r(); }, hold));
  };

  window.kmepCookFail = function () { window.kmepCookStop(); };

  // ── Automatic coverage for every other Save button ──────────────────────────
  // Every write goes through adminCall, so wrapping it once covers the workers,
  // HACCP zones and tasks, new MEP and products, MEP recipe rows and the PDF
  // quick-add without editing each handler. The four recipe editors still drive it
  // themselves, because there the overlay should also cover the reload and close.
  //
  // Deliberately narrow: only save* actions (a delete is not "cooking"), never while
  // a bulk tool runs (it would add ~1 s per record), never on top of an existing one.
  function topDialog() {
    let best = null, bz = -1;
    document.querySelectorAll('.edit-modal, [id$="Popup"], [id$="Modal"], [id$="modal"]').forEach(el => {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return;
      if (!el.getBoundingClientRect().width) return;
      const z = parseInt(cs.zIndex, 10) || 0;
      if (z >= bz) { bz = z; best = el; }
    });
    return best;
  }

  function wrap() {
    if (typeof window.adminCall !== 'function' || window.adminCall.__kmepWrapped) return;
    const orig = window.adminCall;
    const wrapped = async function (params) {
      const action = String((params && params.action) || '');
      const take = /^save/i.test(action) && !window._kmepBulk && !document.getElementById(ID);
      if (!take) return orig.apply(this, arguments);
      window.kmepCookStart(topDialog());
      try {
        const res = await orig.apply(this, arguments);
        if (res && res.error) { window.kmepCookFail(); return res; }
        await window.kmepCookDone();
        return res;
      } catch (e) { window.kmepCookFail(); throw e; }
    };
    wrapped.__kmepWrapped = true;
    window.adminCall = wrapped;
  }

  // Bulk tools wrap their loop in this, so a 90-record run plays one animation, not 90.
  window.kmepCookBulk = function (on) { window._kmepBulk = !!on; if (on) window.kmepCookStop(); };

  // The PDF importers save many records in a row. Wrapping them here — rather than
  // editing each one — means the flag is cleared in a finally, so a failed import
  // can never leave the rest of the app without its save animation.
  const BULK_FNS = ['startBatchPdfImport', 'applyBatchMatches', 'retryFailedBatch', 'confirmPdfImport'];
  function wrapBulk() {
    BULK_FNS.forEach(name => {
      const fn = window[name];
      if (typeof fn !== 'function' || fn.__kmepBulkWrapped) return;
      const w = async function () {
        window.kmepCookBulk(true);
        try { return await fn.apply(this, arguments); }
        finally { window.kmepCookBulk(false); }
      };
      w.__kmepBulkWrapped = true;
      window[name] = w;
    });
  }

  wrap(); wrapBulk();
  document.addEventListener('DOMContentLoaded', function () { wrap(); wrapBulk(); });
})();
