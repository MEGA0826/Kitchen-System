// Kitchen MEP — admin-gateway Edge Function · STAGE 2 / PHASE 2b DRAFT
// ─────────────────────────────────────────────────────────────────────────────
// This is the multi-tenant version of admin-gateway. DO NOT deploy it until:
//   (1) the Phase 2a migration is applied (tenant_id on every table, tenants +
//       tenant_members, current_tenant_id()), AND
//   (2) a function secret SUPABASE_JWT_SECRET is set to the project's JWT secret
//       (Dashboard → Project Settings → API → JWT Secret). This is what lets the
//       gateway mint a Supabase-valid read token that PostgREST + RLS accept.
// When you flip 2b/2c: rename this file to index.ts and deploy (verify_jwt=false).
//
// What changed vs. the 1-tenant gateway (search "2b:"):
//   • login is TENANT-AWARE and now returns TWO tokens:
//       - token     : the existing HMAC write-token, now carrying tenant_id
//       - readToken : a short-lived Supabase JWT { role:authenticated, tenant_id }
//                     the client uses as the PostgREST bearer so reads are RLS-scoped
//   • every writer STAMPS tenant_id from the token (never from client input), and
//     by-key writes/deletes are SCOPED to the tenant (no cross-tenant edits).
//   • new "signup" action: a verified Supabase-Auth user creates a tenant + seeds it.
//   • BACKWARD-COMPATIBLE: if a caller sends no `tenant` and no readToken is used,
//     it resolves the worker's own tenant, so the current single-tenant client keeps
//     working after this deploys (reads still via anon until the 2c client ships).
//
// Still required alongside this (companion SQL — the 2c flip, not in this file):
//   • current_tenant_id() made claim-aware:
//       select coalesce(
//         nullif(current_setting('request.jwt.claims',true)::jsonb->>'tenant_id','')::uuid,
//         (select tenant_id from public.tenant_members where user_id=auth.uid() limit 1));
//   • per-table RLS: `using (tenant_id = current_tenant_id())` for authenticated, and
//     drop the broad "anon read" policies; PK reworks code→(tenant_id,code).
//   • import_sales_rows(rows, p_tenant uuid) — stamp tenant_id on imported sales.
// ─────────────────────────────────────────────────────────────────────────────

const SB_URL      = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SIGN_SECRET = SERVICE_KEY;                                   // write-token HMAC secret (unchanged)
const JWT_SECRET  = Deno.env.get("SUPABASE_JWT_SECRET") || "";     // 2b: signs the Supabase read-JWT
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;                      // write token: 7 days
const READ_TTL_S   = 12 * 60 * 60;                                 // 2b: read JWT: 12h

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const enc = new TextEncoder();
const qenc = encodeURIComponent;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function b64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(s: string): string { return atob(s.replace(/-/g, "+").replace(/_/g, "/")); }

// HMAC-SHA256 signer, parameterized by secret (2b: was hard-wired to SERVICE_KEY).
const _keys: Record<string, CryptoKey> = {};
async function hmac(data: string, secret: string): Promise<string> {
  if (!_keys[secret]) {
    _keys[secret] = await crypto.subtle.importKey("raw", enc.encode(secret),
      { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  }
  const sig = await crypto.subtle.sign("HMAC", _keys[secret], enc.encode(data));
  return b64url(new Uint8Array(sig));
}

// ── Gateway write-token (2-part, our own; now includes tenant_id) ──
async function signToken(payload: Record<string, unknown>): Promise<string> {
  const body = b64url(enc.encode(JSON.stringify(payload)));
  return body + "." + await hmac(body, SIGN_SECRET);
}
async function verifyToken(token: unknown): Promise<Record<string, unknown> | null> {
  if (typeof token !== "string" || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  if ((await hmac(body, SIGN_SECRET)) !== sig) return null;
  let payload: Record<string, unknown>;
  try { payload = JSON.parse(b64urlDecode(body)); } catch { return null; }
  if (typeof payload.exp !== "number" || Date.now() > payload.exp) return null;
  return payload;
}

// ── 2b: proper 3-part HS256 JWT (Supabase-compatible) for RLS-scoped reads ──
async function mintJWT(claims: Record<string, unknown>): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header  = b64url(enc.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const payload = b64url(enc.encode(JSON.stringify({ iss: "kitchen-mep", iat: now, exp: now + READ_TTL_S, ...claims })));
  const data = header + "." + payload;
  return data + "." + await hmac(data, JWT_SECRET);
}
// Verify an incoming Supabase Auth access token (HS256 legacy secret). NOTE: if this
// project has migrated to asymmetric JWT signing keys, verify via the JWKS instead.
async function verifySupabaseJWT(token: unknown): Promise<Record<string, unknown> | null> {
  if (typeof token !== "string" || token.split(".").length !== 3 || !JWT_SECRET) return null;
  const [h, pl, sig] = token.split(".");
  if ((await hmac(h + "." + pl, JWT_SECRET)) !== sig) return null;
  let payload: Record<string, unknown>;
  try { payload = JSON.parse(b64urlDecode(pl)); } catch { return null; }
  if (typeof payload.exp === "number" && Math.floor(Date.now() / 1000) > payload.exp) return null;
  return payload;
}

async function sr(path: string, init: RequestInit = {}): Promise<unknown> {
  const res = await fetch(SB_URL + "/rest/v1/" + path, {
    ...init,
    headers: { apikey: SERVICE_KEY, Authorization: "Bearer " + SERVICE_KEY, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error("db " + res.status + ": " + (await res.text()));
  const t = await res.text();
  return t ? JSON.parse(t) : null;
}
const MIN = { headers: { Prefer: "return=minimal" } };
const UPSERT_MIN = { headers: { Prefer: "resolution=merge-duplicates,return=minimal" } };
const num = (v: unknown) => (v === "" || v == null) ? null : (isNaN(parseFloat(String(v))) ? null : parseFloat(String(v)));
const int = (v: unknown) => (v === "" || v == null) ? null : (isNaN(parseInt(String(v), 10)) ? null : parseInt(String(v), 10));

function zurich(): { date: string; time: string } {
  const now = new Date();
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Zurich", hour: "2-digit", minute: "2-digit", hour12: false }).format(now);
  return { date, time };
}

// 2b: resolve a tenant reference (uuid or slug) → tenant id.
async function resolveTenant(ref: unknown): Promise<string | null> {
  if (typeof ref !== "string" || !ref) return null;
  if (UUID_RE.test(ref)) return ref;
  const rows = await sr("tenants?select=id&slug=eq." + qenc(ref) + "&limit=1") as any[];
  return rows?.[0]?.id ?? null;
}

type P = Record<string, any>;

// 2b: helper — the tenant id every writer must stamp (from the verified token).
const T = (p: P): string | null => (p._claims && p._claims.tenant_id) || null;
// 2b: append a tenant filter to a by-key PostgREST query when we have one.
const scope = (q: string, p: P) => T(p) ? q + "&tenant_id=eq." + qenc(T(p)!) : q;
// 2b: merge tenant_id into a write body when present.
const stamp = (body: P, p: P): P => T(p) ? { ...body, tenant_id: T(p) } : body;

const writers: Record<string, (p: P) => Promise<unknown>> = {
  saveWorker: async (p) => {
    const rolle = p.rolle || p.role || null;
    const aktiv = p.active === "false" || p.aktiv === false ? false : true;
    const body: P = stamp({ name: p.name, rolle, aktiv }, p);           // 2b: stamp
    if (p.pin) body.pin = String(p.pin);
    if (p.originalName) {
      await sr(scope("workers?name=eq." + qenc(p.originalName), p), { method: "PATCH", ...MIN, body: JSON.stringify(body) }); // 2b: scope
    } else {
      await sr("workers", { method: "POST", ...MIN, body: JSON.stringify(body) });
    }
    return { status: "ok" };
  },
  deleteWorker: async (p) => {
    await sr(scope("workers?name=eq." + qenc(p.name), p), { method: "PATCH", ...MIN, body: JSON.stringify({ aktiv: false }) });
    return { status: "ok" };
  },

  saveProduct: async (p) => {
    const body = stamp({
      code: p.code, name: p.name, kategorie: p.kategorie || null,
      mep_max: num(p.mepMax), gn_size: p.gnSize || null, gn_weight: num(p.gnWeight),
      tagesziel: num(p.tagesziel), shelf_life: int(p.shelfLife), drive_photo: p.driveLink || null,
      wa: num(p.wa), active: true,
    }, p);
    await sr("products", { method: "POST", ...UPSERT_MIN, body: JSON.stringify(body) });
    return { status: "ok" };
  },
  deleteProduct: async (p) => {
    await sr(scope("products?code=eq." + qenc(p.code), p), { method: "PATCH", ...MIN, body: JSON.stringify({ active: false }) });
    return { status: "ok" };
  },

  saveInventory: async (p) => {
    const body = stamp({
      code: p.code, name: p.name || p.code, kategorie: p.kategorie || null, unit: p.unit || null,
      quantity: num(p.quantity), weight_unit: num(p.weightUnit),
      minimum: num(p.minimum), maximum: num(p.maximum), kosten_unit: num(p.kostenUnit),
      lieferant: p.lieferant || null, last_order: p.lastOrder || null, notizen: p.notizen || null,
      allergen: p.allergen || null, image: p.image || null,
      kcal: num(p.kcal), protein: num(p.protein), fat: num(p.fat), carbs: num(p.carbs),
    }, p);
    await sr("inventory", { method: "POST", ...UPSERT_MIN, body: JSON.stringify(body) });
    return { status: "ok" };
  },
  deleteInventory: async (p) => {
    await sr(scope("inventory?code=eq." + qenc(p.code), p), { method: "DELETE", ...MIN });
    return { status: "ok" };
  },

  saveHACCPZone: async (p) => {
    const id = p.id || ("z" + Date.now());
    const body = stamp({ id, name: p.name, type: p.zoneType || p.type, min_temp: num(p.minTemp) ?? 0, max_temp: num(p.maxTemp) ?? 5, active: true }, p);
    await sr("haccp_zones", { method: "POST", ...UPSERT_MIN, body: JSON.stringify(body) });
    return { status: "ok" };
  },
  deleteHACCPZone: async (p) => { await sr(scope("haccp_zones?id=eq." + qenc(p.id), p), { method: "PATCH", ...MIN, body: JSON.stringify({ active: false }) }); return { status: "ok" }; },

  saveHACCPTask: async (p) => {
    const id = p.id || ("t" + Date.now());
    const body = stamp({ id, task: p.task, frequency: p.frequency || "Daily", active: true, sort_order: int(p.sortOrder) ?? 99 }, p);
    await sr("haccp_tasks", { method: "POST", ...UPSERT_MIN, body: JSON.stringify(body) });
    return { status: "ok" };
  },
  deleteHACCPTask: async (p) => { await sr(scope("haccp_tasks?id=eq." + qenc(p.id), p), { method: "PATCH", ...MIN, body: JSON.stringify({ active: false }) }); return { status: "ok" }; },

  saveHACCPCheck: async (p) => {
    const body = stamp({ check_date: p.date, task_id: p.taskId, task: p.task, done: p.done === "true" || p.done === true, worker: p.worker || null, notes: p.notes || null, checked_at: new Date().toISOString() }, p);
    await sr("haccp_checks", { method: "POST", ...UPSERT_MIN, body: JSON.stringify(body) });
    return { status: "ok" };
  },
  saveHACCPTemp: async (p) => {
    const { date, time } = zurich();
    const temp = num(p.temp), minT = num(p.minTemp), maxT = num(p.maxTemp);
    const body = stamp({ log_date: date, log_time: time, zone: p.zone, zone_type: p.zoneType || null, temp, min_temp: minT, max_temp: maxT, pass_fail: (temp !== null && minT !== null && maxT !== null && temp >= minT && temp <= maxT) ? "Pass" : "Fail", notes: p.notes || null, worker: p.worker || null }, p);
    await sr("haccp_temp_logs", { method: "POST", ...MIN, body: JSON.stringify(body) });
    return { status: "ok" };
  },

  // 2b: pass the tenant to a tenant-aware import_sales_rows(rows, p_tenant) (companion SQL).
  importSales: async (p) => {
    const raw: P[] = Array.isArray(p.rows) ? p.rows : [];
    const clean = raw.filter((r) => /^\d{4}-\d{2}-\d{2}/.test(String(r.d || "")) && String(r.p || "").trim() !== "" && (num(r.m) ?? 0) > 0);
    if (!clean.length) return { imported: 0, replaced: 0, skipped: raw.length };
    const res = await sr("rpc/import_sales_rows", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ rows: clean, p_tenant: T(p) }) }) as any[] | null;
    const row = Array.isArray(res) ? res[0] : (res as any);
    return { imported: row?.inserted ?? clean.length, replaced: row?.replaced ?? 0, skipped: raw.length - clean.length };
  },
  logImport: async (p) => {
    const body = stamp({ source: String(p.source || "file"), file_name: p.fileName || null, worker: (p._claims && p._claims.name) || null, date_from: p.dateFrom || null, date_to: p.dateTo || null, rows_sent: int(p.rowsSent) ?? 0, rows_inserted: int(p.rowsInserted) ?? 0, rows_replaced: int(p.rowsReplaced) ?? 0, chunk_errors: int(p.chunkErrors) ?? 0 }, p);
    await sr("import_log", { method: "POST", ...MIN, body: JSON.stringify(body) });
    return { status: "ok" };
  },
};

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  let p: P;
  try { p = await req.json(); } catch { return json({ error: "bad json" }, 400); }
  const action = String(p.action || "");

  // ── 2b: signup — a verified Supabase-Auth user creates a tenant and seeds it ──
  if (action === "signup") {
    const user = await verifySupabaseJWT(p.accessToken);          // real logged-in owner (email auth)
    if (!user || !user.sub) return json({ error: "unauthorized" }, 401);
    const name = String(p.businessName || "").trim();
    if (!name) return json({ error: "business name required" }, 400);
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 48) + "-" + Math.random().toString(36).slice(2, 6);
    const t = await sr("tenants", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ name, slug, plan: "trial" }) }) as any[];
    const tid = t[0].id;
    await sr("tenant_members", { method: "POST", ...MIN, body: JSON.stringify({ tenant_id: tid, user_id: user.sub, role: "owner" }) });
    // seed sensible HACCP defaults so the kitchen isn't empty
    await sr("haccp_zones", { method: "POST", ...MIN, body: JSON.stringify([
      { id: "z" + Date.now(), name: "Kühlschrank 1", type: "Fridge", min_temp: 0, max_temp: 5, active: true, tenant_id: tid },
      { id: "z" + (Date.now() + 1), name: "Tiefkühler 1", type: "Freezer", min_temp: -22, max_temp: -18, active: true, tenant_id: tid },
    ]) });
    return json({ ok: true, tenant: { id: tid, name, slug } });
  }

  // ── login: PIN → tokens (2b: tenant-aware, returns write token + read JWT) ──
  if (action === "login") {
    await new Promise((r) => setTimeout(r, 250));
    const pin = String(p.pin || "");
    if (!/^\d{4,}$/.test(pin)) return json({ ok: false });
    let q = "workers?select=name,rolle,tenant_id&pin=eq." + qenc(pin) + "&aktiv=eq.true&limit=1";
    const tid = await resolveTenant(p.tenant);                    // 2b: tablet's bound tenant (slug/uuid), optional
    if (tid) q += "&tenant_id=eq." + qenc(tid);                   // 2b: scope PIN lookup to that tenant
    let rows: any;
    try { rows = await sr(q); } catch { return json({ ok: false, error: "lookup failed" }, 500); }
    if (!rows || !rows.length) return json({ ok: false });
    const w = rows[0];
    const tenantId = w.tenant_id || tid || null;                  // 2b: fall back to the matched worker's tenant
    const worker = { name: w.name, role: w.rolle, rolle: w.rolle, tenant_id: tenantId };
    const token = await signToken({ name: worker.name, role: worker.role, tenant_id: tenantId, exp: Date.now() + TOKEN_TTL_MS });
    // 2b: read JWT only when we have both a tenant and a JWT secret; else client keeps using anon (transition-safe)
    let readToken: string | null = null;
    if (tenantId && JWT_SECRET) readToken = await mintJWT({ role: "authenticated", aud: "authenticated", sub: tenantId, tenant_id: tenantId });
    return json({ ok: true, worker, token, readToken });
  }

  // ── writes: require a valid write-token; tenant_id is taken from it ──
  const writer = writers[action];
  if (!writer) return json({ error: "unknown action: " + action }, 400);
  const claims = await verifyToken(p.token);
  if (!claims) return json({ error: "unauthorized" }, 401);
  p._claims = claims;                                             // 2b: carries tenant_id → stamp()/scope()

  try { return json(await writer(p)); }
  catch (e) { return json({ error: String((e as Error)?.message || e) }, 500); }
});
