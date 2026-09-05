// Kitchen MEP — Menu view + PDF (read-only menu detail, print, delete, PDF generator) — feature
// module, classic script. Extracted from dashboard.html (monolith->modules restructure). Event-driven;
// entry points are inline handlers (openMenuView from a menu card / recipe tree, edit/print/delete from
// the view's buttons). Shared state _viewingMenu (top-level let, global lexical env) stays INLINE.
// editCurrentMenu calls openMenuPopup (js/menu-edit.js); buildMenuPdfHtml calls _escM (inline) — both
// resolve as globals at runtime. In the on-screen view (interactive=true) GR ingredients render as
// clickable links → openEditGRPopup (js/gr-edit.js); the print/PDF path keeps them as plain text.
// Reads shared globals allMenus, allGRs, adminCall, get, loadMenus, _refreshMepList, openEditGRPopup.

function openMenuView(menuId) {
  closeMenu();
  _viewingMenu = allMenus.find(m => m.id === menuId);
  if (!_viewingMenu) return;
  document.getElementById('mvp-title').textContent = _viewingMenu.name || 'Menu';
  const sheet = document.getElementById('menuViewSheet');
  sheet.innerHTML = buildMenuPdfHtml(_viewingMenu, true);  // interactive → GR ingredients are clickable
  // Click a GR sub-recipe → open that Grundrezeptur (matched by NAME first; codes drift from the GR master)
  sheet.querySelectorAll('.zutat-gr-link').forEach(link => {
    link.addEventListener('click', (e) => {
      e.stopPropagation();
      const nm = link.dataset.name || '', code = link.dataset.code || '';
      const grs = (typeof allGRs !== 'undefined' && Array.isArray(allGRs)) ? allGRs : [];
      const gr = grs.find(g => (g.name || '') === nm) || grs.find(g => (g.grCode || '') === code);
      if (gr && typeof openEditGRPopup === 'function') {
        document.getElementById('menuViewPopup').style.display = 'none';
        openEditGRPopup(gr.grCode);
      } else if (typeof showToast === 'function') {
        showToast('Grundrezeptur nicht gefunden: ' + (nm || code), 'warn');
      }
    });
  });
  document.getElementById('menuViewPopup').style.display = 'block';
  _onPopupOpen();
}

function editCurrentMenu() {
  if (!_viewingMenu) return;
  document.getElementById('menuViewPopup').style.display = 'none';
  openMenuPopup(_viewingMenu.id);
}

function printCurrentMenu() {
  if (!_viewingMenu) return;
  const html = buildMenuPdfHtml(_viewingMenu);
  const win = window.open('', '_blank');
  win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${_viewingMenu.name||'Menu'}</title>
    <style>body{margin:0;padding:0;font-family:monospace} @media print{body{margin:0}}</style>
    </head><body>${html}<script>window.onload=()=>{window.print();window.onafterprint=()=>window.close();}<\/script></body></html>`);
  win.document.close();
}

async function deleteCurrentMenu() {
  if (!_viewingMenu) return;
  if (!confirm(`"${_viewingMenu.name}" wirklich löschen?`)) return;
  try {
    const data = await adminCall({ action: 'deleteMenu', menuId: _viewingMenu.id });
    if (data.error) throw new Error(data.error);
    document.getElementById('menuViewPopup').style.display = 'none';
    _viewingMenu = null;
    await loadMenus();
  } catch(e) { alert('Fehler: ' + e.message); }
}

// ─────────────────────────────────────────────
// PDF HTML BUILDER (reused by view + print)
// ─────────────────────────────────────────────
function buildMenuPdfHtml(m, interactive) {
  const zutaten = (() => { try { return JSON.parse(m.zutaten || '[]'); } catch(e) { return []; } })();
  const wa  = parseFloat(m.wa || 0);
  const vk  = parseFloat(m.vk || 0);
  const fc  = vk > 0 ? ((wa/vk)*100).toFixed(1)+'%' : '—';
  const fcColor = (fc!=='—' && parseFloat(fc)>33) ? '#e86050' : '#2d8a5e';

  const zutatRows = zutaten.map(z => {
    if (z.type === 'gr') {
      const grSubs = Array.isArray(z.zutaten) ? z.zutaten : [];
      return `<tr style="background:#f7f5f0">
        <td style="padding:4px 6px;font-size:10px;color:#2d8a5e;font-weight:700">GR</td>
        <td style="padding:4px 6px;font-size:10px;font-weight:600">${z.gewicht?z.gewicht+' kg':'—'}</td>
        <td style="padding:4px 6px;font-size:11px;font-weight:700">${interactive
          ? `<span class="zutat-gr-link" data-name="${(z.name||'').replace(/"/g,'&quot;')}" data-code="${z.code||''}" style="color:#2d8a5e;text-decoration:underline;text-underline-offset:2px;cursor:pointer" title="Grundrezeptur öffnen ↗">${z.name||''} <span style="font-size:9px">↗</span></span>`
          : (z.name||'')} <span style="font-weight:400;color:#888">(${z.art||''})</span></td>
        <td style="padding:4px 6px;font-size:10px;color:#e8a020">CHF ${parseFloat(z.cost||0).toFixed(2)}</td>
      </tr>${grSubs.map(s=>`<tr>
        <td style="padding:2px 6px 2px 18px;font-size:9px;color:#888">↳ ${(s.type||'RM').toUpperCase()}</td>
        <td style="padding:2px 6px;font-size:9px;color:#888">${s.gewicht?s.gewicht+' kg':''}</td>
        <td style="padding:2px 6px;font-size:10px">${s.name||''}</td>
        <td style="padding:2px 6px;font-size:9px;color:#888">${s.allergie||''}</td>
      </tr>`).join('')}`;
    }
    return `<tr>
      <td style="padding:4px 6px;font-size:10px;color:#555">${(z.type||'RM').toUpperCase()}</td>
      <td style="padding:4px 6px;font-size:10px">${z.gewicht?z.gewicht+' kg':'—'}</td>
      <td style="padding:4px 6px;font-size:11px;font-weight:500">${z.name||''}</td>
      <td style="padding:4px 6px;font-size:10px;color:#e8a020">${z.cost?'CHF '+parseFloat(z.cost).toFixed(2):''}${z.allergie?'<br><span style="color:#888">⚠️'+z.allergie+'</span>':''}</td>
    </tr>`;
  }).join('');

  return `<div style="font-family:monospace,sans-serif;color:#1a1a16;min-height:600px">
    <div style="background:#1a1a16;padding:18px 24px;display:flex;align-items:center;gap:16px">
      <div style="flex:1">
        <div style="font-size:20px;font-weight:700;color:#fff">${m.name||'—'}</div>
        <div style="font-size:10px;color:#e8a020;letter-spacing:2px;text-transform:uppercase;margin-top:3px">212 Nooch Richti · ${m.saison||'All Year'}</div>
      </div>
      ${m.imageUrl?`<img src="${toDirectImg(m.imageUrl)}" style="width:160px;height:110px;object-fit:cover;border-radius:8px">`:''}
    </div>
    <div style="background:#f7f5f0;border-bottom:2px solid #e8a020;padding:8px 24px;display:flex;gap:24px;flex-wrap:wrap">
      ${[['Konzept',m.category],['Art',m.art],['Saison',m.saison],['Gewicht',m.gewicht],['WA','CHF '+wa.toFixed(2)],['VK','CHF '+vk.toFixed(2)],['FC',fc]].map(([l,v])=>`<div><div style="font-size:8px;letter-spacing:2px;text-transform:uppercase;color:#888">${l}</div><div style="font-size:12px;font-weight:600;color:${l==='FC'?fcColor:'#1a1a16'}">${v||'—'}</div></div>`).join('')}
    </div>
    <div style="padding:16px 20px;border-bottom:1px solid #eee">
      <div style="font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin-bottom:8px;color:#1a1a16">Zutaten</div>
      <table style="width:100%;border-collapse:collapse">
        <thead><tr style="background:#f0ede6">
          <th style="padding:3px 6px;font-size:8px;text-align:left;color:#888">Art</th>
          <th style="padding:3px 6px;font-size:8px;text-align:left;color:#888">Menge</th>
          <th style="padding:3px 6px;font-size:8px;text-align:left;color:#888">Name</th>
          <th style="padding:3px 6px;font-size:8px;text-align:left;color:#888">Kosten / Allergie</th>
        </tr></thead>
        <tbody>${zutatRows||`<tr><td colspan="4" style="padding:8px;font-size:11px;color:#999;font-style:italic">Keine Zutaten</td></tr>`}</tbody>
      </table>
    </div>
    ${zutaten.some(z=>z.isDeko)?`<div style="padding:12px 20px;border-bottom:1px solid #eee;background:#fafaf8">
      <div style="font-size:9px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#1a1a16;margin-bottom:4px">🌿 Dekoration</div>
      <div style="font-size:11px;color:#444">${zutaten.filter(z=>z.isDeko).map(z=>`${z.name}${z.gewicht?' ('+z.gewicht+'kg)':''}`).join(', ')}</div>
    </div>`:''}
    ${zutaten.some(z=>z.isTopping)?`<div style="padding:12px 20px;border-bottom:1px solid #eee;background:#fef9f0">
      <div style="font-size:9px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#1a1a16;margin-bottom:4px">🍯 Topping</div>
      <div style="font-size:11px;color:#444">${zutaten.filter(z=>z.isTopping).map(z=>`${z.name}${z.gewicht?' ('+z.gewicht+'kg)':''}`).join(', ')}</div>
    </div>`:''}
    ${m.zubereitung?`<div style="padding:16px 20px;border-bottom:1px solid #eee">
      <div style="font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin-bottom:8px;color:#1a1a16">Zubereitung</div>
      <div style="font-size:11px;color:#333;line-height:1.8;white-space:pre-wrap">${m.zubereitung}</div>
    </div>`:''}
    <div style="padding:8px 24px;border-top:1px solid #eee;display:flex;justify-content:space-between;font-size:9px;color:#aaa">
      <span>Mutationsdatum ${m.lastUpdate?new Date(m.lastUpdate).toLocaleDateString('de-CH'):'—'}</span>
      <span>Kitchen MEP · 212 Nooch Richti</span>
    </div>
  </div>`;
}
