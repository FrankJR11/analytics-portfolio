/* ==========================================================================
   Supply Chain Dashboard — all computation happens client-side on the
   pre-aggregated tables in assets/scm-data.js (built by
   pipeline/build_scm_dashboard_data.py).
   ========================================================================== */
(function () {
  "use strict";

  var D = window.SCM;
  if (!D) {
    document.querySelector(".dash-main .wrap").innerHTML =
      '<div class="panel"><p class="nodata">scm-data.js not found. Run <span class="mono">python pipeline/build_scm_dashboard_data.py</span> and reload.</p></div>';
    return;
  }

  /* ---------------- helpers (same conventions as the O2C dashboard) ---------------- */
  var cache = {};
  function rows(name) {
    if (cache[name]) return cache[name];
    var t = D[name], out = [];
    for (var i = 0; i < t.rows.length; i++) {
      var o = {}, r = t.rows[i];
      for (var j = 0; j < t.cols.length; j++) o[t.cols[j]] = r[j];
      out.push(o);
    }
    return (cache[name] = out);
  }
  function money(v) {
    var a = Math.abs(v || 0), s = v < 0 ? "-" : "";
    if (a >= 1e9) return s + "$" + (a / 1e9).toFixed(2) + "B";
    if (a >= 1e6) return s + "$" + (a / 1e6).toFixed(1) + "M";
    if (a >= 1e3) return s + "$" + Math.round(a / 1e3).toLocaleString() + "K";
    return s + "$" + Math.round(a).toLocaleString();
  }
  function num(v) { return Math.round(v || 0).toLocaleString(); }
  function pct1(x) { return x == null ? "—" : (x * 100).toFixed(1) + "%"; }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function sum(arr, key) { var t = 0; for (var i = 0; i < arr.length; i++) t += (arr[i][key] || 0); return t; }
  function el(id) { return document.getElementById(id); }

  var css = getComputedStyle(document.documentElement);
  function cv(n) { return css.getPropertyValue(n).trim(); }
  var C = { ink: cv("--ink"), muted: cv("--muted"), line: cv("--line"),
            petrol: cv("--petrol"), petrolDeep: cv("--petrol-deep"), blue: cv("--blue"),
            amber: cv("--amber"), red: cv("--red"), good: cv("--good"), soft: "#7fa8c9" };
  var CAT_COLORS = {
    "Packaging & Additives": C.red, "Raw Materials": C.petrol,
    "Spare Parts & MRO": C.amber, "Safety & Compliance": C.blue,
  };

  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var hasChart = typeof Chart !== "undefined";
  if (hasChart) {
    Chart.defaults.font.family = '"IBM Plex Mono", monospace';
    Chart.defaults.font.size = 10.5;
    Chart.defaults.color = C.muted;
    Chart.defaults.animation = reduce ? false : { duration: 400 };
  }
  var charts = {};
  function drawChart(id, cfg) {
    if (!hasChart) { el(id).outerHTML = '<p class="nodata">Chart library unavailable (offline?) — data table views still work.</p>'; return; }
    if (charts[id]) charts[id].destroy();
    charts[id] = new Chart(el(id), cfg);
  }

  /* ---------------- filter state ---------------- */
  var F = { r: "All", c: "All", y: "All" };
  var M = D.meta;
  var DEAD_BUCKETS = ["6-11mo", "12mo+"];

  function inScopeRC(row) {
    return (F.r === "All" || row.region === F.r) && (F.c === "All" || row.category === F.c);
  }
  function inScopeM(row) { return inScopeRC(row) && (F.y === "All" || row.m.slice(0, 4) === F.y); }
  function inScopeY(row) { return inScopeRC(row) && (F.y === "All" || String(row.y) === F.y); }
  function monthsInScope() {
    if (F.y === "All") return M.months;
    return M.months.filter(function (m) { return m.slice(0, 4) === F.y; });
  }
  function scopeLabel() {
    var parts = [];
    if (F.r !== "All") parts.push(F.r);
    if (F.c !== "All") parts.push(F.c);
    parts.push(F.y === "All" ? "2023–2025" : F.y);
    return parts.join(" · ");
  }
  function last3Months(endMonth) {
    var idx = M.months.indexOf(endMonth);
    return M.months.slice(Math.max(0, idx - 2), idx + 1);
  }
  function dioAt(endMonth, regionFilter, categoryFilter) {
    var last3 = last3Months(endMonth);
    var invRows = rows("invmonthly").filter(function (r) {
      return r.m === endMonth && (regionFilter === "All" || r.region === regionFilter)
        && (categoryFilter === "All" || r.category === categoryFilter);
    });
    var demRows = rows("monthly").filter(function (r) {
      return last3.indexOf(r.m) >= 0 && (regionFilter === "All" || r.region === regionFilter)
        && (categoryFilter === "All" || r.category === categoryFilter);
    });
    var invVal = sum(invRows, "on_hand_value");
    var b90 = sum(demRows, "demand_value");
    return b90 > 0 ? (invVal / b90 * 90) : null;
  }

  /* ---------------- UI atoms (identical to the O2C dashboard) ---------------- */
  function kpiCard(label, value, sub, subClass) {
    return '<div class="kpi' + (subClass ? ' tone-' + subClass : '') + '"><div class="k-label">' + esc(label) + '</div>' +
           '<div class="k-value">' + value + '</div>' +
           '<div class="k-sub ' + (subClass || "") + '">' + sub + '</div></div>';
  }
  function hbar(label, valueTxt, widthPct, color) {
    return '<div class="hbar-row"><span class="lab" title="' + esc(label) + '">' + esc(label) + '</span>' +
      '<span class="track"><span class="fill" style="width:' + Math.max(widthPct, 1.5) + '%; background:' + color + ';"></span></span>' +
      '<span class="val">' + valueTxt + '</span></div>';
  }
  function statusPill(state, txtOn, txtRisk, txtOff) {
    if (state === "on") return '<span class="pill pill-good">' + (txtOn || "on target") + '</span>';
    if (state === "risk") return '<span class="pill pill-risk">' + (txtRisk || "at risk") + '</span>';
    return '<span class="pill pill-off">' + (txtOff || "off target") + '</span>';
  }
  function banner(id, tone, html) {
    var b = el(id);
    b.className = "insight-banner tone-" + tone;
    b.innerHTML = '<span class="ic">▸</span><span>' + html + '</span>';
  }

  /* ======================================================================
     PAGE 1 — Executive summary
     ====================================================================== */
  function renderP1() {
    var months = monthsInScope();
    var lastM = months[months.length - 1];
    var mrows = rows("monthly").filter(inScopeM);

    var invRows = rows("invmonthly").filter(function (r) { return r.m === lastM && inScopeRC(r); });
    var invVal = sum(invRows, "on_hand_value");
    var dio = dioAt(lastM, F.r, F.c);

    var demandN = sum(mrows, "demand_qty"), fulfilledN = sum(mrows, "fulfilled_qty");
    var fillRate = demandN > 0 ? fulfilledN / demandN : null;

    var otifRows = rows("otifmonthly").filter(inScopeM);
    var otifPoN = sum(otifRows, "po_n");
    var otif = otifPoN > 0 ? sum(otifRows, "ontime_infull_n") / otifPoN : null;

    var agRows = rows("agingbuckets").filter(inScopeRC);
    var totAging = sum(agRows, "value");
    var deadAging = sum(agRows.filter(function (r) { return DEAD_BUCKETS.indexOf(r.bucket) >= 0; }), "value");
    var deadPct = totAging > 0 ? deadAging / totAging : null;

    el("filterEcho").textContent = num(demandN) + " units of demand in scope";

    el("p1Kpis").innerHTML =
      kpiCard("Inventory value", money(invVal), "at " + lastM + " month-end", "") +
      kpiCard("Fill rate", fillRate != null ? pct1(fillRate) : "—",
        fillRate != null ? (fillRate < 0.98 ? "▼ " + ((0.98 - fillRate) * 100).toFixed(1) + "pp below 98% target" : "meets 98% target") : "—",
        fillRate != null && fillRate < 0.98 ? "down" : "up") +
      kpiCard("Supplier OTIF", otif != null ? pct1(otif) : "—",
        otif != null ? (otif < 0.85 ? "▼ " + ((0.85 - otif) * 100).toFixed(1) + "pp below 85% target" : "meets 85% target") : "—",
        otif != null && otif < 0.85 ? "down" : "up") +
      kpiCard("Dead / excess stock", money(deadAging),
        deadPct != null ? pct1(deadPct) + " of inventory · target ≤ 8%" : "—",
        deadPct != null && deadPct > 0.08 ? "warn" : "up");

    /* banner — which category is driving the worst numbers */
    var byCatAging = {};
    agRows.filter(function (r) { return DEAD_BUCKETS.indexOf(r.bucket) >= 0; }).forEach(function (r) {
      byCatAging[r.category] = (byCatAging[r.category] || 0) + r.value;
    });
    var byCatOtif = {}, byCatOtifN = {};
    otifRows.forEach(function (r) {
      byCatOtif[r.category] = (byCatOtif[r.category] || 0) + r.ontime_infull_n;
      byCatOtifN[r.category] = (byCatOtifN[r.category] || 0) + r.po_n;
    });
    var worstOtifCat = null, worstOtifVal = 1;
    Object.keys(byCatOtifN).forEach(function (c) {
      if (byCatOtifN[c] >= 20) {
        var v = byCatOtif[c] / byCatOtifN[c];
        if (v < worstOtifVal) { worstOtifVal = v; worstOtifCat = c; }
      }
    });
    var topDeadCat = Object.keys(byCatAging).sort(function (a, b) { return byCatAging[b] - byCatAging[a]; })[0];

    if (!demandN) {
      banner("p1Banner", "info", "No activity matches the current filters.");
    } else if (F.c === "All" && (topDeadCat || worstOtifCat)) {
      var parts = [];
      if (worstOtifCat) parts.push(esc(worstOtifCat) + " OTIF is " + pct1(worstOtifVal) + " — the weak link in supplier reliability");
      if (topDeadCat) parts.push(esc(topDeadCat) + " holds " + money(byCatAging[topDeadCat]) + " in dead stock (" + pct1(byCatAging[topDeadCat] / (totAging || 1)) + " of inventory)");
      banner("p1Banner", deadPct > 0.08 || worstOtifVal < 0.7 ? "red" : "amber",
        "<strong>Two separate problems, two separate categories:</strong> " + parts.join("; while ") + ".");
    } else {
      banner("p1Banner", deadPct > 0.08 ? "red" : otif != null && otif < 0.85 ? "amber" : "good",
        "<strong>" + scopeLabel() + ":</strong> fill rate " + pct1(fillRate) + ", OTIF " + pct1(otif) +
        ", dead stock " + money(deadAging) + (deadPct != null ? " (" + pct1(deadPct) + " of inventory)" : "") + ".");
    }

    /* trend chart — inventory value */
    var vm = {};
    rows("invmonthly").filter(inScopeRC).forEach(function (r) { vm[r.m] = (vm[r.m] || 0) + r.on_hand_value; });
    el("p1TrendHint").textContent = "US$M · " + scopeLabel();
    drawChart("chTrend", {
      type: "line",
      data: {
        labels: months.map(function (m) { return F.y === "All" ? m : m.slice(5); }),
        datasets: [{
          label: "Inventory value", data: months.map(function (m) { return (vm[m] || 0) / 1e6; }),
          borderColor: C.petrol, backgroundColor: "rgba(14,107,92,0.07)",
          borderWidth: 2, pointRadius: 0, tension: 0.3, fill: true,
        }],
      },
      options: {
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: function (ctx) { return "$" + ctx.parsed.y.toFixed(1) + "M"; } } } },
        scales: { x: { grid: { display: false }, border: { color: C.line }, ticks: { maxTicksLimit: 12 } },
                  y: { grid: { color: "rgba(20,38,46,0.06)" }, border: { display: false }, ticks: { callback: function (v) { return "$" + v + "M"; } } } },
      },
    });

    /* regional heatmap */
    var html = '<table class="dtable"><thead><tr><th>Region</th><th class="num">Inventory $</th><th class="num">DIO</th><th class="num">Fill Rate%</th><th class="num">Dead%</th></tr></thead><tbody>';
    M.regions.forEach(function (rg) {
      var mr = rows("monthly").filter(function (r) { return r.region === rg && (F.c === "All" || r.category === F.c) && (F.y === "All" || r.m.slice(0, 4) === F.y); });
      var dN = sum(mr, "demand_qty");
      if (!dN) { html += "<tr><td>" + esc(rg) + '</td><td class="num" colspan="4">—</td></tr>'; return; }
      var fR = sum(mr, "fulfilled_qty") / dN;
      var invR = sum(rows("invmonthly").filter(function (r) { return r.region === rg && r.m === lastM && (F.c === "All" || r.category === F.c); }), "on_hand_value");
      var dioR = dioAt(lastM, rg, F.c);
      var agR = rows("agingbuckets").filter(function (r) { return r.region === rg && (F.c === "All" || r.category === F.c); });
      var totR = sum(agR, "value");
      var deadR = sum(agR.filter(function (r) { return DEAD_BUCKETS.indexOf(r.bucket) >= 0; }), "value");
      var deadPctR = totR ? deadR / totR : null;
      function cls(v, good, risk, invert) {
        if (v == null) return "";
        var ok = invert ? v <= good : v >= good;
        var nr = invert ? v <= risk : v >= risk;
        return ok ? "cell-good" : nr ? "cell-risk" : "cell-off";
      }
      html += "<tr><td>" + esc(rg) + "</td>" +
        '<td class="num">' + money(invR) + "</td>" +
        '<td class="num ' + cls(dioR, 90, 105, true) + '">' + (dioR != null ? dioR.toFixed(0) : "—") + "</td>" +
        '<td class="num ' + cls(fR, 0.98, 0.94, false) + '">' + pct1(fR) + "</td>" +
        '<td class="num ' + cls(deadPctR, 0.08, 0.12, true) + '">' + (deadPctR != null ? pct1(deadPctR) : "—") + "</td></tr>";
    });
    html += "</tbody></table><p class='small' style='margin:10px 0 0;'>Category &amp; year filters apply · DIO measured at " + esc(lastM) + " month-end · aging is an as-of snapshot (year filter n/a there).</p>";
    el("p1Heatmap").innerHTML = html;

    /* dead stock by category bars */
    el("p1DeadHint").textContent = "as of " + M.as_of + (F.r !== "All" ? " · " + F.r : "") + " · year filter n/a";
    var cats = Object.keys(byCatAging).sort(function (a, b) { return byCatAging[b] - byCatAging[a]; });
    var maxV = cats.length ? byCatAging[cats[0]] : 0;
    el("p1DeadBars").innerHTML = cats.length
      ? cats.map(function (c) { return hbar(c, money(byCatAging[c]), byCatAging[c] / maxV * 100, CAT_COLORS[c] || C.petrol); }).join("")
      : '<p class="nodata">No dead stock in scope.</p>';
  }

  /* ======================================================================
     PAGE 2 — Supply & demand
     ====================================================================== */
  function renderP2() {
    var f = rows("funnel").filter(inScopeY);
    var st = { on: sum(f, "ordered_n"), ov: sum(f, "ordered_v"), rn: sum(f, "received_n"), rv: sum(f, "received_v"),
               otn: sum(f, "otif_n"), otv: sum(f, "otif_v") };

    if (!st.on) {
      banner("p2Banner", "info", "No purchase orders match the current filters.");
      el("p2Funnel").innerHTML = '<p class="nodata">—</p>';
    } else {
      var missedPct = 1 - st.otn / st.on;
      banner("p2Banner", missedPct > 0.45 ? "red" : missedPct > 0.25 ? "amber" : "good",
        "<strong>" + pct1(missedPct) + " of purchase orders in " + scopeLabel() + " arrived late, short, or not at all</strong> — " +
        money(st.ov - st.otv) + " of order value never landed on-time-and-in-full.");

      var stages = [
        ["Ordered", st.on, st.ov, C.petrolDeep, "#ffffff"],
        ["Received", st.rn, st.rv, C.petrol, "#ffffff"],
        ["On-time & in-full", st.otn, st.otv, C.blue, "#ffffff"],
      ];
      el("p2FunnelHint").textContent = scopeLabel();
      el("p2Funnel").innerHTML = stages.map(function (s, i) {
        var p = s[1] / st.on;
        return '<div class="funnel-stage" style="padding-left:' + (i * 7) + '%;">' +
          '<div class="bar" style="width:' + Math.max(p * (100 - i * 7), 26) + '%; background:' + s[3] + "; color:" + s[4] + ';">' +
          "<span><strong>" + s[0] + ": " + num(s[1]) + "</strong> POs</span>" +
          '<span class="mono">' + money(s[2]) + " · " + pct1(p) + "</span></div></div>";
      }).join("") +
      '<p class="small" style="margin:10px 0 0;">"On-time &amp; in-full" requires both the delivery date and the received quantity to meet the order — a shipment that arrives complete but late still counts as missed.</p>';
    }

    /* stacked: missed-OTIF value by region, stacked by category (from funnel, year-scoped) */
    var fRows = rows("funnel").filter(function (r) { return F.y === "All" || String(r.y) === F.y; });
    var byReg = {};
    M.regions.forEach(function (rg) { byReg[rg] = {}; });
    fRows.forEach(function (r) {
      if (F.c !== "All" && r.category !== F.c) return;
      var missed = Math.max(0, r.received_v - r.otif_v);
      byReg[r.region][r.category] = (byReg[r.region][r.category] || 0) + missed;
    });
    var catsAll = M.categories;
    var maxTot = Math.max.apply(null, M.regions.map(function (rg) {
      return catsAll.reduce(function (t, c) { return t + (byReg[rg][c] || 0); }, 0);
    }).concat([1]));
    el("p2Stacked").innerHTML = M.regions.map(function (rg) {
      var tot = catsAll.reduce(function (t, c) { return t + (byReg[rg][c] || 0); }, 0);
      var segs = catsAll.map(function (c) {
        var w = (byReg[rg][c] || 0) / maxTot * 100;
        return w ? '<span class="seg" title="' + esc(c) + ": " + money(byReg[rg][c]) + '" style="width:' + w + "%; background:" + CAT_COLORS[c] + ';"></span>' : "";
      }).join("");
      return '<div class="stack-row"><span class="lab">' + esc(rg) + '</span><span class="track">' + segs + '</span><span class="val" style="font-family:var(--mono); font-size:12px; text-align:right;">' + money(tot) + "</span></div>";
    }).join("") +
    '<div class="legend">' + catsAll.map(function (c) {
      return '<span class="li"><span class="sw" style="background:' + CAT_COLORS[c] + ';"></span>' + esc(c) + "</span>";
    }).join("") + "</div>";

    /* avg delay trend */
    var months = monthsInScope();
    var ds = {}, dn = {};
    rows("otifmonthly").filter(inScopeM).forEach(function (r) {
      ds[r.m] = (ds[r.m] || 0) + r.delay_sum; dn[r.m] = (dn[r.m] || 0) + r.po_n;
    });
    var delaySeries = months.map(function (m) { return dn[m] ? +(ds[m] / dn[m]).toFixed(1) : null; });
    drawChart("chDelay", {
      type: "line",
      data: {
        labels: months.map(function (m) { return F.y === "All" ? m : m.slice(5); }),
        datasets: [
          { label: "Avg delay (days)", data: delaySeries, borderColor: C.blue, borderWidth: 2, pointRadius: 2, tension: 0.25 },
          { label: "Target 3d", data: months.map(function () { return 3; }), borderColor: C.red, borderDash: [4, 4], borderWidth: 1, pointRadius: 0 },
        ],
      },
      options: {
        maintainAspectRatio: false,
        plugins: { legend: { labels: { boxWidth: 10 } } },
        scales: { x: { grid: { display: false }, border: { color: C.line }, ticks: { maxTicksLimit: 12 } },
                  y: { grid: { color: "rgba(20,38,46,0.06)" }, border: { display: false }, suggestedMin: 0 } },
      },
    });

    /* least reliable suppliers table */
    var sup = rows("suppliers").filter(function (r) {
      return (F.r === "All" || r.region === F.r) && (F.c === "All" || r.category === F.c) && r.closed_n >= 15;
    }).sort(function (a, b) { return (a.otif_pct || 0) - (b.otif_pct || 0); }).slice(0, 6);
    el("p2Suppliers").innerHTML = sup.length
      ? '<table class="dtable"><thead><tr><th>Supplier</th><th>Region</th><th>Category</th><th class="num">OTIF</th><th class="num">Avg delay</th><th class="num">POs</th><th></th></tr></thead><tbody>' +
        sup.map(function (r) {
          return "<tr><td>" + esc(r.supplier_name) + "</td><td>" + esc(r.region) + "</td><td>" + esc(r.category) + "</td>" +
            '<td class="num" style="color:' + (r.otif_pct < 0.7 ? C.red : C.amber) + ';">' + pct1(r.otif_pct) + "</td>" +
            '<td class="num">' + r.avg_delay_days + "d</td><td class=\"num\">" + num(r.closed_n) + "</td>" +
            '<td class="num"><a href="#" data-sup="' + esc(r.supplier_id) + '">360 →</a></td></tr>';
        }).join("") + "</tbody></table>"
      : '<p class="nodata">No suppliers with enough volume in scope.</p>';
  }

  /* ======================================================================
     PAGE 3 — Inventory health
     ====================================================================== */
  function renderP3() {
    var months = monthsInScope();
    var lastM = months[months.length - 1];

    var invRows = rows("invmonthly").filter(function (r) { return r.m === lastM && inScopeRC(r); });
    var invVal = sum(invRows, "on_hand_value");
    var dio = dioAt(lastM, F.r, F.c);

    var invExMro = sum(rows("invmonthly").filter(function (r) { return r.m === lastM && r.category !== "Spare Parts & MRO" && (F.r === "All" || r.region === F.r); }), "on_hand_value");
    var last3 = last3Months(lastM);
    var b90ExMro = sum(rows("monthly").filter(function (r) { return last3.indexOf(r.m) >= 0 && r.category !== "Spare Parts & MRO" && (F.r === "All" || r.region === F.r); }), "demand_value");
    var dioExMro = (F.c === "All" || F.c !== "Spare Parts & MRO") && b90ExMro > 0 ? invExMro / b90ExMro * 90 : null;

    var agRows = rows("agingbuckets").filter(inScopeRC);
    var totAging = sum(agRows, "value");
    var deadAging = sum(agRows.filter(function (r) { return DEAD_BUCKETS.indexOf(r.bucket) >= 0; }), "value");
    var deadPct = totAging > 0 ? deadAging / totAging : null;

    el("p3Kpis").innerHTML =
      kpiCard("DIO (days)", dio != null ? dio.toFixed(0) : "—",
        "at " + lastM + " · target ≤ 90", dio != null && dio > 90 ? "down" : "up") +
      kpiCard("DIO excl. Spare Parts & MRO", dioExMro != null ? dioExMro.toFixed(0) : "—",
        dioExMro != null ? "the fast-moving categories alone" : "category filter is MRO — n/a", "") +
      kpiCard("Dead / excess stock", money(deadAging), pct1(deadPct) + " of inventory in scope", "") +
      kpiCard("Inventory value", money(invVal), "at " + lastM + " month-end", "");

    var byCat = {};
    agRows.filter(function (r) { return DEAD_BUCKETS.indexOf(r.bucket) >= 0; }).forEach(function (r) {
      byCat[r.category] = (byCat[r.category] || 0) + r.value;
    });
    if (!totAging) {
      banner("p3Banner", "info", "No inventory matches the current filters.");
    } else {
      var topCat = Object.keys(byCat).sort(function (a, b) { return byCat[b] - byCat[a]; })[0];
      banner("p3Banner", deadPct > 0.08 ? "red" : "good",
        "<strong>DIO is " + (dio != null ? dio.toFixed(0) : "—") + " days against a 90-day target" +
        (dioExMro != null && Math.round(dioExMro) !== Math.round(dio) ? " — excluding Spare Parts &amp; MRO it drops to " + dioExMro.toFixed(0) + "d" : "") + ".</strong>" +
        (topCat ? " " + esc(topCat) + " accounts for " + pct1(byCat[topCat] / (deadAging || 1)) + " of all dead stock (" + money(byCat[topCat]) + ")." : ""));
    }

    /* DIO by category trend */
    el("p3DioHint").textContent = (F.r !== "All" ? F.r + " · " : "") + "target 90d";
    var dsSets = M.categories.map(function (c) {
      return {
        label: c, borderColor: CAT_COLORS[c], borderWidth: 1.8, pointRadius: 0, tension: 0.25,
        data: months.map(function (m) { return dioAt(m, F.r, c); }),
      };
    });
    dsSets.push({ label: "Target 90d", data: months.map(function () { return 90; }), borderColor: C.ink, borderDash: [4, 4], borderWidth: 1, pointRadius: 0 });
    drawChart("chDio", {
      type: "line",
      data: { labels: months.map(function (m) { return F.y === "All" ? m : m.slice(5); }), datasets: dsSets },
      options: {
        maintainAspectRatio: false,
        plugins: { legend: { labels: { boxWidth: 10 } } },
        scales: { x: { grid: { display: false }, border: { color: C.line }, ticks: { maxTicksLimit: 12 } },
                  y: { grid: { color: "rgba(20,38,46,0.06)" }, border: { display: false } } },
      },
    });

    /* aging bars */
    el("p3AgingHint").textContent = "as of " + M.as_of + " · year filter n/a";
    var buckets = ["0-2mo", "3-5mo", "6-11mo", "12mo+"];
    var bColors = { "0-2mo": C.soft, "3-5mo": C.blue, "6-11mo": C.amber, "12mo+": C.red };
    var bv = {}, bn = {};
    agRows.forEach(function (r) { bv[r.bucket] = (bv[r.bucket] || 0) + r.value; bn[r.bucket] = (bn[r.bucket] || 0) + r.n; });
    var maxB = Math.max.apply(null, buckets.map(function (b) { return bv[b] || 0; }).concat([1]));
    el("p3Aging").innerHTML = buckets.map(function (b) {
      var lbl = b === "0-2mo" ? "0–2 months (active)" : b.replace("mo", " months") + " since last demand";
      return hbar(lbl, money(bv[b] || 0) + " · " + num(bn[b] || 0), (bv[b] || 0) / maxB * 100, bColors[b]);
    }).join("");

    /* top dead stock */
    var dead = rows("deadstock_top").filter(inScopeRC).slice(0, 6);
    el("p3Dead").innerHTML = dead.length
      ? '<table class="dtable"><thead><tr><th>SKU</th><th>Warehouse</th><th class="num">Value</th><th class="num">Months idle</th></tr></thead><tbody>' +
        dead.map(function (r) {
          return "<tr><td>" + esc(r.product_name) + '<div class="small">' + esc(r.category) + "</div></td><td>" + esc(r.warehouse_name) + "</td>" +
            '<td class="num">' + money(r.on_hand_value_usd) + '</td><td class="num" style="color:' + C.red + ';">' + r.months_since_last_demand + "mo</td></tr>";
        }).join("") + "</tbody></table>"
      : '<p class="nodata">No dead-stock items in scope.</p>';

    /* donut */
    el("p3DonutHint").textContent = F.r !== "All" ? F.r : "all regions";
    var cats = Object.keys(byCat).sort(function (a, b) { return byCat[b] - byCat[a]; });
    if (cats.length) {
      drawChart("chDonut", {
        type: "doughnut",
        data: { labels: cats, datasets: [{ data: cats.map(function (c) { return byCat[c]; }), backgroundColor: cats.map(function (c) { return CAT_COLORS[c]; }), borderWidth: 0 }] },
        options: { maintainAspectRatio: false, cutout: "62%", plugins: { legend: { display: false } } },
      });
      var totC = cats.reduce(function (t, c) { return t + byCat[c]; }, 0);
      el("p3DonutLegend").innerHTML = cats.map(function (c) {
        return '<div class="legend" style="margin:0 0 6px;"><span class="li"><span class="sw" style="background:' + CAT_COLORS[c] +
          ';"></span>' + esc(c) + ' <span class="mono" style="color:var(--muted);">' + pct1(byCat[c] / totC) + " · " + money(byCat[c]) + "</span></span></div>";
      }).join("");
    } else {
      if (charts["chDonut"]) { charts["chDonut"].destroy(); delete charts["chDonut"]; }
      el("p3DonutLegend").innerHTML = '<p class="nodata">No dead stock in scope.</p>';
    }
  }

  /* ======================================================================
     PAGE 4 — Supplier 360
     ====================================================================== */
  var supIndex = {};
  function initP4() {
    var sups = rows("suppliers");
    var dl = el("supList");
    var opts = "";
    sups.forEach(function (r) { supIndex[r.supplier_id] = r; opts += '<option value="' + esc(r.supplier_id + " — " + r.supplier_name) + '"></option>'; });
    dl.innerHTML = opts;

    var worst = sups.filter(function (r) { return r.closed_n >= 15; }).sort(function (a, b) { return (a.otif_pct || 0) - (b.otif_pct || 0); })[0];
    var big = sups.slice().sort(function (a, b) { return b.spend_value - a.spend_value; })[0];
    var cancelled = sups.slice().sort(function (a, b) { return b.cancelled_n - a.cancelled_n; })[0];

    el("qWorstOtif").onclick = function () { pick(worst.supplier_id); };
    el("qBiggestSpend").onclick = function () { pick(big.supplier_id); };
    el("qMostCancelled").onclick = function () { pick(cancelled.supplier_id); };

    el("supSearch").addEventListener("change", function () {
      var v = this.value.trim();
      var id = v.split("—")[0].trim();
      if (supIndex[id]) { renderSupplier(id); return; }
      var lower = v.toLowerCase();
      var hit = sups.find(function (r) { return r.supplier_id.toLowerCase() === lower || r.supplier_name.toLowerCase().indexOf(lower) >= 0; });
      if (hit) renderSupplier(hit.supplier_id);
    });

    pick(worst.supplier_id);
  }
  function pick(sid) {
    var r = supIndex[sid];
    el("supSearch").value = sid + " — " + r.supplier_name;
    renderSupplier(sid);
  }
  function goSupplier(sid) { pick(sid); activateTab("p4"); }

  function renderSupplier(sid) {
    var r = supIndex[sid];
    var d = D.detail[sid] || { po: [] };
    var otifPct = r.otif_pct;
    var belowTarget = otifPct != null && (otifPct * 100) < r.otif_target_pct;

    var risk = "";
    if (belowTarget) risk += '<span class="pill pill-off">Below ' + r.otif_target_pct + '% OTIF target</span> ';
    if (r.avg_delay_days >= 15) risk += '<span class="pill pill-off">Chronic late supplier</span> ';
    else if (r.avg_delay_days >= 6) risk += '<span class="pill pill-risk">Frequently delayed</span> ';
    if (r.po_n > 0 && r.partial_n / Math.max(r.closed_n, 1) >= 0.12) risk += '<span class="pill pill-risk">Frequent partial shipments</span> ';
    if (r.cancelled_n >= 3) risk += '<span class="pill pill-risk">' + r.cancelled_n + ' cancellations</span>';

    var poBars = d.po.length ? d.po.map(function (p) {
      var delay = p[7], scale = Math.max(Math.abs(delay || 0), 20) * 1.3, late = delay != null && delay > 0;
      var barPct = delay != null ? Math.min(Math.abs(delay) / scale * 100, 100) : 0;
      return '<div class="paybar-row"><span class="mono" style="color:var(--muted);">' + esc(p[1]) + "</span>" +
        '<span class="track"><span class="fill" style="width:' + barPct + "%; background:" + (delay == null ? C.soft : late ? C.red : C.petrol) + ';"></span>' +
        '<span class="term-mark" style="left:0%;" title="target: on-time"></span></span>' +
        '<span class="mono" style="font-size:12px; text-align:right; color:' + (late ? C.red : "var(--ink-soft)") + ';">' +
        (delay == null ? p[8] : (delay > 0 ? "+" + delay + "d late" : "on time")) + "</span></div>";
    }).join("") : '<p class="nodata">No purchase order history on record.</p>';

    var stPill = { Received: "pill-good", Partial: "pill-risk", Cancelled: "pill-off", Open: "pill-info" };
    var poRows = d.po.map(function (p) {
      return "<tr><td class='mono' style='font-size:12px;'>" + esc(p[0]) + "</td><td class='mono' style='font-size:12px;'>" + esc(p[1]) + "</td>" +
        "<td>" + esc(p[2]) + "</td><td class='num'>" + num(p[3]) + " / " + num(p[4]) + "</td>" +
        '<td><span class="pill ' + (stPill[p[8]] || "pill-info") + '">' + esc(p[8]) + "</span></td>" +
        "<td class='mono' style='font-size:12px; color:var(--muted);'>" + esc(p[5]) + "</td></tr>";
    }).join("");

    el("p4Body").innerHTML =
      '<div class="panel" style="margin-bottom:12px;">' +
        '<p class="p-title" style="font-size:16px;">' + esc(r.supplier_name) +
        ' <span class="mono" style="font-size:11px; color:var(--muted); font-weight:400;">' + esc(r.supplier_id) + "</span>" +
        '<span style="margin-left:auto;">' + risk + "</span></p>" +
        '<div class="profile-strip">' +
          '<div class="f"><div class="l">Region</div><div class="v">' + esc(r.region) + "</div></div>" +
          '<div class="f"><div class="l">Category</div><div class="v">' + esc(r.category) + "</div></div>" +
          '<div class="f"><div class="l">Contracted lead time</div><div class="v">' + r.standard_lead_time_days + " days</div></div>" +
          '<div class="f"><div class="l">OTIF target</div><div class="v">' + r.otif_target_pct + "%</div></div>" +
          '<div class="f"><div class="l">Relationship manager</div><div class="v">' + esc(r.relationship_manager) + "</div></div>" +
        "</div></div>" +

      '<div class="kpi-row">' +
        kpiCard("OTIF", otifPct != null ? pct1(otifPct) : "—", "target " + r.otif_target_pct + "% · " + num(r.closed_n) + " closed POs", belowTarget ? "down" : "up") +
        kpiCard("Avg delay", r.avg_delay_days + "d", "target ≤ 3d", r.avg_delay_days > 3 ? "down" : "up") +
        kpiCard("Lifetime spend", money(r.spend_value), num(r.po_n) + " purchase orders · last " + esc(r.last_po_date), "") +
        kpiCard("Cancelled / partial", r.cancelled_n + " / " + r.partial_n, "out of " + num(r.po_n) + " orders", (r.cancelled_n + r.partial_n) > 0 ? "warn" : "up") +
      "</div>" +

      '<div class="panel-grid">' +
        '<div class="panel"><p class="p-title">Delivery timing — last ' + d.po.length + ' orders <span class="hint">bar = days late · 0 = on target</span></p>' + poBars + "</div>" +
        '<div class="panel"><p class="p-title">Recent purchase orders <span class="hint">latest ' + d.po.length + "</span></p>" +
          '<table class="dtable"><thead><tr><th>PO</th><th>Date</th><th>Item</th><th class="num">Ord / Recv</th><th>Status</th><th>Promised</th></tr></thead><tbody>' +
          poRows + "</tbody></table></div>" +
      "</div>";
  }

  /* ======================================================================
     PAGE 5 — KPI governance (static, computed once by the pipeline)
     ====================================================================== */
  function renderP5() {
    var g = D.govern;
    var counts = { on: 0, risk: 0, off: 0 };
    g.forEach(function (r) { counts[r[6]]++; });
    banner("p5Banner", "info",
      "<strong>" + g.length + " governed KPIs, one source of truth.</strong> Every value below is computed from the star schema by the pipeline — the same DIO/OTIF methodology used on the other pages. Last build: " + esc(D.meta.generated_at) + ".");
    el("p5Cards").innerHTML =
      kpiCard("KPIs tracked", String(g.length), "definitions in the register", "") +
      kpiCard("On target", '<span style="color:' + C.good + ';">' + counts.on + "</span>", "meeting threshold", "") +
      kpiCard("At risk", '<span style="color:' + C.amber + ';">' + counts.risk + "</span>", "within margin of threshold", "") +
      kpiCard("Off target", '<span style="color:' + C.red + ';">' + counts.off + "</span>", "management attention", "");

    el("p5Table").innerHTML =
      "<thead><tr><th>KPI</th><th>Definition</th><th>Source tables</th><th class='num'>Target</th><th class='num'>Current</th><th>Status</th><th>Owner</th></tr></thead><tbody>" +
      g.map(function (r) {
        return "<tr><td style='font-weight:600;'>" + esc(r[0]) + "</td>" +
          "<td style='color:var(--muted);'>" + esc(r[1]) + "</td>" +
          "<td class='mono' style='font-size:11.5px;'>" + esc(r[2]) + "</td>" +
          "<td class='num'>" + esc(r[3]) + "</td>" +
          "<td class='num' style='font-weight:600;'>" + r[4] + r[5] + "</td>" +
          "<td>" + statusPill(r[6]) + "</td>" +
          "<td>" + esc(r[7]) + "</td></tr>";
      }).join("") + "</tbody>";
  }

  /* ======================================================================
     Tabs, filters, wiring
     ====================================================================== */
  var rendered = { p4: false, p5: false };
  function activateTab(id) {
    document.querySelectorAll(".tab-btn").forEach(function (b) {
      var on = b.dataset.tab === id;
      b.classList.toggle("active", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
    document.querySelectorAll(".tab-page").forEach(function (p) { p.classList.toggle("active", p.id === id); });
    if (id === "p4" && !rendered.p4) { initP4(); rendered.p4 = true; }
    if (id === "p5" && !rendered.p5) { renderP5(); rendered.p5 = true; }
    if (hasChart) requestAnimationFrame(function () {
      Object.keys(charts).forEach(function (k) { charts[k].resize(); });
    });
  }
  document.querySelectorAll(".tab-btn").forEach(function (b) {
    b.addEventListener("click", function () { activateTab(b.dataset.tab); });
  });

  document.addEventListener("click", function (e) {
    var a = e.target.closest("a[data-sup]");
    if (a) { e.preventDefault(); goSupplier(a.dataset.sup); }
  });

  function fillSelect(id, values) {
    var s = el(id);
    values.forEach(function (v) {
      var o = document.createElement("option");
      o.value = String(v); o.textContent = String(v);
      s.appendChild(o);
    });
  }
  fillSelect("fRegion", M.regions);
  fillSelect("fCategory", M.categories);
  fillSelect("fYear", M.years);

  function onFilter() {
    F.r = el("fRegion").value; F.c = el("fCategory").value; F.y = el("fYear").value;
    renderP1(); renderP2(); renderP3();
  }
  ["fRegion", "fCategory", "fYear"].forEach(function (id) { el(id).addEventListener("change", onFilter); });
  el("fReset").addEventListener("click", function () {
    el("fRegion").value = el("fCategory").value = el("fYear").value = "All";
    onFilter();
  });

  /* ---------------- boot ---------------- */
  el("asOf").textContent = "as of " + M.as_of + " · synthetic dataset";
  el("footGen").textContent = "pipeline build " + D.meta.generated_at;
  renderP1(); renderP2(); renderP3();
})();
