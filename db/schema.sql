-- ═══════════════════════════════════════════════════════════════════════════
-- Kitchen MEP — database schema (Supabase / Postgres).  Run this ONCE on a fresh
-- Supabase project to stand up a new kitchen. See ../SETUP.md for the full flow.
--
-- Security model (important):
--   • The anon (public) key is READ-ONLY: RLS + column grants let anon SELECT the
--     operational tables, but NOT workers (PINs) and NOT any write.
--   • All writes go through the `admin-gateway` Edge Function using the service-role
--     key, gated by a PIN. Deploy that function separately (see SETUP.md).
--
-- This file covers the CORE app (tables, RLS, grants, core functions). The optional
-- analytics/AI layer (ask_run_sql + the menu_expansion / menu_engineering / rm_sales
-- views) is large and best snapshotted from the reference project with
--   supabase db dump --schema public
-- — see SETUP.md § "Analytics & AI layer (optional)".
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists "uuid-ossp";
create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

-- ── Core tables ─────────────────────────────────────────────────────────────
create table if not exists public.products (
  code text primary key,
  name text not null,
  qr text, kategorie text, notizen text, drive_photo text,
  mep_max numeric default 0, gn_size text, gn_weight numeric default 0,
  tagesziel numeric default 0, shelf_life int default 0, priority int default 99,
  allergene text, wa numeric default 0, active boolean default true,
  created_at timestamptz default now(), updated_at timestamptz default now()
);

create table if not exists public.inventory (
  code text primary key,
  name text not null,
  kategorie text, unit text default 'kg',
  quantity numeric default 0, weight_unit numeric default 1,
  minimum numeric default 0, maximum numeric default 0, kosten_unit numeric default 0,
  lieferant text, last_order date, notizen text,
  allergen text, image text,
  -- Nutrition per 100g (optional; feeds the per-menu nutrition roll-up)
  kcal numeric, protein numeric, fat numeric, carbs numeric,
  updated_at timestamptz default now()
);

create table if not exists public.recipes (
  id uuid primary key default gen_random_uuid(),
  mep_code text not null references public.products(code),
  rm_code  text not null references public.inventory(code),
  menge numeric not null, einheit text default 'kg', garverlust numeric default 0,
  created_at timestamptz default now()
);

create table if not exists public.menus (
  id uuid primary key default gen_random_uuid(),
  menu_code text not null, name text not null,
  category text, art text, saison text,
  gewicht numeric, garverlust numeric default 0, wa numeric default 0, vk numeric default 0,
  zutaten jsonb default '[]'::jsonb, zubereitung text, image_url text,
  last_update timestamptz default now(), created_at timestamptz default now()
);

create table if not exists public.grundrezepturen (
  id uuid primary key default gen_random_uuid(),
  gr_code text not null, name text not null, art text default 'Grundrezeptur',
  rohgewicht numeric default 0, garverlust numeric default 0, wa numeric default 0,
  zutaten jsonb default '[]'::jsonb, zubereitung text,
  created_at timestamptz default now(), updated_at timestamptz default now()
);

create table if not exists public.workers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  rolle text not null check (rolle = any (array['Teamleader','Küchenchef','Manager','Admin','Teamleader Sushi','Sushikoch','Wokkoch','Küchehilfe'])),
  aktiv boolean default true, pin text,
  created_at timestamptz default now()
);

create table if not exists public.scans (
  id uuid primary key default gen_random_uuid(),
  product_code text references public.products(code),
  worker text not null,
  action text not null check (action = any (array['produce','done','waste','used'])),
  scanned_at timestamptz not null default now()
);
create index if not exists scans_scanned_at_idx on public.scans(scanned_at);

create table if not exists public.scans_archive (
  id uuid primary key default gen_random_uuid(),
  product_code text, worker text not null,
  action text not null check (action = any (array['produce','done','waste','used'])),
  scanned_at timestamptz not null default now()
);

create table if not exists public.archive_logs (
  id uuid primary key default gen_random_uuid(),
  archived_at timestamptz default now(), rows_archived int not null, rows_kept int not null
);

create table if not exists public.deductions (
  id uuid primary key default gen_random_uuid(),
  deducted_at timestamptz not null default now(),
  worker text, mep_code text references public.products(code), rm_code text, rm_name text,
  deducted numeric, unit text, qty_before numeric, qty_after numeric
);
create index if not exists deductions_deducted_at_idx on public.deductions(deducted_at);

create table if not exists public.mep_stock (
  id uuid primary key default gen_random_uuid(),
  product_code text not null references public.products(code),
  batch_date date not null, produced numeric default 0, used numeric default 0, wasted numeric default 0,
  created_at timestamptz default now(), updated_at timestamptz default now()
);

create table if not exists public.sales_history (
  id uuid primary key default gen_random_uuid(),
  sale_date date not null, product_name text not null, product_code text, kategorie text,
  qty numeric default 0, unit text, price numeric default 0, wa numeric default 0, garverlust numeric default 0,
  created_at timestamptz default now()
);
create index if not exists sales_history_date_name_idx on public.sales_history(sale_date, product_name);

create table if not exists public.haccp_zones (
  id text primary key, name text not null,
  type text default 'Fridge' check (type = any (array['Fridge','Freezer'])),
  min_temp numeric default 0, max_temp numeric default 5, active boolean default true,
  created_at timestamptz default now()
);

create table if not exists public.haccp_tasks (
  id text primary key, task text not null,
  frequency text default 'Daily' check (frequency = any (array['Daily','Weekly','Monthly'])),
  active boolean default true, sort_order int default 99, created_at timestamptz default now()
);

create table if not exists public.haccp_checks (
  id uuid primary key default gen_random_uuid(),
  check_date date not null, task_id text not null references public.haccp_tasks(id), task text,
  done boolean default false, worker text, notes text, checked_at timestamptz
);

create table if not exists public.haccp_temp_logs (
  id uuid primary key default gen_random_uuid(),
  log_date date not null, log_time time not null, zone text not null, zone_type text,
  temp numeric not null, min_temp numeric, max_temp numeric,
  pass_fail text check (pass_fail = any (array['Pass','Fail'])), notes text, worker text,
  created_at timestamptz default now()
);

create table if not exists public.import_log (
  id uuid primary key default gen_random_uuid(),
  imported_at timestamptz default now(), source text, file_name text, worker text,
  date_from date, date_to date, rows_sent int, rows_inserted int, rows_replaced int, chunk_errors int
);

create table if not exists public.supplier_imports (
  id uuid primary key default gen_random_uuid(),
  menge numeric, liefereinheit text, artikel_nr text, lieferant text,
  artikelbezeichnung text, artikelpreis numeric, imported_at timestamptz default now()
);

create table if not exists public.menu_sales_map (
  product_name text primary key, menu_code text, menu_name text,
  sim numeric, roll_factor numeric default 1, status text default 'auto'
);

-- ── Core functions ──────────────────────────────────────────────────────────
create or replace function public._norm_name(t text) returns text language sql immutable as $$
  select btrim(regexp_replace(
    regexp_replace(lower(coalesce(t,'')),
      'nooch & negishi.*$|q[1-4]\s*20[0-9]{2}.*$|\y[0-9]+\s*stk\y|\(vegan\)|\(vegetarisch\)', ' ', 'g'),
    '\s+', ' ', 'g'));
$$;

create or replace function public._to_num(t text) returns numeric language sql immutable as $$
  select nullif(substring(replace(coalesce(t,''), ',', '.') from '[-+]?[0-9]*\.?[0-9]+'), '')::numeric;
$$;

-- PIN check used by the admin-gateway login (SECURITY DEFINER so anon never touches the workers table).
create or replace function public.verify_pin(p_pin text)
  returns table(name text, rolle text) language sql stable security definer set search_path to 'public' as $$
  select w.name, w.rolle from public.workers w
  where w.pin = p_pin and w.aktiv = true and w.pin is not null and w.pin <> '' limit 1;
$$;

-- Sales CSV import: UPSERT by (sale_date, product_name) so re-imports replace, not duplicate.
create or replace function public.import_sales_rows(rows jsonb)
  returns table(inserted int, replaced int) language plpgsql security definer set search_path to 'public' as $$
declare n_del int; n_ins int;
begin
  drop table if exists _sales_imp;
  create temp table _sales_imp on commit drop as
    select sale_date, product_name, max(kategorie) kategorie, sum(qty) qty, sum(price) price,
           sum(wa) wa, sum(garverlust) garverlust
    from (
      select (r->>'d')::date sale_date, btrim(r->>'p') product_name,
             nullif(btrim(r->>'k'),'') kategorie,
             coalesce((r->>'m')::numeric,0) qty, coalesce((r->>'u')::numeric,0) price,
             coalesce((r->>'wa')::numeric,0) wa, coalesce((r->>'g')::numeric,0) garverlust
      from jsonb_array_elements(rows) r
      where (r->>'d') ~ '^\d{4}-\d{2}-\d{2}' and coalesce(btrim(r->>'p'),'') <> '' and coalesce((r->>'m')::numeric,0) > 0
    ) x group by sale_date, product_name;
  delete from sales_history s using _sales_imp i where s.sale_date=i.sale_date and s.product_name=i.product_name;
  get diagnostics n_del = row_count;
  insert into sales_history (sale_date, product_name, kategorie, qty, price, wa, garverlust)
    select sale_date, product_name, kategorie, qty, price, wa, garverlust from _sales_imp;
  get diagnostics n_ins = row_count;
  return query select n_ins, n_del;
end;
$$;

-- ── RLS: enable everywhere, anon may READ operational tables (not workers) ────
do $$
declare t text;
begin
  foreach t in array array[
    'products','inventory','recipes','menus','grundrezepturen','workers','scans','scans_archive',
    'archive_logs','deductions','mep_stock','sales_history','haccp_zones','haccp_tasks','haccp_checks',
    'haccp_temp_logs','import_log','supplier_imports','menu_sales_map'
  ] loop
    execute format('alter table public.%I enable row level security;', t);
  end loop;

  -- anon read policy on every table EXCEPT workers (PINs must never be anon-readable)
  foreach t in array array[
    'products','inventory','recipes','menus','grundrezepturen','scans','scans_archive',
    'archive_logs','deductions','mep_stock','sales_history','haccp_zones','haccp_tasks','haccp_checks',
    'haccp_temp_logs','import_log','supplier_imports','menu_sales_map'
  ] loop
    execute format('drop policy if exists "anon read" on public.%I;', t);
    execute format('create policy "anon read" on public.%I for select to anon using (true);', t);
  end loop;
end $$;

-- Column grants: give anon SELECT on the readable tables, and explicitly REVOKE the
-- workers table (so PINs are never exposed — the gateway reads workers via service role).
do $$
declare t text;
begin
  foreach t in array array[
    'products','inventory','recipes','menus','grundrezepturen','scans','scans_archive',
    'archive_logs','deductions','mep_stock','sales_history','haccp_zones','haccp_tasks','haccp_checks',
    'haccp_temp_logs','import_log','supplier_imports','menu_sales_map'
  ] loop
    execute format('grant select on public.%I to anon;', t);
  end loop;
  revoke all on public.workers from anon;   -- ★ PINs stay gateway-only
end $$;
