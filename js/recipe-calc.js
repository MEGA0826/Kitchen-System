/* recipe-calc.js — shared recipe/menu calculators (module 18), extracted from dashboard.html.
   Pure read-only helpers used by many inline render functions AND recipe editors: netto-weight,
   live WA (cost) from current inventory prices, MEP WA, and allergen roll-up (recursive through
   GR/menu/MEP components). No DOM, no shared-state writes. Reads app globals:
   allInventory, allGRs, allMenus, allRecipes, allProducts. Every caller is post-parse
   (render fns run post-await / on events), so loading at end of body is safe. */
// Returns total netto output weight (kg) for a recipe from its ingredient list
function _calcMenuNettoKg(zutatenStr) {
  try {
    const zs = JSON.parse(typeof zutatenStr === 'string' ? (zutatenStr||'[]') : '[]');
    return zs.reduce((sum, z) => {
      const gw = parseFloat(z.gewicht)||0;
      const garl = parseFloat(z.garverlust)||0;
      return sum + gw * (1 - garl/100);
    }, 0);
  } catch(e) { return 0; }
}

// Compute live WA from current allInventory prices (RM lookups; GR/MEP fall back to stored unitCost)
function _calcLiveWA(zutatenStr) {
  if (!allInventory || !allInventory.length) return null;
  try {
    const zs = JSON.parse(typeof zutatenStr === 'string' ? (zutatenStr||'[]') : '[]');
    if (!zs.length) return null;
    let total = 0;
    for (const z of zs) {
      const gw = parseFloat(z.gewicht) || 0;
      if (!gw) continue;
      const t = (z.type||'rm').toLowerCase();
      if (t === 'rm') {
        const inv = allInventory.find(i => i.code === (z.code||''));
        if (inv) {
          const wu = parseFloat(inv.weightUnit) || 1;
          const ku = parseFloat(inv.kostenUnit) || 0;
          total += gw * (ku / wu);
        } else {
          total += gw * (parseFloat(z.unitCost) || 0);
        }
      } else if (t === 'gr') {
        const g = (allGRs||[]).find(x => (x.grCode||x.id) === z.code);
        if (g) {
          const grWaTotal = parseFloat(g.wa||0) || (_calcLiveWA(g.zutaten) ?? 0);
          const netto = _calcMenuNettoKg(g.zutaten) || (parseFloat(g.rohgewicht||0) * (1 - (parseFloat(g.garverlust||0)/100)));
          total += gw * (netto > 0 ? grWaTotal / netto : grWaTotal);
        } else {
          total += gw * (parseFloat(z.unitCost)||0);
        }
      } else if (t === 'menu') {
        const m = (allMenus||[]).find(x => (x.menuCode||x.id) === z.code);
        if (m) {
          const menuWa = parseFloat(m.wa||0) || (_calcLiveWA(m.zutaten) ?? 0);
          const nettoKg = _calcMenuNettoKg(m.zutaten);
          total += gw * (nettoKg > 0 ? menuWa / nettoKg : menuWa);
        } else {
          total += gw * (parseFloat(z.unitCost)||0);
        }
      } else {
        total += gw * (parseFloat(z.unitCost) || 0);
      }
    }
    return total;
  } catch(e) { return null; }
}

// Compute live WA for a MEP product from allRecipes + allInventory
// Returns { waPerGN, gnWeightKg } or null if no recipes / no cost found
function _calcMepWA(code) {
  const rms = (allRecipes || []).filter(r => r.mepCode === code);
  if (!rms.length) return null;
  let waPerGN = 0;
  rms.forEach(r => {
    const inv = (allInventory || []).find(x => x.code === r.rmCode) || {};
    const wu = parseFloat(inv.weightUnit) || 1;
    waPerGN += (parseFloat(r.menge) || 0) * ((parseFloat(inv.kostenUnit) || 0) / wu);
  });
  if (!waPerGN) return null;
  const gnWeightKg = parseFloat((allProducts[code] || {}).gnWeight) || 0;
  return { waPerGN, gnWeightKg };
}

// Returns array of allergen label strings for all RM-type zutaten in a recipe/menu
function _calcAllergens(zutatenStr) {
  try {
    const zs = JSON.parse(typeof zutatenStr === 'string' ? (zutatenStr||'[]') : '[]');
    const seen = new Set();
    const add  = v => (v||'').split(',').forEach(a => { const t = a.trim(); if (t) seen.add(t); });
    for (const z of zs) {
      const t = (z.type||'rm').toLowerCase();
      if (t === 'rm') {
        const inv = (allInventory||[]).find(i => i.code === (z.code||''));
        add(inv?.allergen || z.allergie || '');
      } else if (t === 'gr') {
        const gr = (allGRs||[]).find(g => (g.grCode||g.id) === (z.code||''));
        if (gr) _calcAllergens(gr.zutaten).forEach(a => seen.add(a));
        else    add(z.allergie || '');
      } else if (t === 'mep') {
        const nested = _calcMepAllergens(z.code||'');
        if (nested.length) nested.forEach(a => seen.add(a));
        else add(z.allergie || '');
      } else if (t === 'menu') {
        const m = (allMenus||[]).find(x => (x.menuCode||x.id) === (z.code||''));
        if (m) _calcAllergens(m.zutaten).forEach(a => seen.add(a));
        else   add(z.allergie || '');
      } else {
        add(z.allergie || '');
      }
    }
    return [...seen];
  } catch(e) { return []; }
}
// Returns allergen array for a MEP product from allRecipes
function _calcMepAllergens(code) {
  const rms = (allRecipes||[]).filter(r => r.mepCode === code);
  const seen = new Set();
  rms.forEach(r => {
    const inv = (allInventory||[]).find(x => x.code === r.rmCode);
    (inv?.allergen||'').split(',').forEach(a => { const tr = a.trim(); if (tr) seen.add(tr); });
  });
  return [...seen];
}

// ── Zutaten serialization (moved from dashboard.html, module 18) ─────────────
// _slimZutaten: reduce a zutaten array to the compact stored form.
// _enrichZutaten: recompute live unitCost/cost per zutat from inventory/GR/MEP/menu → { enriched, waTotal }.
// Shared by saveMenuEntry (inline), gr-edit, pdf-import, pdf-batch. Pure; reads global data only.
function _slimZutaten(arr) {
  return (arr || []).map(z => {
    const s = { type: z.type, code: z.code, name: z.name };
    if (z.gewicht)      s.gewicht    = z.gewicht;
    if (z.unitCost)     s.unitCost   = z.unitCost;
    if (z.cost)         s.cost       = z.cost;
    if (z.allergie)     s.allergie   = z.allergie;
    if (z.zubereitung)  s.zubereitung = z.zubereitung;
    if (z.isDeko)       s.isDeko     = true;
    if (z.isTopping)    s.isTopping  = true;
    if (z.pieces)       s.pieces     = z.pieces;
    if (z.piecesTotal)  s.piecesTotal = z.piecesTotal;
    if (z.garverlust)   s.garverlust  = z.garverlust;
    if (z.rohGewicht)   s.rohGewicht  = z.rohGewicht;
    return s;
  });
}

// Enrich zutaten with live unit costs from inventory/GRs/products.
// Returns { enriched: Array, waTotal: number }
function _enrichZutaten(arr) {
  let waTotal = 0;
  const enriched = (arr || []).map(z => {
    const gw = parseFloat(z.gewicht) || 0;
    const t  = (z.type || 'rm').toLowerCase();
    let unitCost = parseFloat(z.unitCost) || 0;

    if (t === 'rm') {
      const inv = (allInventory||[]).find(i => i.code === (z.code||''));
      if (inv) {
        const wu = parseFloat(inv.weightUnit) || 1;
        unitCost = (parseFloat(inv.kostenUnit) || 0) / wu;
      }
    } else if (t === 'gr') {
      const gr = (allGRs||[]).find(g => (g.grCode||g.id) === (z.code||''));
      if (gr) {
        const grWa    = parseFloat(gr.wa||0) || (_calcLiveWA(gr.zutaten) ?? 0);
        const netto   = _calcMenuNettoKg(gr.zutaten) || parseFloat(gr.rohgewicht||0);
        unitCost = netto > 0 ? grWa / netto : 0;
      }
    } else if (t === 'mep') {
      const mep = _calcMepWA(z.code||'');
      if (mep && mep.waPerGN) {
        const gnW = mep.gnWeightKg || 1;
        unitCost = gnW > 0 ? mep.waPerGN / gnW : 0;
      }
    } else if (t === 'menu') {
      const m = (allMenus||[]).find(x => (x.menuCode||x.id) === (z.code||''));
      if (m) {
        const mWa   = parseFloat(m.wa||0) || (_calcLiveWA(m.zutaten) ?? 0);
        const mNetto = _calcMenuNettoKg(m.zutaten);
        unitCost = mNetto > 0 ? mWa / mNetto : 0;
      }
    }

    const cost = gw > 0 && unitCost > 0 ? +(gw * unitCost).toFixed(3) : (parseFloat(z.cost) || 0);
    waTotal += cost;
    return { ...z, unitCost: unitCost || z.unitCost || 0, cost };
  });
  return { enriched, waTotal: +waTotal.toFixed(2) };
}
