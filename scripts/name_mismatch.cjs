// A reference can RESOLVE and still be wrong. After the Sept-26 renumbering some rows
// kept their old code while the dish that code now names is a different one. The
// dangling audit cannot see these — the code exists, it just points somewhere else.
// Read-only.
const GAS = "https://script.google.com/macros/s/AKfycbz1aiIySe0-JwsLE4Vq8GyVwxS_7aRxyX48fvAWxP1cBeeOKFUK0w0mf7WCoe-9T8IHtQ/exec";
const SB = "https://clntikfffmjytexvzubq.supabase.co";
const KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNsbnRpa2ZmZm1qeXRleHZ6dWJxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAxODQwMzUsImV4cCI6MjA5NTc2MDAzNX0.6aiiiJk0hX1DrbXE1zMSYswwJT1FFkrgunJm9eznIXE";
const gas = async a => { for (let i = 0; i < 6; i++) { const t = await (await fetch(GAS + "?action=" + a)).text(); if (t.trim().startsWith("{")) return JSON.parse(t); await new Promise(r => setTimeout(r, 900)); } throw new Error("fail " + a); };
const sbGet = (t, q) => fetch(`${SB}/rest/v1/${t}?${q}`, { headers: { apikey: KEY, Authorization: "Bearer " + KEY } }).then(r => r.json());
const pZ = s => { try { const r = JSON.parse(s || '[]'); return Array.isArray(r) ? r : []; } catch (e) { return []; } };
const norm = s => String(s || '').toLowerCase()
  .replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/ü/g, 'u').replace(/ß/g, 'ss')
  .replace(/nooch\s*&?\s*negishi/g, ' ').replace(/q[1-4]\s*20\d\d/g, ' ')
  .replace(/[^a-z0-9]+/g, ' ').trim();

(async () => {
  const [inv, prod, gd, md] = await Promise.all([
    sbGet('inventory', 'select=code,name'), sbGet('products', 'select=code,name,active'),
    gas('getGRs'), gas('getMenus'),
  ]);
  const grs = gd.grs || [], menus = md.menus || [];

  // live name per type:code, and a reverse index normName -> [type:code]
  const live = { rm: {}, mep: {}, gr: {}, menu: {}, plate: {} };
  inv.forEach(r => r.code && (live.rm[String(r.code).trim()] = r.name || ''));
  prod.filter(p => p.active !== false).forEach(p => p.code && (live.mep[String(p.code).trim()] = p.name || ''));
  grs.forEach(g => { const c = String(g.grCode || g.id || '').trim(); if (c) live.gr[c] = g.name || ''; });
  menus.forEach(m => { const c = String(m.menuCode || m.id || '').trim(); if (c) { live.menu[c] = m.name || ''; live.plate[c] = m.name || ''; } });
  const byName = {};
  ['rm', 'mep', 'gr', 'menu'].forEach(t => Object.entries(live[t]).forEach(([c, n]) => {
    const k = norm(n); if (k) (byName[k] = byName[k] || []).push(t + ':' + c);
  }));

  const shifted = [], stale = [];
  let checked = 0;
  const scan = (kind, hostCode, hostName, zutaten) => {
    pZ(zutaten).forEach((z, i) => {
      const c = String(z.code || '').trim(); if (!c) return;
      const t = String(z.type || 'rm').toLowerCase();
      const L = (live[t] || {})[c]; if (L === undefined) return;      // dangling, other audit
      checked++;
      const sn = norm(z.name), ln = norm(L);
      if (!sn || sn === ln) return;
      const elsewhere = (byName[sn] || []).filter(x => x !== t + ':' + c);
      const row = { kind, hostCode, hostName, i, type: t, code: c, stored: z.name, livename: L, elsewhere, g: z.gewicht };
      if (elsewhere.length) shifted.push(row); else stale.push(row);
    });
  };
  grs.forEach(g => scan('GR', g.grCode || g.id, g.name, g.zutaten));
  menus.forEach(m => scan(m.art === 'Plate' ? 'PLATE' : 'MENU', m.menuCode || m.id, m.name, m.zutaten));

  console.log(`resolvable coded rows checked: ${checked}`);
  console.log(`name matches the code        : ${checked - shifted.length - stale.length}`);
  console.log(`\n🚨 POINTS AT A DIFFERENT DISH : ${shifted.length}`);
  console.log(`   (stored name belongs to another code that EXISTS — the reference resolves but is wrong)`);
  shifted.forEach(r => console.log(
    `   ${r.kind} ${r.hostCode} "${String(r.hostName).slice(0, 24)}" row ${r.i}  g=${r.g}\n`
    + `      row says : "${String(r.stored).slice(0, 46)}"  -> that name is ${r.elsewhere.join(', ')}\n`
    + `      but points at ${r.type}:${r.code} = "${String(r.livename).slice(0, 46)}"`));

  console.log(`\n⚠️  stale name only          : ${stale.length}  (dish was renamed; the code still points at the right row)`);
  stale.slice(0, 12).forEach(r => console.log(
    `   ${r.kind} ${r.hostCode} row ${r.i}  [${r.type}:${r.code}] "${String(r.stored).slice(0, 34)}" -> now "${String(r.livename).slice(0, 34)}"`));
  if (stale.length > 12) console.log(`   … +${stale.length - 12} more`);
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
