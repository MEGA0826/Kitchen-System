// Kitchen MEP — stripe-checkout Edge Function
// Creates a Stripe Checkout Session (subscription) for the caller's tenant.
// Deploy with verify_jwt=false; it authenticates the caller itself via their
// Supabase Auth access token (Authorization: Bearer <token>) → resolves the tenant
// via tenant_members → creates/reuses a Stripe customer → returns the Checkout URL.
//
// Secrets: STRIPE_SECRET_KEY, STRIPE_PRICE_STARTER/PRO/MULTISITE, APP_URL (your site origin).
// SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are injected automatically.
//
// NOTE: requires Supabase Auth users + tenant_members rows — i.e. the Stage-2 signup
// flow. Until that ships, this deploys inert (401 "not authenticated").

const SB_URL      = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY    = Deno.env.get("SUPABASE_ANON_KEY")!;
const STRIPE_KEY  = Deno.env.get("STRIPE_SECRET_KEY") || "";
const APP_URL     = (Deno.env.get("APP_URL") || "").replace(/\/$/, "");
const TIER_PRICE: Record<string, string> = {
  starter:   Deno.env.get("STRIPE_PRICE_STARTER")   || "",
  pro:       Deno.env.get("STRIPE_PRICE_PRO")       || "",
  multisite: Deno.env.get("STRIPE_PRICE_MULTISITE") || "",
};

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, status: number) =>
  new Response(JSON.stringify(o), { status, headers: { ...CORS, "Content-Type": "application/json" } });

async function userFromToken(bearer: string): Promise<string | null> {
  const res = await fetch(SB_URL + "/auth/v1/user", {
    headers: { apikey: ANON_KEY, Authorization: "Bearer " + bearer },
  });
  if (!res.ok) return null;
  const u = await res.json();
  return u?.id ?? null;
}
async function sr(path: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(SB_URL + "/rest/v1/" + path, {
    ...init,
    headers: { apikey: SERVICE_KEY, Authorization: "Bearer " + SERVICE_KEY,
      "Content-Type": "application/json", ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error("db " + res.status + ": " + (await res.text()));
  const t = await res.text();
  return t ? JSON.parse(t) : null;
}
async function stripeForm(path: string, params: Record<string, string>): Promise<any> {
  const res = await fetch("https://api.stripe.com/v1/" + path, {
    method: "POST",
    headers: { Authorization: "Bearer " + STRIPE_KEY, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  const j = await res.json();
  if (!res.ok) throw new Error("stripe " + res.status + ": " + JSON.stringify(j));
  return j;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  try {
    const bearer = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const uid = bearer ? await userFromToken(bearer) : null;
    if (!uid) return json({ error: "not authenticated" }, 401);

    const { tier } = await req.json().catch(() => ({}));
    const priceId = TIER_PRICE[String(tier)];
    if (!priceId) return json({ error: "unknown tier: " + tier }, 400);

    const mem = await sr("tenant_members?user_id=eq." + encodeURIComponent(uid) + "&select=tenant_id&limit=1");
    const tenantId = mem?.[0]?.tenant_id;
    if (!tenantId) return json({ error: "no tenant for user" }, 400);
    const trows = await sr("tenants?id=eq." + tenantId + "&select=id,name,stripe_customer_id&limit=1");
    const tenant = trows?.[0] || {};

    let customer = tenant.stripe_customer_id;
    if (!customer) {
      const c = await stripeForm("customers", { name: tenant.name || "Kitchen", "metadata[tenant_id]": tenantId });
      customer = c.id;
      await sr("tenants?id=eq." + tenantId, { method: "PATCH",
        headers: { Prefer: "return=minimal" }, body: JSON.stringify({ stripe_customer_id: customer }) });
    }

    const session = await stripeForm("checkout/sessions", {
      mode: "subscription",
      customer,
      "line_items[0][price]": priceId,
      "line_items[0][quantity]": "1",
      client_reference_id: tenantId,
      allow_promotion_codes: "true",
      success_url: APP_URL + "/dashboard.html?billing=success",
      cancel_url:  APP_URL + "/dashboard.html?billing=cancel",
    });
    return json({ url: session.url }, 200);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
