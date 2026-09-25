# `saveGR` patch — stop creating a duplicate Grundrezeptur on every save

## What goes wrong today

`saveGR` **appends a new row** instead of updating the existing one. Every save of an
existing GR therefore leaves a second copy behind, with the same `grCode`.

On 2026-09-24 this took the GR sheet from **92 rows / 92 codes / 0 duplicates** to
**233 rows / 92 codes / 37 duplicated codes** — GR-066 and GR-037 existed nine times
each. (Cleaned up on 2026-09-25, but it will happen again on the next GR edit.)

`saveMenu` is unaffected: the client sends `menuId` with it, so it can find the row.
`saveGR` only ever receives `grCode`, so the fix is to look the row up by that.

**Symptoms it explains:** edits that "don't save" (you edit one copy, the app reads
another), a GR list with repeated entries, and the Relations diagram drawing one
arrow per copy.

---

## The patch

Replace your whole existing `saveGR` function with the version below.

Two things to keep from your current code:

1. **The signature.** If yours is `function saveGR(e)`, keep that and start the body
   with `const p = e.parameter;`. The version below takes the params object directly.
2. **The sheet lookup.** Use whatever your other handlers use — `getSheet_("GR")`,
   `ss.getSheetByName("Grundrezepturen")`, a constant, etc. Replace the marked line.

```javascript
function saveGR(p) {
  const sh = ss.getSheetByName(GR_SHEET);          // ← use YOUR existing sheet lookup
  if (!sh) throw new Error("GR sheet not found");

  const data = sh.getDataRange().getValues();
  const head = data[0].map(h => String(h || "").trim().toLowerCase());

  // Column positions are read from the header row, so re-ordering columns is safe.
  const col = name => head.indexOf(name);
  const cId   = col("id");
  const cCode = col("grcode") >= 0 ? col("grcode") : col("gr_code");
  const cUpd  = col("lastupdate") >= 0 ? col("lastupdate") : col("last_update");
  if (cCode < 0) throw new Error("GR sheet has no grCode column");

  const code = String(p.grCode || "").trim();
  if (!code) throw new Error("grCode is required");

  // URL parameters always arrive as text. Numeric columns must go in as numbers,
  // otherwise "0.165" lands in the sheet as a string and later maths reads it as 0.
  const num = v => (v === undefined || v === null || String(v).trim() === "")
    ? v : (isNaN(Number(v)) ? v : Number(v));

  // Write only the fields the caller actually sent, so a partial save cannot blank
  // out the rest of the row.
  const fields = {
    grcode:       code,
    name:         p.name,
    art:          p.art,
    rohgewicht:   num(p.rohgewicht),
    garverlust:   num(p.garverlust),
    nettogewicht: num(p.nettogewicht),
    wa:           num(p.wa),
    zutaten:      p.zutaten,
    zubereitung:  p.zubereitung,
  };

  // Find the existing row by code (rows are 1-based; row 1 is the header).
  let rowIndex = -1;
  for (let r = 1; r < data.length; r++) {
    if (String(data[r][cCode] || "").trim() === code) { rowIndex = r; break; }
  }

  if (rowIndex >= 0) {
    // ── UPDATE in place ────────────────────────────────────────────────────────
    const row = data[rowIndex].slice();
    Object.keys(fields).forEach(key => {
      const c = col(key);
      if (c >= 0 && fields[key] !== undefined && fields[key] !== null) row[c] = fields[key];
    });
    if (cUpd >= 0) row[cUpd] = new Date().toISOString();
    sh.getRange(rowIndex + 1, 1, 1, row.length).setValues([row]);
    return { status: "ok", grCode: code, updated: true };
  }

  // ── APPEND a new GR ──────────────────────────────────────────────────────────
  const row = new Array(head.length).fill("");
  Object.keys(fields).forEach(key => {
    const c = col(key);
    if (c >= 0 && fields[key] !== undefined && fields[key] !== null) row[c] = fields[key];
  });
  if (cId >= 0 && !row[cId]) row[cId] = Utilities.getUuid();
  if (cUpd >= 0) row[cUpd] = new Date().toISOString();
  sh.appendRow(row);
  return { status: "ok", grCode: code, updated: false, created: true };
}
```

Then **Deploy → Manage deployments → edit → Deploy** (keep the same URL).

---

## Check it worked

1. Note how many GRs you have (Dashboard → Recipes → Grundrezepturen).
2. Open any GR, change nothing, press Save.
3. Reload. **The count must be unchanged.** Before the patch it grew by one.

A second check, if you want certainty: save a GR twice with a small edit to the
preparation text, then confirm only one row carries that text.

---

## After the patch

Re-enable GR writing in the two Admin tools, which currently skip Grundrezepturen:

- `js/relink.js` — set `GR_WRITES_DISABLED = false`
- `js/relink.js` — in `_rlApplyRecalc`, delete the `if (p.kind === 'gr') { … continue; }` guard
- `dashboard.html` — remove the red warning from the "Zutaten verknüpfen" admin card

Then run **Zutaten verknüpfen** and **Preise & WA neu berechnen** once; they will fix
the GR rows they have been skipping.

---

## Related, not fixed here

`_nextBatchCode('GR')` can hand out a code that is already taken. That is how
"GR Vegan Hack für Mapo-Tofu" ended up saved onto **GR-070**, which belonged to
"GR Reisnudeln 10mm, eingeweicht". Worth making it check the live GR list before
returning a code.
