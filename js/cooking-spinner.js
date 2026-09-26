// ═══════════════════════════════════════════════════════════
// COOKING SPINNER (module #25) — the save indicator in the recipe editors
// A pan tossing food while a save is in flight, flipping to a plated dish with a
// tick when it lands. Pure inline SVG + CSS: nothing to download, works offline,
// and it keeps animating while the request is out because it never touches JS
// timers for the motion itself.
//
//   kmepCookStart('menuPopup')   → show over that dialog (or the screen if omitted)
//   await kmepCookDone()         → flip to "ready", hold ~700 ms, then remove
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
#${ID} .done{animation:kcPop .42s cubic-bezier(.34,1.56,.64,1) both}
#${ID} .tick{animation:kcDraw .34s ease-out .12s both}
@keyframes kcPop{0%{opacity:0;transform:scale(.55)}100%{opacity:1;transform:scale(1)}}
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
  <ellipse cx="64" cy="76" rx="38" ry="11" fill="#151820" stroke="#e2e8f0" stroke-width="3"/>
  <ellipse cx="64" cy="72" rx="23" ry="7"  fill="#1f1505" stroke="#e8a020" stroke-width="2.5"/>
  <circle cx="96" cy="44" r="15" fill="#071f14" stroke="#34d399" stroke-width="2.5"/>
  <path class="tick" d="M89 44 l5 5 l9 -10" fill="none" stroke="#34d399" stroke-width="3.2"
        stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="26"/>
</g>`;

  function svg(inner, label) {
    return `<svg viewBox="0 0 128 104" width="132" height="108" role="img" aria-label="${label}">${inner}</svg>`;
  }

  window.kmepCookStart = function (anchorId, caption) {
    styles();
    window.kmepCookStop();
    const el = document.createElement('div');
    el.id = ID;
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.innerHTML = `<div class="kcBox">${svg(COOKING, 'Saving')}<div class="kcCap">${caption || 'Speichern…'}</div></div>`;
    // Sit inside the dialog when there is one, so it covers the form and not the
    // whole screen; fixed full-screen otherwise.
    const host = anchorId && document.getElementById(anchorId);
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
    const hold = typeof holdMs === 'number' ? holdMs : 700;
    return new Promise(r => setTimeout(() => { window.kmepCookStop(); r(); }, hold));
  };

  window.kmepCookFail = function () { window.kmepCookStop(); };
})();
