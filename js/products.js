// Kitchen MEP — Products management (view modal + admin CRUD) — feature module, classic script.
// Extracted from dashboard.html (monolith->modules restructure). Event-driven; entry points are
// inline handlers (openProductModal from the grid, editProduct/saveProduct/delProduct from the
// admin form). The product DISPLAY grid (loadProducts/filterProducts/renderProductGrid) is
// init-coupled (boot fan-out) and stays INLINE, as does the shared state allProducts. The product
// EDIT modal lives separately in js/product-edit.js. Reads shared globals allProducts, get,
// adminCall, loadProducts, filterProducts, _refreshMepList, adminMsg, _onPopupOpen/_onPopupClose.

function openProductModal(code) {
  const p = allProducts[code] || {};
  const st = (window.todayScanStats || {})[code] || { produce:0, done:0, waste:0 };
  
  const modal = document.getElementById("product-detail-modal");
  if (!modal) return;
  
  const mCode = document.getElementById("pm-code");
  const mName = document.getElementById("pm-name");
  const mProduce = document.getElementById("pm-produce");
  const mDone = document.getElementById("pm-done");
  const mWaste = document.getElementById("pm-waste");
  const img = document.getElementById("pm-img");
  const ph = document.getElementById("pm-img-ph");
  
  if (mCode) mCode.textContent = "CODE . " + code;
  if (mName) mName.textContent = p.name || code;
  if (mProduce) mProduce.textContent = st.produce || 0;
  if (mDone) mDone.textContent = st.done || 0;
  if (mWaste) mWaste.textContent = st.waste || 0;
  
  if (img && ph) {
    img.style.display = "none";
    ph.style.display = "flex";
    
    if (p.image) {
      img.src = p.image;
      img.onload = () => {
        img.style.display = "block";
        ph.style.display = "none";
      };
    }
  }

  modal.classList.add("active");
  _onPopupOpen();
}

function closeProductModal() {
  const modal = document.getElementById("product-detail-modal");
  if (modal) modal.classList.remove("active");
  _onPopupClose();
}

function renderAdminProducts() {
  const list = document.getElementById("admin-product-list");
  if (!list) return;
  const catSel = document.getElementById("admin-prod-cat");
  let entries = Object.entries(allProducts);
  const cats = [...new Set(entries.map(([, p]) => p.kategorie).filter(Boolean))].sort();
  const curCat = catSel ? catSel.value : "";
  if (catSel) {
    catSel.innerHTML = `<option value="">Select category...</option>`
      + cats.map(c => `<option value="${c}" ${c===curCat?"selected":""}>${c}</option>`).join("");
  }
  if (!curCat) { list.innerHTML = `<div style="color:var(--muted);font-size:13px">Select a category to view products</div>`; return; }
  entries = entries.filter(([, p]) => (p.kategorie||"") === curCat);
  const q = (document.getElementById("admin-prod-search")?.value || "").toLowerCase();
  if (q) entries = entries.filter(([code, p]) =>
    (p.name||"").toLowerCase().includes(q) || code.toLowerCase().includes(q));
  if (!entries.length) { list.innerHTML = `<div style="color:var(--muted);font-size:13px">No products found</div>`; return; }
  list.innerHTML = entries.map(([code, p]) => `
    <div class="admin-item">
      <div style="flex:1;min-width:0">
        <div class="admin-item-name">${p.name}${p.kategorie?`<span style="font-size:10px;color:var(--muted);background:var(--surface2);padding:1px 6px;border-radius:10px;margin-left:4px">${p.kategorie}</span>`:""}</div>
        <div class="admin-item-sub">${code} · Max ${p.mepMax||"-"} ${p.gnSize||""} · Target ${p.tagesziel||"-"} · ${p.gnWeight||"-"} kg/GN · Shelf ${p.shelfLife||2}d</div>
      </div>
      <div class="admin-item-actions">
        <button class="btn-edit" data-code="${code}">Edit</button>
        <button class="btn-del"  data-code="${code}">Remove</button>
      </div>
    </div>`).join("");
  list.querySelectorAll('.btn-edit').forEach(btn => btn.addEventListener('click', () => editProduct(btn.dataset.code)));
  list.querySelectorAll('.btn-del').forEach(btn => btn.addEventListener('click', () => delProduct(btn.dataset.code)));
}

function editProduct(code) {
  openEditProductModal(code);
}
function clearProductForm() {
  ["pf-code","pf-name","pf-kategorie","pf-mepmax","pf-gnsize","pf-gnweight","pf-tagesziel","pf-shelf","pf-drive"]
    .forEach(id => { document.getElementById(id).value = ""; });
  document.getElementById("pf-code").readOnly = false;
  document.getElementById("product-form-title").textContent = "Add new product";
  document.getElementById("pf-cancel").style.display = "none";
}
async function saveProduct() {
  const code = document.getElementById("pf-code").value.trim();
  const name = document.getElementById("pf-name").value.trim();
  if (!code || !name) { adminMsg("pf-msg", "Code and Name are required", "err"); return; }
  // Find save button in either the admin form OR the MEP popup
  const btn = document.querySelector("#product-form .btn-save")
            || document.querySelector("#addMEPPopup .btn-save");
  if (btn) { btn.disabled = true; btn.textContent = "Saving…"; }
  try {
    const mepMax    = document.getElementById("pf-mepmax").value.trim();
    const gnWeight  = document.getElementById("pf-gnweight").value.trim();
    const tagesziel = document.getElementById("pf-tagesziel").value.trim();
    const shelf     = document.getElementById("pf-shelf").value.trim();
    // Auto-calc WA from RM ingredients
    const _rms = allRecipes.filter(r => r.mepCode === code);
    let _waPerGN = 0;
    _rms.forEach(r => {
      const _inv = allInventory.find(x => x.code === r.rmCode);
      const _wu  = parseFloat(_inv?.weightUnit) || 1;
      _waPerGN  += (parseFloat(r.menge) || 0) * ((parseFloat(_inv?.kostenUnit) || 0) / _wu);
    });

    const payload = {
      action    : "saveProduct",
      code, name,
      kategorie : v("epf-kategorie"),
      mepMax    : mepMax    === "" ? "" : Number(mepMax),
      gnSize    : v("epf-gnsize"),
      gnWeight  : gnWeight  === "" ? "" : Number(gnWeight),
      tagesziel : tagesziel === "" ? "" : Number(tagesziel),
      shelfLife : shelf     === "" ? "" : Number(shelf),
      driveLink : v("epf-drive"),
      wa        : _waPerGN > 0 ? +_waPerGN.toFixed(4) : "",
    };
    const data = await adminCall(payload);
    if (!data) throw new Error("No response from server");
    if (data.error) throw new Error(data.error);
    adminMsg("pf-msg", "✓ Saved", "ok");
    clearProductForm();
    await loadProducts();
    renderAdminProducts();
    // Close MEP popup if it was open
    const mepPopup = document.getElementById("addMEPPopup");
    if (mepPopup && mepPopup.style.display !== "none") {
      setTimeout(() => closeAddMEPPopup(), 800);
    }
  } catch(e) {
    adminMsg("pf-msg", "Error: " + e.message, "err");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Save product"; }
  }
}

async function delProduct(code) {
  if (!confirm(`Remove "${allProducts[code]?.name||code}" from product list?`)) return;
  const data = await adminCall({ action:"deleteProduct", code });
  if (data.error) { alert("Error: "+data.error); return; }
  await loadProducts();
  renderAdminProducts();
  _refreshMepList();
}
