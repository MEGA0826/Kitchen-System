// Kitchen MEP — MEP-item editor core (add/edit a MEP product + save) — feature module, classic script.
// Extracted from dashboard.html (monolith->modules restructure). Event-driven; entry points are
// inline handlers (openAddMEPPopup via +New MEP / guardedAddMEP, saveMEPFromPopup save button,
// previewMepImg/removeMepImage/loadMepDriveImg on the image inputs). _mepImgFile (MEP image file)
// moves with this block; copyMEP (inline) still resolves it via the global lexical env. The shared
// working array mepAddZutaten (top-level let) stays INLINE, together with its builder
// (editMepAddZutat/renderMepAddZutaten), the shared _uploadItemImage helper, the GR editor, and the
// init-coupled MEP display. Reads shared globals mepAddZutaten, allProducts, adminCall, get,
// _uploadItemImage, renderMepAddZutaten, _refreshMepList, _onPopupOpen/_onPopupClose, adminMsg.

function openAddMEPPopup() {
  ["mep-code","mep-name","mep-kategorie","mep-mepmax","mep-gnsize",
   "mep-gnweight","mep-tagesziel","mep-shelf","mep-drive"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  _mepImgFile = null;
  const mepImgEl = document.getElementById('mep-img-el'); if (mepImgEl) mepImgEl.src = '';
  const mepImgPrev = document.getElementById('mep-img-preview'); if (mepImgPrev) mepImgPrev.style.display = 'none';
  ['mep-img-file','mep-img-file-cam'].forEach(id => { const f = document.getElementById(id); if (f) f.value = ''; });
  mepAddZutaten = [];
  { const _pf=document.getElementById('mep-portions'); if(_pf){_pf.value='1';_pf.dataset.last='1';} }
  renderMepAddZutaten();
  const msg = document.getElementById("mep-msg");
  if (msg) { msg.textContent = ""; msg.className = "admin-msg"; }
   // Reset computed fields then recalc (fields are empty so shows —)
  const popup = document.getElementById("addMEPPopup");
  popup.style.display = "flex";
  _onPopupOpen();
}

function closeAddMEPPopup() {
  document.getElementById("addMEPPopup").style.display = "none";
  _onPopupClose();
}

function calcMepTotalWeight() {
  // Triggers sales suggestion only — total volume display removed

  // Sales suggestion: match by code or name
  const code = (document.getElementById("mep-code")?.value || "").trim();
  const name = (document.getElementById("mep-name")?.value || "").trim().toLowerCase();
  const ss = document.getElementById("mep-sales-suggestion");
  if (!ss) return;

  let match = null;
  if (salesData?.products?.length) {
    match = salesData.products.find(p =>
      (p.code && p.code === code) ||
      (p.name && p.name.toLowerCase() === name)
    );
    if (!match && name) {
      match = salesData.products.find(p => p.name && p.name.toLowerCase().includes(name));
    }
  }

  if (match) {
    const suggested = match.suggestedMep || Math.ceil((match.avgDaily||0) * 1.2) || 0;
    const sugKg = kgPerGN > 0 ? ` = ${(suggested * kgPerGN).toFixed(2)} kg` : "";
    const period = _salesPeriodDays === 0 ? "all time" : `last ${_salesPeriodDays}d`;
    ss.innerHTML = `📈 Sales (${period}): avg <strong>${match.avgDaily}</strong>/day · suggested target <strong style="color:var(--green)">${suggested} GN${sugKg}</strong>`;
    // Also pre-fill tagesziel if empty
    const tzEl = document.getElementById("mep-tagesziel");
    if (tzEl && !tzEl.value) tzEl.value = suggested;
  } else {
    ss.textContent = salesData?.products?.length
      ? "No sales match found — enter target manually"
      : "Load sales data for suggestion";
  }
}
async function saveMEPFromPopup() {
  const popup = document.getElementById("addMEPPopup");
  const gp = (id) => popup ? popup.querySelector("#" + id) : document.getElementById(id);
  const code = (gp("mep-code")?.value || "").trim();
  const name = (gp("mep-name")?.value || "").trim();
  if (!code || !name) {
    adminMsg("mep-msg", `Missing: ${!code ? "Code " : ""}${!name ? "Name" : ""}`, "err");
    return;
  }

  // Duplicate protection
  if (allProducts[code]) {
    adminMsg("mep-msg", `⚠ Code "${code}" already exists — use Edit to update it`, "err"); return;
  }
  const dupName = Object.values(allProducts).find(p => (p.name||'').toLowerCase() === name.toLowerCase());
  if (dupName) {
    adminMsg("mep-msg", `⚠ Name "${name}" already exists (${dupName.name})`, "err"); return;
  }
  const btn = popup?.querySelector("button[onclick='saveMEPFromPopup()']");
  if (btn) { btn.disabled = true; btn.textContent = "Saving…"; }
  try {
    let _mepSaveImg = document.getElementById('mep-img-el')?.src || '';
    if (_mepSaveImg.startsWith('data:') && _mepImgFile) {
      adminMsg('mep-msg', '📤 Bild wird hochgeladen…', '');
      try { _mepSaveImg = await _uploadItemImage(_mepImgFile, 'mep'); _mepImgFile = null; }
      catch(e) { adminMsg('mep-msg', e.message, 'err'); if (btn) { btn.disabled = false; btn.textContent = '💾 Save MEP'; } return; }
    }
    if (!_mepSaveImg.startsWith('http')) _mepSaveImg = (gp("mep-drive")?.value || "").trim();
    const mepMax    = (gp("mep-mepmax")?.value    || "").trim();
    const gnWeight  = (gp("mep-gnweight")?.value   || "").trim();
    const tagesziel = (gp("mep-tagesziel")?.value  || "").trim();
    const shelf     = (gp("mep-shelf")?.value      || "").trim();
    const payload = {
      action     : "saveProduct",
      code, name,
      kategorie  : (gp("mep-kategorie")?.value || "").trim(),
      mepMax     : mepMax    === "" ? "" : Number(mepMax),
      gnSize     : (gp("mep-gnsize")?.value || "").trim(),
      gnWeight   : gnWeight  === "" ? "" : Number(gnWeight),
      tagesziel  : tagesziel === "" ? "" : Number(tagesziel),
      shelfLife  : shelf     === "" ? "" : Number(shelf),
      driveLink  : _mepSaveImg,
    };
    const data = await adminCall(payload);
    if (data.error) throw new Error(data.error);
    adminMsg("mep-msg", "Saved OK ✓", "ok");
    // Save RM ingredients to MEP sheet
    if (mepAddZutaten.length) {
      await Promise.all(mepAddZutaten.map(z => adminCall({
        action     : 'saveRecipe',
        mepCode    : code,
        rmCode     : z.code,
        menge      : z.gewicht || 0,
        einheit    : z.unit || 'kg',
        recipeType : 'rm',
        garverlust : z.garverlust || 0,
      })));
    }
    await loadProducts();
    setTimeout(closeAddMEPPopup, 900);
  } catch(e) {
    adminMsg("mep-msg", "Error: " + e.message, "err");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "💾 Save MEP"; }
    // Re-enable gp reference cleanup
  }
}
// ── MEP popup image helpers ───────────────────────────────────────────────────
let _mepImgFile = null;
function previewMepImg(input) {
  const file = input.files[0]; if (!file) return;
  _mepImgFile = file;
  const reader = new FileReader();
  reader.onload = e => {
    document.getElementById('mep-img-el').src = e.target.result;
    document.getElementById('mep-img-preview').style.display = 'block';
  };
  reader.readAsDataURL(file);
}
function removeMepImage() {
  const el = document.getElementById('mep-img-el'); if (el) el.src = '';
  document.getElementById('mep-img-preview').style.display = 'none';
  ['mep-img-file','mep-img-file-cam'].forEach(id => { const f = document.getElementById(id); if (f) f.value = ''; });
  const drv = document.getElementById('mep-drive'); if (drv) drv.value = '';
  _mepImgFile = null;
}
function loadMepDriveImg(url) {
  if (!url) return;
  document.getElementById('mep-img-el').src = url;
  document.getElementById('mep-img-preview').style.display = 'block';
}
