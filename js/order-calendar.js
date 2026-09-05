/* order-calendar.js — Orders tab: supplier order/delivery calendar + shortage-to-order table.
   Extracted from dashboard.html (module 14). Event-driven only: reached via switchTab,
   loadInventory (after its await), the boot .then() restore, and inline onchange/oninput/onclick.
   Reads app globals: allProducts, allRecipes, allInventory, t.
   Owns state: SUPPLIER_CFG, _DN, _MN, _calYear/_calMonth/_calSelectedDate/_calEvents. */
// ─────────────────────────────────────────────
// ORDERS
// ─────────────────────────────────────────────
const SUPPLIER_CFG = {
  "Kellerberger":        { days:[2,4,5],      cutoff:14, lead:1, thailand:false, note:"Delivery: Tue/Thu/Fri · Order by 14:00 day before" },
  "G.Bianchi AG":        { days:[1,2,3,4,5,6],cutoff:15, lead:1, thailand:false, note:"Delivery: Mon–Sat · Order by 15:00 day before" },
  "Saviva Food Services":{ days:[2,4],        cutoff:12, lead:1, thailand:false, ersatz:[1,3,5], note:"Delivery: Tue/Thu · Ersatz: Mon/Wed/Fri · Order by 12:00 day before" },
  "Stutzer Service AG":  { days:[2,4],        cutoff:12, lead:7, thailand:true,  note:"🇹🇭 1 week lead · Order Tue→deliver next Tue, Thu→next Thu" },
  "The Asia Company SA": { days:[3,5],        cutoff:12, lead:1, thailand:false, ersatz:[1,2], note:"Delivery: Wed/Fri · Ersatz: Mon/Tue · Order by 12:00 day before" },
  "Stützer":             { days:[2,4],        cutoff:12, lead:7, thailand:true,  note:"🇹🇭 1 week lead · Order Tue→deliver next Tue, Thu→next Thu" }
};
const _DN  = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const _MN  = ["January","February","March","April","May","June","July","August","September","October","November","December"];

let _calYear  = new Date().getFullYear();
let _calMonth = new Date().getMonth();
let _calSelectedDate = null;  // "YYYY-MM-DD"
let _calEvents = {};          // "YYYY-MM-DD" → { orders:[], deliveries:[] }

function _dateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function _nextDelivery(supName) {
  const cfg = SUPPLIER_CFG[supName];
  const now = new Date(); now.setSeconds(0,0);
  const h   = now.getHours();
  if (!cfg) {
    const od = new Date(now); od.setDate(od.getDate()+1); od.setHours(0,0,0,0);
    const dd = new Date(od);  dd.setDate(dd.getDate()+1);
    return { orderDate:od, delivDate:dd, urgent:false, note:"No schedule configured", cutoff:null, thailand:false };
  }
  for (let i = 0; i <= 21; i++) {
    const candidate = new Date(now); candidate.setHours(0,0,0,0); candidate.setDate(candidate.getDate()+i);
    if (!cfg.days.includes(candidate.getDay())) continue;
    if (!cfg.thailand) {
      const orderDate = new Date(candidate); orderDate.setDate(candidate.getDate()-cfg.lead);
      const isToday = orderDate.toDateString() === now.toDateString();
      const isPast  = orderDate < new Date(now.toDateString());
      if (isPast) continue;
      if (isToday && h >= cfg.cutoff) continue;
      return { orderDate, delivDate:candidate, urgent:isToday, note:cfg.note, cutoff:cfg.cutoff, thailand:false };
    } else {
      const orderDate = new Date(candidate);
      const delivDate = new Date(candidate); delivDate.setDate(candidate.getDate()+7);
      const isToday = orderDate.toDateString() === now.toDateString();
      const isPast  = orderDate < new Date(now.toDateString());
      if (isPast) continue;
      if (isToday && h >= cfg.cutoff) continue;
      return { orderDate, delivDate, urgent:isToday, note:cfg.note, cutoff:cfg.cutoff, thailand:true };
    }
  }
  const od = new Date(now); od.setDate(od.getDate()+1); od.setHours(0,0,0,0);
  const dd = new Date(od);  dd.setDate(dd.getDate()+(cfg.thailand?7:1));
  return { orderDate:od, delivDate:dd, urgent:false, note:cfg?.note||"", cutoff:null, thailand:!!cfg?.thailand };
}

function _fmtDate(d) {
  if (!d) return "—";
  return `${_DN[d.getDay()]} ${String(d.getDate()).padStart(2,"0")}.${String(d.getMonth()+1).padStart(2,"0")}.${d.getFullYear().toString().slice(2)}`;
}

function _buildCalEvents(bySupplier) {
  _calEvents = {};
  Object.entries(bySupplier).forEach(([sup, rows]) => {
    const sched = _nextDelivery(sup);
    const ok = _dateKey(sched.orderDate);
    const dk = _dateKey(sched.delivDate);
    if (!_calEvents[ok]) _calEvents[ok] = { orders:[], deliveries:[] };
    if (!_calEvents[dk]) _calEvents[dk] = { orders:[], deliveries:[] };
    _calEvents[ok].orders.push({ sup, rows, sched });
    _calEvents[dk].deliveries.push({ sup, rows, sched });
  });
}

function renderOrderCal() {
  const grid  = document.getElementById("order-cal-grid");
  const title = document.getElementById("order-cal-month");
  if (!grid) return;
  title.textContent = `${_MN[_calMonth]} ${_calYear}`;

  const todayKey = _dateKey(new Date());
  const firstDay = new Date(_calYear, _calMonth, 1);
  const lastDay  = new Date(_calYear, _calMonth+1, 0);
  // pad start: Mon=0 grid (convert Sun=0 JS to Mon=0 display)
  const startPad = (firstDay.getDay()+6) % 7;

  let html = _DN.slice(1).concat(_DN[0])
    .map(d => `<div class="order-cal-dow">${d}</div>`).join("");

  // Empty cells before month start
  for (let i = 0; i < startPad; i++) {
    const d = new Date(_calYear, _calMonth, 1 - startPad + i);
    const k = _dateKey(d);
    const ev = _calEvents[k] || {};
    const cls = _calDayCls(k, ev, todayKey, true);
    html += `<div class="order-cal-day other-month ${cls}" data-key="${k}">`
      + `<span class="order-cal-dn">${d.getDate()}</span>`
      + _calDots(ev) + `</div>`;
  }

  for (let d = 1; d <= lastDay.getDate(); d++) {
    const date = new Date(_calYear, _calMonth, d);
    const k    = _dateKey(date);
    const ev   = _calEvents[k] || {};
    const cls  = _calDayCls(k, ev, todayKey, false);
    html += `<div class="order-cal-day ${cls}" data-key="${k}">`
      + `<span class="order-cal-dn">${d}</span>`
      + _calDots(ev) + `</div>`;
  }

  // Trailing cells
  const endPad = (7 - ((startPad + lastDay.getDate()) % 7)) % 7;
  for (let i = 1; i <= endPad; i++) {
    const date = new Date(_calYear, _calMonth+1, i);
    const k    = _dateKey(date);
    const ev   = _calEvents[k] || {};
    const cls  = _calDayCls(k, ev, todayKey, true);
    html += `<div class="order-cal-day other-month ${cls}" data-key="${k}">`
      + `<span class="order-cal-dn">${date.getDate()}</span>`
      + _calDots(ev) + `</div>`;
  }

  grid.innerHTML = html;
  grid.querySelectorAll('.order-cal-day').forEach(el => {
    el.addEventListener('click', () => orderCalClick(el.dataset.key));
  });
}

function _calDayCls(k, ev, todayKey, otherMonth) {
  let cls = "";
  if (k === todayKey) cls += " today";
  if (ev.orders?.length)     cls += " has-order";
  if (ev.deliveries?.length) cls += " has-deliver";
  if (k === _calSelectedDate) cls += " selected";
  return cls.trim();
}

function _calDots(ev) {
  let dots = "";
  if (ev.orders?.length)     dots += `<span class="order-cal-dot" style="color:var(--red)">📋×${ev.orders.length}</span>`;
  if (ev.deliveries?.length) dots += `<span class="order-cal-dot" style="color:var(--green)">🚚×${ev.deliveries.length}</span>`;
  return dots;
}

function orderCalShift(dir) {
  _calMonth += dir;
  if (_calMonth > 11) { _calMonth = 0; _calYear++; }
  if (_calMonth < 0)  { _calMonth = 11; _calYear--; }
  renderOrderCal();
}

function orderCalClick(key) {
  _calSelectedDate = (_calSelectedDate === key) ? null : key;
  renderOrderCal();
  const box = document.getElementById("order-detail-box");
  if (!box) return;
  const ev = _calEvents[key];
  if (!_calSelectedDate || !ev || (!ev.orders.length && !ev.deliveries.length)) {
    box.style.display = "none";
    return;
  }
  const [y,m,d] = key.split("-");
  const dateLabel = `${_DN[new Date(+y,+m-1,+d).getDay()]} ${d}.${m}.${y}`;
  let html = `<div class="order-detail-title">📅 ${dateLabel}</div>`;

  if (ev.orders.length) {
    html += `<div style="font-size:12px;font-weight:600;color:var(--red);margin-bottom:6px">📋 ORDER DEADLINE</div>`;
    ev.orders.forEach(({ sup, rows, sched }) => {
      const shortage = rows.filter(r=>r.shortage);
      html += `<div style="margin-bottom:10px;padding:10px;background:rgba(220,50,50,0.07);border-radius:8px;border-left:3px solid var(--red)">
        <div style="font-weight:600;font-size:13px">🏭 ${sup}</div>
        <div style="font-size:11px;color:var(--muted);margin-bottom:6px">${sched.note}</div>
        <div style="font-size:11px;color:var(--green)">🚚 Delivers: ${_fmtDate(sched.delivDate)}</div>
        ${sched.cutoff ? `<div style="font-size:11px;color:var(--amber)">⏰ Send by ${sched.cutoff}:00</div>` : ""}
        ${shortage.length ? `<div style="margin-top:8px;font-size:12px;font-weight:500;color:var(--red)">${shortage.length} item${shortage.length>1?"s":""} to order:</div>
        <ul style="margin:4px 0 0 0;padding-left:16px;font-size:12px;color:var(--text)">
          ${shortage.map(r=>`<li><strong>${r.name}</strong> — +${r.toOrder.toFixed(2)} ${r.unit}</li>`).join("")}
        </ul>` : `<div style="font-size:12px;color:var(--green);margin-top:6px">✓ All stock OK for this supplier</div>`}
      </div>`;
    });
  }

  if (ev.deliveries.length) {
    html += `<div style="font-size:12px;font-weight:600;color:var(--green);margin:10px 0 6px">🚚 EXPECTED DELIVERIES</div>`;
    ev.deliveries.forEach(({ sup, rows, sched }) => {
      html += `<div style="margin-bottom:8px;padding:10px;background:rgba(40,180,40,0.07);border-radius:8px;border-left:3px solid var(--green)">
        <div style="font-weight:600;font-size:13px">🏭 ${sup}</div>
        <div style="font-size:11px;color:var(--muted)">${sched.note}</div>
        <div style="font-size:11px;color:var(--amber);margin-top:4px">📋 Ordered by: ${_fmtDate(sched.orderDate)}</div>
        ${sched.thailand ? `<div style="font-size:11px;color:var(--red)">⚠ 1-week lead time</div>` : ""}
        <div style="font-size:12px;color:var(--muted);margin-top:4px">${rows.length} item${rows.length>1?"s":""} expected</div>
      </div>`;
    });
  }

  box.innerHTML = html;
  box.style.display = "block";
  box.scrollIntoView({ behavior:"smooth", block:"nearest" });
}

function renderOrders() {
  const _safeT = (typeof t === 'function') ? t : (k => k);
  const container = document.getElementById("order-content");
  const summary   = document.getElementById("order-summary");
  if (!container) return;

  const days     = parseInt(document.getElementById("order-days")?.value || "2");
  const showMode = document.getElementById("order-show")?.value || "shortage";
  const q        = (document.getElementById("order-search")?.value || "").toLowerCase();
  const SAFETY   = 0.5;

  // Step 1: aggregate raw material needs from recipes × mepMax
  const rmNeeds = {};
  Object.entries(allProducts).forEach(([mepCode, p]) => {
    const targetGN = Number(p.tagesziel > 0 ? p.tagesziel : p.mepMax) || 0;
    if (!targetGN) return;
    allRecipes.filter(r => r.mepCode === mepCode).forEach(r => {
      const n = targetGN * Number(r.menge || 0);
      if (!n) return;
      if (!rmNeeds[r.rmCode]) rmNeeds[r.rmCode] = { needed1day:0, unit:r.einheit||"", mepSources:[] };
      rmNeeds[r.rmCode].needed1day += n;
      rmNeeds[r.rmCode].mepSources.push(`${p.name||mepCode} (${targetGN}GN × ${r.menge}${r.einheit})`);
    });
  });

  // Step 2: match rmCode → inventory
  const items = [];
  Object.entries(rmNeeds).forEach(([rmCode, req]) => {
    const inv = allInventory.find(x => x.code === rmCode);
    if (!inv) return;
    const inStock  = Number(inv.quantity||0) * Number(inv.weightUnit||1);
    const required = req.needed1day * (days + SAFETY);
    const toOrder  = Math.max(0, required - inStock);
    items.push({
      code:inv.code, name:inv.name||rmCode, lieferant:inv.lieferant||"",
      unit:req.unit||inv.unit||"", inStock, needed1day:req.needed1day,
      required, toOrder, shortage:toOrder>0, mepSources:req.mepSources
    });
  });

  // Step 3: below-minimum fallback
  allInventory.forEach(inv => {
    if (items.find(x => x.code === inv.code)) return;
    const qty = Number(inv.quantity||0);
    const min = Number(inv.minimum||0);
    if (min > 0 && qty < min) {
      const required = min * (days + SAFETY);
      items.push({
        code:inv.code, name:inv.name||inv.code, lieferant:inv.lieferant||"",
        unit:inv.unit||"", inStock:qty, needed1day:min, required,
        toOrder:Math.max(0,required-qty), shortage:true, mepSources:[]
      });
    }
  });

  // Step 4: filter
  let visible = showMode==="shortage" ? items.filter(x=>x.shortage) : items;
  if (q) visible = visible.filter(x =>
    x.name.toLowerCase().includes(q) ||
    x.code.toLowerCase().includes(q) ||
    x.lieferant.toLowerCase().includes(q));

  // Step 5: group by supplier
  const bySupplier = {};
  visible.forEach(r => {
    const s = r.lieferant||"— No supplier —";
    if (!bySupplier[s]) bySupplier[s] = [];
    bySupplier[s].push(r);
  });

  // Build calendar events & render calendar
  _buildCalEvents(bySupplier);
  renderOrderCal();

  if (!visible.length) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">${showMode==="shortage"?"✅":"📦"}</div>${showMode==="shortage"?_safeT('all-done'):_safeT('no-data')}</div>`;
    if (summary) summary.textContent = "";
    return;
  }

  let html = "";
  let totalShortage = 0;

  Object.entries(bySupplier).sort(([a],[b])=>a.localeCompare(b)).forEach(([sup, rows]) => {
    const sched    = _nextDelivery(sup);
    const shortage = rows.filter(r=>r.shortage).length;
    totalShortage += shortage;
    rows.sort((a,b)=>(b.shortage-a.shortage)||a.name.localeCompare(b.name));

    html += `
    <div style="margin-bottom:24px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:16px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;margin-bottom:12px">
        <div>
          <div style="font-size:15px;font-weight:600">🏭 ${sup}</div>
          <div style="font-size:11px;color:var(--muted);margin-top:3px">${sched.note||""}</div>
        </div>
        <div style="text-align:right;font-size:12px;line-height:1.8">
          <div style="color:${sched.urgent?"var(--red)":"var(--amber)"}">
            ${sched.urgent?"⚡ ORDER TODAY":"📋 Order by"}: <strong>${_fmtDate(sched.orderDate)}</strong>${sched.cutoff?" before "+sched.cutoff+":00":""}
          </div>
          <div style="color:var(--green)">🚚 Delivery: <strong>${_fmtDate(sched.delivDate)}</strong></div>
          ${sched.thailand?`<div style="color:var(--red);font-size:11px">⚠ 1-week lead time</div>`:""}
          <div style="color:${shortage>0?"var(--red)":"var(--green)"}">${shortage>0?shortage+" item"+(shortage>1?"s":"")+" to order":"✓ Stock OK"}</div>
        </div>
      </div>
      <div style="overflow-x:auto;-webkit-overflow-scrolling:touch">
      <table class="inv-table" style="width:max-content;min-width:100%">
        <thead><tr>
          <th>${_safeT('code')}</th><th>${_safeT('product')}</th><th>${_safeT('in-stock')}</th>
          <th>${_safeT('qty')}/${_safeT('worker')}</th><th>${_safeT('required')} (${days}d+50%)</th>
          <th>${_safeT('to-order')}</th><th>${_safeT('success')}</th>
        </tr></thead>
        <tbody>${rows.map(r=>`
          <tr style="${r.shortage?"background:rgba(220,50,50,0.06)":""}">
            <td style="font-size:11px;color:var(--muted)">${r.code}</td>
            <td><span style="font-weight:500">${r.name}</span>
              ${r.mepSources.length?`<br><span style="font-size:10px;color:var(--muted)" title="${r.mepSources.join('\n')}">${r.mepSources.length} recipe${r.mepSources.length>1?"s":""}</span>`:""}
            </td>
            <td style="color:${r.inStock>0?"var(--text)":"var(--red)"}">${r.inStock.toFixed(2)} ${r.unit}</td>
            <td style="color:var(--muted)">${r.needed1day.toFixed(2)} ${r.unit}</td>
            <td>${r.required.toFixed(2)} ${r.unit}</td>
            <td style="color:${r.shortage?"var(--red)":"var(--green)"};font-weight:600">${r.shortage?"+"+r.toOrder.toFixed(2)+" "+r.unit:"—"}</td>
            <td><span class="stock-pill stock-${r.shortage?"out":"ok"}">${r.shortage?"⚠ "+_safeT('to-order'):"✓ "+_safeT('in-stock')}</span></td>
          </tr>`).join("")}
        </tbody>
      </table>
      </div>
    </div>`;
  });

  container.innerHTML = html;
  if (summary) summary.textContent =
    `${visible.length} item${visible.length!==1?"s":""} · ${Object.keys(bySupplier).length} supplier${Object.keys(bySupplier).length!==1?"s":""} · ${totalShortage} need ordering`;
}
