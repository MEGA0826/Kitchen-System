/* deductions-scan.js — two admin slices (module 15), extracted from dashboard.html.
   (1) DEDUCTIONS: the stock-deduction log table (loadDeductions/renderDeductions/filterDeductions
       + allDeductions state). Event-driven: deductions tab-switch, boot .then() restore, inline oninput/onclick.
   (2) MANUAL SCAN: the manual used/waste/done entry modal (openManualScan/closeManualScan/setManualAction/
       submitManualScan + _msAction state + the modal-backdrop click-to-close listener). Event-driven: the
       "+ Manual entry" button, inline onclick action buttons, ESC handler, submit -> loadKDS.
   Reads app globals: get, allProducts, allWorkersAdmin, closeMenu, _onPopupOpen/_onPopupClose, loadKDS. */
// ─────────────────────────────────────────────
// DEDUCTIONS
// ─────────────────────────────────────────────
let allDeductions = [];
async function loadDeductions() {
  const body = document.getElementById("ded-body");
  body.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--muted)">Loading...</td></tr>';
  try {
    const data = await get({ action:"getDeductions" });
    allDeductions = Array.isArray(data.deductions) ? data.deductions : [];
    renderDeductions(allDeductions);
  } catch(e) { body.innerHTML = '<tr><td colspan="8" style="color:var(--red);padding:16px">Error: '+e.message+'</td></tr>'; }
}
function renderDeductions(rows) {
  const body = document.getElementById("ded-body");
  if (!rows.length) { body.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--muted)">No deductions recorded yet</td></tr>'; return; }
  body.innerHTML = rows.map(d => {
    const low  = Number(d.after) <= 0;
    const warn = Number(d.after) > 0 && Number(d.after) < 3;
    const badge = low ? '<span style="color:var(--red);font-size:11px">LOW</span>' : warn ? '<span style="color:var(--amber);font-size:11px">LOW</span>' : '<span style="color:var(--green);font-size:11px">OK</span>';
    const ts = d.timestamp ? new Date(d.timestamp).toLocaleString("de-CH",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}) : "";
    return `<tr><td>${ts}</td><td>${d.worker||""}</td><td><span style="font-size:11px;color:var(--muted)">${d.mepCode||""}</span></td><td>${d.rmName||d.rmCode||""}</td><td style="color:var(--red)">-${d.deducted||0} ${d.unit||""}</td><td style="color:var(--muted)">${d.before||0}</td><td style="font-weight:500">${d.after||0}</td><td>${badge}</td></tr>`;
  }).join("");
}
function filterDeductions() {
  const q = document.getElementById("ded-search").value.toLowerCase();
  if (!q) { renderDeductions(allDeductions); return; }
  renderDeductions(allDeductions.filter(d =>
    (d.rmName||"").toLowerCase().includes(q) ||
    (d.mepCode||"").toLowerCase().includes(q) ||
    (d.worker||"").toLowerCase().includes(q)));
}

// ─────────────────────────────────────────────
// MANUAL SCAN
// ─────────────────────────────────────────────
let _msAction = "";
function openManualScan() {
  closeMenu();
  const pSel = document.getElementById("ms-product");
  pSel.innerHTML = '<option value="">-- Select product --</option>';
  Object.entries(allProducts).forEach(([code, p]) => {
    const o = document.createElement("option");
    o.value = code; o.textContent = (p.name||code)+" ("+code+")";
    pSel.appendChild(o);
  });
  const wSel = document.getElementById("ms-worker");
wSel.innerHTML = '<option value="">-- Select worker --</option>';
// Load fresh from API to get ALL workers
get({ action: "allWorkers" }).then(d => {
  const all = Array.isArray(d.workers) ? d.workers : [];
  all.filter(w => w.active !== false).forEach(w => {
    const name = typeof w === "string" ? w : w.name;
    if (!name) return;
    const o = document.createElement("option");
    o.value = o.textContent = name;
    wSel.appendChild(o);
  });
}).catch(() => {
  // fallback to cached
  const workers = new Set();
  if (Array.isArray(allWorkersAdmin)) allWorkersAdmin.forEach(w => { const n = typeof w==="string"?w:w.name; if(n) workers.add(n); });
  workers.forEach(w => { const o = document.createElement("option"); o.value = o.textContent = w; wSel.appendChild(o); });
});
  _msAction = "";
  document.getElementById("ms-msg").textContent = "";
  document.querySelectorAll(".ms-action-btn").forEach(b => { b.style.background="var(--surface)"; b.style.color="var(--muted)"; b.style.borderColor="var(--border2)"; });
  const modal = document.getElementById("manualScanModal");
  modal.style.display = "flex"; modal.style.alignItems = "flex-end"; modal.style.justifyContent = "center";
  _onPopupOpen();
}
function closeManualScan() {
  const m = document.getElementById("manualScanModal");
  if (m) m.style.display = "none";
  _msAction = "";
  _onPopupClose();
}
function setManualAction(action) {
  _msAction = action;
  const colors = {
    produce:{ bg:"var(--blue-dim)",  color:"var(--blue)",  border:"var(--blue-brd)" },
    done:   { bg:"var(--green-dim)", color:"var(--green)", border:"var(--green-brd)" },
    waste:  { bg:"var(--red-dim)",   color:"var(--red)",   border:"var(--red-brd)" },
    used:   { bg:"var(--blue-dim)",  color:"var(--blue)",  border:"var(--blue-brd)" },
  };
  document.querySelectorAll(".ms-action-btn").forEach(b => { b.style.background="var(--surface)"; b.style.color="var(--muted)"; b.style.borderColor="var(--border2)"; });
  const btn = document.getElementById("ms-btn-"+action);
  if (btn && colors[action]) { btn.style.background=colors[action].bg; btn.style.color=colors[action].color; btn.style.borderColor=colors[action].border; }
  document.getElementById("ms-msg").textContent = "";
}
async function submitManualScan() {
  const code   = document.getElementById("ms-product").value;
  const worker = document.getElementById("ms-worker").value;
  const msg    = document.getElementById("ms-msg");
  const btn    = document.getElementById("ms-submit");
  if (!code)    { msg.style.color="var(--red)"; msg.textContent="Select a product"; return; }
  if (!worker)  { msg.style.color="var(--red)"; msg.textContent="Select a staff member"; return; }
  if (!_msAction) { msg.style.color="var(--red)"; msg.textContent="Select an action"; return; }
  btn.disabled = true; btn.textContent = "Saving...";
  msg.style.color = "var(--muted)"; msg.textContent = "";
  try {
    const data = await get({ code, worker, action:_msAction });
    if (data.error) { msg.style.color="var(--red)"; msg.textContent="Error: "+data.error; }
    else {
      msg.style.color = "var(--green)";
      const labels = { produce:"Produce recorded", done:"Finished OK", waste:"Waste recorded", used:"Used recorded" };
      msg.textContent = (labels[_msAction]||"Saved")+" for "+(allProducts[code]?.name||code);
      setTimeout(() => { loadKDS(); closeManualScan(); }, 1200);
    }
  } catch(e) { msg.style.color="var(--red)"; msg.textContent="Network error"; }
  finally { btn.disabled=false; btn.textContent="Save action"; }
}
document.addEventListener("click", e => { if (e.target?.id==="manualScanModal") closeManualScan(); });
