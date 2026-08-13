// Kitchen MEP — HACCP (feature module, classic script).
// Extracted from dashboard.html (monolith→modules restructure). Loaded via
// <script src> before </body>; top-level functions become globals so the inline
// onclick handlers + switchTab's loadHaccp() keep working, and it reads the
// shared globals (get, adminCall, showToast, document…) that stay in dashboard.html.

// ── HACCP MODULE ─────────────────────────────────────────────────────────────
let _haccpCfg      = { zones: [], tasks: [] };
let _haccpChecks   = {};
let _haccpTempLogs = {}; // keyed by zone name → array of recent logs
let _haccpRptFrom = "";
let _haccpRptTo   = "";

function _haccpWorker() {
  return document.getElementById("adminWorker")?.value ||
         document.getElementById("worker")?.value || "";
}
function _hEscH(s) {
  return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

async function loadHaccp() {
  const today = new Date().toLocaleDateString("en-CA");
  const el = document.getElementById("haccpCheckDate");
  if (el) el.textContent = new Date().toLocaleDateString("en-GB", { weekday:"long", day:"numeric", month:"long" });
  const [cfgR, chkR, logR] = await Promise.allSettled([
    get({ action:"getHACCPConfig" }),
    get({ action:"getHACCPChecks", date: today }),
    get({ action:"getHACCPTodayLogs" })
  ]);
  if (cfgR.status === "fulfilled" && cfgR.value) _haccpCfg = cfgR.value;
  if (chkR.status === "fulfilled" && chkR.value?.checks) {
    _haccpChecks = {};
    chkR.value.checks.forEach(c => { _haccpChecks[c.taskId] = c; });
  }
  if (logR.status === "fulfilled" && Array.isArray(logR.value)) {
    _haccpTempLogs = {};
    logR.value.forEach(e => {
      if (!_haccpTempLogs[e.zone]) _haccpTempLogs[e.zone] = [];
      _haccpTempLogs[e.zone].push(e);
    });
  }
  _renderHaccpZones();
  _renderHaccpChecklist();
}

function _renderHaccpZones() {
  const el = document.getElementById("haccpZones");
  if (!el) return;
  const zones = _haccpCfg.zones || [];
  if (!zones.length) {
    el.innerHTML = '<div style="color:var(--muted);font-size:13px;text-align:center;padding:16px 0">No zones yet — add your fridges and freezers above.</div>';
    return;
  }
  window._haccpZoneMap = {};
  el.innerHTML = zones.map(z => {
    window._haccpZoneMap[z.id] = z;
    const icon = z.type === "Freezer" ? "❄️" : "🧊";
    return `<div style="border:1px solid var(--border);border-radius:var(--radius-sm);margin-bottom:8px;overflow:hidden">
      <div style="display:flex;align-items:center;gap:10px;padding:11px 14px">
        <span style="font-size:18px">${icon}</span>
        <div style="flex:1;min-width:0">
          <div style="font-size:14px;font-weight:600;color:var(--text)">${_hEscH(z.name)}</div>
          <div style="font-size:11px;color:var(--muted);margin-top:2px">${_hEscH(z.type)} · ${z.minTemp}°C → ${z.maxTemp}°C</div>
        </div>
        <button data-zone-id="${z.id}" class="haccp-zone-log-btn" style="padding:6px 12px;background:var(--green-dim);color:var(--green);border:1px solid var(--green-brd);border-radius:6px;font-family:'DM Mono',monospace;font-size:12px;cursor:pointer">Log</button>
        <button data-zone-id="${z.id}" class="haccp-zone-edit-btn" style="padding:6px 10px;background:none;border:1px solid var(--border);border-radius:6px;color:var(--muted);font-size:13px;cursor:pointer">✎</button>
        <button data-zone-id="${z.id}" class="haccp-zone-del-btn" style="padding:6px 10px;background:none;border:1px solid var(--border);border-radius:6px;color:var(--red);font-size:13px;cursor:pointer">✕</button>
      </div>
      ${(() => {
        const logs = (_haccpTempLogs[z.name]||[]).slice(0,3);
        if (!logs.length) return '';
        const rows = logs.map(e => {
          const col = e.pass==="Pass" ? "var(--green)" : "var(--red)";
          return `<div style="display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid var(--border);font-size:12px;flex-wrap:wrap">
            <span style="color:var(--muted);min-width:38px">${e.time}</span>
            <span style="font-weight:600;color:${col};min-width:48px">${e.temp}°C</span>
            <span style="color:${col};font-size:11px;min-width:32px">${e.pass}</span>
            ${e.worker?`<span style="color:var(--muted);font-size:11px">👤 ${_hEscH(e.worker)}</span>`:''}
            ${e.notes?`<span style="color:var(--muted);font-size:11px">· ${_hEscH(e.notes)}</span>`:''}
          </div>`;
        }).join('');
        return `<div style="padding:8px 14px;background:var(--surface2);border-top:1px solid var(--border)">${rows}</div>`;
      })()}
      <div id="haccpLF_${z.id}" style="display:none;padding:12px 14px;border-top:1px solid var(--border);background:var(--surface2)">
        <div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap">
          <div>
            <div style="font-size:10px;color:var(--muted);letter-spacing:1px;margin-bottom:4px">TEMP (°C)</div>
            <input type="number" id="haccpT_${z.id}" step="0.1" placeholder="${z.minTemp}"
              style="width:90px;padding:9px 10px;background:var(--surface);color:var(--text);border:1px solid var(--border2);border-radius:6px;font-family:'DM Mono',monospace;font-size:18px">
          </div>
          <div style="min-width:110px">
            <div style="font-size:10px;color:var(--muted);letter-spacing:1px;margin-bottom:4px">CHECKED BY</div>
            <input type="text" id="haccpW_${z.id}" placeholder="Name"
              style="width:100%;padding:9px 10px;background:var(--surface);color:var(--text);border:1px solid var(--border2);border-radius:6px;font-family:'DM Mono',monospace;font-size:13px">
          </div>
          <div style="flex:1;min-width:120px">
            <div style="font-size:10px;color:var(--muted);letter-spacing:1px;margin-bottom:4px">NOTES (optional)</div>
            <input type="text" id="haccpN_${z.id}" placeholder="—"
              style="width:100%;padding:9px 10px;background:var(--surface);color:var(--text);border:1px solid var(--border2);border-radius:6px;font-family:'DM Mono',monospace;font-size:13px">
          </div>
          <button data-zone-id="${z.id}" class="haccp-zone-submit-btn"
            style="padding:9px 16px;background:var(--green-dim);color:var(--green);border:1px solid var(--green-brd);border-radius:6px;font-family:'DM Mono',monospace;font-size:13px;font-weight:600;cursor:pointer">✓ Log</button>
        </div>
        <div id="haccpTM_${z.id}" style="font-size:12px;margin-top:8px;min-height:16px"></div>
      </div>
    </div>`;
  }).join("");
  el.querySelectorAll('.haccp-zone-log-btn').forEach(btn => btn.addEventListener('click', () => toggleHaccpLogForm(btn.dataset.zoneId)));
  el.querySelectorAll('.haccp-zone-edit-btn').forEach(btn => btn.addEventListener('click', () => openHaccpZoneModal(window._haccpZoneMap[btn.dataset.zoneId])));
  el.querySelectorAll('.haccp-zone-del-btn').forEach(btn => btn.addEventListener('click', () => deleteHaccpZone(btn.dataset.zoneId)));
  el.querySelectorAll('.haccp-zone-submit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const z = window._haccpZoneMap[btn.dataset.zoneId];
      if (z) submitHaccpTemp(z.id, z.minTemp, z.maxTemp, z.name, z.type);
    });
  });
}

function toggleHaccpLogForm(id) {
  const form = document.getElementById("haccpLF_" + id);
  if (!form) return;
  const open = form.style.display !== "none";
  document.querySelectorAll("[id^='haccpLF_']").forEach(f => f.style.display = "none");
  if (!open) {
    form.style.display = "block";
    setTimeout(() => { const inp = document.getElementById("haccpT_" + id); if (inp) inp.focus(); }, 50);
  }
}

async function submitHaccpTemp(zoneId, minTemp, maxTemp, zoneName, zoneType) {
  const inp  = document.getElementById("haccpT_"  + zoneId);
  const note = document.getElementById("haccpN_"  + zoneId);
  const msg  = document.getElementById("haccpTM_" + zoneId);
  if (!inp || inp.value === "") { if (msg) { msg.style.color="var(--red)"; msg.textContent="Enter temperature"; } return; }
  const temp = parseFloat(inp.value);
  if (isNaN(temp)) { if (msg) { msg.style.color="var(--red)"; msg.textContent="Invalid value"; } return; }
  const pass = temp >= minTemp && temp <= maxTemp;
  if (msg) { msg.style.color="var(--muted)"; msg.textContent="Saving…"; }
  try {
    const workerInp = document.getElementById("haccpW_" + zoneId);
    const worker = workerInp?.value.trim() || _haccpWorker();
    await get({ action:"saveHACCPTemp", zone:zoneName, zoneType, temp, minTemp, maxTemp, notes:note?.value||"", worker });
    // Add to local state immediately
    const entry = { zone:zoneName, temp, pass: pass?"Pass":"Fail",
      time: new Date().toTimeString().slice(0,5), notes: note?.value||"", worker };
    if (!_haccpTempLogs[zoneName]) _haccpTempLogs[zoneName] = [];
    _haccpTempLogs[zoneName].unshift(entry);
    if (msg) { msg.style.color = pass ? "var(--green)" : "var(--red)"; msg.textContent = pass ? "✓ Pass — logged" : "⚠ FAIL — logged"; }
    inp.value = ""; if (note) note.value = ""; if (workerInp) workerInp.value = "";
    _renderHaccpZones(); // refresh zone cards to show new log
    setTimeout(() => { const f=document.getElementById("haccpLF_"+zoneId); if(f) f.style.display="none"; if(msg) msg.textContent=""; }, 2800);
  } catch(e) { if (msg) { msg.style.color="var(--red)"; msg.textContent="Error — try again"; } }
}

function _renderHaccpChecklist() {
  const el    = document.getElementById("haccpChecklist");
  const fill  = document.getElementById("haccpCheckFill");
  const tasks = (_haccpCfg.tasks || []).filter(t => t.active !== false);
  const isMonday   = new Date().getDay() === 1;
  const isFirstDom = new Date().getDate() === 1;
  const visible    = tasks; // always show all tasks
  const doneN    = visible.filter(t => _haccpChecks[t.id]?.done).length;
  if (fill) fill.style.width = visible.length ? Math.round(doneN / visible.length * 100) + "%" : "0%";
  if (!el) return;
  if (!visible.length) {
    el.innerHTML = '<div style="color:var(--muted);font-size:13px;text-align:center;padding:12px 0">No tasks yet — add routine checklist items above.</div>';
    return;
  }
  el.innerHTML = visible.map(t => {
    const isDue = t.frequency === "Weekly" ? isMonday
                : t.frequency === "Monthly" ? isFirstDom
                : true;
    const done = !!_haccpChecks[t.id]?.done;
    const who  = _haccpChecks[t.id]?.worker || "";
    const freqBadge = t.frequency === "Weekly"
      ? `<span style="font-size:10px;background:var(--blue-dim);color:var(--blue);border:1px solid var(--blue-brd);border-radius:4px;padding:1px 5px;margin-left:6px">${isDue?"Weekly":"Next Mon"}</span>`
      : t.frequency === "Monthly"
      ? `<span style="font-size:10px;background:var(--amber-dim);color:var(--amber);border:1px solid var(--amber-brd);border-radius:4px;padding:1px 5px;margin-left:6px">${isDue?"Monthly":"Next 1st"}</span>`
      : "";
    const whoBadge = who ? `<span style="font-size:11px;color:var(--muted);margin-left:6px">by ${_hEscH(who)}</span>` : "";
    return `<div data-task-id="${t.id}" class="haccp-check-row${isDue?' haccp-check-due':''}"
      style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--border);${isDue?'cursor:pointer':'cursor:default;opacity:0.45'};user-select:none;-webkit-user-select:none">
      <div style="width:20px;height:20px;border-radius:50%;flex-shrink:0;border:2px solid ${done?"var(--green)":"var(--border2)"};background:${done?"var(--green)":"transparent"};display:flex;align-items:center;justify-content:center;color:#fff;font-size:12px;transition:all .15s">${done?"✓":""}</div>
      <div style="flex:1;min-width:0">
        <span style="font-size:14px;color:${done?"var(--muted)":"var(--text)"};text-decoration:${done?"line-through":"none"}">${_hEscH(t.task)}</span>${freqBadge}${whoBadge}
      </div>
      <button data-task-id="${t.id}" class="haccp-task-edit-btn" style="background:none;border:none;color:var(--muted);font-size:13px;cursor:pointer;padding:4px 6px">✎</button>
      <button data-task-id="${t.id}" class="haccp-task-del-btn" style="background:none;border:none;color:var(--border2);font-size:14px;cursor:pointer;padding:4px 6px">✕</button>
    </div>`;
  }).join("");
  window._haccpTaskMap = {};
  visible.forEach(t => { window._haccpTaskMap[t.id] = t; });
  const isDueMap = {};
  visible.forEach(t => {
    isDueMap[t.id] = t.frequency === "Weekly" ? isMonday : t.frequency === "Monthly" ? isFirstDom : true;
  });
  el.querySelectorAll('.haccp-check-due').forEach(row => {
    row.addEventListener('click', () => {
      const t = window._haccpTaskMap[row.dataset.taskId];
      if (t) toggleHaccpCheck(t.id, t.task);
    });
  });
  el.querySelectorAll('.haccp-task-edit-btn').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); openHaccpTaskModal(window._haccpTaskMap[btn.dataset.taskId]); });
  });
  el.querySelectorAll('.haccp-task-del-btn').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); deleteHaccpTask(btn.dataset.taskId); });
  });
}

async function toggleHaccpCheck(taskId, taskName) {
  const prev = !!_haccpChecks[taskId]?.done;
  const done = !prev;
  const worker = _haccpWorker();
  _haccpChecks[taskId] = { ...(_haccpChecks[taskId]||{}), taskId, done, worker };
  _renderHaccpChecklist();
  try {
    await get({ action:"saveHACCPCheck", date:new Date().toLocaleDateString("en-CA"), taskId, task:taskName, done, worker });
  } catch(e) { _haccpChecks[taskId].done = prev; _renderHaccpChecklist(); }
}

function openHaccpZoneModal(zone) {
  const m = document.getElementById("haccpZoneModal");
  if (!m) return;
  document.getElementById("haccpZoneModalTitle").textContent = zone?.id ? "Edit Zone" : "Add Zone";
  document.getElementById("haccpZoneId").value   = zone?.id   || "";
  document.getElementById("haccpZoneName").value = zone?.name || "";
  document.getElementById("haccpZoneType").value = zone?.type || "Fridge";
  document.getElementById("haccpZoneMin").value  = zone?.minTemp !== undefined ? zone.minTemp : "0";
  document.getElementById("haccpZoneMax").value  = zone?.maxTemp !== undefined ? zone.maxTemp : "5";
  m.style.display = "flex";
  setTimeout(() => document.getElementById("haccpZoneName").focus(), 50);
}
function closeHaccpZoneModal() { document.getElementById("haccpZoneModal").style.display = "none"; }
async function saveHaccpZone() {
  const name = document.getElementById("haccpZoneName").value.trim();
  if (!name) { document.getElementById("haccpZoneName").focus(); return; }
  closeHaccpZoneModal();
  await get({ action:"saveHACCPZone", id:document.getElementById("haccpZoneId").value, name, zoneType:document.getElementById("haccpZoneType").value, minTemp:document.getElementById("haccpZoneMin").value, maxTemp:document.getElementById("haccpZoneMax").value });
  await loadHaccp();
}
async function deleteHaccpZone(id) {
  if (!confirm("Delete this zone?")) return;
  await get({ action:"deleteHACCPZone", id });
  await loadHaccp();
}

function openHaccpTaskModal(task) {
  const m = document.getElementById("haccpTaskModal");
  if (!m) return;
  document.getElementById("haccpTaskModalTitle").textContent = task?.id ? "Edit Task" : "Add Task";
  document.getElementById("haccpTaskId").value   = task?.id        || "";
  document.getElementById("haccpTaskName").value = task?.task      || "";
  document.getElementById("haccpTaskFreq").value = task?.frequency || "Daily";
  m.style.display = "flex";
  setTimeout(() => document.getElementById("haccpTaskName").focus(), 50);
}
function closeHaccpTaskModal() { document.getElementById("haccpTaskModal").style.display = "none"; }
async function saveHaccpTask() {
  const task = document.getElementById("haccpTaskName").value.trim();
  if (!task) { document.getElementById("haccpTaskName").focus(); return; }
  closeHaccpTaskModal();
  await get({ action:"saveHACCPTask", id:document.getElementById("haccpTaskId").value, task, frequency:document.getElementById("haccpTaskFreq").value });
  await loadHaccp();
}
async function deleteHaccpTask(id) {
  if (!confirm("Remove this task?")) return;
  await get({ action:"deleteHACCPTask", id });
  await loadHaccp();
}

function loadHaccpReport(period) {
  document.querySelectorAll(".haccp-pb").forEach(b => {
    const on = b.dataset.p === period;
    b.style.background  = on ? "var(--amber-dim)" : "var(--surface2)";
    b.style.borderColor = on ? "var(--amber-brd)" : "var(--border)";
    b.style.color       = on ? "var(--amber)"     : "var(--muted)";
  });
  const cust = document.getElementById("haccpCustomRange");
  if (period === "custom") { if (cust) cust.style.display = "flex"; return; }
  if (cust) cust.style.display = "none";
  const today = new Date();
  const fmt   = d => d.toLocaleDateString("en-CA");
  let from, to;
  if (period === "today") {
    from = to = fmt(today);
  } else if (period === "week") {
    const mon = new Date(today); mon.setDate(today.getDate() - ((today.getDay() + 6) % 7));
    from = fmt(mon); to = fmt(today);
  } else {
    from = fmt(new Date(today.getFullYear(), today.getMonth(), 1)); to = fmt(today);
  }
  _fetchHaccpReport(from, to);
}

async function _fetchHaccpReport(from, to) {
  if (!from || !to) return;
  _haccpRptFrom = from; _haccpRptTo = to;
  const out = document.getElementById("haccpReportOut");
  const btn = document.getElementById("haccpExportBtn");
  if (out) out.innerHTML = '<div style="color:var(--muted);font-size:13px">Loading…</div>';
  if (btn) btn.style.display = "none";
  try {
    const data    = await get({ action:"getHACCPReport", dateFrom:from, dateTo:to });
    const entries = data?.entries || [];
    if (!entries.length) {
      if (out) out.innerHTML = '<div style="color:var(--muted);font-size:13px;text-align:center;padding:16px">No temperature records for this period.</div>';
      return;
    }
    const stats = {};
    entries.forEach(e => {
      if (!stats[e.zone]) stats[e.zone] = { pass:0, fail:0, temps:[] };
      (e.pass?.toLowerCase() === "pass" ? stats[e.zone].pass++ : stats[e.zone].fail++);
      if (!isNaN(e.temp)) stats[e.zone].temps.push(Number(e.temp));
    });
    const bodyRows = Object.entries(stats).map(([zone, s]) => {
      const avg = s.temps.length ? (s.temps.reduce((a,b)=>a+b,0)/s.temps.length).toFixed(1) : "—";
      const mn  = s.temps.length ? Math.min(...s.temps).toFixed(1) : "—";
      const mx  = s.temps.length ? Math.max(...s.temps).toFixed(1) : "—";
      const fs  = s.fail > 0 ? "color:var(--red);font-weight:600" : "color:var(--green)";
      return `<tr>
        <td style="padding:7px 10px;border-bottom:1px solid var(--border)">${_hEscH(zone)}</td>
        <td style="padding:7px 10px;border-bottom:1px solid var(--border);text-align:center">${s.pass+s.fail}</td>
        <td style="padding:7px 10px;border-bottom:1px solid var(--border);text-align:center;color:var(--green)">${s.pass}</td>
        <td style="padding:7px 10px;border-bottom:1px solid var(--border);text-align:center;${fs}">${s.fail}</td>
        <td style="padding:7px 10px;border-bottom:1px solid var(--border);text-align:center;color:var(--muted)">${avg}°C</td>
        <td style="padding:7px 10px;border-bottom:1px solid var(--border);text-align:center;color:var(--muted)">${mn} / ${mx}</td>
      </tr>`;
    }).join("");
    if (out) out.innerHTML = `
      <div style="font-size:11px;color:var(--muted);margin-bottom:8px">${from} → ${to} · ${entries.length} readings</div>
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead><tr style="font-size:10px;letter-spacing:1px;text-transform:uppercase;color:var(--muted)">
          <th style="padding:5px 10px;text-align:left;border-bottom:1px solid var(--border2)">Zone</th>
          <th style="padding:5px 10px;text-align:center;border-bottom:1px solid var(--border2)">Checks</th>
          <th style="padding:5px 10px;text-align:center;border-bottom:1px solid var(--border2)">Pass</th>
          <th style="padding:5px 10px;text-align:center;border-bottom:1px solid var(--border2)">Fail</th>
          <th style="padding:5px 10px;text-align:center;border-bottom:1px solid var(--border2)">Avg</th>
          <th style="padding:5px 10px;text-align:center;border-bottom:1px solid var(--border2)">Min/Max</th>
        </tr></thead>
        <tbody>${bodyRows}</tbody>
      </table>`;
    if (btn) { btn.style.display = "inline-flex"; btn.dataset.from = from; btn.dataset.to = to; }
  } catch(e) { if (out) out.innerHTML = '<div style="color:var(--red);font-size:13px">Failed to load report.</div>'; }
}

async function haccpExportPDF() {
  const btn  = document.getElementById("haccpExportBtn");
  const from = btn?.dataset.from || _haccpRptFrom;
  const to   = btn?.dataset.to   || _haccpRptTo;
  if (!from || !to) return;

  // Fetch full detail rows for the date range
  const data    = await get({ action:"getHACCPReport", dateFrom:from, dateTo:to });
  const entries = data?.entries || [];

  // Group by date + zone
  const grouped = {};
  entries.forEach(e => {
    const key = e.date;
    if (!grouped[key]) grouped[key] = {};
    if (!grouped[key][e.zone]) grouped[key][e.zone] = [];
    grouped[key][e.zone].push(e);
  });

  const rows = Object.entries(grouped).sort(([a],[b])=>a.localeCompare(b)).map(([date, zones]) => {
    const zoneRows = Object.entries(zones).map(([zone, logs]) => {
      const logRows = logs.map(l => {
        const pass = l.pass === "Pass";
        return `<tr>
          <td style="padding:4px 8px;border:1px solid #ccc">${l.time||""}</td>
          <td style="padding:4px 8px;border:1px solid #ccc;font-weight:bold;color:${pass?"#1a7a40":"#c0200f"}">${l.temp}°C</td>
          <td style="padding:4px 8px;border:1px solid #ccc;color:${pass?"#1a7a40":"#c0200f"}">${l.pass||""}</td>
          <td style="padding:4px 8px;border:1px solid #ccc;color:#555">${l.worker||""}</td>
          <td style="padding:4px 8px;border:1px solid #ccc;color:#555">${l.notes||""}</td>
        </tr>`;
      }).join("");
      return `<tr><td colspan="5" style="padding:6px 8px;background:#f5f5f5;font-weight:bold;border:1px solid #ccc">📍 ${zone}</td></tr>${logRows}`;
    }).join("");
    return `<tr><td colspan="5" style="padding:8px;background:#e8eaed;font-weight:bold;font-size:14px;border:1px solid #ccc">📅 ${date}</td></tr>${zoneRows}`;
  }).join("");

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
    <title>HACCP Temperature Report ${from} – ${to}</title>
    <style>
      body { font-family: Arial, sans-serif; font-size: 13px; margin: 20px; color: #111; }
      h1 { font-size: 18px; margin-bottom: 4px; }
      p  { color: #555; margin-bottom: 16px; font-size: 12px; }
      table { width: 100%; border-collapse: collapse; }
      th { background: #333; color: #fff; padding: 6px 8px; text-align: left; font-size: 11px; border: 1px solid #333; }
      @media print { button { display: none; } }
    </style>
  </head><body>
    <h1>🌡 HACCP Temperature Report</h1>
    <p>Period: ${from} → ${to} &nbsp;·&nbsp; ${entries.length} readings &nbsp;·&nbsp; Printed: ${new Date().toLocaleDateString("en-GB")}</p>
    <button onclick="window.print()" style="margin-bottom:16px;padding:8px 18px;background:#333;color:#fff;border:none;border-radius:6px;font-size:13px;cursor:pointer">🖨 Print / Save as PDF</button>
    <table>
      <thead><tr>
        <th>Time</th><th>Temp</th><th>Pass/Fail</th><th>Checked By</th><th>Notes</th>
      </tr></thead>
      <tbody>${rows || '<tr><td colspan="5" style="padding:12px;text-align:center;color:#888">No records found</td></tr>'}</tbody>
    </table>
  </body></html>`;

  const w = window.open("", "_blank");
  if (!w) { alert("Pop-up blocked — please allow pop-ups for this site."); return; }
  w.document.write(html);
  w.document.close();
  setTimeout(() => w.print(), 600);
}
