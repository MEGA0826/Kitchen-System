# code.gs — security patch + bug fixes

Reviewed against the current `code.gs` (v16) you pasted. Apply each change in
the Apps Script editor, then **Deploy → Manage deployments → edit → Deploy**
(keep the same URL). Backend-first: apply and deploy these before relying on
the frontend fallback path.

The frontend is already updated and **fail-safe** either way — both PIN prompts
call `verifyPin` server-side and reject any response that isn't a proper
`{worker:{name,role}}` object, so nothing escalates while the backend is still
un-patched.

Already correct in your code — no change needed:
- `verifyPin` exists and checks the PIN server-side. ✅ (P3 only adds the role.)
- `saveWorker` already treats an empty `pin` as "keep current" (`pin || existing[3]`). ✅

---

## P1 — `getAllWorkers`: stop returning the `pin` column (security, required)

Every browser currently downloads every worker's PIN via `?action=allWorkers`.
Remove the `pin` field.

**Find:**
```javascript
      .map(r => ({
        name   : String(r[0] || "").trim(),
        role   : String(r[1] || "").trim(),
        active : (r[2] === false || String(r[2]).toUpperCase() === "FALSE") ? false : true,
        pin    : String(r.length > 3 ? (r[3] || "") : "").trim(),
      }));
```
**Replace:**
```javascript
      .map(r => ({
        name   : String(r[0] || "").trim(),
        role   : String(r[1] || "").trim(),
        active : (r[2] === false || String(r[2]).toUpperCase() === "FALSE") ? false : true,
      }));
```

## P2 — `getRolePINs`: stop returning role PINs (security, required)

The scan page no longer reads PINs client-side (`_rolePins` is now dead code in
`index.html`). Keep the action so old cached clients don't error, but return
nothing.

**Find:**
```javascript
    if (action === "getRolePINs") {
      const sett = getSheet("Settings");
      const rows = sett.getDataRange().getValues();
      const pins = {};
      rows.slice(1).forEach(r => {
        const rolle = String(r[1]).trim();
        const pin   = String(r[3]).trim();
        const aktiv = String(r[2]).trim();
        if (["Teamleader","Küchenchef","Manager"].includes(rolle) && pin && aktiv !== "false") {
          if (!pins[rolle]) pins[rolle] = pin;
        }
      });
      return jsonResponse({ pins });
    }
```
**Replace:**
```javascript
    if (action === "getRolePINs") return jsonResponse({ pins: {} });
```

## P3 — `verifyPin`: also return the worker's role (required for fallback)

`verifyPin` returns only the name, so the client fallback can't set the correct
role and would default everyone to Manager. Return an object with the role too
(same shape as the Supabase `verify_pin` RPC, which the frontend already expects).

**Find:**
```javascript
      if (stored === String(pin).trim()) return jsonResponse({ ok: true, worker: name });
```
**Replace:**
```javascript
      if (stored === String(pin).trim()) {
        const role = String(row[1] || "").trim();
        return jsonResponse({ ok: true, worker: { name: name, role: role, rolle: role } });
      }
```

## P4 — `deleteInventoryItem`: fix ReferenceError (bug, required)

This function references `ss` and `out`, neither of which exists — it throws
`ReferenceError: ss is not defined` every time it runs. (It survives today only
because the frontend routes `deleteInventory` to Supabase; the GAS fallback is
dead.)

**Find:**
```javascript
function deleteInventoryItem(code) {
  if (!code) return out({ error: "code required" });
  const sheet = ss.getSheetByName("Lager");
  const data  = sheet.getDataRange().getValues();
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][0]).trim() === String(code).trim()) {
      sheet.deleteRow(i + 1);
      return out({ ok: true });
    }
  }
  return out({ error: "Item not found" });
}
```
**Replace:**
```javascript
function deleteInventoryItem(code) {
  if (!code) return jsonResponse({ error: "code required" });
  const sheet = getSheet("Lager");
  const data  = sheet.getDataRange().getValues();
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][0]).trim() === String(code).trim()) {
      sheet.deleteRow(i + 1);
      return jsonResponse({ ok: true });
    }
  }
  return jsonResponse({ error: "Item not found" });
}
```

---

## P5 — Remove dead duplicate code (maintainability, optional but recommended)

`code.gs` defines the entire HACCP layer **twice** and `getHACCPChecks` three
times. In Apps Script the **last** definition of a name wins, so today only the
final `jsonResponse`-based copies run. The earlier copies are dead — and they
call `jsonOut()`, **a function that is never defined anywhere**. If the file is
ever reordered, the app breaks with `jsonOut is not defined`. Same story for the
two stub `saveMenuMep` / `deleteMenuMep` that precede their real versions.

Safe to delete because these copies are already shadowed (identical names,
earlier position → overwritten):

1. **Delete the first HACCP block** — everything from the first
   ```javascript
   function _haccpSheet(name, headers) {
   ```
   (the copy whose helpers call `jsonOut`) down to and including the standalone
   5-column
   ```javascript
   function getHACCPChecks(e) {
     var sh   = _haccpSheet("HACCP_Checks", ["Date","Task ID","Task","Done","Worker","Notes","Timestamp"]);
     var rows = _haccpRows(sh, 5);
     ...
     return jsonResponse({ checks: checks });
   }
   ```
   Keep the second block that starts at the `// ─── HACCP ───` comment — those
   `jsonResponse` versions are the ones actually in use.

2. **Delete the two stubs** immediately above the real implementations:
   ```javascript
   // saveMenuMep / deleteMenuMep — stubs (called by router, safe to exist)
   function saveMenuMep(p)   { return jsonResponse({ status: "ok" }); }
   function deleteMenuMep(p) { return jsonResponse({ status: "ok" }); }
   ```

After this, `jsonOut` no longer appears anywhere and each HACCP function is
defined exactly once. No behavior change (the deleted copies never executed).

> The first copies of `saveHACCPTask` and `saveHACCPCheck` also contain
> unreachable code (`return …; return …;`) — deleting the block in step 1
> removes it.

---

## Verify after deploying

1. Dashboard → unlock Admin with a real PIN → still works, correct role.
2. DevTools → Network → the `allWorkers` response must **not** contain `"pin"`.
3. `…/exec?action=getRolePINs` returns `{"pins":{}}`.
4. Admin → Inventory → delete an item → returns `{"ok":true}` (not an error).

After this, PINs live only in the Settings sheet and the Supabase `workers`
table, and are checked only server-side.
