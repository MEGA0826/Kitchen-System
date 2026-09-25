// ═══════════════════════════════════════════════════════════
// BULK RELINK — Admin tool (module #22)
// Finds recipe ingredients (Menus + GRs) whose code is empty or points at nothing
// (e.g. imported rows saved as type "rm" with code "", or slug codes like
// "SESAM_-_BLACK_&_WHIT"), matches them by name against RM / MEP / GR, applies the
// exact matches and lets the manager decide the uncertain ones. Identical rows are
// grouped, so one decision fixes that ingredient in every recipe that uses it.
// Saves through the same GAS saveMenu / saveGR calls the editors use, re-reading
// fresh data right before writing so concurrent edits aren't overwritten.
// Also clears the bogus imageUrl ".../dashboard.html" the old editor saved.
// ═══════════════════════════════════════════════════════════

const _RL_STOP = new Set(('btl beutel krt karton fl flasche flaschen dose dosen eimer sack bidon bid pack packung ' +
  'schale schalen stk stuck stueck kg ml lt ltr liter cl gr vac bis uhr bestellen bestellung vorbestellen ' +
  'fwg tk ifc ifco und mit the a la per pro ca nooch negishi herbst sommer winter fruhling').split(' '));

function _rlNorm(s) {
  return String(s || '').toLowerCase()
    .replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/ü/g, 'u').replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim()
    .replace(/^gr /, '').replace(/\s+/g, ' ');
}
// Core words only: drop packaging, units, pure numbers and "10x1" style sizes
function _rlCore(s) {
  return _rlNorm(String(s || '').replace(/\([^)]*\)/g, ' '))
    .split(' ').filter(w => w.length >= 3 && !_RL_STOP.has(w) && !/\d/.test(w)).join('');
}
// Short letter-only words ("NE", "IH") that _rlCore drops — they must agree for an auto-link
function _rlShort(s) {
  return _rlNorm(String(s || '').replace(/\([^)]*\)/g, ' ')).split(' ').filter(w => w.length < 3 && /^[a-z]+$/.test(w)).sort().join(' ');
}
function _rlTri(s) { const t = new Set(); for (let i = 0; i < s.length - 2; i++) t.add(s.slice(i, i + 3)); return t; }
function _rlScore(a, b) {
  // max of trigram Dice and "a is contained in b" (row names are usually shorter)
  if (!a || !b) return 0;
  const A = _rlTri(a), B = _rlTri(b); if (!A.size || !B.size) return a === b ? 1 : 0;
  let inter = 0; A.forEach(t => { if (B.has(t)) inter++; });
  // containment only counts fully for longer names — "oel" must not match "Sambal Oelek"
  const wC = A.size >= 8 ? 0.92 : A.size >= 5 ? 0.75 : 0.55;
  const dice = 2 * inter / (A.size + B.size);
  // tie-break toward the closest name (e.g. plain "Sushi-Reis" over "Crispy Sushi-Reis")
  return Math.max(dice, wC * inter / A.size) + 0.04 * dice + (b.startsWith(a) ? 0.04 : 0);
}
function _rlParse(z) { if (Array.isArray(z)) return z; try { const r = JSON.parse(z || '[]'); return Array.isArray(r) ? r : []; } catch (e) { return []; } }
function _rlBadImg(u) { return /\/dashboard\.html(?:[?#]|$)/i.test(u || ''); }

// Pure analysis — also used by the node test harness.
function _rlAnalyze(d) {
  const items = [];   // candidate universe
  (d.inventory || []).forEach(r => r.code && items.push({ type: 'rm', code: String(r.code), name: r.name || String(r.code) }));
  Object.entries(d.products || {}).forEach(([c, p]) => {
    if (p && p.name && p.name !== '(deleted)' && p.active !== false) items.push({ type: 'mep', code: c, name: p.name });
  });
  (d.grs || []).forEach(g => { const c = g.grCode || g.id; c && items.push({ type: 'gr', code: c, name: g.name || c }); });
  (d.menus || []).forEach(m => { const c = m.menuCode || m.id; c && items.push({ type: 'menu', code: c, name: m.name || c }); });
  items.forEach(it => { it.norm = _rlNorm(it.name); it.core = _rlCore(it.name); });
  const byTypeCode = {}; items.forEach(it => { byTypeCode[it.type + ':' + it.code] = it; });
  const byCode = {}; items.forEach(it => { (byCode[it.code] = byCode[it.code] || []).push(it); });

  const groups = {};
  const scan = (kind, rec) => {
    _rlParse(rec.zutaten).forEach((z, idx) => {
      const type = (z.type || 'rm').toLowerCase(), code = String(z.code || '');
      if (code && byTypeCode[type + ':' + code]) return;           // linked fine
      const key = _rlGroupKey(z);
      const g = groups[key] || (groups[key] = { key, name: z.name || code, type, code, rows: [], cands: [], pick: null, auto: false });
      g.rows.push({ kind, ref: kind === 'menu' ? rec.id : (rec.grCode || rec.id), label: (rec.menuCode || rec.grCode || '') + ' ' + (rec.name || ''), idx,
        selfCode: kind + ':' + (rec.menuCode || rec.grCode || rec.id) });
    });
  };
  (d.menus || []).forEach(m => scan('menu', m));
  (d.grs || []).forEach(g => scan('gr', g));

  Object.values(groups).forEach(g => {
    // 1) code exists but under another type (e.g. rm row whose code is a GR code)
    const sameCode = g.code ? (byCode[g.code] || []) : [];
    if (sameCode.length === 1) { g.cands = [{ ...sameCode[0], score: 1 }]; g.pick = 0; g.auto = true; return; }
    const n = _rlNorm(g.name), core = _rlCore(g.name), wantGr = /^\s*gr\s/i.test(g.name);
    // Never suggest a recipe as its own ingredient
    const selfRefs = new Set(g.rows.map(r => r.selfCode));
    const pool = items.filter(it => !(g.rows.length === 1 && selfRefs.has(it.type + ':' + it.code)));
    // 2) exact name (GR-prefix-insensitive); a "GR …" row prefers GRs
    let exact = pool.filter(it => it.norm === n);
    if (wantGr && exact.some(it => it.type === 'gr')) exact = exact.filter(it => it.type === 'gr');
    // same core words (packaging/sizes/concept tags ignored) and only one such item
    if (!exact.length && core.length >= 6) {
      const sh = _rlShort(g.name);
      let same = pool.filter(it => it.core === core && _rlShort(it.name) === sh);
      if (wantGr && same.some(it => it.type === 'gr')) same = same.filter(it => it.type === 'gr');
      if (same.length === 1) exact = same;
    }
    // a "GR …" row prefers GRs; otherwise raw score
    const boost = it => !wantGr ? 0 : it.type === 'gr' ? 0.12 : -0.08;
    const scored = pool.map(it => ({ ...it, score: it.norm === n ? 1 : Math.min(0.99, _rlScore(core, it.core) + boost(it)) }))
      .filter(it => it.score >= 0.45).sort((a, b) => b.score - a.score).slice(0, 8);
    g.cands = scored;
    if (exact.length === 1) {
      const i = scored.findIndex(c => c.type === exact[0].type && c.code === exact[0].code);
      g.pick = i >= 0 ? i : 0; g.auto = true;
      if (i < 0) g.cands.unshift({ ...exact[0], score: 1 });
    } else if (scored.length) {
      g.pick = 0;                     // pre-select best guess, but needs a human
    }
  });
  const list = Object.values(groups).sort((a, b) => b.rows.length - a.rows.length || a.name.localeCompare(b.name));
  return {
    groups: list,
    auto: list.filter(g => g.auto),
    review: list.filter(g => !g.auto && g.cands.length),
    none: list.filter(g => !g.auto && !g.cands.length),
    rows: list.reduce((s, g) => s + g.rows.length, 0),
    badImg: (d.menus || []).filter(m => _rlBadImg(m.imageUrl)).map(m => m.id),
    items,
  };
}
function _rlGroupKey(z) { return _rlNorm(z.name) + '|' + String(z.code || '') + '|' + (z.type || 'rm'); }

if (typeof module !== 'undefined') module.exports = { _rlAnalyze, _rlNorm, _rlCore, _rlScore, _rlGroupKey };

// ─────────────────────────── UI ───────────────────────────
let _rl = null;   // { res, decisions: {groupKey: item|null} }

function _rlEsc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
const _RL_TC = { rm: '#38bdf8', mep: '#34d399', gr: '#c084fc', menu: '#fbbf24' };
function _rlBadge(t) { return `<span style="font-size:9px;padding:1px 5px;border-radius:4px;border:1px solid ${_RL_TC[t] || '#888'};color:${_RL_TC[t] || '#888'};font-family:DM Mono,monospace">${(t || '').toUpperCase()}</span>`; }

function _rlModal() {
  let m = document.getElementById('rlModal');
  if (m) return m;
  if (!document.getElementById('rlStyle')) {
    const st = document.createElement('style'); st.id = 'rlStyle';
    st.textContent = '.rl-btn{padding:8px 16px;border-radius:8px;background:var(--surface2,#151820);color:inherit;border:1px solid var(--border,#252a3a);font-size:12px;cursor:pointer}.rl-btn:disabled{opacity:.5;cursor:default}';
    document.head.appendChild(st);
  }
  m = document.createElement('div');
  m.id = 'rlModal';
  m.style.cssText = 'position:fixed;inset:0;z-index:1600;background:rgba(0,0,0,.6);display:none;align-items:flex-start;justify-content:center;padding:24px 12px;overflow:auto';
  m.innerHTML = `<div style="background:var(--surface,#111318);border:1px solid var(--border,#252a3a);border-radius:14px;width:min(920px,100%);box-shadow:0 20px 60px rgba(0,0,0,.5)">
    <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid var(--border,#252a3a)">
      <div id="rlTitle" style="font-weight:700;font-size:15px">🔗 Zutaten verknüpfen</div>
      <button onclick="closeRelinkTool()" style="background:none;border:none;color:var(--muted);font-size:22px;cursor:pointer">×</button>
    </div>
    <div id="rlBody" style="padding:16px 18px;font-size:13px"></div>
    <div id="rlFoot" style="display:flex;gap:10px;align-items:center;justify-content:flex-end;padding:12px 18px;border-top:1px solid var(--border,#252a3a)"></div>
  </div>`;
  m.addEventListener('click', e => { if (e.target === m) closeRelinkTool(); });
  document.body.appendChild(m);
  return m;
}
function closeRelinkTool() { const m = document.getElementById('rlModal'); if (m) m.style.display = 'none'; }

async function _rlFetchFresh() {
  const [md, gd] = await Promise.all([get({ action: 'getMenus' }), get({ action: 'getGRs' })]);
  if (!md || !Array.isArray(md.menus)) throw new Error('Menus konnten nicht geladen werden' + (md && md.error ? ': ' + md.error : ''));
  if (!gd || !Array.isArray(gd.grs)) throw new Error('GRs konnten nicht geladen werden' + (gd && gd.error ? ': ' + gd.error : ''));
  if (!allInventory.length) { const d = await get({ action: 'inventory' }); if (Array.isArray(d.inventory)) allInventory = d.inventory; }
  if (!Object.keys(allProducts).length) { const d = await get({ action: 'allProducts' }); if (d && !d.error && !Array.isArray(d)) allProducts = d; }
  if (!allRecipes.length) { const d = await get({ action: 'getRecipes' }); if (Array.isArray(d.recipes)) allRecipes = d.recipes; }   // MEP prices need these
  return { menus: md.menus, grs: gd.grs };
}

async function openRelinkTool() {
  _rlModal().style.display = 'flex';
  document.getElementById('rlTitle').textContent = '🔗 Zutaten verknüpfen';
  const body = document.getElementById('rlBody'), foot = document.getElementById('rlFoot');
  body.innerHTML = '<div style="color:var(--muted);padding:30px 0;text-align:center">⏳ Lade Menus, GRs, Inventar… (Menus/GRs kommen aus Google Sheets, bis ~15 s)</div>';
  foot.innerHTML = '';
  try {
    const fresh = await _rlFetchFresh();
    const res = _rlAnalyze({ menus: fresh.menus, grs: fresh.grs, inventory: allInventory, products: allProducts });
    const decisions = {};
    res.auto.forEach(g => { decisions[g.key] = g.cands[g.pick]; });
    _rl = { res, decisions, fixImg: true };
    _rlRender();
  } catch (e) {
    body.innerHTML = `<div style="color:var(--red,#f87171)">Fehler: ${_rlEsc(e.message)}</div>`;
  }
}

function _rlRender() {
  const { res } = _rl, body = document.getElementById('rlBody');
  if (!res.groups.length && !res.badImg.length) {
    body.innerHTML = '<div style="padding:30px 0;text-align:center;color:var(--green,#34d399)">✓ Alle Zutaten sind verknüpft.</div>';
    document.getElementById('rlFoot').innerHTML = '<button class="rl-btn" onclick="closeRelinkTool()">Schliessen</button>';
    return;
  }
  const opt = (g) => {
    const cur = _rl.decisions[g.key];
    return `<option value="">— nicht verknüpfen —</option>` + g.cands.map((c, i) =>
      `<option value="${i}" ${cur && cur.type === c.type && cur.code === c.code ? 'selected' : ''}>${c.type.toUpperCase()} · ${_rlEsc(c.code)} · ${_rlEsc(c.name.slice(0, 60))}${c.score < 1 ? ' (' + Math.round(c.score * 100) + '%)' : ''}</option>`).join('');
  };
  const used = g => {
    const labels = [...new Set(g.rows.map(r => r.label.trim()))];
    return `<span title="${_rlEsc(labels.join('\n'))}" style="color:var(--muted);font-size:11px;cursor:help">in ${labels.length} Rezept${labels.length > 1 ? 'en' : ''}</span>`;
  };
  const row = (g, sec) => `<div class="rl-row" data-k="${_rlEsc(g.key)}" style="display:grid;grid-template-columns:minmax(160px,1fr) minmax(220px,1.4fr);gap:10px;align-items:center;padding:8px 0;border-bottom:1px solid var(--border,#252a3a)">
      <div><div style="font-weight:500">${_rlEsc(g.name)}</div><div style="font-size:11px;color:var(--muted)">${_rlBadge(g.type)} ${g.code ? 'Code «' + _rlEsc(g.code) + '» ungültig' : 'kein Code'} · ${used(g)}</div></div>
      <div style="display:flex;flex-direction:column;gap:4px">
        <select onchange="_rlPick(this)" style="width:100%;background:var(--bg,#080a0f);border:1px solid var(--border,#252a3a);border-radius:6px;color:inherit;padding:6px;font-size:12px">${opt(g)}</select>
        ${sec !== 'auto' ? `<input placeholder="🔍 anderes Item suchen…" oninput="_rlSearch(this)" style="background:var(--bg,#080a0f);border:1px solid var(--border,#252a3a);border-radius:6px;color:inherit;padding:5px 7px;font-size:11px">` : ''}
      </div></div>`;
  const sec = (title, sub, list, key, open) => list.length ? `<details ${open ? 'open' : ''} style="margin-bottom:14px"><summary style="cursor:pointer;font-weight:600;padding:6px 0">${title} <span style="color:var(--muted);font-weight:400">(${list.length})</span></summary><div style="font-size:11px;color:var(--muted);margin:2px 0 6px">${sub}</div>${list.map(g => row(g, key)).join('')}</details>` : '';
  body.innerHTML =
    `<div style="margin-bottom:12px;color:var(--muted)">${res.rows} unverknüpfte Zutat-Zeilen (${res.groups.length} verschiedene Zutaten) in Menus und GRs gefunden.</div>` +
    sec('🟡 Zur Auswahl', 'Nicht automatisch — im Dropdown die richtige Zuordnung wählen (beste Vorschläge zuerst). Ohne Auswahl bleibt die Zeile unverändert.', res.review, 'review', true) +
    sec('⚪ Kein Vorschlag', 'Nichts Ähnliches gefunden — über die Suche selbst zuordnen, oder leer lassen.', res.none, 'none', false) +
    sec('✅ Exakte Treffer', 'Name stimmt genau überein — wird automatisch verknüpft (abwählbar).', res.auto, 'auto', false) +
    (res.badImg.length ? `<label style="display:flex;gap:8px;align-items:center;margin-top:6px"><input type="checkbox" ${_rl.fixImg ? 'checked' : ''} onchange="_rl.fixImg=this.checked;_rlFoot()"> Defekte Bild-Links entfernen (${res.badImg.length} Menus zeigen «dashboard.html» als Bild)</label>` : '') +
    '<div id="rlLog" style="margin-top:12px;font-size:12px;font-family:DM Mono,monospace;white-space:pre-wrap;max-height:220px;overflow:auto"></div>';
  _rlFoot();
}

function _rlGroup(el) { const k = el.closest('.rl-row').dataset.k; return _rl.res.groups.find(g => g.key === k); }
function _rlPick(sel) { const g = _rlGroup(sel); _rl.decisions[g.key] = sel.value === '' ? null : g.cands[+sel.value]; _rlFoot(); }
function _rlSearch(inp) {
  const g = _rlGroup(inp), q = _rlNorm(inp.value);
  if (q.length < 2) return;
  const hits = _rl.res.items.filter(it => (it.norm.includes(q) || it.code.toLowerCase().includes(q))).slice(0, 15)
    .map(it => ({ ...it, score: _rlScore(_rlCore(g.name), it.core) }));
  const keep = g.cands.filter(c => !hits.some(h => h.type === c.type && h.code === c.code));
  g.cands = hits.concat(keep).slice(0, 20);
  const sel = inp.parentElement.querySelector('select'), cur = _rl.decisions[g.key];
  sel.innerHTML = `<option value="">— nicht verknüpfen —</option>` + g.cands.map((c, i) =>
    `<option value="${i}" ${cur && cur.type === c.type && cur.code === c.code ? 'selected' : ''}>${c.type.toUpperCase()} · ${_rlEsc(c.code)} · ${_rlEsc(c.name.slice(0, 60))}</option>`).join('');
}

function _rlPlan() {
  const dec = Object.entries(_rl.decisions).filter(([, v]) => v);
  const keys = new Set(dec.map(([k]) => k));
  const recs = new Set();
  _rl.res.groups.forEach(g => { if (keys.has(g.key)) g.rows.forEach(r => recs.add(r.kind + ':' + r.ref)); });
  if (_rl.fixImg) _rl.res.badImg.forEach(id => recs.add('menu:' + id));
  const rows = _rl.res.groups.filter(g => keys.has(g.key)).reduce((s, g) => s + g.rows.length, 0);
  return { rows, recs: recs.size };
}
function _rlFoot() {
  const p = _rlPlan();
  document.getElementById('rlFoot').innerHTML =
    `<span style="color:var(--muted);font-size:12px;margin-right:auto">${p.rows} Zeilen in ${p.recs} Rezepten werden gespeichert</span>` +
    `<button class="rl-btn" onclick="closeRelinkTool()">Abbrechen</button>` +
    `<button class="rl-btn" id="rlApply" ${p.recs ? '' : 'disabled'} onclick="_rlApply()" style="background:var(--green-dim);color:var(--green);border:1px solid var(--green-brd)">✓ Übernehmen</button>`;
}

async function _rlApply() {
  const btn = document.getElementById('rlApply'); btn.disabled = true; btn.textContent = 'Speichern…';
  const log = document.getElementById('rlLog'), say = t => { log.textContent += t + '\n'; log.scrollTop = 1e9; };
  let fresh;
  try { say('Lade aktuelle Daten…'); fresh = await _rlFetchFresh(); }
  catch (e) { say('✗ ' + e.message); btn.disabled = false; btn.textContent = '✓ Übernehmen'; return; }
  const dec = _rl.decisions;
  const fixRows = recZ => {
    let n = 0;
    const out = _rlParse(recZ).map(z => {
      const t = dec[_rlGroupKey(z)];
      if (!t) return z;
      n++;
      const o = { ...z, type: t.type, code: t.code, name: t.name };
      if (!o.cost) delete o.cost;
      return o;
    });
    return { out, n };
  };
  let ok = 0, fail = 0, rowsDone = 0;
  const badImg = new Set(_rl.fixImg ? fresh.menus.filter(m => _rlBadImg(m.imageUrl)).map(m => m.id) : []);
  for (const m of fresh.menus) {
    const { out, n } = fixRows(m.zutaten), img = badImg.has(m.id);
    if (!n && !img) continue;
    // A newly linked row has no price yet, so price it in the same save — otherwise
    // the row stays at CHF 0 until someone opens and re-picks it.
    const e2 = n ? _rlEnrichWeightRows(out) : { enriched: out, waTotal: null };
    try {
      const d = await adminCall({
        action: 'saveMenu', menuId: m.id, name: m.name, category: m.category || '', art: m.art || '',
        saison: m.saison || '', gewicht: m.gewicht ?? '', menuCode: m.menuCode, garverlust: m.garverlust ?? '',
        wa: e2.waTotal == null ? (m.wa ?? '') : e2.waTotal, vk: m.vk ?? '', deko: m.deko || '', zubereitung: m.zubereitung || '',
        zutaten: JSON.stringify(e2.enriched), imageUrl: img ? '' : (m.imageUrl || ''), logoUrl: m.logoUrl || '',
        lastUpdate: new Date().toISOString()
      });
      if (d && d.error) throw new Error(d.error);
      ok++; rowsDone += n; say(`✓ ${m.menuCode} ${m.name}${n ? ' — ' + n + ' Zutaten' : ''}${img ? ' — Bild-Link entfernt' : ''}`);
    } catch (e) { fail++; say(`✗ ${m.menuCode} ${m.name}: ${e.message}`); }
  }
  // GR writes are disabled: the GAS saveGR endpoint APPENDS a new Grundrezeptur row
  // instead of updating the existing one, which produced 141 duplicate GR rows on
  // 2026-09-24 (92 -> 233). saveMenu is unaffected because it carries menuId.
  // Re-enable only once saveGR updates in place.
  const GR_WRITES_DISABLED = true;
  for (const g of fresh.grs) {
    const { out, n } = fixRows(g.zutaten);
    if (!n) continue;
    if (GR_WRITES_DISABLED) { say('- ' + g.grCode + ' ' + g.name + ' — übersprungen (GR-Speichern deaktiviert)'); continue; }
    const e2 = _rlEnrichWeightRows(out);
    try {
      const d = await adminCall({
        action: 'saveGR', grCode: g.grCode, name: g.name, art: g.art || 'Grundrezeptur',
        rohgewicht: g.rohgewicht ?? '', garverlust: g.garverlust ?? '', wa: e2.waTotal,
        zutaten: JSON.stringify(e2.enriched), zubereitung: g.zubereitung || ''
      });
      if (d && d.error) throw new Error(d.error);
      ok++; rowsDone += n; say(`✓ ${g.grCode} ${g.name} — ${n} Zutaten`);
    } catch (e) { fail++; say(`✗ ${g.grCode} ${g.name}: ${e.message}`); }
  }
  say(`\nFertig: ${ok} Rezepte gespeichert, ${rowsDone} Zutaten verknüpft${fail ? ', ' + fail + ' Fehler' : ''}.`);
  try { localStorage.removeItem('rt_cache_v1'); } catch (e) {}
  try { if (typeof loadMenus === 'function') await loadMenus(); } catch (e) {}
  try { if (typeof loadGRs === 'function') await loadGRs(); } catch (e) {}
  document.getElementById('rlFoot').innerHTML =
    `<button class="rl-btn" onclick="openRelinkTool()">↺ Erneut prüfen</button><button class="rl-btn" onclick="closeRelinkTool()">Schliessen</button>`;
}

// ═══════════════════════════════════════════════════════════
// RECALCULATE PRICES / WA  (Admin → "Preise & WA neu berechnen")
// A PDF-imported menu often stores rows that have a valid code but no price,
// because the lookup data wasn't loaded yet when the import ran — which is why
// re-picking the ingredient by hand makes the WA appear. This does that for every
// menu and GR in one pass. _enrichZutaten never clears a price (a failed lookup
// keeps the old value), so running it is safe and repeatable.
// ═══════════════════════════════════════════════════════════
// Count rows (Stk / Port.) hold a piece count, NOT kilograms. _enrichZutaten
// multiplies gewicht by a CHF/kg rate, so pricing them that way explodes the cost
// (4 Stk of a maki roll came out at CHF 7.24 instead of ~0.14, and White Torii at
// CHF 3531). Those rows are therefore left exactly as they are; only weight rows
// are repriced. Pricing a piece correctly needs a per-piece price, which the data
// does not carry yet — see the note in the Admin card.
function _rlEnrichWeightRows(arr) {
  const src = _rlParse(arr);
  const out = _enrichZutaten(src).enriched.map((z, i) => (_zIsCount(src[i]) ? src[i] : z));
  const waTotal = out.reduce((s, z) => s + (parseFloat(z.cost) || 0), 0);
  return { enriched: out, waTotal: +waTotal.toFixed(2) };
}

function _rlCostChanges(before, after) {
  let n = 0;
  after.forEach((z, i) => {
    const b = +(parseFloat((before[i] || {}).cost) || 0).toFixed(3);
    const a = +(parseFloat(z.cost) || 0).toFixed(3);
    if (Math.abs(a - b) > 0.0005) n++;
  });
  return n;
}

async function openRecalcTool() {
  _rlModal().style.display = 'flex';
  const body = document.getElementById('rlBody'), foot = document.getElementById('rlFoot');
  document.getElementById('rlTitle').textContent = '💰 Preise & WA neu berechnen';
  body.innerHTML = '<div style="color:var(--muted);padding:30px 0;text-align:center">⏳ Lade Menus, GRs, Inventar, Rezepturen… (bis ~20 s)</div>';
  foot.innerHTML = '';
  try {
    const fresh = await _rlFetchFresh();
    // fresh array refs so the cost lookup indexes rebuild
    allGRs = fresh.grs; allMenus = fresh.menus;
    const orig = new Map();
    fresh.grs.forEach(g => orig.set('gr:' + (g.grCode || g.id), _rlParse(g.zutaten)));
    fresh.menus.forEach(m => orig.set('menu:' + m.id, _rlParse(m.zutaten)));

    // GRs first, then menus twice: a menu can contain a GR or another menu, and
    // each pass feeds its new prices forward.
    const pass = (rec, key) => {
      const r = _rlEnrichWeightRows(rec.zutaten);
      rec.zutaten = JSON.stringify(r.enriched); rec.wa = r.waTotal;
      return r;
    };
    fresh.grs.forEach(g => pass(g));
    fresh.menus.forEach(m => pass(m));
    fresh.menus.forEach(m => pass(m));

    const plan = [];
    const add = (rec, kind, key) => {
      const before = orig.get(key), after = _rlParse(rec.zutaten);
      const n = _rlCostChanges(before, after);
      const waBefore = before.reduce((s, z) => s + (parseFloat(z.cost) || 0), 0);
      if (n) plan.push({ kind, rec, n, waBefore: +waBefore.toFixed(2), waAfter: rec.wa });
    };
    fresh.grs.forEach(g => add(g, 'gr', 'gr:' + (g.grCode || g.id)));
    fresh.menus.forEach(m => add(m, 'menu', 'menu:' + m.id));
    _rl = { recalc: plan };

    if (!plan.length) {
      body.innerHTML = '<div style="padding:30px 0;text-align:center;color:var(--green,#34d399)">✓ Alle Preise sind aktuell.</div>';
      foot.innerHTML = '<button class="rl-btn" onclick="closeRelinkTool()">Schliessen</button>';
      return;
    }
    const rows = plan.reduce((s, p) => s + p.n, 0);
    body.innerHTML =
      `<div style="margin-bottom:12px">${rows} Zutat-Zeilen in ${plan.length} Rezepten bekommen einen Preis (oder einen korrigierten).</div>` +
      `<div style="font-size:11px;color:var(--muted);margin-bottom:8px">Zeilen ohne gültigen Code behalten ihren bisherigen Wert — die zuerst über «Zutaten verknüpfen» verbinden.</div>` +
      '<div style="max-height:300px;overflow:auto;border:1px solid var(--border,#252a3a);border-radius:8px">' +
      plan.map(p => `<div style="display:flex;justify-content:space-between;gap:10px;padding:6px 10px;border-bottom:1px solid var(--border,#252a3a);font-size:12px">
          <span>${_rlBadge(p.kind)} ${_rlEsc((p.rec.menuCode || p.rec.grCode || '') + ' ' + (p.rec.name || ''))}</span>
          <span style="white-space:nowrap;color:var(--muted)">${p.n} Zeilen · WA ${p.waBefore.toFixed(2)} → <b style="color:var(--amber)">${Number(p.waAfter).toFixed(2)}</b></span>
        </div>`).join('') + '</div>' +
      '<div id="rlLog" style="margin-top:12px;font-size:12px;font-family:DM Mono,monospace;white-space:pre-wrap;max-height:200px;overflow:auto"></div>';
    foot.innerHTML =
      `<span style="color:var(--muted);font-size:12px;margin-right:auto">${plan.length} Rezepte werden gespeichert</span>` +
      `<button class="rl-btn" onclick="closeRelinkTool()">Abbrechen</button>` +
      `<button class="rl-btn" id="rlApply" onclick="_rlApplyRecalc()" style="background:var(--green-dim);color:var(--green);border:1px solid var(--green-brd)">✓ Übernehmen</button>`;
  } catch (e) {
    body.innerHTML = `<div style="color:var(--red,#f87171)">Fehler: ${_rlEsc(e.message)}</div>`;
  }
}

async function _rlApplyRecalc() {
  const btn = document.getElementById('rlApply'); btn.disabled = true; btn.textContent = 'Speichern…';
  const log = document.getElementById('rlLog'), say = t => { log.textContent += t + '\n'; log.scrollTop = 1e9; };
  let ok = 0, fail = 0;
  for (const p of _rl.recalc) {
    const r = p.rec;
    // see GR_WRITES_DISABLED above — saveGR duplicates rows instead of updating
    if (p.kind === 'gr') { say('- ' + r.grCode + ' ' + r.name + ' — übersprungen (GR-Speichern deaktiviert)'); continue; }
    try {
      const d = p.kind === 'menu'
        ? await adminCall({
            action: 'saveMenu', menuId: r.id, name: r.name, category: r.category || '', art: r.art || '',
            saison: r.saison || '', gewicht: r.gewicht ?? '', menuCode: r.menuCode, garverlust: r.garverlust ?? '',
            wa: r.wa, vk: r.vk ?? '', deko: r.deko || '', zubereitung: r.zubereitung || '',
            zutaten: r.zutaten, imageUrl: r.imageUrl || '', logoUrl: r.logoUrl || '',
            lastUpdate: new Date().toISOString()
          })
        : await adminCall({
            action: 'saveGR', grCode: r.grCode, name: r.name, art: r.art || 'Grundrezeptur',
            rohgewicht: r.rohgewicht ?? '', garverlust: r.garverlust ?? '', wa: r.wa,
            zutaten: r.zutaten, zubereitung: r.zubereitung || ''
          });
      if (d && d.error) throw new Error(d.error);
      ok++; say(`✓ ${(r.menuCode || r.grCode)} ${r.name} — ${p.n} Zeilen, WA ${Number(r.wa).toFixed(2)}`);
    } catch (e) { fail++; say(`✗ ${(r.menuCode || r.grCode)} ${r.name}: ${e.message}`); }
  }
  say(`\nFertig: ${ok} Rezepte aktualisiert${fail ? ', ' + fail + ' Fehler' : ''}.`);
  try { localStorage.removeItem('rt_cache_v1'); } catch (e) {}
  try { if (typeof loadMenus === 'function') await loadMenus(); } catch (e) {}
  try { if (typeof loadGRs === 'function') await loadGRs(); } catch (e) {}
  document.getElementById('rlFoot').innerHTML =
    `<button class="rl-btn" onclick="openRecalcTool()">↺ Erneut prüfen</button><button class="rl-btn" onclick="closeRelinkTool()">Schliessen</button>`;
}
