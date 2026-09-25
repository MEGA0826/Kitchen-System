/* recipe-calc.js — shared recipe/menu calculators (module 18), extracted from dashboard.html.
   Pure read-only helpers used by many inline render functions AND recipe editors: netto-weight,
   live WA (cost) from current inventory prices, MEP WA, and allergen roll-up (recursive through
   GR/menu/MEP components). No DOM, no shared-state writes. Reads app globals:
   allInventory, allGRs, allMenus, allRecipes, allProducts. Every caller is post-parse
   (render fns run post-await / on events), so loading at end of body is safe.

   PERF: these run per-row during list renders and recurse through GR/menu components. Raw
   Array.find()/filter() over allInventory/allGRs/allMenus/allRecipes made that O(rows × zutaten ×
   dataset). We index each dataset into a Map ONCE and reuse it until the array is REASSIGNED
   (loadX does `allX = [...]`), detected by identity — so membership changes rebuild automatically
   while in-place field edits (e.g. a price change on an existing row) stay visible via the stored
   object reference. No memoization of results → no staleness risk, just O(1) lookups. */

// Build a Map only when the source array reference changes (loads reassign; edits mutate in place).
function _refIndex(getArr, build) {
  let ref = null, idx = null;
  return () => { const a = getArr() || null; if (a !== ref) { idx = build(a || []); ref = a; } return idx; };
}
const _idxInv = _refIndex(
  () => (typeof allInventory !== 'undefined' ? allInventory : null),
  arr => { const m = new Map(); for (const x of arr) if (x && x.code != null && !m.has(x.code)) m.set(x.code, x); return m; });
const _idxGr = _refIndex(
  () => (typeof allGRs !== 'undefined' ? allGRs : null),
  arr => { const m = new Map(); for (const g of arr) { const k = g && (g.grCode || g.id); if (k != null && !m.has(k)) m.set(k, g); } return m; });
const _idxMenu = _refIndex(
  () => (typeof allMenus !== 'undefined' ? allMenus : null),
  arr => { const m = new Map(); for (const x of arr) { const k = x && (x.menuCode || x.id); if (k != null && !m.has(k)) m.set(k, x); } return m; });
const _idxRecipesByMep = _refIndex(
  () => (typeof allRecipes !== 'undefined' ? allRecipes : null),
  arr => { const m = new Map(); for (const r of arr) { if (!m.has(r.mepCode)) m.set(r.mepCode, []); m.get(r.mepCode).push(r); } return m; });

const _invByCode  = code => _idxInv().get(code);
const _grByKey    = code => _idxGr().get(code);
const _menuByKey  = code => _idxMenu().get(code);
const _recipesFor = code => _idxRecipesByMep().get(code) || [];

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

// "1 Portion" of a GR means the whole recipe: its netto weight AND its WA. Both are
// stored on the GR, so "1 Port. GR Papaya Salad" is 0.165 kg / CHF 1.80 — not 1 kg
// charged at that GR's CHF/kg rate, which read CHF 10.91 and pushed the Papaya Katsu
// Bowl to WA 40.06. Returns null for rows we cannot resolve (a menu or raw material
// counted in pieces needs a per-piece weight the data does not carry), and those keep
// their stored values instead of being guessed at.
function _zPortion(z) {
  if (!_zIsCount(z)) return null;
  const t = (z.type || '').toLowerCase();
  if (t === 'gr') {
    const g = _grByKey(z.code || '');
    if (!g) return null;
    let kg = parseFloat(g.nettogewicht) || parseFloat(g.rohgewicht) || 0;
    if (kg > 20) kg = kg / 1000;                 // GR weights are a mix of kg and g
    const wa = parseFloat(g.wa) || 0;
    // Only a portion-sized recipe can BE one portion. A bulk batch counted in pieces
    // (GR Sesam: 2 kg, WA 13.50, written as "1 Stk." in NH200) is bad data, and
    // charging a whole batch for a pinch of garnish would be worse than leaving it.
    if (kg > 0.5) return null;
    return (kg || wa) ? { kg: kg, cost: wa } : null;
  }
  if (t === 'menu' && /^port/i.test(String(z.unit || '').trim())) {
    const m = _menuByKey(z.code || '');
    if (!m) return null;
    const kg = (parseFloat(m.gewicht) || 0) / 1000;        // menus store grams
    const wa = parseFloat(m.wa) || 0;
    return (kg || wa) ? { kg: kg, cost: wa } : null;
  }
  return null;
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
      const _p = _zPortion(z);                       // portion rows cost their recipe WA
      if (_p) { total += gw * _p.cost; continue; }
      // A piece count we cannot resolve is NOT kilograms — charging it at a CHF/kg
      // rate turned "4 Stk maki" into 4 kg. Keep whatever cost the row already holds.
      if (_zIsCount(z)) { total += parseFloat(z.cost) || 0; continue; }
      const t = (z.type||'rm').toLowerCase();
      if (t === 'rm') {
        const inv = _invByCode(z.code||'');
        if (inv) {
          const wu = parseFloat(inv.weightUnit) || 1;
          const ku = parseFloat(inv.kostenUnit) || 0;
          total += gw * (ku / wu);
        } else {
          total += gw * (parseFloat(z.unitCost) || 0);
        }
      } else if (t === 'gr') {
        const g = _grByKey(z.code);
        if (g) {
          const grWaTotal = parseFloat(g.wa||0) || (_calcLiveWA(g.zutaten) ?? 0);
          const netto = _calcMenuNettoKg(g.zutaten) || (parseFloat(g.rohgewicht||0) * (1 - (parseFloat(g.garverlust||0)/100)));
          total += gw * (netto > 0 ? grWaTotal / netto : grWaTotal);
        } else {
          total += gw * (parseFloat(z.unitCost)||0);
        }
      } else if (t === 'menu') {
        const m = _menuByKey(z.code);
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
  const rms = _recipesFor(code);
  if (!rms.length) return null;
  let waPerGN = 0;
  rms.forEach(r => {
    const inv = _invByCode(r.rmCode) || {};
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
        const inv = _invByCode(z.code||'');
        add(inv?.allergen || z.allergie || '');
      } else if (t === 'gr') {
        const gr = _grByKey(z.code||'');
        if (gr) _calcAllergens(gr.zutaten).forEach(a => seen.add(a));
        else    add(z.allergie || '');
      } else if (t === 'mep') {
        const nested = _calcMepAllergens(z.code||'');
        if (nested.length) nested.forEach(a => seen.add(a));
        else add(z.allergie || '');
      } else if (t === 'menu') {
        const m = _menuByKey(z.code||'');
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
  const rms = _recipesFor(code);
  const seen = new Set();
  rms.forEach(r => {
    const inv = _invByCode(r.rmCode);
    (inv?.allergen||'').split(',').forEach(a => { const tr = a.trim(); if (tr) seen.add(tr); });
  });
  return [...seen];
}

// ── Menu weight: menus.gewicht is stored in GRAMS ────────────────────────────
// Ingredient rows are in kg, except count units (Stk / Stück / Port.) and menus
// used "per piece" (integer amount, no unit, no pieces split) — those are piece
// counts and must not be summed as kg (1 Stk garnish used to add 1000 g).
function _zIsCount(z) {
  const u = String(z.unit || '').toLowerCase().replace(/\./g, '').trim();
  if (['stk', 'stück', 'stuck', 'st', 'port', 'pcs'].includes(u)) return true;
  const g = parseFloat(z.gewicht);
  return (z.type || '') === 'menu' && !z.piecesTotal && !u && Number.isInteger(g) && g >= 1;
}
// → { grams, hasCounts }: summed weight of the weighable rows only
function _zutatenGrams(arr) {
  let kg = 0, hasCounts = false;
  (arr || []).forEach(z => {
    const p = _zPortion(z);
    if (p) { kg += (parseFloat(z.gewicht) || 0) * p.kg; return; }   // n x netto of that recipe
    if (_zIsCount(z)) { hasCounts = true; return; }
    const u = String(z.unit || '').toLowerCase().trim(), g = parseFloat(z.gewicht) || 0;
    kg += u === 'g' ? g / 1000 : g;
  });
  return { grams: Math.round(kg * 1000), hasCounts };
}
// Normalise a typed/imported weight to integer grams ('' if none).
// "1.2 kg" → 1200, "250g" → 250. legacyKg: a bare number < 20 is kg (old/PDF data).
function _toMenuGrams(v, legacyKg) {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  if (!s || /pro\s*kg|%/.test(s)) return '';
  const n = parseFloat(s.replace(',', '.').replace(/[^\d.]+/g, ' ').trim().split(' ')[0]);
  if (!isFinite(n) || n <= 0) return '';
  if (/kg/.test(s) || (legacyKg && !/\d\s*g\b|gr\b|gramm/.test(s) && n < 20)) return Math.round(n * 1000);
  return Math.round(n);
}
function _fmtMenuGrams(v) { const n = parseFloat(v); return isFinite(n) && String(v).trim() === String(n) ? n + ' g' : (v || ''); }

// ── Zutaten serialization (moved from dashboard.html, module 18) ─────────────
// _slimZutaten: reduce a zutaten array to the compact stored form.
// _enrichZutaten: recompute live unitCost/cost per zutat from inventory/GR/MEP/menu → { enriched, waTotal }.
// Shared by saveMenuEntry (inline), gr-edit, pdf-import, pdf-batch. Pure; reads global data only.
function _slimZutaten(arr) {
  return (arr || []).map(z => {
    const s = { type: z.type, code: z.code, name: z.name };
    if (z.gewicht)      s.gewicht    = z.gewicht;
    if (z.unit)         s.unit       = z.unit;   // keep "Stk"/"Port." — they mark counts, not kg
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
    const p  = _zPortion(z);
    if (p) {                                          // n Portionen x WA per portion
      const c = gw > 0 && p.cost > 0 ? +(gw * p.cost).toFixed(3) : (parseFloat(z.cost) || 0);
      waTotal += c;
      return Object.assign({}, z, { unitCost: p.cost || z.unitCost || 0, cost: c });
    }
    if (_zIsCount(z)) {                               // unresolvable piece count — leave it alone
      waTotal += parseFloat(z.cost) || 0;
      return Object.assign({}, z);
    }
    let unitCost = parseFloat(z.unitCost) || 0;

    if (t === 'rm') {
      const inv = _invByCode(z.code||'');
      if (inv) {
        const wu = parseFloat(inv.weightUnit) || 1;
        unitCost = (parseFloat(inv.kostenUnit) || 0) / wu;
      }
    } else if (t === 'gr') {
      const gr = _grByKey(z.code||'');
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
      const m = _menuByKey(z.code||'');
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

// ── Allergen labels (EU-14) + nutrition roll-up (module 18) ──────────────────
// EU_ALLERGENS (dashboard.html) holds the 14 German allergen names; map each to its
// standard Austrian/German menu letter code A–R for a printable label.
const EU_ALLERGEN_CODES = {
  'Gluten':'A','Krebstiere':'B','Eier':'C','Fisch':'D','Erdnüsse':'E','Soja':'F',
  'Milch':'G','Nüsse':'H','Sellerie':'L','Senf':'M','Sesam':'N','SO₂/Sulfite':'O',
  'Lupinen':'P','Weichtiere':'R'
};
// Returns the recipe's allergens as [{code,name}] sorted by code (uses _calcAllergens).
function _euAllergenLabel(zutatenStr) {
  const names = (typeof _calcAllergens === 'function') ? _calcAllergens(zutatenStr) : [];
  return names
    .map(n => ({ code: EU_ALLERGEN_CODES[n] || '', name: n }))
    .filter(a => a.code)
    .sort((a, b) => a.code.localeCompare(b.code));
}

// Recursive nutrition roll-up → absolute totals for the whole recipe { kcal, protein, fat, carbs, hasData }.
// RM reads inventory per-100g fields; GR/Menu recurse and scale by (gewicht used ÷ component netto kg).
// MEP is skipped in this scaffold (needs recipe explosion). gewicht is kg, nutrition is per 100g.
function _calcNutrition(zutatenStr) {
  const out = { kcal: 0, protein: 0, fat: 0, carbs: 0, hasData: false };
  let zs; try { zs = JSON.parse(typeof zutatenStr === 'string' ? (zutatenStr || '[]') : '[]'); } catch (e) { return out; }
  const NKEYS = ['kcal', 'protein', 'fat', 'carbs'];
  const add = (src, factor) => {
    let any = false;
    NKEYS.forEach(k => { const v = parseFloat(src && src[k]); if (!isNaN(v) && v) { out[k] += v * factor; any = true; } });
    if (any) out.hasData = true;
  };
  for (const z of zs) {
    const gw = parseFloat(z.gewicht) || 0; if (!gw) continue;
    const t = (z.type || 'rm').toLowerCase();
    if (t === 'rm') {
      const inv = _invByCode(z.code || '');
      if (inv) add({ kcal: inv.kcal, protein: inv.protein, fat: inv.fat, carbs: inv.carbs }, gw * 10); // per-100g × (gw kg × 10)
    } else if (t === 'gr') {
      const gr = _grByKey(z.code || '');
      if (gr) { const sub = _calcNutrition(gr.zutaten); const netto = _calcMenuNettoKg(gr.zutaten) || parseFloat(gr.rohgewicht || 0); add(sub, netto > 0 ? gw / netto : 0); }
    } else if (t === 'menu') {
      const m = _menuByKey(z.code || '');
      if (m) { const sub = _calcNutrition(m.zutaten); const netto = _calcMenuNettoKg(m.zutaten); add(sub, netto > 0 ? gw / netto : 0); }
    }
  }
  return out;
}
