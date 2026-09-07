# Kitchen MEP — set up a new kitchen (fork & go)

Kitchen MEP is a static PWA (plain HTML/JS, no build step) backed by a Supabase project.
To run it for a **new kitchen**, you give that kitchen its own Supabase project and point
the app at it by editing **one file** (`config.js`). ~30 minutes end to end.

---

## What you need
- A [Supabase](https://supabase.com) account (free tier is fine).
- Any static host: **GitHub Pages**, Netlify, Vercel, Cloudflare Pages… (this repo ships on GitHub Pages).
- The [Supabase CLI](https://supabase.com/docs/guides/cli) *(optional, only for the analytics layer — see below).*

---

## 1. Create the Supabase project
1. supabase.com → **New project**. Note the **Project URL** and the **anon (public) key**
   (Project Settings → API). The anon key is safe to ship in the client — RLS makes it read-only.
2. Keep the **service-role key** private — it never goes in the app; only the Edge Function uses it.

## 2. Create the database
Open **SQL Editor** in your project and run **[`db/schema.sql`](db/schema.sql)**.
This creates every table, enables RLS, grants anon **read-only** access to the operational tables,
and **keeps the `workers` table (PINs) gateway-only**. It also installs the core functions
(`verify_pin`, `import_sales_rows`, …).

> **Security note:** a fresh Supabase table grants `anon` by default — which would expose worker PINs.
> `schema.sql` explicitly `REVOKE`s anon on `workers`, so PINs are never readable with the public key.
> All writes and PIN checks go through the Edge Function below.

## 3. Deploy the write gateway (Edge Function)
All writes are PIN-gated and executed server-side with the service-role key by the
**`admin-gateway`** function ([`supabase/functions/admin-gateway/index.ts`](supabase/functions/admin-gateway/index.ts)).

```bash
supabase link --project-ref <your-project-ref>
supabase functions deploy admin-gateway --no-verify-jwt
```
`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically by Supabase — no extra secrets needed.
(No CLI? Paste the file's contents into Dashboard → Edge Functions → New function → `admin-gateway`, then Deploy.)

## 4. Add your first staff PIN
In SQL Editor:
```sql
insert into public.workers (name, rolle, pin, aktiv)
values ('Owner', 'Manager', '1234', true);
```
That PIN is what unlocks admin/writes in the app (Manager sees every tab).

## 5. Point the app at your project — edit `config.js`
Open **[`config.js`](config.js)** and set:
```js
window.KMEP_CONFIG = {
  SB_URL: "https://<your-ref>.supabase.co",
  SB_KEY: "<your anon public key>",
  API: "",                       // leave empty (legacy Google Apps Script; unused on a fresh setup)
  businessName: "Your Kitchen",  // shows in the header, tab title, menus & PDFs
  appTitle: "Kitchen MEP",
};
```
That's the only file you edit. Everything else (header, tab title, menu PDFs, Settings defaults) follows it.

## 6. Deploy the static site
- **GitHub Pages:** fork this repo, Settings → Pages → deploy from `main` (root). Your app is at
  `https://<user>.github.io/<repo>/dashboard.html`.
  ⚠️ The service worker precache paths are `/<repo>/…` in `service-worker.js` — if your repo name isn't
  `Kitchen-System`, update those paths (or host at the domain root).
- **Netlify/Vercel/Cloudflare:** drag-and-drop or connect the repo; serve the folder as-is (no build).

## 7. First run
Open `dashboard.html`, tap **🔐 Admin**, enter the PIN. Or use the guided **onboarding wizard**
(`onboarding.html`) to add your first products, targets, staff and QR labels. Set business name,
currency, VAT and target food-cost in **⚙️ Settings** — those flow into pricing, menus and PDFs.

---

## Analytics & AI layer (optional)
The **Menu Engineering** dashboard and the **AI "Ask"** feature use extra Postgres objects
(`ask_run_sql`, and the `menu_expansion` / `component_sales` / `rm_sales` / `menu_engineering` views).
They're not required for core kitchen ops. To copy them faithfully from the reference project:

```bash
# against the REFERENCE project, dump the full public schema (includes the analytics views/RPCs):
supabase db dump --project-ref clntikfffmjytexvzubq --schema public -f db/analytics-full.sql
# then run the view/function statements from that file on your new project.
```
The AI feature also needs the `ask` Edge Function and an `ASK_MODEL` / Anthropic API key secret —
deploy it the same way as `admin-gateway` if you want natural-language queries.

## Recap — the per-kitchen surface
| What | Where |
|---|---|
| Connection + identity | `config.js` (the only file you edit) |
| Database | `db/schema.sql` (run once) |
| Write gateway | `supabase/functions/admin-gateway/index.ts` (deploy once) |
| First PIN | one `insert into workers` |
| Everything else | driven by config + Settings |
