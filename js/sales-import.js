// Kitchen MEP — Sales CSV import (feature module, classic script).
// Extracted from dashboard.html as the first step of the monolith→modules
// restructure. Loaded via <script src> AFTER the main inline script, so it
// shares its globals (get, gwWrite, gwTokenValid, SB_URL, _sbH, salesData,
// loadSalesAnalysis, requestAdminAccess). Top-level functions become globals,
// so the inline onclick/onchange handlers keep working.

let _salesParsed = null;

// ─────────────────────────────────────────────
// SALES CSV — robust header-based parser + preview
// Maps columns by HEADER NAME (not fixed position), auto-detects the delimiter
// and Swiss number formats, validates, and shows a preview — so a rearranged or
// wrong file (e.g. re-importing an app export) can't silently import garbage.
// ─────────────────────────────────────────────
function _sEsc(v){ return String(v==null?"":v).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c])); }
function _sNormHeader(h){ return String(h||"").toLowerCase().replace(/[^a-z0-9 ]+/g," ").replace(/\s+/g," ").trim(); }

// Locale-aware number: strips Swiss thousands ('  space) and handles comma decimals.
function _sNum(v){
  let s = String(v==null?"":v).trim();
  if(!s) return 0;
  s = s.replace(/['’\s]/g,"");                                    // 1'234 / 1 234 -> 1234
  if(s.indexOf(",")>=0 && s.indexOf(".")>=0) s = s.replace(/,/g,"");   // 1,234.50 -> 1234.50
  else if(s.indexOf(",")>=0) s = s.replace(",",".");                   // 12,5 -> 12.5
  const n = parseFloat(s.replace(/[^0-9.\-]/g,""));
  return isNaN(n) ? 0 : n;
}

// Quote-aware split of a single CSV line (product names may contain the delimiter).
function _sSplit(line, delim){
  const out=[]; let cur="", q=false;
  for(let i=0;i<line.length;i++){
    const ch=line[i];
    if(q){ if(ch==='"'){ if(line[i+1]==='"'){cur+='"';i++;} else q=false; } else cur+=ch; }
    else { if(ch==='"') q=true; else if(ch===delim){ out.push(cur); cur=""; } else cur+=ch; }
  }
  out.push(cur); return out;
}

// Classify one normalised header to a canonical field. Order matters: the
// specific columns (category / WA) are tested before the generic "product",
// and "product" excludes marge/nummer/code so e.g. "Produktmarge" isn't taken
// as the name. Handles name variants like produktname, gruppierung, "waren aufwand".
function _salesFieldOf(h){
  h = " " + h + " ";
  if(/(datum|verkaufsdatum|\bdate\b|\btag\b)/.test(h)) return "d";
  if(/(menge|anzahl|quantity|\bqty\b|\bstk\b|stueck|verkauft|\bcount\b)/.test(h)) return "m";
  if(/(umsatz|revenue|turnover)/.test(h)) return "u";
  if(/(warenaufwand|wareneinsatz|waren.?aufwand|food.?cost)/.test(h)) return "wa";
  if(/(kategorie|category|gruppe|gruppier|warengruppe|\bcat\b)/.test(h)) return "k";
  if(/(produkt|artikel|bezeichnung|\bname\b|\bproduct\b)/.test(h) && !/(marge|nummer|\bnr\b|code|\bid\b|gruppe)/.test(h)) return "p";
  if(/(garverlust|\bloss\b)/.test(h)) return "g";
  return null;
}
function _salesAutoMap(header){
  const idx = {};
  for(let i=0;i<header.length;i++){ const f=_salesFieldOf(header[i]); if(f && idx[f]==null) idx[f]=i; }
  return idx;
}

// Build aggregated {d,p,k,m,u,wa,g} rows from a column mapping (idx: field->col).
function _salesBuildRows(lines, delim, idx){
  const get = (c,f) => idx[f]!=null ? c[idx[f]] : "";
  const map = new Map(); let dropped = 0;
  for(let li=1; li<lines.length; li++){
    const c = _sSplit(lines[li], delim);
    const d = String(get(c,"d")||"").trim().slice(0,10);
    const p = String(get(c,"p")||"").replace(/^"|"$/g,"").trim();
    const m = _sNum(get(c,"m"));
    if(!/^\d{4}-\d{2}-\d{2}$/.test(d) || !p || m<=0){ dropped++; continue; }
    const key = d+"|"+p;
    const row = { d, p, k:String(get(c,"k")||"").trim(), m, u:_sNum(get(c,"u")), wa:Math.abs(_sNum(get(c,"wa"))), g:_sNum(get(c,"g")) };
    const e = map.get(key);
    if(e){ e.m+=row.m; e.u+=row.u; e.wa+=row.wa; e.g+=row.g; }   // sum duplicate lines within the same file
    else map.set(key, row);
  }
  const rows = [...map.values()], warnings = [];
  if(dropped) warnings.push(dropped.toLocaleString()+" line(s) skipped (bad date/name or qty ≤ 0).");
  const dates = rows.map(r=>r.d);
  return { rows, warnings, dropped, dateRange: rows.length ? [dates.reduce((a,b)=>b<a?b:a), dates.reduce((a,b)=>b>a?b:a)] : [null,null] };
}

// Parse a CSV into a re-mappable result. Columns are auto-detected by header
// NAME (robust to reordering/variants); the preview lets you override any
// column by hand. Returns lines/header/idx so the mapping can be changed later.
function parseSalesCsv(text){
  const lines = text.replace(/\r/g,"").split("\n").filter(l => l.trim().length);
  if(lines.length < 2) return { ok:false, error:"File has no data rows.", header:null };
  const commas=(lines[0].match(/,/g)||[]).length, semis=(lines[0].match(/;/g)||[]).length, tabs=(lines[0].match(/\t/g)||[]).length;
  const delim = (tabs>commas && tabs>semis) ? "\t" : (semis>commas ? ";" : ",");
  const header = _sSplit(lines[0], delim).map(_sNormHeader);

  const idx = _salesAutoMap(header);
  let strategy = "header names";
  if(idx.d==null || idx.p==null || idx.m==null || idx.u==null){
    // Fill any gaps from the legacy Vectron fixed layout so a positional export
    // still works — the user can correct any wrong column in the preview.
    strategy = "auto + Vectron fallback";
    const pos = { d:0, p:3, k:2, m:4, u:5, wa:8, g:11 };
    for(const f of Object.keys(pos)) if(idx[f]==null && pos[f] < header.length) idx[f]=pos[f];
  }
  const built = _salesBuildRows(lines, delim, idx);
  const res = { ok: built.rows.length>0, lines, delim, header, idx, strategy,
    rows: built.rows, totalRows: built.rows.length, sample: built.rows.slice(0,10),
    dateRange: built.dateRange, _buildWarnings: built.warnings };
  if(!res.ok) res.error = "No valid rows — set the correct Date / Product / Qty / Revenue columns below.";
  return res;
}

// Re-map one field to a column (from the preview dropdowns) and rebuild live.
function _salesRemap(field, val){
  if(!_salesParsed || !_salesParsed.lines) return;
  const col = (val==="" || val==null) ? null : parseInt(val,10);
  _salesParsed.idx = Object.assign({}, _salesParsed.idx, { [field]: (isNaN(col)?null:col) });
  const built = _salesBuildRows(_salesParsed.lines, _salesParsed.delim, _salesParsed.idx);
  _salesParsed.rows = built.rows;
  _salesParsed.totalRows = built.rows.length;
  _salesParsed.sample = built.rows.slice(0,10);
  _salesParsed.dateRange = built.dateRange;
  _salesParsed._buildWarnings = built.warnings;
  _salesParsed.ok = built.rows.length>0;
  _salesParsed.strategy = "manual mapping";
  renderSalesPreview(_salesParsed);
  const msg = document.getElementById("sales-import-msg");
  if(msg){
    if(_salesParsed.ok){ msg.style.color="var(--muted)"; msg.textContent = `✓ ${_salesParsed.totalRows.toLocaleString()} rows mapped — review and tap Import ↑`; }
    else { msg.style.color="var(--red)"; msg.textContent = "⚠ No valid rows with this mapping — pick the correct columns."; }
  }
}

function renderSalesPreview(res){
  const el = document.getElementById("sales-import-preview");
  if(!el) return;
  if(!res || !res.header){ el.style.display="none"; el.innerHTML=""; return; }
  const labels = { d:"Date", p:"Product", k:"Category", m:"Qty", u:"Revenue", wa:"WA" };
  const header = res.header || [];
  const requiredMissing = (res.idx.d==null || res.idx.p==null || res.idx.m==null || res.idx.u==null);

  let html = `<div style="font-size:11px;color:var(--muted);margin-bottom:6px">Column mapping · <b>${_sEsc(res.strategy||"")}</b> · delimiter "<b>${res.delim==="\t"?"tab":_sEsc(res.delim||",")}</b>" — change any column that's wrong:</div>`;
  html += `<div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:8px">`;
  for(const f of Object.keys(labels)){
    const opts = [`<option value="">— none —</option>`].concat(
      header.map((h,i)=>`<option value="${i}"${res.idx[f]===i?" selected":""}>${_sEsc(h||("col "+i))}</option>`)
    ).join("");
    html += `<label style="font-size:10px;color:var(--muted);display:flex;flex-direction:column;gap:2px">${labels[f]}`
      + `<select data-salesfield="${f}" style="font-size:11px;padding:3px 6px;background:var(--surface2);color:var(--text);border:1px solid var(--border2);border-radius:5px;max-width:160px">${opts}</select></label>`;
  }
  html += `</div>`;
  if(requiredMissing) html += `<div style="font-size:11px;color:var(--amber);margin-bottom:4px">⚠ Set Date, Product, Qty and Revenue to import.</div>`;
  (res._buildWarnings||[]).forEach(w => html += `<div style="font-size:11px;color:var(--amber);margin-bottom:4px">⚠ ${_sEsc(w)}</div>`);

  if(res.ok && res.sample && res.sample.length){
    html += `<div style="font-size:11px;color:var(--text);margin-bottom:6px">${res.totalRows.toLocaleString()} unique rows · ${_sEsc(res.dateRange[0])} → ${_sEsc(res.dateRange[1])}</div>`;
    const cols = ["d","p","k","m","u","wa"];
    const th = cols.map(f=>`<th style="text-align:left;padding:4px 8px;border-bottom:1px solid var(--border2);font-weight:600">${labels[f]}</th>`).join("");
    const tb = res.sample.map(r=>`<tr>${cols.map(f=>`<td style="padding:3px 8px;border-bottom:1px solid var(--border)">${_sEsc(r[f])}</td>`).join("")}</tr>`).join("");
    html += `<div style="overflow-x:auto"><table style="border-collapse:collapse;font-size:11px;width:100%"><thead><tr>${th}</tr></thead><tbody>${tb}</tbody></table></div>`
      + `<div style="font-size:10px;color:var(--muted);margin-top:4px">Preview of first ${res.sample.length} rows. Check Product / Qty / Revenue look right, then tap Import.</div>`;
  } else {
    html += `<div style="font-size:11px;color:var(--red)">No valid rows with the current mapping — pick the correct columns above.</div>`;
  }
  el.innerHTML = html;
  el.style.display = "block";
  el.querySelectorAll("select[data-salesfield]").forEach(s =>
    s.addEventListener("change", () => _salesRemap(s.getAttribute("data-salesfield"), s.value))
  );
}

async function handleSalesCsvPick(input) {
  const msg   = document.getElementById("sales-import-msg");
  const label = document.getElementById("sales-file-label");
  _salesParsed = null;
  renderSalesPreview(null);
  const file  = input.files && input.files[0];
  if (!file) { if (msg) msg.textContent = "No file selected"; return; }
  if (msg) { msg.style.color = "var(--muted)"; msg.textContent = "⏳ Reading…"; }
  try {
    const buffer = await file.arrayBuffer();
    const bytes  = new Uint8Array(buffer);
    const start  = (bytes[0]===0xEF && bytes[1]===0xBB && bytes[2]===0xBF) ? 3 : 0;
    const text   = new TextDecoder("utf-8").decode(bytes.slice(start));
    const res    = parseSalesCsv(text);
    res.fileName = file.name;
    _salesParsed = res;                 // set even when not ok, so the mapping dropdowns work
    renderSalesPreview(res);
    if (label) label.textContent = res.ok ? `${file.name} · ${res.totalRows.toLocaleString()} rows` : file.name;
    if (!res.ok) {
      if (msg) { msg.style.color = "var(--red)"; msg.textContent = "⚠ " + (res.error || "Adjust the column mapping below.") + (res.header ? " Use the dropdowns to pick the right columns." : ""); }
      return;
    }
    if (msg) { msg.style.color = "var(--muted)"; msg.textContent = `✓ Parsed ${res.totalRows.toLocaleString()} rows — review the mapping/preview, then tap Import ↑`; }
  } catch(e) {
    _salesParsed = null;
    renderSalesPreview(null);
    if (msg) { msg.style.color = "var(--red)"; msg.textContent = `⚠ Error: ${e.message}`; }
    if (label) label.textContent = "Choose CSV file…";
  }
}

// Exact DB row count for a set of dates, read from the SAME store the Sales
// page reads — via the count header (cheap, no full fetch). Used to VERIFY an
// import actually landed, so "imported OK" can never hide a silent failure.
async function _salesRowCount(dates){
  if(!dates || !dates.length) return null;
  try{
    const h = Object.assign({}, _sbH, { Prefer: "count=exact", Range: "0-0" });
    const res = await fetch(SB_URL + "/rest/v1/sales_history?select=id&sale_date=in.(" + dates.join(",") + ")", { headers: h });
    const total = parseInt(((res.headers.get("content-range") || "").split("/")[1] || "0"), 10);
    return isNaN(total) ? null : total;
  } catch(e){ return null; }
}

async function runSalesImport() {
  const msg = document.getElementById("sales-import-msg");
  if (!_salesParsed || !_salesParsed.rows || !_salesParsed.rows.length) {
    if (msg) { msg.style.color = "var(--red)"; msg.textContent = "Choose a CSV file first — and check the preview."; }
    return;
  }
  const rows = _salesParsed.rows;   // already header-mapped, validated and deduped
  const importDates  = [...new Set(rows.map(r => r.d))];   // captured for the post-import read-back
  const expectedPairs = rows.length;
  const fileName  = _salesParsed.fileName || null;
  const dateRange = _salesParsed.dateRange || [null, null];

  // A batch of writes with no valid token would just 401 on every chunk — check
  // up front and send the user to re-enter their PIN instead of firing dozens of
  // failing calls (this was the "N chunks failed, 0 rows landed" symptom).
  if (!gwTokenValid()) {
    if (msg) { msg.style.color = "var(--red)"; msg.textContent = "⚠ Your session has expired — re-enter your Admin PIN, then tap Import again."; }
    try { if (typeof requestAdminAccess === "function") requestAdminAccess(); } catch(e){}
    return;
  }
  if (msg) { msg.style.color = "var(--muted)"; msg.textContent = `⏳ Sending ${rows.length.toLocaleString()} rows…`; }

  try {
    // Gateway is a POST endpoint (no URL-length limit), so use larger chunks.
    // Rows are globally unique by (date|product) after parsing, so parallel
    // chunks never touch the same pair — no duplicate-insert race.
    const CHUNK  = 200;
    const chunks = [];
    for (let i = 0; i < rows.length; i += CHUNK) chunks.push(rows.slice(i, i + CHUNK));

    let totalImported = 0, totalReplaced = 0, totalSkipped = 0, lastErr = "";
    const failed = [];
    const PARALLEL = 6;
    for (let i = 0; i < chunks.length; i += PARALLEL) {
      const batch = chunks.slice(i, i + PARALLEL);
      if (msg) msg.textContent = `⏳ Uploading… ${Math.round((i / chunks.length) * 100)}%`;
      const results = await Promise.all(batch.map(chunk =>
        gwWrite("importSales", { rows: chunk }).then(r => ({ ok:true, r })).catch(e => { lastErr = String((e && e.message) || e); return { ok:false, chunk }; })
      ));
      results.forEach(res => {
        if (res.ok) { totalImported += res.r.imported||0; totalReplaced += res.r.replaced||0; totalSkipped += res.r.skipped||0; }
        else failed.push(res.chunk);
      });
    }

    // Auto-retry failed chunks once — a transient blip mid-import shouldn't
    // leave a partial result. (Import is idempotent, so retrying is safe.)
    let errors = 0;
    if (failed.length) {
      if (msg) msg.textContent = `⏳ Retrying ${failed.length} chunk(s)…`;
      for (const chunk of failed) {
        try { const r = await gwWrite("importSales", { rows: chunk }); totalImported += r.imported||0; totalReplaced += r.replaced||0; totalSkipped += r.skipped||0; }
        catch(e){ errors++; lastErr = String((e && e.message) || e); }
      }
    }

    if (msg) msg.textContent = `⏳ ${totalImported.toLocaleString()} sent — verifying…`;
    _salesParsed = null;
    renderSalesPreview(null);
    salesData = { products:[], days:[], totalDays:0 };
    await loadSalesAnalysis();

    // Read the imported dates straight back from the DB and prove the data is
    // there. This is what stops "imported OK" but the page shows nothing.
    const actual = await _salesRowCount(importDates);
    const authIssue = /unauthor|\b401\b/i.test(lastErr) || !gwTokenValid();
    if (msg) {
      if (errors && authIssue) {
        msg.style.color = "var(--red)";
        msg.textContent = "⚠ Session expired mid-import — re-enter your Admin PIN and tap Import again. Re-importing is safe (it replaces, never doubles).";
        try { if (typeof requestAdminAccess === "function") requestAdminAccess(); } catch(e){}
      } else if (errors && actual === 0) {
        msg.style.color = "var(--red)";
        msg.textContent = `⚠ Import failed — ${errors} chunk(s) failed after retry and 0 rows landed. Nothing saved.`;
      } else if (actual === 0) {
        msg.style.color = "var(--red)";
        msg.textContent = `⚠ Reported ${totalImported.toLocaleString()} imported but 0 rows found for these dates — the data did NOT land. Check the column mapping in the preview.`;
      } else if (actual !== null) {
        msg.style.color = errors ? "var(--amber)" : "var(--green)";
        msg.textContent = `✓ Verified: ${actual.toLocaleString()} rows across ${importDates.length} date(s) in the database (${expectedPairs.toLocaleString()} imported${errors ? ", " + errors + " chunk(s) still failed" : ""}).`;
      } else {
        msg.style.color = errors ? "var(--amber)" : "var(--green)";
        msg.textContent = `✓ ${totalImported.toLocaleString()} imported${errors ? " · " + errors + " chunk error(s)" : ""} — refreshed (read-back unavailable).`;
      }
    }

    // Audit log — fire-and-forget so the UI never blocks on it.
    gwWrite("logImport", {
      source: "file", fileName,
      dateFrom: dateRange[0] || null, dateTo: dateRange[1] || null,
      rowsSent: expectedPairs, rowsInserted: totalImported, rowsReplaced: totalReplaced, chunkErrors: errors
    }).catch(() => {});
  } catch(e) {
    if (msg) { msg.style.color = "var(--red)"; msg.textContent = "Error: " + e.message; }
  }
}

async function importFromDriveUrl() {
  const msg      = document.getElementById("sales-import-msg");
  const urlInput = document.getElementById("sales-drive-url");
  const raw      = (urlInput?.value || "").trim();
  if (!raw) { if (msg) msg.textContent = "Paste a Google Drive link or file ID first."; return; }
  let fileId     = raw;
  const m1       = raw.match(/\/d\/([a-zA-Z0-9_-]{10,})/);
  const m2       = raw.match(/id=([a-zA-Z0-9_-]{10,})/);
  if (m1) fileId = m1[1]; else if (m2) fileId = m2[1];
  if (msg) { msg.style.color = "var(--muted)"; msg.textContent = "⏳ Fetching CSV from Drive…"; }
  _salesParsed = null; renderSalesPreview(null);
  try {
    // GAS fetches the file server-side (the browser can't fetch Drive — CORS)
    // and returns the RAW text; it is then parsed, previewed and imported via
    // the SAME header-based pipeline as file upload, so Drive lands in Supabase
    // (not the old Google Sheet). Requires the fetchDriveCsv action in code.gs.
    const data = await get({ action: "fetchDriveCsv", fileId });
    const csv  = data && typeof data.csv === "string" ? data.csv : null;
    if (!csv) {
      if (data && data.error) throw new Error(data.error);
      throw new Error("Drive fetch needs the code.gs 'fetchDriveCsv' patch (see SALES-IMPORT-DRIVE-PATCH.md). Use file upload for now.");
    }
    const res = parseSalesCsv(csv);
    renderSalesPreview(res);
    if (!res.ok) { if (msg) { msg.style.color = "var(--red)"; msg.textContent = "⚠ " + res.error; } return; }
    _salesParsed = res;
    _salesParsed.fileName = "Drive:" + fileId;
    if (msg) { msg.style.color = "var(--muted)"; msg.textContent = `✓ Fetched ${res.totalRows.toLocaleString()} rows — review the preview, then tap Import ↑`; }
  } catch(e) {
    if (msg) { msg.style.color = "var(--red)"; msg.textContent = "Error: " + e.message; }
  }
}
