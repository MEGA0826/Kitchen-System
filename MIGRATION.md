# Kitchen MEP — Google Sheets → Supabase Migration Plan

**Current stack:** Vanilla HTML/JS → Google Apps Script → Google Sheets  
**Target stack:** Vanilla HTML/JS → Supabase (PostgREST + Edge Functions) → Postgres  
**Strategy:** Dual-backend with per-table cutover; GAS stays live as fallback throughout

---

## 1. Database Schema

### 1.1 `products` ← Produkt sheet

```sql
CREATE TABLE products (
  code          TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  qr            TEXT,
  kategorie     TEXT,
  notizen       TEXT,
  drive_photo   TEXT,
  mep_max       NUMERIC(10,3) DEFAULT 0,
  gn_size       TEXT,
  gn_weight     NUMERIC(10,3) DEFAULT 0,
  tagesziel     NUMERIC(10,3) DEFAULT 0,
  shelf_life    INTEGER DEFAULT 0,
  priority      INTEGER DEFAULT 99,
  allergene     TEXT,
  wa            NUMERIC(10,2) DEFAULT 0,
  active        BOOLEAN DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX ON products (kategorie);
```

### 1.2 `inventory` ← Lager sheet

```sql
CREATE TABLE inventory (
  code          TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  kategorie     TEXT,
  unit          TEXT DEFAULT 'kg',
  quantity      NUMERIC(12,4) DEFAULT 0,
  weight_unit   NUMERIC(10,4) DEFAULT 1,   -- conversion factor to kg
  minimum       NUMERIC(10,3) DEFAULT 0,
  maximum       NUMERIC(10,3) DEFAULT 0,
  kosten_unit   NUMERIC(10,4) DEFAULT 0,   -- CHF per unit
  lieferant     TEXT,
  last_order    DATE,
  notizen       TEXT,
  updated_at    TIMESTAMPTZ DEFAULT now()
);
```

### 1.3 `workers` ← Settings sheet

```sql
CREATE TABLE workers (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL UNIQUE,
  rolle      TEXT NOT NULL CHECK (rolle IN ('Teamleader','Küchenchef','Manager')),
  aktiv      BOOLEAN DEFAULT true,
  pin        TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX ON workers (pin) WHERE aktiv = true;
```

### 1.4 `scans` ← Scan sheet

```sql
CREATE TABLE scans (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_code TEXT REFERENCES products(code),
  worker       TEXT NOT NULL,
  action       TEXT NOT NULL CHECK (action IN ('produce','done','waste','used')),
  scanned_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON scans (product_code, scanned_at DESC);
CREATE INDEX ON scans (scanned_at DESC);
```

### 1.5 `scans_archive` ← Archive sheet

```sql
CREATE TABLE scans_archive (
  LIKE scans INCLUDING ALL
);
-- Same columns as scans; rows moved here after archival.
```

### 1.6 `archive_logs` ← Archive Log sheet

```sql
CREATE TABLE archive_logs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  archived_at    TIMESTAMPTZ DEFAULT now(),
  rows_archived  INTEGER NOT NULL,
  rows_kept      INTEGER NOT NULL
);
```

### 1.7 `menus` ← Menus sheet

```sql
CREATE TABLE menus (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_code    TEXT UNIQUE NOT NULL,
  name         TEXT NOT NULL,
  category     TEXT,                         -- Konzept/concept
  art          TEXT,                         -- Hauptgang, Vorspeise, Dessert…
  saison       TEXT,
  gewicht      NUMERIC(10,3),                -- kg
  garverlust   NUMERIC(5,2) DEFAULT 0,       -- %
  wa           NUMERIC(10,2) DEFAULT 0,      -- CHF ingredient cost
  vk           NUMERIC(10,2) DEFAULT 0,      -- CHF selling price
  zutaten      JSONB DEFAULT '[]',
  zubereitung  TEXT,
  image_url    TEXT,
  last_update  TIMESTAMPTZ DEFAULT now(),
  created_at   TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX ON menus (art);
CREATE INDEX ON menus USING GIN (zutaten);
```

`zutaten` element shape:
```json
{
  "type": "rm|mep|gr",
  "code": "TEXT",
  "name": "TEXT",
  "gewicht": 0.5,
  "garverlust": 0.1,
  "waTotal": 0.4,
  "chfKgNetto": 2.5,
  "unitCost": 1.25,
  "cost": 0.625,
  "allergie": "Gluten, Milch",
  "zubereitung": "TEXT",
  "isDeko": false
}
```

### 1.8 `grundrezepturen` ← GR sheet

```sql
CREATE TABLE grundrezepturen (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gr_code      TEXT UNIQUE NOT NULL,
  name         TEXT NOT NULL,
  art          TEXT DEFAULT 'Grundrezeptur',  -- Grundrezeptur, Platte, Marinade, Sauce, Beilage
  rohgewicht   NUMERIC(10,3) DEFAULT 0,
  garverlust   NUMERIC(5,2)  DEFAULT 0,
  wa           NUMERIC(10,2) DEFAULT 0,
  zutaten      JSONB DEFAULT '[]',
  zubereitung  TEXT,
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX ON grundrezepturen USING GIN (zutaten);
```

### 1.9 `recipes` ← Rezeptur sheet (MEP → RM mappings)

```sql
CREATE TABLE recipes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mep_code     TEXT NOT NULL REFERENCES products(code),
  rm_code      TEXT NOT NULL REFERENCES inventory(code),
  menge        NUMERIC(10,4) NOT NULL,
  einheit      TEXT DEFAULT 'kg',
  garverlust   NUMERIC(5,2) DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT now(),
  UNIQUE (mep_code, rm_code)
);
CREATE INDEX ON recipes (mep_code);
```

### 1.10 `mep_stock` ← MEP_Stock sheet (FIFO fridge ledger)

```sql
CREATE TABLE mep_stock (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_code TEXT NOT NULL REFERENCES products(code),
  batch_date   DATE NOT NULL,
  produced     NUMERIC(10,3) DEFAULT 0,
  used         NUMERIC(10,3) DEFAULT 0,
  wasted       NUMERIC(10,3) DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now(),
  UNIQUE (product_code, batch_date)
);
CREATE INDEX ON mep_stock (product_code, batch_date DESC);
```

### 1.11 `deductions` ← Deductions sheet

```sql
CREATE TABLE deductions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deducted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  worker       TEXT,
  mep_code     TEXT REFERENCES products(code),
  rm_code      TEXT,
  rm_name      TEXT,
  deducted     NUMERIC(10,4),
  unit         TEXT,
  qty_before   NUMERIC(10,4),
  qty_after    NUMERIC(10,4)
);
CREATE INDEX ON deductions (deducted_at DESC);
CREATE INDEX ON deductions (mep_code);
```

### 1.12 `sales_history` ← Sales_History sheet

```sql
CREATE TABLE sales_history (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_date     DATE NOT NULL,
  product_name  TEXT NOT NULL,
  product_code  TEXT,
  kategorie     TEXT,
  qty           NUMERIC(10,3) DEFAULT 0,
  unit          TEXT,
  price         NUMERIC(10,2) DEFAULT 0,   -- CHF revenue
  wa            NUMERIC(10,2) DEFAULT 0,   -- CHF ingredient cost
  garverlust    NUMERIC(5,2) DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX ON sales_history (sale_date DESC);
CREATE INDEX ON sales_history (product_name, sale_date DESC);
```

### 1.13 `haccp_zones` ← HACCP_Zones sheet

```sql
CREATE TABLE haccp_zones (
  id          TEXT PRIMARY KEY,           -- "z" + timestamp, kept for compatibility
  name        TEXT NOT NULL,
  type        TEXT DEFAULT 'Fridge' CHECK (type IN ('Fridge','Freezer')),
  min_temp    NUMERIC(5,1) DEFAULT 0,
  max_temp    NUMERIC(5,1) DEFAULT 5,
  active      BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT now()
);
```

### 1.14 `haccp_tasks` ← HACCP_Tasks sheet

```sql
CREATE TABLE haccp_tasks (
  id          TEXT PRIMARY KEY,           -- "t" + timestamp
  task        TEXT NOT NULL,
  frequency   TEXT DEFAULT 'Daily' CHECK (frequency IN ('Daily','Weekly')),
  active      BOOLEAN DEFAULT true,
  sort_order  INTEGER DEFAULT 99,
  created_at  TIMESTAMPTZ DEFAULT now()
);
```

### 1.15 `haccp_checks` ← HACCP_Checks sheet

```sql
CREATE TABLE haccp_checks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  check_date  DATE NOT NULL,
  task_id     TEXT NOT NULL REFERENCES haccp_tasks(id),
  task        TEXT,
  done        BOOLEAN DEFAULT false,
  worker      TEXT,
  notes       TEXT,
  checked_at  TIMESTAMPTZ,
  UNIQUE (check_date, task_id)
);
CREATE INDEX ON haccp_checks (check_date DESC);
```

### 1.16 `haccp_temp_logs` ← HACCP sheet

```sql
CREATE TABLE haccp_temp_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  log_date    DATE NOT NULL,
  log_time    TIME NOT NULL,
  zone        TEXT NOT NULL,
  zone_type   TEXT,
  temp        NUMERIC(5,2) NOT NULL,
  min_temp    NUMERIC(5,2),
  max_temp    NUMERIC(5,2),
  pass_fail   TEXT CHECK (pass_fail IN ('Pass','Fail')),
  notes       TEXT,
  worker      TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX ON haccp_temp_logs (log_date DESC, zone);
```

---

## 2. API Endpoint Mapping

Auth header required on all requests: `apikey: <SUPABASE_ANON_KEY>` (reads) or `Authorization: Bearer <SERVICE_ROLE_KEY>` (writes via Edge Functions).

### 2.1 PostgREST — direct table access (no custom logic)

| GAS action | Method | Supabase endpoint | Notes |
|---|---|---|---|
| `allProducts` | GET | `/rest/v1/products?select=*&active=eq.true` | |
| `getProductsExtended` | GET | `/rest/v1/products?select=*` | |
| `getAllCodes` | GET | `/rest/v1/products?select=code&active=eq.true` | |
| `saveProduct` (new) | POST | `/rest/v1/products` | `Prefer: resolution=merge-duplicates` |
| `saveProduct` (edit) | PATCH | `/rest/v1/products?code=eq.{code}` | |
| `saveProductPriority` | PATCH | `/rest/v1/products?code=eq.{code}` | body `{priority}` |
| `deleteProduct` | PATCH | `/rest/v1/products?code=eq.{code}` | soft-delete: `{active:false}` |
| `inventory` | GET | `/rest/v1/inventory?select=*` | |
| `saveInventory` | POST | `/rest/v1/inventory` | `Prefer: resolution=merge-duplicates` |
| `deleteInventory` | DELETE | `/rest/v1/inventory?code=eq.{code}` | |
| `workers` / `allWorkers` | GET | `/rest/v1/workers?aktiv=eq.true` | |
| `getRolePINs` | GET | `/rest/v1/workers?select=rolle,pin&aktiv=eq.true` | |
| `verifyPin` | GET | `/rest/v1/workers?pin=eq.{pin}&aktiv=eq.true&select=name,rolle&limit=1` | |
| `saveWorker` | POST | `/rest/v1/workers` | `Prefer: resolution=merge-duplicates` on `name` |
| `deleteWorker` | PATCH | `/rest/v1/workers?name=eq.{name}` | soft-delete: `{aktiv:false}` |
| `scans` | GET | `/rest/v1/scans?order=scanned_at.desc` | |
| `archivedScans` | GET | `/rest/v1/scans_archive?order=scanned_at.desc` | |
| `getMenus` | GET | `/rest/v1/menus?select=*&order=name.asc` | |
| `saveMenu` (new) | POST | `/rest/v1/menus` | |
| `saveMenu` (edit) | PATCH | `/rest/v1/menus?id=eq.{menuId}` | |
| `deleteMenu` | DELETE | `/rest/v1/menus?id=eq.{menuId}` | |
| `getGRs` | GET | `/rest/v1/grundrezepturen?order=name.asc` | |
| `saveGR` (new) | POST | `/rest/v1/grundrezepturen` | |
| `saveGR` (edit) | PATCH | `/rest/v1/grundrezepturen?gr_code=eq.{grCode}` | |
| `deleteGR` | DELETE | `/rest/v1/grundrezepturen?gr_code=eq.{grCode}` | |
| `getRecipes` | GET | `/rest/v1/recipes?select=*,products(name)` | join for names |
| `saveRecipe` | POST | `/rest/v1/recipes` | `Prefer: resolution=merge-duplicates` on `(mep_code,rm_code)` |
| `deleteRecipe` | DELETE | `/rest/v1/recipes?mep_code=eq.{mepCode}&rm_code=eq.{rmCode}` | |
| `getDeductions` | GET | `/rest/v1/deductions?order=deducted_at.desc&limit=500` | |
| `getHACCPConfig` | GET | `/rest/v1/haccp_zones?active=eq.true` + `/rest/v1/haccp_tasks?active=eq.true&order=sort_order.asc` | two calls, merge client-side |
| `saveHACCPZone` | POST | `/rest/v1/haccp_zones` | `Prefer: resolution=merge-duplicates` on `id` |
| `deleteHACCPZone` | PATCH | `/rest/v1/haccp_zones?id=eq.{id}` | soft-delete: `{active:false}` |
| `saveHACCPTask` | POST | `/rest/v1/haccp_tasks` | `Prefer: resolution=merge-duplicates` on `id` |
| `deleteHACCPTask` | PATCH | `/rest/v1/haccp_tasks?id=eq.{id}` | soft-delete: `{active:false}` |
| `getHACCPChecks` | GET | `/rest/v1/haccp_checks?check_date=eq.{date}` | |
| `saveHACCPCheck` | POST | `/rest/v1/haccp_checks` | `Prefer: resolution=merge-duplicates` on `(check_date,task_id)` |
| `saveHACCPTemp` | POST | `/rest/v1/haccp_temp_logs` | |
| `getHACCPReport` | GET | `/rest/v1/haccp_temp_logs?log_date=gte.{from}&log_date=lte.{to}&order=log_date.asc` | |
| `archiveStats` / `getArchiveStats` | GET | `/rest/v1/archive_logs?order=archived_at.desc&limit=1` + count on `scans` | two calls |

### 2.2 Edge Functions — actions with business logic

| GAS action | Edge Function | Method | Complexity |
|---|---|---|---|
| `produce` / `done` / `waste` / `used` | `/functions/v1/scan` | POST | Inserts scan row + upserts `mep_stock`, enforces FIFO |
| `undoScan` | `/functions/v1/undo-scan` | POST | Deletes last scan by worker+code, reverses `mep_stock` |
| `getMepOverview` | `/functions/v1/mep-overview` | GET | Aggregates today's scans + products; computes available/goal |
| `getMepStock` | `/functions/v1/mep-stock` | GET | FIFO carry-over calc from `mep_stock` for one code |
| `mepStatus` | `/functions/v1/mep-status` | GET | Single-product view: today scans + shelf life + stock |
| `getRequirements` | `/functions/v1/requirements` | GET | Joins menus → zutaten → inventory; computes shortfalls |
| `saveMenuMep` | `/functions/v1/menu-mep` | POST | Saves MEP assignment inside menu's zutaten JSONB |
| `deleteMenuMep` | `/functions/v1/menu-mep` | DELETE | Removes MEP entry from menu's zutaten JSONB |
| `markOrdered` | `/functions/v1/mark-ordered` | POST | Updates `inventory.last_order` + appends order log |
| `archiveNow` | `/functions/v1/archive-now` | POST | Moves scans older than 30 days to `scans_archive`; writes `archive_logs` |
| `reportPreview` | `/functions/v1/report-preview` | GET | Builds weekly HTML report from scans + inventory |
| `reportSendNow` | `/functions/v1/report-send` | POST | Sends report via Resend (replaces GmailApp) |
| `getSalesAnalysis` | `/functions/v1/sales-analysis` | GET | Aggregates `sales_history`; computes sparklines, FC%, suggestedMep |
| `importSalesCSV` | `/functions/v1/import-sales` | POST | Parses and bulk-inserts CSV rows into `sales_history` |
| `importSalesFromDrive` | `/functions/v1/import-sales-drive` | POST | Fetches file from Google Drive, then same as above |
| `getAllItemsForMatching` | `/functions/v1/items-for-matching` | GET | Returns merged list of products + inventory for PDF matcher |
| `parseRecipePdf` | `/functions/v1/parse-pdf` | POST | Calls Claude/Vision API to parse PDF; returns ingredient list |
| `parsePdfVision` | `/functions/v1/parse-pdf-vision` | POST | Vision extraction, single page |
| `storeChunk` | `/functions/v1/store-chunk` | POST | Stores parsed chunk in temp KV (Supabase ephemeral table) |
| `parsePdfVisionChunked` | `/functions/v1/parse-pdf-chunked` | POST | Orchestrates multi-chunk PDF parse, assembles result |
| `importParsedRecipe` | `/functions/v1/import-recipe` | POST | Writes parsed ingredients to `recipes` or `grundrezepturen` |
| `parseMenuPdf` | `/functions/v1/parse-menu-pdf` | POST | Menu-specific PDF parsing variant |
| `allergenPDF` | `/functions/v1/allergen-pdf` | GET | Reads menus+GRs+products, renders HTML allergen matrix |
| `exportHACCP` | `/functions/v1/haccp-export` | GET | Reads `haccp_temp_logs`, renders HTML report for printing |

---

## 3. Migration Strategy — GAS as Fallback

### Phase 0 — Prep (no user impact)
1. Add Supabase project, note `SUPABASE_URL` and `SUPABASE_ANON_KEY`.
2. Run all `CREATE TABLE` statements above.
3. Export every Google Sheet to CSV; transform and import.
4. Validate row counts match.

### Phase 1 — Dual-backend wrapper in `dashboard.html`

Replace the single `get()` function with a routing layer:

```javascript
const SUPABASE_URL = "https://<project>.supabase.co";
const SUPABASE_KEY = "<anon-key>";

// Tables already migrated to Supabase (add one at a time)
const SUPABASE_TABLES = new Set([
  // "products", "inventory", ...  ← uncomment as each table is verified
]);

async function get(params) {
  const action = params.action || "";
  if (SUPABASE_TABLES.has(actionToTable(action))) {
    try { return await supabaseGet(params); }
    catch(e) { console.warn("Supabase failed, falling back to GAS", e); }
  }
  // GAS fallback
  const res = await fetch(API + "?" + new URLSearchParams(params));
  return res.json();
}
```

GAS stays deployed at its existing URL throughout. A 500 or network error from Supabase automatically retries against GAS.

### Phase 2 — Table-by-table cutover order

Migrate in this order (lowest risk first):

| Week | Tables | Risk |
|---|---|---|
| 1 | `workers`, `haccp_zones`, `haccp_tasks` | Read-heavy, small, no FK deps |
| 1 | `haccp_checks`, `haccp_temp_logs` | Append-only, isolated |
| 2 | `products`, `inventory` | Core reference data; high read volume |
| 2 | `grundrezepturen`, `recipes` | Depends on products + inventory |
| 3 | `menus` | JSONB zutaten; test allergen PDF |
| 3 | `sales_history` | Large CSV; bulk import Edge Function |
| 4 | `scans` + scan Edge Function | Highest risk; touches MEP_Stock FIFO |
| 4 | `mep_stock`, `deductions` | Depends on scan function being stable |
| 5 | `archive_*`, reports, PDF parsing | Low frequency; replace GmailApp with Resend |

### Phase 3 — Final cutover
1. Set `SUPABASE_TABLES` to `"*"` (all actions route to Supabase by default).
2. Keep GAS deployed for 2 weeks; monitor error logs.
3. After no GAS fallback hits for 5 consecutive days, decommission GAS.

### Auth note
This app uses PIN-based role auth, not JWT. During migration use the **service role key** inside Edge Functions for writes, and the **anon key** with permissive RLS for reads. Proper row-level security can be added post-migration once a Supabase Auth session is wired up to the PIN flow.

---

## 4. Hour Estimates

| Phase | Task | Hours |
|---|---|---|
| **Schema & setup** | Write all DDL, RLS policies, indexes; Supabase project config | 3 |
| **Data migration** | Export CSVs, transform (especially JSONB zutaten), bulk import, validate | 6 |
| **Dual-backend wrapper** | `get()` / `adminCall()` routing layer + feature flags in frontend | 3 |
| **PostgREST endpoints** | Verify all 30 direct-table actions work via PostgREST; update response-shape adapters | 6 |
| **Edge Functions — scan** | `scan`, `undo-scan`, `mep-overview`, `mep-stock`, `mep-status` (FIFO logic) | 8 |
| **Edge Functions — recipes** | `requirements`, `menu-mep`, `items-for-matching`, `import-recipe` | 4 |
| **Edge Functions — reports** | `report-preview`, `report-send` (swap GmailApp → Resend API) | 4 |
| **Edge Functions — sales** | `sales-analysis`, `import-sales`, `import-sales-drive` | 5 |
| **Edge Functions — PDF/AI** | `parse-pdf`, `parse-pdf-vision`, `parse-pdf-chunked`, `store-chunk`, `parse-menu-pdf` | 6 |
| **Edge Functions — HACCP/PDF** | `allergen-pdf`, `haccp-export`, `archive-now`, `archive-stats`, `mark-ordered` | 4 |
| **Realtime (optional)** | Replace KDS polling with Supabase Realtime channel on `scans` | 4 |
| **Testing & QA** | End-to-end per phase; offline/PWA behaviour; fallback validation | 8 |
| **Cutover & monitoring** | Staged flag flips, GAS fallback monitoring, decommission | 3 |
| | **Total** | **64 h** |

Assumes one developer familiar with both the codebase and Supabase. Add ~20 % if Supabase Edge Functions (Deno) are new. Realtime is optional but free once the infra is in place.

**Effort split:**  
- ~30 % schema + data (one-time)  
- ~45 % Edge Functions (business logic port)  
- ~25 % frontend adapter + testing
