// Kitchen MEP — PDF recipe import (single-file) — feature module, classic script.
// Extracted from dashboard.html (monolith->modules restructure). Event-driven; all
// entry points are inline onclick/onchange handlers (startPdfImport, confirmPdfImport,
// cancelPdfImport, pdfCodeInput, ...) so these functions must stay global.
// Shared PDF state (pdfParsedIngredients, pdfTargetMepCode, _pdfMenuId, _pdfSelectedFile,
// window._pdfMode) stays INLINE in dashboard.html because it is also used by the batch
// importer and the PDF quick-add; classic-script top-level lets are shared via the global
// lexical environment. Also reads shared globals get/adminCall/allProducts/allMenus/allGRs.

function populatePdfMepDatalist() {
  const dl = document.getElementById("dl-pdf-mep");
  if (!dl) return;
  dl.innerHTML = Object.entries(allProducts)
    .filter(([,p]) => p.name && p.name !== "(deleted)")
    .sort((a,b) => (a[1].name||"").localeCompare(b[1].name||""))
    .map(([code,p]) => `<option value="${code}">${p.name}</option>`)
    .join("");
}

async function startPdfImport(mode) {
  mode = mode || 'recipes';
  const menuCode = document.getElementById("pdf-mep-code").value.trim();
  const fileEl   = document.getElementById("pdf-file-input");
  const btnR     = document.getElementById("pdf-import-btn-recipes");
  const btnM     = document.getElementById("pdf-import-btn-menu");

  if (!menuCode) { adminMsg("pdf-msg","Enter Menu Code","err"); return; }
  const file = _pdfSelectedFile || fileEl.files[0];
  if (!file) { adminMsg("pdf-msg","Select a PDF file","err"); return; }

  if (btnR) btnR.disabled = true;
  if (btnM) btnM.disabled = true;
  adminMsg("pdf-msg","Reading PDF…","");

  const [codesData, itemsData] = await Promise.all([
    adminCall({ action: "getAllCodes" }).catch(() => ({})),
    adminCall({ action: "getAllItemsForMatching" }).catch(() => ({}))
  ]);
  _allRmCodes  = codesData.rmCodes  || [];
  _allMepCodes = codesData.mepCodes || [];
  _allGrCodes  = codesData.grCodes  || [];
  _nextRM      = codesData.nextRM   || "RM-001";
  _nextMEP     = codesData.nextMEP  || "P-001";
  _nextGR      = codesData.nextGR   || "GR-001";
  _systemItems = itemsData.items    || [];

  try {
    const arrayBuf = await (file.arrayBuffer
      ? file.arrayBuffer()
      : new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsArrayBuffer(file); }));
    if (!arrayBuf.byteLength) throw new Error("File is empty or could not be read — try downloading the PDF to your device first");
    const pdfText  = await extractPdfText(arrayBuf);

    let ingredients = [];

    if (pdfText.startsWith("__VISION__")) {
      adminMsg("pdf-msg", "Uploading image to Claude Vision…", "");
      const imageData  = pdfText.replace("__VISION__", "");
      const CHUNK_SIZE = 5000;
      const sessionId  = "pdf_" + Date.now();
      const total      = Math.ceil(imageData.length / CHUNK_SIZE);

      for (let i = 0; i < total; i++) {
        const chunk = imageData.substring(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
        adminMsg("pdf-msg", `Uploading… ${i + 1}/${total}`, "");
        const r = await adminCall({ action: "storeChunk", sessionId, chunk, idx: i, total });
        if (r.error) throw new Error("Chunk upload failed: " + r.error);
      }

adminMsg("pdf-msg", "Analyzing with Claude Vision…", "");
      const visionData = await adminCall({ action: "parsePdfVisionChunked", sessionId });
      if (visionData.error) throw new Error(visionData.error);
      ingredients = visionData.ingredients || [];
      // Store menuInfo for pre-filling fields
      window._pdfMenuInfo = visionData.menuInfo || {};

    } else {
      if (!pdfText || pdfText.trim().length < 20)
        throw new Error("Could not extract text from PDF.");
      adminMsg("pdf-msg", "Sending to AI…", "");
      const action = mode === 'menu' ? "parseMenuPdf" : "parseRecipePdf";
      const data   = await adminCall({
        action, menuCode, mepCode: menuCode,
        pdfText: pdfText.substring(0, 8000)
      });
      if (data.error) throw new Error(data.error);
      if (data.menuId) _pdfMenuId = data.menuId;
      ingredients = mode === 'menu'
        ? (data.parsed?.ingredients || [])
        : (data.ingredients || []);
    }

    pdfParsedIngredients = ingredients;
    pdfTargetMepCode = menuCode;
    window._pdfMode  = mode;

    if (!pdfParsedIngredients.length) throw new Error("AI returned no ingredients");

    pdfParsedIngredients = pdfParsedIngredients.map(ing => ({
      ...ing,
      type : ing.type || "RM",
      code : ing.code || ""
    }));
    _autoMatchIngredients();
    // Pre-fill menu info fields from parsed data
    const mi = window._pdfMenuInfo || {};
    const nameEl = document.getElementById('pdf-menu-name');
    const catEl  = document.getElementById('pdf-menu-category');
    const artEl  = document.getElementById('pdf-menu-art');
    const vkEl   = document.getElementById('pdf-menu-vk');
    if (nameEl) nameEl.value = mi.name     || menuCode;
    if (catEl)  catEl.value  = mi.category || '';
    if (artEl)  artEl.value  = mi.art      || (mode === 'menu' ? 'Hauptgang' : 'MEP');
    if (vkEl)   vkEl.value   = mi.verkaufspreis || '';
    renderPdfPreview(mode, null);

    const saveBtn = document.querySelector("#pdf-preview .btn-save");
    if (saveBtn) saveBtn.style.display = "";

    adminMsg("pdf-msg",
      `✓ Found ${pdfParsedIngredients.length} ingredients — set type & code, then save`, "ok");

  } catch(err) {
    adminMsg("pdf-msg","Error: "+err.message,"err");
  } finally {
    if (btnR) btnR.disabled = false;
    if (btnM) btnM.disabled = false;
  }
}

async function extractPdfText(arrayBuffer) {
  // Load PDF.js — try multiple CDNs for Android reliability
  if (!window.pdfjsLib) {
    const srcs = [
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js",
      "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js",
      "https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.min.js"
    ];
    for (const src of srcs) {
      try {
        await new Promise((res, rej) => {
          const s = document.createElement("script");
          s.src = src; s.onload = res; s.onerror = rej;
          document.head.appendChild(s);
        });
        if (window.pdfjsLib) break;
      } catch(e) { console.warn("PDF.js CDN failed:", src); }
    }
    if (!window.pdfjsLib) throw new Error("Could not load PDF.js");
    // ANDROID FIX: disable worker — avoids "file not found" on Android WebView
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = "";
  }

  // Render first page to canvas → base64 JPEG
  const pdf  = await pdfjsLib.getDocument({
    data: arrayBuffer,
    disableWorker: true,
    disableRange:  true,
    disableStream: true
  }).promise;
  const page     = await pdf.getPage(1);
  const viewport = page.getViewport({ scale: 1.0 });
  const canvas   = document.createElement("canvas");
  const scale    = Math.min(1.0, 720 / viewport.width);
  const vp2      = page.getViewport({ scale });
  canvas.width   = vp2.width;
  canvas.height  = vp2.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable — close other tabs and try again");
  await page.render({ canvasContext: ctx, viewport: vp2 }).promise;

  let base64 = canvas.toDataURL("image/jpeg", 0.35).split(",")[1];
  if (base64.length > 80000) {
    const ratio = Math.sqrt(70000 / base64.length);
    const c2 = document.createElement("canvas");
    c2.width  = Math.round(canvas.width  * ratio);
    c2.height = Math.round(canvas.height * ratio);
    const ctx2 = c2.getContext("2d");
    if (ctx2) {
      ctx2.drawImage(canvas, 0, 0, c2.width, c2.height);
      base64 = c2.toDataURL("image/jpeg", 0.35).split(",")[1];
    }
  }
return "__VISION__" + base64;
}

let _pdfRenderTimer = null;
document.addEventListener('click', function(e) {
  // PDF suggestion pills
  const pill = e.target.closest('.pdf-sug-pill');
  if (pill) { pdfSelectSuggestion(parseInt(pill.dataset.idx), pill.dataset.code, pill.dataset.type, pill.dataset.name); return; }
  // GR list buttons
  const editBtn = e.target.closest('.gr-edit-btn');
  if (editBtn) { openEditGRPopup(editBtn.dataset.code); return; }
  const delBtn = e.target.closest('.gr-del-btn');
  if (delBtn) { deleteGR(delBtn.dataset.code, delBtn.dataset.name); return; }
  // EPF RM picker rows
  const epfRow = e.target.closest('.epf-rm-pick-row');
  if (epfRow) { selectEpfRm(epfRow.dataset.code, epfRow.dataset.name, epfRow.dataset.unit); return; }
  // Ingredient picker rows (MEP/RM)
  const ingRow = e.target.closest('.ing-pick-row');
  if (ingRow) { selectIngredientItem(ingRow.dataset.code, ingRow.dataset.name, ingRow.dataset.unit, ingRow.dataset.cost, parseFloat(ingRow.dataset.netto)||0, parseFloat(ingRow.dataset.wa)||0); return; }
  // GR picker rows
  const grRow = e.target.closest('.gr-pick-row');
  if (grRow) { selectIngredientItem(grRow.dataset.code, grRow.dataset.name, grRow.dataset.unit, grRow.dataset.cost, parseFloat(grRow.dataset.netto)||0, parseFloat(grRow.dataset.wa)||0); return; }
});
function debouncedPdfPreview() {
  clearTimeout(_pdfRenderTimer);
  _pdfRenderTimer = setTimeout(() => renderPdfPreview(window._pdfMode), 400);
}
  
function renderPdfPreview(mode, parsedMenu) {
  const listEl  = document.getElementById("pdf-ingredient-list");
  const preview = document.getElementById("pdf-preview");
  if (!pdfParsedIngredients.length) { preview.style.display="none"; return; }

  const menuBanner = (mode === 'menu' && parsedMenu) ? `
    <div style="background:var(--green-dim);border:1px solid var(--green-brd);border-radius:var(--radius-sm);padding:12px;margin-bottom:12px">
      <div style="font-size:12px;font-weight:600;color:var(--green);margin-bottom:8px">📋 Menu Card will be created</div>
      <div style="font-size:11px;color:var(--text);display:grid;grid-template-columns:auto 1fr;gap:4px 12px">
        <span style="color:var(--muted)">Name:</span><span>${parsedMenu.name||"—"}</span>
        <span style="color:var(--muted)">Category:</span><span>${parsedMenu.category||"—"}</span>
        <span style="color:var(--muted)">Art:</span><span>${parsedMenu.art||"—"}</span>
        <span style="color:var(--muted)">Portion:</span><span>${parsedMenu.gewicht||"—"}</span>
        <span style="color:var(--muted)">Price:</span><span>${parsedMenu.vk?"CHF "+parsedMenu.vk:"—"}</span>
      </div>
    </div>` : "";

  const header = `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap">
      <div style="display:grid;grid-template-columns:70px 160px 1fr 80px 50px 100px 1fr 28px;gap:6px;align-items:center;padding:4px 8px;font-size:10px;letter-spacing:1px;text-transform:uppercase;color:var(--muted);flex:1">
        <span>Type</span><span>Code</span><span>Name</span><span>Qty</span><span>Unit</span><span>Allergen</span><span>Description</span><span></span>
      </div>
      <button onclick="pdfOpenQuickAdd()" style="padding:5px 12px;border-radius:8px;background:var(--blue-dim);color:var(--blue);border:1px solid var(--blue-brd);font-size:11px;font-weight:600;cursor:pointer;white-space:nowrap;font-family:var(--mono)">＋ Add missing item</button>
    </div>`;

  const rows = pdfParsedIngredients.map((ing, i) => {
    const type      = ing.type || "RM";
    const code      = ing.code || "";
    const isDup     = _isPdfCodeDuplicate(type, code);
    const isMatched = ing._matched === true;
    const suggested = _suggestPdfCode(type, i);
    const codeColor = isDup     ? "var(--red)"
                    : isMatched ? "var(--green)"
                    : code      ? "var(--amber)"
                    : "var(--border2)";
    const rowBorder = isDup     ? "var(--red-brd)"
                    : isMatched ? "var(--green-brd)"
                    : "var(--border)";
    const rowBg     = isMatched && !isDup
                    ? "rgba(93,202,138,0.05)" : "var(--surface2)";
    const dupWarn   = isDup
      ? `<div style="font-size:9px;color:var(--red);margin-top:2px">⚠ duplicate</div>` : "";
    const matchBadge = isMatched && !isDup
      ? `<div style="font-size:9px;color:var(--green);margin-top:2px">✓ ${ing._matchType==="exact"?"exact":"fuzzy"} match</div>` : "";
    const showSuggest = !isMatched && !code
      ? `<div style="font-size:9px;color:var(--muted);margin-top:2px">suggest: ${suggested}</div>` : "";

    // Build system suggestions for this ingredient name
    const ingNameLow = (ing.name || "").toLowerCase().trim();
    const suggestions = _systemItems.filter(item => {
      if (!ingNameLow || ingNameLow.length < 2) return false;
      const n = item.name.toLowerCase();
      return n.includes(ingNameLow) || ingNameLow.includes(n) ||
        ingNameLow.split(/\s+/).some(w => w.length > 2 && n.includes(w));
    }).slice(0, 5);

    const suggestHtml = suggestions.length ? `
      <div style="margin-top:3px;display:flex;flex-wrap:wrap;gap:3px">
        ${suggestions.map(s => {
          const safeCode = (s.code||'').replace(/"/g,'&quot;');
          const safeType = (s.type||'rm').toUpperCase().replace(/"/g,'&quot;');
          const safeName = (s.name||'').replace(/"/g,'&quot;');
          const bg = s.type==='mep'?'var(--amber-dim)':s.type==='gr'?'var(--green-dim)':'var(--blue-dim)';
          const cl = s.type==='mep'?'var(--amber)':s.type==='gr'?'var(--green)':'var(--blue)';
          const bd = s.type==='mep'?'var(--amber-brd)':s.type==='gr'?'var(--green-brd)':'var(--blue-brd)';
          const ic = s.type==='mep'?'🟡':s.type==='gr'?'🟢':'🔵';
          return `<span class="pdf-sug-pill" data-idx="${i}" data-code="${safeCode}" data-type="${safeType}" data-name="${safeName}"
            style="font-size:10px;padding:2px 7px;border-radius:10px;cursor:pointer;background:${bg};color:${cl};border:1px solid ${bd}">
            ${ic} ${s.name}
          </span>`;
        }).join('')}
      </div>` : '';

    return `
    <div style="display:grid;grid-template-columns:70px 160px 1fr 80px 50px 100px 1fr 28px;gap:6px;align-items:start;padding:6px 8px;background:${rowBg};border-radius:var(--radius-sm);border:1px solid ${rowBorder};margin-bottom:4px">

      <select style="background:var(--surface);color:var(--text);border:1px solid var(--border2);border-radius:var(--radius-sm);font-family:var(--mono);font-size:11px;padding:5px 4px;cursor:pointer;width:100%"
        onchange="pdfParsedIngredients[${i}].type=this.value;pdfParsedIngredients[${i}]._matched=false;applyPdfTypePrefix(${i});renderPdfPreview(window._pdfMode)">
        <option value="RM"  ${type==="RM" ?"selected":""}>RM</option>
        <option value="MEP" ${type==="MEP"?"selected":""}>MEP</option>
        <option value="GR"  ${type==="GR" ?"selected":""}>GR</option>
      </select>

      <div style="display:flex;flex-direction:column">
        <div style="display:flex;gap:3px;align-items:center">
          <input class="form-input" id="pdf-code-${i}" style="margin:0;padding:4px 6px;font-size:11px;border-color:${codeColor};flex:1;min-width:0"
            value="${code}"
            oninput="pdfCodeInput(${i},this.value)"
            placeholder="${suggested}">
          <button type="button" title="Use suggested code"
            data-idx="${i}" data-suggested="${suggested}" class="pdf-sug-code-btn"
            style="background:var(--amber-dim);color:var(--amber);border:1px solid var(--amber-brd);border-radius:var(--radius-sm);padding:3px 5px;cursor:pointer;font-size:10px;white-space:nowrap">★</button>
        </div>
        ${dupWarn}
        ${matchBadge}
        ${showSuggest}
      </div>

      <div style="display:flex;flex-direction:column;gap:2px">
        <input class="form-input" style="margin:0;padding:4px 6px;font-size:12px;min-width:0"
          value="${ing.name||""}"
          oninput="pdfParsedIngredients[${i}].name=this.value;debouncedPdfPreview()"
          placeholder="Name">
        ${suggestHtml}
      </div>

      <input class="form-input" style="margin:0;padding:4px 6px;font-size:12px;min-width:0;text-align:right"
        value="${ing.quantity||""}"
        oninput="pdfParsedIngredients[${i}].quantity=this.value"
        placeholder="0.000" type="number" step="0.001">

      <input class="form-input" style="margin:0;padding:4px 6px;font-size:12px;min-width:0"
        value="${ing.unit||""}"
        oninput="pdfParsedIngredients[${i}].unit=this.value"
        placeholder="Unit">

      <input class="form-input" style="margin:0;padding:4px 6px;font-size:11px;min-width:0"
        value="${ing.allergie||""}"
        oninput="pdfParsedIngredients[${i}].allergie=this.value"
        placeholder="Allergen">

      <input class="form-input" style="margin:0;padding:4px 6px;font-size:11px;min-width:0"
        value="${ing.description||""}"
        oninput="pdfParsedIngredients[${i}].description=this.value"
        placeholder="e.g. fein schneiden">

      <button type="button" data-idx="${i}" class="pdf-del-row-btn" style="background:var(--red-dim);color:var(--red);border:1px solid var(--red-brd);border-radius:var(--radius-sm);padding:4px 6px;cursor:pointer;font-size:13px">✕</button>
    </div>`;
  }).join("");

  // Duplicate summary warning
  const dupCount = pdfParsedIngredients.filter(ing => _isPdfCodeDuplicate(ing.type||"RM", ing.code||"")).length;
  const dupAlert = dupCount > 0
    ? `<div style="background:var(--red-dim);border:1px solid var(--red-brd);border-radius:var(--radius-sm);padding:8px 12px;font-size:11px;color:var(--red);margin-bottom:10px">
        ⚠ ${dupCount} duplicate code${dupCount>1?"s":""} — fix before saving
       </div>` : "";

  listEl.innerHTML = menuBanner + dupAlert + header + rows;
  listEl.querySelectorAll('.pdf-sug-code-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.idx);
      const sug = btn.dataset.suggested;
      pdfParsedIngredients[idx].code = sug;
      pdfParsedIngredients[idx]._matched = false;
      const inp = document.getElementById('pdf-code-' + idx);
      if (inp) { inp.value = sug; inp.style.borderColor = 'var(--amber)'; }
    });
  });
  listEl.querySelectorAll('.pdf-del-row-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      pdfParsedIngredients.splice(parseInt(btn.dataset.idx), 1);
      renderPdfPreview(window._pdfMode);
    });
  });
  preview.style.display = "block";
}

function _suggestPdfCode(type, idx) {
  const usedInPreview = pdfParsedIngredients
    .map((ing, i) => i !== idx ? (ing.code||"") : "")
    .filter(Boolean);

  function nextAvailable(prefix, existingSystem) {
    const allUsed = [...existingSystem, ...usedInPreview];
    // Find lowest gap starting from 1
    for (let n = 1; n <= 999; n++) {
      const candidate = prefix + String(n).padStart(3, "0");
      if (!allUsed.includes(candidate)) return candidate;
    }
    return prefix + "001";
  }

  if (type === "MEP") return nextAvailable("P-",   _allMepCodes);
  if (type === "GR")  return nextAvailable("GR-",  _allGrCodes);
  return                     nextAvailable("RM-",  _allRmCodes);
}

function _isPdfCodeDuplicate(type, code) {
  if (!code) return false;

  // Sync live input values into data before checking
  pdfParsedIngredients.forEach((ing, idx) => {
    const el = document.getElementById("pdf-code-" + idx);
    if (el) ing.code = el.value;
  });

  const idx = pdfParsedIngredients.findIndex(ing => (ing.code||"") === code);
  const ing = pdfParsedIngredients[idx];
  if (ing && ing._matched) return false;

  // Only flag system duplicate if this is a truly new code (not editing to match existing)
  const liveEl = document.getElementById("pdf-code-" + idx);
  const liveVal = liveEl ? liveEl.value : code;
  if (liveVal !== code) return false;

  if (type === "MEP" && _allMepCodes.includes(code)) return true;
  if (type === "GR"  && _allGrCodes.includes(code))  return true;
  if (type === "RM"  && _allRmCodes.includes(code))  return true;

  const count = pdfParsedIngredients.filter(ing => (ing.code||"") === code).length;
  return count > 1;
}
  async function pdfSelectSuggestion(i, code, type, name) {
  const ing = pdfParsedIngredients[i];
  if (!ing) return;

  // Only warn if same NEW code is used by another unmatched row
  const dupInPreview = pdfParsedIngredients.some((x, idx) => idx !== i && !x._matched && x.code === code);
  if (dupInPreview) {
    if (!confirm(`Code "${code}" already used by another row.\nClick OK to use anyway.`)) return;
  }

  // System codes are valid links — mark matched so dup checker ignores them
  ing.code       = code;
  ing.type       = type.toUpperCase();
  ing.name       = name;
  ing._matched   = true;
  ing._matchType = 'manual';

  // ✅ Update the visible code input immediately
  const el = document.getElementById('pdf-code-' + i);
  if (el) { el.value = code; el.style.borderColor = 'var(--green)'; }
  // Update name input too
  const nameInputs = document.querySelectorAll('#pdf-ingredient-list input[placeholder="Name"]');
  if (nameInputs[i]) nameInputs[i].value = name;

  renderPdfPreview(window._pdfMode);
}
  
function pdfCodeInput(i, val) {
  pdfParsedIngredients[i].code = val;
  pdfParsedIngredients[i]._matched = false;
  // Live border feedback — green=links existing, red=new dup, amber=new code
  const el = document.getElementById('pdf-code-' + i);
  if (!el) return;
  const type = (pdfParsedIngredients[i].type || 'RM').toUpperCase();
  const existsInSystem =
    (type === 'RM'  && _allRmCodes.includes(val))  ||
    (type === 'MEP' && _allMepCodes.includes(val)) ||
    (type === 'GR'  && _allGrCodes.includes(val));
  const dupInList = val && pdfParsedIngredients.filter((x,idx)=>idx!==i&&!x._matched&&x.code===val).length > 0;
  if (existsInSystem) {
    el.style.borderColor = 'var(--green)';
    pdfParsedIngredients[i]._matched = true; // links to existing — not a dup
  } else if (dupInList) {
    el.style.borderColor = 'var(--red)';
  } else {
    el.style.borderColor = val ? 'var(--amber)' : '';
  }
}

function pdfTypePrefix(type) {
  if (type === "MEP") return "P-";
  if (type === "GR")  return "GR-";
  return "RM-";
}

function applyPdfTypePrefix(i) {
  const ing    = pdfParsedIngredients[i];
  const prefix = pdfTypePrefix(ing.type || "RM");
  const cur    = ing.code || "";
  // Strip any existing prefix then apply new one (handles P-, RM-, GR-, MEP-)
  const stripped = cur.replace(/^(MEP-?|RM-?|GR-?|P-?)/i, "").replace(/^\D+/, "");
  const newCode  = stripped ? prefix + stripped : _suggestPdfCode(ing.type || "RM", i);
  ing.code       = newCode;
  ing._matched   = false;
  const el = document.getElementById("pdf-code-" + i);
  if (el) {
    el.value = newCode;
    el.focus();
    // Move cursor to end
    el.setSelectionRange(newCode.length, newCode.length);
  }
}
function _autoSuggestCode(idx) {
  // Auto-fill code when type changes and code is empty
  if (!pdfParsedIngredients[idx].code) {
    pdfParsedIngredients[idx].code = _suggestPdfCode(pdfParsedIngredients[idx].type || "RM", idx);
  }
}

function _findSystemMatch(ingredientName) {
  if (!ingredientName || !_systemItems.length) return null;
  const search = ingredientName.toLowerCase().trim();

  // 1. Exact match
  const exact = _systemItems.find(item => item.name === search);
  if (exact) return { ...exact, matchType: "exact" };

  // 2. Contains match (system name contains search or vice versa)
  const contains = _systemItems.find(item =>
    item.name.includes(search) || search.includes(item.name)
  );
  if (contains) return { ...contains, matchType: "contains" };

  // 3. Word overlap — at least 2 words match
  const searchWords = search.split(/\s+/).filter(w => w.length > 2);
  const wordMatch = _systemItems.find(item => {
    const itemWords = item.name.split(/\s+/).filter(w => w.length > 2);
    const overlap = searchWords.filter(w => itemWords.some(iw => iw.includes(w) || w.includes(iw)));
    return overlap.length >= Math.min(2, searchWords.length);
  });
  if (wordMatch) return { ...wordMatch, matchType: "word" };

  return null;
}

function _autoMatchIngredients() {
  pdfParsedIngredients = pdfParsedIngredients.map(function(ing, i) {
    if (ing.code) return ing; // already has a code — don't override
    const match = _findSystemMatch(ing.name);
    if (match) {
      return {
        ...ing,
        code      : match.code,
        type      : match.type.toUpperCase(),
        _matched  : true,
        _matchType: match.matchType
      };
    }
    return { ...ing, _matched: false };
  });
}
  

function _updatePdfRowStyle(sel, i) {
  // Optional: could color-code rows by type
}

async function confirmPdfImport() {
  if (!pdfParsedIngredients.length || !pdfTargetMepCode) return;

  const dups = pdfParsedIngredients.filter(ing =>
    !ing._matched && _isPdfCodeDuplicate(ing.type||"RM", ing.code||"")
  );
  if (dups.length) {
    adminMsg("pdf-msg", `⚠ Fix ${dups.length} duplicate code${dups.length>1?"s":""} before saving`, "err");
    return;
  }
  const missing = pdfParsedIngredients.filter(ing => !ing.code && !ing._matched);
  if (missing.length) {
    adminMsg("pdf-msg", `⚠ ${missing.length} ingredient${missing.length>1?"s":""} missing code`, "err");
    return;
  }

  const btn = document.querySelector("#pdf-preview .btn-save");
  if (btn) { btn.disabled=true; btn.textContent="Saving…"; }

  try {
    const mode = window._pdfMode || 'recipes';

    // Build zutaten array — resolve cost + unitCost from live inventory/GRs/products
    const rawZutaten = pdfParsedIngredients.map(ing => ({
      type     : (ing.type || "rm").toLowerCase(),
      code     : ing.code  || "",
      name     : ing.name  || "",
      gewicht  : parseFloat(ing.quantity) || "",
      unit     : ing.unit  || "",
      allergie : ing.allergie || "",
      cost     : parseFloat(ing.warenaufwand) || 0
    }));
    const { enriched: zutaten, waTotal: computedWa } = _enrichZutaten(rawZutaten);

    // Build full zubereitung from parsed PDF + allergen declaration
    const mi = window._pdfMenuInfo || {};
    const allergens = pdfParsedIngredients.map(ing => ing.allergie).filter(Boolean).join(", ");
    const allergenLine = (mi.deklaration || allergens) ? `\n\nAllergen: ${mi.deklaration || allergens}` : "";
    const warentraegerLine = mi.warentraeger ? `Warenträger: ${mi.warentraeger}` : "";
    const specLine = mi.produktspezifikation ? `\n\nProdukte Spezifikation:\n${mi.produktspezifikation}` : "";
    const naehrLine = mi.naehrwerte ? `\n\nNährwerte: ${mi.naehrwerte}` : "";
    const zubereitungLine = [mi.zubereitung || "", warentraegerLine, allergenLine, specLine, naehrLine]
      .filter(Boolean).join("\n");

    // ── Read user-editable meta fields ──
    const pdfMenuName = (document.getElementById('pdf-menu-name')?.value || '').trim() || pdfTargetMepCode;
    const pdfMenuCat  = (document.getElementById('pdf-menu-category')?.value || '').trim();
    const pdfMenuArt  = document.getElementById('pdf-menu-art')?.value || (mode === 'menu' ? 'Hauptgang' : 'MEP');
    const pdfMenuVk   = document.getElementById('pdf-menu-vk')?.value || '';

    // ── Save as a Menu entry (Menus sheet) so it appears in Recipes tab ──
    const menuPayload = {
      action      : "saveMenu",
      menuId      : "",
      name        : pdfMenuName,
      menuCode    : pdfTargetMepCode,
      category    : pdfMenuCat,
      art         : pdfMenuArt,
      saison      : "All Year",
      zutaten     : JSON.stringify(_slimZutaten(zutaten)),
      zubereitung : zubereitungLine,
      wa          : computedWa || mi.warenaufwand || "",
      vk          : pdfMenuVk || mi.verkaufspreis || "",
      gewicht     : mi.gewicht || "",
      lastUpdate  : new Date().toISOString()
    };

    const saved = await adminCall(menuPayload);
    if (saved.error) throw new Error(saved.error);

    // Also save new RM/MEP/GR items that don't exist yet in system
    // De-duplicate by code to prevent double-saves when AI returns same code twice
    const seen = new Set();
    const toSave = pdfParsedIngredients.filter(ing => {
      if (ing._matched) return false;
      const key = (ing.type||'rm').toLowerCase() + ':' + (ing.code||'');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // GR items must go via saveGR action (importParsedRecipe only handles RM/MEP)
    const grItems  = toSave.filter(ing => (ing.type||'').toLowerCase() === 'gr' && ing.code);
    const rmItems  = toSave.filter(ing => (ing.type||'').toLowerCase() !== 'gr');

    for (const ing of grItems) {
      try {
        await adminCall({ action:'saveGR', grCode:ing.code, name:ing.name||ing.code, art:'Grundrezeptur', zutaten:'[]' });
        _allGrCodes = [...(_allGrCodes||[]), ing.code];
        if (window.allGRs) window.allGRs.push({ grCode:ing.code, name:ing.name||ing.code, art:'Grundrezeptur', zutaten:'[]', wa:0 });
      } catch(e) { console.warn('saveGR failed for', ing.code, e); }
    }

    if (rmItems.length) {
      const data = await adminCall({
        action      : "importParsedRecipe",
        mepCode     : pdfTargetMepCode,
        ingredients : JSON.stringify(rmItems)
      });
      if (data.error) console.warn("importParsedRecipe:", data.error);
      rmItems.forEach(ing => {
        const t = (ing.type||'rm').toLowerCase();
        if (t === 'rm'  && ing.code)   _allRmCodes  = [...(_allRmCodes ||[]), ing.code];
        if (t === 'mep' && ing.code)   _allMepCodes = [...(_allMepCodes||[]), ing.code];
      });
    }

    const savedCount   = toSave.length;
    const matchedCount = pdfParsedIngredients.length - savedCount;
    adminMsg("pdf-msg",
      `✓ Saved to Recipes tab as "${pdfTargetMepCode}" · ${savedCount} new item${savedCount!==1?"s":""}${matchedCount?" · "+matchedCount+" linked":""}`,
      "ok");

    // ── capture name before cancelPdfImport clears it ──
    const savedMenuName = (document.getElementById('pdf-menu-name')?.value || '').trim() || pdfTargetMepCode;
    cancelPdfImport();

    // Reload menus and navigate to Recipes tab
    await loadMenus();
    await loadGRs();
    const recipesBtn = document.querySelector('.tab[data-tab="recipes"]');
    if (recipesBtn) {
      switchTab(recipesBtn);
      const menuSearch = document.getElementById("menu-search");
      if (menuSearch) {
        menuSearch.value = savedMenuName;
        renderMenuList();
      }
    }

  } catch(err) {
    adminMsg("pdf-msg","Save error: "+err.message,"err");
  } finally {
    if (btn) { btn.disabled=false; btn.textContent="✓ Save all to Recipes"; }
  }
}

function cancelPdfImport() {
  pdfParsedIngredients = [];
  pdfTargetMepCode     = "";
  window._pdfMode      = null;
  _pdfSelectedFile     = null;
  document.getElementById("pdf-preview").style.display = "none";
  document.getElementById("pdf-file-input").value      = "";
  document.getElementById("pdf-file-name").textContent = "";
  document.getElementById("pdf-mep-code").value        = "";
  const saveBtn = document.querySelector("#pdf-preview .btn-save");
  if (saveBtn) saveBtn.style.display = "";
}
