/* ─────────────────────────────────────────────────────────────────────────────
   Kitchen MEP — per-deployment CONFIG.  ★ This is the ONE file a new kitchen edits. ★

   To stand up a new kitchen (see SETUP.md):
     1. Create your own Supabase project, run db/schema.sql, deploy the admin-gateway
        Edge Function, add a worker with a PIN.
     2. Paste your project's URL + anon (public) key below.
     3. Set your business name.
     4. Deploy this repo to any static host (GitHub Pages, Netlify, Vercel…).

   NOTE: SB_KEY is the Supabase *anon* key — it is public by design (RLS makes it
   read-only; all writes go through the PIN-gated admin-gateway function). It is safe
   to commit. Never put the service-role key here.
   ───────────────────────────────────────────────────────────────────────────── */
window.KMEP_CONFIG = {
  // ── Supabase (your project) ──
  SB_URL: "https://clntikfffmjytexvzubq.supabase.co",
  SB_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNsbnRpa2ZmZm1qeXRleHZ6dWJxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAxODQwMzUsImV4cCI6MjA5NTc2MDAzNX0.6aiiiJk0hX1DrbXE1zMSYswwJT1FFkrgunJm9eznIXE",

  // ── Legacy Google Apps Script endpoint (optional) ──
  // Only used by the few reads still on the GAS backend during the Sheets→Supabase
  // migration. A fresh Supabase-only kitchen can leave this as "".
  API: "https://script.google.com/macros/s/AKfycbz1aiIySe0-JwsLE4Vq8GyVwxS_7aRxyX48fvAWxP1cBeeOKFUK0w0mf7WCoe-9T8IHtQ/exec",

  // ── Business identity (header, tab title, and the default in Settings → Business) ──
  businessName: "212 Nooch Richti",
  appTitle: "Kitchen MEP",
};
