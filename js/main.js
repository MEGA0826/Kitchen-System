/* Kitchen MEP — js/main.js
 * Reference init wiring: the same boot sequence dashboard.html runs today
 * (lines ~4346-4409: hydrate from cache → parallel fetch → re-render saved
 * tab → poll), expressed against Api/Store/UI — and without the two bugs in
 * the current version:
 *   1. `const saved` is reassigned at dashboard.html:4390 → TypeError,
 *      silently swallowed by the .catch, skipping the whole re-render block.
 *   2. Every writer must remember which render functions to call; here the
 *      renderers subscribe once.
 *
 * NOT auto-executed: dashboard.html adopts this by calling Main.initDashboard()
 * from its own script block once Phase 1 call-site migration is done.
 */
(function () {
  "use strict";

  const KDS_POLL_MS = 60_000;

  const TAB_LOADERS = {
    // saved-tab → what must re-render after the initial parallel fetch lands.
    inventory:  () => window.filterInventory?.(),
    orders:     () => window.renderOrders?.(),
    recipes:    () => { window.loadMenus?.(); window.loadGRs?.(); window.loadRequirements?.(); },
    deductions: () => window.loadDeductions?.(),
    reports:    () => window.loadReportsTab?.()
  };

  async function loadCoreData() {
    // Parallel, none blocks the others — same contract as Promise.allSettled today.
    const [products, inventory, scans, workers] = await Promise.allSettled([
      Api.call({ action: "allProducts" }),
      Api.call({ action: "inventory" }),
      Api.call({ action: "scans" }),
      Api.call({ action: "allWorkers" })
    ]);
    if (products.status === "fulfilled")  Store.set("products", products.value || {});
    if (inventory.status === "fulfilled") Store.set("inventory", inventory.value?.inventory || []);
    if (scans.status === "fulfilled")     Store.set("scans", Array.isArray(scans.value?.scans) ? scans.value.scans : []);
    if (workers.status === "fulfilled")   Store.set("workers", Array.isArray(workers.value?.workers) ? workers.value.workers : []);
  }

  function rerenderSavedTab() {
    let saved = sessionStorage.getItem("activeTab") || "kds";
    if (saved === "mep-overview") saved = "products"; // legacy tab redirect (`let`, not `const`)
    TAB_LOADERS[saved]?.();
  }

  function startKdsPolling() {
    // Fetches fresh scans; renderers react via Store subscription instead of
    // being called by name here.
    setInterval(async () => {
      try {
        const data = await Api.call({ action: "scans" }, { fresh: true });
        const scans = Array.isArray(data?.scans) ? data.scans : [];
        if (scans.length !== Store.get("scans").length) Store.set("scans", scans);
      } catch (e) {
        console.warn("[Main] KDS poll failed:", e);
      }
    }, KDS_POLL_MS);
  }

  async function initDashboard() {
    Store.hydrate();               // paint from cache first — no flicker
    window.applyRoleAccess?.();    // tabs visible before any network round-trip

    // Renderers subscribe once; every future Store.set repaints them.
    Store.subscribe("scans", () => window._renderKDS?.());
    Store.subscribe("inventory", () => window.filterInventory?.());
    Store.subscribe("products", () => window.filterProducts?.());

    await loadCoreData();
    rerenderSavedTab();
    startKdsPolling();
  }

  window.Main = { initDashboard };
})();
