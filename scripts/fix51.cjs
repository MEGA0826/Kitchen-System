// Repoint every zutaten row whose stored NAME belongs to a different existing code.
// The name is authoritative: "Yellow Tree mit Tofu" listing "GR Tofu, blanchiert" is
// not meant to pull Gochujang Ketchup.  node fix51.cjs [--apply]
const fs = require('fs'), path = require('path');
const APPLY = process.argv.includes('--apply');
const GAS = "https://script.google.com/macros/s/AKfycbz1aiIySe0-JwsLE4Vq8GyVwxS_7aRxyX48fvAWxP1cBeeOKFUK0w0mf7WCoe-9T8IHtQ/exec";
const SB = "https://clntikfffmjytexvzubq.supabase.co";
const KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNsbnRpa2ZmZm1qeXRleHZ6dWJxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAxODQwMzUsImV4cCI6MjA5NTc2MDAzNX0.6aiiiJk0hX1DrbXE1zMSYswwJT1FFkrgunJm9eznIXE";
const gasQ = async qs => { for (let i = 0; i < 6; i++) { const t = await (await fetch(GAS + "?" + qs)).text(); if (t.trim().startsWith("{")) return JSON.parse(t); await new Promise(r => setTimeout(r, 900)); } throw new Error("GAS failed: " + qs.slice(0, 60)); };
const sbGet = (t, q) => fetch(`${SB}/rest/v1/${t}?${q}`, { headers: { apikey: KEY, Authorization: "Bearer " + KEY } }).then(r => r.json());
const pZ = s => { try { const r = JSON.parse(s || '[]'); return Array.isArray(r) ? r : []; } catch (e) { return []; } };
const norm = s => String(s || '').toLowerCase()
  .replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/ü/g, 'u').replace(/ß/g, 'ss')
  .replace(/nooch\s*&?\s*negishi/g, ' ').replace(/q[1-4]\s*20\d\d/g, ' ')
  .replace(/[^a-z0-9]+/g, ' ').trim();

// The only stored name that matches two live codes. The owner picked SS-031.
const AMBIGUOUS = { 'umami roll 8 stk': 'SS-031' };

(async () => {
  const [inv, prod, gd, md] = await Promise.all([
    sbGet('inventory', 'select=code,name'), sbGet('products', 'select=code,name,active'),
    gasQ('action=getGRs'), gasQ('action=getMenus'),
  ]);
  const grs = gd.grs || [], menus = md.menus || [];
  const live = { rm: {}, mep: {}, gr: {}, menu: {}, plate: {} };
  inv.forEach(r => r.code && (live.rm[String(r.code).trim()] = r.name || ''));
  prod.filter(p => p.active !== false).forEach(p => p.code && (live.mep[String(p.code).trim()] = p.name || ''));
  grs.forEach(g => { const c = String(g.grCode || g.id || '').trim(); if (c) live.gr[c] = g.name || ''; });
  menus.forEach(m => { const c = String(m.menuCode || m.id || '').trim(); if (c) { live.menu[c] = m.name || ''; live.plate[c] = m.name || ''; } });

  // normalised live name -> codes, per type
  const byName = {};
  ['rm', 'mep', 'gr', 'menu'].forEach(t => { byName[t] = {}; Object.entries(live[t]).forEach(([c, n]) => {
    const k = norm(n); if (k) (byName[t][k] = byName[t][k] || []).push(c); }); });

  const plan = [];        // { kind, host, rows, changes[] }
  const skipped = [];
  const scan = (kind, host, hostCode, hostName) => {
    const rows = pZ(host.zutaten);
    const changes = [];
    rows.forEach((z, i) => {
      const c = String(z.code || '').trim(); if (!c) return;
      let t = String(z.type || 'rm').toLowerCase();
      if (t === 'plate') t = 'menu';
      const L = (live[t] || {})[c]; if (L === undefined) return;      // dangling: other tool
      const sn = norm(z.name); if (!sn || sn === norm(L)) return;
      let cands = (byName[t][sn] || []).filter(x => x !== c);
      if (!cands.length) { skipped.push({ kind, hostCode, i, code: c, stored: z.name, why: 'name matches no other code (dish was renamed)' }); return; }
      let target = cands[0];
      if (cands.length > 1) {
        const pick = AMBIGUOUS[sn];
        if (!pick || cands.indexOf(pick) < 0) { skipped.push({ kind, hostCode, i, code: c, stored: z.name, why: 'ambiguous: ' + cands.join(', ') }); return; }
        target = pick;
      }
      changes.push({ i, from: c, to: target, type: t, name: z.name, was: L, now: live[t][target], g: z.gewicht, cost: z.cost });
      rows[i] = Object.assign({}, z, { code: target });
    });
    if (changes.length) plan.push({ kind, host, hostCode, hostName, rows, changes });
  };
  grs.forEach(g => scan('gr', g, g.grCode || g.id, g.name));
  menus.forEach(m => scan('menu', m, m.menuCode || m.id, m.name));

  const total = plan.reduce((s, p) => s + p.changes.length, 0);
  console.log(`PLAN — ${total} row(s) in ${plan.length} recipe(s)\n`);
  plan.forEach(p => {
    console.log(`${p.kind.toUpperCase()} ${p.hostCode}  "${String(p.hostName).slice(0, 38)}"`);
    p.changes.forEach(c => console.log(
      `   row ${c.i}  "${String(c.name).slice(0, 40)}"  ${c.g}kg\n`
      + `      ${c.type}:${c.from} "${String(c.was).slice(0, 34)}"  ->  ${c.type}:${c.to} "${String(c.now).slice(0, 34)}"`));
  });
  if (skipped.length) {
    console.log(`\nSKIPPED ${skipped.length} (left untouched):`);
    skipped.forEach(s => console.log(`   ${s.kind} ${s.hostCode} row ${s.i} [${s.code}] "${String(s.stored).slice(0, 34)}" — ${s.why}`));
  }

  if (!APPLY) { console.log('\nDRY RUN — nothing written. Re-run with --apply.'); return; }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const bak = path.join(__dirname, `fix51_backup_${stamp}.json`);
  fs.writeFileSync(bak, JSON.stringify({ when: stamp, plan: plan.map(p => ({ kind: p.kind, code: p.hostCode, changes: p.changes, original: p.host })) }, null, 1));
  console.log(`\nbackup: ${bak}`);

  let ok = 0, fail = 0;
  for (const p of plan) {
    const h = p.host;
    let qs;
    if (p.kind === 'menu') {
      qs = new URLSearchParams({ action: 'saveMenu', menuId: h.id, name: h.name, category: h.category || '', art: h.art || '',
        saison: h.saison || '', gewicht: h.gewicht == null ? '' : h.gewicht, menuCode: h.menuCode,
        garverlust: h.garverlust == null ? '' : h.garverlust, wa: h.wa == null ? '' : h.wa, vk: h.vk == null ? '' : h.vk,
        deko: h.deko || '', zubereitung: h.zubereitung || '', zutaten: JSON.stringify(p.rows),
        imageUrl: h.imageUrl || '', logoUrl: h.logoUrl || '', lastUpdate: new Date().toISOString() }).toString();
    } else {
      // grId is REQUIRED — without it GAS saveGR appends a duplicate row.
      qs = new URLSearchParams({ action: 'saveGR', grId: h.id, grCode: h.grCode, name: h.name,
        art: h.art || 'Grundrezeptur', rohgewicht: h.rohgewicht == null ? '' : h.rohgewicht,
        garverlust: h.garverlust == null ? '' : h.garverlust, wa: h.wa == null ? '' : h.wa,
        zutaten: JSON.stringify(p.rows), zubereitung: h.zubereitung || '' }).toString();
    }
    try {
      const d = await gasQ(qs);
      if (d && d.error) throw new Error(d.error);
      ok++; console.log(`✓ ${p.kind} ${p.hostCode} — ${p.changes.length} row(s)`);
    } catch (e) { fail++; console.log(`✗ ${p.kind} ${p.hostCode}: ${e.message}`); }
  }

  // verify
  const g2 = (await gasQ('action=getGRs')).grs || [], m2 = (await gasQ('action=getMenus')).menus || [];
  const dupG = Object.entries(g2.reduce((a, g) => (a[g.grCode] = (a[g.grCode] || 0) + 1, a), {})).filter(([, n]) => n > 1);
  const dupM = Object.entries(m2.reduce((a, m) => (a[m.menuCode] = (a[m.menuCode] || 0) + 1, a), {})).filter(([, n]) => n > 1);
  let left = 0;
  const recheck = (t0, host, hostCode) => pZ(host.zutaten).forEach(z => {
    const c = String(z.code || '').trim(); if (!c) return;
    let t = String(z.type || 'rm').toLowerCase(); if (t === 'plate') t = 'menu';
    const L = (live[t] || {})[c]; if (L === undefined) return;
    const sn = norm(z.name); if (!sn || sn === norm(L)) return;
    if ((byName[t][sn] || []).filter(x => x !== c).length) { left++; console.log(`   still wrong: ${hostCode} [${t}:${c}] "${z.name}"`); }
  });
  g2.forEach(g => recheck('gr', g, g.grCode)); m2.forEach(m => recheck('menu', m, m.menuCode));

  console.log(`\nwrote ${ok}, failed ${fail}`);
  console.log(`GR rows:   ${grs.length} -> ${g2.length}  ${grs.length === g2.length ? '(unchanged ✓)' : '⚠ CHANGED'}   dup codes: ${dupG.length || 'none ✓'}`);
  console.log(`Menu rows: ${menus.length} -> ${m2.length}  ${menus.length === m2.length ? '(unchanged ✓)' : '⚠ CHANGED'}   dup codes: ${dupM.length || 'none ✓'}`);
  console.log(`wrong-dish references left: ${left}  ${left === 0 ? '✓' : ''}`);
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
