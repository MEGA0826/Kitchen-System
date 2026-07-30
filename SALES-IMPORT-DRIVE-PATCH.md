# code.gs — `fetchDriveCsv` action (Drive-link sales import)

**Why:** the browser can't fetch a Google Drive file directly (CORS), so the
"paste a Drive link" import needs a server-side fetch. The old
`importSalesFromDrive` fetched the file **and wrote it to the Google Sheet** —
which the Supabase-backed Sales page never reads (the same split-brain bug the
file-upload path had). This patch makes GAS just **return the raw CSV text**;
the frontend then parses, previews and imports it through the exact same
header-based pipeline as file upload, so Drive imports land in Supabase too.

Until this is applied, the Drive button shows a message telling the user to use
file upload — nothing breaks.

## Add one action to `doGet`

Add near the other `if (action === …)` lines:

```javascript
if (action === "fetchDriveCsv") return jsonResponse(fetchDriveCsv(e.parameter));
```

## Add the function

```javascript
function fetchDriveCsv(params) {
  try {
    var fileId = String(params.fileId || "").trim();
    if (!fileId) return { error: "No file ID provided" };
    var url  = "https://drive.google.com/uc?export=download&id=" + fileId;
    var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
    var text = resp.getContentText("UTF-8");
    if (!text || text.trim().length < 10) {
      return { error: "Could not read file from Drive. Set sharing to 'Anyone with the link'." };
    }
    // Guard against Google's HTML 'virus scan' interstitial for large files.
    if (/^\s*<(!doctype|html)/i.test(text)) {
      return { error: "Drive returned an HTML page, not a CSV (file too large for direct download or not shared). Download it and use file upload." };
    }
    return { ok: true, csv: text };
  } catch (e) {
    return { error: e.message };
  }
}
```

> You can delete the old `importSalesFromDrive` function and its
> `doGet`/`doPost` routes once this is in — the frontend no longer calls it.

## Verify
1. Deploy (same URL).
2. Sales tab → paste a shared Drive CSV link → **Drive**. The preview should
   appear (same as file upload); tap **Import**; the read-back confirms the rows
   landed in Supabase.
