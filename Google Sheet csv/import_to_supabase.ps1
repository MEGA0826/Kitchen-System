# ============================================================
# Supabase CSV Importer
# Run: .\import_to_supabase.ps1
# ============================================================

$SUPABASE_URL = "https://clntikfffmjytexvzubq.supabase.co"   # <-- change this
$SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNsbnRpa2ZmZm1qeXRleHZ6dWJxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MDE4NDAzNSwiZXhwIjoyMDk1NzYwMDM1fQ.EReP6ScouHyPXz4Dg1mQccwtoN4Qfdwdgu8b74lJHWg"                  # <-- change this (use service_role, not anon)
$CSV_DIR      = "C:\Users\Golfi\OneDrive\MEGA\repo\Google Sheet csv"

# ============================================================
# Helpers
# ============================================================
function Nz($v)        { if ([string]::IsNullOrWhiteSpace($v)) { return $null } return $v.Trim() }
function ToNum($v)     { $n = 0; if ([double]::TryParse(($v -replace ',','.'), [Globalization.NumberStyles]::Any, [Globalization.CultureInfo]::InvariantCulture, [ref]$n)) { return $n }; return $null }
function ToInt($v)     { $n = 0; if ([int]::TryParse($v, [ref]$n)) { return $n }; return $null }
function ToBool($v)    { if ($v -match '^(TRUE|true|1|yes)$') { return $true }; if ($v -match '^(FALSE|false|0|no)$') { return $false }; return $null }
function ToJson($v)    { if ([string]::IsNullOrWhiteSpace($v)) { return @() }; try { return ($v | ConvertFrom-Json) } catch { return @() } }
function IsUUID($v)    { return $v -match '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' }
function Clean($h)     { $out = @{}; $h.GetEnumerator() | Where-Object { $null -ne $_.Value } | ForEach-Object { $out[$_.Key] = $_.Value }; return $out }

function Send-Rows {
    param([string]$Table, [array]$Rows, [bool]$Upsert = $false)
    if ($Rows.Count -eq 0) { Write-Host "  [SKIP] $Table - no rows"; return }

    $prefer = if ($Upsert) { "resolution=merge-duplicates,return=minimal" } else { "return=minimal" }
    $hdrs = @{
        "apikey"        = $SUPABASE_KEY
        "Authorization" = "Bearer $SUPABASE_KEY"
        "Content-Type"  = "application/json"
        "Prefer"        = $prefer
    }

    # Batch in chunks of 200 to stay within API limits
    $size = 200; $ok = 0; $err = 0
    for ($i = 0; $i -lt $Rows.Count; $i += $size) {
        $chunk = $Rows[$i..([Math]::Min($i + $size - 1, $Rows.Count - 1))]
        $body  = [System.Text.Encoding]::UTF8.GetBytes(($chunk | ConvertTo-Json -Depth 10 -Compress))
        try {
            Invoke-RestMethod -Uri "$SUPABASE_URL/rest/v1/$Table" -Method Post -Headers $hdrs -Body $body -ContentType "application/json; charset=utf-8" | Out-Null
            $ok += $chunk.Count
        } catch {
            $msg = $_.ErrorDetails.Message | ConvertFrom-Json -ErrorAction SilentlyContinue
            $errText = if ($msg -and $msg.message) { $msg.message } else { $_.Exception.Message }
            Write-Host "  [ERR] chunk $i : $errText"
            $err += $chunk.Count
        }
    }
    $summary = "  [OK] $Table - $ok inserted"
    if ($err -gt 0) { $summary += ", $err failed" }
    Write-Host $summary
}

# ============================================================
# ORDER MATTERS - insert parent tables before child tables
# (foreign keys: products & inventory must come before recipes,
#  scans, mep_stock, deductions; haccp_tasks before haccp_checks)
# ============================================================

# ----------------------------------------------------------
# 1. products
# ----------------------------------------------------------
Write-Host "`n--- 1. products ---"
$rows = Import-Csv "$CSV_DIR\products.csv" | ForEach-Object {
    Clean @{
        code        = Nz $_.Code
        name        = Nz $_.Produkte
        qr          = Nz $_."QR Code Image"
        kategorie   = Nz $_.Kategorie
        notizen     = Nz $_.Notizen
        drive_photo = Nz $_."Drive Link (Photo)"
        mep_max     = ToNum $_."MEP Max"
        gn_size     = Nz $_."GN Grösse"
        gn_weight   = ToNum $_."GN Gewicht (kg)"
        tagesziel   = ToNum $_."Tages Ziel"
        shelf_life  = ToInt $_."Haltbarkeit Tag"
        priority    = ToInt $_."Prioritäte"
        allergene   = Nz $_.Allergene
        wa          = ToNum $_.WA
        active      = if ([string]::IsNullOrWhiteSpace($_.Aktiv)) { $true } else { ToBool $_.Aktiv }
    }
} | Where-Object { $_["code"] }
Send-Rows "products" $rows -Upsert $true

# ----------------------------------------------------------
# 2. inventory  (skip generated columns total_kg, total_wert)
# ----------------------------------------------------------
Write-Host "`n--- 2. inventory ---"
$rows = Import-Csv "$CSV_DIR\inventory.csv" | ForEach-Object {
    Clean @{
        code              = Nz $_.Code
        name              = Nz $_.Produkte
        kategorie         = Nz $_.Kategorie
        unit              = Nz $_.Unit
        quantity          = ToNum $_.Quantity
        weight_unit       = ToNum $_."Weight/Unit (kg)"
        minimum           = ToNum $_.Minimum
        maximum           = ToNum $_.Maximum
        kosten_unit       = ToNum $_."Kosten/Unit (CHF)"
        lieferant         = Nz $_.Lieferant
        letzte_bestellung = Nz $_."Letzte Bestellung"
        notizen           = Nz $_.Notizen
    }
} | Where-Object { $_["code"] }
Send-Rows "inventory" $rows -Upsert $true

# ----------------------------------------------------------
# 3. workers
# NOTE: rolle CHECK allows only: Teamleader, Küchenchef, Manager
#   Rows with rolle = Admin / Teamleader Sushi / empty are skipped.
#   Fix the CHECK constraint in Supabase first if you need those roles.
# ----------------------------------------------------------
Write-Host "`n--- 3. workers ---"
$allowedRoles = @("Teamleader","Küchenchef","Manager","Admin","Teamleader Sushi")
$rows = Import-Csv "$CSV_DIR\workers.csv" | ForEach-Object {
    $rolle = Nz $_.Rolle
    if (-not $rolle) { return }   # skip rows with no role
    Clean @{
        name   = Nz $_."Mitarbeiter Name"
        rolle  = $rolle
        aktiv  = if ([string]::IsNullOrWhiteSpace($_.Aktiv)) { $false } else { ToBool $_.Aktiv }
        pin    = Nz $_.PIN
    }
} | Where-Object { $_["name"] }
Send-Rows "workers" $rows -Upsert $true

# ----------------------------------------------------------
# 4. haccp_zones  (parent of nothing, but group HACCP together)
# ----------------------------------------------------------
Write-Host "`n--- 4. haccp_zones ---"
$rows = Import-Csv "$CSV_DIR\haccp_zones.csv" | ForEach-Object {
    Clean @{
        id       = Nz $_.ID
        name     = Nz $_.Name
        type     = Nz $_.Type
        min_temp = ToNum $_.MinTemp
        max_temp = ToNum $_.MaxTemp
        active   = ToBool $_.Active
    }
} | Where-Object { $_["id"] }
Send-Rows "haccp_zones" $rows -Upsert $true

# ----------------------------------------------------------
# 5. haccp_tasks  (parent of haccp_checks)
# ----------------------------------------------------------
Write-Host "`n--- 5. haccp_tasks ---"
$rows = Import-Csv "$CSV_DIR\haccp_tasks.csv" | ForEach-Object {
    Clean @{
        id         = Nz $_.ID
        task       = Nz $_.Task
        frequency  = Nz $_.Frequency
        active     = ToBool $_.Active
        sort_order = ToInt $_.Order
    }
} | Where-Object { $_["id"] }
Send-Rows "haccp_tasks" $rows -Upsert $true

# ----------------------------------------------------------
# 6. recipes  (MEP.csv → recipes table)
# NOTE: rows with type='mep' reference another MEP product, not
#   an inventory item, so the FK recipes.rm_code→inventory.code
#   will fail for those rows. They are skipped here.
#   If you need them, remove the FK or add a separate column.
# ----------------------------------------------------------
Write-Host "`n--- 6. recipes ---"
$rows = Import-Csv "$CSV_DIR\MEP.csv" | ForEach-Object {
    if ($_.Type -eq "mep") { return }   # skip inter-MEP refs (FK violation)
    Clean @{
        mep_code = Nz $_."MEP Code"
        mep_name = Nz $_."MEP Name"
        rm_code  = Nz ([string]$_."RM Code")
        rm_name  = Nz $_."RM Name"
        menge    = ToNum $_.Menge
        einheit  = Nz $_.Einheit
        type     = Nz $_.Type
    }
} | Where-Object { $_["mep_code"] -and $_["rm_code"] }
Send-Rows "recipes" $rows -Upsert $true

# ----------------------------------------------------------
# 7. scans  (refs products.code - no natural PK, plain insert)
# ----------------------------------------------------------
Write-Host "`n--- 7. scans ---"
$rows = Import-Csv "$CSV_DIR\Scans.csv" | ForEach-Object {
    Clean @{
        product_code = Nz $_."Produkt Code"
        worker       = Nz $_.Mitarbeiter
        action       = Nz $_.Action
        scanned_at   = Nz $_.Timestamp
    }
} | Where-Object { $_["product_code"] -and $_["worker"] -and $_["action"] }
Send-Rows "scans" $rows   # plain insert - each scan is a new event

# ----------------------------------------------------------
# 8. scans_archive  (plain insert)
# ----------------------------------------------------------
Write-Host "`n--- 8. scans_archive ---"
$rows = Import-Csv "$CSV_DIR\scans_archive.csv" | ForEach-Object {
    Clean @{
        product_code = Nz $_.Code
        worker       = Nz $_.Worker
        action       = Nz $_.Action
        scanned_at   = Nz $_.Timestamp
    }
} | Where-Object { $_["product_code"] -and $_["worker"] }
Send-Rows "scans_archive" $rows

# ----------------------------------------------------------
# 9. mep_stock  (refs products.code)
# NOTE: BatchID, Remaining, Expiry Date, Worker not in schema - skipped
# ----------------------------------------------------------
Write-Host "`n--- 9. mep_stock ---"
$rows = Import-Csv "$CSV_DIR\mep_stock.csv" | ForEach-Object {
    Clean @{
        product_code = Nz $_.Code
        batch_date   = Nz $_."Produced Date"
        produced     = ToNum $_.Quantity
    }
} | Where-Object { $_["product_code"] -and $_["batch_date"] }
Send-Rows "mep_stock" $rows -Upsert $true

# ----------------------------------------------------------
# 10. deductions  (refs products.code, plain insert)
# ----------------------------------------------------------
Write-Host "`n--- 10. deductions ---"
$rows = Import-Csv "$CSV_DIR\deductions.csv" | ForEach-Object {
    Clean @{
        deducted_at = Nz $_.Timestamp
        worker      = Nz $_.Worker
        mep_code    = Nz $_."MEP Code"
        rm_code     = Nz ([string]$_."RM Code")
        rm_name     = Nz $_."RM Name"
        deducted    = ToNum $_.Deducted
        unit        = Nz $_.Unit
        qty_before  = ToNum $_.Before
        qty_after   = ToNum $_.After
    }
} | Where-Object { $_["deducted_at"] }
Send-Rows "deductions" $rows

# ----------------------------------------------------------
# 11. haccp_checks  (refs haccp_tasks.id, upsert on check_date+task_id)
# ----------------------------------------------------------
Write-Host "`n--- 11. haccp_checks ---"
$rows = Import-Csv "$CSV_DIR\haccp_checks.csv" | ForEach-Object {
    Clean @{
        check_date = Nz $_.Date
        task_id    = Nz $_."Task ID"
        task       = Nz $_.Task
        done       = ToBool $_.Done
        worker     = Nz $_.Worker
        notes      = Nz $_.Notes
        checked_at = Nz $_.Timestamp
    }
} | Where-Object { $_["check_date"] -and $_["task_id"] }
Send-Rows "haccp_checks" $rows -Upsert $true

# ----------------------------------------------------------
# 12. haccp_temp_logs  (plain insert)
# ----------------------------------------------------------
Write-Host "`n--- 12. haccp_temp_logs ---"
$rows = Import-Csv "$CSV_DIR\haccp_temp_logs.csv" | ForEach-Object {
    Clean @{
        log_date  = Nz $_.Date
        log_time  = Nz $_.Time
        zone      = Nz $_."Zone / Location"
        zone_type = Nz $_."Product / Item"
        temp      = ToNum $_."Temp (°C)"
        min_temp  = ToNum $_."Min (°C)"
        max_temp  = ToNum $_."Max (°C)"
        pass_fail = Nz $_."Pass / Fail"
        notes     = Nz $_."Action Taken"
        worker    = Nz $_."Checked By"
    }
} | Where-Object { $_["log_date"] }
Send-Rows "haccp_temp_logs" $rows

# ----------------------------------------------------------
# 13. menus
# NOTE: CSV id is included only if it is a valid UUID.
#   Non-UUID ids (e.g. M-1776194711910) are dropped so Supabase generates one.
# ----------------------------------------------------------
Write-Host "`n--- 13. menus ---"
$rows = Import-Csv "$CSV_DIR\menus.csv" | ForEach-Object {
    $row = Clean @{
        menu_code   = Nz $_.menuCode
        name        = Nz $_.name
        category    = Nz $_.category
        art         = Nz $_.art
        saison      = Nz $_.saison
        gewicht     = ToNum $_.gewicht
        garverlust  = ToNum $_.garverlust
        wa          = ToNum $_.wa
        vk          = ToNum $_.vk
        zutaten     = ToJson $_.zutaten
        zubereitung = Nz $_.zubereitung
        image_url   = Nz $_.imageUrl
        last_update = Nz $_.lastUpdate
    }
    if (IsUUID $_.id) { $row["id"] = $_.id }
    $row
} | Where-Object { $_["menu_code"] }
Send-Rows "menus" $rows -Upsert $true

# ----------------------------------------------------------
# 14. grundrezepturen
# ----------------------------------------------------------
Write-Host "`n--- 14. grundrezepturen ---"
$rows = Import-Csv "$CSV_DIR\grundrezepturen.csv" | ForEach-Object {
    Clean @{
        id          = Nz $_.id
        gr_code     = Nz $_.grCode
        name        = Nz $_.name
        art         = Nz $_.art
        rohgewicht  = ToNum $_.rohgewicht
        garverlust  = ToNum $_.garverlust
        wa          = ToNum $_.wa
        zutaten     = ToJson $_.zutaten
        zubereitung = Nz $_.zubereitung
        updated_at  = Nz $_.lastUpdate
    }
} | Where-Object { $_["id"] -and $_["gr_code"] }
Send-Rows "grundrezepturen" $rows -Upsert $true

# ----------------------------------------------------------
# 15. sales_history  (plain insert)
# NOTE: Ø Preis, Produktmarge CHF, Imported not in schema - skipped
# ----------------------------------------------------------
Write-Host "`n--- 15. sales_history ---"
$rows = Import-Csv "$CSV_DIR\sales_history.csv" | ForEach-Object {
    Clean @{
        sale_date    = Nz $_.Datum
        product_name = Nz $_.Produkt
        kategorie    = Nz $_.Kategorie
        qty          = ToNum $_.Menge
        price        = ToNum $_."Umsatz CHF"
        wa           = ToNum $_."Ø Warenaufwand"
    }
} | Where-Object { $_["sale_date"] -and $_["product_name"] }
Send-Rows "sales_history" $rows

# ----------------------------------------------------------
# 16. archive_logs
# NOTE: CSV column 3 is "Manual" (text) but schema expects rows_kept INTEGER.
#   Defaulting rows_kept = 0. Update manually if you have the real numbers.
# ----------------------------------------------------------
Write-Host "`n--- 16. archive_logs ---"
$rows = Import-Csv "$CSV_DIR\archive_logs.csv" | ForEach-Object {
    Clean @{
        archived_at   = Nz $_.archived_at
        rows_archived = ToInt $_.rows_archived
        rows_kept     = 0
    }
} | Where-Object { $_["archived_at"] }
Send-Rows "archive_logs" $rows

Write-Host "`n============================================================"
Write-Host "Import complete."
Write-Host "============================================================`n"
