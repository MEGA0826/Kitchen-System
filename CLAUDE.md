# Kitchen MEP — Claude Code Context

## Stack
- Frontend: Vanilla HTML/CSS/JS on GitHub Pages (mega0826.github.io/Kitchen-System)
- Backend: **two stores, split by data** (migration is partial — see below)
  - Supabase `clntikfffmjytexvzubq` (NOT the Lifebook project `dcxpscskpbwzlwcayprq`): products, inventory, staff/PIN, HACCP, sales analysis, **menus, Grundrezepturen**
  - Google Apps Script (code.gs) + Google Sheets: MEP recipes, scanning, orders, deductions, archive, weekly report, PDF vision parsing
- Google Sheet ID: 1IMHwIGK3BTMlQksMlLksa2vTm5lXxRMqA-J-I0c9PtU
- GAS URL (the ONE live deployment — never create a second, never repoint the app): https://script.google.com/macros/s/AKfycbz1aiIySe0-JwsLE4Vq8GyVwxS_7aRxyX48fvAWxP1cBeeOKFUK0w0mf7WCoe-9T8IHtQ/exec
- Key files: dashboard.html, code.gs (+ gas/RenameCode.gs), i18n.js, service-worker.js, index.html, supabase/functions/admin-gateway/

## ⚠️ Menus and Grundrezepturen live in SUPABASE (since 2026-10-07)
- The `Menus` and `GR` tabs of the Google Sheet are a **frozen archive**. Never read them as truth, never "fix" data there, never write them. Edits made there are invisible to the app.
- Reads: `_sbActions.getMenus/getGRs` (anon REST, adapters `sbMenuToApp/sbGrToApp` in dashboard.html). Writes: admin-gateway `saveMenu/deleteMenu/setMenuActive/saveGR/deleteGR` (PIN token, service role). These actions are in `_SB_ONLY` — **they must never fall back to GAS**.
- `zutaten` must reach the app as a JSON **string** (many callers `JSON.parse(m.zutaten||'[]')`; `_zRows` returns `[]` for non-strings → silently zero costs). The adapters stringify the jsonb; the gateway rejects anything that is not a JSON array of objects.
- A save carries the row **id**: with an id it UPDATEs in place, without one it INSERTs and the unique code index (`lower(menu_code)`, `lower(gr_code)`) refuses an existing code. Never delete-then-insert to "update".
- UPDATE writes only the columns the request carries; send a field as `""` to clear it.
- Every UPDATE/DELETE is logged to `recipe_history` (old row as jsonb). Undo = read the old row from there. Backups of the pre-migration copy: `_bak_menus_20261007`, `_bak_grs_20261007`.
- `resync_recipe_analytics()` used to TRUNCATE menus/GRs weekly and reload them from the Sheet. It is now refresh-only. **Never reintroduce a job that copies Sheet -> Supabase for these tables.**
- `scripts/name_mismatch.cjs` (reads Supabase) finds references that resolve but point at the wrong dish - run it after any bulk change. `scripts/fix_lager.cjs` reconciles the Lager sheet vs Supabase inventory. `scripts/fix51.cjs` is RETIRED (it wrote the frozen Sheet).

## Hard coding rules — never break these
- NEVER use cssText — always individual div.style.property assignments
- NEVER use inline onclick with string-interpolated user data — use closure functions
- NEVER use getActiveSpreadsheet() — always openById(SPREADSHEET_ID)
- Any Line 1 browser syntax error = file-level encoding corruption, not logic
- Always bump sw.js cache version (mep-vXX) after every deploy
- Always use toLocaleDateString('en-CA') for dates — never toISOString().slice(0,10)
- GAS blocks POST — use GET-based chunked uploads for large data
- Drive images: use lh3.googleusercontent.com/d/FILE_ID format
- All popup reads must be container-scoped — never document.getElementById across modals
- Cost calculation: pricePerKg = kostenUnit / weightUnit (never read kostenUnit as CHF/kg)
- _safeT / const _t guard required around all t() i18n calls
- Null-safe element setter: const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; }

## Produkt sheet columns (critical — do not deviate)
A=Code, B=Name, C=QR, D=Kategorie, J=Notizen(index 9), K=DrivePhoto(index 10),
L=MEPMax(index 11), M=GNSize(index 12), N=GNWeight(index 13),
O=Tagesziel(index 14), P=ShelfLife(index 15)
getDataRows must use 16 columns.

## Key sheets
Produkt, Scan, Settings, Lager, MEP, Menus, GR, MEP_Stock,
Deductions, Sales_History, HACCP, Archive, Archive Log, Rezeptur

## Settings sheet
A=Name, B=Rolle, C=Aktiv, D=Pin

## Role tabs
Teamleader : kds, mep-overview, inventory, deductions, admin
Küchenchef : kds, mep-overview, inventory, recipes, relations, orders, deductions, reports, admin
Manager    : kds, mep-overview, inventory, products, recipes, relations, orders, deductions, reports, sales, admin

## Modal ID namespacing — never mix
epf-* = editProductModal
mep-* = addMEPPopup
eif-* = editInventoryModal

## Architecture patterns
- doGet only (no doPost for primary routing) — all actions routed via action parameter
- getOrCreateSheet(name) helper for safe sheet access
- getDataRows(sheet, numCols) reads from row 2 downward
- MEP_Stock sheet = persistent FIFO fridge ledger for carry-over stock across days
- GAS cold starts ~2–3s; keepWarm trigger every 4 minutes
- GmailApp (not MailApp) for weekly reports

## Init pattern (dashboard.html)
Promise.allSettled([loadProducts(), loadInventory(), loadRecipes()]).then(() => loadKDS())

## Output rules — always follow
- Specify filename at top of every code block before any find/replace
- Backend (code.gs) changes first — wait for confirmation before frontend
- Targeted find/replace over large block replacements
- Never change patterns not mentioned in the task
- Never use smart quotes or << typos in code — causes Line 1 corruption
- Bump sw.js cache version after every dashboard.html deploy
