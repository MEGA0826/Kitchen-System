// Kitchen MEP — Menu Engineering dashboard (CalcMenu-style Stars/Plowhorses/Puzzles/Dogs).
// Self-contained classic script (loaded before </body>): injects its own launcher +
// full-screen panel, so no other HTML changes are needed. Reads the public.menu_engineering
// view (menus × sales, classified by popularity × contribution margin) with the anon key —
// read-only, never writes. Every number is computed server-side in Postgres.
(function () {
  "use strict";
  // SB_URL / SB_KEY are top-level `const` in dashboard.html (global lexical env, shared
  // across classic scripts) — read them as bare globals, not via window (const isn't on window).
  var SB  = (typeof SB_URL !== "undefined" && SB_URL) ? SB_URL : "https://clntikfffmjytexvzubq.supabase.co";
  var KEY = (typeof SB_KEY !== "undefined" && SB_KEY) ? SB_KEY : "";
  var rows = null, panel, opened = false, sortCol = "total_margin", sortDir = -1;

  var CLASS = {
    Star:      { c: "#22c55e", emoji: "⭐", tip: "Keep & protect — feature prominently, hold the price." },
    Plowhorse: { c: "#3b82f6", emoji: "🐴", tip: "Popular but lower margin — nudge price up or trim cost." },
    Puzzle:    { c: "#f59e0b", emoji: "🧩", tip: "High margin, low sales — promote, rename or reposition." },
    Dog:       { c: "#ef4444", emoji: "🐕", tip: "Low sales & low margin — rework the recipe or remove it." }
  };
  var ORDER = ["Star", "Plowhorse", "Puzzle", "Dog"];

  function esc(s){ return String(s==null?"":s).replace(/[&<>"]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c];}); }
  function chf(n){ return Math.round(n).toLocaleString("de-CH"); }

  function injectUI() {
    var st = document.createElement("style");
    st.textContent =
      "#me-fab{position:fixed;left:18px;bottom:18px;z-index:9998;background:#0f766e;color:#fff;border:none;border-radius:28px;height:52px;padding:0 20px;font-size:15px;font-weight:600;box-shadow:0 6px 20px rgba(0,0,0,.28);cursor:pointer;display:flex;align-items:center;gap:8px}" +
      "#me-fab:hover{background:#0d5f58}" +
      "#me-ov{position:fixed;inset:0;z-index:10000;background:rgba(8,9,15,.72);display:none;align-items:center;justify-content:center;padding:16px}" +
      "#me-ov.open{display:flex}" +
      "#me-panel{background:#1e2030;color:#e7e9f3;border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.5);width:min(940px,100%);height:min(90vh,900px);display:flex;flex-direction:column;overflow:hidden;font-size:14px}" +
      "#me-head{padding:14px 16px;background:#272a3d;font-weight:700;display:flex;align-items:center;justify-content:space-between;font-size:16px}" +
      "#me-head .x{cursor:pointer;opacity:.7;font-size:20px;background:none;border:none;color:#e7e9f3}" +
      "#me-body{flex:1;overflow-y:auto;padding:16px}" +
      ".me-cards{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px}" +
      ".me-card{border-radius:12px;padding:11px 12px;background:#2c2f45;border-left:4px solid}" +
      ".me-card .n{font-size:22px;font-weight:800;line-height:1}" +
      ".me-card .l{font-size:12.5px;font-weight:700;margin:3px 0 2px}" +
      ".me-card .s{font-size:11px;opacity:.72}" +
      ".me-chart{background:#171826;border-radius:12px;padding:8px;margin-bottom:16px}" +
      ".me-tip{font-size:12px;opacity:.7;margin:0 2px 14px;line-height:1.5}" +
      "table.me-tbl{border-collapse:collapse;width:100%;font-size:12.5px}" +
      ".me-tbl th,.me-tbl td{border-bottom:1px solid rgba(255,255,255,.1);padding:6px 8px;text-align:right;white-space:nowrap}" +
      ".me-tbl th:nth-child(2),.me-tbl td:nth-child(2){text-align:left;white-space:normal}" +
      ".me-tbl th{position:sticky;top:0;background:#1e2030;cursor:pointer;user-select:none;font-size:11.5px;opacity:.85}" +
      ".me-tbl th:first-child,.me-tbl td:first-child{text-align:center}" +
      ".me-badge{display:inline-block;padding:1px 7px;border-radius:20px;font-size:11px;font-weight:700;color:#0b0d13}" +
      ".me-loading{opacity:.7;text-align:center;padding:40px}" +
      "@media(max-width:640px){.me-cards{grid-template-columns:repeat(2,1fr)}}";
    document.head.appendChild(st);

    var fab = document.createElement("button");
    fab.id = "me-fab"; fab.innerHTML = "📊 Menu Analysis"; fab.onclick = open;
    document.body.appendChild(fab);

    panel = document.createElement("div");
    panel.id = "me-ov";
    panel.innerHTML =
      '<div id="me-panel">' +
        '<div id="me-head"><span>📊 Menu Engineering</span><button class="x" title="Close">✕</button></div>' +
        '<div id="me-body"><div class="me-loading">Loading…</div></div>' +
      '</div>';
    document.body.appendChild(panel);
    panel.querySelector(".x").onclick = close;
    panel.addEventListener("click", function (e) { if (e.target === panel) close(); });
  }

  function open() { panel.classList.add("open"); opened = true; if (!rows) load(); }
  function close() { panel.classList.remove("open"); opened = false; }

  async function load() {
    try {
      var res = await fetch(SB + "/rest/v1/menu_engineering?select=*&order=total_margin.desc",
        { headers: { apikey: KEY, Authorization: "Bearer " + KEY } });
      if (!res.ok) throw new Error("HTTP " + res.status);
      rows = await res.json();
      render();
    } catch (e) {
      document.getElementById("me-body").innerHTML =
        '<div class="me-loading">Could not load menu data (' + esc(e.message) + ').</div>';
    }
  }

  function render() {
    if (!rows || !rows.length) {
      document.getElementById("me-body").innerHTML = '<div class="me-loading">No menu data available yet.</div>';
      return;
    }
    var byClass = {}; ORDER.forEach(function (k) { byClass[k] = { n: 0, m: 0 }; });
    rows.forEach(function (r) { byClass[r.class].n++; byClass[r.class].m += r.total_margin; });

    var cards = ORDER.map(function (k) {
      return '<div class="me-card" style="border-left-color:' + CLASS[k].c + '">' +
        '<div class="n" style="color:' + CLASS[k].c + '">' + byClass[k].n + '</div>' +
        '<div class="l">' + CLASS[k].emoji + " " + k + (k === "Puzzle" ? "s" : k === "Star" ? "s" : "s") + '</div>' +
        '<div class="s">CHF ' + chf(byClass[k].m) + ' margin</div></div>';
    }).join("");

    var body = document.getElementById("me-body");
    body.innerHTML =
      '<div class="me-cards">' + cards + '</div>' +
      '<div class="me-chart">' + scatter() + '</div>' +
      '<div class="me-tip">Popularity = menu-units sold (log scale). Profitability = contribution margin per unit (price − food cost). ' +
      'Dividers: 70% of average popularity, and average margin. Dot size ∝ total margin contribution.</div>' +
      table();
    bindSort();
  }

  function scatter() {
    var W = 900, H = 380, PADL = 54, PADB = 34, PADT = 14, PADR = 14;
    var us = rows.map(function (r) { return Math.log10(Math.max(r.units_sold, 1)); });
    var ms = rows.map(function (r) { return r.margin; });
    var uMin = Math.min.apply(null, us), uMax = Math.max.apply(null, us);
    var mMin = Math.min(0, Math.min.apply(null, ms)), mMax = Math.max.apply(null, ms);
    var uPad = (uMax - uMin) * 0.08 || 0.5, mPad = (mMax - mMin) * 0.08 || 1;
    uMin -= uPad; uMax += uPad; mMin -= mPad * 0.2; mMax += mPad;
    var maxTM = Math.max.apply(null, rows.map(function (r) { return r.total_margin; })) || 1;
    var x = function (u) { return PADL + (u - uMin) / (uMax - uMin) * (W - PADL - PADR); };
    var y = function (m) { return H - PADB - (m - mMin) / (mMax - mMin) * (H - PADT - PADB); };

    var avgU = Math.log10(Math.max(rows[0].avg_units, 1)), thrU = Math.log10(Math.max(0.7 * rows[0].avg_units, 1));
    var thrM = rows[0].avg_margin;
    var vx = x(thrU), hy = y(thrM);

    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:auto" xmlns="http://www.w3.org/2000/svg">';
    // quadrant shading
    s += '<rect x="' + vx + '" y="' + PADT + '" width="' + (W - PADR - vx) + '" height="' + (hy - PADT) + '" fill="#22c55e11"/>';
    s += '<rect x="' + vx + '" y="' + hy + '" width="' + (W - PADR - vx) + '" height="' + (H - PADB - hy) + '" fill="#3b82f611"/>';
    s += '<rect x="' + PADL + '" y="' + PADT + '" width="' + (vx - PADL) + '" height="' + (hy - PADT) + '" fill="#f59e0b11"/>';
    s += '<rect x="' + PADL + '" y="' + hy + '" width="' + (vx - PADL) + '" height="' + (H - PADB - hy) + '" fill="#ef444411"/>';
    // divider lines
    s += '<line x1="' + vx + '" y1="' + PADT + '" x2="' + vx + '" y2="' + (H - PADB) + '" stroke="#ffffff33" stroke-dasharray="4 4"/>';
    s += '<line x1="' + PADL + '" y1="' + hy + '" x2="' + (W - PADR) + '" y2="' + hy + '" stroke="#ffffff33" stroke-dasharray="4 4"/>';
    // axes labels
    s += '<text x="' + (W / 2) + '" y="' + (H - 6) + '" fill="#e7e9f3aa" font-size="12" text-anchor="middle">Popularity  (units sold →)</text>';
    s += '<text x="14" y="' + (H / 2) + '" fill="#e7e9f3aa" font-size="12" text-anchor="middle" transform="rotate(-90 14 ' + (H / 2) + ')">Margin / unit (CHF →)</text>';
    // quadrant corner labels
    s += '<text x="' + (W - PADR - 6) + '" y="' + (PADT + 14) + '" fill="#22c55e" font-size="12" font-weight="700" text-anchor="end">⭐ Stars</text>';
    s += '<text x="' + (W - PADR - 6) + '" y="' + (H - PADB - 6) + '" fill="#3b82f6" font-size="12" font-weight="700" text-anchor="end">🐴 Plowhorses</text>';
    s += '<text x="' + (PADL + 6) + '" y="' + (PADT + 14) + '" fill="#f59e0b" font-size="12" font-weight="700">🧩 Puzzles</text>';
    s += '<text x="' + (PADL + 6) + '" y="' + (H - PADB - 6) + '" fill="#ef4444" font-size="12" font-weight="700">🐕 Dogs</text>';
    // dots (small first so big ones draw on top)
    var sorted = rows.slice().sort(function (a, b) { return a.total_margin - b.total_margin; });
    sorted.forEach(function (r) {
      var rad = 4 + Math.sqrt(Math.abs(r.total_margin) / maxTM) * 16;
      s += '<circle cx="' + x(Math.log10(Math.max(r.units_sold, 1))).toFixed(1) + '" cy="' + y(r.margin).toFixed(1) +
        '" r="' + rad.toFixed(1) + '" fill="' + CLASS[r.class].c + 'cc" stroke="' + CLASS[r.class].c + '" stroke-width="1"/>';
    });
    // label the biggest-margin dish in each quadrant (spreads labels across the chart)
    ORDER.forEach(function (cls) {
      var top = rows.filter(function (r) { return r.class === cls; })
        .sort(function (a, b) { return b.total_margin - a.total_margin; })[0];
      if (!top) return;
      var cx = x(Math.log10(Math.max(top.units_sold, 1))), cy = y(top.margin);
      var nm = top.name.length > 20 ? top.name.slice(0, 19) + "…" : top.name;
      var anchor = cx > W * 0.62 ? "end" : "start", dx = cx > W * 0.62 ? -9 : 9;
      s += '<text x="' + (cx + dx).toFixed(1) + '" y="' + (cy - 9).toFixed(1) + '" fill="#fff" font-size="10.5" font-weight="600" text-anchor="' + anchor + '">' + esc(nm) + '</text>';
    });
    s += '</svg>';
    return s;
  }

  var COLS = [
    { k: "class", t: "" }, { k: "name", t: "Dish" }, { k: "units_sold", t: "Units" },
    { k: "price", t: "Price" }, { k: "food_cost", t: "Cost" }, { k: "margin", t: "Margin" },
    { k: "food_cost_pct", t: "FC%" }, { k: "total_margin", t: "Total margin" }, { k: "mix_pct", t: "Mix%" }
  ];

  function table() {
    var sorted = rows.slice().sort(function (a, b) {
      var av = a[sortCol], bv = b[sortCol];
      if (typeof av === "string") return sortDir * av.localeCompare(bv);
      return sortDir * (av - bv);
    });
    var head = "<tr>" + COLS.map(function (c) {
      var arrow = c.k === sortCol ? (sortDir < 0 ? " ▼" : " ▲") : "";
      return '<th data-k="' + c.k + '">' + c.t + arrow + "</th>";
    }).join("") + "</tr>";
    var rowsHtml = sorted.map(function (r) {
      var b = '<span class="me-badge" title="' + esc(CLASS[r.class].tip) + '" style="background:' + CLASS[r.class].c + '">' + CLASS[r.class].emoji + "</span>";
      return "<tr>" +
        "<td>" + b + "</td>" +
        "<td>" + esc(r.name) + '<div style="font-size:10.5px;opacity:.6">' + esc(CLASS[r.class].tip) + "</div></td>" +
        "<td>" + chf(r.units_sold) + "</td>" +
        "<td>" + r.price.toFixed(2) + "</td>" +
        "<td>" + r.food_cost.toFixed(2) + "</td>" +
        "<td>" + r.margin.toFixed(2) + "</td>" +
        "<td>" + r.food_cost_pct + "%</td>" +
        "<td>" + chf(r.total_margin) + "</td>" +
        "<td>" + r.mix_pct + "%</td>" +
        "</tr>";
    }).join("");
    return '<div style="overflow-x:auto"><table class="me-tbl"><thead>' + head + "</thead><tbody>" + rowsHtml + "</tbody></table></div>";
  }

  function bindSort() {
    [].forEach.call(panel.querySelectorAll(".me-tbl th"), function (th) {
      th.onclick = function () {
        var k = th.getAttribute("data-k");
        if (k === sortCol) sortDir = -sortDir; else { sortCol = k; sortDir = (k === "name" || k === "class") ? 1 : -1; }
        document.getElementById("me-body").querySelector('[style*="overflow-x"]').outerHTML = table();
        bindSort();
      };
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", injectUI);
  else injectUI();
})();
