// Kitchen MEP — AI "Ask" assistant (natural-language Q&A over sales / stock / products).
// Self-contained classic script (loaded before </body>): it injects its own floating
// button + chat panel, so no HTML changes are needed elsewhere. It POSTs the question
// and the mep_gwt login token to the `ask` edge function. All numbers are computed
// server-side by read-only SQL — this module only renders the answer and, for trust,
// the exact queries that produced it.
(function () {
  "use strict";
  var FN_URL = (window.SB_URL || "https://clntikfffmjytexvzubq.supabase.co") + "/functions/v1/ask";

  function gwt() { try { return sessionStorage.getItem("mep_gwt") || ""; } catch (e) { return ""; } }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  // Minimal markdown: **bold**, `code`, simple pipe tables, and line breaks.
  function mdToHtml(md) {
    var lines = String(md).split("\n");
    var out = [];
    var i = 0;
    while (i < lines.length) {
      var ln = lines[i];
      // pipe table: a header row followed by a |---|---| separator
      if (/^\s*\|.*\|\s*$/.test(ln) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
        var rows = [];
        while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { rows.push(lines[i]); i++; }
        var cells = function (r) { return r.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map(function (c) { return c.trim(); }); };
        var head = cells(rows[0]);
        var body = rows.slice(2).map(cells);
        var t = '<table class="ask-tbl"><thead><tr>' + head.map(function (h) { return "<th>" + inline(h) + "</th>"; }).join("") + "</tr></thead><tbody>";
        t += body.map(function (r) { return "<tr>" + r.map(function (c) { return "<td>" + inline(c) + "</td>"; }).join("") + "</tr>"; }).join("");
        t += "</tbody></table>";
        out.push(t);
        continue;
      }
      out.push(inline(esc(ln)));
      i++;
    }
    return out.join("<br>").replace(/(<br>)*(<table)/g, "$2").replace(/(<\/table>)(<br>)*/g, "$1");
  }
  function inline(s) {
    return s
      .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
      .replace(/`([^`]+)`/g, '<code>$1</code>');
  }

  var panel, log, input, sendBtn, opened = false;

  function injectUI() {
    var style = document.createElement("style");
    style.textContent =
      "#ask-fab{position:fixed;right:18px;bottom:18px;z-index:9998;background:#4f46e5;color:#fff;border:none;border-radius:28px;height:52px;padding:0 20px;font-size:15px;font-weight:600;box-shadow:0 6px 20px rgba(0,0,0,.28);cursor:pointer;display:flex;align-items:center;gap:8px}" +
      "#ask-fab:hover{background:#4338ca}" +
      "#ask-panel{position:fixed;right:18px;bottom:80px;z-index:9999;width:min(420px,calc(100vw - 36px));height:min(560px,calc(100vh - 120px));background:#1e2030;color:#e7e9f3;border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.45);display:none;flex-direction:column;overflow:hidden;font-size:14px}" +
      "#ask-panel.open{display:flex}" +
      "#ask-head{padding:12px 14px;background:#272a3d;font-weight:700;display:flex;align-items:center;justify-content:space-between}" +
      "#ask-head .x{cursor:pointer;opacity:.7;font-size:18px;background:none;border:none;color:#e7e9f3}" +
      "#ask-log{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:10px}" +
      ".ask-msg{padding:9px 12px;border-radius:12px;line-height:1.45;max-width:92%;word-wrap:break-word}" +
      ".ask-msg.u{align-self:flex-end;background:#4f46e5;color:#fff;border-bottom-right-radius:3px}" +
      ".ask-msg.a{align-self:flex-start;background:#2c2f45;border-bottom-left-radius:3px}" +
      ".ask-msg.e{align-self:flex-start;background:#5b2333;color:#ffd7de}" +
      ".ask-msg code{background:rgba(255,255,255,.12);padding:1px 5px;border-radius:4px;font-size:12px}" +
      ".ask-tbl{border-collapse:collapse;margin:6px 0;font-size:12.5px;width:100%}" +
      ".ask-tbl th,.ask-tbl td{border:1px solid rgba(255,255,255,.18);padding:4px 8px;text-align:left}" +
      ".ask-tbl th{background:rgba(255,255,255,.08)}" +
      ".ask-sql{margin-top:6px;font-size:11.5px;opacity:.75}" +
      ".ask-sql summary{cursor:pointer}" +
      ".ask-sql pre{white-space:pre-wrap;background:rgba(0,0,0,.25);padding:6px;border-radius:6px;margin:4px 0;overflow-x:auto}" +
      "#ask-foot{display:flex;gap:8px;padding:10px;background:#272a3d}" +
      "#ask-input{flex:1;background:#12131c;color:#e7e9f3;border:1px solid #3a3d55;border-radius:10px;padding:9px 11px;font-size:14px;resize:none;max-height:90px}" +
      "#ask-send{background:#4f46e5;color:#fff;border:none;border-radius:10px;padding:0 16px;font-weight:600;cursor:pointer}" +
      "#ask-send:disabled{opacity:.5;cursor:default}" +
      ".ask-hint{opacity:.6;font-size:12px;text-align:center;padding:2px 8px}";
    document.head.appendChild(style);

    var fab = document.createElement("button");
    fab.id = "ask-fab";
    fab.innerHTML = "💬 Ask";
    fab.onclick = toggle;
    document.body.appendChild(fab);

    panel = document.createElement("div");
    panel.id = "ask-panel";
    panel.innerHTML =
      '<div id="ask-head"><span>✨ Ask the kitchen data</span><button class="x" title="Close">✕</button></div>' +
      '<div id="ask-log"></div>' +
      '<div class="ask-hint">e.g. "top 5 sellers in March 2026" · "low stock items" · "revenue last month"</div>' +
      '<div id="ask-foot"><textarea id="ask-input" rows="1" placeholder="Ask a question…"></textarea><button id="ask-send">Send</button></div>';
    document.body.appendChild(panel);

    panel.querySelector(".x").onclick = toggle;
    log = panel.querySelector("#ask-log");
    input = panel.querySelector("#ask-input");
    sendBtn = panel.querySelector("#ask-send");
    sendBtn.onclick = send;
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
    });

    add("a", "Hi! Ask me about your sales, stock or products — in plain language. I only read the data, never change it.");
  }

  function toggle() {
    opened = !opened;
    panel.classList.toggle("open", opened);
    if (opened) setTimeout(function () { input && input.focus(); }, 50);
  }

  function add(kind, html, isHtml) {
    var d = document.createElement("div");
    d.className = "ask-msg " + kind;
    d.innerHTML = isHtml ? html : esc(html);
    log.appendChild(d);
    log.scrollTop = log.scrollHeight;
    return d;
  }

  async function send() {
    var q = (input.value || "").trim();
    if (!q) return;
    if (!gwt()) {
      add("e", "Please sign in with your Admin PIN first, then ask again.");
      if (typeof window.requestAdminAccess === "function") window.requestAdminAccess();
      return;
    }
    input.value = "";
    add("u", q);
    sendBtn.disabled = true;
    var thinking = add("a", "…thinking");
    try {
      var res = await fetch(FN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, token: gwt() }),
      });
      var data = await res.json();
      thinking.remove();
      if (!res.ok || data.error) {
        add("e", data.error || ("Error " + res.status));
        if (res.status === 401 && typeof window.requestAdminAccess === "function") window.requestAdminAccess();
        return;
      }
      var html = mdToHtml(data.answer || "(no answer)");
      if (Array.isArray(data.queries) && data.queries.length) {
        html += '<details class="ask-sql"><summary>' + data.queries.length + ' quer' + (data.queries.length > 1 ? "ies" : "y") + " run</summary>";
        html += data.queries.map(function (x) { return "<pre>" + esc(x.sql) + "</pre>"; }).join("");
        html += "</details>";
      }
      add("a", html, true);
    } catch (e) {
      thinking.remove();
      add("e", "Network error: " + (e && e.message ? e.message : e));
    } finally {
      sendBtn.disabled = false;
      input.focus();
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", injectUI);
  else injectUI();
})();
