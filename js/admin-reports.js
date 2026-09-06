/* admin-reports.js — two admin slices (module 17), extracted from dashboard.html.
   ARCHIVE: scan-archive stats + archived-scan viewer + "archive old scans now"
     (loadArchiveStats/loadArchivedScans/runArchiveNow). Reached from the admin tab-switch,
     the admin-access flow, and inline onclick buttons.
   REPORTS: weekly report preview + email-send (loadReportsTab/previewReport/sendReportNow/
     renderReportPreview). Reached from the reports tab-switch, boot .then() restore, inline onclicks.
   No module-owned state. Reads app globals: adminCall, get, fmt, adminMsg, t. */
// ─────────────────────────────────────────────
// ARCHIVE
// ─────────────────────────────────────────────
async function loadArchiveStats() {
  try {
    const data = await adminCall({ action: "getArchiveStats" });
    document.getElementById("archive-scan-rows").textContent = data.scanRows || 0;
    document.getElementById("archive-archive-rows").textContent = data.archiveRows || 0;
    document.getElementById("archive-last-run").textContent = data.lastRun || "Never";
  } catch(e) {
    console.error("Archive stats error:", e);
  }
}

async function loadArchivedScans() {
  const list = document.getElementById("archived-scan-list");
  if (!list) return;
  
  list.innerHTML = `<div style="padding:12px;color:var(--muted)">Loading...</div>`;
  
  try {
    const data = await get({ action: "archivedScans" });
    const scans = Array.isArray(data.scans) ? data.scans : [];
    
    if (!scans.length) {
      list.innerHTML = `<div class="empty-state">No archived scans</div>`;
      return;
    }
    
    const rows = scans.slice(0, 200).map(s => {
      return `<div class="feed-row" style="font-size:11px;padding:8px 12px">
        <span>${fmt(s.timestamp)}</span>
        <span>${s.worker || "-"}</span>
        <span class="action-badge ${s.action || ""}">${s.action || "-"}</span>
        <span>${s.product || s.code || "-"}</span>
      </div>`;
    }).join("");
    
    list.innerHTML = `<div class="feed-row hdr" style="font-size:11px;font-weight:500;padding:8px 12px;background:var(--surface2)">
      <span>Time</span><span>Worker</span><span>Action</span><span>Product</span>
    </div>${rows}${scans.length > 200 ? `<div style="padding:12px;text-align:center;color:var(--muted);font-size:11px">Showing first 200 of ${scans.length} records</div>` : ""}`;
  } catch(e) {
    list.innerHTML = `<div class="error-msg">Error: ${e.message}</div>`;
  }
}
async function runArchiveNow() {
  const btn = document.querySelector("#panel-admin .btn-save[onclick='runArchiveNow()']");
  if (btn) { btn.disabled = true; btn.textContent = "Archiving…"; }
  try {
    const data = await get({ action: "archiveNow" });
    if (data.error) {
      adminMsg("archive-stat", "Error: " + data.error, "err");
    } else {
      adminMsg("archive-stat", `✓ Done: ${data.archived} archived, ${data.kept} kept`, "ok");
      await loadArchiveStats();
    }
  } catch(e) {
    adminMsg("archive-stat", "Network error", "err");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Archive old scans now"; }
  }
}

// ─────────────────────────────────────────────
// REPORTS
// ─────────────────────────────────────────────
function loadReportsTab() {
  document.getElementById("report-status").textContent = "Click 'Preview this week' to load report data.";
}
async function previewReport() {
  const status  = document.getElementById("report-status");
  const preview = document.getElementById("report-preview");
  status.textContent = "Loading report data..."; status.style.color = "var(--muted)";
  preview.style.display = "none";
  try {
    const data = await get({ action:"reportPreview" });
    if (data.error) { status.textContent="Error: "+data.error; return; }
    renderReportPreview(data.stats);
    preview.style.display = "block";
    status.textContent = "Week ending "+data.stats.week+" — "+data.stats.totalScans+" scans";
    status.style.color = "var(--green)";
  } catch(e) { status.textContent="Error: "+e.message; status.style.color="var(--red)"; }
}
async function sendReportNow() {
  const status = document.getElementById("report-status");
  status.textContent = "Sending email..."; status.style.color = "var(--amber)";
  try {
    const data = await get({ action:"reportSendNow" });
    status.textContent = data.error ? "Error: "+data.error : (data.message||"Report sent!");
    status.style.color = data.error ? "var(--red)" : "var(--green)";
  } catch(e) { status.textContent="Error: "+e.message; status.style.color="var(--red)"; }
}
function renderReportPreview(s) {
  const sumEl = document.getElementById("report-summary");
  const cards = [
    { val:s.totalScans,                      label:t('total-scans'),  color:"var(--text)" },
    { val:s.overallEfficiency+"%",            label:"Efficiency",      color:s.overallEfficiency>=90?"var(--green)":s.overallEfficiency>=75?"var(--amber)":"var(--red)" },
    { val:s.totalWaste,                       label:t('waste')+" (GN)",color:s.totalWaste>0?"var(--red)":"var(--green)" },
    { val:"CHF "+s.totalWasteCHF.toFixed(0),  label:t('waste')+" cost",color:s.totalWasteCHF>100?"var(--red)":s.totalWasteCHF>50?"var(--amber)":"var(--green)" },
  ];
  sumEl.innerHTML = cards.map(c => `<div style="background:var(--surface);border:1px solid var(--border2);border-radius:var(--radius-sm);padding:14px;text-align:center"><div style="font-size:22px;font-weight:500;color:${c.color}">${c.val}</div><div style="font-size:10px;color:var(--muted);letter-spacing:1px;text-transform:uppercase;margin-top:4px">${c.label}</div></div>`).join("");
  document.getElementById("rpt-waste").innerHTML = s.wasteLines.length
    ? s.wasteLines.map(w=>`<tr><td>${w.name}</td><td>${w.waste}</td><td>CHF ${w.costPerUnit.toFixed(2)}</td><td style="color:${w.totalCost>50?"var(--red)":"var(--text)"}">CHF ${w.totalCost.toFixed(2)}</td></tr>`).join("")
      + `<tr style="font-weight:500"><td colspan="3">Total waste cost</td><td style="color:var(--red)">CHF ${s.totalWasteCHF.toFixed(2)}</td></tr>`
    : `<tr><td colspan="4" style="color:var(--green);text-align:center;padding:12px">No waste this week</td></tr>`;
  document.getElementById("rpt-eff").innerHTML = s.efficiencyLines.length
    ? s.efficiencyLines.map(e=>`<tr><td>${e.name}</td><td style="color:var(--green)">${e.done}</td><td style="color:${e.waste>0?"var(--red)":"var(--muted)"}">${e.waste}</td><td style="color:${e.efficiency<75?"var(--red)":e.efficiency<90?"var(--amber)":"var(--green)"}"><strong>${e.efficiency}%</strong></td></tr>`).join("")
    : `<tr><td colspan="4" style="color:var(--muted);text-align:center;padding:12px">No data</td></tr>`;
  document.getElementById("rpt-workers").innerHTML = s.topWorkers.length
    ? s.topWorkers.map(w=>`<tr><td>${w.name}</td><td>${w.total}</td><td>${w.done}</td><td style="color:${w.wasteRate>20?"var(--red)":"var(--muted)"}">${w.wasteRate}%</td></tr>`).join("")
    : `<tr><td colspan="4" style="color:var(--muted);text-align:center;padding:12px">No data</td></tr>`;
  document.getElementById("rpt-stock").innerHTML = s.lowStock.length
    ? s.lowStock.map(i=>`<tr><td>${i.name}</td><td style="color:var(--red);font-weight:500">${i.qty} ${i.unit}</td><td style="color:var(--muted)">min: ${i.minimum} ${i.unit}</td></tr>`).join("")
    : `<tr><td colspan="3" style="color:var(--green);text-align:center;padding:12px">All stock OK</td></tr>`;
}
