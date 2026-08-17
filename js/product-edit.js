// Kitchen MEP — Product edit modal (feature module, classic script).
// Extracted from dashboard.html (monolith→modules restructure). Event-driven
// (opened on edit click), loaded via <script src> before </body>. Top-level
// functions become globals for the inline onclick/oninput handlers; reads the
// shared globals that stay in dashboard.html (allProducts, allInventory,
// allRecipes, allMenus, salesData, get, adminCall, loadProducts, filterProducts,
// loadSalesAnalysis, _epfImgFile, _uploadItemImage, adminMsg).

// Product edit modal
async function openEditProductModal(code) {
  const _epm = document.getElementById("editProductModal");
  if (!_epm) return;

  _epm.classList.add("active");
  _onPopupOpen();

  const setVal = (id, val) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.value = (val === null || val === undefined) ? "" : String(val);
  };
  const setTxt = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val || "";
  };

  setTxt("editProductTitle", "Loading…");
  setTxt("epf-msg", "");

  // Fetch fresh products AND recipes in parallel
  try {
    const [pd, rd] = await Promise.allSettled([
      get({ action: "allProducts" }),
      get({ action: "getRecipes" })
    ]);
    if (pd.status === "fulfilled" && pd.value && !pd.value.error && typeof pd.value === "object" && !Array.isArray(pd.value)) {
      allProducts = pd.value;
      try { sessionStorage.setItem("dash_products", JSON.stringify(allProducts)); } catch(e) {}
    }
    if (rd.status === "fulfilled" && Array.isArray(rd.value?.recipes)) {
      allRecipes = rd.value.recipes;
    }
  } catch(e) { console.error("openEditProductModal fetch error:", e); }

  const p = allProducts[code] || {};

  setVal("epf-code",      code);
  setVal("epf-name",      p.name      ?? "");
  setVal("epf-kategorie", p.kategorie ?? "");
  setVal("epf-mepmax",    p.mepMax    != null ? p.mepMax    : "");
  setVal("epf-gnsize",    p.gnSize    ?? "");
  setVal("epf-gnweight",  p.gnWeight  != null ? p.gnWeight  : "");
  setVal("epf-tagesziel", p.tagesziel != null ? p.tagesziel : "");
  setVal("epf-shelf",     p.shelfLife != null ? p.shelfLife : "");
  const _epfImgUrl = p.image || p.driveLink || p.photoLink || "";
  setVal("epf-drive", _epfImgUrl);
  _epfImgFile = null;
  const _epfImgElLoad = document.getElementById('epf-img-el');
  const _epfImgPrevLoad = document.getElementById('epf-img-preview');
  if (_epfImgElLoad) _epfImgElLoad.src = _epfImgUrl;
  if (_epfImgPrevLoad) _epfImgPrevLoad.style.display = _epfImgUrl ? 'block' : 'none';
  ['epf-img-file','epf-img-file-cam'].forEach(id => { const f = document.getElementById(id); if (f) f.value = ''; });

  setTxt("editProductTitle", "Edit — " + (p.name || code));

  renderEpfRmList(code);
  setTimeout(() => {
    calcEpfMaxGN();
    calcEpfSuggestion(code);
    // Auto-load sales data if not yet loaded so suggestion shows without visiting Sales tab
    if (!salesData.products.length) {
      loadSalesAnalysis().then(() => calcEpfSuggestion(code)).catch(() => {});
    }
  }, 0);
}

function closeEditProductModal() {
  document.getElementById("editProductModal").classList.remove("active");
  document.getElementById("epf-rm-picker").style.display = "none";
  _onPopupClose();
}

async function deleteProductFromModal() {
  const code = document.getElementById("epf-code")?.value;
  if (!code) return;
  const name = allProducts[code]?.name || code;
  if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
  const btn = document.querySelector("#editProductModal .btn-delete");
  if (btn) { btn.disabled = true; btn.textContent = "Deleting…"; }
  try {
    await adminCall({ action: "deleteProduct", code });
    closeEditProductModal();
    // Remove from local allProducts immediately — no refresh needed
    delete allProducts[code];
    populateProductCategories();
    filterProducts();
    renderAdminProducts();
  } catch(e) {
    const msg = document.getElementById("epf-msg");
    if (msg) { msg.textContent = "Error: " + e.message; msg.className = "admin-msg err"; }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "🗑 Delete"; }
  }
}

// ── EPF RM management ──
var _epfCurrentCode = "";

function renderEpfRmList(code) {
  _epfCurrentCode = code;
  const el = document.getElementById("epf-rm-list");
  if (!el) return;
  const rms = allRecipes.filter(r => r.mepCode === code);
  if (!rms.length) {
    el.innerHTML = `<div style="font-size:12px;color:var(--muted);font-style:italic">No ingredients — click ＋ Add RM</div>`;
    calcEpfSuggestion(code);
    return;
  }
  const p = allProducts[code] || {};
  const kgPerGN = parseFloat(p.gnWeight) || 0;
  const target  = parseFloat(p.tagesziel || p.mepMax) || 0;
  el.innerHTML = rms.map(r => {
    const inv = allInventory.find(x => x.code === r.rmCode) || {};
      const totalNeeded = target > 0 && r.menge ? (target * parseFloat(r.menge)).toFixed(3) : null;
      const _weightUnit = parseFloat(inv?.weightUnit) || 1;
      const pricePerKg = _weightUnit > 0 ? (parseFloat(inv?.kostenUnit) || 0) / _weightUnit : (parseFloat(inv?.kostenUnit) || 0);
        const mengeKg    = parseFloat(r.menge) || 0;
        const garvPct    = parseFloat(r.garverlust) || 0;
        // Raw kg needed accounting for cooking loss
        const rawKg      = garvPct > 0 ? mengeKg / (1 - garvPct / 100) : mengeKg;
        const costPerGN  = rawKg * pricePerKg;
        // WA per kg netto = price adjusted for cooking loss
        const waPerKgNetto = garvPct > 0 ? pricePerKg / (1 - garvPct / 100) : pricePerKg;
        return `<div style="display:flex;align-items:center;gap:8px;padding:6px 10px;background:var(--surface);border:1px solid var(--border);border-radius:8px">
          <span style="font-size:10px;padding:1px 6px;border-radius:4px;background:var(--blue-dim);color:var(--blue);font-weight:700">RM</span>
          <div style="flex:1;min-width:0">
            <div style="font-size:12px;font-weight:500">${inv.name || r.rmCode}</div>
            <div style="font-size:10px;color:var(--muted)">
              ${mengeKg} ${r.einheit}/GN
              ${garvPct > 0 ? `· <span style="color:var(--red)">🔥 ${garvPct}% loss → raw ${rawKg.toFixed(3)} kg</span>` : ''}
              ${totalNeeded ? `· <span style="color:var(--amber)">Total: ${(parseFloat(totalNeeded)*( garvPct>0 ? 1/(1-garvPct/100) : 1)).toFixed(3)} ${r.einheit} raw</span>` : ''}
              ${pricePerKg > 0 ? `· <span style="color:var(--muted)">CHF ${pricePerKg.toFixed(2)}/kg</span>` : ''}
              ${costPerGN > 0 ? `· <span style="color:var(--blue)">CHF ${costPerGN.toFixed(3)}/GN</span>` : ''}
              ${waPerKgNetto > 0 && garvPct > 0 ? `· <span style="color:var(--amber)">WA ${waPerKgNetto.toFixed(2)} CHF/kg netto</span>` : ''}
            </div>
          </div>
      <button data-code="${code}" data-rm="${r.rmCode}" class="epf-rm-edit-btn" style="background:var(--amber-dim);border:1px solid var(--amber-brd);color:var(--amber);border-radius:6px;padding:3px 7px;cursor:pointer;font-size:11px">✏️</button>
      <button data-code="${code}" data-rm="${r.rmCode}" class="epf-rm-del-btn" style="background:none;border:none;color:var(--red);cursor:pointer;font-size:14px;padding:0 4px">✕</button>
    </div>`;
  }).join("");
  el.querySelectorAll('.epf-rm-edit-btn').forEach(btn => btn.addEventListener('click', () => editEpfRmRow(btn.dataset.code, btn.dataset.rm)));
  el.querySelectorAll('.epf-rm-del-btn').forEach(btn => btn.addEventListener('click', () => deleteEpfRm(btn.dataset.code, btn.dataset.rm)));
  // Recalc suggestion after RM changes (but not on initial open — openEditProductModal handles that)
  if (document.getElementById("editProductModal")?.classList.contains("active")) {
    setTimeout(() => calcEpfSuggestion(code), 0);
  }
}
function autoFillMepMaxFromSales() {
  const code    = _epfCurrentCode;
  const p       = allProducts[code] || {};
  const kgPerGN = parseFloat(document.getElementById("epf-gnweight")?.value) || parseFloat(p.gnWeight) || 0;
  const hintEl  = document.getElementById("epf-sales-hint");

  if (!salesData?.products?.length) {
    if (hintEl) hintEl.textContent = "⏳ Loading sales data…";
    loadSalesAnalysis().then(() => autoFillMepMaxFromSales()).catch(() => {
      if (hintEl) hintEl.textContent = "⚠ Could not load sales data";
    });
    return;
  }

  // Match by MEP name or via menus that use this MEP
  const pNameLow = (p.name || "").toLowerCase().trim();
  let match = salesData.products.find(sp =>
    (sp.name || "").toLowerCase().trim() === pNameLow
  ) || salesData.products.find(sp =>
    (sp.name || "").toLowerCase().includes(pNameLow) ||
    pNameLow.includes((sp.name || "").toLowerCase().trim())
  );

  // Try via menus
  if (!match) {
    const menusWithMep = allMenus.filter(m => {
      try { return JSON.parse(m.zutaten || "[]").some(z => z.type === "mep" && z.code === code); }
      catch(e) { return false; }
    });
    for (const menu of menusWithMep) {
      const mName = (menu.name || "").toLowerCase().trim();
      match = salesData.products.find(sp =>
        (sp.name || "").toLowerCase().trim() === mName ||
        (sp.name || "").toLowerCase().includes(mName)
      );
      if (match) break;
    }
  }

  if (!match) {
    if (hintEl) hintEl.textContent = "⚠ No sales match found";
    return;
  }

  // avg last 7d × 1.2 safety buffer × kgPerGN
  const avgDaily     = parseFloat(match.avgDaily) || 0;
  const suggested    = Math.ceil(avgDaily * 1.2);
  const suggestedKg  = kgPerGN > 0 ? +(suggested * kgPerGN).toFixed(2) : null;

  const maxEl = document.getElementById("epf-mepmax");
  if (maxEl) maxEl.value = suggestedKg !== null ? suggestedKg : suggested;

  if (hintEl) hintEl.textContent = suggestedKg !== null
    ? `✓ avg ${avgDaily}/day → ${suggested} GN × ${kgPerGN}kg = ${suggestedKg}kg`
    : `✓ avg ${avgDaily}/day → ${suggested} GN (set GN weight for kg)`;

  calcEpfMaxGN();
}
function calcEpfMaxGN() {
  const maxKg   = parseFloat(document.getElementById("epf-mepmax")?.value)   || 0;
  const kgPerGN = parseFloat(document.getElementById("epf-gnweight")?.value) || 0;
  const el      = document.getElementById("epf-gn-count");
  if (!el) return;
  if (maxKg > 0 && kgPerGN > 0) {
    const gnCount = Math.ceil(maxKg / kgPerGN);
    el.textContent = `${gnCount} GN  (${maxKg} kg ÷ ${kgPerGN} kg/GN)`;
    el.style.color = "var(--green)";
    // Auto-fill Daily Target if empty
    const tzEl = document.getElementById("epf-tagesziel");
    if (tzEl && !tzEl.value) tzEl.value = gnCount;
  } else if (maxKg > 0) {
    el.textContent = `${maxKg} kg — set GN Weight to calc GN count`;
    el.style.color = "var(--amber)";
  } else {
    el.textContent = "—";
    el.style.color = "var(--muted)";
  }
  calcEpfSuggestion(_epfCurrentCode);
}
function calcEpfSuggestion(code) {
  const el = document.getElementById("epf-suggestion");
  if (!el) return;
  const p = allProducts[code] || {};

  // Read from modal fields first, fall back to allProducts data
  // Use ?? "" to avoid NaN from empty string
  const fMax    = document.getElementById("epf-mepmax");
  const fKg     = document.getElementById("epf-gnweight");
  const fTarget = document.getElementById("epf-tagesziel");
  const maxGN   = (fMax    && fMax.value    !== "") ? parseFloat(fMax.value)    : parseFloat(p.mepMax)    || 0;
  const kgPerGN = (fKg     && fKg.value     !== "") ? parseFloat(fKg.value)     : parseFloat(p.gnWeight)  || 0;
  const target  = (fTarget && fTarget.value !== "") ? parseFloat(fTarget.value) : parseFloat(p.tagesziel) || 0;
  const totalKg = maxGN * kgPerGN;

  let html = "";

  // ── Volume row ──
  // ── Volume row — MEP Max is now in kg ──
  const maxKgVal = maxGN; // maxGN field now stores kg
  const gnCount  = (kgPerGN > 0 && maxKgVal > 0) ? Math.ceil(maxKgVal / kgPerGN) : 0;
  if (maxKgVal > 0 && kgPerGN > 0) {
    html += `<div style="margin-bottom:4px">
      <span style="color:var(--green)">📦 Max: <strong>${maxKgVal} kg → ${gnCount} GN</strong> (${kgPerGN} kg/GN)</span>`;
    if (target > 0) {
      html += `<span style="color:var(--amber);margin-left:12px">· Target: <strong>${target} GN = ${(target*kgPerGN).toFixed(2)} kg</strong></span>`;
    }
    html += `</div>`;
  } else if (!kgPerGN || !maxKgVal) {
    html += `<div style="color:var(--faint);font-size:11px;margin-bottom:4px">Enter MEP Max (kg) and GN Weight to see GN count</div>`;
  }

  // ── WA from RM ──
  const rms = allRecipes.filter(r => r.mepCode === code);
  if (rms.length) {
    let waPerGN = 0;
    rms.forEach(r => {
      const inv = allInventory.find(x => x.code === r.rmCode);
      const _wu = parseFloat(inv?.weightUnit) || 1;
            const pricePerKg = inv ? (parseFloat(inv.kostenUnit) || 0) / _wu : 0;
      const qty = parseFloat(r.menge) || 0;
      waPerGN += qty * pricePerKg;
    });
    const waTotal = waPerGN * (target > 0 ? target : maxGN);
    html += `<div style="margin-bottom:4px">
      <span style="color:var(--blue)">💰 WA/GN: <strong>CHF ${waPerGN.toFixed(2)}</strong></span>
      ${(target||maxGN) > 0 ? `<span style="color:var(--blue);margin-left:12px">· Total WA (${target||maxGN} GN): <strong>CHF ${waTotal.toFixed(2)}</strong></span>` : ""}
    </div>`;
  } else {
    html += `<div style="color:var(--faint);font-size:11px;margin-bottom:4px">Add RM ingredients to calculate WA cost</div>`;
  }

 // ── Sales suggestion: match MEP → menus that use it → menu names vs sales ──
  let match = null;
  let matchedMenuName = "";
  if (salesData?.products?.length) {
    const pNameLow = (p.name || "").toLowerCase().trim();

    // Strategy 1: direct MEP name vs sales name
    const tryDirect = (name) => {
      if (!name) return null;
      const n = name.toLowerCase().trim();
      return salesData.products.find(sp => (sp.name||"").toLowerCase().trim() === n)
          || salesData.products.find(sp => (sp.name||"").toLowerCase().includes(n))
          || salesData.products.find(sp => n.includes((sp.name||"").toLowerCase().trim()))
          || salesData.products.find(sp => {
               const pw = n.split(/\s+/).filter(w=>w.length>3);
               const sw = (sp.name||"").toLowerCase().split(/\s+/);
               return pw.length && pw.some(w => sw.some(s => s.includes(w)||w.includes(s)));
             });
    };

    match = tryDirect(p.name);

    // Strategy 2: find menus that contain this MEP code → try those menu names
    if (!match) {
      const menusWithThisMep = allMenus.filter(m => {
        try {
          const z = JSON.parse(m.zutaten || "[]");
          return z.some(z => z.type === "mep" && z.code === code);
        } catch(e) { return false; }
      });
      for (const menu of menusWithThisMep) {
        const m2 = tryDirect(menu.name);
        if (m2) { match = m2; matchedMenuName = menu.name; break; }
      }
    }

    // Strategy 3: match by MEP code in sales (if sales imported with codes)
    if (!match) {
      match = salesData.products.find(sp => (sp.code||"") === code);
    }
  }

  if (match) {
    // Update the hint label automatically
    const hintEl = document.getElementById("epf-sales-hint");
    if (hintEl && !hintEl.textContent) hintEl.textContent = `avg ${match.avgDaily || 0}/day last 7d`;
    const suggested = match.suggestedMep || Math.ceil((match.avgDaily||0)*1.2) || 0;
    const sugKg  = kgPerGN > 0 ? ` = ${(suggested*kgPerGN).toFixed(2)} kg → set MEP Max to ${(suggested*kgPerGN).toFixed(1)} kg` : "";
    const rms2   = allRecipes.filter(r => r.mepCode === code);
    let waPerGN2 = 0;
    rms2.forEach(r => {
      const inv = allInventory.find(x => x.code === r.rmCode);
      waPerGN2 += (parseFloat(r.menge)||0) * (inv ? parseFloat(inv.kostenUnit)||0 : 0);
    });
    const sugWa  = (waPerGN2 > 0 && suggested > 0) ? ` · WA CHF ${(waPerGN2*suggested).toFixed(2)}` : "";
    const via    = matchedMenuName ? ` <span style="font-size:10px;color:var(--muted)">via "${matchedMenuName}"</span>` : "";
    const period = _salesPeriodDays === 0 ? "all time" : `last ${_salesPeriodDays}d`;
    html += `<div style="color:var(--amber)">📈 Sales (${period}): avg <strong>${match.avgDaily}/day</strong>${via}
      · suggested <strong style="color:var(--green)">${suggested} GN${sugKg}${sugWa}</strong></div>`;
  } else if (salesData?.products?.length) {
    html += `<div style="color:var(--faint);font-size:11px">No sales match — ensure menu names match POS product names, or import CSV</div>`;
  } else {
    html += `<div style="color:var(--faint);font-size:11px">Open Sales tab and import CSV to see suggestion</div>`;
  }

  el.innerHTML = html;
}

var _epfRmSelected = null;
function editEpfRmRow(mepCode, rmCode) {
  const r   = allRecipes.find(x => x.mepCode === mepCode && x.rmCode === rmCode);
  const inv = allInventory.find(x => x.code === rmCode) || {};
  if (!r) return;
  // Pre-select in picker
  _epfRmSelected = { code: rmCode, name: inv.name || rmCode, unit: r.einheit || "kg",
    unitCost: (parseFloat(inv.kostenUnit || 0)) / (parseFloat(inv.weightUnit) || 1) }; // CHF/kg = kostenUnit / weightUnit
  openEpfRmPicker();
  setTimeout(() => {
    // Fill search so user sees the item
    const searchEl = document.getElementById("epf-rm-search");
    if (searchEl) { searchEl.value = inv.name || rmCode; filterEpfRmSearch(); }
    // Pre-fill detail fields
    selectEpfRm(rmCode, inv.name || rmCode, r.einheit || "kg");
    document.getElementById("epf-rm-qty").value        = r.menge        || "";
    document.getElementById("epf-rm-garverlust").value = r.garverlust   || "";
    document.getElementById("epf-rm-unit").value       = r.einheit      || "kg";
    calcEpfRmGarverlust();
    // On confirm — delete old row first then save new
    const origSave = window.saveEpfRmRow;
    window.saveEpfRmRow = async function() {
      await deleteEpfRm(mepCode, rmCode, true); // silent delete
      await origSave.call(this);
      window.saveEpfRmRow = origSave;
    };
  }, 80);
}
function openEpfRmPicker() {
  const picker = document.getElementById("epf-rm-picker");
  if (!picker) return;
  const isOpen = picker.style.display !== "none";
  picker.style.display = isOpen ? "none" : "block";
  if (!isOpen) {
    _epfRmSelected = null;
    document.getElementById("epf-rm-search").value = "";
    document.getElementById("epf-rm-qty").value = "";
    document.getElementById("epf-rm-unit").value = "";
    document.getElementById("epf-rm-garverlust").value = "";
    document.getElementById("epf-rm-msg").textContent = "";
    document.getElementById("epf-rm-detail").style.display = "none";
    document.getElementById("epf-rm-garv-result").style.display = "none";
    filterEpfRmSearch();
    document.getElementById("epf-rm-search").focus();
  }
}

function filterEpfRmSearch() {
  const q = (document.getElementById("epf-rm-search")?.value || "").toLowerCase();
  const el = document.getElementById("epf-rm-results");
  if (!el) return;
  const items = allInventory.filter(r => r.code).sort((a,b) => (a.name||"").localeCompare(b.name||""));
  const filtered = q
    ? items.filter(r => (r.name||"").toLowerCase().includes(q) || r.code.toLowerCase().includes(q))
    : items;
  if (!filtered.length) {
    el.innerHTML = `<div style="font-size:12px;color:var(--muted);padding:4px 6px">No results for "${q}"</div>`;
    return;
  }
  el.innerHTML = filtered.slice(0, 40).map(r => {
    const sc = (r.code||'').replace(/"/g,'&quot;');
    const sn = (r.name||r.code||'').replace(/"/g,'&quot;');
    const su = (r.unit||'kg').replace(/"/g,'&quot;');
    return `<div class="epf-rm-pick-row" data-code="${sc}" data-name="${sn}" data-unit="${su}"
      style="padding:6px 10px;border-radius:6px;cursor:pointer;font-size:12px;display:flex;align-items:center;gap:8px;border:1px solid transparent"
      onmouseover="this.style.background='var(--surface2)';this.style.borderColor='var(--blue-brd)'"
      onmouseout="this.style.background='';this.style.borderColor='transparent'">
      <span style="font-weight:500;flex:1">${r.name||r.code}</span>
      <span style="font-size:10px;color:var(--muted)">${r.code}</span>
      ${r.kostenUnit ? `<span style="font-size:10px;color:var(--amber)">CHF ${((parseFloat(r.kostenUnit) || 0) / (parseFloat(r.weightUnit) || 1)).toFixed(2)}/kg</span>` : ""}
    </div>`;
  }).join("");
}

function selectEpfRm(code, name, unit) {
  const inv = allInventory.find(x => x.code === code);
  _epfRmSelected = { code, name, unit,
    unitCost: (parseFloat(inv?.kostenUnit || 0)) / (parseFloat(inv?.weightUnit) || 1) }; // CHF/kg = kostenUnit / weightUnit
  document.getElementById("epf-rm-selected-name").textContent = `✓ ${name} (${code})`;
  document.getElementById("epf-rm-detail").style.display = "block";
  document.getElementById("epf-rm-unit").value = unit || "kg";
  document.getElementById("epf-rm-qty").value = "";
  document.getElementById("epf-rm-garverlust").value = "";
  document.getElementById("epf-rm-garv-result").style.display = "none";
  document.getElementById("epf-rm-netto").textContent = "—";
  document.getElementById("epf-rm-wa-raw").textContent = "—";
  document.getElementById("epf-rm-cost").textContent = "—";
  document.getElementById("epf-rm-qty").focus();
}

function calcEpfRmGarverlust() {
  if (!_epfRmSelected) return;
  const qty    = parseFloat(document.getElementById("epf-rm-qty")?.value)         || 0;
  const garv   = parseFloat(document.getElementById("epf-rm-garverlust")?.value)  || 0;
  const result = document.getElementById("epf-rm-garv-result");
  if (!qty) { if (result) result.style.display = "none"; return; }

  const netto   = garv > 0 ? qty * (1 - garv / 100) : qty;
  const waRaw   = garv > 0 ? qty / (1 - garv / 100) : qty; // raw kg needed to get qty netto
  const cost    = qty * (_epfRmSelected.unitCost || 0);

  document.getElementById("epf-rm-netto").textContent   = netto.toFixed(3) + " kg";
  document.getElementById("epf-rm-wa-raw").textContent  = waRaw.toFixed(3);
  document.getElementById("epf-rm-cost").textContent    = cost > 0 ? `CHF ${cost.toFixed(3)}` : "—";
  if (result) result.style.display = "flex";
}

async function saveEpfRmRow() {
  const msgEl  = document.getElementById("epf-rm-msg");
  if (!_epfRmSelected) { if (msgEl) msgEl.textContent = "Select a raw material first"; return; }
  const rmCode     = _epfRmSelected.code;
  const menge      = document.getElementById("epf-rm-qty")?.value;
  const einheit    = (document.getElementById("epf-rm-unit")?.value || "kg").trim();
  const garverlust = parseFloat(document.getElementById("epf-rm-garverlust")?.value) || 0;
  if (!menge || parseFloat(menge) <= 0) { if (msgEl) msgEl.textContent = "Enter quantity > 0"; return; }
  if (!_epfCurrentCode) return;
  try {
    const data = await adminCall({ action:"saveRecipe", mepCode:_epfCurrentCode, rmCode, menge, einheit, garverlust });
    if (data.error) throw new Error(data.error);
    // Refresh allRecipes
    const rd = await get({ action:"getRecipes" }).catch(() => ({}));
    allRecipes = Array.isArray(rd.recipes) ? rd.recipes : allRecipes;
    renderEpfRmList(_epfCurrentCode);
    document.getElementById("epf-rm-picker").style.display = "none";
    if (msgEl) msgEl.textContent = "";
  } catch(e) {
    if (msgEl) msgEl.textContent = "Error: " + e.message;
  }
}

async function deleteEpfRm(mepCode, rmCode, silent) {
  if (!silent && !confirm("Remove this ingredient?")) return;
  try {
    const data = await adminCall({ action:"deleteRecipe", mepCode, rmCode });
    if (data.error) throw new Error(data.error);
    const rd = await get({ action:"getRecipes" }).catch(() => ({}));
    allRecipes = Array.isArray(rd.recipes) ? rd.recipes : allRecipes;
    renderEpfRmList(mepCode);
  } catch(e) { alert("Error: " + e.message); }
}

async function saveEditedProduct() {
  const g = (id) => document.getElementById(id);
  const v = (id) => (g(id)?.value || "").trim();
  // Re-read directly to avoid stale closure
  const codeEl = document.getElementById("epf-code");
  const nameEl = document.getElementById("epf-name");
  const code = (codeEl?.value || "").trim();
  const name = (nameEl?.value || "").trim();
  if (!code || !name) {
    adminMsg("epf-msg", `Missing: ${!code?"Code ":""}${!name?"Name":""}`, "err");
    console.warn("epf fields:", { codeEl, nameEl, code, name,
      modalActive: document.getElementById("editProductModal")?.classList.contains("active") });
    return;
  }
  const btn = document.querySelector("#editProductModal .btn-save");
  if (btn) { btn.disabled = true; btn.textContent = "Saving…"; }
  try {
    let _epfSaveImg = document.getElementById('epf-img-el')?.src || '';
    if (_epfSaveImg.startsWith('data:') && _epfImgFile) {
      adminMsg('epf-msg', '📤 Bild wird hochgeladen…', '');
      try { _epfSaveImg = await _uploadItemImage(_epfImgFile, 'mep'); _epfImgFile = null; }
      catch(e) { adminMsg('epf-msg', e.message, 'err'); if (btn) { btn.disabled = false; btn.textContent = 'Save'; } return; }
    }
    if (!_epfSaveImg.startsWith('http')) _epfSaveImg = v("epf-drive");
    const mepMax    = v("epf-mepmax");
    const gnWeight  = v("epf-gnweight");
    const tagesziel = v("epf-tagesziel");
    const shelf     = v("epf-shelf");
    const payload = {
      action    : "saveProduct",
      code, name,
      kategorie : v("epf-kategorie"),
      mepMax    : mepMax    === "" ? "" : Number(mepMax),
      gnSize    : v("epf-gnsize"),
      gnWeight  : gnWeight  === "" ? "" : Number(gnWeight),
      tagesziel : tagesziel === "" ? "" : Number(tagesziel),
      shelfLife : shelf     === "" ? "" : Number(shelf),
      driveLink : _epfSaveImg,
    };
    const data = await adminCall(payload);
    if (!data) throw new Error("No response from server");
    if (data.error) throw new Error(data.error);
    adminMsg("epf-msg", "✓ Saved", "ok");
    await loadProducts();
    filterProducts();
    setTimeout(() => closeEditProductModal(), 800);
  } catch(e) {
    adminMsg("epf-msg", "Error: " + e.message, "err");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Save"; }
  }
}
