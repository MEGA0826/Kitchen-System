#!/usr/bin/env node
/* Kitchen MEP — static validation run in CI and locally (`node scripts/validate.js`).
 * Parses every inline <script> in the HTML pages and the service worker so a
 * syntax error can never reach GitHub Pages (there is no build step to catch it).
 * Exits non-zero on the first problem. */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
let failures = 0;

function checkJs(label, code) {
  try {
    new Function(code);                                   // parse only, never executes
  } catch (e) {
    // retry as an async body so top-level await/return isn't a false positive
    try { new Function("return (async()=>{" + code + "})()"); }
    catch (e2) { console.error(`  ✗ ${label}: ${e2.message}`); failures++; return; }
  }
}

// ── inline scripts in the HTML pages ────────────────────────────────────────
for (const file of ["dashboard.html", "index.html", "onboarding.html"]) {
  const p = path.join(ROOT, file);
  if (!fs.existsSync(p)) continue;
  const html = fs.readFileSync(p, "utf8");
  const blocks = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)];
  blocks.forEach((m, i) => checkJs(`${file} inline script #${i + 1}`, m[1]));
  console.log(`${file}: ${blocks.length} inline script block(s) checked`);
}

// ── standalone JS files ─────────────────────────────────────────────────────
for (const file of ["service-worker.js", "i18n.js", "js/api.js", "js/state.js", "js/ui.js", "js/main.js"]) {
  const p = path.join(ROOT, file);
  if (!fs.existsSync(p)) continue;
  checkJs(file, fs.readFileSync(p, "utf8"));
  console.log(`${file}: checked`);
}

// ── service-worker must declare a cache version (guards against a broken bump) ─
const swPath = path.join(ROOT, "service-worker.js");
if (fs.existsSync(swPath)) {
  const sw = fs.readFileSync(swPath, "utf8");
  if (!/mep-static-v\d+/.test(sw) || !/mep-api-v\d+/.test(sw)) {
    console.error("  ✗ service-worker.js: missing mep-static-vN / mep-api-vN cache version");
    failures++;
  }
}

if (failures) { console.error(`\n${failures} problem(s) found.`); process.exit(1); }
console.log("\nAll checks passed.");
