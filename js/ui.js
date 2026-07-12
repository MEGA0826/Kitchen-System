/* Kitchen MEP — js/ui.js
 * Shared UI utilities + the generic searchable-picker factory that replaces
 * the four hand-rolled pickers in dashboard.html (ingredient picker `ip-*`,
 * product-edit RM picker `epf-rm-*`, GR picker, PDF quick-add search).
 *
 * Also home of the ONE HTML escape helper (replaces _escM, _hEscH and the
 * scattered .replace(/"/g,'&quot;') calls) and the ONE cost-conversion rule
 * (CLAUDE.md: pricePerKg = kostenUnit / weightUnit).
 *
 * Classic script (no build step): exposes window.UI and window.Cost.
 */
(function () {
  "use strict";

  // ── Escaping ───────────────────────────────────────────────────────────────
  const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  /** Escape for BOTH text nodes and attribute values. Every innerHTML
   *  interpolation of user data (product/worker/menu names…) must pass
   *  through this — unescaped names are a stored-XSS vector. */
  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, ch => ESC[ch]);
  }

  // ── DOM helpers ────────────────────────────────────────────────────────────
  /** Build an element safely: UI.el("div", { className: "row", onclick: fn }, name)
   *  Children given as strings become text nodes — no injection possible.
   *  Per CLAUDE.md: styles are individual property assignments, never cssText. */
  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === "style" && v && typeof v === "object") {
        for (const [sk, sv] of Object.entries(v)) node.style[sk] = sv;
      } else if (k.startsWith("on") && typeof v === "function") {
        node.addEventListener(k.slice(2).toLowerCase(), v);
      } else if (k === "dataset" && v && typeof v === "object") {
        Object.assign(node.dataset, v);
      } else if (v !== null && v !== undefined) {
        node[k] = v;
      }
    }
    for (const child of children.flat()) {
      if (child === null || child === undefined) continue;
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return node;
  }

  /** Null-safe text setter (the CLAUDE.md `set` pattern, centralized). */
  function setText(id, value) {
    const node = document.getElementById(id);
    if (node) node.textContent = value;
  }

  function debounce(fn, waitMs = 200) {
    let t;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), waitMs);
    };
  }

  // ── Dates (CLAUDE.md: always en-CA, never toISOString().slice) ────────────
  function dateKey(d = new Date()) { return d.toLocaleDateString("en-CA"); }

  function fmtTimestamp(raw) {
    const d = new Date(raw);
    if (isNaN(d)) return raw;
    const p = n => String(n).padStart(2, "0");
    return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${String(d.getFullYear()).slice(2)} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  // ── Generic searchable picker ─────────────────────────────────────────────
  /**
   * createPicker({
   *   listEl, searchEl,                    // DOM elements (container-scoped, per CLAUDE.md)
   *   getItems: () => [{code, name, unit, unitCost}],
   *   renderMeta: item => string,          // optional trailing label (e.g. "CHF 2.50/kg")
   *   onSelect: item => {},
   *   maxResults = 40
   * })
   * Returns { refresh() }. All four existing pickers reduce to one of these
   * plus their own getItems/onSelect — the filter, render, and event wiring
   * stop being copy-pasted.
   */
  function createPicker({ listEl, searchEl, getItems, renderMeta, onSelect, maxResults = 40 }) {
    function refresh() {
      const q = (searchEl.value || "").trim().toLowerCase();
      const items = getItems();
      const filtered = q
        ? items.filter(i =>
            (i.name || "").toLowerCase().includes(q) ||
            (i.code || "").toLowerCase().includes(q))
        : items;

      listEl.replaceChildren();
      if (!filtered.length) {
        listEl.append(el("div", { className: "picker-empty" }, "Keine Ergebnisse."));
        return;
      }
      for (const item of filtered.slice(0, maxResults)) {
        listEl.append(
          el("div", { className: "picker-row", onclick: () => onSelect(item) },
            el("span", { className: "picker-name" }, item.name || item.code),
            el("span", { className: "picker-code" }, item.code || ""),
            renderMeta ? el("span", { className: "picker-meta" }, renderMeta(item)) : null
          )
        );
      }
    }
    searchEl.addEventListener("input", debounce(refresh, 150));
    return { refresh };
  }

  // ── Toast (unchanged behavior from showToast, kept here so both pages share it)
  function toast(msg, type = "info", duration = 3500) {
    const container = document.getElementById("toastContainer");
    if (!container) return;
    const node = el("div", { className: `toast ${type}` }, msg);
    container.append(node);
    setTimeout(() => {
      node.classList.add("out");
      setTimeout(() => node.remove(), 300);
    }, duration);
  }

  window.UI = { esc, el, setText, debounce, dateKey, fmtTimestamp, createPicker, toast };

  // ── Cost rules — the single source of truth ────────────────────────────────
  const Cost = {
    /** CHF per kg. kostenUnit is CHF per purchase unit; weightUnit converts
     *  that unit to kg. NEVER read kostenUnit as CHF/kg directly. */
    pricePerKg(inventoryItem) {
      const kostenUnit = parseFloat(inventoryItem?.kostenUnit) || 0;
      const weightUnit = parseFloat(inventoryItem?.weightUnit) || 1;
      return kostenUnit / weightUnit;
    },

    /** CHF cost of one GN of a MEP product = Σ over its recipe rows of
     *  menge × pricePerKg(RM); falls back to the product's stored wa. */
    waPerGN(code, { products, inventory, recipes }) {
      let total = 0;
      const byCode = new Map(inventory.map(i => [i.code, i]));
      for (const r of recipes) {
        if (r.mepCode !== code) continue;
        total += (parseFloat(r.menge) || 0) * Cost.pricePerKg(byCode.get(r.rmCode));
      }
      return total || parseFloat(products[code]?.wa) || 0;
    }
  };

  window.Cost = Cost;
})();
