// Kitchen MEP — admin-gateway: menu + Grundrezeptur row builders.
//
// Pure functions: no Deno APIs, no network. They run unchanged under node, which is how
// they are tested against the real data before the gateway (which guards EVERY write in
// the app) is redeployed.
//
// The frontend was built for Google Apps Script, so params arrive as URL-style strings:
// zutaten is a JSON *string*, numbers are strings, "" means empty. These builders turn
// that into typed rows, and they REJECT malformed input instead of storing it — a bad
// zutaten blob silently zeroes every cost and allergen downstream.
//
// UPDATE semantics: only columns present in the request are written. Google Apps Script
// rewrote the whole row, so a caller that left a field out blanked it (the menu editor
// never sent `deko` and wiped it on every save). A caller that WANTS a field cleared
// sends it empty.

export type Params = Record<string, any>;

/** The caller got something wrong: the gateway answers 400 with this message. */
export class Bad extends Error {}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function uuidOrNull(v: unknown): string | null {
  const s = v == null ? "" : String(v).trim();
  return UUID_RE.test(s) ? s.toLowerCase() : null;
}

function has(p: Params, k: string): boolean {
  return Object.prototype.hasOwnProperty.call(p, k) && p[k] !== undefined;
}

export function txt(v: unknown): string | null {
  const s = v == null ? "" : String(v).trim();
  return s === "" ? null : s;
}

export function numOrNull(v: unknown): number | null {
  if (v === "" || v === null || v === undefined) return null;
  const n = parseFloat(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** "false" / false / 0 / "nein" / "inaktiv" switch a menu off; anything else leaves it on. */
export function isFalse(v: unknown): boolean {
  if (v === false) return true;
  const s = String(v ?? "").trim().toLowerCase();
  return s === "false" || s === "0" || s === "no" || s === "nein" || s === "inaktiv";
}

/** zutaten arrives as a JSON string (or already an array). It must be a list of objects. */
export function parseZutaten(v: unknown): unknown[] {
  let a: unknown = v;
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return [];
    try { a = JSON.parse(s); } catch { throw new Bad("zutaten is not valid JSON"); }
  }
  if (a === null || a === undefined) return [];
  if (!Array.isArray(a)) throw new Bad("zutaten must be a list of ingredient rows");
  for (const r of a) {
    if (r === null || typeof r !== "object" || Array.isArray(r)) throw new Bad("every zutaten row must be an object");
  }
  if (JSON.stringify(a).length > 400_000) throw new Bad("zutaten is too large");
  return a;
}

export interface BuildOpts { insert: boolean; editor: string | null; now: string }

export function buildMenuRow(p: Params, o: BuildOpts): Params {
  const row: Params = {};

  if (has(p, "menuCode")) {
    const c = txt(p.menuCode);
    if (!c) throw new Bad("Menu code is required");
    row.menu_code = c;
  } else if (o.insert) throw new Bad("Menu code is required");

  if (has(p, "name")) {
    const n = txt(p.name);
    if (!n) throw new Bad("Menu name is required");
    row.name = n;
  } else if (o.insert) throw new Bad("Menu name is required");

  if (has(p, "category"))    row.category    = txt(p.category);
  if (has(p, "art"))         row.art         = txt(p.art);
  if (has(p, "saison"))      row.saison      = txt(p.saison);
  if (has(p, "gewicht"))     row.gewicht     = numOrNull(p.gewicht);
  if (has(p, "garverlust"))  row.garverlust  = numOrNull(p.garverlust) ?? 0;
  if (has(p, "wa"))          row.wa          = numOrNull(p.wa) ?? 0;
  if (has(p, "vk"))          row.vk          = numOrNull(p.vk) ?? 0;
  if (has(p, "deko"))        row.deko        = txt(p.deko);
  if (has(p, "zubereitung")) row.zubereitung = txt(p.zubereitung);
  if (has(p, "zutaten"))     row.zutaten     = parseZutaten(p.zutaten);
  if (has(p, "imageUrl"))    row.image_url   = txt(p.imageUrl);
  if (has(p, "logoUrl"))     row.logo_url    = txt(p.logoUrl);
  if (has(p, "active"))      row.active      = !isFalse(p.active);

  row.last_update = o.now;     // the server's clock, never the client's `lastUpdate`
  row.edited_by = o.editor;
  return row;
}

export function buildGrRow(p: Params, o: BuildOpts): Params {
  const row: Params = {};

  if (has(p, "grCode")) {
    const c = txt(p.grCode);
    if (!c) throw new Bad("GR code is required");
    row.gr_code = c;
  } else if (o.insert) throw new Bad("GR code is required");

  if (has(p, "name")) {
    const n = txt(p.name);
    if (!n) throw new Bad("GR name is required");
    row.name = n;
  } else if (o.insert) throw new Bad("GR name is required");

  if (has(p, "art"))         row.art         = txt(p.art) ?? "Grundrezeptur";
  if (has(p, "rohgewicht"))  row.rohgewicht  = numOrNull(p.rohgewicht) ?? 0;
  if (has(p, "garverlust"))  row.garverlust  = numOrNull(p.garverlust) ?? 0;
  if (has(p, "wa"))          row.wa          = numOrNull(p.wa) ?? 0;
  if (has(p, "zutaten"))     row.zutaten     = parseZutaten(p.zutaten);
  if (has(p, "zubereitung")) row.zubereitung = txt(p.zubereitung);
  // nettogewicht is derived (rohgewicht x (1 - garverlust/100)); the app computes it on read.

  row.updated_at = o.now;
  row.edited_by = o.editor;
  return row;
}

/** Turn a PostgREST failure into something a cook can act on. */
export function friendlyDbError(e: unknown, what: string, code: unknown): Error {
  const msg = String((e as Error)?.message ?? e);
  if (e instanceof Bad) return e;
  if (msg.includes("23505")) return new Bad(`${what} code "${txt(code) ?? ""}" already exists — use a different code`);
  return e instanceof Error ? e : new Error(msg);
}
