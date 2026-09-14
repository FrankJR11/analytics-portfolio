/* ==========================================================================
   O2C Dashboard — all computation happens client-side on the pre-aggregated
   tables in assets/data.js (built by pipeline/build_dashboard_data.py).
   ========================================================================== */
(function () {
  "use strict";

  var D = window.O2C;
  if (!D) {
    document.querySelector(".dash-main .wrap").innerHTML =
      '<div class="panel"><p class="nodata">data.js not found. Run <span class="mono">python pipeline/build_dashboard_data.py</span> and reload.</p></div>';
    return;
  }

  /* ---------------- helpers ---------------- */
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
  function pct1(x) { return (x * 100).toFixed(1) + "%"; }
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
  var REASON_COLORS = { "Credit Hold": C.petrol, "Stock Out": C.blue, "Pricing Issue": C.amber,
                        "Customer Hold": C.soft, "Documentation Missing": "#9aa7a4" };
  var SEG_COLORS = { "Aviation": C.red, "Marine": C.amber, "B2B Fleet": C.blue, "Industrial": C.petrol };

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
  var F = { r: "All", s: "All", y: "All" };
  var M = D.meta;

  function inScopeRS(row) {
    return (F.r === "All" || row.region === F.r) && (F.s === "All" || row.segment === F.s);
  }
  function inScopeM(row) { return inScopeRS(row) && (F.y === "All" || row.m.slice(0, 4) === F.y); }
  function inScopeY(row) { return inScopeRS(row) && (F.y === "All" || String(row.y) === F.y); }
  function monthsInScope() {
    if (F.y === "All") return M.months;
    return M.months.filter(function (m) { return m.slice(0, 4) === F.y; });
  }
  function scopeLabel() {
    var parts = [];
    if (F.r !== "All") parts.push(F.r);
    if (F.s !== "All") parts.push(F.s);
    parts.push(F.y === "All" ? "2023–2025" : F.y);
    return parts.join(" · ");
  }

  /* DSO at a month-end for current region/segment scope */
  function dsoAt(month, segOverride) {
    var ar = 0, s90 = 0;
    rows("dso").forEach(function (r) {
      if (r.m !== month) return;
      if (F.r !== "All" && r.region !== F.r) return;
      var seg = segOverride || (F.s === "All" ? null : F.s);
      if (seg && r.segment !== seg) return;
      ar += r.ar; s90 += r.sales90;
    });
    return s90 > 0 ? ar / s90 * 90 : null;
  }
  function openAR(month) {
    var ar = 0;
    rows("dso").forEach(function (r) { if (r.m === month && inScopeRS(r)) ar += r.ar; });
    return ar;
  }

  /* ---------------- UI atoms ---------------- */
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
    var mrows = rows("monthly").filter(inScopeM);
    var ordersN = sum(mrows, "orders_n"), orderV = sum(mrows, "order_value");
    var stuckN = sum(mrows, "stuck_n"), stuckV = sum(mrows, "stuck_value");
    var stuckPct = ordersN ? stuckN / ordersN : 0;

    el("filterEcho").textContent = num(ordersN) + " orders in scope";

    /* YoY */
    var yNow = F.y === "All" ? String(M.years[M.years.length - 1]) : F.y;
    var yPrev = String(+yNow - 1);
    function yearValue(y) {
      var t = 0;
      rows("monthly").forEach(function (r) { if (inScopeRS(r) && r.m.slice(0, 4) === y) t += r.order_value; });
      return t;
    }
    var vNow = yearValue(yNow), vPrev = yearValue(yPrev);
    var yoyTxt = "—", yoyCls = "";
    if (vPrev > 0) {
      var d = (vNow - vPrev) / vPrev;
      yoyTxt = (d >= 0 ? "▲ " : "▼ ") + pct1(Math.abs(d)) + " " + yNow + " vs " + yPrev;
      yoyCls = d >= 0 ? "up" : "down";
    }

    var dsos = monthsInScope();
    var dsoNow = dsoAt(dsos[dsos.length - 1]);
    var dels = rows("delmonthly").filter(inScopeM);
    var otd = sum(dels, "del_n") ? sum(dels, "ontime_n") / sum(dels, "del_n") : null;

    el("p1Kpis").innerHTML =
      kpiCard("Order value · " + (F.y === "All" ? "3 yrs" : F.y), money(orderV), yoyTxt, yoyCls) +
      kpiCard("DSO (days)", dsoNow != null ? dsoNow.toFixed(1) : "—",
        dsoNow != null ? (dsoNow > 45 ? "▲ +" + (dsoNow - 45).toFixed(1) + "d vs 45-day target" : "within 45-day target")
                       : "no billings in scope",
        dsoNow != null && dsoNow > 45 ? "down" : "up") +
      kpiCard("On-time delivery", otd != null ? pct1(otd) : "—",
        otd != null ? (otd < 0.95 ? "▼ " + ((0.95 - otd) * 100).toFixed(1) + "pp below 95% SLA" : "meets 95% SLA") : "—",
        otd != null && otd < 0.95 ? "down" : "up") +
      kpiCard("Stuck order value", money(stuckV),
        pct1(stuckPct) + " of orders · target ≤ 5%", stuckPct > 0.05 ? "warn" : "up");

    /* banner — where is stuck value concentrated */
    var srows = rows("stuckreasons").filter(inScopeY);
    var byRegion = {}, byReason = {};
    srows.forEach(function (r) {
      byRegion[r.region] = (byRegion[r.region] || 0) + r.value;
      byReason[r.stuck_reason] = (byReason[r.stuck_reason] || 0) + r.value;
    });
    var totalStuckV = sum(srows, "value");
    var topReason = Object.keys(byReason).sort(function (a, b) { return byReason[b] - byReason[a]; })[0];
    var tone = stuckPct > 0.075 ? "red" : stuckPct > 0.05 ? "amber" : "good";
    if (!ordersN) {
      banner("p1Banner", "info", "No orders match the current filters.");
    } else if (F.r === "All" && totalStuckV) {
      var topRegion = Object.keys(byRegion).sort(function (a, b) { return byRegion[b] - byRegion[a]; })[0];
      banner("p1Banner", tone,
        "<strong>Stuck orders are " + pct1(stuckPct) + " of order count (" + money(stuckV) + ")</strong> — " +
        esc(topRegion) + " holds " + pct1(byRegion[topRegion] / totalStuckV) + " of stuck value, led by " +
        esc(topReason) + " (" + money(byReason[topReason]) + ").");
    } else if (totalStuckV) {
      banner("p1Banner", tone,
        "<strong>" + scopeLabel() + ": stuck orders are " + pct1(stuckPct) + " of order count</strong> — top reason " +
        esc(topReason) + " at " + pct1(byReason[topReason] / totalStuckV) + " of stuck value (" + money(byReason[topReason]) + ").");
    } else {
      banner("p1Banner", "good", "No stuck orders in the current scope.");
    }

    /* trend chart */
    var months = monthsInScope();
    var vm = {};
    mrows.forEach(function (r) { vm[r.m] = (vm[r.m] || 0) + r.order_value; });
    var series = months.map(function (m) { return (vm[m] || 0) / 1e6; });
    var datasets = [{
      label: F.y === "All" ? "Monthly order value" : yNow,
      data: series, borderColor: C.petrol, backgroundColor: "rgba(14,107,92,0.07)",
      borderWidth: 2, pointRadius: 0, tension: 0.3, fill: true
    }];
    if (F.y !== "All" && M.years.indexOf(+yPrev) >= 0) {
      var pm = {};
      rows("monthly").forEach(function (r) {
        if (inScopeRS(r) && r.m.slice(0, 4) === yPrev) pm[r.m.slice(5)] = (pm[r.m.slice(5)] || 0) + r.order_value;
      });
      datasets.push({
        label: yPrev, data: months.map(function (m) { return (pm[m.slice(5)] || 0) / 1e6; }),
        borderColor: C.muted, borderDash: [4, 4], borderWidth: 1.5, pointRadius: 0, tension: 0.3, fill: false
      });
    }
    el("p1TrendHint").textContent = "US$M · " + scopeLabel();
    drawChart("chTrend", {
      type: "line",
      data: { labels: months.map(function (m) { return F.y === "All" ? m : m.slice(5); }), datasets: datasets },
      options: {
        maintainAspectRatio: false,
        plugins: { legend: { display: datasets.length > 1, labels: { boxWidth: 10 } },
          tooltip: { callbacks: { label: function (c) { return c.dataset.label + ": $" + c.parsed.y.toFixed(0) + "M"; } } } },
        scales: { x: { grid: { display: false }, border: { color: C.line }, ticks: { maxTicksLimit: 12 } },
                  y: { grid: { color: "rgba(20,38,46,0.06)" }, border: { display: false },
                       ticks: { callback: function (v) { return "$" + v + "M"; } } } }
      }
    });

    /* regional heatmap */
    var lastM = months[months.length - 1];
    var html = '<table class="dtable"><thead><tr><th>Region</th><th class="num">Order $</th><th class="num">DSO</th><th class="num">OTD%</th><th class="num">Stuck%</th></tr></thead><tbody>';
    M.regions.forEach(function (rg) {
      var mr = rows("monthly").filter(function (r) {
        return r.region === rg && (F.s === "All" || r.segment === F.s) && (F.y === "All" || r.m.slice(0, 4) === F.y);
      });
      var on = sum(mr, "orders_n");
      if (!on) { html += "<tr><td>" + esc(rg) + '</td><td class="num" colspan="4">—</td></tr>'; return; }
      var dr = rows("delmonthly").filter(function (r) {
        return r.region === rg && (F.s === "All" || r.segment === F.s) && (F.y === "All" || r.m.slice(0, 4) === F.y);
      });
      var ar = 0, s90 = 0;
      rows("dso").forEach(function (r) {
        if (r.m === lastM && r.region === rg && (F.s === "All" || r.segment === F.s)) { ar += r.ar; s90 += r.sales90; }
      });
      var dso = s90 ? ar / s90 * 90 : null;
      var otdR = sum(dr, "del_n") ? sum(dr, "ontime_n") / sum(dr, "del_n") : null;
      var stR = sum(mr, "stuck_n") / on;
      function cls(v, good, risk, invert) {
        if (v == null) return "";
        var ok = invert ? v <= good : v >= good;
        var nr = invert ? v <= risk : v >= risk;
        return ok ? "cell-good" : nr ? "cell-risk" : "cell-off";
      }
      html += "<tr><td>" + esc(rg) + "</td>" +
        '<td class="num">' + money(sum(mr, "order_value")) + "</td>" +
        '<td class="num ' + cls(dso, 45, 52, true) + '">' + (dso != null ? dso.toFixed(1) : "—") + "</td>" +
        '<td class="num ' + cls(otdR, 0.95, 0.90, false) + '">' + (otdR != null ? pct1(otdR) : "—") + "</td>" +
        '<td class="num ' + cls(stR, 0.05, 0.08, true) + '">' + pct1(stR) + "</td></tr>";
    });
    html += "</tbody></table><p class='small' style='margin:10px 0 0;'>Segment &amp; year filters apply · DSO measured at " + esc(lastM) + " month-end.</p>";
    el("p1Heatmap").innerHTML = html;

    /* stuck reasons bars */
    el("p1StuckHint").textContent = scopeLabel();
    var reasons = Object.keys(byReason).sort(function (a, b) { return byReason[b] - byReason[a]; });
    var maxV = reasons.length ? byReason[reasons[0]] : 0;
    el("p1StuckBars").innerHTML = reasons.length
      ? reasons.map(function (rn) {
          return hbar(rn, money(byReason[rn]), byReason[rn] / maxV * 100, REASON_COLORS[rn] || C.petrol);
        }).join("")
      : '<p class="nodata">No stuck orders in scope.</p>';
  }

  /* ======================================================================
     PAGE 2 — Order → delivery
     ====================================================================== */
  function renderP2() {
    var f = rows("funnel").filter(inScopeY);
    var st = { on: sum(f, "orders_n"), ov: sum(f, "orders_v"), dn: sum(f, "del_n"), dv: sum(f, "del_v"),
               inn: sum(f, "inv_n"), inv: sum(f, "inv_v"), pn: sum(f, "paid_n"), pv: sum(f, "paid_v") };

    if (!st.on) {
      banner("p2Banner", "info", "No orders match the current filters.");
      el("p2Funnel").innerHTML = '<p class="nodata">—</p>';
    } else {
      var neverDel = 1 - st.dn / st.on;
      var mScope = rows("monthly").filter(inScopeM);
      var lostV = sum(mScope, "stuck_value");
      banner("p2Banner", neverDel > 0.12 ? "red" : "amber",
        "<strong>" + pct1(neverDel) + " of orders never reached delivery</strong> in " + scopeLabel() +
        " — " + money(lostV) + " sits in stuck orders alone. Uncollected order value across the funnel: " +
        money(st.ov - st.pv) + ".");

      var stages = [
        ["Ordered", st.on, st.ov, C.petrolDeep, "#ffffff"],
        ["Delivered", st.dn, st.dv, C.petrol, "#ffffff"],
        ["Invoiced", st.inn, st.inv, C.blue, "#ffffff"],
        ["Collected", st.pn, st.pv, C.soft, "#10222b"]
      ];
      el("p2FunnelHint").textContent = scopeLabel();
      el("p2Funnel").innerHTML = stages.map(function (s, i) {
        var p = s[1] / st.on;
        return '<div class="funnel-stage" style="padding-left:' + (i * 6) + '%;">' +
          '<div class="bar" style="width:' + Math.max(p * (100 - i * 6), 26) + '%; background:' + s[3] + "; color:" + s[4] + ';">' +
          "<span><strong>" + s[0] + ": " + num(s[1]) + "</strong> orders</span>" +
          '<span class="mono">' + money(s[2]) + " · " + pct1(p) + "</span></div></div>";
      }).join("") +
      '<p class="small" style="margin:10px 0 0;">"Collected" = orders whose invoice has a matching payment. Open and recently-invoiced orders sit in the gap by design.</p>';
    }

    /* stacked stuck-by-region */
    var srows = rows("stuckreasons").filter(function (r) {
      return (F.s === "All" || r.segment === F.s) && (F.y === "All" || String(r.y) === F.y);
    });
    var reasons = Object.keys(REASON_COLORS);
    var byReg = {};
    M.regions.forEach(function (rg) { byReg[rg] = {}; });
    srows.forEach(function (r) { byReg[r.region][r.stuck_reason] = (byReg[r.region][r.stuck_reason] || 0) + r.value; });
    var maxTot = Math.max.apply(null, M.regions.map(function (rg) {
      return reasons.reduce(function (t, rn) { return t + (byReg[rg][rn] || 0); }, 0);
    }).concat([1]));
    el("p2Stacked").innerHTML = M.regions.map(function (rg) {
      var tot = reasons.reduce(function (t, rn) { return t + (byReg[rg][rn] || 0); }, 0);
      var segs = reasons.map(function (rn) {
        var w = (byReg[rg][rn] || 0) / maxTot * 100;
        return w ? '<span class="seg" title="' + esc(rn) + ": " + money(byReg[rg][rn]) + '" style="width:' + w + "%; background:" + REASON_COLORS[rn] + ';"></span>' : "";
      }).join("");
      return '<div class="stack-row"><span class="lab">' + esc(rg) + '</span><span class="track">' + segs + '</span><span class="val" style="font-family:var(--mono); font-size:12px; text-align:right;">' + money(tot) + "</span></div>";
    }).join("") +
    '<div class="legend">' + reasons.map(function (rn) {
      return '<span class="li"><span class="sw" style="background:' + REASON_COLORS[rn] + ';"></span>' + esc(rn) + "</span>";
    }).join("") + "</div>";

    /* cycle time chart */
    var months = monthsInScope();
    var cs = {}, cn = {};
    rows("delmonthly").filter(inScopeM).forEach(function (r) {
      cs[r.m] = (cs[r.m] || 0) + r.cycle_sum; cn[r.m] = (cn[r.m] || 0) + r.del_n;
    });
    var cyc = months.map(function (m) { return cn[m] ? +(cs[m] / cn[m]).toFixed(1) : null; });
    drawChart("chCycle", {
      type: "line",
      data: {
        labels: months.map(function (m) { return F.y === "All" ? m : m.slice(5); }),
        datasets: [
          { label: "Avg cycle (days)", data: cyc, borderColor: C.blue, borderWidth: 2, pointRadius: 2, tension: 0.25 },
          { label: "Target 10d", data: months.map(function () { return 10; }), borderColor: C.red,
            borderDash: [4, 4], borderWidth: 1, pointRadius: 0 }
        ]
      },
      options: {
        maintainAspectRatio: false,
        plugins: { legend: { labels: { boxWidth: 10 } } },
        scales: { x: { grid: { display: false }, border: { color: C.line }, ticks: { maxTicksLimit: 12 } },
                  y: { grid: { color: "rgba(20,38,46,0.06)" }, border: { display: false }, suggestedMin: 6, suggestedMax: 16 } }
      }
    });

    /* top stuck customers */
    var cs2 = rows("customers").filter(function (r) { return inScopeRS(r) && r.stuck_value > 0; })
      .sort(function (a, b) { return b.stuck_value - a.stuck_value; }).slice(0, 6);
    el("p2StuckCust").innerHTML = cs2.length
      ? '<table class="dtable"><thead><tr><th>Customer</th><th>Region</th><th>Segment</th><th class="num">Stuck value</th><th class="num">Stuck orders</th><th></th></tr></thead><tbody>' +
        cs2.map(function (r) {
          return "<tr><td>" + esc(r.customer_name) + "</td><td>" + esc(r.region) + "</td><td>" + esc(r.segment) + "</td>" +
            '<td class="num">' + money(r.stuck_value) + '</td><td class="num">' + num(r.stuck_n) + "</td>" +
            '<td class="num"><a href="#" data-cust="' + esc(r.customer_id) + '">360 →</a></td></tr>';
        }).join("") + "</tbody></table>"
      : '<p class="nodata">No stuck customers in scope.</p>';
  }

  /* ======================================================================
     PAGE 3 — Cash & billing
     ====================================================================== */
  function renderP3() {
    var months = monthsInScope();
    var lastM = months[months.length - 1];
    var dsoNow = dsoAt(lastM);
    var ar = openAR(lastM);

    var ag = rows("aging").filter(inScopeRS);
    var agTotal = sum(ag, "value");
    var over = ag.filter(function (r) { return r.bucket !== "Current"; });
    var overV = sum(over, "value"), overN = sum(over, "n");

    var disp = rows("disputes").filter(inScopeY);
    var dispN = sum(disp, "n"), dispV = sum(disp, "value");
    var fun = rows("funnel").filter(inScopeY);
    var invN = sum(fun, "inv_n");
    var acc = invN ? 1 - dispN / invN : null;

    el("p3Kpis").innerHTML =
      kpiCard("DSO (days)", dsoNow != null ? dsoNow.toFixed(1) : "—",
        "at " + lastM + " · target ≤ 45 · excl. disputed", dsoNow != null && dsoNow > 45 ? "down" : "up") +
      kpiCard("Open A/R", money(ar), "excl. disputed · at " + lastM, "") +
      kpiCard("Overdue value", money(overV),
        (agTotal ? pct1(overV / agTotal) + " of open A/R" : "—") + " · " + num(overN) + " invoices · as of " + M.as_of,
        agTotal && overV / agTotal > 0.15 ? "down" : "up") +
      kpiCard("Invoice accuracy", acc != null ? pct1(acc) : "—",
        num(dispN) + " disputed (" + money(dispV) + ") · target ≥ 97%",
        acc != null && acc < 0.97 ? "warn" : "up");

    /* banner — segment payment behaviour */
    var pt = rows("paytrend").filter(function (r) {
      return (F.r === "All" || r.region === F.r) && (F.y === "All" || r.m.slice(0, 4) === F.y);
    });
    var segAgg = {};
    pt.forEach(function (r) {
      segAgg[r.segment] = segAgg[r.segment] || { d: 0, t: 0, n: 0 };
      segAgg[r.segment].d += r.days_sum; segAgg[r.segment].t += r.terms_sum; segAgg[r.segment].n += r.pay_n;
    });
    var segNames = Object.keys(segAgg).filter(function (k) { return segAgg[k].n > 0; });
    if (segNames.length >= 2) {
      var beyond = function (k) { return (segAgg[k].d - segAgg[k].t) / segAgg[k].n; };
      segNames.sort(function (a, b) { return beyond(b) - beyond(a); });
      var worst = segNames[0], best = segNames[segNames.length - 1];
      banner("p3Banner", beyond(worst) > 10 ? "red" : "amber",
        "<strong>" + esc(worst) + " pays " + beyond(worst).toFixed(1) + " days beyond terms</strong> on average — " +
        (beyond(worst) - beyond(best)).toFixed(1) + " days slower than " + esc(best) +
        ". Disputed receivables of " + money(sum(rows("disputed_ar").filter(inScopeRS), "value")) +
        " are excluded from DSO and tracked separately.");
    } else if (segNames.length === 1) {
      var k = segNames[0], b = (segAgg[k].d - segAgg[k].t) / segAgg[k].n;
      banner("p3Banner", b > 10 ? "red" : b > 5 ? "amber" : "good",
        "<strong>" + esc(k) + " pays " + b.toFixed(1) + " days beyond agreed terms</strong> on average in " + scopeLabel() + ".");
    } else {
      banner("p3Banner", "info", "No payments in the current scope.");
    }

    /* DSO trend by segment */
    var dsoBySeg = {};
    M.segments.forEach(function (s) { dsoBySeg[s] = {}; });
    rows("dso").forEach(function (r) {
      if (F.r !== "All" && r.region !== F.r) return;
      var o = dsoBySeg[r.segment];
      o[r.m] = o[r.m] || { ar: 0, s: 0 };
      o[r.m].ar += r.ar; o[r.m].s += r.sales90;
    });
    var dsSets = M.segments.map(function (s) {
      return {
        label: s,
        data: months.map(function (m) {
          var x = dsoBySeg[s][m];
          return x && x.s ? +(x.ar / x.s * 90).toFixed(1) : null;
        }),
        borderColor: SEG_COLORS[s], borderWidth: 1.8, pointRadius: 0, tension: 0.25
      };
    });
    dsSets.push({ label: "Target 45d", data: months.map(function () { return 45; }),
      borderColor: C.red, borderDash: [4, 4], borderWidth: 1, pointRadius: 0 });
    drawChart("chDso", {
      type: "line",
      data: { labels: months.map(function (m) { return F.y === "All" ? m : m.slice(5); }), datasets: dsSets },
      options: {
        maintainAspectRatio: false,
        plugins: { legend: { labels: { boxWidth: 10 } } },
        scales: { x: { grid: { display: false }, border: { color: C.line }, ticks: { maxTicksLimit: 12 } },
                  y: { grid: { color: "rgba(20,38,46,0.06)" }, border: { display: false }, suggestedMin: 35 } }
      }
    });

    /* aging bars */
    el("p3AgingHint").textContent = "as of " + M.as_of + " · year filter n/a";
    var buckets = ["Current", "1-30", "31-60", "61-90", "90+"];
    var bColors = { "Current": C.soft, "1-30": C.blue, "31-60": C.amber, "61-90": "#a15208", "90+": C.red };
    var bv = {}, bn = {};
    ag.forEach(function (r) { bv[r.bucket] = (bv[r.bucket] || 0) + r.value; bn[r.bucket] = (bn[r.bucket] || 0) + r.n; });
    var maxB = Math.max.apply(null, buckets.map(function (b) { return bv[b] || 0; }).concat([1]));
    el("p3Aging").innerHTML = buckets.map(function (b) {
      var lbl = b === "Current" ? "Current (not due)" : b + " days past due";
      return hbar(lbl, money(bv[b] || 0) + " · " + num(bn[b] || 0), (bv[b] || 0) / maxB * 100, bColors[b]);
    }).join("");
    var dAr = rows("disputed_ar").filter(inScopeRS);
    el("p3Disputed").innerHTML = '<span class="pill pill-off">Disputed</span> ' +
      money(sum(dAr, "value")) + " across " + num(sum(dAr, "n")) +
      " invoices — excluded from DSO &amp; aging, pending resolution.";

    /* top overdue customers */
    var oc = rows("customers").filter(function (r) { return inScopeRS(r) && r.overdue_v > 0; })
      .sort(function (a, b) { return b.overdue_v - a.overdue_v; }).slice(0, 6);
    el("p3Overdue").innerHTML = oc.length
      ? '<table class="dtable"><thead><tr><th>Customer</th><th>Segment</th><th class="num">Overdue</th><th class="num">Open A/R</th><th class="num">Avg DPD</th><th></th></tr></thead><tbody>' +
        oc.map(function (r) {
          var dpd = r.overdue_n ? Math.round(r.dpd_sum / r.overdue_n) : 0;
          return "<tr><td>" + esc(r.customer_name) + "</td><td>" + esc(r.segment) + "</td>" +
            '<td class="num">' + money(r.overdue_v) + '</td><td class="num">' + money(r.ar) + "</td>" +
            '<td class="num" style="color:' + (dpd > 15 ? C.red : C.amber) + ';">' + dpd + "d</td>" +
            '<td class="num"><a href="#" data-cust="' + esc(r.customer_id) + '">360 →</a></td></tr>';
        }).join("") + "</tbody></table>"
      : '<p class="nodata">No overdue customers in scope.</p>';

    /* disputes donut */
    el("p3DispHint").textContent = scopeLabel();
    var byReason = {};
    disp.forEach(function (r) { byReason[r.dispute_reason] = (byReason[r.dispute_reason] || 0) + r.n; });
    var dNames = Object.keys(byReason).sort(function (a, b) { return byReason[b] - byReason[a]; });
    var palette = [C.petrol, C.blue, C.amber, C.soft, "#9aa7a4"];
    if (dNames.length) {
      drawChart("chDisputes", {
        type: "doughnut",
        data: { labels: dNames, datasets: [{ data: dNames.map(function (k) { return byReason[k]; }),
          backgroundColor: dNames.map(function (_, i) { return palette[i % palette.length]; }), borderWidth: 0 }] },
        options: { maintainAspectRatio: false, cutout: "62%", plugins: { legend: { display: false } } }
      });
      var totD = dNames.reduce(function (t, k) { return t + byReason[k]; }, 0);
      el("p3DispLegend").innerHTML = dNames.map(function (k, i) {
        return '<div class="legend" style="margin:0 0 6px;"><span class="li"><span class="sw" style="background:' +
          palette[i % palette.length] + ';"></span>' + esc(k) + ' <span class="mono" style="color:var(--muted);">' +
          pct1(byReason[k] / totD) + " · " + num(byReason[k]) + "</span></span></div>";
      }).join("");
    } else {
      if (charts["chDisputes"]) { charts["chDisputes"].destroy(); delete charts["chDisputes"]; }
      el("p3DispLegend").innerHTML = '<p class="nodata">No disputes in scope.</p>';
    }
  }

  /* ======================================================================
     PAGE 4 — Customer 360
     ====================================================================== */
  var custIndex = {};
  function initP4() {
    var cs = rows("customers");
    var dl = el("custList");
    var opts = "";
    cs.forEach(function (r) {
      custIndex[r.customer_id] = r;
      opts += '<option value="' + esc(r.customer_id + " — " + r.customer_name) + '"></option>';
    });
    dl.innerHTML = opts;

    function beyond(r) { return r.pay_n >= 3 ? r.days_sum / r.pay_n - r.credit_terms_days : -999; }
    var worst = cs.slice().sort(function (a, b) { return beyond(b) - beyond(a); })[0];
    var stuck = cs.slice().sort(function (a, b) { return b.stuck_value - a.stuck_value; })[0];
    var big = cs.slice().sort(function (a, b) { return b.order_value - a.order_value; })[0];

    el("qWorstPayer").onclick = function () { pick(worst.customer_id); };
    el("qMostStuck").onclick = function () { pick(stuck.customer_id); };
    el("qBiggest").onclick = function () { pick(big.customer_id); };

    el("custSearch").addEventListener("change", function () {
      var v = this.value.trim();
      var id = v.split("—")[0].trim();
      if (custIndex[id]) { renderCustomer(id); return; }
      var lower = v.toLowerCase();
      var hit = cs.find(function (r) {
        return r.customer_id.toLowerCase() === lower || r.customer_name.toLowerCase().indexOf(lower) >= 0;
      });
      if (hit) renderCustomer(hit.customer_id);
    });

    pick(worst.customer_id); // open on the story, box pre-filled
  }
  function pick(cid) {
    var r = custIndex[cid];
    el("custSearch").value = cid + " — " + r.customer_name;
    renderCustomer(cid);
  }
  function goCustomer(cid) { pick(cid); activateTab("p4"); }

  function renderCustomer(cid) {
    var r = custIndex[cid];
    var d = D.detail[cid] || { o: [], p: [] };
    var avgPay = r.pay_n ? r.days_sum / r.pay_n : null;
    var beyond = avgPay != null ? avgPay - r.credit_terms_days : null;
    var otd = r.otd_total ? r.otd_ontime / r.otd_total : null;

    var risk = "";
    if (beyond != null && beyond >= 15) risk = '<span class="pill pill-off">Chronic late payer</span>';
    else if (beyond != null && beyond >= 6) risk = '<span class="pill pill-risk">Pays beyond terms</span>';
    else if (beyond != null) risk = '<span class="pill pill-good">Pays near terms</span>';
    if (r.stuck_n >= 5) risk += ' <span class="pill pill-risk">Recurring stuck orders</span>';
    if (r.disputes_n >= 5) risk += ' <span class="pill pill-risk">' + num(r.disputes_n) + " disputes</span>";

    var payBars = d.p.length ? d.p.map(function (p) {
      var days = p[2], terms = p[3], scale = Math.max(days, terms) * 1.25;
      var late = days > terms;
      return '<div class="paybar-row"><span class="mono" style="color:var(--muted);">' + esc(p[0]) + "</span>" +
        '<span class="track"><span class="fill" style="width:' + (days / scale * 100) + "%; background:" + (late ? C.red : C.petrol) + ';"></span>' +
        '<span class="term-mark" style="left:' + (terms / scale * 100) + '%;" title="terms: ' + terms + 'd"></span></span>' +
        '<span class="mono" style="font-size:12px; text-align:right; color:' + (late ? C.red : "var(--ink-soft)") + ';">' +
        days + "d vs " + terms + "d terms</span></div>";
    }).join("") : '<p class="nodata">No completed payments on record.</p>';

    var stPill = { Delivered: "pill-good", Stuck: "pill-off", Cancelled: "pill-info", Open: "pill-risk" };
    var ordRows = d.o.map(function (o) {
      return "<tr><td class='mono' style='font-size:12px;'>" + esc(o[0]) + "</td><td class='mono' style='font-size:12px;'>" + esc(o[1]) + "</td>" +
        "<td>" + esc(o[2]) + "</td><td class='num'>" + money(o[3]) + "</td>" +
        '<td><span class="pill ' + (stPill[o[4]] || "pill-info") + '">' + esc(o[4]) + "</span></td>" +
        "<td class='mono' style='font-size:12px; color:var(--muted);'>" + esc(o[5]) + "</td></tr>";
    }).join("");

    el("p4Body").innerHTML =
      '<div class="panel" style="margin-bottom:12px;">' +
        '<p class="p-title" style="font-size:16px;">' + esc(r.customer_name) +
        ' <span class="mono" style="font-size:11px; color:var(--muted); font-weight:400;">' + esc(r.customer_id) + "</span>" +
        '<span style="margin-left:auto;">' + risk + "</span></p>" +
        '<div class="profile-strip">' +
          '<div class="f"><div class="l">Region</div><div class="v">' + esc(r.region) + " · " + esc(r.country) + "</div></div>" +
          '<div class="f"><div class="l">Segment</div><div class="v">' + esc(r.segment) + "</div></div>" +
          '<div class="f"><div class="l">Credit terms</div><div class="v">' + r.credit_terms_days + " days</div></div>" +
          '<div class="f"><div class="l">Credit limit</div><div class="v">' + money(r.credit_limit_usd) + "</div></div>" +
          '<div class="f"><div class="l">Account manager</div><div class="v">' + esc(r.account_manager) + "</div></div>" +
        "</div></div>" +

      '<div class="kpi-row">' +
        kpiCard("Lifetime orders", money(r.order_value), num(r.orders_n) + " orders · last " + esc(r.last_order), "") +
        kpiCard("Avg days to pay", avgPay != null ? avgPay.toFixed(0) + "d" : "—",
          beyond != null ? (beyond >= 0 ? "+" : "") + beyond.toFixed(0) + "d vs " + r.credit_terms_days + "d terms" : "no payments yet",
          beyond != null && beyond >= 6 ? "down" : "up") +
        kpiCard("Outstanding A/R", money(r.ar),
          r.overdue_v ? money(r.overdue_v) + " overdue" : "nothing overdue", r.overdue_v ? "warn" : "up") +
        kpiCard("On-time delivery", otd != null ? pct1(otd) : "—",
          num(r.stuck_n) + " stuck order" + (r.stuck_n === 1 ? "" : "s") + " (" + money(r.stuck_value) + ")",
          r.stuck_n ? "warn" : "") +
      "</div>" +

      '<div class="panel-grid">' +
        '<div class="panel"><p class="p-title">Payment behaviour — last ' + d.p.length + ' payments <span class="hint">bar = days to pay · marker = credit terms</span></p>' + payBars + "</div>" +
        '<div class="panel"><p class="p-title">Recent orders <span class="hint">latest ' + d.o.length + "</span></p>" +
          '<table class="dtable"><thead><tr><th>Order</th><th>Date</th><th>Product</th><th class="num">Value</th><th>Status</th><th>Invoice</th></tr></thead><tbody>' +
          ordRows + "</tbody></table></div>" +
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
      "<strong>" + g.length + " governed KPIs, one source of truth.</strong> Every value below is computed from the star schema by the pipeline. Last build: " + esc(D.meta.generated_at) + ".");
    el("p5Cards").innerHTML =
      kpiCard("KPIs tracked", String(g.length), "definitions in the register", "") +
      kpiCard("On target", '<span style="color:' + C.good + ';">' + counts.on + "</span>", "meeting threshold", "") +
      kpiCard("At risk", '<span style="color:' + C.amber + ';">' + counts.risk + "</span>", "within 8% of threshold", "") +
      kpiCard("Off target", '<span style="color:' + C.red + ';">' + counts.off + "</span>", "management attention", "");

    el("p5Table").innerHTML =
      "<thead><tr><th>KPI</th><th>Definition</th><th>Source tables</th><th class='num'>Target</th><th class='num'>Current</th><th>Status</th><th>Owner</th></tr></thead><tbody>" +
      g.map(function (r) {
        return "<tr><td style='font-weight:600;'>" + esc(r[0]) + "</td>" +
          "<td style='color:var(--muted);'>" + esc(r[1]) + "</td>" +
          "<td class='mono' style='font-size:11.5px;'>" + esc(r[2]) + "</td>" +
          "<td class='num'>" + esc(r[3]) + "</td>" +
          "<td class='num' style='font-weight:600;'>" + r[4] + (r[5] === "%" ? "%" : "d") + "</td>" +
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
    document.querySelectorAll(".tab-page").forEach(function (p) {
      p.classList.toggle("active", p.id === id);
    });
    if (id === "p4" && !rendered.p4) { initP4(); rendered.p4 = true; }
    if (id === "p5" && !rendered.p5) { renderP5(); rendered.p5 = true; }
    // Charts created while their tab was display:none measured a 0×0 box —
    // re-measure them now that the tab is visible.
    if (hasChart) requestAnimationFrame(function () {
      Object.keys(charts).forEach(function (k) { charts[k].resize(); });
    });
  }
  document.querySelectorAll(".tab-btn").forEach(function (b) {
    b.addEventListener("click", function () { activateTab(b.dataset.tab); });
  });

  document.addEventListener("click", function (e) {
    var a = e.target.closest("a[data-cust]");
    if (a) { e.preventDefault(); goCustomer(a.dataset.cust); }
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
  fillSelect("fSegment", M.segments);
  fillSelect("fYear", M.years);

  function onFilter() {
    F.r = el("fRegion").value; F.s = el("fSegment").value; F.y = el("fYear").value;
    renderP1(); renderP2(); renderP3();
  }
  ["fRegion", "fSegment", "fYear"].forEach(function (id) { el(id).addEventListener("change", onFilter); });
  el("fReset").addEventListener("click", function () {
    el("fRegion").value = el("fSegment").value = el("fYear").value = "All";
    onFilter();
  });

  /* ---------------- boot ---------------- */
  el("asOf").textContent = "as of " + M.as_of + " · synthetic dataset";
  el("footGen").textContent = "pipeline build " + D.meta.generated_at;
  renderP1(); renderP2(); renderP3();
})();
