// Kitchen MEP — Morning briefing + daily checklist — feature module, classic script.
// Extracted from dashboard.html (monolith->modules restructure). Event-driven (loadMorning fires from
// the Morning tab switch + refresh button, never at boot). Two ranges skip the interleaved _escM (a
// menu-PDF helper that stays inline). Own MORNING_CHECKLIST_DEFAULTS moves with the module; checklist
// state persists in localStorage. Reads shared globals allProducts, allInventory, buildMepAlerts,
// _mepMaxKg, showToast, get. No init coupling.

const MORNING_CHECKLIST_DEFAULTS = [
  "Check fridge & cold chain temps",
  "Review yesterday's waste log",
  "Brief team on today's targets",
  "Confirm incoming deliveries",
  "Prep stations ready & labelled",
  "Allergen boards updated",
  "Cutting boards sanitised",
  "Date labels checked on all containers",
];

function _morningChecklistKey() {
  const d = new Date();
  return `mep_checklist_${d.getFullYear()}_${d.getMonth()}_${d.getDate()}`;
}

function loadMorning() {
  const sub = document.getElementById("morning-date-sub");
  if (sub) {
    const now  = new Date();
    const days = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
    sub.textContent = `${days[now.getDay()]} · ${now.toLocaleDateString("de-CH")} — Kitchen prep overview`;
  }
  _renderMorningUrgent();
  _renderMorningLowStock();
  _renderMorningChecklist();
}

function _renderMorningUrgent() {
  const el = document.getElementById("morning-urgent");
  if (!el) return;

  const entries = Object.entries(allProducts).filter(([, p]) => p.tagesziel || p.mepMax);
  if (!entries.length) {
    el.innerHTML = `<div class="empty-state"><div class="empty-icon">📋</div>No products with targets. Configure them in Admin → Products.</div>`;
    return;
  }

  const scored = entries.map(([code, p]) => {
    const stats     = (window.todayScanStats || {})[code] || {};
    const available = Math.max(0, (stats.done||0) - (stats.waste||0) - (stats.used||0));
    const tagesziel = Number(p.tagesziel) || 0;
    const mepMax    = Number(p.mepMax)    || 0;
    const targetQty = tagesziel > 0 ? tagesziel : mepMax;
    const shelfLife = Number(p.shelfLife) || 2;

    // Expired-batch count from today's scans
    const expiredCount = allScans.filter(s => {
      if (!s.timestamp || s.code !== code || s.action !== "produce") return false;
      const ageD = (Date.now() - new Date(s.timestamp).getTime()) / 86400000;
      return ageD > shelfLife;
    }).length;

    const deficit = Math.max(0, targetQty - available);
    const pct     = targetQty > 0 ? Math.min(100, Math.round(available / targetQty * 100)) : 0;
    // Urgency: big deficit + not started bonus + expired penalty + urgency from short shelf life
    const urgency = deficit * 2
      + (targetQty > 0 && available === 0 ? 30 : 0)
      + expiredCount * 15
      + (10 / shelfLife);

    return { code, p, available, targetQty, shelfLife, expiredCount, deficit, pct, urgency };
  });

  const top5 = scored
    .filter(s => s.deficit > 0 || s.expiredCount > 0)
    .sort((a, b) => b.urgency - a.urgency)
    .slice(0, 5);

  if (!top5.length) {
    el.innerHTML = `<div class="empty-state" style="padding:20px"><div class="empty-icon">🎉</div>All daily targets met — kitchen is on track!</div>`;
    return;
  }

  el.innerHTML = top5.map(({ code, p, available, targetQty, shelfLife, expiredCount, pct }, i) => {
    const gnSize   = p.gnSize || "";
    const barColor = pct < 30 ? "var(--red)" : pct < 70 ? "var(--amber)" : "var(--green)";
    const pctCls   = pct < 30 ? "red"        : pct < 70 ? "amber"        : "green";

    const badges = [];
    if (expiredCount > 0)
      badges.push(`<span class="urgent-badge" style="background:var(--red-dim);color:var(--red);border:1px solid var(--red-brd)">${expiredCount} expired</span>`);
    if (shelfLife <= 1)
      badges.push(`<span class="urgent-badge" style="background:var(--amber-dim);color:var(--amber);border:1px solid var(--amber-brd)">1d shelf</span>`);
    if (available === 0)
      badges.push(`<span class="urgent-badge" style="background:var(--red-dim);color:var(--red);border:1px solid var(--red-brd)">Not started</span>`);

    return `
    <div class="urgent-card">
      <div class="urgent-rank">${i + 1}</div>
      <div class="urgent-body">
        <div class="urgent-name">${_escM(p.name || code)}</div>
        <div class="urgent-meta">
          <span>${available}${gnSize ? " "+gnSize : ""} / ${targetQty}${gnSize ? " "+gnSize : ""} done</span>
          <span style="color:var(--faint)">·</span>
          <span>Shelf ${shelfLife}d</span>
          ${badges.join(" ")}
        </div>
      </div>
      <div class="urgent-progress">
        <span class="urgent-pct ${pctCls}">${pct}%</span>
        <div class="urgent-bar">
          <div class="urgent-bar-fill" style="width:${pct}%;background:${barColor}"></div>
        </div>
      </div>
    </div>`;
  }).join("");
}

function _renderMorningLowStock() {
  const el = document.getElementById("morning-stock");
  if (!el) return;

  if (!allInventory.length) {
    el.innerHTML = `<div class="empty-state" style="padding:20px"><div class="empty-icon">📦</div>Inventory not loaded yet. <a href="#" onclick="event.preventDefault();loadInventory().then(()=>_renderMorningLowStock())" style="color:var(--amber)">Load now</a></div>`;
    return;
  }

  const lowItems = allInventory
    .filter(r => {
      const qty = parseFloat(r.quantity) || 0;
      const min = parseFloat(r.minimum)  || 0;
      return min > 0 && qty <= min;
    })
    .sort((a, b) => (parseFloat(a.quantity)||0) - (parseFloat(b.quantity)||0));

  if (!lowItems.length) {
    el.innerHTML = `<div class="empty-state" style="padding:20px"><div class="empty-icon">✅</div>All Lager items above minimum — good stock levels.</div>`;
    return;
  }

  el.innerHTML = lowItems.map(r => {
    const qty   = parseFloat(r.quantity) || 0;
    const min   = parseFloat(r.minimum)  || 0;
    const isOut = qty <= 0;
    const cls   = isOut ? "red" : "yellow";
    const icon  = isOut ? "🚨"  : "⚠️";
    const label = isOut ? "OUT OF STOCK" : "LOW STOCK";
    const badgeBg  = isOut ? "var(--red-dim)"   : "var(--amber-dim)";
    const badgeClr = isOut ? "var(--red)"        : "var(--amber)";
    const badgeBrd = isOut ? "var(--red-brd)"    : "var(--amber-brd)";
    return `
    <div class="mep-alert ${cls}" style="margin-bottom:8px;cursor:default">
      <span class="mep-alert-icon">${icon}</span>
      <div class="mep-alert-body">
        <div class="mep-alert-title">${_escM(r.name || r.code)}</div>
        <div class="mep-alert-sub">${label} · ${qty} ${r.unit||""} (min: ${min}) · ${_escM(r.lieferant||"—")}</div>
      </div>
      <span class="urgent-badge" style="margin-left:auto;flex-shrink:0;background:${badgeBg};color:${badgeClr};border:1px solid ${badgeBrd}">Order!</span>
    </div>`;
  }).join("");
}

function _renderMorningChecklist() {
  const el = document.getElementById("morning-checklist");
  if (!el) return;

  const key   = _morningChecklistKey();
  let   items = JSON.parse(localStorage.getItem(key) || "null");
  if (!items) {
    items = MORNING_CHECKLIST_DEFAULTS.map((text, i) => ({ id: i, text, done: false }));
    localStorage.setItem(key, JSON.stringify(items));
  }

  if (!items.length) {
    el.innerHTML = `<div class="empty-state" style="padding:16px"><div class="empty-icon">📝</div>No tasks. Tap <b>+ Add</b> to create one.</div>`;
    return;
  }

  const doneCount = items.filter(it => it.done).length;
  const pct       = items.length ? Math.round(doneCount / items.length * 100) : 0;

  el.innerHTML = `
    <div style="font-size:11px;color:var(--muted);margin-bottom:8px">${doneCount} / ${items.length} tasks completed</div>
    <div class="morning-progress-bar"><div class="morning-progress-fill" style="width:${pct}%"></div></div>
    ${items.map((item, idx) => `
    <div class="check-item ${item.done ? "done" : ""}" data-idx="${idx}">
      <div class="check-box">${item.done
        ? `<svg width="12" height="10" viewBox="0 0 12 10"><polyline points="1,5 4.5,8.5 11,1" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`
        : ""}</div>
      <span class="check-text">${_escM(item.text)}</span>
      <button data-idx="${idx}" class="check-remove-btn"
        style="background:none;border:none;color:var(--faint);font-size:18px;cursor:pointer;padding:0;line-height:1;flex-shrink:0" title="Remove">×</button>
    </div>`).join("")}`;
  el.querySelectorAll('.check-item').forEach(div => {
    div.addEventListener('click', () => toggleCheck(parseInt(div.dataset.idx)));
  });
  el.querySelectorAll('.check-remove-btn').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); removeCheckItem(parseInt(btn.dataset.idx)); });
  });
}

function toggleCheck(idx) {
  const key   = _morningChecklistKey();
  const items = JSON.parse(localStorage.getItem(key) || "[]");
  if (items[idx] !== undefined) items[idx].done = !items[idx].done;
  localStorage.setItem(key, JSON.stringify(items));
  _renderMorningChecklist();
}

function removeCheckItem(idx) {
  const key   = _morningChecklistKey();
  const items = JSON.parse(localStorage.getItem(key) || "[]");
  items.splice(idx, 1);
  localStorage.setItem(key, JSON.stringify(items));
  _renderMorningChecklist();
}

function resetChecklist() {
  const items = MORNING_CHECKLIST_DEFAULTS.map((text, i) => ({ id: i, text, done: false }));
  localStorage.setItem(_morningChecklistKey(), JSON.stringify(items));
  _renderMorningChecklist();
  showToast("Checklist reset for today", "info");
}

function addChecklistItem() {
  const text = window.prompt("New task name:");
  if (!text || !text.trim()) return;
  const key   = _morningChecklistKey();
  const items = JSON.parse(localStorage.getItem(key) || "[]");
  items.push({ id: Date.now(), text: text.trim(), done: false });
  localStorage.setItem(key, JSON.stringify(items));
  _renderMorningChecklist();
}
