# Kitchen MEP — billing layer (Path B: self-serve SaaS)

This wires Stripe subscriptions to the multi-tenant model so each kitchen (tenant)
carries its own plan and access. It is **additive** — the running single-kitchen app
is unaffected until the Stage-2 signup flow (2b) is live.

## What's already built (in the DB + this repo)

- **Multi-tenant foundation** (`db/migrations/2026-09-10_phase2a_multitenant_foundation.sql`) —
  `tenants` + `tenant_members`, a nullable `tenant_id` on every operational table, and the
  existing kitchen backfilled as **tenant #1** (`212-nooch-richti`, plan `founder`). Non-breaking.
- **Billing model** (`db/migrations/2026-09-16_billing_model.sql`) — on `tenants`:
  `plan`, `billing_status`, `stripe_customer_id`, `stripe_subscription_id`, `price_id`,
  `trial_ends_at` (defaults to +14 days), `current_period_end`; a `billing_events` audit table;
  and `public.tenant_access(tenant)` → `{plan, status, is_pro, is_active, trial_days_left}`.
- **Edge functions** (`supabase/functions/`):
  - `stripe-webhook` — Stripe → updates the tenant's plan/status/period. Verifies the
    Stripe signature manually (no SDK); handlers are idempotent so retries are safe.
  - `stripe-checkout` — authenticates the caller's Supabase token → resolves their tenant →
    creates/reuses a Stripe customer → returns a Checkout URL.
  - *(stripe-portal — "manage subscription" — not yet added; optional, ~30 lines.)*

## Plans → Stripe prices

Create these as **recurring monthly** prices in Stripe (Products → add price). Suggested:

| Plan (in DB `plan`) | Stripe price env var    | Suggested price |
|---------------------|-------------------------|-----------------|
| `starter`           | `STRIPE_PRICE_STARTER`  | CHF 49 / mo     |
| `pro`               | `STRIPE_PRICE_PRO`      | CHF 89 / mo     |
| `multisite`         | `STRIPE_PRICE_MULTISITE`| CHF 69 / mo     |

## Setup — do this once (use Stripe **Test mode** first)

1. **Create a Stripe account** → **Test mode** on. Create the 3 products/prices above; copy each **price ID** (`price_…`).
2. **Set the Edge Function secrets** (Dashboard → Project → Edge Functions → Secrets, or `supabase secrets set`):
   ```
   STRIPE_SECRET_KEY=sk_test_…
   STRIPE_PRICE_STARTER=price_…
   STRIPE_PRICE_PRO=price_…
   STRIPE_PRICE_MULTISITE=price_…
   APP_URL=https://mega0826.github.io/Kitchen-System
   # STRIPE_WEBHOOK_SECRET set in step 4
   ```
3. **Deploy the functions** (they do their own auth → `--no-verify-jwt`):
   ```bash
   supabase functions deploy stripe-webhook  --no-verify-jwt
   supabase functions deploy stripe-checkout --no-verify-jwt
   ```
4. **Register the webhook** in Stripe → Developers → Webhooks → *Add endpoint*:
   - URL: `https://<project-ref>.supabase.co/functions/v1/stripe-webhook`
   - Events: `checkout.session.completed`, `customer.subscription.created`,
     `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`
   - Copy the endpoint's **Signing secret** (`whsec_…`) → set `STRIPE_WEBHOOK_SECRET`.
5. **Test** with a Stripe test card (`4242 4242 4242 4242`): call `stripe-checkout` with a
   test tenant+user (see below), pay, and confirm the tenant's `plan`/`billing_status` flip.
6. **Go live:** flip Stripe to Live mode, swap the secrets to `sk_live_…` / live price IDs /
   the live webhook `whsec_…`, redeploy.

## Gating features (entitlement)

Read a tenant's access from the DB:
```sql
select * from public.tenant_access('<tenant-uuid>');
-- → plan, status, is_pro, is_active, trial_days_left
```
Use `is_pro` to gate Menu Engineering + AI "Ask" + sales import; `is_active` for the whole app
(false once the trial ends with no paid plan). The client reads this once the Stage-2 read path
exposes the tenant context.

## ⚠️ The one remaining prerequisite: Stage-2 signup (2b)

Checkout bills **an authenticated tenant**. That needs Supabase Auth users + `tenant_members`
rows — i.e. the self-serve **signup** flow (`admin-gateway/index.2b.ts` is drafted; `2c` RLS not
yet written). Until it ships you can still **test billing** by creating one auth user and linking it:
```sql
-- after creating a user in Auth (Dashboard → Authentication → Add user):
insert into public.tenant_members (tenant_id, user_id, role)
values ((select id from public.tenants where slug='212-nooch-richti'), '<auth-user-uuid>', 'owner');
```
Then call `stripe-checkout` with that user's access token.

**Sequence to go live self-serve:** deploy 2b (auth + signup + gateway tenant-scoping) → wire
`stripe-checkout`/paywall into the app → open the public "Start free" page.
