// Kitchen MEP — admin-gateway Edge Function
// Purpose: close the Phase 3 hole where the public anon key could WRITE every
// table. All writes now go through here: the caller must present a token that
// is only issued after a correct PIN, and the actual DB write is performed with
// the service-role key (server-only). The anon key is made read-only via RLS.
//
// Auth model (stateless):
//   login  -> verify PIN server-side -> return HMAC-signed token {name,role,exp}
//   writes -> require a valid unexpired token, then write with service-role
//
// The signing secret is the service-role key itself (never leaves the server),
// so tokens are unforgeable without it. verify_jwt is disabled because this
// function implements its own PIN-based auth; the anon-key JWT would add nothing
// (it is public) and only complicate CORS preflight.

const SB_URL      = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SIGN_SECRET = SERVICE_KEY; // server-only HMAC secret
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // 12h — one kitchen shift

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const enc = new TextEncoder();
const qenc = encodeURIComponent;

function b64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(s: string): string {
  return atob(s.replace(/-/g, "+").replace(/_/g, "/"));
}

let _key: CryptoKey | null = null;
async function hmacKey(): Promise<CryptoKey> {
  if (!_key) {
    _key = await crypto.subtle.importKey("raw", enc.encode(SIGN_SECRET),
      { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  }
  return _key;
}
async function sign(data: string): Promise<string> {
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(), enc.encode(data));
  return b64url(new Uint8Array(sig));
}
async function signToken(payload: Record<string, unknown>): Promise<string> {
  const body = b64url(enc.encode(JSON.stringify(payload)));
  return body + "." + await sign(body);
}
async function verifyToken(token: unknown): Promise<Record<string, unknown> | null> {
  if (typeof token !== "string" || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  // constant-ish comparison: recompute and compare
  if ((await sign(body)) !== sig) return null;
  let payload: Record<string, unknown>;
  try { payload = JSON.parse(b64urlDecode(body)); } catch { return null; }
  if (typeof payload.exp !== "number" || Date.now() > payload.exp) return null;
  return payload;
}

// PostgREST call with the service-role key (bypasses RLS).
async function sr(path: string, init: RequestInit = {}): Promise<unknown> {
  const res = await fetch(SB_URL + "/rest/v1/" + path, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: "Bearer " + SERVICE_KEY,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  if (!res.ok) throw new Error("db " + res.status + ": " + (await res.text()));
  const t = await res.text();
  return t ? JSON.parse(t) : null;
}
const MIN = { headers: { Prefer: "return=minimal" } };
const UPSERT_MIN = { headers: { Prefer: "resolution=merge-duplicates,return=minimal" } };

function num(v: unknown): number | null {
  if (v === "" || v === null || v === undefined) return null;
  const n = parseFloat(String(v));
  return isNaN(n) ? null : n;
}
function int(v: unknown): number | null {
  if (v === "" || v === null || v === undefined) return null;
  const n = parseInt(String(v), 10);
  return isNaN(n) ? null : n;
}

// Date/time in the kitchen's timezone (matches the old client-side en-CA logic).
function zurich(): { date: string; time: string } {
  const now = new Date();
  const date = new Intl.DateTimeFormat("en-CA",
    { timeZone: "Europe/Zurich", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const time = new Intl.DateTimeFormat("en-GB",
    { timeZone: "Europe/Zurich", hour: "2-digit", minute: "2-digit", hour12: false }).format(now);
  return { date, time };
}

type P = Record<string, any>;

// Write handlers — byte-for-byte the same mapping the frontend used before,
// now executed server-side with the service-role key.
const writers: Record<string, (p: P) => Promise<unknown>> = {
  saveWorker: async (p) => {
    const rolle = p.rolle || p.role || null;
    const aktiv = p.active === "false" || p.aktiv === false ? false : true;
    const body: P = { name: p.name, rolle, aktiv };
    if (p.pin) body.pin = String(p.pin); // empty pin = keep current
    if (p.originalName) {
      await sr("workers?name=eq." + qenc(p.originalName), { method: "PATCH", ...MIN, body: JSON.stringify(body) });
    } else {
      await sr("workers", { method: "POST", ...MIN, body: JSON.stringify(body) });
    }
    return { status: "ok" };
  },
  deleteWorker: async (p) => {
    await sr("workers?name=eq." + qenc(p.name), { method: "PATCH", ...MIN, body: JSON.stringify({ aktiv: false }) });
    return { status: "ok" };
  },

  saveProduct: async (p) => {
    const body = {
      code: p.code, name: p.name,
      kategorie: p.kategorie || null,
      mep_max: num(p.mepMax), gn_size: p.gnSize || null,
      gn_weight: num(p.gnWeight), tagesziel: num(p.tagesziel),
      shelf_life: int(p.shelfLife), drive_photo: p.driveLink || null,
      wa: num(p.wa), active: true,
    };
    await sr("products", { method: "POST", ...UPSERT_MIN, body: JSON.stringify(body) });
    return { status: "ok" };
  },
  deleteProduct: async (p) => {
    await sr("products?code=eq." + qenc(p.code), { method: "PATCH", ...MIN, body: JSON.stringify({ active: false }) });
    return { status: "ok" };
  },

  saveInventory: async (p) => {
    const body = {
      code: p.code, name: p.name || p.code, kategorie: p.kategorie || null, unit: p.unit || null,
      quantity: num(p.quantity), weight_unit: num(p.weightUnit),
      minimum: num(p.minimum), maximum: num(p.maximum), kosten_unit: num(p.kostenUnit),
      lieferant: p.lieferant || null, last_order: p.lastOrder || null, notizen: p.notizen || null,
      allergen: p.allergen || null, image: p.image || null,
    };
    await sr("inventory", { method: "POST", ...UPSERT_MIN, body: JSON.stringify(body) });
    return { status: "ok" };
  },
  deleteInventory: async (p) => {
    await sr("inventory?code=eq." + qenc(p.code), { method: "DELETE", ...MIN });
    return { status: "ok" };
  },

  saveHACCPZone: async (p) => {
    const id = p.id || ("z" + Date.now());
    const body = { id, name: p.name, type: p.zoneType || p.type,
      min_temp: num(p.minTemp) ?? 0, max_temp: num(p.maxTemp) ?? 5, active: true };
    await sr("haccp_zones", { method: "POST", ...UPSERT_MIN, body: JSON.stringify(body) });
    return { status: "ok" };
  },
  deleteHACCPZone: async (p) => {
    await sr("haccp_zones?id=eq." + qenc(p.id), { method: "PATCH", ...MIN, body: JSON.stringify({ active: false }) });
    return { status: "ok" };
  },

  saveHACCPTask: async (p) => {
    const id = p.id || ("t" + Date.now());
    const body = { id, task: p.task, frequency: p.frequency || "Daily", active: true, sort_order: int(p.sortOrder) ?? 99 };
    await sr("haccp_tasks", { method: "POST", ...UPSERT_MIN, body: JSON.stringify(body) });
    return { status: "ok" };
  },
  deleteHACCPTask: async (p) => {
    await sr("haccp_tasks?id=eq." + qenc(p.id), { method: "PATCH", ...MIN, body: JSON.stringify({ active: false }) });
    return { status: "ok" };
  },

  saveHACCPCheck: async (p) => {
    const body = { check_date: p.date, task_id: p.taskId, task: p.task,
      done: p.done === "true" || p.done === true,
      worker: p.worker || null, notes: p.notes || null, checked_at: new Date().toISOString() };
    await sr("haccp_checks", { method: "POST", ...UPSERT_MIN, body: JSON.stringify(body) });
    return { status: "ok" };
  },

  saveHACCPTemp: async (p) => {
    const { date, time } = zurich();
    const temp = num(p.temp), minT = num(p.minTemp), maxT = num(p.maxTemp);
    const body = { log_date: date, log_time: time, zone: p.zone, zone_type: p.zoneType || null,
      temp, min_temp: minT, max_temp: maxT,
      pass_fail: (temp !== null && minT !== null && maxT !== null && temp >= minT && temp <= maxT) ? "Pass" : "Fail",
      notes: p.notes || null, worker: p.worker || null };
    await sr("haccp_temp_logs", { method: "POST", ...MIN, body: JSON.stringify(body) });
    return { status: "ok" };
  },

  // Sales CSV import -> sales_history (the table the Sales page reads). Rows are
  // the {d,p,k,m,u,wa,g} shape produced by the client CSV parser. Skips
  // (sale_date, product_name) pairs that already exist, mirroring the old GAS
  // dedup so re-imports are idempotent and never double-count.
  importSales: async (p) => {
    const raw: P[] = Array.isArray(p.rows) ? p.rows : [];
    const mapped = raw.map((r) => ({
      sale_date:    String(r.d || "").slice(0, 10),
      product_name: String(r.p || "").trim(),
      kategorie:    String(r.k || "").trim() || null,
      qty:          num(r.m) ?? 0,
      price:        num(r.u) ?? 0,               // Umsatz / revenue — as getSalesAnalysis reads it
      wa:           Math.abs(num(r.wa) ?? 0),
      garverlust:   num(r.g) ?? 0,
    })).filter((r) => r.sale_date && r.product_name && r.qty > 0);
    if (!mapped.length) return { imported: 0, skipped: 0 };

    const dates = [...new Set(mapped.map((r) => r.sale_date))];
    const existing = await sr(
      "sales_history?select=sale_date,product_name&sale_date=in.(" + dates.join(",") + ")"
    ) as Array<{ sale_date: string; product_name: string }> | null;
    const seen = new Set((existing || []).map((e) => e.sale_date + "\x00" + e.product_name));
    const toInsert = mapped.filter((r) => !seen.has(r.sale_date + "\x00" + r.product_name));

    for (let i = 0; i < toInsert.length; i += 500) {
      await sr("sales_history", { method: "POST", ...MIN, body: JSON.stringify(toInsert.slice(i, i + 500)) });
    }
    return { imported: toInsert.length, skipped: mapped.length - toInsert.length };
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

  // ── login: PIN -> signed token ──────────────────────────────────────────
  if (action === "login") {
    await new Promise((r) => setTimeout(r, 250)); // slow brute-force a little
    const pin = String(p.pin || "");
    if (!/^\d{4,}$/.test(pin)) return json({ ok: false });
    let rows: any;
    try {
      rows = await sr("workers?select=name,rolle&pin=eq." + qenc(pin) + "&aktiv=eq.true&limit=1");
    } catch (e) {
      return json({ ok: false, error: "lookup failed" }, 500);
    }
    if (!rows || !rows.length) return json({ ok: false });
    const worker = { name: rows[0].name, role: rows[0].rolle, rolle: rows[0].rolle };
    const token = await signToken({ name: worker.name, role: worker.role, exp: Date.now() + TOKEN_TTL_MS });
    return json({ ok: true, worker, token });
  }

  // ── writes: require a valid token ───────────────────────────────────────
  const writer = writers[action];
  if (!writer) return json({ error: "unknown action: " + action }, 400);
  const claims = await verifyToken(p.token);
  if (!claims) return json({ error: "unauthorized" }, 401);

  try {
    return json(await writer(p));
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
