// Kitchen MEP — Inventory edit modal (feature module, classic script).
// Extracted from dashboard.html (monolith->modules restructure). Event-driven,
// loaded via <script src> before </body>. All entry points are inline
// onclick/oninput/onchange handlers on the eif-* fields in dashboard.html, so
// these functions must stay global (classic script, not a module).
// Reads shared globals that stay in dashboard.html: allInventory, allProducts,
// get, adminCall, loadInventory, filterInventory, _uploadItemImage,
// _onPopupOpen/_onPopupClose, showToast. The readonly guard at the bottom
// replaces the old inline monkey-patch.

// Inventory edit modal
function openEditInventoryModal(code) {
  const r = allInventory.find(x => x.code === code) || {};
  document.getElementById("eif-code").value = code;
  document.getElementById("eif-name").value = r.name || (allProducts[code]?.name || "");
  document.getElementById("eif-kategorie").value = r.kategorie || (allProducts[code]?.kategorie || "");
  document.getElementById("eif-unit").value = r.unit || "";
  document.getElementById("eif-qty").value = r.quantity ?? "";
  document.getElementById("eif-weight").value = r.weightUnit ?? "";
  document.getElementById("eif-min").value = r.minimum ?? "";
  document.getElementById("eif-max").value = r.maximum ?? "";
  document.getElementById("eif-kosten").value = r.kostenUnit ?? "";
  document.getElementById("eif-lieferant").value = r.lieferant || "";
  document.getElementById("eif-lastorder").value = r.lastOrder || "";
  document.getElementById("eif-notizen").value = r.notizen || "";
  _renderEifAllergenChips(r.allergen || '');
  _eifImgFile = null;
  const _eifImgEl = document.getElementById('eif-img-el');
  const _eifImgPrev = document.getElementById('eif-img-preview');
  if (_eifImgEl) _eifImgEl.src = r.image || '';
  if (_eifImgPrev) _eifImgPrev.style.display = r.image ? 'block' : 'none';
  ['eif-img-file','eif-img-file-cam'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  document.getElementById("editInventoryTitle").textContent = "Edit - " + (r.name || code);
  document.getElementById("eif-msg").textContent = "";
  const kcP = document.getElementById("eif-kc-pieces"); if (kcP) kcP.value = "";
  const kcE = document.getElementById("eif-kc-each");   if (kcE) kcE.value = "";
  const kcR = document.getElementById("eif-kc-result"); if (kcR) kcR.textContent = "—";
  document.getElementById("editInventoryModal").classList.add("active");
  _onPopupOpen();
  calcEifPer100g();
}
function calcKartonWeight() {
  const pieces = parseFloat(document.getElementById("eif-kc-pieces")?.value) || 0;
  const each   = parseFloat(document.getElementById("eif-kc-each")?.value)   || 0;
  const unit   = document.getElementById("eif-kc-unit")?.value || "ml";
  const el     = document.getElementById("eif-kc-result");
  if (!el) return;
  if (pieces <= 0 || each <= 0) { el.textContent = "—"; return; }
  const toKg = { ml: 0.001, g: 0.001, L: 1, kg: 1 };
  const totalKg = pieces * each * (toKg[unit] || 0.001);
  el.textContent = totalKg.toFixed(3) + " kg";
}
function applyKartonWeight() {
  const el = document.getElementById("eif-kc-result");
  if (!el || el.textContent === "—") return;
  const kg = parseFloat(el.textContent);
  if (isNaN(kg)) return;
  const w = document.getElementById("eif-weight");
  if (w) { w.value = kg.toFixed(3); calcEifPer100g(); }
}
function calcEifPer100g() {
  const kosten     = parseFloat(document.getElementById("eif-kosten")?.value) || 0;
  const weightUnit = parseFloat(document.getElementById("eif-weight")?.value) || 0;
  const el         = document.getElementById("eif-per100g");
  if (!el) return;
  if (kosten > 0 && weightUnit > 0) {
    // kostenUnit = CHF per 1 unit, weightUnit = kg per unit
    // CHF per kg = kosten / weightUnit, CHF per 100g = that / 10
    const per100g = (kosten / weightUnit) / 10;
    el.textContent = "CHF " + per100g.toFixed(3);
  } else if (kosten > 0) {
    // Assume unit is already per kg
    el.textContent = "CHF " + (kosten / 10).toFixed(3) + " (no weight set)";
  } else {
    el.textContent = "—";
  }
}
let _eifImgFile = null;
function previewEifImg(input) {
  const file = input.files[0]; if (!file) return;
  _eifImgFile = file;
  const reader = new FileReader();
  reader.onload = e => {
    document.getElementById('eif-img-el').src = e.target.result;
    document.getElementById('eif-img-preview').style.display = 'block';
  };
  reader.readAsDataURL(file);
}
function removeEifImage() {
  const el = document.getElementById('eif-img-el'); if (el) el.src = '';
  document.getElementById('eif-img-preview').style.display = 'none';
  ['eif-img-file','eif-img-file-cam'].forEach(id => { const f = document.getElementById(id); if (f) f.value = ''; });
  _eifImgFile = null;
}
function _renderEifAllergenChips(val) {
  const active = new Set((val||'').split(',').map(s=>s.trim()).filter(Boolean));
  const el = document.getElementById('eif-allergen-chips');
  if (!el) return;
  el.innerHTML = EU_ALLERGENS.map(a => {
    const on = active.has(a);
    return `<button type="button" data-allergen="${a}" data-on="${on?'1':'0'}" onclick="_toggleEifAllergen(this)"
      style="padding:3px 10px;border-radius:20px;font-size:11px;cursor:pointer;font-weight:600;transition:all .15s;
      ${on?'background:rgba(239,68,68,0.12);border:1px solid var(--red);color:var(--red)':'background:var(--surface3);border:1px solid var(--border2);color:var(--muted)'}">${a}</button>`;
  }).join('');
}
function _toggleEifAllergen(btn) {
  const on = btn.dataset.on === '1';
  btn.dataset.on = on ? '0' : '1';
  if (on) {
    btn.style.background = 'var(--surface3)'; btn.style.borderColor = 'var(--border2)'; btn.style.color = 'var(--muted)';
  } else {
    btn.style.background = 'rgba(239,68,68,0.12)'; btn.style.borderColor = 'var(--red)'; btn.style.color = 'var(--red)';
  }
}
function _getEifAllergenValue() {
  const el = document.getElementById('eif-allergen-chips');
  if (!el) return '';
  return [...el.querySelectorAll('button[data-on="1"]')].map(b => b.dataset.allergen).join(',');
}
function closeEditInventoryModal() {
  document.getElementById("editInventoryModal").classList.remove("active");
  setTimeout(() => calcEifPer100g(), 0);
  _onPopupClose();
}

  async function deleteInventoryItem(code) {
  if (!code) return;
  const name = document.getElementById("eif-name")?.value || code;
  if (!confirm(`Delete "${name}" from inventory? This cannot be undone.`)) return;
  const btn = document.querySelector("#editInventoryModal .btn-del");
  if (btn) { btn.disabled = true; btn.textContent = "Deleting…"; }
  try {
    const data = await adminCall({ action: "deleteInventory", code });
    if (data.error) throw new Error(data.error);
    // Remove from local cache immediately so list updates before network refresh
    allInventory = allInventory.filter(r => r.code !== code);
    try { sessionStorage.setItem("dash_inventory", JSON.stringify(allInventory)); } catch(e) {}
    closeEditInventoryModal();
    try { renderAdminInventory(); } catch(e) {}
    try { filterInventory(); } catch(e) {}
    // Refresh from server in background
    loadInventory().catch(() => {});
  } catch(e) {
    adminMsg("eif-msg", "Error: " + e.message, "err");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "🗑 Delete"; }
  }
}
  
async function saveEditedInventory() {
  const code = document.getElementById("eif-code").value.trim();
  if (!code) { adminMsg("eif-msg", "Code is required", "err"); return; }
  const btn = document.querySelector("#editInventoryModal .btn-save");
  btn.disabled = true;
  btn.textContent = "Saving…";
  try {
    let _eifSaveImg = document.getElementById('eif-img-el')?.src || '';
    if (_eifSaveImg.startsWith('data:') && _eifImgFile) {
      adminMsg('eif-msg', '📤 Bild wird hochgeladen…', '');
      try { _eifSaveImg = await _uploadItemImage(_eifImgFile, 'rm'); _eifImgFile = null; }
      catch(e) { adminMsg('eif-msg', e.message, 'err'); btn.disabled = false; btn.textContent = 'Save'; return; }
    }
    if (!_eifSaveImg.startsWith('http')) _eifSaveImg = '';
    const data = await adminCall({
      action: "saveInventory",
      code,
      name: document.getElementById("eif-name").value.trim(),
      kategorie: document.getElementById("eif-kategorie").value.trim(),
      unit: document.getElementById("eif-unit").value.trim(),
      quantity: document.getElementById("eif-qty").value,
      weightUnit: document.getElementById("eif-weight").value,
      minimum: document.getElementById("eif-min").value,
      maximum: document.getElementById("eif-max").value,
      kostenUnit: document.getElementById("eif-kosten").value,
      lieferant: document.getElementById("eif-lieferant").value.trim(),
      lastOrder: document.getElementById("eif-lastorder").value,
      notizen: document.getElementById("eif-notizen").value.trim(),
      allergen: _getEifAllergenValue(),
      image: _eifSaveImg || undefined
    });
    if (data.error) throw new Error(data.error);
    adminMsg("eif-msg", "Saved OK", "ok");
    closeEditInventoryModal();
    await loadInventory();
    try { renderAdminInventory(); } catch(e) {}
    try { filterInventory(); } catch(e) {}
    try { _refreshGrList(); } catch(e) {}
    try { _refreshMepList(); } catch(e) {}
    try { renderMenuListByCat(); } catch(e) {}
  } catch(e) {
    adminMsg("eif-msg", "Error: " + e.message, "err");
  } finally {
    btn.disabled = false;
    btn.textContent = "Save";
  }
}  

// Readonly guard (was a separate inline monkey-patch in dashboard.html) — block
// editing when the current role has inventory read-only.
(function () {
  const _orig = openEditInventoryModal;
  window.openEditInventoryModal = function (code) {
    if (window._inventoryReadonly) return;
    _orig(code);
  };
})();
