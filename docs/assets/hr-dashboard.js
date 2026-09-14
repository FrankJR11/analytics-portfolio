/* ==========================================================================
   Workforce & Safety Dashboard — all computation happens client-side on the
   pre-aggregated tables in assets/hr-data.js (built by
   pipeline/build_hr_dashboard_data.py).
   ========================================================================== */
(function () {
  "use strict";

  var D = window.HR;
  if (!D) {
    document.querySelector(".dash-main .wrap").innerHTML =
      '<div class="panel"><p class="nodata">hr-data.js not found. Run <span class="mono">python pipeline/build_hr_dashboard_data.py</span> and reload.</p></div>';
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
  var F = { r: "All", d: "All", y: "All" };
  var M = D.meta;
  var DEPT_COLORS = {}; // filled once department list is known, cycling a fixed palette
  (function () {
    var palette = [C.red, C.petrol, C.amber, C.blue, C.soft, "#9aa7a4", C.petrolDeep, "#c98a2e", "#5a7d8c", "#8c5a7d", "#7d8c5a"];
    M.departments.forEach(function (d, i) { DEPT_COLORS[d] = palette[i % palette.length]; });
  })();

  function inScopeRD(row) {
    return (F.r === "All" || row.region === F.r) && (F.d === "All" || row.department === F.d);
  }
  function inScopeM(row) { return inScopeRD(row) && (F.y === "All" || row.m.slice(0, 4) === F.y); }
  function monthsInScope() {
    if (F.y === "All") return M.months;
    return M.months.filter(function (m) { return m.slice(0, 4) === F.y; });
  }
  function scopeLabel() {
    var parts = [];
    if (F.r !== "All") parts.push(F.r);
    if (F.d !== "All") parts.push(F.d);
    parts.push(F.y === "All" ? "2023–2025" : F.y);
    return parts.join(" · ");
  }
  function trailing12(endMonth) {
    var idx = M.months.indexOf(endMonth);
    return M.months.slice(Math.max(0, idx - 11), idx + 1);
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
    var months = monthsInScope();
    var lastM = months[months.length - 1];
    var t12 = trailing12(lastM);

    var wfScope = rows("workforce_monthly").filter(inScopeM);
    var headcount = sum(wfScope.filter(function (r) { return r.m === lastM; }), "headcount_n");

    var wfT12 = rows("workforce_monthly").filter(function (r) { return inScopeRD(r) && t12.indexOf(r.m) >= 0; });
    var avgHc = wfT12.length ? sum(wfT12, "headcount_n") / t12.length : 0;
    var termsT12 = rows("terms_monthly").filter(function (r) { return inScopeRD(r) && t12.indexOf(r.m) >= 0; });
    var attrition = avgHc > 0 ? sum(termsT12, "voluntary_n") / avgHc : null;

    var incT12 = rows("incidents_monthly").filter(function (r) { return inScopeRD(r) && t12.indexOf(r.m) >= 0; });
    var hoursT12 = sum(wfT12, "regular_hours") + sum(wfT12, "overtime_hours");
    var trir = hoursT12 > 0 ? sum(incT12, "recordable_n") / hoursT12 * 200000 : null;

    var cohortRows = rows("cohort").filter(function (r) { return F.r === "All" || r.region === F.r; })
      .filter(function (r) { return F.d === "All" || r.department === F.d; });
    var cohortN = sum(cohortRows, "cohort_n"), cohortLeft = sum(cohortRows, "left_within_1yr_n");
    var firstYear = cohortN > 0 ? cohortLeft / cohortN : null;

    el("filterEcho").textContent = num(headcount) + " headcount in scope";

    el("p1Kpis").innerHTML =
      kpiCard("Headcount", num(headcount), "at " + lastM + " month-end", "") +
      kpiCard("Attrition (trailing 12mo)", attrition != null ? pct1(attrition) : "—",
        attrition != null ? (attrition > 0.15 ? "▲ +" + ((attrition - 0.15) * 100).toFixed(1) + "pp above 15% target" : "within 15% target") : "—",
        attrition != null && attrition > 0.15 ? "down" : "up") +
      kpiCard("TRIR", trir != null ? trir.toFixed(2) : "—",
        trir != null ? (trir > 3.0 ? "▲ above 3.0 target" : "meets ≤3.0 target") : "—",
        trir != null && trir > 3.0 ? "down" : "up") +
      kpiCard("First-year attrition", firstYear != null ? pct1(firstYear) : "—",
        cohortN ? num(cohortLeft) + " of " + num(cohortN) + " 2023–24 hires · target ≤20%" : "—",
        firstYear != null && firstYear > 0.20 ? "warn" : "up");

    /* banner */
    var deptRows = M.departments.map(function (dn) {
      var wr = rows("workforce_monthly").filter(function (r) { return r.department === dn && (F.r === "All" || r.region === F.r) && t12.indexOf(r.m) >= 0; });
      var tr = rows("terms_monthly").filter(function (r) { return r.department === dn && (F.r === "All" || r.region === F.r) && t12.indexOf(r.m) >= 0; });
      var avg = wr.length ? sum(wr, "headcount_n") / t12.length : 0;
      var rate = avg > 0 ? sum(tr, "voluntary_n") / avg : null;
      return { department: dn, rate: rate, headcount: avg };
    }).filter(function (r) { return r.rate != null && r.headcount >= 3; });
    deptRows.sort(function (a, b) { return b.rate - a.rate; });

    if (!wfScope.length) {
      banner("p1Banner", "info", "No activity matches the current filters.");
    } else if (F.d === "All" && deptRows.length) {
      var worst = deptRows[0];
      banner("p1Banner", worst.rate > 0.25 ? "red" : worst.rate > 0.18 ? "amber" : "good",
        "<strong>" + esc(worst.department) + " has the highest attrition at " + pct1(worst.rate) + "</strong> (trailing 12mo) — " +
        (trir != null ? "and TRIR sits at " + trir.toFixed(1) + " against a 3.0 target, concentrated in the same frontline roles." : ""));
    } else {
      banner("p1Banner", attrition != null && attrition > 0.15 ? "amber" : "good",
        "<strong>" + scopeLabel() + ":</strong> attrition " + pct1(attrition) + ", TRIR " + (trir != null ? trir.toFixed(2) : "—") +
        ", first-year attrition " + pct1(firstYear) + ".");
    }

    /* headcount trend */
    var vm = {};
    rows("workforce_monthly").filter(inScopeRD).forEach(function (r) { vm[r.m] = (vm[r.m] || 0) + r.headcount_n; });
    el("p1TrendHint").textContent = scopeLabel();
    drawChart("chTrend", {
      type: "line",
      data: {
        labels: months.map(function (m) { return F.y === "All" ? m : m.slice(5); }),
        datasets: [{ label: "Headcount", data: months.map(function (m) { return vm[m] || null; }),
          borderColor: C.petrol, backgroundColor: "rgba(14,107,92,0.07)", borderWidth: 2, pointRadius: 0, tension: 0.25, fill: true }],
      },
      options: {
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { x: { grid: { display: false }, border: { color: C.line }, ticks: { maxTicksLimit: 12 } },
                  y: { grid: { color: "rgba(20,38,46,0.06)" }, border: { display: false } } },
      },
    });

    /* regional heatmap */
    var html = '<table class="dtable"><thead><tr><th>Region</th><th class="num">Headcount</th><th class="num">Attrition</th><th class="num">TRIR</th><th class="num">OT%</th></tr></thead><tbody>';
    M.regions.forEach(function (rg) {
      var wr = rows("workforce_monthly").filter(function (r) { return r.region === rg && (F.d === "All" || r.department === F.d); });
      var wrLast = wr.filter(function (r) { return r.m === lastM; });
      var hc = sum(wrLast, "headcount_n");
      if (!hc) { html += "<tr><td>" + esc(rg) + '</td><td class="num" colspan="4">—</td></tr>'; return; }
      var wrT12 = wr.filter(function (r) { return t12.indexOf(r.m) >= 0; });
      var avg = sum(wrT12, "headcount_n") / t12.length;
      var tr = rows("terms_monthly").filter(function (r) { return r.region === rg && (F.d === "All" || r.department === F.d) && t12.indexOf(r.m) >= 0; });
      var attrR = avg > 0 ? sum(tr, "voluntary_n") / avg : null;
      var ir = rows("incidents_monthly").filter(function (r) { return r.region === rg && (F.d === "All" || r.department === F.d) && t12.indexOf(r.m) >= 0; });
      var hrs = sum(wrT12, "regular_hours") + sum(wrT12, "overtime_hours");
      var trirR = hrs > 0 ? sum(ir, "recordable_n") / hrs * 200000 : null;
      var otR = hrs > 0 ? sum(wrT12, "overtime_hours") / hrs : null;
      function cls(v, good, risk, invert) {
        if (v == null) return "";
        var ok = invert ? v <= good : v >= good;
        var nr = invert ? v <= risk : v >= risk;
        return ok ? "cell-good" : nr ? "cell-risk" : "cell-off";
      }
      html += "<tr><td>" + esc(rg) + "</td>" +
        '<td class="num">' + num(hc) + "</td>" +
        '<td class="num ' + cls(attrR, 0.15, 0.20, true) + '">' + (attrR != null ? pct1(attrR) : "—") + "</td>" +
        '<td class="num ' + cls(trirR, 3.0, 4.5, true) + '">' + (trirR != null ? trirR.toFixed(1) : "—") + "</td>" +
        '<td class="num ' + cls(otR, 0.08, 0.12, true) + '">' + (otR != null ? pct1(otR) : "—") + "</td></tr>";
    });
    html += "</tbody></table><p class='small' style='margin:10px 0 0;'>Department &amp; year filters apply · rates are trailing-12mo as of " + esc(lastM) + ".</p>";
    el("p1Heatmap").innerHTML = html;

    /* dept bars */
    el("p1DeptHint").textContent = "trailing 12mo · " + (F.r !== "All" ? F.r : "all regions");
    var allDeptRows = M.departments.map(function (dn) {
      var wr = rows("workforce_monthly").filter(function (r) { return r.department === dn && (F.r === "All" || r.region === F.r) && t12.indexOf(r.m) >= 0; });
      var tr = rows("terms_monthly").filter(function (r) { return r.department === dn && (F.r === "All" || r.region === F.r) && t12.indexOf(r.m) >= 0; });
      var avg = wr.length ? sum(wr, "headcount_n") / t12.length : 0;
      return { department: dn, rate: avg > 0 ? sum(tr, "voluntary_n") / avg : 0, headcount: avg };
    }).filter(function (r) { return r.headcount >= 1; }).sort(function (a, b) { return b.rate - a.rate; });
    var maxR = allDeptRows.length ? allDeptRows[0].rate : 0;
    el("p1DeptBars").innerHTML = allDeptRows.map(function (r) {
      return hbar(r.department, pct1(r.rate), maxR ? r.rate / maxR * 100 : 0, DEPT_COLORS[r.department]);
    }).join("");
  }

  /* ======================================================================
     PAGE 2 — Hiring & attrition
     ====================================================================== */
  function renderP2() {
    var months = monthsInScope();
    var firstM = months[0], lastM = months[months.length - 1];

    var wfFirst = sum(rows("workforce_monthly").filter(function (r) { return r.m === firstM && inScopeRD(r); }), "headcount_n");
    var wfLast = sum(rows("workforce_monthly").filter(function (r) { return r.m === lastM && inScopeRD(r); }), "headcount_n");
    var termsScope = rows("terms_monthly").filter(inScopeM);
    var vol = sum(termsScope, "voluntary_n"), invol = sum(termsScope, "involuntary_n");
    var hires = Math.max(0, wfLast - wfFirst + vol + invol);

    el("p2BridgeHint").textContent = scopeLabel() + " · " + firstM + " → " + lastM;
    if (!wfFirst && !wfLast) {
      banner("p2Banner", "info", "No workforce activity matches the current filters.");
      el("p2Bridge").innerHTML = '<p class="nodata">—</p>';
    } else {
      var netChange = wfLast - wfFirst;
      banner("p2Banner", netChange < 0 ? "amber" : "good",
        "<strong>" + scopeLabel() + ": " + num(hires) + " hires, " + num(vol) + " voluntary and " + num(invol) +
        " involuntary exits</strong> — net headcount " + (netChange >= 0 ? "grew by " + num(netChange) : "fell by " + num(Math.abs(netChange))) +
        " (" + num(wfFirst) + " → " + num(wfLast) + ").");

      var stages = [
        ["Starting HC", wfFirst, C.soft],
        ["+ Hires", hires, C.good],
        ["− Voluntary exits", vol, C.red],
        ["− Involuntary exits", invol, C.amber],
        ["Ending HC", wfLast, C.petrolDeep],
      ];
      var maxV = Math.max.apply(null, stages.map(function (s) { return s[1]; }).concat([1]));
      el("p2Bridge").innerHTML = stages.map(function (s) {
        return '<div class="hbar-row"><span class="lab">' + s[0] + '</span>' +
          '<span class="track"><span class="fill" style="width:' + Math.max(s[1] / maxV * 100, 1.5) + "%; background:" + s[2] + ';"></span></span>' +
          '<span class="val">' + num(s[1]) + "</span></div>";
      }).join("");
    }

    /* cohort bars by department */
    el("p2Cohort").innerHTML = (function () {
      var byDept = {};
      rows("cohort").filter(function (r) { return F.r === "All" || r.region === F.r; }).forEach(function (r) {
        byDept[r.department] = byDept[r.department] || { n: 0, left: 0 };
        byDept[r.department].n += r.cohort_n; byDept[r.department].left += r.left_within_1yr_n;
      });
      var arr = Object.keys(byDept).filter(function (d) { return byDept[d].n >= 5; })
        .map(function (d) { return { department: d, rate: byDept[d].left / byDept[d].n, n: byDept[d].n }; })
        .sort(function (a, b) { return b.rate - a.rate; });
      if (!arr.length) return '<p class="nodata">Not enough hires in scope for a cohort view.</p>';
      var maxR = arr[0].rate;
      return arr.map(function (r) { return hbar(r.department + " (n=" + r.n + ")", pct1(r.rate), maxR ? r.rate / maxR * 100 : 0, DEPT_COLORS[r.department]); }).join("");
    })();

    /* time to fill trend */
    var reqScope = rows("reqs").filter(function (r) {
      return (F.r === "All" || r.region === F.r) && (F.d === "All" || r.department === F.d) && r.status === "Filled";
    });
    var byM = {};
    reqScope.forEach(function (r) { byM[r.m_open] = byM[r.m_open] || []; byM[r.m_open].push(r.ttf_days); });
    var series = months.map(function (m) {
      var arr = byM[m];
      return arr && arr.length ? +(sum(arr.map(function (v) { return { v: v }; }), "v") / arr.length).toFixed(1) : null;
    });
    drawChart("chTtf", {
      type: "line",
      data: {
        labels: months.map(function (m) { return F.y === "All" ? m : m.slice(5); }),
        datasets: [
          { label: "Avg time to fill", data: series, borderColor: C.blue, borderWidth: 2, pointRadius: 2, tension: 0.25, spanGaps: true },
          { label: "Target 30d", data: months.map(function () { return 30; }), borderColor: C.red, borderDash: [4, 4], borderWidth: 1, pointRadius: 0 },
        ],
      },
      options: {
        maintainAspectRatio: false,
        plugins: { legend: { labels: { boxWidth: 10 } } },
        scales: { x: { grid: { display: false }, border: { color: C.line }, ticks: { maxTicksLimit: 12 } },
                  y: { grid: { color: "rgba(20,38,46,0.06)" }, border: { display: false }, suggestedMin: 0 } },
      },
    });

    /* departments ranked by attrition table */
    el("p2TableHint").textContent = "trailing 12mo as of " + M.months[M.months.length - 1];
    var t12 = trailing12(M.months[M.months.length - 1]);
    var deptTbl = M.departments.map(function (dn) {
      var wr = rows("workforce_monthly").filter(function (r) { return r.department === dn && (F.r === "All" || r.region === F.r) && t12.indexOf(r.m) >= 0; });
      var tr = rows("terms_monthly").filter(function (r) { return r.department === dn && (F.r === "All" || r.region === F.r) && t12.indexOf(r.m) >= 0; });
      var avg = wr.length ? sum(wr, "headcount_n") / t12.length : 0;
      var lastHc = sum(rows("workforce_monthly").filter(function (r) { return r.department === dn && (F.r === "All" || r.region === F.r) && r.m === M.months[M.months.length - 1]; }), "headcount_n");
      return { department: dn, headcount: lastHc, rate: avg > 0 ? sum(tr, "voluntary_n") / avg : null, vol: sum(tr, "voluntary_n") };
    }).filter(function (r) { return r.headcount > 0; }).sort(function (a, b) { return (b.rate || 0) - (a.rate || 0); });
    el("p2Table").innerHTML = '<table class="dtable"><thead><tr><th>Department</th><th class="num">Headcount</th><th class="num">Voluntary exits</th><th class="num">Attrition</th></tr></thead><tbody>' +
      deptTbl.map(function (r) {
        return "<tr><td>" + esc(r.department) + '</td><td class="num">' + num(r.headcount) + '</td><td class="num">' + num(r.vol) +
          '</td><td class="num" style="color:' + (r.rate > 0.20 ? C.red : r.rate > 0.15 ? C.amber : "var(--ink)") + ';">' + (r.rate != null ? pct1(r.rate) : "—") + "</td></tr>";
      }).join("") + "</tbody></table>";
  }

  /* ======================================================================
     PAGE 3 — Safety & wellbeing
     ====================================================================== */
  function renderP3() {
    var months = monthsInScope();
    var t12 = trailing12(months[months.length - 1]);
    var wfT12 = rows("workforce_monthly").filter(function (r) { return inScopeRD(r) && t12.indexOf(r.m) >= 0; });
    var incT12 = rows("incidents_monthly").filter(function (r) { return inScopeRD(r) && t12.indexOf(r.m) >= 0; });
    var hours = sum(wfT12, "regular_hours") + sum(wfT12, "overtime_hours");
    var trir = hours > 0 ? sum(incT12, "recordable_n") / hours * 200000 : null;
    var ltifr = hours > 0 ? sum(incT12, "lost_time_n") / hours * 200000 : null;
    var otRate = hours > 0 ? sum(wfT12, "overtime_hours") / hours : null;
    var absRate = (sum(wfT12, "regular_hours") + sum(wfT12, "absence_hours")) > 0
      ? sum(wfT12, "absence_hours") / (sum(wfT12, "regular_hours") + sum(wfT12, "absence_hours")) : null;

    el("p3Kpis").innerHTML =
      kpiCard("TRIR", trir != null ? trir.toFixed(2) : "—", "target ≤ 3.0 · trailing 12mo", trir != null && trir > 3.0 ? "down" : "up") +
      kpiCard("LTIFR", ltifr != null ? ltifr.toFixed(2) : "—", "target ≤ 1.0", ltifr != null && ltifr > 1.0 ? "down" : "up") +
      kpiCard("Overtime rate", otRate != null ? pct1(otRate) : "—", "target ≤ 8%", otRate != null && otRate > 0.08 ? "down" : "up") +
      kpiCard("Absenteeism", absRate != null ? pct1(absRate) : "—", "target ≤ 3%", absRate != null && absRate > 0.03 ? "down" : "up");

    var incN = sum(incT12, "incident_n");
    if (!incN) {
      banner("p3Banner", "info", "No incidents in the current scope.");
    } else {
      banner("p3Banner", trir != null && trir > 4.5 ? "red" : trir != null && trir > 3.0 ? "amber" : "good",
        "<strong>" + num(incN) + " incidents in scope, TRIR " + (trir != null ? trir.toFixed(2) : "—") + " against a 3.0 target.</strong> " +
        "Incident risk is highest in the first year of tenure — see the breakdown alongside.");
    }

    /* TRIR trend */
    el("p3TrirHint").textContent = scopeLabel();
    var trirSeries = months.map(function (m) {
      var wr = rows("workforce_monthly").filter(function (r) { return r.m === m && inScopeRD(r); });
      var ir = rows("incidents_monthly").filter(function (r) { return r.m === m && inScopeRD(r); });
      var h = sum(wr, "regular_hours") + sum(wr, "overtime_hours");
      return h > 0 ? +(sum(ir, "recordable_n") / h * 200000).toFixed(2) : null;
    });
    drawChart("chTrir", {
      type: "line",
      data: {
        labels: months.map(function (m) { return F.y === "All" ? m : m.slice(5); }),
        datasets: [
          { label: "TRIR", data: trirSeries, borderColor: C.red, borderWidth: 2, pointRadius: 2, tension: 0.25, spanGaps: true },
          { label: "Target 3.0", data: months.map(function () { return 3.0; }), borderColor: C.ink, borderDash: [4, 4], borderWidth: 1, pointRadius: 0 },
        ],
      },
      options: {
        maintainAspectRatio: false,
        plugins: { legend: { labels: { boxWidth: 10 } } },
        scales: { x: { grid: { display: false }, border: { color: C.line }, ticks: { maxTicksLimit: 12 } },
                  y: { grid: { color: "rgba(20,38,46,0.06)" }, border: { display: false }, suggestedMin: 0 } },
      },
    });

    /* incident rate by tenure band */
    el("p3TenureHint").textContent = "per 100 employee-months · " + scopeLabel();
    var bandOrder = ["0-6mo", "7-12mo", "13-24mo", "25mo+"];
    var byBand = {};
    rows("tenureband").filter(inScopeRD).forEach(function (r) {
      byBand[r.band] = byBand[r.band] || { inc: 0, emp: 0 };
      byBand[r.band].inc += r.incident_n; byBand[r.band].emp += r.employee_month_n;
    });
    var rates = bandOrder.map(function (b) {
      var x = byBand[b];
      return x && x.emp ? x.inc / x.emp * 100 : 0;
    });
    var maxRate = Math.max.apply(null, rates.concat([0.01]));
    el("p3Tenure").innerHTML = bandOrder.map(function (b, i) {
      return hbar(b + " tenure", rates[i].toFixed(1) + " / 100 emp-mo", rates[i] / maxRate * 100, i === 0 ? C.red : i === 1 ? C.amber : C.soft);
    }).join("");

    /* sites by TRIR */
    var sites = rows("sites_roll").filter(function (s) { return s.site_type === "Terminal" && (F.r === "All" || s.region === F.r); })
      .sort(function (a, b) { return (b.trir || 0) - (a.trir || 0); });
    el("p3Sites").innerHTML = sites.length
      ? '<table class="dtable"><thead><tr><th>Site</th><th>Region</th><th class="num">TRIR</th><th class="num">Attrition</th><th class="num">Recordable</th></tr></thead><tbody>' +
        sites.map(function (s) {
          return "<tr><td>" + esc(s.site_name) + "</td><td>" + esc(s.region) + '</td><td class="num" style="color:' +
            (s.trir > 4.5 ? C.red : s.trir > 3.0 ? C.amber : "var(--ink)") + ';">' + (s.trir != null ? s.trir.toFixed(2) : "—") +
            '</td><td class="num">' + (s.attrition_rate_3yr != null ? pct1(s.attrition_rate_3yr) : "—") + '</td><td class="num">' + num(s.recordable_n) + "</td></tr>";
        }).join("") + "</tbody></table>"
      : '<p class="nodata">No sites in scope.</p>';

    /* donut: incident types */
    el("p3DonutHint").textContent = scopeLabel();
    var nearMiss = sum(incT12, "incident_n") - sum(incT12, "recordable_n");
    var lostTime = sum(incT12, "lost_time_n");
    var recordableOnly = sum(incT12, "recordable_n") - lostTime;
    var types = [["Near-Miss", nearMiss, C.soft], ["Recordable", recordableOnly, C.amber], ["Lost-Time", lostTime, C.red]].filter(function (t) { return t[1] > 0; });
    if (types.length) {
      drawChart("chDonut", {
        type: "doughnut",
        data: { labels: types.map(function (t) { return t[0]; }), datasets: [{ data: types.map(function (t) { return t[1]; }), backgroundColor: types.map(function (t) { return t[2]; }), borderWidth: 0 }] },
        options: { maintainAspectRatio: false, cutout: "62%", plugins: { legend: { display: false } } },
      });
      var totT = types.reduce(function (t, x) { return t + x[1]; }, 0);
      el("p3DonutLegend").innerHTML = types.map(function (t) {
        return '<div class="legend" style="margin:0 0 6px;"><span class="li"><span class="sw" style="background:' + t[2] +
          ';"></span>' + t[0] + ' <span class="mono" style="color:var(--muted);">' + pct1(t[1] / totT) + " · " + num(t[1]) + "</span></span></div>";
      }).join("");
    } else {
      if (charts["chDonut"]) { charts["chDonut"].destroy(); delete charts["chDonut"]; }
      el("p3DonutLegend").innerHTML = '<p class="nodata">No incidents in scope.</p>';
    }
  }

  /* ======================================================================
     PAGE 4 — Manager 360
     ====================================================================== */
  var mgrIndex = {};
  var companyAvgAttr = null;
  function initP4() {
    var mgrs = rows("managers");
    var t12 = trailing12(M.months[M.months.length - 1]);
    var wfAll = rows("workforce_monthly").filter(function (r) { return t12.indexOf(r.m) >= 0; });
    var termsAll = rows("terms_monthly").filter(function (r) { return t12.indexOf(r.m) >= 0; });
    var avgHcAll = sum(wfAll, "headcount_n") / t12.length;
    companyAvgAttr = avgHcAll > 0 ? sum(termsAll, "voluntary_n") / avgHcAll : null;

    var dl = el("mgrList");
    var opts = "";
    mgrs.forEach(function (r) { mgrIndex[r.manager_id] = r; opts += '<option value="' + esc(r.manager_id + " — " + r.manager_name) + '"></option>'; });
    dl.innerHTML = opts;

    var byAttr = mgrs.filter(function (r) { return r.team_size >= 3; })
      .sort(function (a, b) { return (b.team_voluntary_terms_1y / b.team_size) - (a.team_voluntary_terms_1y / a.team_size); })[0];
    var byIncidents = mgrs.slice().sort(function (a, b) { return b.team_incidents_n - a.team_incidents_n; })[0];
    var byTeam = mgrs.slice().sort(function (a, b) { return b.team_size - a.team_size; })[0];

    el("qHighestAttrition").onclick = function () { pick(byAttr.manager_id); };
    el("qMostIncidents").onclick = function () { pick(byIncidents.manager_id); };
    el("qBiggestTeam").onclick = function () { pick(byTeam.manager_id); };

    el("mgrSearch").addEventListener("change", function () {
      var v = this.value.trim();
      var id = v.split("—")[0].trim();
      if (mgrIndex[id]) { renderManager(id); return; }
      var lower = v.toLowerCase();
      var hit = mgrs.find(function (r) { return r.manager_id.toLowerCase() === lower || r.manager_name.toLowerCase().indexOf(lower) >= 0; });
      if (hit) renderManager(hit.manager_id);
    });

    pick(byAttr.manager_id);
  }
  function pick(mid) {
    var r = mgrIndex[mid];
    el("mgrSearch").value = mid + " — " + r.manager_name;
    renderManager(mid);
  }
  function goManager(mid) { pick(mid); activateTab("p4"); }

  function renderManager(mid) {
    var r = mgrIndex[mid];
    var d = D.detail[mid] || { reports: [] };
    var teamAttr = r.team_size ? r.team_voluntary_terms_1y / r.team_size : null;

    var risk = "";
    if (companyAvgAttr != null && teamAttr != null && teamAttr > companyAvgAttr * 1.4) risk += '<span class="pill pill-off">High-attrition team</span> ';
    if (r.team_avg_tenure_months != null && r.team_avg_tenure_months < 12) risk += '<span class="pill pill-risk">Below-average tenure</span> ';
    if (r.team_incidents_n >= 5) risk += '<span class="pill pill-off">' + r.team_incidents_n + ' team incidents</span>';

    var stPill = { "Active": "pill-good", "Voluntary exit": "pill-off", "Involuntary exit": "pill-risk" };
    var repRows = d.reports.map(function (rp) {
      return "<tr><td class='mono' style='font-size:12px;'>" + esc(rp[0]) + "</td><td>" + esc(rp[1]) + "</td><td>" + esc(rp[2]) + "</td>" +
        "<td class='mono' style='font-size:12px; color:var(--muted);'>" + esc(rp[3]) + "</td><td class='num'>" + rp[4] + "mo</td>" +
        '<td><span class="pill ' + (stPill[rp[5]] || "pill-info") + '">' + esc(rp[5]) + "</span></td></tr>";
    }).join("");

    el("p4Body").innerHTML =
      '<div class="panel" style="margin-bottom:12px;">' +
        '<p class="p-title" style="font-size:16px;">' + esc(r.manager_name) +
        ' <span class="mono" style="font-size:11px; color:var(--muted); font-weight:400;">' + esc(r.manager_id) + "</span>" +
        '<span style="margin-left:auto;">' + risk + "</span></p>" +
        '<div class="profile-strip">' +
          '<div class="f"><div class="l">Department</div><div class="v">' + esc(r.department) + "</div></div>" +
          '<div class="f"><div class="l">Site</div><div class="v">' + esc(r.site_name) + "</div></div>" +
          '<div class="f"><div class="l">Region</div><div class="v">' + esc(r.region) + "</div></div>" +
          '<div class="f"><div class="l">Role level</div><div class="v">' + esc(r.role_level) + "</div></div>" +
          '<div class="f"><div class="l">Own tenure</div><div class="v">' + r.own_tenure_months + " months</div></div>" +
        "</div></div>" +

      '<div class="kpi-row">' +
        kpiCard("Team size", num(r.team_size), "direct reports", "") +
        kpiCard("Team attrition (1yr)", teamAttr != null ? pct1(teamAttr) : "—",
          companyAvgAttr != null ? "company avg " + pct1(companyAvgAttr) : "", teamAttr != null && companyAvgAttr != null && teamAttr > companyAvgAttr ? "down" : "up") +
        kpiCard("Team avg tenure", r.team_avg_tenure_months != null ? r.team_avg_tenure_months + "mo" : "—", "across current reports", "") +
        kpiCard("Team incidents", num(r.team_incidents_n), "all-time, current reports", r.team_incidents_n >= 5 ? "warn" : "up") +
      "</div>" +

      '<div class="panel"><p class="p-title">Direct reports <span class="hint">current + recent exits</span></p>' +
        '<table class="dtable"><thead><tr><th>ID</th><th>Name</th><th>Role</th><th>Hired</th><th class="num">Tenure</th><th>Status</th></tr></thead><tbody>' +
        repRows + "</tbody></table></div>";
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

  document.addEventListener("click", function (e) {
    var a = e.target.closest("a[data-mgr]");
    if (a) { e.preventDefault(); goManager(a.dataset.mgr); }
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
  fillSelect("fDept", M.departments);
  fillSelect("fYear", M.years);

  function onFilter() {
    F.r = el("fRegion").value; F.d = el("fDept").value; F.y = el("fYear").value;
    renderP1(); renderP2(); renderP3();
  }
  ["fRegion", "fDept", "fYear"].forEach(function (id) { el(id).addEventListener("change", onFilter); });
  el("fReset").addEventListener("click", function () {
    el("fRegion").value = el("fDept").value = el("fYear").value = "All";
    onFilter();
  });

  /* ---------------- boot ---------------- */
  el("asOf").textContent = "as of " + M.as_of + " · synthetic dataset";
  el("footGen").textContent = "pipeline build " + D.meta.generated_at;
  renderP1(); renderP2(); renderP3();
})();
