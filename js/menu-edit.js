// Kitchen MEP — Menu editor core (create/edit a menu + its zutaten) — feature module, classic script.
// Extracted from dashboard.html (monolith->modules restructure). Event-driven; entry points are
// inline handlers (openMenuPopup from menu rows / +New Menu, editMenuZutat/removeMenuZutat/
// moveMenuZutat from the zutaten list, calc* from oninput on the menu form).
// Shared editor STATE stays INLINE: menuZutaten[] + editingMenuId (top-level let, global lexical
// env) — written here and read by the inline saveMenuEntry. Shared image helpers (_uploadItemImage,
// _uploadMenuImage), the image preview fns, saveMenuEntry, the calculators (_calcLiveWA/_calcAllergens/
// _enrichZutaten) and the init-coupled menu display (loadMenus/renderMenuList) all stay inline and
// resolve as globals at runtime. Reads shared globals allMenus, allGRs, allRecipes, adminCall, get.

function openMenuPopup(menuId) {
  closeMenu();
  const popup = document.getElementById('menuPopup');
  if (!popup) { console.error('menuPopup element not found'); return; }

  editingMenuId = menuId || null;
  menuZutaten   = [];
  const existing = menuId ? allMenus.find(m => m.id === menuId) : null;

  const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
  const setTxt = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val || ''; };
  const setDisp = (id, val) => { const el = document.getElementById(id); if (el) el.style.display = val; };

  setTxt('mp-popup-title', existing ? 'Menu bearbeiten' : 'Neues Menu');
  setVal('mp-name',        existing?.name        || '');
  setVal('mp-category',    existing?.category    || '');
  setVal('mp-art',         existing?.art         || '');
  setVal('mp-saison',      existing?.saison      || 'All Year');
  setVal('mp-code',        existing?.menuCode    || '');
  setVal('mp-gewicht',     existing?.gewicht     || '');
  setVal('mp-garverlust',  existing?.garverlust  || '');
  setVal('mp-vk',          existing?.vk          || '');
  setVal('mp-zubereitung', existing?.zubereitung || '');
  setVal('mp-wa',          '');

  const fcEl = document.getElementById('mp-fc');
  const nettoEl = document.getElementById('mp-nettogewicht'); if (nettoEl) nettoEl.textContent = '—';
  const effEl = document.getElementById('mp-eff-preis'); if (effEl) effEl.textContent = '—';
  if (fcEl) { fcEl.textContent = '—'; fcEl.style.color = 'var(--amber)'; }

  const msgEl = document.getElementById('mp-msg');
  if (msgEl) { msgEl.textContent = ''; msgEl.className = 'admin-msg'; }

  setDisp('mp-img-preview', 'none');
  setDisp('mp-drive-url',   'none');
  _menuImgFile = null;

  const logo = document.getElementById('mp-logo-preview');
  if (logo) logo.innerHTML = '🍽️';

  const lastUpdate = document.getElementById('mp-lastupdate');
  if (lastUpdate) lastUpdate.textContent = existing?.lastUpdate
    ? new Date(existing.lastUpdate).toLocaleDateString('de-CH')
    : new Date().toLocaleDateString('de-CH');

  if (existing?.imageUrl) {
    const imgEl = document.getElementById('mp-img-el');
    if (imgEl) imgEl.src = existing.imageUrl;
    setDisp('mp-img-preview', 'block');
  }

  if (existing?.zutaten) {
    try { menuZutaten = JSON.parse(existing.zutaten); } catch(e) { menuZutaten = []; }
  }

  renderMenuZutaten();
  calcWaFromZutaten();
  populateMenuFilters();

  popup.style.display = 'flex';
  document.body.style.overflow = 'hidden';

  const viewPopup = document.getElementById('menuViewPopup');
  if (viewPopup) viewPopup.style.display = 'none';
}

function closeMenuPopup() {
  const p = document.getElementById('menuPopup');
  if (p) p.style.display = 'none';
  document.body.style.overflow = '';
  editingMenuId = null;
  closeMenu(); // ← reset hamburger icon
  _onPopupClose();
}

// ─────────────────────────────────────────────
// ZUTATEN RENDER + WA CALC
// ─────────────────────────────────────────────
function renderMenuZutaten(targetList, targetData) {
  const listId     = targetList || 'mp-zutaten-list';
  const data       = targetData || menuZutaten;
  const el         = document.getElementById(listId);
  if (!el) return;
  const isGrTarget = listId === 'gr-zutaten-list';
  const typeColors = { mep:'var(--amber)', rm:'var(--blue)', gr:'var(--green)', menu:'#a855f7' };
  const typeBg     = { mep:'var(--amber-dim)', rm:'var(--blue-dim)', gr:'var(--green-dim)', menu:'rgba(168,85,247,.15)' };
  if (!data.length) {
    const _t = (typeof t === 'function') ? t : (k => k);
    el.innerHTML = `<div style="font-size:12px;color:var(--muted);font-style:italic">${_t('no-ingredients')}</div>`;
  } else {
    el.innerHTML = data.map((z, i) => {
      const _t      = (typeof t === 'function') ? t : (k => k);
      const garvStr   = z.garverlust ? `🔥${z.garverlust}% ${_t('cooking-loss')}` : '';
      const waStr     = z.waTotal    ? `${_t('wa-total')}: ${parseFloat(z.waTotal).toFixed(3)}kg` : '';
      const chfStr    = z.chfKgNetto ? `${_t('chf-kg-netto')}: CHF ${parseFloat(z.chfKgNetto).toFixed(2)}` : '';
      const piecesStr = (z.pieces > 0 && z.piecesTotal > 0) ? `✂️ ${z.pieces}/${z.piecesTotal} Stk` : '';
      const extras  = [piecesStr, garvStr, waStr, chfStr].filter(Boolean).join(' · ');
      // GR sub-recipes are clickable → open that Grundrezeptur (matched by name; codes can drift)
      const nameHtml = z.type === 'gr'
        ? `<span class="zutat-gr-link" data-name="${(z.name||'').replace(/"/g,'&quot;')}" data-code="${z.code||''}" style="color:var(--green);text-decoration:underline;text-underline-offset:2px;cursor:pointer" title="Grundrezeptur öffnen ↗">${z.name||''} <span style="font-size:9px">↗</span></span>`
        : (z.name||'');
      return `<div style="display:flex;align-items:flex-start;gap:7px;padding:8px 10px;background:var(--surface2);border-radius:8px;margin-bottom:3px">
        <span style="font-size:10px;padding:1px 6px;border-radius:4px;background:${typeBg[z.type]||'var(--surface)'};color:${typeColors[z.type]||'var(--text)'};font-weight:700;flex-shrink:0;margin-top:2px">${(z.type||'RM').toUpperCase()}</span>
        <div style="flex:1;min-width:0">
          <div style="font-size:12px;color:var(--text);font-weight:500">${nameHtml}${z.isDeko ? ' <span style="font-size:10px;background:var(--green-dim);color:var(--green);border:1px solid var(--green-brd);border-radius:10px;padding:1px 6px;margin-left:4px">🌿 deko</span>' : ''}${z.isTopping ? ' <span style="font-size:10px;background:var(--amber-dim);color:var(--amber);border:1px solid var(--amber-brd);border-radius:10px;padding:1px 6px;margin-left:4px">🍯 topping</span>' : ''}</div>
          <div style="font-size:10px;color:var(--muted);margin-top:2px;line-height:1.6">
            ${z.gewicht ? `<span>${z.gewicht}kg</span>` : ''}
            ${z.cost    ? `<span style="color:var(--amber)"> · CHF ${parseFloat(z.cost).toFixed(2)}</span>` : ''}
            ${extras    ? `<span style="color:var(--blue)"> · ${extras}</span>` : ''}
            ${z.allergie? `<span style="color:var(--red)"> · ⚠️ ${_t('allergie')}: ${z.allergie}</span>` : ''}
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:2px;flex-shrink:0">
          <button data-idx="${i}" data-isgr="${isGrTarget}" class="zutat-up-btn"
            style="background:var(--surface);border:1px solid var(--border);color:var(--muted);border-radius:4px;padding:1px 6px;cursor:pointer;font-size:11px;line-height:1">▲</button>
          <button data-idx="${i}" data-isgr="${isGrTarget}" class="zutat-dn-btn"
            style="background:var(--surface);border:1px solid var(--border);color:var(--muted);border-radius:4px;padding:1px 6px;cursor:pointer;font-size:11px;line-height:1">▼</button>
        </div>
        <div style="display:flex;gap:4px;flex-shrink:0;margin-top:2px">
          <button data-idx="${i}" data-isgr="${isGrTarget}" class="zutat-edit-btn"
            title="${_t('edit-ingredient')}"
            style="background:var(--amber-dim);border:1px solid var(--amber-brd);color:var(--amber);border-radius:6px;padding:3px 7px;cursor:pointer;font-size:11px">✏️</button>
          <button data-idx="${i}" data-isgr="${isGrTarget}" class="zutat-del-btn"
            style="background:none;border:none;color:var(--red);cursor:pointer;font-size:15px;padding:0 2px">✕</button>
        </div>
      </div>`;
    }).join('');
    el.querySelectorAll('.zutat-edit-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.idx);
        (btn.dataset.isgr === 'true' ? editGrZutat : editMenuZutat)(idx);
      });
    });
    el.querySelectorAll('.zutat-del-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.idx);
        (btn.dataset.isgr === 'true' ? removeGrZutat : removeMenuZutat)(idx);
      });
    });
    el.querySelectorAll('.zutat-up-btn').forEach(btn => {
      btn.addEventListener('click', () => moveMenuZutat(parseInt(btn.dataset.idx), -1, btn.dataset.isgr === 'true'));
    });
    el.querySelectorAll('.zutat-dn-btn').forEach(btn => {
      btn.addEventListener('click', () => moveMenuZutat(parseInt(btn.dataset.idx),  1, btn.dataset.isgr === 'true'));
    });
    // Click a GR sub-recipe ingredient → open that Grundrezeptur for editing.
    el.querySelectorAll('.zutat-gr-link').forEach(link => {
      link.addEventListener('click', (e) => {
        e.stopPropagation();
        const nm = link.dataset.name || '', code = link.dataset.code || '';
        const grs = (typeof allGRs !== 'undefined' && Array.isArray(allGRs)) ? allGRs : [];
        // match by NAME first — menu/GR zutaten GR codes can drift from the GR master
        const gr = grs.find(g => (g.name || '') === nm) || grs.find(g => (g.grCode || '') === code);
        if (gr && typeof openEditGRPopup === 'function') openEditGRPopup(gr.grCode);
        else if (typeof showToast === 'function') showToast('Grundrezeptur nicht gefunden: ' + (nm || code), 'warn');
      });
    });
  }
  if (!targetList) calcWaFromZutaten();
  if (targetList === 'gr-zutaten-list') calcGrPreis && calcGrPreis();
}

function calcWaFromZutaten() {
  const totalWa = menuZutaten.reduce((s, z) => s + (parseFloat(z.cost)   || 0), 0);
  const totalKg = menuZutaten.reduce((s, z) => s + (parseFloat(z.gewicht)|| 0), 0);
  const waEl    = document.getElementById('mp-wa');
  const totEl   = document.getElementById('mp-wa-total');
  const rohEl   = document.getElementById('mp-gewicht');
  if (waEl)  waEl.value = totalWa.toFixed(2);
  if (totEl) totEl.textContent = 'CHF ' + totalWa.toFixed(2);
  // mp-gewicht is in grams (placeholder "1000g"), ingredients are in kg
  if (rohEl && menuZutaten.length) rohEl.value = Math.round(totalKg * 1000);
  calcFC();
  calcGarverlust();
}
  
function calcGarverlust() {
  const rohGewicht = parseFloat((document.getElementById('mp-gewicht')?.value||'').replace(/[^\d.]/g,'')) || 0;
  const verlustPct = parseFloat(document.getElementById('mp-garverlust')?.value) || 0;
  const nettoEl    = document.getElementById('mp-nettogewicht');
  const effEl      = document.getElementById('mp-eff-preis');
  if (!rohGewicht) { if (nettoEl) nettoEl.textContent = '—'; if (effEl) effEl.textContent = '—'; return; }
  const netto = rohGewicht * (1 - verlustPct / 100);
  if (nettoEl) nettoEl.textContent = netto.toFixed(0) + 'g';
  // Effective price per kg from WA
  const wa = parseFloat(document.getElementById('mp-wa')?.value) || 0;
  if (wa > 0 && netto > 0) {
    const effPricePerKg = (wa / (netto / 1000)).toFixed(2);
    if (effEl) effEl.textContent = 'CHF ' + effPricePerKg + ' /kg';
  } else {
    if (effEl) effEl.textContent = '—';
  }
}
function calcGrGarverlust() {
  const rohG    = parseFloat(document.getElementById('gr-gewicht')?.value) || 0;
  const verlust = parseFloat(document.getElementById('gr-garverlust')?.value) || 0;
  const nettoEl = document.getElementById('gr-nettogewicht');
  const effEl   = document.getElementById('gr-eff-preis');
  if (!rohG) { if (nettoEl) nettoEl.textContent = '—'; if (effEl) effEl.textContent = '—'; return; }
  const netto = rohG * (1 - verlust / 100);
  if (nettoEl) nettoEl.textContent = netto.toFixed(3) + ' kg';
  const cost = grZutaten.reduce((s,z) => s+(parseFloat(z.cost)||0), 0);
  if (cost > 0 && netto > 0) {
    if (effEl) effEl.textContent = 'CHF ' + (cost / netto).toFixed(2) + ' /kg';
  } else {
    if (effEl) effEl.textContent = '—';
  }
}
 
function calcFC() {
  const wa = parseFloat(document.getElementById('mp-wa')?.value) || 0;
  const vk = parseFloat(document.getElementById('mp-vk')?.value) || 0;
  const el = document.getElementById('mp-fc');
  if (!el) return;
  if (vk > 0) {
    const fc = (wa / vk * 100).toFixed(1);
    el.textContent = fc + '%';
    el.style.color = parseFloat(fc) > 33 ? 'var(--red)' : 'var(--green)';
  } else {
    el.textContent = '—';
    el.style.color = 'var(--amber)';
  }
}

function removeMenuZutat(i) {
  menuZutaten.splice(i, 1);
  renderMenuZutaten();
}

function moveMenuZutat(i, dir, isGr) {
  const arr = isGr ? agrZutaten : menuZutaten;
  const j = i + dir;
  if (j < 0 || j >= arr.length) return;
  [arr[i], arr[j]] = [arr[j], arr[i]];
  if (isGr) renderMenuZutaten('gr-zutaten-list', agrZutaten);
  else renderMenuZutaten();
}

function editMenuZutat(i) {
  const z = menuZutaten[i];
  if (!z) return;
  _ipEditIdx = i;
  openIngredientPicker(z.type || 'rm', 'menu', true);
  const r = (!z.type || z.type === 'rm') ? _resolveRmCost(z) : { code: z.code, name: z.name, unit: z.unit || '', unitCost: z.unitCost || 0 };
  ipSelectedItem = { code: r.code, name: r.name, unit: r.unit, unitCost: r.unitCost };
  setTimeout(() => {
    const titleEl = document.getElementById('ip-title');
    if (titleEl) titleEl.innerHTML = _ipTypeBtns(z.type || 'rm');
    document.getElementById('ip-selected-name').textContent = r.name + ' (' + r.code + ')';
    document.getElementById('ip-detail').style.display      = 'block';
    document.getElementById('ip-gewicht').value             = z.gewicht     || '';
    document.getElementById('ip-allergie').value            = z.allergie    || '';
    document.getElementById('ip-zubereitung-note').value    = z.zubereitung || '';
    const ipG = document.getElementById('ip-garverlust');
    if (ipG) ipG.value = z.garverlust || '';
    const ipD = document.getElementById('ip-is-deko');
    if (ipD) ipD.checked = z.isDeko || false;
    const ipT = document.getElementById('ip-is-topping');
    if (ipT) ipT.checked = z.isTopping || false;
    calcIpCost(); calcIpWA();
  }, 80);
}

function editGrZutat(i) {
  const z = agrZutaten[i];
  if (!z) return;
  _ipEditIdx = i;
  openIngredientPicker(z.type || 'rm', 'agr', true);
  const r = (!z.type || z.type === 'rm') ? _resolveRmCost(z) : { code: z.code, name: z.name, unit: z.unit || '', unitCost: z.unitCost || 0 };
  ipSelectedItem = { code: r.code, name: r.name, unit: r.unit, unitCost: r.unitCost };
  setTimeout(() => {
    const titleEl = document.getElementById('ip-title');
    if (titleEl) titleEl.innerHTML = _ipTypeBtns(z.type || 'rm');
    document.getElementById('ip-selected-name').textContent = r.name + ' (' + r.code + ')';
    document.getElementById('ip-detail').style.display      = 'block';
    document.getElementById('ip-gewicht').value             = z.gewicht     || '';
    document.getElementById('ip-allergie').value            = z.allergie    || '';
    document.getElementById('ip-zubereitung-note').value    = z.zubereitung || '';
    const ipG = document.getElementById('ip-garverlust');
    if (ipG) ipG.value = z.garverlust || '';
    const ipD = document.getElementById('ip-is-deko');
    if (ipD) ipD.checked = z.isDeko || false;
    const ipT = document.getElementById('ip-is-topping');
    if (ipT) ipT.checked = z.isTopping || false;
    calcIpCost(); calcIpWA();
  }, 80);
}
