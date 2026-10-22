/* ==========================================================================
   Big Six dashboard - data layer.
   A tiny `dash` API over window.BIG6_DATA (written by pipeline/big6/build_dashboard_data.py):
     dash.data(id)            -> {status, data, columns} for a table or a derived table
     dash.calc(id, {inputs, fn}) registers a derived table, computed once from its inputs
     dash.onData(fn)          runs fn now, again on resize and when a filter changes
     dash.params() / setParams({...})   shared filters (the club picker)
     dash.setLink(name)       keeps the open tab in the URL (#sales etc.)
     dash.colors              eight series colours, Man City first
   ========================================================================== */
(function () {
  "use strict";

  var payload = window.BIG6_DATA || { datasets: {} };
  var tables = {};
  Object.keys(payload.datasets).forEach(function (id) {
    var t = payload.datasets[id];
    tables[id] = t.rows.map(function (row) {
      var o = {};
      t.columns.forEach(function (c, i) { o[c] = row[i]; });
      return o;
    });
  });

  var calcs = {};
  var cache = {};
  var listeners = [];
  var params = { club: "Man City" };

  function data(id) {
    if (tables[id]) return { status: "ok", data: tables[id], columns: payload.datasets[id].columns, refreshing: false, meta: [] };
    var c = calcs[id];
    if (!c) return { status: "missing", data: [], message: "No table named " + id };
    if (!(id in cache)) {
      var inputs = c.inputs.map(data);
      var bad = inputs.filter(function (s) { return s.status !== "ok"; })[0];
      if (bad) return { status: "error", data: [], message: bad.message };
      try {
        cache[id] = c.fn.apply(null, inputs.map(function (s) { return s.data; }));
      } catch (e) {
        console.error("calc " + id + " failed", e);
        return { status: "error", data: [], message: String(e) };
      }
    }
    return { status: "ok", data: cache[id], refreshing: false, meta: [] };
  }

  function fire() { listeners.forEach(function (fn) { fn(); }); }

  var resizeTimer = null;
  var lastWidth = window.innerWidth;
  window.addEventListener("resize", function () {
    if (window.innerWidth === lastWidth) return;
    lastWidth = window.innerWidth;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(fire, 150);
  });

  window.dash = {
    colors: ["var(--b6-c0)", "var(--b6-c1)", "var(--b6-c2)", "var(--b6-c3)", "var(--b6-c4)", "var(--b6-c5)", "var(--b6-c6)", "var(--b6-c7)"],
    data: data,
    calc: function (id, def) { calcs[id] = def; delete cache[id]; },
    onData: function (fn) { listeners.push(fn); fn(); },
    params: function () { return Object.assign({}, params); },
    setParams: function (p) { Object.assign(params, p); fire(); },
    resetParams: function () { params = { club: "Man City" }; fire(); },
    setLink: function (name) {
      try { history.replaceState(null, "", "#" + encodeURIComponent(name)); } catch (e) { /* file:// in some browsers */ }
    },
    refresh: function () {},
  };
})();
