// Write the RM rows that exist in Supabase `inventory` but are missing from the Lager
// sheet. Supabase is authoritative. INSERT ONLY — no existing Lager row is read back,
// updated or deleted, so nothing already in the sheet (including live stock counts
// that deductLager maintains there) can be clobbered.
//   node fix_lager.cjs [--apply]
const fs = require('fs'), path = require('path');
const APPLY = process.argv.includes('--apply');
const GAS = "https://script.google.com/macros/s/AKfycbz1aiIySe0-JwsLE4Vq8GyVwxS_7aRxyX48fvAWxP1cBeeOKFUK0w0mf7WCoe-9T8IHtQ/exec";
const SB = "https://clntikfffmjytexvzubq.supabase.co";
const KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNsbnRpa2ZmZm1qeXRleHZ6dWJxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAxODQwMzUsImV4cCI6MjA5NTc2MDAzNX0.6aiiiJk0hX1DrbXE1zMSYswwJT1FFkrgunJm9eznIXE";
const gasQ = async qs => { for (let i = 0; i < 6; i++) { const t = await (await fetch(GAS + "?" + qs)).text(); if (t.trim().startsWith("{")) return JSON.parse(t); await new Promise(r => setTimeout(r, 900)); } throw new Error("GAS failed: " + qs.slice(0, 50)); };
const sbGet = (t, q) => fetch(`${SB}/rest/v1/${t}?${q}`, { headers: { apikey: KEY, Authorization: "Bearer " + KEY } }).then(r => r.json());
const S = v => v === null || v === undefined ? '' : String(v).trim();
const N = v => v === null || v === undefined || v === '' ? '' : String(v);

(async () => {
  const [sb, gd] = await Promise.all([
    sbGet('inventory', 'select=code,name,kategorie,unit,quantity,weight_unit,minimum,maximum,kosten_unit,lieferant,last_order,notizen,allergen&order=code.asc'),
    gasQ('action=inventory'),
  ]);
  const sheet = gd.inventory || [];
  const inSheet = new Set(sheet.map(r => S(r.code)).filter(Boolean));
  const inSb = new Set(sb.map(r => S(r.code)).filter(Boolean));

  const missing = sb.filter(r => S(r.code) && !inSheet.has(S(r.code)));
  const sheetOnly = sheet.filter(r => S(r.code) && !inSb.has(S(r.code)));

  console.log(`Supabase inventory : ${inSb.size}`);
  console.log(`Lager sheet        : ${inSheet.size}`);
  console.log(`missing from sheet : ${missing.length}   <- will be INSERTED`);
  console.log(`sheet-only (not in Supabase): ${sheetOnly.length}   <- reported only, never touched`);
  if (sheetOnly.length) sheetOnly.slice(0, 20).forEach(r => console.log(`   ${S(r.code).padEnd(10)} ${S(r.name).slice(0, 50)}`));

  console.log(`\nTO INSERT:`);
  missing.forEach(r => console.log(
    `   ${S(r.code).padEnd(11)} ${S(r.name).slice(0, 42).padEnd(44)} unit=${S(r.unit).padEnd(5)} qty=${N(r.quantity).padEnd(6)}`
    + ` w/u=${N(r.weight_unit).padEnd(6)} CHF/u=${N(r.kosten_unit).padEnd(8)} ${S(r.lieferant).slice(0, 16)}`));
  const noAllergen = missing.filter(r => S(r.allergen));
  if (noAllergen.length) console.log(`\n   note: the Lager sheet has no allergen column, so these ${noAllergen.length} allergen values stay Supabase-only: `
    + noAllergen.map(r => S(r.code) + '=' + S(r.allergen)).join(', '));

  if (!missing.length) { console.log('\nnothing to do'); return; }
  if (!APPLY) { console.log('\nDRY RUN — nothing written. Re-run with --apply.'); return; }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const bak = path.join(__dirname, `lager_insert_${stamp}.json`);
  fs.writeFileSync(bak, JSON.stringify({ when: stamp, inserted: missing, sheetBefore: inSheet.size }, null, 1));
  console.log(`\nbackup of what is being added: ${bak}`);

  let ok = 0, fail = 0;
  for (const r of missing) {
    // saveInventory appends a new row and sets the G/K total formulas itself.
    const qs = new URLSearchParams({
      action: 'saveInventory', code: S(r.code), name: S(r.name), kategorie: S(r.kategorie),
      unit: S(r.unit) || 'kg', quantity: N(r.quantity) || '0', weightUnit: N(r.weight_unit),
      minimum: N(r.minimum), maximum: N(r.maximum), kostenUnit: N(r.kosten_unit),
      lieferant: S(r.lieferant), lastOrder: S(r.last_order), notizen: S(r.notizen),
    }).toString();
    try {
      const d = await gasQ(qs);
      if (d && d.error) throw new Error(d.error);
      ok++; console.log(`✓ ${S(r.code)} ${S(r.name).slice(0, 44)}`);
    } catch (e) { fail++; console.log(`✗ ${S(r.code)}: ${e.message}`); }
  }

  // verify
  const after = (await gasQ('action=inventory')).inventory || [];
  const codes = {};
  after.forEach(r => { const c = S(r.code); if (c) codes[c] = (codes[c] || 0) + 1; });
  const dups = Object.entries(codes).filter(([, n]) => n > 1);
  const stillMissing = sb.filter(r => S(r.code) && !codes[S(r.code)]);
  console.log(`\nwrote ${ok}, failed ${fail}`);
  console.log(`Lager codes: ${inSheet.size} -> ${Object.keys(codes).length}  (expected ${inSheet.size + missing.length})`);
  console.log(`duplicate codes in Lager: ${dups.length ? dups.map(([c, n]) => c + 'x' + n).join(', ') : 'NONE ✓'}`);
  console.log(`Supabase codes still missing from the sheet: ${stillMissing.length}  ${stillMissing.length ? stillMissing.map(r => S(r.code)).join(', ') : '✓'}`);
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
