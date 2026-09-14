// Kitchen MEP — GR & MEP read-only "PDF" detail views (mirror the Menu view). Feature module,
// classic script, loaded via <script src> before </body>. Entry points are inline handlers:
// openGrView / openMepView (from a GR/MEP list-row name click, or a GR link inside a Menu view) and
// the view popups' Bearbeiten/Drucken/Close buttons. Shared state _viewingGr/_viewingMep (top-level
// let, global-lexical) stays here. Reads globals: allGRs, allMenus, allProducts, allRecipes,
// allInventory, openEditGRPopup, openEditProductModal, _calcNutrition, _euAllergenLabel,
// _calcMenuNettoKg, _calcMepWA, _calcMepAllergens, toDirectImg, kmepSetting, _onPopupOpen/_onPopupClose,
// closeMenu, showToast.

let _viewingGr = null;
let _viewingMep = null;

function _rvImg(u) { return (typeof toDirectImg === 'function') ? toDirectImg(u) : (u || ''); }
function _rvEsc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function _rvBiz() { return (typeof kmepSetting === 'function') ? kmepSetting('bizName', '212 Nooch Richti') : '212 Nooch Richti'; }
function _rvCur() { return (typeof kmepSetting === 'function') ? kmepSetting('currency', 'CHF') : 'CHF'; }

// Ingredient rows for a zutaten array (RM rows + nested GR sub-recipe rows). GR names are clickable
// links (→ openGrView) when interactive; the print path renders them as plain text.
function _rvZutatRows(zutaten, cur, interactive) {
  return zutaten.map(z => {
    if (z.type === 'gr') {
      const grSubs = Array.isArray(z.zutaten) ? z.zutaten : [];
      return `<tr style="background:#f7f5f0">
        <td style="padding:4px 6px;font-size:10px;color:#2d8a5e;font-weight:700">GR</td>
        <td style="padding:4px 6px;font-size:10px;font-weight:600">${z.gewicht ? z.gewicht + ' kg' : '—'}</td>
        <td style="padding:4px 6px;font-size:11px;font-weight:700">${interactive
          ? `<span class="zutat-gr-link" data-name="${(z.name || '').replace(/"/g, '&quot;')}" data-code="${z.code || ''}" style="color:#2d8a5e;text-decoration:underline;text-underline-offset:2px;cursor:pointer" title="Grundrezeptur öffnen ↗">${_rvEsc(z.name || '')} <span style="font-size:9px">↗</span></span>`
          : _rvEsc(z.name || '')} <span style="font-weight:400;color:#888">(${_rvEsc(z.art || '')})</span></td>
        <td style="padding:4px 6px;font-size:10px;color:#e8a020">${cur} ${parseFloat(z.cost || 0).toFixed(2)}</td>
      </tr>${grSubs.map(s => `<tr>
        <td style="padding:2px 6px 2px 18px;font-size:9px;color:#888">↳ ${(s.type || 'RM').toUpperCase()}</td>
        <td style="padding:2px 6px;font-size:9px;color:#888">${s.gewicht ? s.gewicht + ' kg' : ''}</td>
        <td style="padding:2px 6px;font-size:10px">${_rvEsc(s.name || '')}</td>
        <td style="padding:2px 6px;font-size:9px;color:#888">${_rvEsc(s.allergie || '')}</td>
      </tr>`).join('')}`;
    }
    return `<tr>
      <td style="padding:4px 6px;font-size:10px;color:#555">${(z.type || 'RM').toUpperCase()}</td>
      <td style="padding:4px 6px;font-size:10px">${z.gewicht ? z.gewicht + ' kg' : '—'}</td>
      <td style="padding:4px 6px;font-size:11px;font-weight:500">${_rvEsc(z.name || '')}</td>
      <td style="padding:4px 6px;font-size:10px;color:#e8a020">${z.cost ? cur + ' ' + parseFloat(z.cost).toFixed(2) : ''}${z.allergie ? '<br><span style="color:#888">⚠️' + _rvEsc(z.allergie) + '</span>' : ''}</td>
    </tr>`;
  }).join('');
}

function _rvAllergenBox(zutatenStr) {
  const A = (typeof _euAllergenLabel === 'function') ? _euAllergenLabel(zutatenStr) : [];
  return `<div style="padding:12px 20px;border-bottom:1px solid #eee">
    <div style="font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin-bottom:8px;color:#1a1a16">Allergene (EU)</div>
    ${A.length
      ? `<div style="display:flex;flex-wrap:wrap;gap:6px">${A.map(a => `<span style="display:inline-flex;align-items:center;gap:5px;font-size:11px;background:#fbeaea;color:#b23b3b;border:1px solid #e6c3c3;border-radius:20px;padding:2px 10px"><strong>${a.code}</strong>${a.name}</span>`).join('')}</div>
         <div style="font-size:10px;color:#888;margin-top:6px">Enthält: <strong>${A.map(a => a.code).join(', ')}</strong></div>`
      : `<div style="font-size:11px;color:#2d8a5e">Keine deklarationspflichtigen Allergene erfasst.</div>`}
  </div>`;
}

function _rvNutriBox(zutatenStr) {
  const N = (typeof _calcNutrition === 'function') ? _calcNutrition(zutatenStr) : { hasData: false, kcal: 0, protein: 0, fat: 0, carbs: 0 };
  const nettoKg = (typeof _calcMenuNettoKg === 'function') ? (_calcMenuNettoKg(zutatenStr) || 0) : 0;
  const per100 = v => (nettoKg > 0 ? v / (nettoKg * 10) : 0);
  const rows = [
    ['Energie', Math.round(N.kcal) + ' kcal', nettoKg > 0 ? Math.round(per100(N.kcal)) + ' kcal' : '—'],
    ['Protein', N.protein.toFixed(1) + ' g', nettoKg > 0 ? per100(N.protein).toFixed(1) + ' g' : '—'],
    ['Fett', N.fat.toFixed(1) + ' g', nettoKg > 0 ? per100(N.fat).toFixed(1) + ' g' : '—'],
    ['Kohlenhydrate', N.carbs.toFixed(1) + ' g', nettoKg > 0 ? per100(N.carbs).toFixed(1) + ' g' : '—'],
  ];
  return `<div style="padding:12px 20px;border-bottom:1px solid #eee">
    <div style="font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin-bottom:8px;color:#1a1a16">Nährwerte</div>
    ${N.hasData
      ? `<table style="width:100%;border-collapse:collapse;max-width:340px"><thead><tr style="background:#f0ede6"><th style="padding:3px 6px;font-size:8px;text-align:left;color:#888">Nährwert</th><th style="padding:3px 6px;font-size:8px;text-align:right;color:#888">gesamt${nettoKg > 0 ? ' (' + nettoKg.toFixed(2) + ' kg)' : ''}</th><th style="padding:3px 6px;font-size:8px;text-align:right;color:#888">pro 100g</th></tr></thead><tbody>${rows.map(r => `<tr><td style="padding:3px 6px;font-size:11px">${r[0]}</td><td style="padding:3px 6px;font-size:11px;text-align:right;font-weight:600">${r[1]}</td><td style="padding:3px 6px;font-size:11px;text-align:right;color:#555">${r[2]}</td></tr>`).join('')}</tbody></table>`
      : `<div style="font-size:11px;color:#999;font-style:italic">Noch keine Nährwertdaten.</div>`}
  </div>`;
}

// ── GR PDF ──────────────────────────────────────────────────────────────────
function buildGrPdfHtml(g, interactive) {
  const cur = _rvCur(), bn = _rvBiz();
  const zutaten = (() => { try { return JSON.parse(g.zutaten || '[]'); } catch (e) { return []; } })();
  const roh = parseFloat(g.rohgewicht || 0), verl = parseFloat(g.garverlust || 0);
  const netto = roh > 0 ? roh * (1 - verl / 100) : ((typeof _calcMenuNettoKg === 'function') ? (_calcMenuNettoKg(g.zutaten) || 0) : 0);
  const wa = parseFloat(g.wa || 0);
  const meta = [['Code', g.grCode || g.code], ['Art', g.art || 'Grundrezeptur'], ['Rohgewicht', roh ? roh + ' kg' : '—'], ['Garverlust', verl ? verl + '%' : '—'], ['Netto', netto ? netto.toFixed(3) + ' kg' : '—'], ['WA', cur + ' ' + wa.toFixed(2)]];
  const rows = _rvZutatRows(zutaten, cur, interactive);
  return `<div style="font-family:monospace,sans-serif;color:#1a1a16;min-height:500px">
    <div style="background:#14231a;padding:18px 24px;display:flex;align-items:center;gap:16px">
      <div style="flex:1"><div style="font-size:20px;font-weight:700;color:#fff">${_rvEsc(g.name || g.grCode || '—')}</div>
      <div style="font-size:10px;color:#5fbf8f;letter-spacing:2px;text-transform:uppercase;margin-top:3px">Grundrezeptur · ${_rvEsc(bn)}</div></div>
      ${g.image ? `<img src="${_rvImg(g.image)}" style="width:150px;height:100px;object-fit:cover;border-radius:8px">` : ''}
    </div>
    <div style="background:#f2f6f3;border-bottom:2px solid #2d8a5e;padding:8px 24px;display:flex;gap:24px;flex-wrap:wrap">
      ${meta.map(([l, v]) => `<div><div style="font-size:8px;letter-spacing:2px;text-transform:uppercase;color:#888">${l}</div><div style="font-size:12px;font-weight:600;color:#1a1a16">${v || '—'}</div></div>`).join('')}
    </div>
    <div style="padding:16px 20px;border-bottom:1px solid #eee">
      <div style="font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin-bottom:8px;color:#1a1a16">Zutaten</div>
      <table style="width:100%;border-collapse:collapse"><thead><tr style="background:#f0ede6">
        <th style="padding:3px 6px;font-size:8px;text-align:left;color:#888">Art</th><th style="padding:3px 6px;font-size:8px;text-align:left;color:#888">Menge</th><th style="padding:3px 6px;font-size:8px;text-align:left;color:#888">Name</th><th style="padding:3px 6px;font-size:8px;text-align:left;color:#888">Kosten / Allergie</th>
      </tr></thead><tbody>${rows || `<tr><td colspan="4" style="padding:8px;font-size:11px;color:#999;font-style:italic">Keine Zutaten</td></tr>`}</tbody></table>
    </div>
    ${_rvAllergenBox(g.zutaten)}
    ${_rvNutriBox(g.zutaten)}
    ${g.zubereitung ? `<div style="padding:16px 20px;border-bottom:1px solid #eee"><div style="font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin-bottom:8px;color:#1a1a16">Zubereitung</div><div style="font-size:11px;color:#333;line-height:1.8;white-space:pre-wrap">${_rvEsc(g.zubereitung)}</div></div>` : ''}
    <div style="padding:8px 24px;border-top:1px solid #eee;display:flex;justify-content:space-between;font-size:9px;color:#aaa"><span>Mutationsdatum ${g.lastUpdate ? new Date(g.lastUpdate).toLocaleDateString('de-CH') : '—'}</span><span>Kitchen MEP · ${_rvEsc(bn)}</span></div>
  </div>`;
}

// Resolve a GR by code (then name) from the GR sheet, falling back to the Menus sheet (art=Grundrezeptur).
function _rvFindGr(grCode, name) {
  const grs = (typeof allGRs !== 'undefined' && Array.isArray(allGRs)) ? allGRs : [];
  let g = grCode ? grs.find(x => (x.grCode || '') === grCode) : null;
  if (!g && name) g = grs.find(x => (x.name || '') === name);
  if (!g) {
    const menus = (typeof allMenus !== 'undefined' && Array.isArray(allMenus)) ? allMenus : [];
    const m = (grCode ? menus.find(x => (x.menuCode || x.code || '') === grCode && (x.art || '') === 'Grundrezeptur') : null)
      || (name ? menus.find(x => (x.name || '') === name && (x.art || '') === 'Grundrezeptur') : null);
    if (m) g = { grCode: m.menuCode || m.code, name: m.name, art: 'Grundrezeptur', rohgewicht: m.gewicht, garverlust: m.garverlust, wa: m.wa, zutaten: m.zutaten, zubereitung: m.zubereitung, lastUpdate: m.lastUpdate, image: m.image };
  }
  return g;
}

function openGrView(grCode, name) {
  if (typeof closeMenu === 'function') closeMenu();
  const g = _rvFindGr(grCode, name);
  if (!g) { if (typeof showToast === 'function') showToast('Grundrezeptur nicht gefunden: ' + (name || grCode), 'warn'); return; }
  _viewingGr = g;
  const t = document.getElementById('grv-title'); if (t) t.textContent = g.name || g.grCode || 'GR';
  const sheet = document.getElementById('grViewSheet');
  sheet.innerHTML = buildGrPdfHtml(g, true);
  sheet.querySelectorAll('.zutat-gr-link').forEach(link => {
    link.addEventListener('click', e => { e.stopPropagation(); openGrView(link.dataset.code || '', link.dataset.name || ''); });
  });
  document.getElementById('grViewPopup').style.display = 'block';
  if (typeof _onPopupOpen === 'function') _onPopupOpen();
}
function closeGrView() { const v = document.getElementById('grViewPopup'); if (v) v.style.display = 'none'; if (typeof _onPopupClose === 'function') _onPopupClose(); }
function editCurrentGrView() { if (!_viewingGr) return; closeGrView(); if (typeof openEditGRPopup === 'function') openEditGRPopup(_viewingGr.grCode); }
function printCurrentGrView() {
  if (!_viewingGr) return;
  const html = buildGrPdfHtml(_viewingGr, false);
  const w = window.open('', '_blank'); if (!w) return;
  w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${_rvEsc(_viewingGr.name || 'GR')}</title><style>body{margin:0;font-family:monospace}@media print{body{margin:0}}</style></head><body>${html}<script>window.onload=()=>{window.print();window.onafterprint=()=>window.close();}<\/script></body></html>`);
  w.document.close();
}

// ── MEP PDF ─────────────────────────────────────────────────────────────────
function buildMepPdfHtml(code) {
  const cur = _rvCur(), bn = _rvBiz();
  const p = (typeof allProducts !== 'undefined' && allProducts[code]) ? allProducts[code] : {};
  const recs = (typeof allRecipes !== 'undefined' && Array.isArray(allRecipes)) ? allRecipes.filter(r => (r.mepCode || '') === code) : [];
  const invBy = c => (typeof allInventory !== 'undefined' && Array.isArray(allInventory)) ? allInventory.find(x => x.code === c) : null;
  const waObj = (typeof _calcMepWA === 'function') ? _calcMepWA(code) : null;
  const gnW = parseFloat(p.gnWeight || 0);
  const waStr = waObj ? (gnW > 0 ? cur + ' ' + (waObj.waPerGN / gnW / 10).toFixed(2) + '/100g' : cur + ' ' + waObj.waPerGN.toFixed(2) + '/GN') : '—';
  const meta = [['Code', code], ['Kategorie', p.kategorie], ['GN-Size', p.gnSize], ['GN-Gewicht', gnW ? gnW + ' kg' : '—'], ['MEP Max', p.mepMax], ['Tagesziel', p.tagesziel], ['WA', waStr]];
  const rows = recs.map(r => {
    const i = invBy(r.rmCode) || {};
    const wu = parseFloat(i.weightUnit) || 1;
    const cost = (parseFloat(r.menge) || 0) * ((parseFloat(i.kostenUnit) || 0) / wu);
    return `<tr><td style="padding:4px 6px;font-size:10px;color:#555">${_rvEsc(r.rmCode || '')}</td><td style="padding:4px 6px;font-size:10px">${r.menge ? parseFloat(r.menge) + ' ' + (r.einheit || 'kg') : '—'}</td><td style="padding:4px 6px;font-size:11px;font-weight:500">${_rvEsc(i.name || r.rmName || r.rmCode || '')}</td><td style="padding:4px 6px;font-size:10px;color:#e8a020">${cost ? cur + ' ' + cost.toFixed(2) : ''}</td></tr>`;
  }).join('');
  const allg = (typeof _calcMepAllergens === 'function') ? _calcMepAllergens(code) : [];
  return `<div style="font-family:monospace,sans-serif;color:#1a1a16;min-height:480px">
    <div style="background:#2a2012;padding:18px 24px;display:flex;align-items:center;gap:16px">
      <div style="flex:1"><div style="font-size:20px;font-weight:700;color:#fff">${_rvEsc(p.name || code)}</div>
      <div style="font-size:10px;color:#e8a020;letter-spacing:2px;text-transform:uppercase;margin-top:3px">MEP Produkt · ${_rvEsc(bn)}</div></div>
      ${(p.image || p.driveLink) ? `<img src="${_rvImg(p.image || p.driveLink)}" style="width:150px;height:100px;object-fit:cover;border-radius:8px">` : ''}
    </div>
    <div style="background:#faf6ef;border-bottom:2px solid #e8a020;padding:8px 24px;display:flex;gap:24px;flex-wrap:wrap">
      ${meta.map(([l, v]) => `<div><div style="font-size:8px;letter-spacing:2px;text-transform:uppercase;color:#888">${l}</div><div style="font-size:12px;font-weight:600;color:#1a1a16">${(v == null || v === '') ? '—' : v}</div></div>`).join('')}
    </div>
    <div style="padding:16px 20px;border-bottom:1px solid #eee">
      <div style="font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin-bottom:8px;color:#1a1a16">Rezept (Rohstoffe)</div>
      <table style="width:100%;border-collapse:collapse"><thead><tr style="background:#f0ede6"><th style="padding:3px 6px;font-size:8px;text-align:left;color:#888">RM-Code</th><th style="padding:3px 6px;font-size:8px;text-align:left;color:#888">Menge</th><th style="padding:3px 6px;font-size:8px;text-align:left;color:#888">Name</th><th style="padding:3px 6px;font-size:8px;text-align:left;color:#888">Kosten</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="4" style="padding:8px;font-size:11px;color:#999;font-style:italic">Kein Rezept erfasst</td></tr>`}</tbody></table>
    </div>
    <div style="padding:12px 20px;border-bottom:1px solid #eee">
      <div style="font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin-bottom:8px;color:#1a1a16">Allergene</div>
      ${allg.length ? `<div style="display:flex;flex-wrap:wrap;gap:6px">${allg.map(a => `<span style="font-size:11px;background:#fbeaea;color:#b23b3b;border:1px solid #e6c3c3;border-radius:20px;padding:2px 10px">${_rvEsc(a)}</span>`).join('')}</div>` : `<div style="font-size:11px;color:#2d8a5e">Keine erfasst.</div>`}
    </div>
    ${p.notizen ? `<div style="padding:16px 20px;border-bottom:1px solid #eee"><div style="font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin-bottom:8px;color:#1a1a16">Notizen</div><div style="font-size:11px;color:#333;line-height:1.8;white-space:pre-wrap">${_rvEsc(p.notizen)}</div></div>` : ''}
    <div style="padding:8px 24px;border-top:1px solid #eee;display:flex;justify-content:flex-end;font-size:9px;color:#aaa"><span>Kitchen MEP · ${_rvEsc(bn)}</span></div>
  </div>`;
}

function openMepView(code) {
  if (typeof closeMenu === 'function') closeMenu();
  const p = (typeof allProducts !== 'undefined') ? allProducts[code] : null;
  if (!p) { if (typeof showToast === 'function') showToast('MEP nicht gefunden: ' + code, 'warn'); return; }
  _viewingMep = code;
  const t = document.getElementById('mepv-title'); if (t) t.textContent = p.name || code;
  document.getElementById('mepViewSheet').innerHTML = buildMepPdfHtml(code);
  document.getElementById('mepViewPopup').style.display = 'block';
  if (typeof _onPopupOpen === 'function') _onPopupOpen();
}
function closeMepView() { const v = document.getElementById('mepViewPopup'); if (v) v.style.display = 'none'; if (typeof _onPopupClose === 'function') _onPopupClose(); }
function editCurrentMepView() { if (!_viewingMep) return; closeMepView(); if (typeof openEditProductModal === 'function') openEditProductModal(_viewingMep); }
function printCurrentMepView() {
  if (!_viewingMep) return;
  const html = buildMepPdfHtml(_viewingMep);
  const w = window.open('', '_blank'); if (!w) return;
  w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${_rvEsc((allProducts[_viewingMep] || {}).name || 'MEP')}</title><style>body{margin:0;font-family:monospace}@media print{body{margin:0}}</style></head><body>${html}<script>window.onload=()=>{window.print();window.onafterprint=()=>window.close();}<\/script></body></html>`);
  w.document.close();
}
