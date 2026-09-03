// Kitchen MEP — GR (Grundrezeptur / base-recipe) editor — feature module, classic script.
// Extracted from dashboard.html (monolith->modules restructure). The GR editor is interleaved with
// the menu/MEP editors and shared calculators, so it moves as 4 chunks of GR-only functions.
// Event-driven; entry points are inline handlers (openAddGRPopup/guardedAddGR, openEditGRPopup from
// GR rows, previewAgrImg onchange, calcAgr* oninput, saveGREntry from the save button).
// Shared state stays INLINE: agrZutaten[] + _agrImgFile + _grSelectedItem (top-level lets, global
// lexical env). The shared ingredient picker, calculators (_calcLiveWA/_calcAllergens),
// _uploadItemImage, loadGRs, _refreshGrList, deleteGR and the GR display all stay inline.

function previewAgrImg(input) {
  const file = input.files[0]; if (!file) return;
  _agrImgFile = file;
  const reader = new FileReader();
  reader.onload = e => {
    document.getElementById('agr-img-el').src = e.target.result;
    document.getElementById('agr-img-preview').style.display = 'block';
  };
  reader.readAsDataURL(file);
}
function removeAgrImage() {
  const el = document.getElementById('agr-img-el'); if (el) el.src = '';
  document.getElementById('agr-img-preview').style.display = 'none';
  ['agr-img-file','agr-img-file-cam'].forEach(id => { const f = document.getElementById(id); if (f) f.value = ''; });
  _agrImgFile = null;
}

function openAddGRPopup(art) {
  editingGRCode = null;
  closeMenu();
  agrZutaten = [];
  ['agr-code','agr-name','agr-rohgewicht','agr-garverlust','agr-zubereitung'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  document.getElementById('agr-art').value = art || 'Grundrezeptur';
  document.getElementById('agr-netto').textContent = '—';
  document.getElementById('agr-eff').textContent = '—';
  document.getElementById('agr-wa').value = '';
  document.getElementById('agr-msg').textContent = '';
  _agrImgFile = null;
  const agrImgEl = document.getElementById('agr-img-el'); if (agrImgEl) agrImgEl.src = '';
  const agrImgPrev = document.getElementById('agr-img-preview'); if (agrImgPrev) agrImgPrev.style.display = 'none';
  ['agr-img-file','agr-img-file-cam'].forEach(id => { const f = document.getElementById(id); if (f) f.value = ''; });
  renderAgrZutaten();
  document.getElementById('addGRPopup').style.display = 'flex';
  _onPopupOpen();
}

function closeAddGRPopup() {
  editingGRCode = null;
  document.getElementById('addGRPopup').style.display = 'none';
  _onPopupClose();
}

// ── Copy helpers — open "create new" popup pre-filled from source item ────────
function copyGR(grCode) {
  const g = allGRs.find(x => (x.grCode||x.id) === grCode);
  if (!g) return;
  editingGRCode = null;
  try { agrZutaten = JSON.parse(g.zutaten || '[]'); } catch(e) { agrZutaten = []; }
  const setV = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };
  setV('agr-code',        grCode + '-2');
  setV('agr-name',        'Copy of ' + (g.name || grCode));
  setV('agr-art',         g.art || 'Grundrezeptur');
  setV('agr-rohgewicht',  g.rohgewicht || '');
  setV('agr-garverlust',  g.garverlust || '');
  setV('agr-zubereitung', g.zubereitung || '');
  setV('agr-wa',          g.wa || '');
  document.getElementById('agr-msg').textContent = '';
  calcAgrNetto(); renderAgrZutaten();
  document.getElementById('addGRPopup').style.display = 'flex';
  _onPopupOpen();
}

function calcAgrNetto() {
  const roh   = parseFloat(document.getElementById('agr-rohgewicht').value) || 0;
  const verl  = parseFloat(document.getElementById('agr-garverlust').value) || 0;
  const netto = roh * (1 - verl / 100);
  document.getElementById('agr-netto').textContent = netto > 0 ? netto.toFixed(3) + ' kg' : '—';
  const wa = parseFloat(document.getElementById('agr-wa').value) || 0;
  const effEl = document.getElementById('agr-eff');
  if (wa > 0 && netto > 0) effEl.textContent = 'CHF ' + (wa / netto).toFixed(2) + ' /kg';
  else effEl.textContent = '—';
}

function calcAgrWa() {
  const totalWa  = agrZutaten.reduce((s,z) => s+(parseFloat(z.cost)   ||0), 0);
  const totalKg  = agrZutaten.reduce((s,z) => s+(parseFloat(z.gewicht)||0), 0);
  const waEl  = document.getElementById('agr-wa');
  const totEl = document.getElementById('agr-wa-total');
  const rohEl = document.getElementById('agr-rohgewicht');
  if (waEl)  waEl.value = totalWa.toFixed(2);
  if (totEl) totEl.textContent = 'CHF ' + totalWa.toFixed(2);
  if (rohEl && agrZutaten.length) rohEl.value = totalKg.toFixed(3);
  calcAgrNetto();
}

function renderAgrZutaten() {
  const el = document.getElementById('agr-zutaten-list');
  if (!el) return;
  if (!agrZutaten.length) {
    el.innerHTML = `<div style="font-size:12px;color:var(--muted);font-style:italic">Noch keine Zutaten.</div>`;
  } else {
    const typeColors = { mep:'var(--amber)', rm:'var(--blue)', gr:'var(--green)' };
    const typeBg     = { mep:'var(--amber-dim)', rm:'var(--blue-dim)', gr:'var(--green-dim)' };
    el.innerHTML = agrZutaten.map((z, i) => `
      <div style="display:flex;align-items:center;gap:7px;padding:7px 10px;background:var(--surface2);border-radius:8px">
        <span style="font-size:10px;padding:1px 6px;border-radius:4px;background:${typeBg[z.type]||'var(--surface)'};color:${typeColors[z.type]||'var(--text)'};font-weight:700">${(z.type||'RM').toUpperCase()}</span>
        <div style="flex:1;min-width:0">
          <div style="font-size:12px;color:var(--text)">${z.name||''}</div>
          <div style="font-size:10px;color:var(--muted)">${z.gewicht?z.gewicht+'kg':''} ${z.cost?'· CHF '+parseFloat(z.cost).toFixed(2):''}</div>
        </div>
        <div style="display:flex;gap:4px;flex-shrink:0">
          <button data-idx="${i}" class="agr-zutat-edit-btn"
            style="background:var(--amber-dim);border:1px solid var(--amber-brd);color:var(--amber);border-radius:6px;padding:3px 7px;cursor:pointer;font-size:11px">✏️</button>
          <button data-idx="${i}" class="agr-zutat-del-btn"
            style="background:none;border:none;color:var(--red);cursor:pointer;font-size:15px;padding:0 2px">✕</button>
        </div>
      </div>`).join('');
    el.querySelectorAll('.agr-zutat-edit-btn').forEach(btn =>
      btn.addEventListener('click', () => editGrZutat(parseInt(btn.dataset.idx))));
    el.querySelectorAll('.agr-zutat-del-btn').forEach(btn =>
      btn.addEventListener('click', () => removeAgrZutat(parseInt(btn.dataset.idx))));
  }
  calcAgrWa();
}

function removeAgrZutat(i) {
  agrZutaten.splice(i,1);
  renderAgrZutaten();
}

async function saveGREntry() {
  const code = document.getElementById('agr-code').value.trim();
  const name = document.getElementById('agr-name').value.trim();
  if (!code) { adminMsg('agr-msg','GR Code erforderlich','err'); return; }
  if (!name) { adminMsg('agr-msg','GR Name erforderlich','err'); return; }

  // Duplicate protection — skip check when editing unchanged code
  const isEditing = !!editingGRCode;
  if (!isEditing) {
    const dupCode = allGRs.find(g => (g.grCode||'').toLowerCase() === code.toLowerCase());
    const dupName = allGRs.find(g => (g.name||'').toLowerCase() === name.toLowerCase());
    if (dupCode) { adminMsg('agr-msg', `⚠ GR Code "${code}" already exists`, 'err'); return; }
    if (dupName) { adminMsg('agr-msg', `⚠ GR name "${name}" already exists`, 'err'); return; }
  } else {
    // Editing: block only if new code belongs to a different existing GR
    const codeChanged = code.toLowerCase() !== (editingGRCode||'').toLowerCase();
    if (codeChanged) {
      const dupCode = allGRs.find(g => (g.grCode||'').toLowerCase() === code.toLowerCase());
      if (dupCode) { adminMsg('agr-msg', `⚠ GR Code "${code}" already exists`, 'err'); return; }
    }
  }
  const btn = document.getElementById('agr-save-btn');
  btn.disabled = true; btn.textContent = 'Speichern…';
  const roh   = parseFloat(document.getElementById('agr-rohgewicht').value) || 0;
  const verl  = parseFloat(document.getElementById('agr-garverlust').value) || 0;
  const wa    = parseFloat(document.getElementById('agr-wa').value) || 0;
  try {
    let _agrSaveImg = document.getElementById('agr-img-el')?.src || '';
    if (_agrSaveImg.startsWith('data:') && _agrImgFile) {
      adminMsg('agr-msg', '📤 Bild wird hochgeladen…', '');
      try { _agrSaveImg = await _uploadItemImage(_agrImgFile, 'gr'); _agrImgFile = null; }
      catch(e) { adminMsg('agr-msg', e.message, 'err'); btn.disabled = false; btn.textContent = '💾 Speichern'; return; }
    }
    if (!_agrSaveImg.startsWith('http')) _agrSaveImg = '';
    // GAS saveGR always creates a new row — delete existing entry first when editing
    if (editingGRCode) {
      const del = await get({ action: 'deleteGR', grCode: editingGRCode });
      if (del.error) throw new Error('Delete old GR failed: ' + del.error);
    }
    const data = await get({
      action       : 'saveGR',
      grCode       : code,
      name,
      art          : document.getElementById('agr-art').value,
      rohgewicht   : roh,
      garverlust   : verl,
      wa,
      zutaten      : JSON.stringify(_slimZutaten(agrZutaten)),
      zubereitung  : document.getElementById('agr-zubereitung').value.trim()
    });
    if (data.error) throw new Error(data.error);
    if (_agrSaveImg) {
      try {
        const grImgs = JSON.parse(localStorage.getItem('grImages')||'{}');
        grImgs[code] = _agrSaveImg;
        localStorage.setItem('grImages', JSON.stringify(grImgs));
      } catch(e) {}
    }
    adminMsg('agr-msg','✓ GR gespeichert','ok');
    await loadGRs();
    setTimeout(closeAddGRPopup, 900);
  } catch(e) {
    adminMsg('agr-msg','Fehler: '+e.message,'err');
  } finally {
    btn.disabled = false; btn.textContent = '💾 Speichern';
  }
}
function openEditGRPopup(grCode) {
  const g = allGRs.find(x => (x.grCode||x.id) === grCode);
  if (!g) return;
  editingGRCode = grCode;
  agrZutaten = [];
  try { agrZutaten = JSON.parse(g.zutaten || '[]'); } catch(e) {}
  document.getElementById('agr-code').value        = g.grCode || '';
  document.getElementById('agr-name').value        = g.name || '';
  document.getElementById('agr-art').value         = g.art || 'Grundrezeptur';
  document.getElementById('agr-rohgewicht').value  = g.rohgewicht || '';
  document.getElementById('agr-garverlust').value  = g.garverlust || '';
  document.getElementById('agr-zubereitung').value = g.zubereitung || '';
  document.getElementById('agr-wa').value          = g.wa || '';
  document.getElementById('agr-msg').textContent   = '';
  _agrImgFile = null;
  const _agrImgUrl = g.image || '';
  const agrImgEl = document.getElementById('agr-img-el'); if (agrImgEl) agrImgEl.src = _agrImgUrl;
  const agrImgPrev = document.getElementById('agr-img-preview'); if (agrImgPrev) agrImgPrev.style.display = _agrImgUrl ? 'block' : 'none';
  ['agr-img-file','agr-img-file-cam'].forEach(id => { const f = document.getElementById(id); if (f) f.value = ''; });
  calcAgrNetto();
  renderAgrZutaten();
  document.getElementById('addGRPopup').style.display = 'flex';
  _onPopupOpen();
}
