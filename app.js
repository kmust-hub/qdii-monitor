(function () {
  "use strict";

  const $ = (s) => document.querySelector(s);
  const IDX = { nasdaq100: "纳指100", sp500: "标普500" };
  const STATUS = [
    { v: "开放", cls: "open" },
    { v: "限大额", cls: "limit" },
    { v: "暂停", cls: "pause" },
  ];
  const statusCls = (s) => (STATUS.find((x) => x.v === s) || { cls: "none" }).cls;
  const statusPrio = (s) => ({ "暂停": 0, "限大额": 1, "开放": 2 }[s] ?? 3);

  // 所有列定义（默认顺序）
  const COLS = [
    { key: "name", label: "基金", num: false },
    { key: "index_key", label: "指数", num: false },
    { key: "status", label: "申购状态", num: false },
    { key: "redeem", label: "赎回", num: false },
    { key: "nav", label: "净值", num: true },
    { key: "nav_chg", label: "日涨跌", num: true },
    { key: "return_1m", label: "近1月", num: true },
    { key: "return_6m", label: "近6月", num: true },
    { key: "return_1y", label: "近1年", num: true },
    { key: "return_3y", label: "近3年", num: true },
    { key: "fund_size", label: "规模(亿)", num: true },
    { key: "limit_amount", label: "单日限购", num: true },
    { key: "fee_total", label: "费用", num: true },
    { key: "tracking_error", label: "年化误差", num: true },
  ];
  const DEFAULT_ORDER = COLS.map((x) => x.key);

  const state = {
    funds: [],
    index: "all",
    q: "",
    sort: { key: "status", dir: "asc" },
    expanded: null,
    theme: localStorage.getItem("theme") || "light",
    order: loadOrder(),
    hidden: new Set(loadHidden()),
    timer: null,
    changes: [],
    notify: null,
    dragKey: null,
  };

  function loadOrder() {
    try {
      const v = JSON.parse(localStorage.getItem("cols"));
      if (Array.isArray(v) && v.length && COLS.some((c) => c.key === v[0])) {
        const valid = v.filter((k) => COLS.some((c) => c.key === k));
        DEFAULT_ORDER.forEach((k) => { if (!valid.includes(k)) valid.push(k); });
        return valid;
      }
    } catch (e) { /* ignore */ }
    return DEFAULT_ORDER.slice();
  }
  function loadHidden() {
    try {
      const v = JSON.parse(localStorage.getItem("hiddenCols"));
      return Array.isArray(v) ? v : [];
    } catch (e) { return []; }
  }
  function persist() {
    localStorage.setItem("cols", JSON.stringify(state.order));
    localStorage.setItem("hiddenCols", JSON.stringify([...state.hidden]));
  }
  function visible() { return state.order.filter((k) => !state.hidden.has(k)); }

  function fmtNum(v, d = 4) {
    if (v === null || v === undefined || isNaN(v)) return "—";
    return Number(v).toFixed(d);
  }
  function fmtPct(v, sign = true) {
    if (v === null || v === undefined || isNaN(v)) return "—";
    const n = Number(v);
    return (sign && n > 0 ? "+" : "") + n.toFixed(2) + "%";
  }
  function fmtPctPlain(v) {
    if (v === null || v === undefined || isNaN(v)) return "—";
    return Number(v).toFixed(2) + "%";
  }
  function pct0(v) {
    if (v === null || v === undefined || isNaN(v)) return "—";
    return Number(v).toFixed(2) + "%";
  }
  function pctCls(v) {
    if (v === null || v === undefined || isNaN(v) || Number(v) === 0) return "flat";
    return Number(v) > 0 ? "up" : "down";
  }
  function fmtLimit(v) {
    if (v === null || v === undefined || isNaN(v)) return "—";
    const n = Number(v);
    if (n >= 1e8) return (n / 1e8).toFixed(1) + "亿";
    if (n >= 1e4) return (n / 1e4).toFixed(1).replace(/\.0$/, "") + "万";
    return n.toFixed(0) + "元";
  }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  function cell(f, key) {
    switch (key) {
      case "name":
        return `<td><div class="fname">${esc(f.name)}</div><div class="fcode">${esc(f.code)}</div></td>`;
      case "index_key":
        return `<td><span class="idx ${f.index_key === "nasdaq100" ? "nasdaq100" : "sp500"}">${IDX[f.index_key]}</span></td>`;
      case "status":
        return `<td><span class="bdg ${statusCls(f.status)}">${f.status || "—"}</span></td>`;
      case "redeem":
        return `<td><span class="bdg ${statusCls(f.redeem)}">${f.redeem || "—"}</span></td>`;
      case "nav":
        return `<td class="num">${fmtNum(f.nav)}</td>`;
      case "nav_chg":
        return `<td class="num ${pctCls(f.nav_chg)}">${fmtPct(f.nav_chg)}</td>`;
      case "return_1m":
        return `<td class="num ${pctCls(f.return_1m)}">${fmtPct(f.return_1m)}</td>`;
      case "return_6m":
        return `<td class="num ${pctCls(f.return_6m)}">${fmtPct(f.return_6m)}</td>`;
      case "return_1y":
        return `<td class="num ${pctCls(f.return_1y)}">${fmtPct(f.return_1y)}</td>`;
      case "return_3y":
        return `<td class="num ${pctCls(f.return_3y)}">${fmtPct(f.return_3y)}</td>`;
      case "fund_size":
        return `<td class="num">${f.fund_size != null ? Number(f.fund_size).toFixed(2) : "—"}</td>`;
      case "limit_amount":
        return `<td class="num">${f.limit_amount != null ? fmtLimit(f.limit_amount) : "—"}</td>`;
      case "fee_total":
        return `<td class="num">${f.fee_total != null ? Number(f.fee_total).toFixed(2) + "%" : "—"}</td>`;
      case "tracking_error":
        return `<td class="num">${fmtPctPlain(f.tracking_error)}</td>`;
    }
    return `<td></td>`;
  }

  function filtered() {
    let arr = state.funds;
    if (state.index !== "all") arr = arr.filter((f) => f.index_key === state.index);
    if (state.q) {
      const q = state.q.trim().toLowerCase();
      arr = arr.filter((f) => f.code.includes(q) || f.name.toLowerCase().includes(q));
    }
    const k = state.sort.key;
    if (k) {
      const dir = state.sort.dir === "asc" ? 1 : -1;
      arr = arr.slice().sort((a, b) => {
        if (k === "status") return dir * (statusPrio(a.status) - statusPrio(b.status));
        let av = a[k], bv = b[k];
        if (typeof av === "string" || typeof bv === "string") {
          return dir * String(av ?? "").localeCompare(String(bv ?? ""), "zh");
        }
        av = Number(av); bv = Number(bv);
        return dir * ((isNaN(av) ? -1e9 : av) - (isNaN(bv) ? -1e9 : bv));
      });
    }
    return arr;
  }

  function renderStats() {
    const f = state.funds;
    const cnt = (p) => f.filter(p).length;
    const changes = (state.changes || []).length;
    $("#stats").innerHTML = `
      <div class="stat t-cold"><div class="k">纳指100 基金</div><div class="v">${cnt((x) => x.index_key === "nasdaq100")}<small> 只</small></div></div>
      <div class="stat t-cold"><div class="k">标普500 基金</div><div class="v">${cnt((x) => x.index_key === "sp500")}<small> 只</small></div></div>
      <div class="stat t-warn"><div class="k">有每日限购</div><div class="v">${cnt((x) => x.limit_amount != null)}<small> 只</small></div></div>
      <div class="stat t-green"><div class="k">不限购/正常</div><div class="v">${cnt((x) => x.limit_amount == null)}<small> 只</small></div></div>
      <div class="stat t-red"><div class="k">近期变更</div><div class="v">${changes}<small> 条</small></div></div>
    `;
  }

  function renderHead() {
    $("#theadRow").innerHTML = visible().map((k) => {
      const c = COLS.find((x) => x.key === k);
      const sorted = k === state.sort.key ? (state.sort.dir === "asc" ? " sorted-asc" : " sorted-desc") : "";
      const cls = (c.num ? " num" : "") + sorted;
      return `<th data-sort="${k}" class="${cls.trim()}">${c.label}</th>`;
    }).join("");
  }

  function detailRow(f) {
    return `<tr class="detail-row"><td colspan="${visible().length}"><div class="detail-box">
      <h3>${esc(f.name)}（${esc(f.code)}） 近${f.history ? f.history.length : 0}个交易日状态</h3>
      <div class="dl-meta">
        <span>单日限购（天天基金）：<b>${f.limit_amount != null ? fmtLimit(f.limit_amount) : "—"}</b></span>
        <span>年化误差：<b>${fmtPctPlain(f.tracking_error)}</b></span>
        <span>规模：<b>${f.fund_size != null ? Number(f.fund_size).toFixed(2) + "亿" : "—"}</b></span>
        <span>成立：<b>${esc(f.inception_date || "—")}</b></span>
      </div>
      <div class="dl-fee">费用构成：
        申购费 <b>${pct0(f.buy_fee)}</b> + 管理费 <b>${pct0(f.mgmt_fee)}</b> +
        托管费 <b>${pct0(f.custody_fee)}</b> + 销售服务费 <b>${pct0(f.sales_fee)}</b>
        = 合计 <b>${f.fee_total != null ? Number(f.fee_total).toFixed(2) + "%" : "—"}</b>
      </div>
      <table class="mini-table"><thead><tr><th>日期</th><th>申购</th><th>赎回</th></tr></thead><tbody>
        ${(f.history || []).map((h) => `<tr>
          <td>${esc(h.date)}</td>
          <td><span class="bdg ${statusCls(h.status)}">${h.status || "—"}</span></td>
          <td><span class="bdg ${statusCls(h.redeem)}">${h.redeem || "—"}</span></td>
        </tr>`).join("")}
      </tbody></table>
    </div></td></tr>`;
  }

  function renderTable() {
    const arr = filtered();
    const vis = visible();
    $("#tbody").innerHTML = arr.map((f) =>
      `<tr data-code="${esc(f.code)}">${vis.map((k) => cell(f, k)).join("")}</tr>` +
      (state.expanded === f.code ? detailRow(f) : "")
    ).join("");
    $("#empty").hidden = arr.length !== 0;
  }

  function renderChanges() {
    const ch = state.changes || [];
    $("#changes").innerHTML = ch.length
      ? ch.map((c) => `
        <div class="change">
          <div><span class="d">${esc(c.date)}</span> <span class="fl">${c.field === "status" ? "申购" : "赎回"}</span></div>
          <div class="n">${esc(c.name)}</div>
          <div><span class="from">${esc(c.old_val || "—")}</span> <span class="arrow">→</span> <span class="to">${esc(c.new_val)}</span></div>
        </div>`).join("")
      : `<div class="empty">近期暂无状态变更</div>`;
  }

  function renderColMenu() {
    $("#colMenu").innerHTML =
      `<div class="col-menu-head">
         <span>列顺序（勾选=显示，可拖动排序）</span>
         <button class="col-reset" id="colReset">恢复默认</button>
       </div>` +
      state.order.map((k, i) => {
        const c = COLS.find((x) => x.key === k);
        const shown = !state.hidden.has(k);
        return `<div class="col-item" draggable="true" data-k="${k}">
          <span class="col-drag" title="拖动排序">⠿</span>
          <input type="checkbox" data-k="${k}" ${shown ? "checked" : ""} />
          <span class="col-label">${c.label}</span>
          <button class="col-mv" data-k="${k}" data-d="-1" title="前移" ${i === 0 ? "disabled" : ""}>◀</button>
          <button class="col-mv" data-k="${k}" data-d="1" title="后移" ${i === state.order.length - 1 ? "disabled" : ""}>▶</button>
        </div>`;
      }).join("");

    // 拖动排序
    $("#colMenu").querySelectorAll(".col-item").forEach((item) => {
      item.addEventListener("dragstart", () => { state.dragKey = item.dataset.k; item.classList.add("dragging"); });
      item.addEventListener("dragend", () => { state.dragKey = null; item.classList.remove("dragging"); });
      item.addEventListener("dragover", (e) => { e.preventDefault(); item.classList.add("drag-over"); });
      item.addEventListener("dragleave", () => item.classList.remove("drag-over"));
      item.addEventListener("drop", (e) => {
        e.preventDefault();
        item.classList.remove("drag-over");
        if (!state.dragKey) return;
        const from = state.order.indexOf(state.dragKey);
        const to = state.order.indexOf(item.dataset.k);
        if (from < 0 || to < 0 || from === to) return;
        const arr = state.order.slice();
        arr.splice(from, 1);
        arr.splice(to, 0, state.dragKey);
        state.order = arr;
        persist();
        renderHead(); renderTable(); renderColMenu();
      });
    });
  }

  function renderAll() {
    renderStats();
    renderHead();
    renderTable();
    renderChanges();
    if (state.updatedAt) $("#updatedAt").textContent = "更新于 " + state.updatedAt;
  }

  async function load() {
    try {
      const res = await fetch("data/data.json", { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const d = await res.json();
      state.funds = d.funds || [];
      state.changes = d.recent_changes || [];
      state.notify = d.notify || null;
      state.updatedAt = d.updated_at || d.generated_at;
      renderAll();
      if (!$("#subModal").hidden) renderSubStatus();
    } catch (e) {
      $("#updatedAt").textContent = "加载失败，请用本地服务器打开（见 README）";
      $("#updatedAt").classList.add("updated-fail");
      console.error(e);
    }
  }

  function applyTheme() {
    document.documentElement.setAttribute("data-theme", state.theme);
    localStorage.setItem("theme", state.theme);
  }

  const AUTO_MS = 12 * 60 * 60 * 1000; // 12 小时
  function startAuto() {
    clearInterval(state.timer);
    state.timer = setInterval(load, AUTO_MS);
    $("#updatedAt").title = "每 12 小时自动刷新一次";
  }

  // events
  $("#themeBtn").addEventListener("click", () => {
    state.theme = state.theme === "dark" ? "light" : "dark";
    applyTheme();
  });
  $("#refreshBtn").addEventListener("click", load);

  $("#colBtn").addEventListener("click", () => {
    const m = $("#colMenu");
    m.hidden = !m.hidden;
    if (!m.hidden) renderColMenu();
  });
  $("#colMenu").addEventListener("click", (e) => {
    const mv = e.target.closest(".col-mv");
    if (mv) {
      const k = mv.dataset.k;
      const i = state.order.indexOf(k);
      const j = i + Number(mv.dataset.d);
      if (j < 0 || j >= state.order.length) return;
      const arr = state.order.slice();
      arr.splice(i, 1);
      arr.splice(j, 0, k);
      state.order = arr;
      persist();
      renderHead(); renderTable(); renderColMenu();
      return;
    }
    const chk = e.target.closest('input[type="checkbox"]');
    if (chk) {
      const k = chk.dataset.k;
      if (chk.checked) state.hidden.delete(k); else state.hidden.add(k);
      persist();
      renderHead(); renderTable();
      return;
    }
    if (e.target.closest("#colReset")) {
      state.order = DEFAULT_ORDER.slice();
      state.hidden = new Set();
      persist();
      renderHead(); renderTable(); renderColMenu();
    }
  });

  document.querySelectorAll("#indexTabs .tab").forEach((t) => {
    t.addEventListener("click", () => {
      state.index = t.dataset.index;
      document.querySelectorAll("#indexTabs .tab").forEach((x) => x.classList.toggle("active", x === t));
      renderTable();
    });
  });
  $("#search").addEventListener("input", (e) => { state.q = e.target.value; renderTable(); });

  $("#ftable").addEventListener("click", (e) => {
    const th = e.target.closest("th[data-sort]");
    if (th) {
      const k = th.dataset.sort;
      if (state.sort.key === k) state.sort.dir = state.sort.dir === "asc" ? "desc" : "asc";
      else state.sort = { key: k, dir: "asc" };
      renderHead(); renderTable();
      return;
    }
    const tr = e.target.closest("tr[data-code]");
    if (tr) {
      const code = tr.dataset.code;
      state.expanded = state.expanded === code ? null : code;
      renderTable();
    }
  });

  // ---- 邮箱订阅 ----
  const SUB_EMAIL_KEY = "notifyEmail";
  function buildSubConfig(email) {
    const em = email ? JSON.stringify(email) : '"you@example.com"';
    return `{
  "notify": {
    "enabled": true,
    "emails": [${em}],
    "smtp_host": "smtp.example.com",
    "smtp_port": 465,
    "smtp_user": "you@example.com",
    "smtp_password": "your-smtp-password-or-app-code",
    "smtp_security": "ssl"
  }
}`;
  }
  function renderSubStatus() {
    const n = state.notify || {};
    const mail = $("#subEmail").value.trim();
    const parts = [];
    if (mail) parts.push(`本浏览器已记录：<b>${esc(mail)}</b>`);
    if (n.enabled) {
      parts.push(`服务端已启用，接收 <b>${(n.emails && n.emails.length) ? n.emails.map(esc).join("、") : "?"}</b>`);
      parts.push(`上次检查 <b>${esc(n.last_checked || "—")}</b>`);
      if (n.last_sent) parts.push(`上次发送 <b>${esc(n.last_sent)}</b>（${n.last_change_count || 0} 处变化）`);
      if (n.last_error) parts.push(`<span class="warn-text">上次发送失败：${esc(n.last_error)}</span>`);
    } else {
      parts.push('服务端尚未配置邮件，需按下方说明开启后才会真正发送提醒。');
    }
    $("#subStatus").innerHTML = parts.join("<br>");
  }
  function openSub() {
    const el = $("#subEmail");
    if (!el.value) el.value = localStorage.getItem(SUB_EMAIL_KEY) || "";
    el.classList.remove("input-err");
    $("#subConfig").textContent = buildSubConfig(el.value.trim());
    renderSubStatus();
    $("#subModal").hidden = false;
    el.focus();
  }
  function closeSub() { $("#subModal").hidden = true; }

  $("#subBtn").addEventListener("click", openSub);
  $("#subClose").addEventListener("click", closeSub);
  $("#subModal").addEventListener("click", (e) => { if (e.target === $("#subModal")) closeSub(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#subModal").hidden) closeSub(); });

  $("#subSave").addEventListener("click", () => {
    const v = $("#subEmail").value.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) {
      $("#subEmail").classList.add("input-err");
      $("#subEmail").focus();
      return;
    }
    localStorage.setItem(SUB_EMAIL_KEY, v);
    $("#subEmail").classList.remove("input-err");
    $("#subConfig").textContent = buildSubConfig(v);
    renderSubStatus();
  });
  $("#subUnsub").addEventListener("click", () => {
    localStorage.removeItem(SUB_EMAIL_KEY);
    $("#subEmail").value = "";
    $("#subConfig").textContent = buildSubConfig("");
    renderSubStatus();
  });
  $("#subEmail").addEventListener("input", () => {
    $("#subEmail").classList.remove("input-err");
    $("#subConfig").textContent = buildSubConfig($("#subEmail").value.trim());
  });
  $("#subCopy").addEventListener("click", async () => {
    const txt = $("#subConfig").textContent;
    try {
      await navigator.clipboard.writeText(txt);
      $("#subCopy").textContent = "已复制 ✓";
      setTimeout(() => { $("#subCopy").textContent = "复制配置"; }, 1200);
    } catch (e) {
      const ta = $("#subConfig");
      ta.select();
      document.execCommand("copy");
    }
  });

  applyTheme();
  load();
  startAuto();
})();
