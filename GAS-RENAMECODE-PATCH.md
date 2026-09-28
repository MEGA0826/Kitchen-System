# `renameCode` patch — rename a code in one place, everywhere

## What goes wrong today

A code is a **foreign key stored as text in a dozen places**, and nothing keeps those
copies in step. Rename `SS-059` and the Menus sheet accepts it silently, while every
other recipe that lists it as an ingredient still holds the string `SS-059` inside its
`zutaten` JSON. The reference now points at nothing:

- the ingredient costs **CHF 0** (its price comes from the row it can no longer find)
- the **Relations** diagram drops the link, and shows the dead code as a bare node
- the **BOM calculator** under-counts that branch
- the allergen roll-up misses everything below the dead reference

On 2026-09-26 renumbering ~60 codes left `SS-059` dangling in three menus and
`GR-111` in one. Build 175 fixed the two renames that happen **inside the app**
(`js/relink.js` → `_ccCascade`, called by the GR and Menu editors). This patch closes
the other two doors: renames done **by hand in the sheet**, and renames of **RM and
MEP codes**, which the app cannot cascade because their code fields are read-only.

### Everywhere a code lives

Verified against the live `code.gs` (v16):

| Code kind | Home | Stored again in |
|---|---|---|
| **RM** | `Lager` A | `MEP` C *(rows where G=Type is `rm`)* · `Deductions` D · `GR.zutaten[].code` · `Menus.zutaten[].code` |
| **MEP** | `Produkt` A | `MEP` A · `MEP` C *(rows where G=Type is `mep`)* · `Scan` C · `Archive` C · `MEP_Stock` B · `Deductions` C · `Rezeptur` B · `GR.zutaten` · `Menus.zutaten` |
| **GR** | `GR` B (`grCode`) | `MEP` C *(rows where G=Type is `gr`)* · `GR.zutaten` · `Menus.zutaten` |
| **Menu** | `Menus` B (`menuCode`) | `Rezeptur` A · `Menus.zutaten` · `GR.zutaten` |

Three things worth knowing about this table:

- **`MEP` is the recipe sheet** — `A=MEP Code B=MEP Name C=RM Code D=RM Name E=Menge
  F=Einheit G=Type H=Garverlust`. There is no `Rezept` sheet. Column C is **not
  RM-only**: `G=Type` decides whether it holds an `rm`, `mep` or `gr` code, so a rename
  of any of the three has to look there, filtered by Type.
- **`Sales_History` has no code column at all** — its header is
  `Datum · Produkt · Kategorie · Menge · Umsatz CHF · Preis · WA · Produktmarge ·
  Imported`. It stores the product *name*. Nothing to rename.
- **`Rezeptur` links Menu → MEP**, written by `saveMenuMep` as
  `[menuCode, mepCode, step, weight, desc]`, and it has **no header row**.

Plates live in the browser's `localStorage` (`rt_plates`) and cannot be reached from
the server — the audit below cannot see them either, so re-pick those by hand.

---

## Two bugs in the live `code.gs`, found while mapping this

Neither is caused by this patch. Both are worth fixing separately.

1. **`Rezeptur` is read with two different meanings.** `saveMenuMep` writes
   `[menuCode, mepCode, …]`, but `allergenPDF` reads the same sheet as
   `mc = row[0]` (*mepCode*) and `rc = row[1]` (*rmCode*), then looks `rc` up in the
   Produkt allergen index. So the allergen roll-up is resolving menu codes as MEP
   codes and MEP codes as RM codes — it will silently find nothing there.
2. **`Rezeptur` has no header row, but is read from row 2.** `getOrCreateSheet`
   creates it bare and `saveMenuMep` reads `getRange(2, 1, …)`, so the first link ever
   written sits in row 1 and is invisible to every later read and to the dedupe check.

Because of #2 this patch treats `Rezeptur` as headerless and addresses it by position.

---

## Before you paste anything: check the map

The map below is built from your live `code.gs`, but **column positions still come from
what the code writes, not from what your sheet currently contains** — a hand-inserted
column would shift them. The patch therefore resolves every column **by header name
first**, falls back to the declared position, and **skips sheets it cannot find**
instead of throwing.

Run `listCodeTargets()` once from the Apps Script editor and read the log. It prints
what it actually resolved in your spreadsheet, and `Rezeptur` should be the only line
that resolves `by position`. Fix the map, not the logic.

---

## The patch

Paste this whole block at the end of `code.gs`. It adds no dependencies and changes
nothing that already exists.

```javascript
/* ═══════════════════════════════════════════════════════════════════════════
   CODE RENAME — move a code and every reference to it, in one operation
   Actions:  listCodeTargets   (diagnostic, read-only — run from the editor)
             auditCodes        (read-only: every reference that points at nothing)
             renameCode        (&kind=&oldCode=&newCode=  [&dryRun=1] [&newName=])
   ═══════════════════════════════════════════════════════════════════════════ */

// Zutaten row types that count as a reference to a recipe of this kind. A menu with
// art="Plate" is still a menu row, but rows sometimes label it "plate".
const RC_TYPES = { rm: ["rm"], mep: ["mep"], gr: ["gr"], menu: ["menu", "plate"] };

// Every place a code is stored.
//   sheet   sheet name, or a list of candidates — the first one that exists wins
//   header  header cells to look for (lower-cased, trimmed); first match wins
//   col     1-based fallback column when no header matches
//   kinds   which code kinds this column holds
//   home    this column is where that kind is DEFINED (the canonical row)
//   json    this column holds a zutaten-style JSON array instead of a bare code
const CODE_TARGETS = [
  // ── home rows ────────────────────────────────────────────────────────────
  { sheet: "Produkt", header: ["code"],                  col: 1, kinds: ["mep"],  home: "mep"  },
  { sheet: "Lager",   header: ["code"],                  col: 1, kinds: ["rm"],   home: "rm"   },
  { sheet: "GR",      header: ["grcode", "gr_code"],     col: 1, kinds: ["gr"],   home: "gr"   },
  { sheet: "Menus",   header: ["menucode", "menu_code"], col: 1, kinds: ["menu"], home: "menu" },
  // ── references: bare code columns ────────────────────────────────────────
  { sheet: ["Rezept", "Rezeptur"], header: ["mepcode", "mep_code", "mep code"], col: 1, kinds: ["mep"] },
  { sheet: ["Rezept", "Rezeptur"], header: ["rmcode", "rm_code", "rm code"],    col: 3, kinds: ["rm"]  },
  { sheet: "Scan",           header: ["code", "product_code", "productcode"], col: 3, kinds: ["mep"] },
  { sheet: "Archive",        header: ["code", "product_code", "productcode"], col: 3, kinds: ["mep"] },
  { sheet: "MEP_Stock",      header: ["product_code", "productcode", "code"], col: 1, kinds: ["mep"] },
  { sheet: "Deductions",     header: ["mep_code", "mepcode"],                 col: 3, kinds: ["mep"] },
  { sheet: "Deductions",     header: ["rm_code", "rmcode"],                   col: 4, kinds: ["rm"]  },
  { sheet: "Sales_History",  header: ["product_code", "productcode"],         col: 3, kinds: ["mep"] },
  { sheet: "Menu_Sales_Map", header: ["menu_code", "menucode"],               col: 2, kinds: ["menu"] },
  // ── references: zutaten JSON ─────────────────────────────────────────────
  { sheet: "GR",    header: ["zutaten"], col: 9,  json: true, kinds: ["rm", "mep", "gr", "menu"] },
  { sheet: "Menus", header: ["zutaten"], col: 11, json: true, kinds: ["rm", "mep", "gr", "menu"] },
];

function rcSheet_(ss, name) {
  const names = Array.isArray(name) ? name : [name];
  for (let i = 0; i < names.length; i++) {
    const sh = ss.getSheetByName(names[i]);
    if (sh) return sh;
  }
  return null;
}

function columnLetter_(n) {
  let s = "";
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - 1 - m) / 26; }
  return s;
}

// Resolve one target against the live spreadsheet. Returns null when the sheet is
// absent or the column cannot be located — a kitchen without a Deductions sheet must
// still be able to rename.
function rcResolve_(ss, t) {
  const sh = rcSheet_(ss, t.sheet);
  if (!sh) return null;
  const lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
  if (lastRow < 1 || lastCol < 1) return null;
  const head = sh.getRange(1, 1, 1, lastCol).getValues()[0]
                 .map(h => String(h == null ? "" : h).trim().toLowerCase());
  let col = -1;
  for (let i = 0; i < t.header.length && col < 0; i++) col = head.indexOf(t.header[i]);
  let how = "header";
  if (col < 0) {                                  // fall back to the declared position
    if (!t.col || t.col > lastCol) return null;
    col = t.col - 1; how = "position";
  }
  return { t: t, sh: sh, name: sh.getName(), col: col, how: how, lastRow: lastRow };
}

// ── diagnostic: what did the map actually find? ─────────────────────────────
function listCodeTargets() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const out = [];
  CODE_TARGETS.forEach(t => {
    const r = rcResolve_(ss, t);
    const want = Array.isArray(t.sheet) ? t.sheet.join(" | ") : t.sheet;
    out.push(r
      ? "OK    " + r.name + "  col " + (r.col + 1) + " (" + columnLetter_(r.col + 1) + ") by " + r.how +
        "  kinds=" + t.kinds.join(",") + (t.json ? "  [JSON]" : "") + (t.home ? "  HOME of " + t.home : "") +
        "  rows=" + Math.max(0, r.lastRow - 1)
      : "SKIP  " + want + "  — sheet or column not found (headers tried: " + t.header.join(", ") + ")");
  });
  Logger.log(out.join("\n"));
  return jsonResponse({ targets: out });
}

// Every code that currently exists, per kind — so we can tell a real reference from a
// row whose `type` is simply mislabelled.
function rcUniverse_(ss) {
  const u = { rm: {}, mep: {}, gr: {}, menu: {}, plate: {} };   // code -> name
  CODE_TARGETS.filter(t => t.home).forEach(t => {
    const r = rcResolve_(ss, t);
    if (!r || r.lastRow < 2) return;
    const w = r.sh.getLastColumn();
    const head = r.sh.getRange(1, 1, 1, w).getValues()[0]
                   .map(h => String(h == null ? "" : h).trim().toLowerCase());
    let nameCol = head.indexOf("name");
    if (nameCol < 0) nameCol = r.col === 0 ? 1 : 0;   // the column next to the code
    r.sh.getRange(2, 1, r.lastRow - 1, w).getValues().forEach(row => {
      const c = String(row[r.col] == null ? "" : row[r.col]).trim();
      if (c) u[t.home][c] = String(row[nameCol] == null ? "" : row[nameCol]).trim();
    });
  });
  Object.keys(u.menu).forEach(c => { u.plate[c] = u.menu[c]; });   // a plate IS a menu row
  return u;
}

// Rewrite one zutaten JSON string. Returns { json, n }, or null when it is not parsable
// JSON — those cells are left untouched rather than guessed at.
function rcRewriteJson_(raw, kind, oldCode, newCode, newName, owned) {
  const s = String(raw == null ? "" : raw);
  if (!s.trim()) return { json: s, n: 0 };
  let arr;
  try { arr = JSON.parse(s); } catch (e) { return null; }
  if (!Array.isArray(arr)) return null;
  const okTypes = RC_TYPES[kind] || [kind];
  let n = 0;
  for (let i = 0; i < arr.length; i++) {
    const z = arr[i];
    if (!z || typeof z !== "object") continue;
    if (String(z.code == null ? "" : z.code).trim() !== oldCode) continue;
    const t = String(z.type || "rm").toLowerCase();
    // A disagreeing type only blocks the match when that type really owns the code —
    // i.e. the row points somewhere else. The PDF import wrote menus as type "rm",
    // and those rows must still be moved.
    if (okTypes.indexOf(t) < 0 && owned(t, oldCode)) continue;
    z.code = newCode;
    if (okTypes.indexOf(t) < 0) z.type = kind;
    // Rows keep a snapshot of the name; a stale one defeats the name-matching repair
    // in the app's «Zutaten verknüpfen» tool later.
    if (newName) z.name = newName;
    n++;
  }
  return { json: n ? JSON.stringify(arr) : s, n: n };
}

// ── the rename ─────────────────────────────────────────────────────────────
function renameCode(p) {
  const kind    = String(p.kind    || "").trim().toLowerCase();
  const oldCode = String(p.oldCode || "").trim();
  const newCode = String(p.newCode || "").trim();
  const dryRun  = String(p.dryRun || "") === "1" || String(p.dryRun || "") === "true";

  if (!RC_TYPES[kind])      return jsonResponse({ error: "kind must be rm, mep, gr or menu" });
  if (!oldCode || !newCode) return jsonResponse({ error: "oldCode and newCode are required" });
  if (oldCode === newCode)  return jsonResponse({ error: "oldCode and newCode are the same" });
  if (newCode.length > 40)  return jsonResponse({ error: "newCode is too long" });

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return jsonResponse({ error: "busy — another write is running, try again" });
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const u  = rcUniverse_(ss);
    const owned = (t, c) => !!(u[t] && Object.prototype.hasOwnProperty.call(u[t], c));

    // Validate BEFORE touching anything.
    if (!owned(kind, oldCode)) return jsonResponse({ error: kind.toUpperCase() + " " + oldCode + " does not exist" });
    if (owned(kind, newCode))  return jsonResponse({ error: newCode + " already exists (" + u[kind][newCode] + ") — pick a free code" });

    // The name stamped onto every reference: whatever the home row says, unless the
    // caller is renaming and retitling in one go.
    const newName = String(p.newName || u[kind][oldCode] || "").trim();

    // ── plan every cell change ───────────────────────────────────────────────
    const plan = [];       // { name, col, row, before, after, rows }
    const report = [];     // one line per sheet, for the caller
    let cells = 0, refRows = 0, unparsable = 0;

    CODE_TARGETS.forEach(t => {
      if (t.kinds.indexOf(kind) < 0) return;
      const r = rcResolve_(ss, t);
      if (!r) { report.push({ sheet: Array.isArray(t.sheet) ? t.sheet[0] : t.sheet, skipped: "not found" }); return; }
      if (r.lastRow < 2) { report.push({ sheet: r.name, cells: 0 }); return; }
      const vals = r.sh.getRange(2, r.col + 1, r.lastRow - 1, 1).getValues();
      let hits = 0, rows = 0;
      for (let i = 0; i < vals.length; i++) {
        const raw = vals[i][0];
        if (t.json) {
          const res = rcRewriteJson_(raw, kind, oldCode, newCode, newName, owned);
          if (res === null) { unparsable++; continue; }
          if (!res.n) continue;
          plan.push({ name: r.name, col: r.col + 1, row: i + 2, before: String(raw), after: res.json, rows: res.n });
          hits++; rows += res.n;
        } else {
          if (String(raw == null ? "" : raw).trim() !== oldCode) continue;
          plan.push({ name: r.name, col: r.col + 1, row: i + 2, before: String(raw), after: newCode, rows: 1 });
          hits++; rows += 1;
        }
      }
      cells += hits; refRows += rows;
      report.push({ sheet: r.name, column: columnLetter_(r.col + 1), by: r.how,
                    json: !!t.json, home: t.home === kind, cells: hits, rows: rows });
    });

    if (dryRun) {
      return jsonResponse({ status: "dryRun", kind: kind, oldCode: oldCode, newCode: newCode,
        newName: newName, cells: cells, refRows: refRows, unparsableJsonCells: unparsable,
        perSheet: report,
        sample: plan.slice(0, 25).map(c => ({ sheet: c.name, row: c.row, col: columnLetter_(c.col),
          rows: c.rows, before: c.before.slice(0, 120), after: c.after.slice(0, 120) })) });
    }

    // ── back up every cell we are about to change ───────────────────────────
    // Sheets has no transaction. If a write fails half way, this log is how the old
    // values come back — so it is written FIRST and flushed before anything changes.
    const stamp = new Date();
    const log = ss.getSheetByName("Rename Log") || ss.insertSheet("Rename Log");
    if (log.getLastRow() < 1) {
      log.appendRow(["when", "kind", "oldCode", "newCode", "sheet", "row", "col", "refRows", "oldValue"]);
      log.setFrozenRows(1);
    }
    if (plan.length) {
      const rows = plan.map(c => [stamp, kind, oldCode, newCode, c.name, c.row,
        columnLetter_(c.col), c.rows,
        c.before.length > 45000 ? c.before.slice(0, 45000) + "…TRUNCATED" : c.before]);
      log.getRange(log.getLastRow() + 1, 1, rows.length, 9).setValues(rows);
      SpreadsheetApp.flush();          // the backup must be on disk before we write
    }

    // ── write ──────────────────────────────────────────────────────────────
    // One setValue per changed cell. The matching rows are scattered, so a single
    // range write is not possible, and per-cell keeps a mid-run failure to one cell —
    // which the log above identifies exactly.
    let written = 0;
    const failed = [];
    plan.forEach(c => {
      try { rcSheet_(ss, c.name).getRange(c.row, c.col).setValue(c.after); written++; }
      catch (e) { failed.push({ sheet: c.name, row: c.row, col: columnLetter_(c.col), error: e.message }); }
    });
    SpreadsheetApp.flush();

    // ── verify: nothing may still hold the old code ─────────────────────────
    let leftover = 0;
    CODE_TARGETS.forEach(t => {
      if (t.kinds.indexOf(kind) < 0) return;
      const r = rcResolve_(ss, t);
      if (!r || r.lastRow < 2) return;
      r.sh.getRange(2, r.col + 1, r.lastRow - 1, 1).getValues().forEach(v => {
        const raw = String(v[0] == null ? "" : v[0]);
        if (t.json) {
          const res = rcRewriteJson_(raw, kind, oldCode, newCode, newName, owned);
          if (res && res.n) leftover += res.n;
        } else if (raw.trim() === oldCode) leftover++;
      });
    });

    return jsonResponse({
      status: failed.length || leftover ? "partial" : "ok",
      kind: kind, oldCode: oldCode, newCode: newCode, newName: newName,
      cellsWritten: written, refRows: refRows, perSheet: report,
      unparsableJsonCells: unparsable, leftoverReferences: leftover, failed: failed,
      note: "Plates stored in the browser (rt_plates) are not covered — check the Relations tab."
    });
  } finally {
    lock.releaseLock();
  }
}

// ── read-only audit: every reference that points at nothing ─────────────────
function auditCodes() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const u  = rcUniverse_(ss);
  const owned = (t, c) => !!(u[t] && Object.prototype.hasOwnProperty.call(u[t], c));
  const dangling = [], empty = [];
  let scanned = 0;

  CODE_TARGETS.forEach(t => {
    if (t.home) return;                                 // home columns define codes
    const r = rcResolve_(ss, t);
    if (!r || r.lastRow < 2) return;
    const w = r.sh.getLastColumn();
    // the owning row's own code, so the report says WHERE the bad reference sits
    const selfT = CODE_TARGETS.filter(x => {
      if (!x.home) return false;
      const sh = rcSheet_(ss, x.sheet);
      return sh && sh.getName() === r.name;
    })[0];
    const selfR = selfT ? rcResolve_(ss, selfT) : null;

    r.sh.getRange(2, 1, r.lastRow - 1, w).getValues().forEach((row, i) => {
      const host = selfR ? String(row[selfR.col] == null ? "" : row[selfR.col]).trim()
                         : r.name + " row " + (i + 2);
      const raw = row[r.col];
      if (t.json) {
        let arr;
        try { arr = JSON.parse(String(raw || "[]")); } catch (e) { return; }
        if (!Array.isArray(arr)) return;
        arr.forEach((z, idx) => {
          if (!z || typeof z !== "object") return;
          scanned++;
          const c  = String(z.code == null ? "" : z.code).trim();
          const ty = String(z.type || "rm").toLowerCase();
          if (!c) { empty.push({ sheet: r.name, host: host, idx: idx, type: ty, name: z.name || "" }); return; }
          if (owned(ty, c)) return;
          const elsewhere = ["rm", "mep", "gr", "menu"].filter(k => k !== ty && owned(k, c));
          dangling.push({ sheet: r.name, host: host, idx: idx, type: ty, code: c, name: z.name || "",
                          why: elsewhere.length ? "code is a " + elsewhere.join("/") : "no such " + ty });
        });
      } else {
        const c = String(raw == null ? "" : raw).trim();
        if (!c) return;
        scanned++;
        t.kinds.forEach(k => {
          if (!owned(k, c)) dangling.push({ sheet: r.name, host: host, type: k, code: c, why: "no such " + k });
        });
      }
    });
  });

  return jsonResponse({ status: "ok", scanned: scanned,
    counts: { rm: Object.keys(u.rm).length, mep: Object.keys(u.mep).length,
              gr: Object.keys(u.gr).length, menu: Object.keys(u.menu).length },
    danglingCount: dangling.length, emptyCodeCount: empty.length,
    dangling: dangling, emptyCode: empty.slice(0, 200) });
}
```

### Wire it into `doGet`

Next to the other write actions:

```javascript
    if (action === "renameCode")      return renameCode(e.parameter);
    if (action === "auditCodes")      return auditCodes();
    if (action === "listCodeTargets") return listCodeTargets();
```

Then **Deploy → Manage deployments → edit → Deploy** (keep the same URL).

`renameCode` is listed in `WRITE_ACTIONS` in `js/api.js`, so it will never be cached,
deduped or retried — a retried rename would fail confusingly, because after the first
success `oldCode` no longer exists.

---

## Use it in this order

**1. Check the map resolved correctly.** In the Apps Script editor pick
`listCodeTargets` and Run, then read the log. Every line must be `OK` for the sheets
you actually have, and the reported column must be the real code column. A wrong line
is a map fix, not a logic fix.

**2. See what is already broken.**

```
…/exec?action=auditCodes
```

Expect roughly what the app's own audit found on 2026-09-28: 29 rows with an empty
code (old PDF imports) and 1 dangling code (`SS-030-1` in plate SS-211).

**3. Dry-run the rename.** Nothing is written.

```
…/exec?action=renameCode&kind=gr&oldCode=GR-111&newCode=GR-098&dryRun=1
```

Read `perSheet`: it names every sheet, column and cell count. `sample` shows the first
25 before/after values. **If a sheet you expected is missing, stop and fix the map.**

**4. Run it.** Drop `&dryRun=1`.

A good result is `status:"ok"` with `leftoverReferences:0`. `status:"partial"` means a
cell did not take — `failed` says which, and the **`Rename Log`** sheet holds every old
value so you can put it back.

---

## Prevention — why this keeps happening, and the four things that stop it

The root cause is not a missing handler. It is that **the code is the foreign key and
also the label humans renumber.** Every copy of it is a chance to drift. Four layers,
cheapest first:

### 1. One door

After this patch, `renameCode` is the only thing that may change a code — not the
sheet, not a paste, not a fix-up script. In the app, keep `epf-code` and `eif-code`
read-only and add a **Rename** button that calls this action, so RM and MEP renames
get the same cascade the GR and Menu editors already do.

### 2. Lock the door

The ~60 renames on 09-26 were typed straight into the sheet, which is exactly why
nothing cascaded. Make that impossible: select the code column on each of `Produkt`,
`Lager`, `GR` and `Menus` → **Data → Protect sheets and ranges** → restrict to
yourself only. Apps Script runs as you, so `renameCode` keeps working while a hand edit
is refused. **This single step would have prevented the whole incident.**

### 3. An alarm, for when someone opens it anyway

Protection can be switched off, and a shared account may hold the rights. Two cheap
guards:

```javascript
// Simple trigger — fires on every manual edit. Catches a hand-typed code change and
// cascades it immediately, so the sheet never sits in a broken state.
// e.oldValue exists only for SINGLE-cell edits; a multi-cell paste gets a warning.
function onEdit(e) {
  if (!e || !e.range) return;
  const sh = e.range.getSheet(), name = sh.getName();
  const t = CODE_TARGETS.filter(x =>
    x.home && (Array.isArray(x.sheet) ? x.sheet : [x.sheet]).indexOf(name) >= 0)[0];
  if (!t) return;
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const r = rcResolve_(ss, t);
  if (!r || e.range.getColumn() !== r.col + 1 || e.range.getRow() < 2) return;

  if (e.range.getNumRows() > 1 || e.range.getNumColumns() > 1 || e.oldValue === undefined) {
    sh.getRange(1, 1).setNote("⚠ " + new Date() + " — several code cells changed at once. " +
      "References were NOT updated. Run auditCodes() and repair.");
    return;
  }
  const oldCode = String(e.oldValue).trim();
  const newCode = String(e.value == null ? "" : e.value).trim();
  if (!oldCode || !newCode || oldCode === newCode) return;
  renameCode({ kind: t.home, oldCode: oldCode, newCode: newCode });   // moves the references
}

// Time trigger — run daily. Emails only when something is actually broken.
function auditCodesDaily() {
  const d = JSON.parse(auditCodes().getContent());
  if (!d.danglingCount) return;
  MailApp.sendEmail(MANAGER_EMAIL,
    "Kitchen MEP — " + d.danglingCount + " broken ingredient references",
    d.dangling.map(x => x.sheet + " " + x.host + ": [" + x.type + " " + x.code + "] " +
                        (x.name || "") + " — " + x.why).join("\n"));
}
```

Install the daily trigger once: **Triggers → Add trigger → `auditCodesDaily` →
Time-driven → Day timer**. A bad rename is then caught within a day instead of weeks.

One caveat if you extend this: `onEdit` calling `renameCode` means the rename's own
writes fire `onEdit` again. The guard above is safe because it acts only on the *home*
code column and `renameCode` writes a home cell once — keep that property, or add a
`PropertiesService` re-entry flag.

### 4. Remove the root cause — reference the row, not the code

The durable fix is to stop using a human-editable label as the key. `GR` and `Menus`
already carry a stable `id` (a uuid). If each `zutaten` row stored

```json
{ "ref": "e2422b39-…", "type": "gr", "code": "GR-044", "name": "GR Sushi-Reis" }
```

then `code` and `name` become a **display snapshot** and a rename touches exactly one
cell. Migration, every step backward compatible:

1. On the next **«Zutaten verknüpfen»** pass, write `ref` alongside `code` for every
   row that resolves. Nothing reads it yet.
2. Make the resolvers (`_grByKey` / `_menuByKey` in `js/recipe-calc.js`, and the
   Relations graph builder) prefer `ref`, falling back to `code`. Stale codes stop
   mattering from this point on.
3. Once `auditCodes()` reports every row carrying a `ref`, keep `code` for display
   only.

RM and MEP have no uuid — their code *is* the primary key (`products.code`,
`inventory.code` in `db/schema.sql`). For those, let the database do it:

**Postgres already handles this correctly, and the Sheet is the only reason the bug
exists.** `recipes.mep_code`, `recipes.rm_code`, `scans.product_code`,
`deductions.mep_code` and `mep_stock.product_code` are real foreign keys, so Supabase
would *reject* a rename that orphans rows rather than silently allow it. Add
`on update cascade` and a rename propagates by itself:

```sql
-- confirm the real constraint names first
select conname, conrelid::regclass as tbl
from pg_constraint
where confrelid in ('public.products'::regclass, 'public.inventory'::regclass)
  and contype = 'f';

-- then, per constraint (the names below are the Postgres defaults):
alter table public.recipes    drop constraint recipes_mep_code_fkey,
  add constraint recipes_mep_code_fkey       foreign key (mep_code)     references public.products(code)  on update cascade;
alter table public.recipes    drop constraint recipes_rm_code_fkey,
  add constraint recipes_rm_code_fkey        foreign key (rm_code)      references public.inventory(code) on update cascade;
alter table public.scans      drop constraint scans_product_code_fkey,
  add constraint scans_product_code_fkey     foreign key (product_code) references public.products(code)  on update cascade;
alter table public.deductions drop constraint deductions_mep_code_fkey,
  add constraint deductions_mep_code_fkey    foreign key (mep_code)     references public.products(code)  on update cascade;
alter table public.mep_stock  drop constraint mep_stock_product_code_fkey,
  add constraint mep_stock_product_code_fkey foreign key (product_code) references public.products(code)  on update cascade;
```

`scans_archive.product_code`, `sales_history.product_code` and
`menu_sales_map.menu_code` carry **no** foreign key, so they will not cascade — they
stay `renameCode`'s job, or add constraints for them too.

The honest summary: layers 1–3 make the current architecture safe and are an
afternoon's work. Layer 4 is what makes the problem stop existing, and it is the right
move once Supabase becomes the source of truth for menus and GRs as well.

---

## What this patch deliberately does not do

- **Browser-local plates** (`rt_plates` in `localStorage`) cannot be reached from the
  server, and `auditCodes()` cannot see them — the Relations tab is where a broken
  plate shows up. Keeping plates as Menus with `art="Plate"` makes this go away.
- **Supabase is untouched.** Menus and GRs sync from Sheets at 03:00 so they catch up
  by themselves; `products` and `inventory` are read live from Supabase, so an RM/MEP
  rename has to be applied there as well (see layer 4).
- **Merging two codes is not a rename.** Pointing `A` at an existing `B` is rejected by
  the collision check, deliberately: a merge needs the two rows' weights and prices
  reconciled, which is a decision, not a substitution.
