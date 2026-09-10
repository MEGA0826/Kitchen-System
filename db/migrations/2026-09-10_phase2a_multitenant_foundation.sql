-- ═══════════════════════════════════════════════════════════════════════════
-- Kitchen MEP — Stage 2, Phase 2a: multi-tenant FOUNDATION (non-breaking)
--
-- Goal: lay the whole multi-tenant groundwork WITHOUT changing how the running
-- single-tenant app behaves. After this migration the app still works exactly as
-- before — every existing row simply belongs to tenant #1 ("212 Nooch Richti").
--
-- What it does:
--   1. tenants + tenant_members tables (the account model for 2b auth).
--   2. a NULLABLE tenant_id on every operational table (nullable = non-breaking:
--      existing reads/writes are unaffected; the client ignores the new column).
--   3. creates the current kitchen as tenant #1 and backfills every row to it.
--   4. current_tenant_id() helper + tenant indexes, ready for 2b RLS.
--
-- SAFE TO RE-RUN: every statement is idempotent (IF NOT EXISTS / ON CONFLICT /
-- WHERE tenant_id IS NULL / CREATE OR REPLACE). Run it in the Supabase SQL editor.
--
-- NOT done here (that's 2b/2c): tenant-scoped RLS on the data tables, the gateway
-- stamping tenant_id on writes, per-tenant read tokens, PK reworks to (tenant_id,code),
-- and signup. Those flip the app to true multi-tenant in a coordinated release.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Account model ─────────────────────────────────────────────────────────
create table if not exists public.tenants (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  slug       text unique,
  plan       text default 'pilot',
  settings   jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create table if not exists public.tenant_members (
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  user_id    uuid not null,                 -- Supabase auth.users id (wired in 2b)
  role       text default 'owner',
  created_at timestamptz default now(),
  primary key (tenant_id, user_id)
);

-- ── 2. Add a NULLABLE tenant_id to every operational table ───────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'products','inventory','recipes','menus','grundrezepturen','workers','scans',
    'scans_archive','archive_logs','deductions','mep_stock','sales_history',
    'haccp_zones','haccp_tasks','haccp_checks','haccp_temp_logs','import_log',
    'supplier_imports','menu_sales_map'
  ] loop
    execute format('alter table public.%I add column if not exists tenant_id uuid references public.tenants(id);', t);
    execute format('create index if not exists %I on public.%I (tenant_id);', t||'_tenant_idx', t);
  end loop;
end $$;

-- ── 3. Tenant #1 = the existing kitchen, and backfill every row to it ────────
insert into public.tenants (name, slug, plan)
values ('212 Nooch Richti', '212-nooch-richti', 'founder')
on conflict (slug) do nothing;

do $$
declare tid uuid; t text;
begin
  select id into tid from public.tenants where slug = '212-nooch-richti';
  foreach t in array array[
    'products','inventory','recipes','menus','grundrezepturen','workers','scans',
    'scans_archive','archive_logs','deductions','mep_stock','sales_history',
    'haccp_zones','haccp_tasks','haccp_checks','haccp_temp_logs','import_log',
    'supplier_imports','menu_sales_map'
  ] loop
    execute format('update public.%I set tenant_id = %L where tenant_id is null;', t, tid);
  end loop;
end $$;

-- ── 4. Helper + RLS on the account tables (used by 2b; inert until auth exists)─
-- SECURITY DEFINER so a future authenticated user resolves their tenant without
-- needing direct read access to tenant_members (and to avoid recursive policies).
create or replace function public.current_tenant_id()
  returns uuid language sql stable security definer set search_path to 'public' as $$
  select tenant_id from public.tenant_members where user_id = auth.uid() limit 1;
$$;

alter table public.tenants        enable row level security;
alter table public.tenant_members enable row level security;

-- A member may read their own tenant + membership. Non-recursive: tenant_members'
-- own policy checks only user_id, so the subquery below does not loop back.
drop policy if exists tenants_member_read on public.tenants;
create policy tenants_member_read on public.tenants for select to authenticated
  using (id in (select tm.tenant_id from public.tenant_members tm where tm.user_id = auth.uid()));

drop policy if exists tm_self_read on public.tenant_members;
create policy tm_self_read on public.tenant_members for select to authenticated
  using (user_id = auth.uid());

-- account tables are NOT anon-readable (no grant to anon) — the current app never touches them.

-- ── 5. Verify (run these after; expect one tenant + 0 orphaned rows) ─────────
-- select id, name, slug, plan from public.tenants;
-- select t as table_name, cnt as rows_without_tenant from (
--   select 'products' t, count(*) cnt from public.products where tenant_id is null
--   union all select 'inventory', count(*) from public.inventory where tenant_id is null
--   union all select 'menus', count(*) from public.menus where tenant_id is null
--   union all select 'grundrezepturen', count(*) from public.grundrezepturen where tenant_id is null
--   union all select 'sales_history', count(*) from public.sales_history where tenant_id is null
-- ) q where cnt > 0;   -- returns no rows when the backfill is complete
