# code.gs — make scans idempotent (stop duplicate scans)

**Why:** scans are non-idempotent GET writes. On flaky wifi the request can reach
GAS and commit the row, but the *response* is lost before the tablet sees it →
the tablet queues the scan and later retries it → GAS writes it **again** →
duplicate produce/done/waste, inflated MEP stock, wrong waste-cost report.

The frontend now sends a stable `cid` (idempotency id) on every scan and reuses
it on retry (shipped in `index.html`). This patch makes GAS **skip a scan whose
`cid` it has already processed**, which closes the duplicate window. Until this
is applied, `cid` is simply ignored (harmless).

Apply in the Apps Script editor, then Deploy (same URL).

## 1. `doGet` — pass `cid` into `handleScan`

**Find:**
```javascript
    const scanActions = ["produce", "done", "waste", "used"];
    if (scanActions.includes(action) && code && worker) {
      return handleScan(code, worker, action);
    }
```
**Replace:**
```javascript
    const scanActions = ["produce", "done", "waste", "used"];
    if (scanActions.includes(action) && code && worker) {
      return handleScan(code, worker, action, (e.parameter.cid || "").trim());
    }
```

## 2. `handleScan` — dedupe on `cid`, and record it

**Find:**
```javascript
function handleScan(code, worker, action) {
  try {
    const scanSheet = getSheet("Scan");
    const timestamp = new Date();
```
**Replace:**
```javascript
function handleScan(code, worker, action, cid) {
  try {
    const scanSheet = getSheet("Scan");
    const timestamp = new Date();

    // ── Idempotency: skip a scan whose cid was already processed ──────────
    // Guards against duplicate rows when a committed write's response was lost
    // and the client retried the same scan.
    if (cid) {
      const cache = CacheService.getScriptCache();
      const seenKey = "scan_cid_" + cid;
      if (cache.get(seenKey)) {
        // Already recorded — return current status without writing again.
        const u = JSON.parse(getMepStatus(code).getContent());
        return jsonResponse({ status: "ok", deduped: true, timestamp: timestamp.toISOString(), code, worker, action, ...u });
      }
      cache.put(seenKey, "1", 3600); // remember for 1h (covers the retry window)
    }
```

Then, wherever the Scan rows are appended, add `cid` as a 5th column so it is
also durable (survives cache eviction). Change each append:

**Find:**
```javascript
    if (action === "produce") {
      scanSheet.appendRow([timestamp, worker, code, "produce"]);

    } else if (action === "done") {
      scanSheet.appendRow([timestamp, worker, code, "done"]);
```
**Replace:**
```javascript
    if (action === "produce") {
      scanSheet.appendRow([timestamp, worker, code, "produce", cid || ""]);

    } else if (action === "done") {
      scanSheet.appendRow([timestamp, worker, code, "done", cid || ""]);
```

**Find:**
```javascript
    } else if (action === "used") {
      scanSheet.appendRow([timestamp, worker, code, "used"]);
      deductMepStock(code, 1);

    } else if (action === "waste") {
      scanSheet.appendRow([timestamp, worker, code, "waste"]);
      deductMepStock(code, 1);
    }
```
**Replace:**
```javascript
    } else if (action === "used") {
      scanSheet.appendRow([timestamp, worker, code, "used", cid || ""]);
      deductMepStock(code, 1);

    } else if (action === "waste") {
      scanSheet.appendRow([timestamp, worker, code, "waste", cid || ""]);
      deductMepStock(code, 1);
    }
```

Column E (`cid`) is ignored by every existing reader (`getScans`, archive, reports
all read columns A–D), so adding it is safe.

## Optional hardening (durable dedupe beyond the 1h cache)

If you want dedupe to survive a >1h gap, replace the cache check with a scan of
recent `cid`s:
```javascript
if (cid) {
  const lastRow = scanSheet.getLastRow();
  if (lastRow >= 2) {
    const from = Math.max(2, lastRow - 400);
    const cids = scanSheet.getRange(from, 5, lastRow - from + 1, 1).getValues();
    if (cids.some(r => String(r[0]) === cid)) {
      const u = JSON.parse(getMepStatus(code).getContent());
      return jsonResponse({ status: "ok", deduped: true, code, worker, action, ...u });
    }
  }
}
```

## Verify
1. Scan a product online → one row appears in the Scan sheet with a cid in col E.
2. Re-send the exact same URL (same `cid`) → response has `"deduped":true` and
   **no** second row is added.
