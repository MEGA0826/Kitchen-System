-- ═══════════════════════════════════════════════════════════════════════════
-- Kitchen MEP — billing model (applied 2026-09-16, additive / non-breaking)
-- Runs AFTER 2026-09-10_phase2a_multitenant_foundation.sql (needs public.tenants).
-- Adds per-tenant Stripe billing state, a webhook audit table, and an entitlement
-- helper. The running kitchen (tenant #1) is set active with no trial clock.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.tenants add column if not exists stripe_customer_id     text;
alter table public.tenants add column if not exists stripe_subscription_id text;
alter table public.tenants add column if not exists price_id               text;
alter table public.tenants add column if not exists billing_status         text default 'trialing'; -- trialing|active|past_due|canceled|incomplete
alter table public.tenants add column if not exists trial_ends_at          timestamptz default (now() + interval '14 days');
alter table public.tenants add column if not exists current_period_end     timestamptz;
create unique index if not exists tenants_stripe_customer_idx
  on public.tenants (stripe_customer_id) where stripe_customer_id is not null;

update public.tenants set billing_status='active', trial_ends_at=null
  where slug='212-nooch-richti';

create table if not exists public.billing_events (
  id              uuid primary key default gen_random_uuid(),
  stripe_event_id text unique,
  tenant_id       uuid references public.tenants(id),
  type            text,
  payload         jsonb,
  created_at      timestamptz default now()
);

-- Entitlement: what access does a tenant have right now?
-- is_pro   → plan is a Pro-level plan (pro/founder/multisite)
-- is_active→ paid/trialing, or still inside the free trial window
create or replace function public.tenant_access(p_tenant uuid)
  returns table(plan text, status text, is_pro boolean, is_active boolean, trial_days_left int)
  language sql stable security definer set search_path to 'public' as $$
  select
    t.plan,
    t.billing_status,
    (t.plan in ('pro','founder','multisite')) as is_pro,
    (t.billing_status in ('active','trialing')
       or (t.trial_ends_at is not null and t.trial_ends_at > now())) as is_active,
    greatest(0, ceil(extract(epoch from (coalesce(t.trial_ends_at, now()) - now()))/86400))::int as trial_days_left
  from public.tenants t where t.id = p_tenant;
$$;
grant execute on function public.tenant_access(uuid) to authenticated;
