// Kitchen MEP — Workers/staff admin (list + edit/create + delete) — feature module, classic script.
// Extracted from dashboard.html (monolith->modules restructure). First slice of the large admin tab.
// Event-driven; entry points are inline handlers (renderAdminWorkers from search/filter + loadAdminTab
// on tab-switch, openWorkerEditPopup/saveWorkerAdmin/delWorker from the worker list/form).
// saveWorkerAdmin/delWorker write via the gateway (adminCall/gwWrite). Shared state allWorkersAdmin
// and the shared adminMsg() helper stay inline; both resolve as globals at runtime.

function renderAdminWorkers() {
  const search = document.getElementById('admin-worker-search').value.toLowerCase();
  const roleFilter = document.getElementById('admin-worker-role-filter').value;
  const list = document.getElementById('admin-workers-list');
  
  // Show prompt if nothing selected
  if (!search && !roleFilter) {
    list.innerHTML = `<div style="color:var(--muted);font-size:13px;padding:8px 0">${_safeT('inv-sub')}</div>`;
    return;
  }
  
  let workers = allWorkersAdmin || [];
  let filtered = workers;
  
  // Filter by role
  if (roleFilter) {
    filtered = filtered.filter(w => {
      const role = typeof w === 'object' ? w.role : '';
      return role === roleFilter;
    });
  }
  
  // Filter by search
  if (search) {
    filtered = filtered.filter(w => {
      const name = typeof w === 'object' ? w.name : w;
      const role = typeof w === 'object' ? (w.role || '') : '';
      return (name || '').toLowerCase().includes(search) ||
             role.toLowerCase().includes(search);
    });
  }
  
  if (!filtered.length) {
    list.innerHTML = `<div style="color:var(--muted);font-size:13px">${_safeT('no-data')}</div>`;
    return;
  }
  
  list.innerHTML = filtered.map(w => {
    const name   = typeof w === 'object' ? w.name : w;
    const role   = typeof w === 'object' ? (w.role || '') : '';
    const aktiv  = typeof w === 'object' ? (w.aktiv !== false && w.active !== false) : true;
    const badge  = aktiv
      ? `<span style="font-size:10px;padding:2px 7px;border-radius:10px;background:var(--green-dim);color:var(--green);border:1px solid var(--green-brd);margin-left:6px">Active</span>`
      : `<span style="font-size:10px;padding:2px 7px;border-radius:10px;background:var(--red-dim,rgba(239,68,68,.15));color:var(--red);border:1px solid var(--red-brd,rgba(239,68,68,.3));margin-left:6px">Inactive</span>`;
    return `<div class="admin-item" style="opacity:${aktiv ? '1' : '0.6'}">
      <div style="flex:1;display:flex;align-items:center;flex-wrap:wrap;gap:4px">
        <span style="font-size:13px;font-weight:500">${name || '(no name)'}</span>
        <span style="font-size:11px;color:var(--muted)">${role || '—'}</span>
        ${badge}
      </div>
      <button class="btn-edit" data-name="${name}">Edit</button>
    </div>`;
  }).join('');
  list.querySelectorAll('.btn-edit').forEach(btn => btn.addEventListener('click', () => openWorkerEditPopup(btn.dataset.name)));
}
function openWorkerEditPopup(name) {
  const w = allWorkersAdmin.find(x => (typeof x === "object" ? x.name : x) === name);
  if (!w) return;
  
  const wName = typeof w === "object" ? w.name : w;
  const wRole = typeof w === "object" ? (w.role || "") : "";
  const wPin = typeof w === "object" ? (w.pin || "") : "";
  
  const wAktiv = typeof w === "object" ? (w.aktiv !== false && w.active !== false) : true;
  document.getElementById('editWorkerOriginalName').value = wName;
  document.getElementById('editWorkerName').value = wName;
  document.getElementById('editWorkerRole').value = wRole;
  document.getElementById('editWorkerPin').value = wPin;
  document.getElementById('editWorkerAktiv').value = wAktiv ? "true" : "false";
  document.getElementById('editWorkerTitle').textContent = "Edit - " + wName;
  document.getElementById('editWorkerMsg').textContent = "";
  
  document.getElementById('editWorkerModal').classList.add('active');
}

function closeWorkerEditModal() {
  document.getElementById('editWorkerModal').classList.remove('active');
}

async function saveWorkerEditModal() {
  const originalName = document.getElementById('editWorkerOriginalName').value;
  const name = document.getElementById('editWorkerName').value.trim();
  const role = document.getElementById('editWorkerRole').value.trim();
  const pin = document.getElementById('editWorkerPin').value.trim();
  
  if (!name) {
    document.getElementById('editWorkerMsg').textContent = "Name erforderlich";
    document.getElementById('editWorkerMsg').className = "admin-msg err";
    return;
  }
  
  if (pin && (pin.length !== 4 || !/^\d+$/.test(pin))) {
    document.getElementById('editWorkerMsg').textContent = "PIN must be 4 digits";
    document.getElementById('editWorkerMsg').className = "admin-msg err";
    return;
  }
  
  const btn = document.querySelector('#editWorkerModal .btn-save');
  if (btn) { btn.disabled = true; btn.textContent = "Saving..."; }
  
  try {
    const active = document.getElementById('editWorkerAktiv').value;
    const data = await adminCall({
      action: 'saveWorker',
      originalName: originalName,
      name: name,
      role: role,
      pin: pin,
      active: active
    });
    
    if (data.error) throw new Error(data.error);
    
    document.getElementById('editWorkerMsg').textContent = "Saved OK";
    document.getElementById('editWorkerMsg').className = "admin-msg ok";
    
    // Refresh workers list
    const wd = await adminCall({ action: "allWorkers" });
    allWorkersAdmin = Array.isArray(wd.workers) ? wd.workers : [];
    renderAdminWorkers();
    
    setTimeout(() => closeWorkerEditModal(), 800);
  } catch (e) {
    document.getElementById('editWorkerMsg').textContent = "Error: " + e.message;
    document.getElementById('editWorkerMsg').className = "admin-msg err";
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Save"; }
  }
}
function clearWorkerForm() {
  document.getElementById("wf-name").value    = "";
  document.getElementById("wf-role").value    = "";
  const pinEl = document.getElementById("wf-pin");
  if (pinEl) pinEl.value = "";
  document.getElementById("wf-name").readOnly = false;
  document.getElementById("wf-form-title").textContent = "Add new worker";
  document.getElementById("wf-cancel").style.display   = "none";
}
async function saveWorkerAdmin() {
  const name = document.getElementById("wf-name").value.trim();
  const pin  = (document.getElementById("wf-pin")?.value || "").trim();
  if (!name) { adminMsg("wf-msg","Name is required","err"); return; }
  if (pin && (pin.length !== 4 || !/^\d+$/.test(pin))) { adminMsg("wf-msg","PIN must be 4 digits","err"); return; }
  const btn = document.querySelector("#worker-form .btn-save");
  if (btn) { btn.disabled = true; btn.textContent = "Saving..."; }
  try {
    const data = await adminCall({ action:"saveWorker", name,
      role: document.getElementById("wf-role").value.trim(), pin, active:"true" });
    if (data.error) throw new Error(data.error);
    adminMsg("wf-msg","Saved OK","ok");
    clearWorkerForm();
    const wd = await get({ action:"allWorkers" });
    allWorkersAdmin = wd.workers || allWorkersAdmin;
    renderAdminWorkers();
  } catch(e) { adminMsg("wf-msg","Error: "+e.message,"err"); }
  finally { if (btn) { btn.disabled = false; btn.textContent = "Save worker"; } }
}
async function delWorker(name) {
  if (!confirm(`Deactivate worker "${name}"?`)) return;
  const data = await adminCall({ action:"deleteWorker", name });
  if (data.error) { alert("Error: "+data.error); return; }
  adminMsg("wf-msg",`${name} deactivated OK`,"ok");
  allWorkersAdmin = allWorkersAdmin.filter(w => (typeof w==="string"?w:w.name) !== name);
  renderAdminWorkers();
}
