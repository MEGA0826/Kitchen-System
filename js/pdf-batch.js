// Kitchen MEP — Batch PDF recipe import — feature module, classic script.
// Extracted from dashboard.html (monolith->modules restructure). Event-driven; entry
// points are inline handlers (initBatchFiles, startBatchPdfImport, retryFailedBatch,
// applyBatchMatches, closeBatchUnmatched). Calls extractPdfText / renderPdfPreview /
// _suggestPdfCode from js/pdf-import.js (classic-script globals at runtime). Batch state
// (_batchSelectedFiles/_batchRunning/_batchUnmatched/_batchAllIngredients/_bumResolved/
// _bumSearchItems) stays INLINE in dashboard.html (shared via the global lexical env).
// NOTE: _batchRunning is declared `var` (not `let`) in dashboard.html so this module's
// loop and the inline stop button (onclick="_batchRunning=false") share one binding
// (window._batchRunning) — the stop button now actually halts the loop.

// Retry a GAS/network call up to maxAttempts times, waiting for online first.
async function _batchRetry(fn, maxAttempts) {
  maxAttempts = maxAttempts || 4;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // Wait until browser reports online (up to 30 s)
    if (!navigator.onLine) {
      for (let w = 0; w < 30; w++) {
        await new Promise(r => setTimeout(r, 1000));
        if (navigator.onLine) break;
      }
      if (!navigator.onLine) throw new Error('No connection after 30 s');
    }
    try {
      const result = await fn();
      // Treat SW offline stub as a network error so we retry
      if (result && result.error === 'offline') throw new TypeError('SW offline fallback — will retry');
      return result;
    } catch(e) {
      const isNetwork = e instanceof TypeError || (e.message || '').includes('fetch') || (e.message || '').includes('offline');
      if (!isNetwork || attempt === maxAttempts - 1) throw e;
      // Exponential back-off: 3 s, 6 s, 12 s
      await new Promise(r => setTimeout(r, 3000 * Math.pow(2, attempt)));
    }
  }
}

function initBatchFiles(el) {
  _batchSelectedFiles = Array.from(el.files || [])
    .filter(f => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'));
  const cnt = document.getElementById('batch-file-count');
  if (cnt) cnt.textContent = _batchSelectedFiles.length
    ? _batchSelectedFiles.length + ' file' + (_batchSelectedFiles.length === 1 ? '' : 's') + ' selected'
    : '';
}

function _nextBatchMenuCode() { return _nextBatchCode(); }

function _nextBatchCode(typePrefix) {
  const prefix  = (typePrefix || ((document.getElementById('batch-code-prefix')?.value || 'M').trim() || 'M')).toUpperCase();
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp('^' + escaped + '-(\\d+)$', 'i');
  // Check appropriate system list for each prefix type
  const systemCodes =
    prefix === 'GR' ? (allGRs   || []).map(g => g.grCode || g.code || '') :
    prefix === 'P'  ? (Object.keys(allProducts || {}))                     :
                      (allMenus || []).map(m => m.menuCode || m.code || '');
  const used = new Set(
    systemCodes
      .concat(_batchUsedCodes)
      .filter(c => pattern.test(c))
      .map(c => parseInt(c.match(pattern)[1], 10))
  );
  for (let n = 1; n <= 9999; n++) {
    if (!used.has(n)) return prefix + '-' + String(n).padStart(3, '0');
  }
  return prefix + '-' + Date.now();
}

function renderBatchProgress() {
  const el = document.getElementById('batch-item-list');
  if (!el) return;
  el.innerHTML = _batchSelectedFiles.map((f, i) =>
    `<div id="batch-item-${i}" style="display:grid;grid-template-columns:18px 1fr 90px 1fr;gap:8px;align-items:center;padding:5px 8px;background:var(--surface2);border-radius:var(--radius-sm);border:1px solid var(--border);font-size:11px;font-family:var(--mono)">
      <span id="batch-icon-${i}" style="color:var(--muted)">·</span>
      <span style="color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${f.name}">${f.name.replace(/</g,'&lt;')}</span>
      <span id="batch-code-${i}" style="color:var(--muted)">—</span>
      <span id="batch-detail-${i}" style="color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">pending</span>
    </div>`
  ).join('');
}

function _setBatchItemUI(idx, status, code, detail) {
  const icon   = document.getElementById('batch-icon-'   + idx);
  const codeEl = document.getElementById('batch-code-'   + idx);
  const detEl  = document.getElementById('batch-detail-' + idx);
  const row    = document.getElementById('batch-item-'   + idx);
  if (!icon) return;
  const S = {
    run: { ic: '⟳', cl: 'var(--amber)', bc: 'var(--amber-brd)', bg: ''                         },
    ok:  { ic: '✓', cl: 'var(--green)', bc: 'var(--green-brd)', bg: 'rgba(93,202,138,0.05)'    },
    err: { ic: '✕', cl: 'var(--red)',   bc: 'var(--red-brd)',   bg: ''                         }
  };
  const s = S[status] || S.run;
  icon.textContent = s.ic;
  icon.style.color = s.cl;
  if (row)    { row.style.borderColor = s.bc; if (s.bg) row.style.background = s.bg; }
  if (codeEl && code) { codeEl.textContent = code; codeEl.style.color = s.cl; }
  if (detEl)  { detEl.textContent = detail || ''; detEl.style.color = status === 'run' ? 'var(--amber)' : s.cl; detEl.title = detail || ''; }
}

function _updateBatchBar(done, total) {
  const bar = document.getElementById('batch-progress-bar');
  const lbl = document.getElementById('batch-progress-label');
  if (bar) bar.style.width = total ? (done / total * 100).toFixed(0) + '%' : '0%';
  if (lbl) lbl.textContent = done + ' / ' + total;
}

async function _processBatchItem(idx) {
  const file     = _batchSelectedFiles[idx];
  const filename = file.name.replace(/\.pdf$/i, '');

  _setBatchItemUI(idx, 'run', '', 'Reading PDF…');

  const arrayBuf = await (file.arrayBuffer
    ? file.arrayBuffer()
    : new Promise((res, rej) => {
        const fr = new FileReader();
        fr.onload  = () => res(fr.result);
        fr.onerror = rej;
        fr.readAsArrayBuffer(file);
      }));
  if (!arrayBuf.byteLength) throw new Error('File empty — download the PDF locally first');

  const pdfData = await extractPdfText(arrayBuf);
  if (!pdfData.startsWith('__VISION__')) throw new Error('PDF render failed');

  const imageData = pdfData.slice(10); // strip "__VISION__"
  const CHUNK_SIZE = 5000;
  const sessionId  = 'btch_' + Date.now() + '_' + idx;
  const total      = Math.ceil(imageData.length / CHUNK_SIZE);

  _setBatchItemUI(idx, 'run', '', 'Uploading…');
  for (let c = 0; c < total; c++) {
    const chunk = imageData.substring(c * CHUNK_SIZE, (c + 1) * CHUNK_SIZE);
    const r = await _batchRetry(() => adminCall({ action: 'storeChunk', sessionId, chunk, idx: c, total }));
    if (r && r.error) throw new Error('Upload: ' + r.error);
  }

  _setBatchItemUI(idx, 'run', '', 'Parsing with AI…');
  const vd = await _batchRetry(() => adminCall({ action: 'parsePdfVisionChunked', sessionId }));
  if (!vd)       throw new Error('No response from server');
  if (vd.error)  throw new Error(vd.error);

  const mi           = vd.menuInfo || {};
  const rawIngredients = (vd.ingredients || []).map(ing => ({
    type    : (ing.type || 'rm').toLowerCase(),
    code    : ing.code    || '',
    name    : ing.name    || '',
    gewicht : parseFloat(ing.quantity) || '',
    unit    : ing.unit    || '',
    allergie: ing.allergie || '',
    cost    : 0,
    _matched: !!ing._matched
  }));
  const { enriched: ingredients, waTotal: computedWa } = _enrichZutaten(rawIngredients);

  const menuName      = mi.name || filename;
  const detectedArt   = (mi.art || '').trim();
  const isGR          = /grundrezeptur/i.test(detectedArt) || detectedArt.toUpperCase() === 'GR';

  const allergens    = (vd.ingredients || []).map(i => i.allergie).filter(Boolean).join(', ');
  const allergenLine = (mi.deklaration || allergens)
    ? '\n\nAllergen: ' + (mi.deklaration || allergens) : '';
  const zubereitung  = [
    mi.zubereitung || '',
    mi.warentraeger ? 'Warenträger: ' + mi.warentraeger : '',
    allergenLine,
    mi.produktspezifikation ? '\n\nProdukte Spezifikation:\n' + mi.produktspezifikation : '',
    mi.naehrwerte   ? '\n\nNährwerte: ' + mi.naehrwerte : ''
  ].filter(Boolean).join('\n');
  // GAS uses GET — cap zubereitung to keep URL under GAS query-string limit
  const zubereitungSafe = zubereitung.slice(0, 1800);

  let savedCode;

  if (isGR) {
    // ── Save as Grundrezeptur ──────────────────────────────────────────────
    const grCode = _nextBatchCode('GR');
    _setBatchItemUI(idx, 'run', grCode, 'Saving as GR…');
    const saved = await _batchRetry(() => adminCall({
      action      : 'saveGR',
      grCode,
      name        : menuName,
      art         : detectedArt || 'Grundrezeptur',
      rohgewicht  : parseFloat(mi.gewicht) || 0,
      garverlust  : 0,
      wa          : 0,
      zutaten     : JSON.stringify(_slimZutaten(ingredients)),
      zubereitung : zubereitungSafe,
      wa          : computedWa || 0
    }));
    if (saved && saved.error) throw new Error(saved.error);
    savedCode = grCode;
    _setBatchItemUI(idx, 'ok', grCode, 'saved as GR ✓');

  } else {
    // ── Save as Menu (Hauptgang / Starter / etc.) ──────────────────────────
    const menuCode = _nextBatchCode();
    _setBatchItemUI(idx, 'run', menuCode, 'Saving…');
    const saved = await _batchRetry(() => adminCall({
      action      : 'saveMenu',
      menuId      : '',
      name        : menuName,
      menuCode,
      category    : mi.category || '',
      art         : detectedArt || 'Hauptgang',
      saison      : 'All Year',
      zutaten     : JSON.stringify(_slimZutaten(ingredients)),
      zubereitung : zubereitungSafe,
      wa          : computedWa || 0,
      vk          : mi.verkaufspreis || '',
      gewicht     : mi.gewicht || '',
      lastUpdate  : new Date().toISOString()
    }));
    if (saved && saved.error) throw new Error(saved.error);
    savedCode = menuCode;
    _setBatchItemUI(idx, 'ok', menuCode, 'saved ✓');
  }

  _batchUsedCodes.push(savedCode);

  // ── Collect unmatched ingredients for post-batch review popup ─────────────
  _batchAllIngredients[savedCode] = { zutaten: ingredients.slice(), isGR, menuName };
  ingredients.forEach((z, ingIdx) => {
    if (!z._matched) {
      _batchUnmatched.push({
        rowId: _batchUnmatched.length,
        savedCode, isGR, menuName, ingIdx,
        ingName: z.name || '',
        ingCode: z.code || '',
        ingType: z.type || 'rm'
      });
    }
  });

  // ── Create any new RM/MEP/GR ingredient items that don't exist yet ────────
  const newIngredients = (vd.ingredients || []).filter(i => !i._matched && i.code);
  if (newIngredients.length) {
    await _batchRetry(() => adminCall({
      action      : 'importParsedRecipe',
      mepCode     : savedCode,
      ingredients : JSON.stringify(newIngredients)
    })).catch(e => console.warn('[batch] importParsedRecipe:', e.message));
  }

  return savedCode;
}

async function startBatchPdfImport() {
  if (!_batchSelectedFiles.length) {
    adminMsg('batch-msg', 'Select PDF files first', 'err'); return;
  }
  if (_batchRunning) return;

  _batchRunning        = true;
  _batchUsedCodes      = [];
  _batchUnmatched      = [];
  _batchAllIngredients = {};
  _bumResolved         = {};

  const btn     = document.getElementById('batch-import-btn');
  const stopBtn = document.getElementById('batch-stop-btn');
  const progEl  = document.getElementById('batch-progress');

  if (btn)    btn.disabled       = true;
  if (stopBtn) stopBtn.style.display = '';
  if (progEl)  progEl.style.display  = 'block';

  renderBatchProgress();
  _updateBatchBar(0, _batchSelectedFiles.length);

  let ok = 0, fail = 0;

  for (let i = 0; i < _batchSelectedFiles.length; i++) {
    if (!_batchRunning) {
      adminMsg('batch-msg', `Stopped — ${ok} saved so far`, 'err');
      break;
    }
    const row = document.getElementById('batch-item-' + i);
    if (row) row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });

    try {
      await _processBatchItem(i);
      ok++;
    } catch(e) {
      _setBatchItemUI(i, 'err', '', e.message);
      fail++;
    }
    _updateBatchBar(i + 1, _batchSelectedFiles.length);
    await new Promise(r => setTimeout(r, 200));
  }

  _batchRunning = false;
  if (btn)    btn.disabled       = false;
  if (stopBtn) stopBtn.style.display = 'none';

  const retryWrap = document.getElementById('batch-retry-wrap');
  if (fail > 0 && retryWrap) retryWrap.style.display = '';

  if (ok > 0) {
    adminMsg('batch-msg',
      `✓ ${ok} recipe${ok !== 1 ? 's' : ''} saved${fail ? ' · ' + fail + ' failed — tap 🔄 Retry Failed' : ''} — opening Recipes tab…`,
      'ok');
    await loadMenus();
    await loadGRs();
    if (_batchUnmatched.length > 0) {
      _showBatchUnmatchedReview();
    } else {
      _showBatchResultsInRecipes();
    }
  } else {
    adminMsg('batch-msg', `All ${fail} failed — tap 🔄 Retry Failed when back online`, 'err');
  }
}

function _showBatchResultsInRecipes() {
  const prefix = ((document.getElementById('batch-code-prefix')?.value || 'M').trim() || 'M').toUpperCase();
  const recipesBtn = document.querySelector('.tab[data-tab="recipes"]');
  if (recipesBtn) switchTab(recipesBtn);
  // Search by code prefix so the guard is bypassed and only new recipes show
  const menuSearch = document.getElementById('menu-search');
  if (menuSearch) menuSearch.value = prefix + '-';
  const catFilter = document.getElementById('menu-cat-filter');
  if (catFilter) catFilter.value = '';
  const artFilter = document.getElementById('menu-art-filter');
  if (artFilter) artFilter.value = '';
  renderMenuList();
}

// ─────────────────────────────────────────────
// BATCH UNMATCHED INGREDIENT REVIEW POPUP
// ─────────────────────────────────────────────

function _findTopSuggestions(name, maxN) {
  if (!name) return [];
  const search = name.toLowerCase().trim();
  const items = _bumSearchItems.length ? _bumSearchItems : _buildBumSearchItems();
  const scored = items.map(item => {
    const n = item.name.toLowerCase();
    let score = 0;
    if (n === search) score = 100;
    else if (n.startsWith(search) || search.startsWith(n)) score = 80;
    else if (n.includes(search) || search.includes(n)) score = 60;
    else {
      const sw = search.split(/\s+/).filter(w => w.length > 2);
      const iw = n.split(/\s+/).filter(w => w.length > 2);
      const hits = sw.filter(w => iw.some(j => j.includes(w) || w.includes(j))).length;
      if (hits > 0) score = 20 + hits * 10;
    }
    return { ...item, score };
  }).filter(x => x.score > 0).sort((a, b) => b.score - a.score);
  return scored.slice(0, maxN || 3);
}

function _buildBumSearchItems() {
  const items = [];
  (allInventory || []).forEach(i => { if (i.code && i.name) items.push({ type: 'rm', code: i.code, name: i.name }); });
  (allGRs || []).forEach(g => { const c = g.grCode || g.id; if (c && g.name) items.push({ type: 'gr', code: c, name: g.name }); });
  Object.entries(allProducts || {}).forEach(([code, p]) => { if (code && p.name && p.name !== '(deleted)') items.push({ type: 'mep', code, name: p.name }); });
  (allMenus || []).forEach(m => { const c = m.menuCode || m.id; if (c && m.name) items.push({ type: 'menu', code: c, name: m.name }); });
  _bumSearchItems = items;
  return items;
}

function _showBatchUnmatchedReview() {
  _bumResolved    = {};
  _bumSearchItems = _buildBumSearchItems();

  _batchUnmatched.forEach(item => {
    item.suggestions = _findTopSuggestions(item.ingName, 3);
  });

  const groups = {};
  _batchUnmatched.forEach(item => {
    if (!groups[item.savedCode]) groups[item.savedCode] = { menuName: item.menuName, isGR: item.isGR, items: [] };
    groups[item.savedCode].items.push(item);
  });

  const typePill = t => {
    const colors = { rm:'#3b82f6', gr:'#8b5cf6', mep:'#f59e0b', menu:'#10b981' };
    const c = colors[(t||'rm').toLowerCase()] || '#6b7280';
    return `<span style="font-size:9px;padding:1px 5px;border-radius:9px;background:${c}22;color:${c};border:1px solid ${c}44;font-weight:700">${(t||'rm').toUpperCase()}</span>`;
  };

  const enc = v => (v||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;');

  const groupsHtml = Object.entries(groups).map(([code, grp]) => {
    const rowsHtml = grp.items.map(item => {
      const pillsHtml = item.suggestions.map(s =>
        `<button type="button" class="bum-select-btn"
          data-row-id="${item.rowId}" data-code="${enc(s.code)}" data-name="${enc(s.name)}" data-type="${enc(s.type)}"
          style="font-size:11px;padding:3px 8px;border-radius:12px;border:1px solid var(--border);background:var(--surface3);cursor:pointer;color:var(--text);white-space:nowrap;max-width:200px;overflow:hidden;text-overflow:ellipsis">
          ${typePill(s.type)} ${enc(s.code)} · ${(s.name||'').replace(/</g,'&lt;')}
        </button>`
      ).join('');
      return `<div id="bum-row-${item.rowId}" style="padding:10px 12px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface2);margin-bottom:8px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
          <div>
            <span style="font-size:12px;font-weight:600;color:var(--text)">${(item.ingName||'').replace(/</g,'&lt;')}</span>
            <span style="font-size:10px;color:var(--muted);margin-left:8px">AI: ${(item.ingCode||'—').replace(/</g,'&lt;')}</span>
          </div>
          <span id="bum-status-${item.rowId}" style="font-size:10px;color:var(--muted);white-space:nowrap">not matched</span>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:5px;margin-top:8px">
          ${pillsHtml}
          <button type="button" class="bum-skip-btn" data-row-id="${item.rowId}"
            style="font-size:11px;padding:3px 8px;border-radius:12px;border:1px solid var(--border);background:none;cursor:pointer;color:var(--muted)">Skip</button>
        </div>
        <div style="margin-top:7px">
          <input type="text" id="bum-search-${item.rowId}" class="bum-search-input" data-row-id="${item.rowId}"
            placeholder="Search system…"
            style="width:100%;box-sizing:border-box;font-size:11px;padding:5px 9px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface3);color:var(--text)">
          <div id="bum-results-${item.rowId}" style="display:none;max-height:120px;overflow-y:auto;border:1px solid var(--border);border-top:none;border-radius:0 0 var(--radius-sm) var(--radius-sm);background:var(--surface1)"></div>
        </div>
      </div>`;
    }).join('');
    return `<div style="margin-bottom:18px">
      <div style="font-size:12px;font-weight:700;color:var(--text);padding-bottom:6px;border-bottom:1px solid var(--border);margin-bottom:8px">
        ${grp.isGR ? '📋 GR' : '🍽 Menu'} <span style="color:var(--amber)">${code}</span> — ${(grp.menuName||'').replace(/</g,'&lt;')}
        <span style="font-weight:400;color:var(--muted);margin-left:6px">(${grp.items.length} unmatched)</span>
      </div>
      ${rowsHtml}
    </div>`;
  }).join('');

  const total = _batchUnmatched.length;
  const overlay = document.createElement('div');
  overlay.id = 'bum-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.65);z-index:3000;display:flex;align-items:flex-start;justify-content:center;padding:20px 16px;overflow-y:auto';
  overlay.innerHTML = `
    <div style="background:var(--surface1);border-radius:var(--radius);border:1px solid var(--border);width:min(680px,100%);display:flex;flex-direction:column;overflow:hidden">
      <div style="padding:16px 20px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;gap:12px">
        <div>
          <div style="font-size:15px;font-weight:700;color:var(--text)">🔍 ${total} Unmatched Ingredient${total !== 1 ? 's' : ''}</div>
          <div style="font-size:12px;color:var(--muted);margin-top:3px">Select the correct system item, or Skip to keep the AI assignment</div>
        </div>
        <button type="button" class="bum-close-btn" style="background:none;border:none;color:var(--muted);font-size:20px;cursor:pointer;line-height:1;padding:4px;flex-shrink:0">✕</button>
      </div>
      <div style="overflow-y:auto;max-height:65vh;padding:16px 20px">${groupsHtml}</div>
      <div style="padding:12px 20px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end">
        <button type="button" class="bum-close-btn"
          style="padding:8px 16px;border-radius:var(--radius-sm);border:1px solid var(--border);background:none;color:var(--muted);cursor:pointer;font-size:12px">Skip All & Close</button>
        <button type="button" id="bum-apply-btn"
          style="padding:8px 18px;border-radius:var(--radius-sm);border:1px solid var(--green-brd);background:var(--green-dim);color:var(--green);cursor:pointer;font-size:12px;font-weight:600">Apply & Re-save</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  _bumBindEvents(overlay);
}

function _bumBindEvents(overlay) {
  overlay.addEventListener('click', e => {
    const selBtn = e.target.closest('.bum-select-btn');
    if (selBtn) { bumSelect(+selBtn.dataset.rowId, selBtn.dataset.code, selBtn.dataset.name, selBtn.dataset.type); return; }
    const skipBtn = e.target.closest('.bum-skip-btn');
    if (skipBtn) { bumSkip(+skipBtn.dataset.rowId); return; }
    const resRow = e.target.closest('.bum-result-row');
    if (resRow) { bumSelect(+resRow.dataset.rowId, resRow.dataset.code, resRow.dataset.name, resRow.dataset.type); return; }
    const closeBtn = e.target.closest('.bum-close-btn');
    if (closeBtn) { closeBatchUnmatched(); return; }
    if (e.target.id === 'bum-apply-btn' || e.target.closest('#bum-apply-btn')) { applyBatchMatches(); return; }
  });
  overlay.querySelectorAll('.bum-search-input').forEach(inp => {
    inp.addEventListener('input', () => bumSearchFilter(+inp.dataset.rowId, inp.value));
  });
}

function bumSelect(rowId, code, name, type) {
  _bumResolved[rowId] = { code, name, type };
  const statusEl = document.getElementById('bum-status-' + rowId);
  if (statusEl) {
    statusEl.textContent = '✓ ' + (type||'').toUpperCase() + ' · ' + code;
    statusEl.style.color = 'var(--green)';
  }
  const row = document.getElementById('bum-row-' + rowId);
  if (row) row.style.borderColor = 'var(--green-brd)';
  // Hide search results
  const res = document.getElementById('bum-results-' + rowId);
  if (res) res.style.display = 'none';
  const inp = document.getElementById('bum-search-' + rowId);
  if (inp) inp.value = code + ' · ' + name;
}

function bumSkip(rowId) {
  _bumResolved[rowId] = 'skip';
  const statusEl = document.getElementById('bum-status-' + rowId);
  if (statusEl) { statusEl.textContent = 'Skipped'; statusEl.style.color = 'var(--muted)'; }
  const row = document.getElementById('bum-row-' + rowId);
  if (row) { row.style.borderColor = 'var(--border)'; row.style.opacity = '0.6'; }
}

function bumSearchFilter(rowId, query) {
  const resultsEl = document.getElementById('bum-results-' + rowId);
  if (!resultsEl) return;
  const q = (query || '').trim().toLowerCase();
  if (!q) { resultsEl.style.display = 'none'; resultsEl.innerHTML = ''; return; }
  const matches = _bumSearchItems.filter(item =>
    (item.name||'').toLowerCase().includes(q) || (item.code||'').toLowerCase().includes(q)
  ).slice(0, 12);
  if (!matches.length) {
    resultsEl.style.display = 'block';
    resultsEl.innerHTML = '<div style="padding:8px 10px;font-size:11px;color:var(--muted)">No results</div>';
    return;
  }
  const enc = v => (v||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;');
  resultsEl.style.display = 'block';
  resultsEl.innerHTML = matches.map(m =>
    `<div class="bum-result-row" data-row-id="${rowId}"
      data-code="${enc(m.code)}" data-name="${enc(m.name)}" data-type="${enc(m.type)}"
      style="padding:7px 10px;font-size:11px;cursor:pointer;border-bottom:1px solid var(--border);display:flex;gap:8px;align-items:center">
      <span style="font-size:9px;color:var(--muted);min-width:28px">${(m.type||'').toUpperCase()}</span>
      <span style="color:var(--amber);min-width:60px">${(m.code||'').replace(/</g,'&lt;')}</span>
      <span style="color:var(--text)">${(m.name||'').replace(/</g,'&lt;')}</span>
    </div>`
  ).join('');
}

async function applyBatchMatches() {
  const btn = document.getElementById('bum-apply-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

  // Apply selections to stored zutaten arrays
  const toResave = new Set();
  _batchUnmatched.forEach(item => {
    const resolved = _bumResolved[item.rowId];
    if (!resolved || resolved === 'skip') return;
    const entry = _batchAllIngredients[item.savedCode];
    if (!entry || !entry.zutaten[item.ingIdx]) return;
    entry.zutaten[item.ingIdx] = {
      ...entry.zutaten[item.ingIdx],
      code    : resolved.code,
      name    : resolved.name,
      type    : resolved.type,
      _matched: true
    };
    toResave.add(item.savedCode);
  });

  let saved = 0, failed = 0;
  for (const savedCode of toResave) {
    const entry = _batchAllIngredients[savedCode];
    if (!entry) continue;
    try {
      const { enriched, waTotal } = _enrichZutaten(entry.zutaten);
      if (entry.isGR) {
        const gr = (allGRs || []).find(g => (g.grCode || g.id) === savedCode);
        // GAS saveGR always appends — delete old row first
        await _batchRetry(() => adminCall({ action: 'deleteGR', grCode: savedCode }));
        await _batchRetry(() => adminCall({
          action     : 'saveGR',
          grCode     : savedCode,
          name       : entry.menuName,
          art        : (gr && gr.art) || 'Grundrezeptur',
          rohgewicht : (gr && gr.rohgewicht) || 0,
          garverlust : (gr && gr.garverlust) || 0,
          wa         : waTotal,
          zutaten    : JSON.stringify(_slimZutaten(enriched)),
          zubereitung: (gr && gr.zubereitung) || ''
        }));
      } else {
        const menu = (allMenus || []).find(m => (m.menuCode || m.id) === savedCode);
        const menuId = menu ? (menu.id || menu.menuId || '') : '';
        await _batchRetry(() => adminCall({
          action     : 'saveMenu',
          menuId,
          name       : entry.menuName,
          menuCode   : savedCode,
          category   : (menu && menu.category) || '',
          art        : (menu && menu.art) || 'Hauptgang',
          saison     : (menu && menu.saison) || 'All Year',
          zutaten    : JSON.stringify(_slimZutaten(enriched)),
          zubereitung: (menu && menu.zubereitung) || '',
          wa         : waTotal,
          vk         : (menu && menu.vk) || '',
          gewicht    : (menu && menu.gewicht) || '',
          lastUpdate : new Date().toISOString()
        }));
      }
      saved++;
    } catch(e) {
      failed++;
      console.warn('[bum] re-save', savedCode, e.message);
    }
  }

  // Remove overlay
  const overlay = document.getElementById('bum-overlay');
  if (overlay) overlay.remove();

  await loadMenus();
  await loadGRs();

  if (saved > 0 || toResave.size === 0) {
    const msg = saved > 0
      ? `✓ ${saved} recipe${saved !== 1 ? 's' : ''} updated with corrected ingredients${failed ? ' · ' + failed + ' failed' : ''}`
      : 'No changes applied';
    adminMsg('batch-msg', msg, saved > 0 ? 'ok' : '');
  } else {
    adminMsg('batch-msg', `All ${failed} re-saves failed`, 'err');
  }
  _showBatchResultsInRecipes();
}

function closeBatchUnmatched() {
  const overlay = document.getElementById('bum-overlay');
  if (overlay) overlay.remove();
  _showBatchResultsInRecipes();
}

async function retryFailedBatch() {
  // Collect indices of failed rows
  const failedIdxs = _batchSelectedFiles
    .map((_, i) => {
      const icon = document.getElementById('batch-icon-' + i);
      return (icon && icon.textContent === '✕') ? i : -1;
    })
    .filter(i => i >= 0);

  if (!failedIdxs.length) return;

  const retryWrap = document.getElementById('batch-retry-wrap');
  if (retryWrap) retryWrap.style.display = 'none';

  _batchRunning = true;
  const btn     = document.getElementById('batch-import-btn');
  const stopBtn = document.getElementById('batch-stop-btn');
  if (btn)    btn.disabled       = true;
  if (stopBtn) stopBtn.style.display = '';

  let ok = 0, fail = 0;

  for (const i of failedIdxs) {
    if (!_batchRunning) break;
    const row = document.getElementById('batch-item-' + i);
    if (row) row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    try {
      await _processBatchItem(i);
      ok++;
    } catch(e) {
      _setBatchItemUI(i, 'err', '', e.message);
      fail++;
    }
    await new Promise(r => setTimeout(r, 200));
  }

  _batchRunning = false;
  if (btn)    btn.disabled       = false;
  if (stopBtn) stopBtn.style.display = 'none';
  if (fail > 0 && retryWrap) retryWrap.style.display = '';

  if (ok > 0) {
    adminMsg('batch-msg',
      `✓ ${ok} more saved${fail ? ' · ' + fail + ' still failing' : ''} — opening Recipes tab…`, 'ok');
    await loadMenus();
    await loadGRs();
    _showBatchResultsInRecipes();
  } else {
    adminMsg('batch-msg', `Still failing — check your connection`, 'err');
  }
}
