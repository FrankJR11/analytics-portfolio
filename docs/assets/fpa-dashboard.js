/* ==========================================================================
   FP&A / Cost & Budget Dashboard — all computation happens client-side on
   the pre-aggregated tables in assets/fpa-data.js (built by
   pipeline/build_fpa_dashboard_data.py).
   ========================================================================== */
(function () {
  "use strict";

  var D = window.FPA;
  if (!D) {
    document.querySelector(".dash-main .wrap").innerHTML =
      '<div class="panel"><p class="nodata">fpa-data.js not found. Run <span class="mono">python pipeline/build_fpa_dashboard_data.py</span> and reload.</p></div>';
    return;
  }

  var RISK_SITES = ["Melbourne Terminal", "Houston Gulf Coast Terminal"];

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
    if (a >= 1e6) return s + "$" + (a / 1e6).toFixed(2) + "M";
    if (a >= 1e3) return s + "$" + Math.round(a / 1e3).toLocaleString() + "K";
    return s + "$" + Math.round(a).toLocaleString();
  }
  function num(v) { return Math.round(v || 0).toLocaleString(); }
  function pct1(x) { return x == null ? "—" : (x * 100).toFixed(1) + "%"; }
  function signedPct1(x) { return x == null ? "—" : (x >= 0 ? "+" : "") + (x * 100).toFixed(1) + "%"; }
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
  var CC_COLORS = {};
  (function () {
    var palette = [C.red, C.petrol, C.amber, C.blue, C.soft, "#9aa7a4", C.petrolDeep, "#c98a2e", "#5a7d8c", "#8c5a7d", "#7d8c5a"];
    M.cost_centers.forEach(function (d, i) { CC_COLORS[d] = palette[i % palette.length]; });
  })();

  function inScopeRC(row) {
    return (F.r === "All" || row.region === F.r) && (F.c === "All" || row.cost_center === F.c);
  }
  function inScopeRCY(row) { return inScopeRC(row) && (F.y === "All" || row.period_id.slice(0, 4) === F.y); }
  function periodsInScope() {
    if (F.y === "All") return M.periods;
    return M.periods.filter(function (p) { return p.slice(0, 4) === F.y; });
  }
  function scopeLabel() {
    var parts = [];
    if (F.r !== "All") parts.push(F.r);
    if (F.c !== "All") parts.push(F.c);
    parts.push(F.y === "All" ? "2023–2025" : F.y);
    return parts.join(" · ");
  }
  function yearsInScope() { return F.y === "All" ? M.years : [F.y]; }

  /* ---------------- UI atoms ---------------- */
  function kpiCard(label, value, sub, subClass) {
    return '<div class="kpi"><div class="k-label">' + esc(label) + '</div>' +
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
    var scope = rows("monthly").filter(inScopeRCY);
    var budget = sum(scope, "budget"), actual = sum(scope, "actual");
    var variancePct = budget > 0 ? (actual - budget) / budget : null;

    var byAcct = rows("by_account").filter(function (r) { return inScopeRC(r) && (F.y === "All" || r.year === F.y); });
    var riskRows = byAcct.filter(function (r) { return RISK_SITES.length && ["Overtime", "Contractor & Temp Labor", "Recruiting & Agency Fees"].indexOf(r.account) >= 0; });
    // labor risk needs site-level data — pull from sites_roll instead (by_account has no site)
    var sitesScope = rows("sites_roll").filter(function (r) { return (F.y === "All" || r.year === F.y) && RISK_SITES.indexOf(r.site_name) >= 0 && (F.r === "All" || r.region === F.r); });
    var laborBudget = sum(sitesScope, "labor_budget"), laborActual = sum(sitesScope, "labor_actual");
    var laborVariancePct = laborBudget > 0 ? (laborActual - laborBudget) / laborBudget : null;

    var cxScope = rows("capex_projects").filter(function (r) { return (F.r === "All" || r.region === F.r) && (F.c === "All" || r.cost_center === F.c); });
    var infra = cxScope.filter(function (r) { return r.category === "Capex — Infrastructure" && (r.status === "Complete" || r.status === "Delayed"); });
    var infraOnTime = infra.length ? infra.filter(function (r) { return r.delay_days <= 30; }).length / infra.length : null;

    el("filterEcho").textContent = money(actual) + " actual spend in scope";

    el("p1Kpis").innerHTML =
      kpiCard("Total opex variance", variancePct != null ? signedPct1(variancePct) : "—",
        budget ? money(actual) + " actual vs " + money(budget) + " budget" : "—",
        variancePct != null && variancePct > 0.05 ? "down" : "up") +
      kpiCard("Labor variance — risk sites", laborVariancePct != null ? signedPct1(laborVariancePct) : "—",
        "Melbourne + Houston · Overtime, Contractor, Recruiting", laborVariancePct != null && laborVariancePct > 0.15 ? "down" : "up") +
      kpiCard("Infrastructure capex on-time", infraOnTime != null ? pct1(infraOnTime) : "—",
        "target ≥ 80% · " + infra.length + " projects", infraOnTime != null && infraOnTime < 0.80 ? "down" : "up") +
      kpiCard("Capex utilization", (function () {
        var done = cxScope.filter(function (r) { return r.status === "Complete" || r.status === "Delayed"; });
        var u = sum(done, "approved_budget") > 0 ? sum(done, "spend_to_date") / sum(done, "approved_budget") : null;
        return u != null ? pct1(u) : "—";
      })(), "target ≥ 85% · completed + delayed", "up");

    /* banner */
    if (!scope.length) {
      banner("p1Banner", "info", "No activity matches the current filters.");
    } else if (F.r === "All" && F.c === "All") {
      banner("p1Banner", variancePct != null && Math.abs(variancePct) < 0.02 ? "amber" : "good",
        "<strong>Company-wide opex is within " + pct1(Math.abs(variancePct)) + " of budget</strong> — but that hides a real problem: " +
        "labor costs at Melbourne and Houston are running " + signedPct1(laborVariancePct) + " over, and Infrastructure capex on-time delivery sits at " +
        pct1(infraOnTime) + " against an 80% target. Aggregation is hiding both stories.");
    } else {
      banner("p1Banner", variancePct != null && variancePct > 0.05 ? "amber" : "good",
        "<strong>" + scopeLabel() + ":</strong> opex variance " + signedPct1(variancePct) + " (" + money(actual) + " vs " + money(budget) + " budget).");
    }

    /* trend */
    var periods = periodsInScope();
    var byP = {};
    rows("monthly").filter(inScopeRC).forEach(function (r) {
      byP[r.period_id] = byP[r.period_id] || { b: 0, a: 0 };
      byP[r.period_id].b += r.budget; byP[r.period_id].a += r.actual;
    });
    el("p1TrendHint").textContent = scopeLabel();
    drawChart("chTrend", {
      type: "line",
      data: {
        labels: periods.map(function (p) { return F.y === "All" ? p : p.slice(5); }),
        datasets: [
          { label: "Budget", data: periods.map(function (p) { return byP[p] ? byP[p].b : null; }), borderColor: C.soft, borderDash: [4, 4], borderWidth: 2, pointRadius: 0, tension: 0.2 },
          { label: "Actual", data: periods.map(function (p) { return byP[p] ? byP[p].a : null; }), borderColor: C.petrol, backgroundColor: "rgba(14,107,92,0.07)", borderWidth: 2, pointRadius: 0, tension: 0.2, fill: true },
        ],
      },
      options: {
        maintainAspectRatio: false,
        plugins: { legend: { labels: { boxWidth: 10 } } },
        scales: { x: { grid: { display: false }, border: { color: C.line }, ticks: { maxTicksLimit: 12 } },
                  y: { grid: { color: "rgba(20,38,46,0.06)" }, border: { display: false } } },
      },
    });

    /* heatmap by region */
    var html = '<table class="dtable"><thead><tr><th>Region</th><th class="num">Opex variance</th><th class="num">Labor var. (risk sites)</th><th class="num">Capex util.</th></tr></thead><tbody>';
    M.regions.forEach(function (rg) {
      var wr = rows("monthly").filter(function (r) { return r.region === rg && (F.c === "All" || r.cost_center === F.c) && (F.y === "All" || r.period_id.slice(0, 4) === F.y); });
      if (!wr.length) { html += "<tr><td>" + esc(rg) + '</td><td class="num" colspan="3">—</td></tr>'; return; }
      var b = sum(wr, "budget"), a = sum(wr, "actual");
      var v = b > 0 ? (a - b) / b : null;
      var sr = rows("sites_roll").filter(function (r) { return r.region === rg && RISK_SITES.indexOf(r.site_name) >= 0 && (F.y === "All" || r.year === F.y); });
      var lb = sum(sr, "labor_budget"), la = sum(sr, "labor_actual");
      var lv = lb > 0 ? (la - lb) / lb : null;
      var cxr = rows("capex_projects").filter(function (r) { return r.region === rg && (r.status === "Complete" || r.status === "Delayed"); });
      var u = sum(cxr, "approved_budget") > 0 ? sum(cxr, "spend_to_date") / sum(cxr, "approved_budget") : null;
      function cls(val, good, risk, lowerBetter) {
        if (val == null) return "";
        var ok = lowerBetter ? val <= good : val >= good;
        var nr = lowerBetter ? val <= risk : val >= risk;
        return ok ? "cell-good" : nr ? "cell-risk" : "cell-off";
      }
      html += "<tr><td>" + esc(rg) + "</td>" +
        '<td class="num ' + cls(Math.abs(v), 0.03, 0.06, true) + '">' + (v != null ? signedPct1(v) : "—") + "</td>" +
        '<td class="num ' + (lv == null ? "" : cls(lv, 0.10, 0.25, true)) + '">' + (lv != null ? signedPct1(lv) : "n/a") + "</td>" +
        '<td class="num ' + cls(u, 0.85, 0.70, false) + '">' + (u != null ? pct1(u) : "—") + "</td></tr>";
    });
    html += "</tbody></table><p class='small' style='margin:10px 0 0;'>Labor variance shown only for regions containing a flagged risk site (Melbourne = APAC, Houston = Americas).</p>";
    el("p1Heatmap").innerHTML = html;

    /* cost center bars */
    el("p1CCHint").textContent = scopeLabel();
    var ccRows = M.cost_centers.map(function (ccn) {
      var wr = rows("monthly").filter(function (r) { return r.cost_center === ccn && (F.r === "All" || r.region === F.r) && (F.y === "All" || r.period_id.slice(0, 4) === F.y); });
      var b = sum(wr, "budget"), a = sum(wr, "actual");
      return { cc: ccn, variance: b > 0 ? (a - b) / b : 0, budget: b };
    }).filter(function (r) { return r.budget > 0; }).sort(function (a, b) { return Math.abs(b.variance) - Math.abs(a.variance); });
    var maxAbs = ccRows.length ? Math.max.apply(null, ccRows.map(function (r) { return Math.abs(r.variance); })) : 0;
    el("p1CCBars").innerHTML = ccRows.map(function (r) {
      return hbar(r.cc, signedPct1(r.variance), maxAbs ? Math.abs(r.variance) / maxAbs * 100 : 0, r.variance >= 0 ? C.red : C.good);
    }).join("");
  }

  /* ======================================================================
     PAGE 2 — Cost & variance
     ====================================================================== */
  function renderP2() {
    var byAcct = rows("by_account").filter(function (r) { return inScopeRC(r) && (F.y === "All" || r.year === F.y); });
    var agg = {};
    byAcct.forEach(function (r) {
      agg[r.account] = agg[r.account] || { b: 0, a: 0 };
      agg[r.account].b += r.budget; agg[r.account].a += r.actual;
    });
    var driverArr = Object.keys(agg).map(function (k) { return { account: k, variance: agg[k].a - agg[k].b, budget: agg[k].b, actual: agg[k].a }; })
      .sort(function (a, b) { return Math.abs(b.variance) - Math.abs(a.variance); });

    var totalBudget = sum(byAcct, "budget"), totalActual = sum(byAcct, "actual");
    el("p2BridgeHint").textContent = scopeLabel() + " · top variance drivers";
    if (!totalBudget) {
      banner("p2Banner", "info", "No activity matches the current filters.");
      el("p2Bridge").innerHTML = '<p class="nodata">—</p>';
    } else {
      var top = driverArr.slice(0, 4);
      var restVariance = (totalActual - totalBudget) - sum(top, "variance");
      banner("p2Banner", Math.abs(totalActual - totalBudget) / totalBudget > 0.05 ? "amber" : "good",
        "<strong>" + scopeLabel() + ": " + money(totalActual) + " actual vs " + money(totalBudget) + " budget</strong> (" +
        signedPct1((totalActual - totalBudget) / totalBudget) + "). Largest driver: <strong>" + esc(top[0].account) + "</strong> at " +
        (top[0].variance >= 0 ? "+" : "") + money(top[0].variance) + ".");

      var stages = [["Budget", totalBudget, C.soft]];
      top.forEach(function (d) { stages.push([(d.variance >= 0 ? "+ " : "− ") + d.account, Math.abs(d.variance), d.variance >= 0 ? C.red : C.good]); });
      stages.push([(restVariance >= 0 ? "+ " : "− ") + "Everything else", Math.abs(restVariance), restVariance >= 0 ? C.amber : C.good]);
      stages.push(["Actual", totalActual, C.petrolDeep]);
      var maxV = Math.max.apply(null, stages.map(function (s) { return s[1]; }).concat([1]));
      el("p2Bridge").innerHTML = stages.map(function (s) {
        return '<div class="hbar-row"><span class="lab">' + esc(s[0]) + '</span>' +
          '<span class="track"><span class="fill" style="width:' + Math.max(s[1] / maxV * 100, 1.5) + "%; background:" + s[2] + ';"></span></span>' +
          '<span class="val">' + money(s[1]) + "</span></div>";
      }).join("");
    }

    /* variance by account bars */
    el("p2AcctHint").textContent = "sorted by |variance| · " + scopeLabel();
    var maxAcctAbs = driverArr.length ? Math.max.apply(null, driverArr.map(function (r) { return Math.abs(r.variance); })) : 0;
    el("p2AcctBars").innerHTML = driverArr.slice(0, 12).map(function (r) {
      return hbar(r.account, (r.variance >= 0 ? "+" : "") + money(r.variance), maxAcctAbs ? Math.abs(r.variance) / maxAcctAbs * 100 : 0, r.variance >= 0 ? C.red : C.good);
    }).join("");

    /* sites by labor variance */
    var sr = rows("sites_roll").filter(function (r) { return (F.r === "All" || r.region === F.r) && (F.y === "All" || r.year === F.y); });
    var bySite = {};
    sr.forEach(function (r) {
      bySite[r.site_name] = bySite[r.site_name] || { lb: 0, la: 0 };
      bySite[r.site_name].lb += r.labor_budget; bySite[r.site_name].la += r.labor_actual;
    });
    var siteArr = Object.keys(bySite).filter(function (s) { return bySite[s].lb > 0; })
      .map(function (s) { return { site: s, variance: (bySite[s].la - bySite[s].lb) / bySite[s].lb }; })
      .sort(function (a, b) { return b.variance - a.variance; });
    var maxSiteV = siteArr.length ? Math.max.apply(null, siteArr.map(function (r) { return r.variance; })) : 0;
    el("p2Sites").innerHTML = siteArr.length ? siteArr.map(function (r) {
      return hbar(r.site, signedPct1(r.variance), maxSiteV ? Math.max(r.variance / maxSiteV * 100, 0) : 0, RISK_SITES.indexOf(r.site) >= 0 ? C.red : C.soft);
    }).join("") : '<p class="nodata">No terminal sites in scope.</p>';

    /* cost centers ranked table */
    el("p2TableHint").textContent = scopeLabel();
    var ccTbl = M.cost_centers.map(function (ccn) {
      var wr = rows("monthly").filter(function (r) { return r.cost_center === ccn && (F.r === "All" || r.region === F.r) && (F.y === "All" || r.period_id.slice(0, 4) === F.y); });
      var b = sum(wr, "budget"), a = sum(wr, "actual");
      return { cc: ccn, budget: b, actual: a, variance: a - b, variancePct: b > 0 ? (a - b) / b : null };
    }).filter(function (r) { return r.budget > 0; }).sort(function (a, b) { return Math.abs(b.variance) - Math.abs(a.variance); });
    el("p2Table").innerHTML = '<table class="dtable"><thead><tr><th>Cost center</th><th class="num">Budget</th><th class="num">Actual</th><th class="num">Variance $</th><th class="num">Variance %</th></tr></thead><tbody>' +
      ccTbl.map(function (r) {
        var color = r.variancePct > 0.10 ? C.red : r.variancePct > 0.03 ? C.amber : "var(--ink)";
        return "<tr><td>" + esc(r.cc) + '</td><td class="num">' + money(r.budget) + '</td><td class="num">' + money(r.actual) +
          '</td><td class="num" style="color:' + color + ';">' + (r.variance >= 0 ? "+" : "") + money(r.variance) +
          '</td><td class="num" style="color:' + color + ';">' + signedPct1(r.variancePct) + "</td></tr>";
      }).join("") + "</tbody></table>";
  }

  /* ======================================================================
     PAGE 3 — Capex & projects
     ====================================================================== */
  function renderP3() {
    var cxScope = rows("capex_projects").filter(function (r) { return (F.r === "All" || r.region === F.r) && (F.c === "All" || r.cost_center === F.c); });
    var resolved = cxScope.filter(function (r) { return r.status === "Complete" || r.status === "Delayed"; });
    var approved = sum(resolved, "approved_budget"), spent = sum(resolved, "spend_to_date");
    var util = approved > 0 ? spent / approved : null;
    var onTime = resolved.length ? resolved.filter(function (r) { return r.delay_days <= 30; }).length / resolved.length : null;
    var avgDelay = resolved.length ? sum(resolved, "delay_days") / resolved.length : null;

    el("p3Kpis").innerHTML =
      kpiCard("Capex approved", money(sum(cxScope, "approved_budget")), cxScope.length + " projects in scope", "") +
      kpiCard("Capex utilization", util != null ? pct1(util) : "—", "target ≥ 85% · completed + delayed", util != null && util < 0.85 ? "down" : "up") +
      kpiCard("On-time completion", onTime != null ? pct1(onTime) : "—", "target ≥ 80% · within 30 days of plan", onTime != null && onTime < 0.80 ? "down" : "up") +
      kpiCard("Avg delay", avgDelay != null ? avgDelay.toFixed(0) + "d" : "—", "target ≤ 30d, completed + delayed", avgDelay != null && avgDelay > 30 ? "down" : "up");

    if (!cxScope.length) {
      banner("p3Banner", "info", "No capex projects match the current filters.");
    } else {
      var infra = resolved.filter(function (r) { return r.category === "Capex — Infrastructure"; });
      var infraOnTime = infra.length ? infra.filter(function (r) { return r.delay_days <= 30; }).length / infra.length : null;
      banner("p3Banner", infraOnTime != null && infraOnTime < 0.5 ? "red" : infraOnTime != null && infraOnTime < 0.8 ? "amber" : "good",
        infraOnTime != null
          ? "<strong>Infrastructure capex on-time rate: " + pct1(infraOnTime) + "</strong> against an 80% target — Equipment and IT Systems projects land close to plan; Infrastructure is where the schedule (and the budget) slips."
          : "<strong>" + num(cxScope.length) + " projects in scope.</strong>");
    }

    /* approved vs spent by category */
    var cats = ["Capex — Equipment", "Capex — Infrastructure", "Capex — IT Systems"];
    var byCat = cats.map(function (cat) {
      var r = resolved.filter(function (x) { return x.category === cat; });
      return { cat: cat.replace("Capex — ", ""), approved: sum(r, "approved_budget"), spent: sum(r, "spend_to_date") };
    });
    drawChart("chCapexBar", {
      type: "bar",
      data: {
        labels: byCat.map(function (c) { return c.cat; }),
        datasets: [
          { label: "Approved", data: byCat.map(function (c) { return c.approved; }), backgroundColor: "rgba(127,168,201,0.45)", borderRadius: 3 },
          { label: "Spent", data: byCat.map(function (c) { return c.spent; }), backgroundColor: C.petrol, borderRadius: 3 },
        ],
      },
      options: {
        maintainAspectRatio: false,
        plugins: { legend: { labels: { boxWidth: 10 } } },
        scales: { x: { grid: { display: false }, border: { color: C.line } },
                  y: { grid: { color: "rgba(20,38,46,0.06)" }, border: { display: false }, ticks: { callback: function (v) { return money(v); } } } },
      },
    });

    /* donut: status */
    var statuses = ["Complete", "Delayed", "On Track", "Not Started", "Cancelled"];
    var colors = { "Complete": C.good, "Delayed": C.red, "On Track": C.blue, "Not Started": C.soft, "Cancelled": "#9aa7a4" };
    var statusCounts = statuses.map(function (s) { return [s, cxScope.filter(function (r) { return r.status === s; }).length, colors[s]]; }).filter(function (s) { return s[1] > 0; });
    el("p3DonutHint").textContent = scopeLabel();
    if (statusCounts.length) {
      drawChart("chDonut", {
        type: "doughnut",
        data: { labels: statusCounts.map(function (s) { return s[0]; }), datasets: [{ data: statusCounts.map(function (s) { return s[1]; }), backgroundColor: statusCounts.map(function (s) { return s[2]; }), borderWidth: 0 }] },
        options: { maintainAspectRatio: false, cutout: "62%", plugins: { legend: { display: false } } },
      });
      var totS = cxScope.length;
      el("p3DonutLegend").innerHTML = statusCounts.map(function (s) {
        return '<div class="legend" style="margin:0 0 6px;"><span class="li"><span class="sw" style="background:' + s[2] +
          ';"></span>' + s[0] + ' <span class="mono" style="color:var(--muted);">' + pct1(s[1] / totS) + " · " + s[1] + "</span></span></div>";
      }).join("");
    } else {
      if (charts["chDonut"]) { charts["chDonut"].destroy(); delete charts["chDonut"]; }
      el("p3DonutLegend").innerHTML = '<p class="nodata">No projects in scope.</p>';
    }

    /* on-time by category bars */
    var maxCat = 100;
    el("p3CatBars").innerHTML = cats.map(function (cat) {
      var r = resolved.filter(function (x) { return x.category === cat; });
      var rate = r.length ? r.filter(function (x) { return x.delay_days <= 30; }).length / r.length : 0;
      return hbar(cat.replace("Capex — ", "") + " (n=" + r.length + ")", pct1(rate), rate * 100, cat === "Capex — Infrastructure" ? C.red : C.good);
    }).join("");

    /* projects furthest behind */
    el("p3TableHint").textContent = scopeLabel();
    var worst = resolved.filter(function (r) { return r.delay_days > 0; }).sort(function (a, b) { return b.delay_days - a.delay_days; }).slice(0, 8);
    el("p3Table").innerHTML = worst.length
      ? '<table class="dtable"><thead><tr><th>Project</th><th>Category</th><th>Site</th><th class="num">Delay</th><th class="num">Approved</th><th class="num">Spent</th></tr></thead><tbody>' +
        worst.map(function (r) {
          return "<tr><td class='mono' style='font-size:12px;'>" + esc(r.project_id) + "</td><td>" + esc(r.category.replace("Capex — ", "")) + "</td><td>" + esc(r.site_name) +
            '</td><td class="num" style="color:' + (r.delay_days > 60 ? C.red : C.amber) + ';">' + r.delay_days + "d</td><td class=\"num\">" + money(r.approved_budget) + '</td><td class="num">' + money(r.spend_to_date) + "</td></tr>";
        }).join("") + "</tbody></table>"
      : '<p class="nodata">No delayed projects in scope.</p>';
  }

  /* ======================================================================
     PAGE 4 — Cost Center 360
     ====================================================================== */
  var ccIndex = {};
  function initP4() {
    var ents = rows("entities");
    var dl = el("ccList");
    var opts = "";
    ents.forEach(function (r) { ccIndex[r.entity_id] = r; opts += '<option value="' + esc(r.cost_center + " — " + r.site_name) + '"></option>'; });
    dl.innerHTML = opts;

    var worst = ents.slice().sort(function (a, b) { return (b.variance_pct || 0) - (a.variance_pct || 0); })[0];
    var biggest = ents.slice().sort(function (a, b) { return b.budget - a.budget; })[0];
    var best = ents.slice().sort(function (a, b) { return (a.variance_pct || 0) - (b.variance_pct || 0); })[0];

    el("qWorstVariance").onclick = function () { pick(worst.entity_id); };
    el("qBiggestBudget").onclick = function () { pick(biggest.entity_id); };
    el("qBestVariance").onclick = function () { pick(best.entity_id); };

    el("ccSearch").addEventListener("change", function () {
      var v = this.value.trim().toLowerCase();
      var hit = ents.find(function (r) { return (r.cost_center + " — " + r.site_name).toLowerCase() === v || r.entity_id.toLowerCase() === v; });
      if (!hit) hit = ents.find(function (r) { return r.cost_center.toLowerCase().indexOf(v) >= 0 || r.site_name.toLowerCase().indexOf(v) >= 0; });
      if (hit) renderEntity(hit.entity_id);
    });

    pick(worst.entity_id);
  }
  function pick(eid) {
    var r = ccIndex[eid];
    el("ccSearch").value = r.cost_center + " — " + r.site_name;
    renderEntity(eid);
  }

  function renderEntity(eid) {
    var r = ccIndex[eid];
    var d = D.detail[eid] || { monthly: [], by_account: [] };
    var isRisk = RISK_SITES.indexOf(r.site_name) >= 0 && r.is_frontline;

    var risk = "";
    if (r.variance_pct != null && r.variance_pct > 0.20) risk += '<span class="pill pill-off">High variance</span> ';
    if (isRisk) risk += '<span class="pill pill-risk">Flagged site</span>';

    var acctRows = d.by_account.map(function (a) {
      var v = a[1] > 0 ? (a[2] - a[1]) / a[1] : null;
      var color = v != null && v > 0.10 ? C.red : v != null && v > 0.03 ? C.amber : "var(--ink)";
      return "<tr><td>" + esc(a[0]) + '</td><td class="num">' + money(a[1]) + '</td><td class="num">' + money(a[2]) +
        '</td><td class="num" style="color:' + color + ';">' + (v != null ? signedPct1(v) : "—") + "</td></tr>";
    }).join("");

    el("p4Body").innerHTML =
      '<div class="panel" style="margin-bottom:12px;">' +
        '<p class="p-title" style="font-size:16px;">' + esc(r.cost_center) + " — " + esc(r.site_name) +
        ' <span class="mono" style="font-size:11px; color:var(--muted); font-weight:400;">' + esc(r.entity_id) + "</span>" +
        '<span style="margin-left:auto;">' + risk + "</span></p>" +
        '<div class="profile-strip">' +
          '<div class="f"><div class="l">Function</div><div class="v">' + esc(r.function) + "</div></div>" +
          '<div class="f"><div class="l">Region</div><div class="v">' + esc(r.region) + "</div></div>" +
          '<div class="f"><div class="l">Site type</div><div class="v">' + (r.is_frontline ? "Frontline" : "Corporate") + "</div></div>" +
          '<div class="f"><div class="l">3-yr budget</div><div class="v">' + money(r.budget) + "</div></div>" +
        "</div></div>" +

      '<div class="kpi-row">' +
        kpiCard("3-yr budget", money(r.budget), "2023–2025", "") +
        kpiCard("3-yr actual", money(r.actual), "2023–2025", "") +
        kpiCard("Variance $", (r.actual - r.budget >= 0 ? "+" : "") + money(r.actual - r.budget), "actual − budget", r.actual - r.budget > 0 ? "down" : "up") +
        kpiCard("Variance %", r.variance_pct != null ? signedPct1(r.variance_pct) : "—", "vs 3-yr budget", r.variance_pct != null && r.variance_pct > 0.05 ? "down" : "up") +
      "</div>" +

      '<div class="panel"><p class="p-title">Spend by account <span class="hint">2023–2025, sorted by budget</span></p>' +
        '<table class="dtable"><thead><tr><th>Account</th><th class="num">Budget</th><th class="num">Actual</th><th class="num">Variance</th></tr></thead><tbody>' +
        acctRows + "</tbody></table></div>";
  }

  /* ======================================================================
     PAGE 5 — KPI governance
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

  function fillSelect(id, values) {
    var s = el(id);
    values.forEach(function (v) {
      var o = document.createElement("option");
      o.value = String(v); o.textContent = String(v);
      s.appendChild(o);
    });
  }
  fillSelect("fRegion", M.regions);
  fillSelect("fCC", M.cost_centers);
  fillSelect("fYear", M.years);

  function onFilter() {
    F.r = el("fRegion").value; F.c = el("fCC").value; F.y = el("fYear").value;
    renderP1(); renderP2(); renderP3();
  }
  ["fRegion", "fCC", "fYear"].forEach(function (id) { el(id).addEventListener("change", onFilter); });
  el("fReset").addEventListener("click", function () {
    el("fRegion").value = el("fCC").value = el("fYear").value = "All";
    onFilter();
  });

  /* ---------------- boot ---------------- */
  el("asOf").textContent = "as of " + M.as_of + " · synthetic dataset";
  el("footGen").textContent = "pipeline build " + D.meta.generated_at;
  renderP1(); renderP2(); renderP3();
})();
