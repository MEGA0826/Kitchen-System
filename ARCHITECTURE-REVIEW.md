# Kitchen MEP — Architecture Review (v2, current state)

*Re-review after the security + reliability hardening pass. Supersedes v1 — the
v1 P0s (client-side PIN auth, anon-writable DB, GET-writes cached by the SW,
duplicate scans) are now **fixed**; this version re-derives the architecture as
it stands and re-ranks what's left. No functionality changed by this document.*

---

## 1. Architecture as it actually runs today

```
┌───────────────────────── CLIENTS (GitHub Pages PWA, SW v97) ─────────────────────────┐
│  index.html (2,977 ln)                     dashboard.html (11,910 ln, ~646 KB)        │
│  Scan station:                             Management app, 10 tabs, 394 fns:          │
│  QR camera, MEP list,                      KDS·Products·Inventory·Recipes/Menus·      │
│  IndexedDB offline queue (idempotent cid)  Orders·Deductions·Sales·HACCP·Reports·Admin│
└─────────┬───────────────────────────┬───────────────────────────┬────────────────────┘
          │ reads + scans             │ reads (anon key)          │ writes (PIN token)
          │ (GET, GAS)                ▼                           ▼
          │                  Supabase PostgREST           Supabase Edge Function
          │                  anon = READ-ONLY (RLS)        admin-gateway (service-role)
          │                        │                           │  login → HMAC token
          ▼                        ▼                           ▼  12 write actions
   Google Apps Script       Postgres (18 tables)         Postgres (service-role,
   doGet router + Sheets     workers/products/inventory   BYPASSRLS)
   (14+ sheets)              /haccp_* migrated;           
          │                  scans+cid idempotency in Sheets
          ▼
   Google Sheets = system of record for everything not yet migrated
```

**Three backends, one app.** This is now a *tri-backend* system:
1. **GAS + Sheets** — still the system of record for scans, menus, GR, recipes,
   deductions, mep_stock, sales, archive, reports, PDF/AI parsing.
2. **Supabase PostgREST (anon, read-only)** — reads for the migrated tables.
3. **Supabase Edge Function `admin-gateway` (service-role)** — all writes to
   migrated tables, gated by a PIN-derived HMAC token.

**Data flow, end to end**
- **Scan:** QR → `index.html` → `GET ?action=…&cid=<uuid>` → GAS appends to `Scan`
  + updates the `MEP_Stock` FIFO ledger. Offline scans queue in IndexedDB and
  replay idempotently (dedupe on `cid`). Re-entrancy-guarded retry.
- **Dashboard read:** `get()` checks `_sbActions[action]`; migrated reads hit
  PostgREST with the anon key, everything else falls through to GAS. Cache-first
  hydrate from sessionStorage, then `Promise.allSettled` fan-out, then a 60 s
  full-scans poll + a 4 min GAS keep-warm ping.
- **Dashboard write:** `_sbActions` write handlers → `gwWrite()` → `admin-gateway`
  with the stored PIN token → service-role write. On gateway failure the call
  falls back to GAS (writes degrade to Sheets, not to failure).
- **Auth:** PIN → `admin-gateway/login` (or Supabase `verify_pin` RPC / GAS
  `verifyPin` fallback) → server-side check → signed token (12 h). No PINs on
  the client; role gates tabs.

---

## 2. What's resolved since v1 (don't re-litigate)

- ✅ PINs never leave the server; login is server-side (RPC + gateway + GAS).
- ✅ Anon key is **read-only** — every table's write policy revoked; writes only
  via the service-role Edge Function behind a PIN token. Verified: anon write → 42501.
- ✅ Service worker (v97) never answers write actions from cache.
- ✅ Scans are idempotent (`cid`), retry is re-entrancy-guarded, and a 200-with-error
  is no longer treated as success. Undo of a queued scan no longer deletes a synced row.
- ✅ The swallowed `const saved` init `TypeError` and the `deleteInventoryItem`
  `ReferenceError` are fixed; the CHF/kg picker math is corrected.

---

## 3. Critical problem areas (re-ranked for the current code)

### C1 — The monolith is growing, not shrinking *(now the #1 risk)*
`dashboard.html` is **11,910 lines / 394 top-level functions / ~646 KB in one
file** — up ~3,000 lines since the start of this engagement, from concurrent
development. There is no module boundary: every function is a global, modals
coexist by ID-prefix convention (`epf-`/`mep-`/`eif-`), and four `<script>`
blocks share one namespace. Every new feature enlarges the blast radius and the
merge-conflict surface. **The `js/` modules created in v1 (`api/state/ui/main`)
are still referenced by 0 pages** — the extraction was planned and never adopted.
This is the root maintainability problem and it compounds daily.

### C2 — Stored-XSS surface is unchanged
**186 `innerHTML` assignment sites** interpolate product/worker/menu/ingredient
names; only ~22 do an ad-hoc `replace(/"/g,'&quot;')` (attribute-only), and there
are **two byte-identical escape helpers** (`_escM` :10067, `_hEscH` :10293). A
product named `<img src=x onerror=…>` executes in every viewer's browser. This is
both a security bug and a duplication/maintainability bug.

### C3 — Read exposure via the public anon key
Anon is read-only but can still **read every table** (`anon read` USING true).
Recipes, ingredient costs, supplier prices, sales history and margins are all
downloadable by anyone who reads the anon key from page source. Writes are locked;
reads are wide open.

### C4 — Tri-backend data divergence
Reads for migrated tables come from Postgres; writes go through the gateway — but
on any gateway failure the write **falls back to GAS/Sheets**, which the Postgres
read won't reflect. The migration is half-done and the system of record is split
per-table, so a table can legitimately disagree with itself depending on which
backend served the last write.

### C5 — Duplicated components
- **Four hand-rolled searchable pickers** (ingredient `ip-*`, product-RM `epf-rm-*`,
  GR picker, PDF quick-add) — same filter→slice(40)→innerHTML→select→cost logic.
- **Cost conversion** (`kostenUnit/weightUnit`) re-implemented at 8+ sites.
- **`get()` and `adminCall()`** remain byte-identical.
- Two menu-list renderers; parallel `scanStats` + `window.todayScanStats`.

### C6 — Performance
60 s poll refetches the **entire** scans list; `filterIngredientPicker`
recomputes every product's recipe cost on every keystroke (O(products×recipes×inv));
646 KB parsed on every load with all 10 tabs' DOM up front; sales analysis pages
the whole `sales_history` table client-side; a keep-warm ping fires from every
open client.

---

## 4. Clean target architecture

```
pages (index.html / dashboard.html)  ← thin: markup + event wiring only
        │  <script src=js/*.js>
        ▼
  js/api.js    Api.call()      — GAS + PostgREST + gateway routing, retry, dedupe, cache
  js/state.js  Store           — one source of truth, subscribe(), no window.* globals
  js/ui.js     UI + Cost       — esc(), el(), debounce, dateKey, createPicker(), pricePerKg()
  js/main.js   Main.init*()    — boot sequence (hydrate → fan-out → subscribe → poll)
        ▼
  backends: GAS (legacy tables) · PostgREST reads · admin-gateway writes
```
Every view becomes: read from `Store`, render via `UI.el`/escaped templates,
write via `Api.call` (which the gateway secures). No view calls another view's
render function by name — they subscribe.

---

## 5. Refactoring strategy (incremental, zero functional change per step)

**Phase 1 — Adopt the modules that already exist (highest ROI).**
`js/api.js/state.js/ui.js/main.js` are written and committed but inert. Wire them
in additively (`<script src>` before the inline block — defines `window.Api/Store/UI/Cost/Main`,
changes nothing), then migrate call sites in small verifiable batches:
- Route the 8+ cost sites through `Cost.pricePerKg()` (the CHF/kg rule lives once).
- Replace `_escM`/`_hEscH` and the 22 ad-hoc escapes with `UI.esc()`; then sweep
  the 186 `innerHTML` sites to pass user data through it (this closes C2).
- Collapse the four pickers into `UI.createPicker(config)`.

**Phase 2 — Freeze monolith growth.** New features land in `js/` modules, not in
`dashboard.html`. Add a lint/size check that fails CI if `dashboard.html` grows.

**Phase 3 — Close read exposure (C3).** Move sensitive reads (recipes, costs,
sales) behind the gateway too (token-gated `read` actions), or split public vs.
private tables. Keep KDS/product reads anon if acceptable.

**Phase 4 — Converge the backends (C4).** Finish the per-table cutover so each
table has exactly one system of record; drop the GAS write-fallback for tables
that are fully on Postgres; replace the 60 s poll with Supabase Realtime on `scans`.

### What *not* to do
No framework big-bang rewrite of a live kitchen app. The tri-backend fallback is
the migration spine; extraction-by-attrition keeps every step shippable.

---

## 6. Improved production-grade code

The reusable core already lives in `js/api.js`, `js/state.js`, `js/ui.js`,
`js/main.js` (committed, still inert). Two concrete, functionality-preserving
examples of the adoption:

**Collapse the two duplicate escapers to one (safe: identical output today).**
```js
// dashboard.html — replace both _escM (:10067) and _hEscH (:10293) with delegators
function esc(v){ return UI.esc(v); }     // the single implementation lives in js/ui.js
const _escM = esc, _hEscH = esc;         // keep old names working; one source of truth
```

**Collapse a picker to the factory (example: epf-rm picker).**
```js
// was ~60 lines of filter/slice/innerHTML/select; becomes config + one call
const epfRmPicker = UI.createPicker({
  listEl:   document.getElementById("epf-rm-results"),
  searchEl: document.getElementById("epf-rm-search"),
  getItems: () => allInventory.filter(r => r.code)
                    .map(r => ({ code:r.code, name:r.name||r.code, unit:r.unit||"kg",
                                 unitCost: Cost.pricePerKg(r) })),          // CHF/kg rule, once
  renderMeta: i => i.unitCost ? `CHF ${i.unitCost.toFixed(2)}/kg` : "",
  onSelect: i => selectEpfRm(i.code, i.name, i.unit),
});
```

Each such change is a mechanical, independently-testable diff. Adoption is the
next deliberate step — say the word and I'll start Phase 1 in small verified batches.
```
