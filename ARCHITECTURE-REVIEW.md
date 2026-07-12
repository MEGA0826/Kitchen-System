# Kitchen MEP — Architecture Review

*Senior-engineer review, 2026-07-12. Scope: full repo (`dashboard.html`, `index.html`, `onboarding.html`, `i18n.js`, `service-worker.js`) plus the GAS/Supabase backend as visible from the client. No functionality was changed; the `js/` modules added alongside this doc are inert until a page references them.*

---

## 1. Current architecture (reverse-engineered)

```
┌────────────────────────── CLIENTS (GitHub Pages PWA) ──────────────────────────┐
│                                                                                │
│  index.html (2,681 ln)          dashboard.html (9,460 ln, 542 KB)              │
│  Scan station:                  Management app, 10 tabs:                       │
│  QR camera, MEP list,           KDS · Products · Inventory · Recipes/Menus     │
│  offline IndexedDB queue        Orders · Deductions · Sales · HACCP            │
│                                 Reports · Admin                                │
│          │  shared: i18n.js, service-worker.js (v21), manifest.json           │
└──────────┼─────────────────────────────────────────────────────────────────────┘
           │ GET ?action=<name>&…            │ REST (anon key, from page source)
           ▼                                 ▼
   Google Apps Script (doGet router)   Supabase PostgREST  ← dual-backend,
   hardcoded deployment URL            workers/products/inventory/HACCP migrated;
           │                           everything else falls back to GAS
           ▼
   Google Sheets (14+ sheets)  ← the actual database
   Produkt · Scan · Lager · MEP_Stock (FIFO ledger) · Menus · GR · Rezeptur
   Deductions · Sales_History · HACCP* · Archive · Settings (workers + PINs)
```

**Data flow, end to end**

1. **Scan path:** QR → `index.html` → `GET ?action=produce|done|waste|used` → GAS appends to `Scan` sheet and read-modify-writes the `MEP_Stock` FIFO ledger. Offline scans queue in IndexedDB and replay via Background Sync.
2. **Dashboard init:** restore `allProducts/allInventory/allScans` from `sessionStorage` → `Promise.allSettled([loadProducts, loadInventory, loadKDS, allWorkers])` → per-tab loaders. Then **poll the entire `scans` list every 60 s** and ping GAS every 4 min to keep it warm.
3. **Routing layer:** `get(params)` checks `_sbActions[action]`; if the action is migrated it hits Supabase, on any error silently falls back to GAS (dashboard.html:2542).
4. **State:** four mutable globals (`allScans`, `allProducts`, `allInventory`, `scanStats`) plus `window.*` mirrors and sessionStorage copies; every view re-renders sections with `innerHTML` (162 assignment sites).

---

## 2. Critical problem areas (ranked)

### P0 — Security: the auth model is decorative

- **All worker PINs are downloaded to every browser.** `submitPin()` (dashboard.html:2239) compares the typed PIN against `allWorkersAdmin`, which came from `?action=allWorkers` *including the `pin` field*. `index.html` similarly fetches `getRolePINs`. Anyone can open DevTools → Network and read every PIN and role.
- **Role gating is client-side theatre.** Access = `sessionStorage.setItem("isAdminUnlocked","true")` plus hiding tabs. One console line grants Manager access.
- **The Supabase anon key in the page source can write the whole DB.** `sbPost/sbPatch/sbDelete` (dashboard.html:2320-2344) write directly with the anon key, so RLS must currently be wide open. Anyone who views source can deactivate all workers or wipe inventory. MIGRATION.md itself says writes belong in Edge Functions with the service-role key — the interim shortcut is the single biggest risk in the system.

### P0 — Correctness: writes ride on GET through a caching service worker

- All mutations (scans, saves, deletes via GAS) are `GET` requests. The service worker routes `script.google.com` through `networkFirstWithCache` with a 5-min TTL fallback (service-worker.js:46). A repeated scan URL (same worker+code+action) that fails on the network can be **answered from cache as a success** — a silently lost write. GET writes are also replayable by prefetchers and proxies.
- The `MEP_Stock` FIFO ledger is updated read-modify-write in GAS with no locking; two scan stations hitting the same product concurrently can lose an update.

### P1 — A swallowed `TypeError` in dashboard init

`const saved = sessionStorage.getItem("activeTab") || "kds"` … `if (saved === "mep-overview") saved = "products"` (dashboard.html:4383-4390). Assigning to a `const` throws; the error lands in `.catch(e => console.error("Init error", e))`, so users with the old saved tab silently skip the whole post-fetch re-render block.

### P1 — Stored-XSS surface across the app

162 `innerHTML` sites interpolate product/worker/menu names; only ~18 do ad-hoc `replace(/"/g,'&quot;')` (attributes only, not text nodes), and there are **two competing escape helpers** (`_escM` :7842, `_hEscH` :8062). A product named `<img src=x onerror=…>` executes in every viewer's browser. Even benign names with `&` or `<` render wrong today.

### P1 — Cost math is duplicated and already inconsistent

CLAUDE.md's own hard rule: *pricePerKg = kostenUnit / weightUnit — never read kostenUnit as CHF/kg*. The conversion is re-implemented at 8+ sites; most divide correctly (e.g. `selectIngredientItem` :7453), but `selectEpfRm` (:5111) stores `kostenUnit` raw and `filterEpfRmSearch` (:5104) displays it as `CHF …/kg`. Duplication turned the #1 domain rule into a whack-a-mole.

### P2 — The monolith itself

- 9,460 lines / 542 KB in one HTML file, **317 top-level global functions**, four `<script>` blocks, modal collisions avoided only by ID-prefix convention (`epf-`, `mep-`, `eif-`).
- `js/api.js`, `js/state.js`, `js/ui.js`, `js/main.js` exist as empty 2-byte stubs — a planned modularization that never happened; no page references them.
- Self-monkey-patching (`window.openEditInventoryModal` wrapped at :4412), dead stubs (`setRelType(){}`), a commented-out GAS backend template pasted inside the frontend (:4480), Stripe config with placeholder keys.
- No build, lint, tests, or types. Several CLAUDE.md rules ("Line 1 corruption", smart quotes, manual `sw.js` version bumps) are compensations for the missing toolchain.

---

## 3. Duplicate logic inventory

| Duplicated concern | Copies | Locations |
|---|---|---|
| Searchable ingredient/RM picker (filter → slice(0,40) → innerHTML rows → select → cost) | **4** | `ip-*` :7384, `epf-rm-*` :5063, GR picker :7572, PDF quick-add :8913 |
| kostenUnit/weightUnit cost conversion | 8+ | pickers, `_enrichProducts`, `rNodeCost`, `calcIp*`, … |
| HTML escaping | 2 helpers + 18 inline | `_escM`, `_hEscH`, scattered `replace(/"/g)` |
| `get()` vs `adminCall()` | 2 | :2542 and :2552 are byte-identical |
| `en-CA` date-key formatting | 11 | throughout |
| Theme/clock/i18n/worker bootstrap | 2 | index.html re-implements dashboard's `setTheme`, `updateLiveTime`, worker loading |
| Menu list rendering | 2 | `renderMenuList` :6944 vs `renderMenuListByCat` :7027 |
| Today-scan aggregation | 2 parallel structures | `scanStats` + `window.todayScanStats` built in the same loop :2579 |

---

## 4. Performance & scalability

**Bottlenecks now**
- Every poll (60 s) refetches the **entire scans table** and rebuilds stats over all rows; the table grows unbounded between manual archives.
- `filterIngredientPicker` recomputes recipe cost for *every product* on *every keystroke* — `allRecipes.filter` × `allInventory.find` inside a map is O(products × recipes × inventory).
- 542 KB parsed and evaluated on every load; all 10 tabs' DOM exists up front.
- GAS: whole-sheet reads per request, 2–3 s cold starts patched by a keep-warm ping *from every open client* (which also burns GAS quota).
- `sales_history` is already a 7.2 MB CSV, aggregated through GAS over GET.

**Scalability ceilings**
- Google Sheets: 10M-cell hard cap, no transactions, no indexes; GET URL-length limits already forced "chunked upload" workarounds.
- Single hardcoded spreadsheet ID = single-tenant, while Stripe subscription scaffolding implies multi-restaurant ambitions. Multi-tenancy is impossible on this backend; it's native to the Supabase target (add `restaurant_id` FK + RLS).
- No pagination anywhere.

---

## 5. Refactoring strategy (incremental, zero functional change per step)

The strategy is: **finish the Supabase migration you already planned (MIGRATION.md), but fix the security model as part of it, and pay down the monolith by extraction, not rewrite.**

### Phase 0 — Safety fixes inside the current code (hours)
1. Fix the `const saved` reassignment (:4383) — change to `let`.
2. Exclude write actions from the SW API cache: in `service-worker.js`, only apply `networkFirstWithCache` to a whitelist of *read* actions; let writes hit the network or fail loudly.
3. Stop shipping PINs to the client: change GAS `allWorkers` to strip `pin`, add a `verifyPin` action that does the comparison server-side (the Supabase mapping table already defines it).

### Phase 1 — Extract shared modules (1–2 days)
Fill the existing `js/` stubs (done alongside this review — see `js/api.js`, `js/state.js`, `js/ui.js`, `js/main.js`) and load them via `<script src>` before the inline block. Then migrate call sites gradually:
- `get`/`adminCall`/`sbGet…` → `Api` (adds timeout, retry, in-flight dedupe, read-cache; behavior-compatible signature).
- Globals → `Store` (same data shapes; views subscribe instead of being called by name).
- `escapeHtml`, `fmtDate`, `debounce`, `pricePerKg` → `UI`/`Cost` so the CHF/kg rule lives in exactly one function.
Each moved function is a mechanical, testable diff. `index.html` loads the same modules and deletes its copies.

### Phase 2 — Deduplicate components (2–3 days)
- One `createPicker(config)` factory replaces the four pickers; each becomes ~10 lines of config (data source, cost formula, on-select).
- One menu-list renderer parameterized by category filter.
- Route every `innerHTML` interpolation through `UI.esc()`; delete `_escM`/`_hEscH`.

### Phase 3 — Finish the backend migration with the right trust boundary (per MIGRATION.md, ~64 h)
- Writes move to Edge Functions (service-role key server-side); RLS locks the anon key to reads (and only non-secret columns — a `workers_public` view without `pin`).
- PIN login becomes an Edge Function that returns a short-lived signed token; role checks happen server-side.
- Scans become `POST` with an idempotency key (solves both GET-write caching and the offline-queue replay duplicating scans).
- `mep_stock` FIFO moves into a Postgres transaction/RPC — eliminates the lost-update race.

### Phase 4 — Performance (after cutover)
- Replace the 60 s full-table poll with Supabase Realtime on `scans` (KDS becomes push).
- Paginate scans/deductions; aggregate sales server-side (`sales-analysis` Edge Function).
- Delete the keep-warm ping.
- Optional: adopt Vite so the monolith can split into per-tab modules with hashed filenames (kills manual `sw.js` version bumps).

### What *not* to do
Do not big-bang rewrite the dashboard in a framework. The app is live in a kitchen; the per-table dual-backend fallback pattern already in place is the right migration spine. Extraction keeps every step shippable.

---

## 6. Where the improved code lives

- `js/api.js` — unified API client: GAS+Supabase routing, timeout, retry with backoff, in-flight deduplication, read cache, and a snake→camel row mapper that replaces the hand-written per-action mapping objects.
- `js/state.js` — single store with `get/set/subscribe`, sessionStorage hydration, and derived today-stats (replaces `allScans`/`window.todayScanStats` double bookkeeping).
- `js/ui.js` — `esc()` (the one escape helper), `el()` safe DOM builder, `debounce`, `fmtDateKey`, toast, and the generic `createPicker()` factory.
- `js/main.js` — reference init wiring showing the modules composed the way dashboard.html:4346-4409 works today (cache-first hydrate → parallel fetch → tab re-render → polling), minus the bugs.

These files are **not yet referenced by any page** — adopting them is Phase 1 and is deliberately left as explicit, reviewable diffs to `dashboard.html`.
