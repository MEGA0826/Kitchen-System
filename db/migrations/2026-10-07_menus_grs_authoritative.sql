-- ─────────────────────────────────────────────────────────────────────────────
-- 2026-10-07 — Supabase becomes the source of truth for MENUS and GRUNDREZEPTUREN
--
-- STAGE 1 of 2 — additive. Safe to apply while the app still reads Google Sheets:
-- nothing here changes what the running app sees.
--   Stage 2 (data cut-over) is scripts/cutover_copy_menus_grs.sql + the frontend flip.
--
-- What this does
--   0. snapshots what Supabase holds today (the Sheet was the live store until now)
--   1. adds the columns the Sheet had and Supabase never got (deko, logo_url, active)
--   2. stamps tenant_id on new rows by default (the old weekly job did this by hand)
--   3. replaces the Sheet's version history with a DB-level undo trail
--   4. gives the analytics views a refresh that does NOT truncate anything
--   5. neutralises resync_recipe_analytics(): it used to TRUNCATE menus and
--      grundrezepturen every Monday 03:00 and reload them from the Sheet, which would
--      wipe every edit made in the app once Supabase is authoritative
--
-- Idempotent: every statement is IF NOT EXISTS / OR REPLACE / guarded.
-- ─────────────────────────────────────────────────────────────────────────────

-- 0. safety copies ───────────────────────────────────────────────────────────
create table if not exists public._bak_menus_20261007 as table public.menus;
create table if not exists public._bak_grs_20261007   as table public.grundrezepturen;
alter table public._bak_menus_20261007 enable row level security;   -- no policy: not readable with the anon key
alter table public._bak_grs_20261007   enable row level security;

-- 1. columns ─────────────────────────────────────────────────────────────────
alter table public.menus
  add column if not exists deko      text,
  add column if not exists logo_url  text,
  add column if not exists active    boolean not null default true,   -- false = not on sale; empty/true = on sale
  add column if not exists edited_by text;
alter table public.grundrezepturen
  add column if not exists edited_by text;

-- 2. tenant default ──────────────────────────────────────────────────────────
-- Single-tenant for now. The multi-tenant gateway (index.2b.ts) stamps tenant_id from the
-- caller's token and overrides this. plpgsql so a kitchen without a tenants table still works.
create or replace function public.default_tenant_id() returns uuid
language plpgsql stable security definer set search_path = public as $$
declare t uuid;
begin
  begin
    execute 'select id from public.tenants order by slug limit 1' into t;
  exception when undefined_table then
    t := null;
  end;
  return t;
end $$;

alter table public.menus           alter column tenant_id set default public.default_tenant_id();
alter table public.grundrezepturen alter column tenant_id set default public.default_tenant_id();

-- 3. undo trail ──────────────────────────────────────────────────────────────
-- Google Sheets kept version history; Postgres does not. Every UPDATE and DELETE of a menu
-- or GR now stores the row as it was, whichever path made the change (gateway, SQL editor).
-- Restore with:  select old_row from recipe_history where kind='menu' and code='SS-016' order by id desc;
create table if not exists public.recipe_history (
  id         bigserial primary key,
  kind       text        not null check (kind in ('menu', 'gr')),
  row_id     uuid        not null,
  code       text,
  op         text        not null,
  old_row    jsonb       not null,
  changed_at timestamptz not null default now()
);
create index if not exists recipe_history_row_idx  on public.recipe_history (kind, row_id, changed_at desc);
create index if not exists recipe_history_code_idx on public.recipe_history (kind, code);
alter table public.recipe_history enable row level security;        -- service role / SQL editor only

create or replace function public.log_recipe_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and to_jsonb(old) = to_jsonb(new) then
    return new;                                                      -- a no-op save leaves no trace
  end if;
  insert into public.recipe_history (kind, row_id, code, op, old_row)
  values (tg_argv[0], old.id,
          coalesce(to_jsonb(old) ->> 'menu_code', to_jsonb(old) ->> 'gr_code'),
          tg_op, to_jsonb(old));
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

drop trigger if exists menus_history on public.menus;
create trigger menus_history after update or delete on public.menus
  for each row execute function public.log_recipe_change('menu');
drop trigger if exists grs_history on public.grundrezepturen;
create trigger grs_history after update or delete on public.grundrezepturen
  for each row execute function public.log_recipe_change('gr');

-- 4. analytics refresh (no data is copied or truncated) ──────────────────────
create or replace function public.refresh_recipe_analytics() returns text
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if to_regclass('public.menu_expansion_mat') is not null then
    execute 'refresh materialized view public.menu_expansion_mat';
  end if;
  if to_regclass('public.rm_usage_per_menu') is not null then
    execute 'refresh materialized view public.rm_usage_per_menu';
  end if;
  return 'refreshed ' || now();
end $$;

-- 5. defuse the weekly truncate-and-reload ───────────────────────────────────
-- Same name, so anything still calling it keeps working — it just can't destroy data any more.
create or replace function public.resync_recipe_analytics() returns text
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
begin
  -- Menus and Grundrezepturen are written in Supabase now (admin-gateway). This function
  -- used to TRUNCATE both tables and reload them from the Google Sheet. It only refreshes
  -- the analytics views.
  return public.refresh_recipe_analytics();
end $$;

-- The Monday job pointed at the function above; replace it with a frequent, harmless refresh.
do $$
begin
  perform cron.unschedule(jobid) from cron.job where command ilike '%resync_recipe_analytics%';
  perform cron.schedule('refresh-recipe-analytics', '*/15 * * * *', 'select public.refresh_recipe_analytics();');
exception when others then
  raise notice 'pg_cron unavailable or scheduling failed (%): refresh public.refresh_recipe_analytics() yourself', sqlerrm;
end $$;
