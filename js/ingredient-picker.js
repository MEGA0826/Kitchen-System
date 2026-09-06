/* ingredient-picker.js — the shared ingredient/GR picker modal (module 20), extracted from dashboard.html.
   19 fns: the RM/MEP/GR/Menu picker (open/close/filter/select + piece & portion & cost & WA
   calculators + confirmIngredient) and the GR sub-picker (openGrPopup/closeGrPopup/filterGrPicker/
   selectGrItem/calcGrPickerCost/confirmGr). confirmIngredient/confirmGr push into the active recipe's
   ingredient array depending on ipContext. ALL picker state stays INLINE (global lexical env), shared with
   the menu/GR/MEP editor modules: ipMode/ipContext/ipSelectedItem/_ipEditIdx/_grSelectedItem and the
   working arrays menuZutaten/agrZutaten/mepAddZutaten. Entry points are event-driven (editor "+ add"
   buttons, inline onclick/oninput). Reads globals: allProducts/allRecipes/allInventory/allGRs/allMenus,
   _calcMenuNettoKg/_calcLiveWA (recipe-calc), renderMenuZutaten/renderAgrZutaten/renderMepAddZutaten,
   _onPopupOpen/_onPopupClose, closeMenu, t. */
// ─────────────────────────────────────────────
// INGREDIENT PICKER
// ─────────────────────────────────────────────
function _ipTypeBtns(active) {
  const types = [
    {id:'rm',   label:'RM',   c:'var(--blue)',  bg:'var(--blue-dim)',       brd:'var(--blue-brd)'},
    {id:'mep',  label:'MEP',  c:'var(--amber)', bg:'var(--amber-dim)',      brd:'var(--amber-brd)'},
    {id:'gr',   label:'GR',   c:'var(--green)', bg:'var(--green-dim)',      brd:'var(--green-brd)'},
    {id:'menu', label:'Menu', c:'#a855f7',      bg:'rgba(168,85,247,.15)',  brd:'rgba(168,85,247,.4)'},
  ];
  return types.map(({id, label, c, bg, brd}) => {
    const on = id === (active||'').toLowerCase();
    return `<button type="button" onclick="setIpMode('${id}')" style="padding:3px 10px;border-radius:6px;border:1px solid ${on?brd:'var(--border2)'};font-size:11px;cursor:pointer;font-family:var(--mono);background:${on?bg:'var(--surface)'};color:${on?c:'var(--muted)'}">${label}</button>`;
  }).join('');
}
function setIpMode(mode) {
  ipMode = mode;
  ipSelectedItem = null;
  const d = document.getElementById('ip-detail');       if (d)  d.style.display = 'none';
  const t = document.getElementById('ip-title');        if (t)  t.innerHTML = _ipTypeBtns(mode);
  const pw = document.getElementById('ip-portions-wrap'); if (pw) pw.style.display = 'none';
  const p  = document.getElementById('ip-portions');     if (p)  p.value = '';
  const pcw = document.getElementById('ip-pieces-wrap'); if (pcw) pcw.style.display = 'none';
  const pcn = document.getElementById('ip-pieces-need');  if (pcn)  pcn.value = '';
  const pct = document.getElementById('ip-pieces-total'); if (pct) pct.value = '';
  filterIngredientPicker();
}

function openIngredientPicker(mode, context, keepEditIdx) {
  closeMenu();
  ipMode    = mode;
  ipContext = context || 'menu';
  ipSelectedItem = null;
  if (!keepEditIdx) _ipEditIdx = -1;
  const titleEl = document.getElementById('ip-title');
  if (titleEl) titleEl.innerHTML = _ipTypeBtns(mode);
  document.getElementById('ip-search').value = '';
  document.getElementById('ip-detail').style.display = 'none';
  document.getElementById('ip-gewicht').value = '';
  document.getElementById('ip-allergie').value = '';
  document.getElementById('ip-zubereitung-note').value = '';
  document.getElementById('ip-cost-display').textContent = '—';
  const _ipGarv = document.getElementById('ip-garverlust'); if (_ipGarv) _ipGarv.value = '';
  const _ipWa   = document.getElementById('ip-wa-total');   if (_ipWa)   _ipWa.textContent = '—';
  const _ipChf  = document.getElementById('ip-chf-netto');  if (_ipChf)  _ipChf.textContent = '—';
  const ipD = document.getElementById('ip-is-deko');
  if (ipD) ipD.checked = false;
  const ipT2 = document.getElementById('ip-is-topping');
  if (ipT2) ipT2.checked = false;
  const _ipPW = document.getElementById('ip-portions-wrap'); if (_ipPW) _ipPW.style.display = 'none';
  const _ipP  = document.getElementById('ip-portions');      if (_ipP)  _ipP.value = '';
  const _ipPcW = document.getElementById('ip-pieces-wrap'); if (_ipPcW) _ipPcW.style.display = 'none';
  const _ipPcN = document.getElementById('ip-pieces-need');  if (_ipPcN)  _ipPcN.value = '';
  const _ipPcT = document.getElementById('ip-pieces-total'); if (_ipPcT) _ipPcT.value = '';
  document.getElementById('ingredientPickerPopup').style.display = 'flex';
  _onPopupOpen();
  filterIngredientPicker();
}

function closeIngredientPicker() {
  document.getElementById('ingredientPickerPopup').style.display = 'none';
  _ipEditIdx = -1;
  _onPopupClose();
}

function filterIngredientPicker() {
  const q = (document.getElementById('ip-search').value || '').toLowerCase();
  const items = ipMode === 'mep'
    ? Object.entries(allProducts)
        .filter(([,p]) => p.name && p.name !== '(deleted)')
        .map(([code,p]) => {
          let waPerGN = 0;
          allRecipes.filter(r => r.mepCode === code).forEach(r => {
            const inv = allInventory.find(x => x.code === r.rmCode) || {};
            const wu  = parseFloat(inv.weightUnit) || 1;
            waPerGN += (parseFloat(r.menge) || 0) * ((parseFloat(inv.kostenUnit) || 0) / wu);
          });
          if (!waPerGN) waPerGN = parseFloat(p.wa) || 0;
          return { code, name: p.name, unitCost: waPerGN, _isPerGN: true };
        })
    : ipMode === 'gr'
    ? (allGRs || []).map(g => {
        const waTotal = parseFloat(g.wa) || 0;
        const netto = _calcMenuNettoKg(g.zutaten) || (parseFloat(g.rohgewicht||0) * (1 - (parseFloat(g.garverlust||0)/100)));
        const unitCost = (netto > 0 && waTotal > 0) ? waTotal / netto : waTotal;
        return { code: g.grCode||g.id, name: g.name||g.grCode, unitCost, _grNetto: netto, _grWa: waTotal };
      })
    : ipMode === 'menu'
    ? (allMenus || [])
        .filter(m => (m.art||'') !== 'Grundrezeptur')
        .map(m => {
          const wa = parseFloat(m.wa||0) || (_calcLiveWA(m.zutaten) ?? 0);
          const nettoKg = _calcMenuNettoKg(m.zutaten);
          const unitCost = (nettoKg > 0 && wa > 0) ? wa / nettoKg : wa;
          return { code: m.menuCode||m.id||'', name: m.name||'', _art: m.art||'', unitCost, _menuNetto: nettoKg, _menuWa: wa };
        })
    : allInventory.filter(r => r.code)
        .map(r => ({ code: r.code, name: r.name||r.code, unit: r.unit||'kg', unitCost: parseFloat(r.kostenUnit||r.kosten||0)||0 }));
  const filtered = q ? items.filter(i => (i.name||'').toLowerCase().includes(q) || (i.code||'').toLowerCase().includes(q)) : items;
  const el = document.getElementById('ip-list');
  if (!filtered.length) { el.innerHTML = `<div style="font-size:12px;color:var(--muted)">Keine Ergebnisse.</div>`; return; }
  el.innerHTML = filtered.slice(0,40).map(i => {
    const sc = (i.code||'').replace(/"/g,'&quot;');
    const sn = (i.name||'').replace(/"/g,'&quot;');
    const su = (i.unit||'').replace(/"/g,'&quot;');
    return `<div class="ing-pick-row" data-code="${sc}" data-name="${sn}" data-unit="${su}" data-cost="${i.unitCost||0}" data-pergn="${i._isPerGN?'1':'0'}" data-netto="${i._grNetto||i._menuNetto||0}" data-wa="${i._grWa||i._menuWa||0}"
      style="padding:8px 12px;border-radius:8px;background:var(--surface2);cursor:pointer;font-size:12px;color:var(--text);border:1px solid transparent"
      onmouseover="this.style.borderColor='var(--amber-brd)'" onmouseout="this.style.borderColor='transparent'">
      <span style="font-weight:500">${i.name}</span>
      ${i._art ? `<span style="font-size:10px;color:#a855f7;background:rgba(168,85,247,.12);border-radius:4px;padding:1px 5px;margin-left:5px">${i._art}</span>` : ''}
      <span style="font-size:10px;color:var(--muted);margin-left:6px">${i.code}</span>
      ${i.unitCost ? `<span style="font-size:10px;color:var(--amber);margin-left:4px">CHF ${parseFloat(i.unitCost).toFixed(2)}${ipMode==='rm'||ipMode==='RM' ? '/'+( i.unit||'unit') : ipMode==='mep'||ipMode==='MEP' ? '/GN' : ''}</span>` : ''}
    </div>`;
  }).join('');
}

function selectIngredientItem(code, name, unit, unitCost, _itemNetto, _itemWa) {
  const prevWeight = document.getElementById('ip-gewicht')?.value || '';
  // For RM: always re-read fresh unitCost from allInventory in case it was 0 in template
  let resolvedCost = parseFloat(unitCost) || 0;
  if (ipMode === 'rm' || ipMode === 'RM') {
    const inv = allInventory.find(x => x.code === code);
    if (inv) { const _wu = parseFloat(inv.weightUnit) || 1; resolvedCost = (parseFloat(inv.kostenUnit || inv.kosten || 0) || 0) / _wu; }
  } else if (ipMode === 'mep' || ipMode === 'MEP') {
    const mepProd = allProducts[code] || {};
    let waPerGN = 0;
    allRecipes.filter(r => r.mepCode === code).forEach(r => {
      const inv = allInventory.find(x => x.code === r.rmCode) || {};
      const _wu = parseFloat(inv.weightUnit) || 1;
      waPerGN += (parseFloat(r.menge) || 0) * ((parseFloat(inv.kostenUnit || 0)) / _wu);
    });
    if (!waPerGN) waPerGN = parseFloat(mepProd.wa || 0);
    _ipMepWaPerGN = waPerGN;
    resolvedCost = waPerGN;
  }
  const nettoKg = parseFloat(_itemNetto) || 0;
  const waTotal = parseFloat(_itemWa)   || 0;
  ipSelectedItem = { code, name, unit, unitCost: resolvedCost, _itemNetto: nettoKg, _itemWa: waTotal };

  document.getElementById('ip-selected-name').textContent = name + ' (' + code + ')';
  document.getElementById('ip-detail').style.display = 'block';
  document.getElementById('ip-cost-display').textContent = '—';
  const gEl = document.getElementById('ip-garverlust');
  if (gEl) gEl.value = '';

  // Show Portions field for gr/menu with known netto weight
  const usePortions = (ipMode === 'gr' || ipMode === 'menu') && nettoKg > 0;
  const portWrap = document.getElementById('ip-portions-wrap');
  const portEl   = document.getElementById('ip-portions');
  const portLbl  = document.getElementById('ip-portions-label');
  if (portWrap) portWrap.style.display = usePortions ? '' : 'none';
  if (portEl)   portEl.value = '';
  if (portLbl && usePortions) portLbl.textContent = `Portions (1 = ${(nettoKg*1000).toFixed(0)}g)`;
  const pcWrap = document.getElementById('ip-pieces-wrap');
  if (pcWrap) pcWrap.style.display = usePortions ? '' : 'none';
  const pcNeed  = document.getElementById('ip-pieces-need');  if (pcNeed)  pcNeed.value = '';
  const pcTotal = document.getElementById('ip-pieces-total'); if (pcTotal) pcTotal.value = '';

  document.getElementById('ip-gewicht').value = prevWeight;
  if (ipMode === 'rm' || ipMode === 'RM') {
    const _invA = (allInventory||[]).find(x => x.code === code);
    const allerEl = document.getElementById('ip-allergie');
    if (allerEl) allerEl.value = _invA?.allergen || '';
  }
  if (prevWeight) calcIpCost();
  else if (usePortions && portEl) portEl.focus();
  else document.getElementById('ip-gewicht').focus();
}

// Resolve fresh RM cost from inventory; fuzzy-match by name if code not found or cost is 0
function _resolveRmCost(z) {
  const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9äöüß]/gi, '');
  let inv = allInventory ? allInventory.find(x => x.code === (z.code || '')) : null;
  if (!inv || !(parseFloat(inv.kostenUnit) > 0)) {
    const q = norm(z.name);
    if (q.length >= 3 && allInventory) {
      inv = allInventory.find(r => norm(r.name) === q)
        || allInventory.find(r => { const n = norm(r.name); return n.length >= 3 && (n.includes(q) || q.includes(n)); })
        || null;
    }
  }
  if (!inv) return { code: z.code || '', name: z.name || '', unit: z.unit || '', unitCost: z.unitCost || 0 };
  const _wu = parseFloat(inv.weightUnit) || 1;
  return { code: inv.code, name: inv.name, unit: inv.unit || z.unit || '', unitCost: (parseFloat(inv.kostenUnit) || 0) / _wu };
}

// Portions → weight (called when user types in Portions field)
function calcIpPieces() {
  const need  = parseFloat(document.getElementById('ip-pieces-need').value)  || 0;
  const total = parseFloat(document.getElementById('ip-pieces-total').value) || 0;
  if (need > 0 && total > 0) {
    const portEl = document.getElementById('ip-portions');
    if (portEl) portEl.value = +(need / total).toFixed(4);
    calcIpPortionWeight();
  }
}

function calcIpPortionWeight() {
  if (!ipSelectedItem) return;
  const portions = parseFloat(document.getElementById('ip-portions').value) || 0;
  const netto = ipSelectedItem._itemNetto || 0;
  if (portions > 0 && netto > 0) {
    document.getElementById('ip-gewicht').value = (portions * netto).toFixed(4);
  }
  calcIpCost();
}
// Weight → portions (called when user edits the weight field directly)
function _updateIpPortions() {
  if (!ipSelectedItem) return;
  const netto = ipSelectedItem._itemNetto || 0;
  const gw    = parseFloat(document.getElementById('ip-gewicht').value) || 0;
  const portEl = document.getElementById('ip-portions');
  if (portEl && netto > 0 && gw > 0) portEl.value = +(gw / netto).toFixed(3);
}

function calcIpCost() {
  if (!ipSelectedItem) return;
  const kg         = parseFloat(document.getElementById('ip-gewicht').value) || 0;
  const garverlust = parseFloat(document.getElementById('ip-garverlust')?.value) || 0;
  let cost = 0;
  if (ipMode === 'mep' || ipMode === 'MEP') {
    // unitCost = CHF/GN, kg field here = number of GN
    cost = kg * (_ipMepWaPerGN || ipSelectedItem.unitCost || 0);
  } else {
    const nettoKg = garverlust > 0 ? kg * (1 - garverlust / 100) : kg;
    cost = nettoKg * (ipSelectedItem.unitCost || 0);
  }
  const costEl = document.getElementById('ip-cost-display');
  if (!costEl) return;
  if (cost > 0) {
    costEl.textContent = 'CHF ' + cost.toFixed(3);
 } else if (ipSelectedItem.unitCost > 0) {
    if (ipMode === 'mep' || ipMode === 'MEP') {
      costEl.textContent = `CHF ${ipSelectedItem.unitCost.toFixed(3)} /GN (enter qty)`;
    } else if (ipMode === 'menu') {
      const _mNetto = ipSelectedItem._menuNetto || 0;
      const _mWa    = ipSelectedItem._menuWa    || 0;
      costEl.textContent = _mNetto > 0
        ? `CHF ${ipSelectedItem.unitCost.toFixed(3)}/kg — 1 Portion = ${(_mNetto*1000).toFixed(0)}g = CHF ${_mWa.toFixed(2)}`
        : `CHF ${ipSelectedItem.unitCost.toFixed(3)} /portion`;
    } else if (ipMode === 'gr') {
      const netto = ipSelectedItem._grNetto || 0;
      const portionCost = ipSelectedItem._grWa || (ipSelectedItem.unitCost * netto);
      const hint = netto > 0
        ? `CHF ${ipSelectedItem.unitCost.toFixed(3)}/kg — 1 Portion = ${(netto*1000).toFixed(0)}g = CHF ${portionCost.toFixed(2)}`
        : `CHF ${ipSelectedItem.unitCost.toFixed(3)} /kg`;
      costEl.textContent = hint;
    } else {
      costEl.textContent = `CHF ${ipSelectedItem.unitCost.toFixed(3)} /kg`;
    }
  } else {
    costEl.textContent = '— (no recipe costs found)';
  }
}

function calcIpWA() {
  if (!ipSelectedItem) return;
  const kg         = parseFloat(document.getElementById('ip-gewicht').value) || 0;
  const garverlust = parseFloat(document.getElementById('ip-garverlust')?.value) || 0;
  const waEl       = document.getElementById('ip-wa-total');
  const chfEl      = document.getElementById('ip-chf-netto');
  if (garverlust > 0 && kg > 0) {
    const waTotal    = kg / (1 - garverlust / 100);
    const chfKgNetto = ipSelectedItem.unitCost > 0 ? ipSelectedItem.unitCost / (1 - garverlust / 100) : 0;
    if (waEl)  waEl.textContent  = waTotal.toFixed(4) + ' kg ' + (typeof t === 'function' ? t('raw-material') : 'raw');
    if (chfEl) chfEl.textContent = chfKgNetto > 0 ? 'CHF ' + chfKgNetto.toFixed(2) + '/kg' : '—';
  } else {
    if (waEl)  waEl.textContent  = '—';
    if (chfEl) chfEl.textContent = '—';
  }
  calcIpCost();
}

function confirmIngredient() {
  if (!ipSelectedItem) return;
  const kg         = parseFloat(document.getElementById('ip-gewicht').value) || 0;
  const garverlust = parseFloat(document.getElementById('ip-garverlust')?.value) || 0;
  const waTotal    = garverlust > 0 ? kg / (1 - garverlust / 100) : 0;
  const chfKgNetto = (garverlust > 0 && ipSelectedItem.unitCost > 0) ? ipSelectedItem.unitCost / (1 - garverlust / 100) : 0;
  let cost = 0;
  if (ipMode === 'mep' || ipMode === 'MEP') {
    const mepProd = allProducts[ipSelectedItem.code] || {};
    const kgPerGN = parseFloat(mepProd.gnWeight) || 0;
    const gn = kgPerGN > 0 ? kg / kgPerGN : 0;
    cost = +( gn * (_ipMepWaPerGN || ipSelectedItem.unitCost || 0) ).toFixed(3);
  } else {
    cost = +(kg * (ipSelectedItem.unitCost || 0)).toFixed(3);
  }
  const zutat = {
    type        : ipMode,
    code        : ipSelectedItem.code,
    name        : ipSelectedItem.name,
    gewicht     : kg || '',
    garverlust  : garverlust || '',
    waTotal     : waTotal    ? +waTotal.toFixed(4) : '',
    chfKgNetto  : chfKgNetto ? +chfKgNetto.toFixed(4) : '',
    unitCost    : ipSelectedItem.unitCost,
    cost,
    allergie    : document.getElementById('ip-allergie').value,
    zubereitung : document.getElementById('ip-zubereitung-note').value,
    isDeko      : document.getElementById('ip-is-deko')?.checked    || false,
    isTopping   : document.getElementById('ip-is-topping')?.checked || false,
    pieces      : parseFloat(document.getElementById('ip-pieces-need')?.value)  || 0,
    piecesTotal : parseFloat(document.getElementById('ip-pieces-total')?.value) || 0
  };
  if (ipContext === 'agr') {
    if (_ipEditIdx >= 0) agrZutaten.splice(_ipEditIdx, 1, zutat);
    else agrZutaten.push(zutat);
    renderAgrZutaten();
  } else if (ipContext === 'mep-add') {
    if (_ipEditIdx >= 0) mepAddZutaten.splice(_ipEditIdx, 1, zutat);
    else mepAddZutaten.push(zutat);
    renderMepAddZutaten();
  } else {
    if (_ipEditIdx >= 0) menuZutaten.splice(_ipEditIdx, 1, zutat);
    else menuZutaten.push(zutat);
    renderMenuZutaten();
  }
  _ipEditIdx = -1;
  closeIngredientPicker();
}

// ─────────────────────────────────────────────
// GR PICKER
// ─────────────────────────────────────────────

function openGrPopup() {
  closeMenu();
  _grSelectedItem = null;
  document.getElementById('gr-search').value = '';
  document.getElementById('gr-detail').style.display = 'none';
  document.getElementById('gr-rohgewicht').value = '';
  document.getElementById('gr-garverlust').value = '';
  document.getElementById('gr-nettogewicht').textContent = '—';
  document.getElementById('gr-cost-display').textContent = '—';
  const popup = document.getElementById('grPopup');
  popup.style.display = 'flex';
  _onPopupOpen();
  loadGRs().then(() => filterGrPicker());
}

function closeGrPopup() {
  document.getElementById('grPopup').style.display = 'none';
  _onPopupClose();
}

function filterGrPicker() {
  const q = (document.getElementById('gr-search').value || '').toLowerCase();
  const items = allGRs.map(g => ({
    code     : g.grCode || g.id,
    name     : g.name,
    unitCost : parseFloat(g.wa) / (parseFloat(g.nettogewicht) || 1),
    netto    : parseFloat(g.nettogewicht) || 0,
    source   : 'gr'
  }));
  const filtered = q ? items.filter(i => i.name.toLowerCase().includes(q) || (i.code||'').toLowerCase().includes(q)) : items;
  const el = document.getElementById('gr-list');
  if (!filtered.length) {
    el.innerHTML = `<div style="font-size:12px;color:var(--muted)">Keine GR gefunden. Erstelle zuerst eine GR.</div>`;
    return;
  }
  el.innerHTML = filtered.slice(0,40).map(i => {
    const sc = (i.code||'').replace(/"/g,'&quot;');
    const sn = (i.name||'').replace(/"/g,'&quot;');
    const su = (i.unit||'').replace(/"/g,'&quot;');
    return `<div class="gr-pick-row" data-code="${sc}" data-name="${sn}" data-unit="${su}" data-cost="${parseFloat(i.unitCost)||0}"
      style="padding:8px 12px;border-radius:8px;background:var(--surface2);cursor:pointer;font-size:12px;color:var(--text);border:1px solid transparent"
      onmouseover="this.style.borderColor='var(--green-brd)'" onmouseout="this.style.borderColor='transparent'">
      <span style="font-size:10px;padding:1px 6px;border-radius:4px;background:var(--green-dim);color:var(--green);margin-right:6px">GR</span>
      <span style="font-weight:500">${i.name}</span>
      <span style="font-size:10px;color:var(--muted);margin-left:6px">${i.code}</span>
      ${i.unitCost ? `<span style="font-size:10px;color:var(--amber);margin-left:4px">CHF ${parseFloat(i.unitCost).toFixed(2)}${ipMode==='rm'||ipMode==='RM' ? '/'+( i.unit||'unit') : ipMode==='mep'||ipMode==='MEP' ? '/GN' : ''}</span>` : ''}
    </div>`;
  }).join('');
}

function selectGrItem(code, name, unitCost, source, netto) {
  _grSelectedItem = { code, name, unitCost: parseFloat(unitCost)||0, source, netto: parseFloat(netto)||0 };
  document.getElementById('gr-selected-name').textContent = name + ' (' + code + ')';
  document.getElementById('gr-detail').style.display = 'block';
  document.getElementById('gr-rohgewicht').focus();
}

function calcGrPickerCost() {
  if (!_grSelectedItem) return;
  const roh     = parseFloat(document.getElementById('gr-rohgewicht').value) || 0;
  const verlust = parseFloat(document.getElementById('gr-garverlust').value) || 0;
  const netto   = roh * (1 - verlust / 100);
  document.getElementById('gr-nettogewicht').textContent = netto > 0 ? netto.toFixed(3) + ' kg' : '—';
  const cost = netto * (_grSelectedItem.unitCost || 0);
  document.getElementById('gr-cost-display').textContent = cost > 0 ? 'CHF ' + cost.toFixed(2) : '—';
}

function confirmGr() {
  if (!_grSelectedItem) return;
  const roh     = parseFloat(document.getElementById('gr-rohgewicht').value) || _grSelectedItem.netto;
  const verlust = parseFloat(document.getElementById('gr-garverlust').value) || 0;
  const netto   = verlust > 0 ? roh * (1 - verlust / 100) : roh;
  const cost    = netto * (_grSelectedItem.unitCost || 0);
  menuZutaten.push({
    type       : 'gr',
    code       : _grSelectedItem.code,
    name       : _grSelectedItem.name,
    gewicht    : netto,
    rohGewicht : roh,
    garverlust : verlust,
    unitCost   : _grSelectedItem.unitCost,
    cost       : cost
  });
  renderMenuZutaten();
  closeGrPopup();
}
