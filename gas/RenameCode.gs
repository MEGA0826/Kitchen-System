/* ═══════════════════════════════════════════════════════════════════════════
   Kitchen MEP — RenameCode.gs
   A SEPARATE Apps Script file. Nothing in code.gs is replaced; functions are
   shared across every .gs file in the project, and deleting this file removes
   everything it adds.

   PART 1 — CODE RENAME
     listCodeTargets   read-only diagnostic — RUN THIS FIRST from the editor
     auditCodes        read-only: every reference that points at nothing
     renameCode        &kind=&oldCode=&newCode=  [&dryRun=1] [&newName=]

   PART 2 — MENU ACTIVE / INACTIVE
     setMenuActive     &menuId=&active=true|false
     (getMenusData already returns the column, because it maps every header.)

   The one edit to code.gs: inside doGet, replace the bare `return getWorkers();`
   line with

       if (action === "renameCode")      return renameCode(e.parameter);
       if (action === "auditCodes")      return auditCodes();
       if (action === "listCodeTargets") return listCodeTargets();
       if (action === "setMenuActive")   return setMenuActive(e.parameter);
       return getWorkers();

   Then Deploy → Manage deployments → edit → Deploy (keep the same URL).
   ═══════════════════════════════════════════════════════════════════════════ */

// Zutaten row types that count as a reference to a recipe of this kind. A menu with
// art="Plate" is still a menu row, but rows sometimes label it "plate".
const RC_TYPES = { rm: ["rm"], mep: ["mep"], gr: ["gr"], menu: ["menu", "plate"] };

// Every place a code is stored, verified against code.gs v16.
//   sheet     sheet name
//   header    header cells to look for (lower-cased, trimmed); first match wins
//   col       1-based fallback column when no header matches
//   kinds     which code kinds this column holds
//   home      this column is where that kind is DEFINED (the canonical row)
//   json      holds a zutaten-style JSON array instead of a bare code
//   noHeader  the sheet has no header row, so its data starts at row 1
//   typeCol   only rows whose Type column (1-based) is in `typeIs` count
const CODE_TARGETS = [
  // ── home rows ────────────────────────────────────────────────────────────
  { sheet: "Produkt", header: ["code"],                  col: 1, kinds: ["mep"],  home: "mep"  },
  { sheet: "Lager",   header: ["code"],                  col: 1, kinds: ["rm"],   home: "rm"   },
  { sheet: "GR",      header: ["grcode", "gr_code"],     col: 2, kinds: ["gr"],   home: "gr"   },
  { sheet: "Menus",   header: ["menucode", "menu_code"], col: 2, kinds: ["menu"], home: "menu" },
  // ── references: bare code columns ────────────────────────────────────────
  // MEP is the recipe sheet: A=MEP Code B=MEP Name C=RM Code D=RM Name E=Menge
  // F=Einheit G=Type H=Garverlust. Column C is NOT rm-only — G says what it holds.
  { sheet: "MEP", header: ["mep code", "mepcode", "mep_code"], col: 1, kinds: ["mep"] },
  { sheet: "MEP", header: ["rm code", "rmcode", "rm_code"], col: 3, kinds: ["rm"],
    typeCol: 7, typeIs: ["rm", ""] },
  { sheet: "MEP", header: ["rm code", "rmcode", "rm_code"], col: 3, kinds: ["mep"],
    typeCol: 7, typeIs: ["mep"] },
  { sheet: "MEP", header: ["rm code", "rmcode", "rm_code"], col: 3, kinds: ["gr"],
    typeCol: 7, typeIs: ["gr"] },
  { sheet: "Scan",       header: ["code", "product_code", "productcode"], col: 3, kinds: ["mep"] },
  { sheet: "Archive",    header: ["code", "product_code", "productcode"], col: 3, kinds: ["mep"] },
  { sheet: "MEP_Stock",  header: ["code", "product_code", "productcode"], col: 2, kinds: ["mep"] },
  { sheet: "Deductions", header: ["mep code", "mep_code", "mepcode"],     col: 3, kinds: ["mep"] },
  { sheet: "Deductions", header: ["rm code", "rm_code", "rmcode"],        col: 4, kinds: ["rm"]  },
  // Rezeptur (saveMenuMep): [menuCode, mepCode, step, weight, desc] and NO header row
  { sheet: "Rezeptur", header: [], col: 1, kinds: ["menu"], noHeader: true },
  { sheet: "Rezeptur", header: [], col: 2, kinds: ["mep"],  noHeader: true },
  // ── references: zutaten JSON ─────────────────────────────────────────────
  { sheet: "GR",    header: ["zutaten"], col: 9,  json: true, kinds: ["rm", "mep", "gr", "menu"] },
  { sheet: "Menus", header: ["zutaten"], col: 13, json: true, kinds: ["rm", "mep", "gr", "menu"] },
];
// Sales_History is deliberately ABSENT: its columns are
// Datum · Produkt · Kategorie · Menge · Umsatz CHF · Preis · WA · Produktmarge · Imported
// — it stores the product NAME, not a code. Nothing there to rename.

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
// still be able to rename. `firstRow` is where data starts (2 normally, 1 headerless).
function rcResolve_(ss, t) {
  const sh = rcSheet_(ss, t.sheet);
  if (!sh) return null;
  const lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
  if (lastRow < 1 || lastCol < 1) return null;
  const firstRow = t.noHeader ? 1 : 2;
  let col = -1, how = "header";
  if (!t.noHeader && t.header && t.header.length) {
    const head = sh.getRange(1, 1, 1, lastCol).getValues()[0]
                   .map(h => String(h == null ? "" : h).trim().toLowerCase());
    for (let i = 0; i < t.header.length && col < 0; i++) col = head.indexOf(t.header[i]);
  }
  if (col < 0) {                                  // fall back to the declared position
    if (!t.col || t.col > lastCol) return null;
    col = t.col - 1; how = "position";
  }
  return { t: t, sh: sh, name: sh.getName(), col: col, how: how,
           lastRow: lastRow, lastCol: lastCol, firstRow: firstRow,
           nRows: Math.max(0, lastRow - firstRow + 1) };
}

// Does this row pass the target's Type filter? MEP column C holds rm, mep or gr codes.
function rcTypeOk_(t, row) {
  if (!t.typeCol) return true;
  const v = String(row[t.typeCol - 1] == null ? "" : row[t.typeCol - 1]).trim().toLowerCase();
  return (t.typeIs || []).indexOf(v) >= 0;
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
        "  kinds=" + t.kinds.join(",") + (t.json ? "  [JSON]" : "") +
        (t.typeCol ? "  Type=" + t.typeIs.join("/") : "") +
        (t.home ? "  HOME of " + t.home : "") + "  rows=" + r.nRows
      : "SKIP  " + want + "  — sheet or column not found");
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
    if (!r || !r.nRows) return;
    const head = r.sh.getRange(1, 1, 1, r.lastCol).getValues()[0]
                   .map(h => String(h == null ? "" : h).trim().toLowerCase());
    let nameCol = head.indexOf("name");
    if (nameCol < 0) nameCol = r.col === 0 ? 1 : 0;   // the column next to the code
    r.sh.getRange(r.firstRow, 1, r.nRows, r.lastCol).getValues().forEach(row => {
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
      if (!r.nRows) { report.push({ sheet: r.name, cells: 0 }); return; }
      // whole rows, so the Type filter can be applied
      const vals = r.sh.getRange(r.firstRow, 1, r.nRows, r.lastCol).getValues();
      let hits = 0, rows = 0;
      for (let i = 0; i < vals.length; i++) {
        if (!rcTypeOk_(t, vals[i])) continue;
        const raw = vals[i][r.col];
        if (t.json) {
          const res = rcRewriteJson_(raw, kind, oldCode, newCode, newName, owned);
          if (res === null) { unparsable++; continue; }
          if (!res.n) continue;
          plan.push({ name: r.name, col: r.col + 1, row: r.firstRow + i, before: String(raw), after: res.json, rows: res.n });
          hits++; rows += res.n;
        } else {
          if (String(raw == null ? "" : raw).trim() !== oldCode) continue;
          plan.push({ name: r.name, col: r.col + 1, row: r.firstRow + i, before: String(raw), after: newCode, rows: 1 });
          hits++; rows += 1;
        }
      }
      cells += hits; refRows += rows;
      report.push({ sheet: r.name, column: columnLetter_(r.col + 1), by: r.how,
                    json: !!t.json, type: t.typeIs ? t.typeIs.join("/") : "",
                    home: t.home === kind, cells: hits, rows: rows });
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
      if (!r || !r.nRows) return;
      r.sh.getRange(r.firstRow, 1, r.nRows, r.lastCol).getValues().forEach(row => {
        if (!rcTypeOk_(t, row)) return;
        const raw = String(row[r.col] == null ? "" : row[r.col]);
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
    if (!r || !r.nRows) return;
    // the owning row's own code, so the report says WHERE the bad reference sits
    const selfT = CODE_TARGETS.filter(x => {
      if (!x.home) return false;
      const sh = rcSheet_(ss, x.sheet);
      return sh && sh.getName() === r.name;
    })[0];
    const selfR = selfT ? rcResolve_(ss, selfT) : null;

    r.sh.getRange(r.firstRow, 1, r.nRows, r.lastCol).getValues().forEach((row, i) => {
      if (!rcTypeOk_(t, row)) return;
      const host = selfR ? String(row[selfR.col] == null ? "" : row[selfR.col]).trim()
                         : r.name + " row " + (r.firstRow + i);
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

/* ═══════════════════════════════════════════════════════════════════════════
   PART 2 — MENU ACTIVE / INACTIVE
   The Menus sheet has no `active` column. getMenusData maps EVERY header to a
   field, so adding the column is all it takes for the app to read it — no change
   to code.gs. Writing it needs this action, because saveMenu writes a fixed
   16-column row and would never touch column 17.

   An EMPTY cell means ACTIVE. Existing menus therefore stay on sale, and nothing
   changes until something is switched off on purpose.
   ═══════════════════════════════════════════════════════════════════════════ */

// Find (or create) the `active` column on the Menus sheet and return its 1-based index.
function mcActiveCol_(msh) {
  const lastCol = msh.getLastColumn();
  const head = msh.getRange(1, 1, 1, lastCol).getValues()[0]
                 .map(h => String(h == null ? "" : h).trim().toLowerCase());
  const at = head.indexOf("active");
  if (at >= 0) return at + 1;
  const col = lastCol + 1;                       // append, never insert — saveMenu
  msh.getRange(1, col).setValue("active");       // writes columns 1..16 by position
  msh.getRange(1, col).setFontWeight("bold");
  return col;
}

function setMenuActive(p) {
  const menuId = String(p.menuId || "").trim();
  const active = !(String(p.active || "").toLowerCase() === "false" || p.active === false);
  if (!menuId) return jsonResponse({ error: "menuId required" });

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return jsonResponse({ error: "busy — try again" });
  try {
    const msh  = getMenusSheet();
    const col  = mcActiveCol_(msh);
    const rows = msh.getDataRange().getValues();
    const idCol = rows[0].map(x => String(x).trim()).indexOf("id");
    if (idCol < 0) return jsonResponse({ error: "Menus sheet has no id column" });
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][idCol]).trim() === menuId) {
        // FALSE is stored explicitly; active is stored as an empty cell so the sheet
        // stays readable and the default remains "on sale".
        msh.getRange(i + 1, col).setValue(active ? "" : false);
        return jsonResponse({ status: "ok", menuId: menuId, active: active });
      }
    }
    return jsonResponse({ error: "Menu not found: " + menuId });
  } finally {
    lock.releaseLock();
  }
}

// One-off helper: creates the `active` column without changing any menu.
// Run it once from the editor, or just call setMenuActive and let it create the column.
function initMenuActiveColumn() {
  const msh = getMenusSheet();
  const col = mcActiveCol_(msh);
  Logger.log("active column = " + columnLetter_(col) + " (" + col + ")");
  return jsonResponse({ status: "ok", column: columnLetter_(col) });
}
