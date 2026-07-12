# code.gs security patch — stop sending worker PINs to the browser

**Status: NOT applied yet — apply in the Apps Script editor, then deploy.**
The frontend (deployed alongside this file) no longer needs PINs client-side:
both PIN prompts now verify against the Supabase `verify_pin` RPC first and
only fall back to the old list-compare if Supabase is unreachable.

Apply these three changes to `code.gs`:

## 1. `allWorkers` — strip the `pin` field

In the handler that builds the workers response, stop including `pin`:

```javascript
// BEFORE (leaks every PIN to every browser):
workers.push({ name: row[0], rolle: row[1], role: row[1], aktiv: row[2], active: row[2], pin: row[3] });

// AFTER:
workers.push({ name: row[0], rolle: row[1], role: row[1], aktiv: row[2], active: row[2] });
```

## 2. `getRolePINs` — return empty

The scan page no longer reads role PINs client-side. Keep the action so old
cached clients don't error, but return nothing:

```javascript
if (action === "getRolePINs") {
  return jsonOut({ pins: {} });
}
```

## 3. Add `verifyPin` (GAS-side equivalent of the Supabase RPC)

So PIN login keeps working even when requests fall back to GAS:

```javascript
if (action === "verifyPin") {
  const pin = String(e.parameter.pin || "");
  const sheet = getOrCreateSheet("Settings");           // A=Name, B=Rolle, C=Aktiv, D=Pin
  const rows = getDataRows(sheet, 4);
  for (const r of rows) {
    const active = String(r[2]).toLowerCase() !== "false";
    if (active && r[3] !== "" && String(r[3]) === pin) {
      return jsonOut({ worker: { name: r[0], rolle: r[1], role: r[1] } });
    }
  }
  return jsonOut({ worker: null });
}
```

> Adjust `jsonOut` to whatever the existing JSON-response helper is called.

## 4. `saveWorker` — empty pin must mean "keep current PIN"

The edit form can no longer prefill the PIN, so an empty `pin` parameter now
arrives on every unchanged save. Only write column D when a pin was provided:

```javascript
if (e.parameter.pin) sheet.getRange(rowIndex, 4).setValue(e.parameter.pin);
// (previously: always setValue, which would now wipe PINs)
```

## Order of operations

1. Frontend deploy (already done) — safe on its own, PIN login uses Supabase.
2. Apply this patch in the Apps Script editor → Deploy → keep the same URL.
3. Verify: open the dashboard, unlock Admin with a PIN, and check the
   Network tab — the `allWorkers` response must not contain `"pin"`.

After step 3, PINs exist only in the Settings sheet and the Supabase
`workers` table, and are checked only server-side.
