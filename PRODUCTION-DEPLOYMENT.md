# Kitchen MEP — Production Deployment & Ops

*Senior-DevOps production-readiness plan. Grounded in what this app actually is:
a **static PWA + Supabase (managed Postgres + Deno Edge Functions) + a legacy
Google Apps Script backend**. There is no build step and no server to run.*

---

## 0. The most important call first: right-size the infrastructure

**Do not put this app on Kubernetes.** It is a static frontend and serverless
functions. Containers/K8s would add cost, a control plane to patch, and on-call
burden for **zero benefit** — a static site scales on a CDN and Edge Functions
auto-scale on Deno isolates. The production-grade architecture here is
**CDN + managed serverless + managed Postgres**, which is most of what you
already have. Section 5 still gives you Docker/K8s manifests, but only for the
two cases where they'd ever apply (self-hosting the frontend, or replacing GAS
with your own container).

---

## 1. Current state (honest assessment)

| Area | Today | Gap / risk |
|---|---|---|
| Frontend | Static files pushed to `MEGA0826/Kitchen-System`, served by GitHub Pages at `mega0826.github.io/Kitchen-System` | No CI, no staging, no custom domain, **manual service-worker cache-version bumps** (v96→v103 by hand) |
| Reads | Supabase PostgREST, anon key, RLS read-only | anon key can still *read* all tables (business data exposure) |
| Writes | `admin-gateway` Edge Function (Deno, service-role, PIN token), v5 | Deployed manually via MCP; not in CI |
| DB | Supabase Postgres `clntikfffmjytexvzubq` (eu-west-1) | **Migrations applied ad-hoc — NOT in git.** No reproducible schema |
| Legacy | Google Apps Script + Sheets (scans, menus, recipes, deductions, mep_stock, reports, PDF/AI) | 6-min exec limit + quotas; manual deploy; single spreadsheet = single-tenant |
| Secrets | service-role auto-injected into Edge Fn; `ANTHROPIC/OPENAI` keys in GAS Script Properties; anon key public | No rotation policy; Stripe keys are placeholders |
| Monitoring | Supabase logs only | No uptime checks, no frontend error tracking, no alerting |
| Backups | Ad-hoc (`sales_history_backup_predup`) | No documented backup/restore/rollback runbook |
| CI | **None** (a stray `};` in i18n.js reached prod and broke translations) | Added `scripts/validate.js` + `.github/workflows/validate.yml` |

**Top three production blockers**
1. **Supabase plan** — the Free tier **pauses the database after 7 days of
   inactivity** (internal pg_cron does *not* prevent it). For production the
   project **must be on a paid plan** or you get random outages. *(Highest priority.)*
2. **Migrations not in git** — the schema (RLS, `import_sales_rows`, `verify_pin`,
   `import_log`, all tables) exists only in the live DB. Run `supabase db pull`
   to capture it so the DB is reproducible and reviewable.
3. **No monitoring** — you find out about downtime from a chef, not an alert.

---

## 2. Infrastructure architecture

```
                        ┌──────────────── Users (kitchen tablets / phones) ────────────────┐
                        │  PWA, offline-capable (service worker v103, IndexedDB scan queue) │
                        └───────────────────────────────┬──────────────────────────────────┘
                                                        │ HTTPS
                          ┌─────────────────────────────┴─────────────────────────────┐
                          ▼                                                             ▼
              CDN (GitHub Pages today;                                     Supabase (managed, eu-west-1)
              Cloudflare in front recommended)                            ┌───────────────────────────┐
              static: *.html, i18n.js, sw.js,                            │ PostgREST  (reads, anon RO) │
              manifest, icons, js/                                        │ Edge Fn admin-gateway       │
                          │                                               │   (writes, service-role,    │
                          │ reads (anon key)  writes (PIN token)          │    PIN-token auth)          │
                          └───────────────┬───────────────┬──────────────▶│ Postgres + RLS + RPCs       │
                                          │               │               │ PITR backups (paid)         │
                                          │               │               └───────────────────────────┘
                                          ▼ legacy reads/writes (fallback)
                                Google Apps Script  ──►  Google Sheets  (to be retired)
```

**Environments** (introduce staging — you have none today):

| Env | Frontend | Supabase | Purpose |
|---|---|---|---|
| **dev** | local `dhttpd`/`python -m http.server` | Supabase **branch** or a `-dev` project | day-to-day work |
| **staging** | Pages `gh-pages`/Cloudflare preview, or `staging.` subdomain | Supabase **branch** (isolated data) | smoke tests before prod |
| **prod** | Pages `main` + custom domain | main project (paid, PITR on) | live kitchen |

Use **Supabase Branching** (paid) for ephemeral dev/staging DBs seeded from prod
schema — no second project to babysit.

---

## 3. Deployment workflow

```
feature branch ──PR──▶ CI validate + preview ──review──▶ merge to main
        │                                                     │
        │                                          CI: validate → deploy staging → smoke
        │                                                     │  (auto)
        └──────────────────────────────── promote (tag) ──────┘
                                                              │
                                              CI: deploy prod → smoke → done
```

Rules:
- **Never push straight to `main`** (this repo is edited by several agents at
  once — protect `main`, require the `validate` check + 1 review).
- **Forward-only DB migrations**, committed as files, applied by CI to staging
  first. Take a snapshot before every prod migration.
- **Rollback = redeploy the previous good commit** (frontend) / **re-point to the
  previous Edge Function version** (Supabase keeps them) / **restore from PITR**
  (DB). Because writes are idempotent (scan `cid`, sales upsert), replays are safe.
- **Service-worker version is stamped from the git SHA at deploy time** (Section 4)
  — no more manual bumps, no more stale-cache incidents.

---

## 4. CI/CD pipeline (GitHub Actions)

**Committed now (safe, no secrets):** `.github/workflows/validate.yml` runs
`node scripts/validate.js` on every push/PR — parses every inline `<script>`,
the JS modules and the service worker. This is the gate that would have stopped
the i18n.js breakage.

**Target full pipeline** (enable once repo secrets `SUPABASE_ACCESS_TOKEN`,
`SUPABASE_PROJECT_REF`, and Pages "source: GitHub Actions" are set):

```yaml
name: Deploy
on:
  push: { branches: [ main ] }
permissions: { contents: read, pages: write, id-token: write }
concurrency: { group: deploy-prod, cancel-in-progress: false }

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "20" }
      - run: node scripts/validate.js

  deploy-frontend:
    needs: validate
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v4
      # Stamp the SW cache version from the commit SHA so every deploy busts the
      # cache automatically — kills the manual-bump / stale-cache problem.
      - name: Stamp service-worker version
        run: |
          SHA="${GITHUB_SHA::8}"
          sed -i -E "s/mep-static-v[0-9a-z]+/mep-static-$SHA/; s/mep-api-v[0-9a-z]+/mep-api-$SHA/" service-worker.js
      - uses: actions/upload-pages-artifact@v3
        with: { path: . }
      - uses: actions/deploy-pages@v4

  deploy-functions:
    needs: validate
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: supabase/setup-cli@v1
      - name: Deploy edge functions (only if changed)
        env: { SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }} }
        run: supabase functions deploy admin-gateway --project-ref ${{ secrets.SUPABASE_PROJECT_REF }}

  migrate:
    needs: validate
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: supabase/setup-cli@v1
      - name: Apply DB migrations
        env: { SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }} }
        run: supabase db push --project-ref ${{ secrets.SUPABASE_PROJECT_REF }}

  smoke:
    needs: [ deploy-frontend, deploy-functions ]
    runs-on: ubuntu-latest
    steps:
      - name: Smoke test live endpoints
        run: |
          set -e
          # frontend reachable
          curl -fsS "https://mega0826.github.io/Kitchen-System/dashboard.html" -o /dev/null
          # anon read works, writes are denied (RLS), gateway rejects no-token
          curl -fsS "$SB/rest/v1/products?select=code&limit=1" -H "apikey: $ANON" -o /dev/null
          test "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$SB/rest/v1/products" -H "apikey: $ANON" -H 'Content-Type: application/json' -d '{}')" = "401" -o "$?" = "0"
          test "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$SB/functions/v1/admin-gateway" -H 'Content-Type: application/json' -d '{"action":"saveProduct"}')" = "401"
        env: { SB: ${{ secrets.SUPABASE_URL }}, ANON: ${{ secrets.SUPABASE_ANON_KEY }} }
```

PR previews: add a `pull_request` job that deploys the branch to a Cloudflare
Pages preview (or a `gh-pages-preview` path) so reviewers click a real URL.

**Pre-req to make this real:** `supabase init` locally + `supabase db pull` to
commit `supabase/migrations/*` and `supabase/config.toml`, so `db push` and
`functions deploy` are reproducible from the repo.

---

## 5. Docker / Kubernetes (only where it applies)

You don't need these for the current stack. They matter in exactly two cases.

**A. Self-host the static frontend** (leaving GitHub Pages). Nginx image:

```dockerfile
# Dockerfile
FROM nginx:1.27-alpine
COPY . /usr/share/nginx/html
# SPA-ish + correct headers for a PWA
RUN printf 'server{listen 8080;root /usr/share/nginx/html;\n\
  location = /service-worker.js { add_header Cache-Control "no-cache"; }\n\
  location / { try_files $uri $uri/ =404; }\n}' > /etc/nginx/conf.d/default.conf
EXPOSE 8080
```

```yaml
# docker-compose.yml  (local preview / small self-host; Supabase stays managed)
services:
  web:
    build: .
    ports: [ "8080:8080" ]
    restart: unless-stopped
```

**B. Run it on Kubernetes** (only if org policy mandates a cluster). The static
site as a Deployment behind an Ingress, with an HPA that will basically never
scale because nginx serving static files is trivial:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata: { name: kitchen-mep-web }
spec:
  replicas: 2
  selector: { matchLabels: { app: kitchen-mep-web } }
  template:
    metadata: { labels: { app: kitchen-mep-web } }
    spec:
      containers:
        - name: web
          image: ghcr.io/mega0826/kitchen-mep-web:__SHA__
          ports: [ { containerPort: 8080 } ]
          readinessProbe: { httpGet: { path: /manifest.json, port: 8080 } }
          livenessProbe:  { httpGet: { path: /manifest.json, port: 8080 } }
          resources: { requests: { cpu: 10m, memory: 32Mi }, limits: { cpu: 100m, memory: 64Mi } }
---
apiVersion: v1
kind: Service
metadata: { name: kitchen-mep-web }
spec: { selector: { app: kitchen-mep-web }, ports: [ { port: 80, targetPort: 8080 } ] }
---
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata: { name: kitchen-mep-web }
spec:
  scaleTargetRef: { apiVersion: apps/v1, kind: Deployment, name: kitchen-mep-web }
  minReplicas: 2
  maxReplicas: 5
  metrics: [ { type: Resource, resource: { name: cpu, target: { type: Utilization, averageUtilization: 70 } } } ]
```

> Reality check: two 32Mi nginx pods to serve static HTML is more moving parts
> than a CDN and will cost more while being *less* reliable. Prefer CDN.

---

## 6. Monitoring & logging strategy

**Frontend (where the users are):**
- **Sentry** (or GlitchTip, self-host) for JS + unhandledrejection + service-worker
  errors, with release = git SHA and source maps. This is the biggest blind spot today.
- A cheap alternative with no vendor: a `logError` gateway action → `error_log`
  table, called from a global `window.onerror` handler.

**Uptime (external, independent of Supabase):** BetterStack/UptimeRobot every
1–5 min against three things:
1. `…/dashboard.html` (frontend/CDN),
2. a new gateway `health` action (returns `{ok:true}` — add it),
3. an anon read `…/rest/v1/products?select=code&limit=1` (DB path).
Alert to Slack/email/PagerDuty on 2 consecutive failures.

**Supabase:** Dashboard logs + **log drains** to Logflare/Datadog for retention;
run `get_advisors` (security + performance) on a schedule and in CI after
migrations; watch Postgres CPU / connections / disk and the Edge Function 5xx rate.

**App-level (already partly built):**
- `import_log` — every sales import (who/when/rows/errors). Alert on `chunk_errors > 0`.
- Add the same pattern for other critical writes (worker/PIN changes) as an audit trail.
- The gateway logs are your write-path truth — `POST | 401` spikes = expired tokens,
  `500` = a data/RPC problem. (This is exactly how the "32 chunks failed" incident
  was diagnosed.)

**Golden signals to dashboard:** import success rate, gateway 4xx/5xx rate,
Postgres connection saturation, KDS poll latency, offline-scan queue depth.

---

## 7. Reliability & downtime reduction

- **Put Supabase on a paid plan** (removes the 7-day pause) and **enable PITR**.
  Document RPO (≤ 24h with daily backups, minutes with PITR) and RTO.
- **Keep the GAS fallback** as the degraded-mode path if Supabase is unreachable,
  but track divergence (a nightly reconciliation job comparing counts).
- **Idempotent writes are already in place** (scan `cid`, `import_sales_rows`
  upsert) → retries and replays never corrupt data. Extend the pattern to any new
  write path.
- **Atomic, reversible deploys:** Edge Function deploys are all-or-nothing and
  keep prior versions (roll back by re-pinning). Frontend rollback = redeploy the
  previous commit. DB = restore from PITR/snapshot.
- **Staged rollout:** staging → smoke → prod; auto-abort promotion if smoke fails.
- **Service worker** already gives offline read + queued scans; keep reads
  network-first with a short cache TTL so a Supabase blip degrades, not breaks.
- **Guardrails already added:** the import now checks the PIN token *before*
  firing writes and prompts re-auth instead of failing silently.

---

## 8. Scaling

- **Frontend:** static on a CDN scales effectively without limit. Add Cloudflare
  for a custom domain, WAF, and cache control.
- **Reads:** PostgREST is stateless; use the **Supavisor pooler** for connection
  fan-out. Indexes already exist; `getSalesAnalysis` already paginates.
- **Writes:** Edge Functions auto-scale (Deno isolates); the gateway is stateless.
- **Biggest scaling lever:** replace the **60-second full-`scans` poll from every
  client** with **Supabase Realtime** (`postgres_changes` on `scans`). Today load
  is O(clients × table size) every minute; Realtime makes it push-based and flat.
- **Retire GAS:** its 6-minute execution limit and per-day quotas are the real
  ceiling. Finishing the migration (menus/recipes/scans) removes it and unifies
  the system of record (also fixes the read/write split-brain class of bug).
- **Multi-tenant future:** add a `restaurant_id` FK + RLS on Supabase (native);
  impossible on the single-spreadsheet GAS backend.

---

## 9. Secrets management

| Secret | Where it lives | Exposure | Action |
|---|---|---|---|
| Supabase **service-role** | auto-injected into Edge Fn env | server-only ✓ | never expose; used as the token-signing secret too |
| Supabase **anon** | in page source | public by design ✓ | fine for reads; rotate only if RLS ever misconfigured |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` | GAS Script Properties | server-only ✓ | document + rotate quarterly; move to Edge Fn when GAS is retired |
| Stripe keys | placeholders in `dashboard.html` | — | put real keys server-side only (Edge Fn/GAS), never in the page |
| `SUPABASE_ACCESS_TOKEN` (CI) | GitHub Actions secret | CI-only | scope to project; rotate on staff change |

---

## 10. Production readiness checklist

**Must-do before calling it "production"**
- [ ] Supabase on a **paid plan**; **PITR enabled**; test a restore.
- [ ] `supabase db pull` → commit `supabase/migrations/*` + `config.toml` (schema in git).
- [ ] Protect `main`: required `validate` check + review; no direct pushes.
- [ ] Custom domain + HTTPS (Cloudflare in front of Pages) for the frontend.
- [ ] Uptime monitor on frontend + gateway `health` + anon read, with alerting.
- [ ] Frontend error tracking (Sentry) wired with release = SHA.
- [ ] SW cache version stamped from SHA in CI (stop manual bumps).
- [ ] Apply the outstanding GAS patches (`GAS-SECURITY-PATCH.md`,
      `SCAN-IDEMPOTENCY-PATCH.md`, `SALES-IMPORT-DRIVE-PATCH.md`) and re-deploy GAS.
- [ ] Drop the temp `sales_history_backup_predup` table once totals are confirmed.
- [ ] Documented backup/restore + rollback runbook (frontend, edge fn, DB).
- [ ] Rotate/relocate any real third-party keys off the client.

**Should-do (hardening / scale)**
- [ ] Staging environment (Supabase branch + Pages preview) + smoke gate.
- [ ] Realtime for KDS instead of the 60s poll.
- [ ] Gate sensitive **reads** (recipes/costs/sales) behind the gateway too.
- [ ] 6-digit PINs or login lockout (brute-force hardening on gateway login).
- [ ] Per-role write authorization in the gateway.
- [ ] Nightly GAS↔Supabase reconciliation while both backends are live.
- [ ] Finish retiring GAS; unify the system of record.

**Nice-to-have**
- [ ] Load/spike test the gateway + Realtime at expected peak client count.
- [ ] Cost alerts (Supabase compute/egress).
- [ ] Synthetic "import a known CSV" canary that verifies the read-back nightly.
