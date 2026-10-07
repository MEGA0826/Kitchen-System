-- ─────────────────────────────────────────────────────────────────────────────
-- ONE-SHOT: copy Menus + Grundrezepturen from the Google Sheet into Supabase.
--
-- Run it at cut-over time, then DROP it (last statement below). Once Supabase is the
-- source of truth this function is DANGEROUS: it TRUNCATEs both tables, so running it
-- again would replace every edit made in the app with the frozen Sheet.
--
-- It is safe to run repeatedly BEFORE the app is switched over (the app still reads the
-- Sheet, so nothing in Supabase has been edited yet). Ids are deterministic, so a re-run
-- reproduces identical rows.
--
-- One transaction: if the Sheet answers with an error page, a row is malformed, or a code
-- is duplicated, everything rolls back and the tables are exactly as they were.
--
-- Differences from the old weekly resync_recipe_analytics(), which this replaces:
--   * keeps the Sheet's row ids (it generated new random ones) — a stale tablet that still
--     holds a Sheet id therefore finds its row. The 8 legacy "M-<millis>" menu ids are not
--     uuids; they get md5('menu:'||id)::uuid, stable across re-runs.
--   * copies deko, logoUrl, lastUpdate and active (it dropped all four)
--   * adds the unique indexes that make a duplicate code impossible
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public._cutover_copy_from_sheet() returns text
language plpgsql security definer set search_path to 'public', 'extensions', 'pg_temp' as $$
declare
  base    text := 'https://script.google.com/macros/s/AKfycbz1aiIySe0-JwsLE4Vq8GyVwxS_7aRxyX48fvAWxP1cBeeOKFUK0w0mf7WCoe-9T8IHtQ/exec';
  uuid_re constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  gr_json jsonb;
  mn_json jsonb;
  resp    http_response;
  gr_n    int;
  mn_n    int;
  i       int;
begin
  perform set_config('statement_timeout', '280000', true);
  perform http_set_curlopt('CURLOPT_TIMEOUT', '150');

  -- Apps Script sometimes answers 200 with an HTML error page; retry rather than abort.
  for i in 1..4 loop
    begin
      resp := http_get(base || '?action=getGRs');
      if resp.status = 200 and left(trim(resp.content), 1) = '{' then
        gr_json := (resp.content::jsonb) -> 'grs';
        exit when gr_json is not null;
      end if;
    exception when others then null;
    end;
    perform pg_sleep(2);
  end loop;
  if gr_json is null or jsonb_array_length(gr_json) < 50 then
    raise exception 'cut-over aborted: getGRs returned % rows', coalesce(jsonb_array_length(gr_json), 0);
  end if;

  for i in 1..4 loop
    begin
      resp := http_get(base || '?action=getMenus');
      if resp.status = 200 and left(trim(resp.content), 1) = '{' then
        mn_json := (resp.content::jsonb) -> 'menus';
        exit when mn_json is not null;
      end if;
    exception when others then null;
    end;
    perform pg_sleep(2);
  end loop;
  if mn_json is null or jsonb_array_length(mn_json) < 50 then
    raise exception 'cut-over aborted: getMenus returned % rows', coalesce(jsonb_array_length(mn_json), 0);
  end if;

  -- ── Grundrezepturen ──────────────────────────────────────────────────────
  truncate public.grundrezepturen;
  insert into public.grundrezepturen (id, gr_code, name, art, rohgewicht, garverlust, wa, zutaten, zubereitung, updated_at)
  select case when x.id ~* uuid_re then x.id::uuid else md5('gr:' || x.id)::uuid end,
         trim(x."grCode"),
         x.name,
         coalesce(nullif(x.art, ''), 'Grundrezeptur'),
         coalesce(public._to_num(x.rohgewicht), 0),
         coalesce(public._to_num(x.garverlust), 0),
         coalesce(public._to_num(x.wa), 0),
         coalesce(nullif(x.zutaten, '')::jsonb, '[]'::jsonb),
         nullif(x.zubereitung, ''),
         coalesce(nullif(x."lastUpdate", '')::timestamptz, now())
  from jsonb_to_recordset(gr_json)
    as x(id text, "grCode" text, name text, art text, rohgewicht text, garverlust text, wa text,
         zutaten text, zubereitung text, "lastUpdate" text);
  get diagnostics gr_n = row_count;

  -- ── Menus ────────────────────────────────────────────────────────────────
  truncate public.menus;
  insert into public.menus (id, menu_code, name, category, art, saison, gewicht, garverlust, wa, vk,
                            deko, zubereitung, zutaten, image_url, logo_url, last_update, active)
  select case when x.id ~* uuid_re then x.id::uuid else md5('menu:' || x.id)::uuid end,
         trim(x."menuCode"),
         x.name,
         nullif(x.category, ''), nullif(x.art, ''), nullif(x.saison, ''),
         public._to_num(x.gewicht),
         coalesce(public._to_num(x.garverlust), 0),
         coalesce(public._to_num(x.wa), 0),
         coalesce(public._to_num(x.vk), 0),
         nullif(x.deko, ''), nullif(x.zubereitung, ''),
         coalesce(nullif(x.zutaten, '')::jsonb, '[]'::jsonb),
         nullif(x."imageUrl", ''), nullif(x."logoUrl", ''),
         coalesce(nullif(x."lastUpdate", '')::timestamptz, now()),
         -- an EMPTY cell means "on sale"; only an explicit no switches a menu off
         not (lower(coalesce(x.active, '')) in ('false', '0', 'no', 'nein', 'inaktiv'))
  from jsonb_to_recordset(mn_json)
    as x(id text, "menuCode" text, name text, category text, art text, saison text, gewicht text,
         garverlust text, wa text, vk text, deko text, zubereitung text, zutaten text,
         "imageUrl" text, "logoUrl" text, "lastUpdate" text, active text);
  get diagnostics mn_n = row_count;

  -- A duplicate code makes THIS statement fail, which rolls the whole copy back.
  create unique index if not exists menus_menu_code_uq on public.menus (lower(menu_code));
  create unique index if not exists grundrezepturen_gr_code_uq on public.grundrezepturen (lower(gr_code));

  perform public.refresh_recipe_analytics();

  return format('copied %s GRs and %s menus from the Sheet @ %s', gr_n, mn_n, now());
end;
$$;

-- run it:   select public._cutover_copy_from_sheet();
-- THEN, once the app has been switched and verified, remove it for good:
--   drop function public._cutover_copy_from_sheet();
