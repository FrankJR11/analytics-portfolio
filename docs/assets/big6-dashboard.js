/* Big Six transfer dashboard: charts and tables. Reads window.BIG6_DATA through the small `dash`
   API in big6-dash.js (data lookups, derived tables, re-render on resize). */
const CLUBS = ['Man City', 'Arsenal', 'Chelsea', 'Liverpool', 'Man United', 'Tottenham'];
const LAST_CHARGED = '2017/18'; // last season covered by the Premier League's charges (Feb 2023)

dash.calc('club_totals', {
  inputs: ['totals'],
  title: 'Spend per club, all seasons',
  description: 'Each club’s fees added up over every season, split at 2017/18, the last season the charges cover, with ranks.',
  fn: (totals) => {
    const clubs = Array.from(new Set(totals.map((r) => r.club)));
    const r1 = (v) => Math.round(v * 10) / 10;
    const rows = clubs.map((club) => {
      const rs = totals.filter((r) => r.club === club);
      const sum = (keep) => rs.filter(keep).reduce((a, r) => a + Number(r.spend_eur_m), 0);
      const best = rs.reduce((b, r) => (Number(r.spend_eur_m) > Number(b.spend_eur_m) ? r : b), rs[0]);
      const total = r1(sum(() => true));
      const charged = r1(sum((r) => r.season <= '2017/18'));
      const since = r1(sum((r) => r.season > '2017/18'));
      return {
        club,
        total_eur_m: total, charged_eur_m: charged, since_eur_m: since,
        total_eur: total * 1e6, charged_eur: charged * 1e6, since_eur: since * 1e6,
        best_season: best.season, best_season_eur: Number(best.spend_eur_m) * 1e6,
        signings: rs.reduce((a, r) => a + Number(r.signings), 0),
        paid_signings: rs.reduce((a, r) => a + Number(r.paid_signings), 0),
      };
    });
    [...rows].sort((a, b) => b.total_eur_m - a.total_eur_m).forEach((r, i) => { r.total_rank = i + 1; });
    [...rows].sort((a, b) => b.charged_eur_m - a.charged_eur_m).forEach((r, i) => { r.charged_rank = i + 1; });
    return rows;
  },
});

dash.calc('season_matrix', {
  inputs: ['totals'],
  title: 'Season by club grid',
  description: 'The per-season spend laid out with one column per club, plus an all-seasons total row.',
  fn: (totals) => {
    const seasons = Array.from(new Set(totals.map((r) => r.season))).sort();
    const rows = seasons.map((s) => {
      const o = { season: s };
      totals.filter((r) => r.season === s).forEach((r) => { o[r.club] = Number(r.spend_eur_m); });
      return o;
    });
    const all = { season: 'All seasons' };
    totals.forEach((r) => { all[r.club] = (all[r.club] || 0) + Number(r.spend_eur_m); });
    Object.keys(all).forEach((k) => { if (k !== 'season') all[k] = Math.round(all[k] * 10) / 10; });
    return rows.concat([all]);
  },
});

dash.calc('signing_src', {
  inputs: ['signings', 'source_list'],
  title: 'Source name per signing',
  description: 'Looks up the full source name for each signing’s source code.',
  fn: (signings, source_list) => {
    const name = {};
    source_list.forEach((s) => { name[s.key] = s.name; });
    return signings.map((r) => ({ id: r.id, source: name[r.src] || r.src }));
  },
});

const colorOf = (club) => dash.colors[CLUBS.indexOf(club)];
const fmtM = (v) => (v == null || Number.isNaN(v) ? '—' : v >= 1000 ? `€${(v / 1000).toFixed(2)}bn` : `€${d3.format(',.1f')(v)}m`);
const fmtE = (v) => (v == null ? '—' : fmtM(v / 1e6));
const ordinal = (n) => ({ 1: '1st', 2: '2nd', 3: '3rd' }[n] || `${n}th`);
const whereVal = (v) => String(v).replace(/%/g, '%25').replace(/&/g, '%26').replace(/=/g, '%3D');
const failed = (st) => st.status === 'error';
const failNote = () => { const d = document.createElement('div'); d.className = 'bx-fail'; d.textContent = 'Failed to load'; return d; };
const loading = (el, st) => el.classList.toggle('dash-skeleton', st.status === 'loading');

let focusClub = null;
let sortKey = 'season';
let sortAsc = true;
let firstDraw = true;

// ---------- legends (constant club list) ----------
const legend = document.getElementById('trend-legend');
CLUBS.forEach((club) => {
  const b = document.createElement('button');
  b.className = 'bx-leg';
  b.dataset.club = club;
  b.setAttribute('aria-pressed', 'false');
  const sw = document.createElement('span');
  sw.className = 'bx-sw';
  sw.style.background = colorOf(club);
  b.append(sw, document.createTextNode(club));
  b.addEventListener('click', () => { focusClub = focusClub === club ? null : club; drawTrend(); syncLegend(); });
  legend.append(b);
});
function syncLegend() {
  legend.querySelectorAll('.bx-leg').forEach((b) => {
    const on = focusClub === b.dataset.club;
    b.setAttribute('aria-pressed', String(on));
    b.classList.toggle('bx-dim', focusClub !== null && !on);
  });
}

const rankLegend = document.getElementById('rank-legend');
[['2009/10 to 2017/18 (charged)', () => dash.colors[0]], ['2018/19 to summer 2026', () => 'var(--cds-chart-muted)']].forEach(([label, col]) => {
  const s = document.createElement('span');
  s.className = 'bx-leg';
  const sw = document.createElement('span');
  sw.className = 'bx-sw';
  sw.style.background = col();
  s.append(sw, document.createTextNode(label));
  rankLegend.append(s);
});

// ---------- headline ----------
function setText(id, text, st) {
  const el = document.getElementById(id);
  el.textContent = text;
  if (st) el.classList.toggle('dash-skeleton', st.status === 'loading');
}
function drawHeadline() {
  const st = dash.data('club_totals');
  const rows = st.status === 'ok' ? st.data : [];
  const city = rows.find((r) => r.club === 'Man City');
  const ok = Boolean(city);
  setText('tk-city-total', ok ? fmtE(city.total_eur) : '—', st);
  setText('tk-city-rank', ok ? ordinal(city.total_rank) : '—', st);
  setText('tk-city-charged', ok ? fmtE(city.charged_eur) : '—', st);
  setText('tk-city-crank', ok ? ordinal(city.charged_rank) : '—', st);
  const leader = rows.find((r) => r.total_rank === 1);
  const wrap = document.getElementById('tk-leader-wrap');
  if (ok && leader && leader.club !== 'Man City') {
    wrap.hidden = false;
    const w = `club=${whereVal(leader.club)}`;
    document.getElementById('tk-leader').dataset.where = w;
    document.getElementById('tk-leader-total').dataset.where = w;
    setText('tk-leader', leader.club, st);
    setText('tk-leader-total', fmtE(leader.total_eur), st);
  } else {
    wrap.hidden = ok;
    setText('tk-leader', '—', st);
    setText('tk-leader-total', '—', st);
  }
  setText('kpi-total', ok ? fmtE(city.total_eur) : '—', st);
  setText('kpi-charged', ok ? fmtE(city.charged_eur) : '—', st);
  setText('kpi-since', ok ? fmtE(city.since_eur) : '—');
  setText('kpi-best', ok ? fmtE(city.best_season_eur) : '—', st);
  setText('kpi-best-season', ok ? city.best_season : '—');
  setText('kpi-moves', ok ? d3.format(',')(city.signings) : '—', st);
  setText('kpi-paid', ok ? d3.format(',')(city.paid_signings) : '—');
}

// ---------- trend chart ----------
function drawTrend() {
  const box = document.getElementById('trend-chart');
  const st = dash.data('totals');
  loading(box, st);
  box.replaceChildren();
  if (st.status !== 'ok') { if (failed(st)) box.append(failNote()); return; }
  const rows = st.data.map((r) => ({ season: r.season, club: r.club, v: Number(r.spend_eur_m) }));
  const seasons = Array.from(new Set(rows.map((r) => r.season))).sort();
  const W = Math.max(280, box.clientWidth);
  const H = W < 520 ? 280 : 360;
  const m = { top: 30, right: 10, bottom: 26, left: 0 };
  const svg = d3.select(box).append('svg').attr('width', '100%').attr('viewBox', `0 0 ${W} ${H}`)
    .attr('role', 'img').attr('aria-label', 'Transfer spend per season by club');
  if (firstDraw) svg.attr('class', 'bx-fade');
  const y = d3.scaleLinear([0, d3.max(rows, (r) => r.v)], [H - m.bottom, m.top]).nice();
  const yt = y.ticks(5);
  const tickLabel = (t) => (t === 0 ? '€0' : `€${d3.format(',')(t)}m`);
  let wMax = 0;
  const probe = svg.append('g');
  yt.forEach((t) => { wMax = Math.max(wMax, probe.append('text').attr('class', 'bx-tick').text(tickLabel(t)).node().getComputedTextLength()); });
  probe.remove();
  m.left = Math.ceil(wMax) + 10;
  const x = d3.scalePoint(seasons, [m.left, W - m.right]).padding(0.4);
  const step = x.step();

  const x0 = x(seasons[0]) - step / 2;
  const x1 = (x(LAST_CHARGED) ?? x(seasons[0])) + step / 2;
  svg.append('rect').attr('x', x0).attr('y', m.top).attr('width', Math.max(0, x1 - x0)).attr('height', H - m.top - m.bottom)
    .style('fill', 'color-mix(in srgb, var(--cds-chart-reference) 14%, transparent)');
  svg.append('text').attr('class', 'bx-band-label').attr('x', x0 + 6).attr('y', m.top - 10).text('Seasons covered by the charges');

  const grid = svg.append('g');
  yt.forEach((t) => {
    grid.append('line').attr('x1', m.left).attr('x2', W - m.right).attr('y1', y(t)).attr('y2', y(t)).style('stroke', 'var(--cds-chart-grid)');
    grid.append('text').attr('class', 'bx-tick').attr('x', m.left - 8).attr('y', y(t)).attr('dy', '0.32em').attr('text-anchor', 'end').text(tickLabel(t));
  });
  svg.append('line').attr('x1', m.left).attr('x2', W - m.right).attr('y1', y(0)).attr('y2', y(0)).style('stroke', 'var(--cds-chart-axis)');

  const every = Math.max(1, Math.ceil(46 / step));
  seasons.forEach((s, i) => {
    if (i % every !== 0) return;
    svg.append('text').attr('class', 'bx-tick').attr('x', x(s)).attr('y', H - m.bottom + 17).attr('text-anchor', 'middle').text(s.slice(2));
  });

  const line = d3.line().x((d) => x(d.season)).y((d) => y(d.v));
  const order = CLUBS.slice(1).concat(['Man City']).filter((c) => c !== focusClub).concat(focusClub ? [focusClub] : []);
  order.forEach((club) => {
    const pts = seasons.map((s) => rows.find((r) => r.club === club && r.season === s)).filter(Boolean);
    const isCity = club === 'Man City';
    const op = focusClub ? (club === focusClub ? 1 : 0.15) : (isCity ? 1 : 0.8);
    svg.append('path').datum(pts).attr('d', line)
      .style('fill', 'none').style('stroke', colorOf(club))
      .attr('stroke-width', isCity || club === focusClub ? 3 : 2)
      .attr('stroke-linecap', 'round').attr('stroke-linejoin', 'round').attr('opacity', op);
  });

  const rule = svg.append('line').attr('y1', m.top).attr('y2', H - m.bottom).style('stroke', 'var(--cds-chart-axis)').attr('opacity', 0);
  const dots = svg.append('g');
  const tip = document.createElement('div');
  tip.className = 'bx-tip';
  tip.hidden = true;
  box.append(tip);

  const show = (season) => {
    const sx = x(season);
    rule.attr('x1', sx).attr('x2', sx).attr('opacity', 1);
    const here = rows.filter((r) => r.season === season).sort((a, b) => b.v - a.v);
    dots.selectAll('circle').data(here).join('circle').attr('cx', sx).attr('cy', (d) => y(d.v)).attr('r', 3.5)
      .style('fill', (d) => colorOf(d.club)).style('stroke', 'var(--color-panel)').attr('stroke-width', 1.5);
    const head = document.createElement('div');
    head.className = 'bx-tip-head';
    head.textContent = season === seasons[seasons.length - 1] ? `${season} (summer only)` : season;
    tip.replaceChildren(head);
    here.forEach((d) => {
      const row = document.createElement('div');
      row.className = 'bx-tip-row';
      const sw = document.createElement('span');
      sw.className = 'bx-sw';
      sw.style.background = colorOf(d.club);
      const name = document.createElement('span');
      name.textContent = d.club;
      const val = document.createElement('span');
      val.className = 'bx-tip-v';
      val.textContent = fmtM(d.v);
      row.append(sw, name, val);
      tip.append(row);
    });
    tip.hidden = false;
    const ratio = box.getBoundingClientRect().width / W;
    const tw = tip.offsetWidth;
    let left = sx * ratio + 14;
    if (left + tw > box.clientWidth) left = sx * ratio - tw - 14;
    tip.style.left = `${Math.max(0, left)}px`;
    tip.style.top = `${m.top * ratio}px`;
  };
  const hide = () => { tip.hidden = true; rule.attr('opacity', 0); dots.selectAll('circle').remove(); };
  svg.append('rect').attr('x', m.left).attr('y', m.top).attr('width', W - m.left - m.right).attr('height', H - m.top - m.bottom)
    .style('fill', 'transparent')
    .on('pointermove', (ev) => {
      const [px] = d3.pointer(ev);
      const i = Math.max(0, Math.min(seasons.length - 1, Math.round((px - x(seasons[0])) / step)));
      show(seasons[i]);
    })
    .on('pointerleave', hide);
}

// ---------- ranking chart ----------
function drawRanking() {
  const box = document.getElementById('rank-chart');
  const st = dash.data('club_totals');
  loading(box, st);
  box.replaceChildren();
  if (st.status !== 'ok') { if (failed(st)) box.append(failNote()); return; }
  const rows = [...st.data].sort((a, b) => b.total_eur_m - a.total_eur_m);
  const W = Math.max(280, box.clientWidth);
  const bar = 26;
  const gap = 18;
  const m = { top: 4, right: 0, bottom: 4, left: 0 };
  const H = m.top + m.bottom + rows.length * (bar + gap) - gap;
  box.style.minHeight = `${H}px`;
  const svg = d3.select(box).append('svg').attr('width', '100%').attr('viewBox', `0 0 ${W} ${H}`)
    .attr('role', 'img').attr('aria-label', 'Total transfer spend by club');
  if (firstDraw) svg.attr('class', 'bx-fade');
  let labW = 0;
  let valW = 0;
  const probe = svg.append('g');
  rows.forEach((r) => {
    labW = Math.max(labW, probe.append('text').attr('class', 'bx-tick').text(r.club).node().getComputedTextLength());
    valW = Math.max(valW, probe.append('text').attr('class', 'bx-tick').text(fmtM(r.total_eur_m)).node().getComputedTextLength());
  });
  probe.remove();
  m.left = Math.ceil(labW) + 12;
  m.right = Math.ceil(valW) + 10;
  const x = d3.scaleLinear([0, d3.max(rows, (r) => r.total_eur_m)], [m.left, W - m.right]);
  const tip = document.createElement('div');
  tip.className = 'bx-tip';
  tip.hidden = true;
  box.append(tip);
  rows.forEach((r, i) => {
    const yy = m.top + i * (bar + gap);
    const g = svg.append('g');
    g.append('text').attr('class', 'bx-tick').attr('x', m.left - 10).attr('y', yy + bar / 2).attr('dy', '0.32em').attr('text-anchor', 'end')
      .style('fill', r.club === 'Man City' ? 'var(--color-fg)' : 'var(--color-fg-muted)').text(r.club);
    g.append('rect').attr('x', x(0)).attr('y', yy).attr('height', bar).attr('width', Math.max(0, x(r.total_eur_m) - x(0))).attr('rx', 4)
      .style('fill', 'var(--cds-chart-muted)');
    g.append('rect').attr('x', x(0)).attr('y', yy).attr('height', bar).attr('width', Math.max(0, x(r.charged_eur_m) - x(0))).attr('rx', 4)
      .style('fill', dash.colors[0]);
    g.append('text').attr('class', 'bx-tick').attr('x', x(r.total_eur_m) + 8).attr('y', yy + bar / 2).attr('dy', '0.32em')
      .style('fill', 'var(--color-fg)').text(fmtM(r.total_eur_m));
    g.append('rect').attr('x', 0).attr('y', yy - gap / 2).attr('width', W).attr('height', bar + gap).style('fill', 'transparent')
      .on('pointerenter', () => {
        const head = document.createElement('div');
        head.className = 'bx-tip-head';
        head.textContent = r.club;
        tip.replaceChildren(head);
        [['Charged seasons', r.charged_eur_m, dash.colors[0]], ['Since 2018/19', r.since_eur_m, 'var(--cds-chart-muted)'], ['Total', r.total_eur_m, null]].forEach(([label, v, col]) => {
          const row = document.createElement('div');
          row.className = 'bx-tip-row';
          const sw = document.createElement('span');
          sw.className = 'bx-sw';
          if (col) sw.style.background = col;
          const name = document.createElement('span');
          name.textContent = label;
          const val = document.createElement('span');
          val.className = 'bx-tip-v';
          val.textContent = fmtM(v);
          row.append(sw, name, val);
          tip.append(row);
        });
        tip.hidden = false;
        const ratio = box.getBoundingClientRect().width / W;
        const tw = tip.offsetWidth;
        let left = x(r.charged_eur_m) * ratio;
        if (left + tw > box.clientWidth) left = box.clientWidth - tw;
        tip.style.left = `${Math.max(0, left)}px`;
        const below = (yy + bar + 6) * ratio;
        tip.style.top = `${i < rows.length / 2 ? below : Math.max(0, yy * ratio - tip.offsetHeight - 6)}px`;
      })
      .on('pointerleave', () => { tip.hidden = true; });
  });
}

// ---------- season x club grid ----------
function drawMatrix() {
  const head = document.getElementById('matrix-head');
  const body = document.getElementById('matrix-body');
  const st = dash.data('season_matrix');
  if (!head.children.length) {
    const th = document.createElement('th');
    th.dataset.field = 'season';
    th.textContent = 'Season';
    head.append(th);
    CLUBS.forEach((c) => {
      const h = document.createElement('th');
      h.dataset.field = c;
      h.className = c === 'Man City' ? 'bx-num bx-city' : 'bx-num';
      h.textContent = c;
      head.append(h);
    });
  }
  body.replaceChildren();
  if (st.status !== 'ok') {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = CLUBS.length + 1;
    if (failed(st)) td.append(failNote());
    else { td.textContent = '—'; td.classList.toggle('dash-skeleton', st.status === 'loading'); }
    tr.append(td);
    body.append(tr);
    return;
  }
  const seasonRows = st.data.filter((r) => r.season !== 'All seasons');
  const max = d3.max(seasonRows, (r) => d3.max(CLUBS, (c) => Number(r[c]) || 0)) || 1;
  st.data.forEach((r) => {
    const tr = document.createElement('tr');
    const isTotal = r.season === 'All seasons';
    if (isTotal) tr.className = 'bx-total';
    const td0 = document.createElement('td');
    td0.textContent = r.season;
    tr.append(td0);
    CLUBS.forEach((c) => {
      const td = document.createElement('td');
      td.className = 'bx-num';
      const v = r[c];
      td.textContent = v == null ? '—' : d3.format(',.1f')(Number(v));
      if (!isTotal && v != null) {
        const pct = Math.round(4 + 46 * (Number(v) / max));
        td.style.background = `color-mix(in srgb, ${colorOf('Man City')} ${pct}%, transparent)`;
      }
      tr.append(td);
    });
    body.append(tr);
  });
}

// ---------- signing list ----------
const pick = document.getElementById('club-pick');
CLUBS.forEach((c) => pick.append(new Option(c, c)));
pick.addEventListener('change', () => dash.setParams({ club: pick.value }));
const search = document.getElementById('sign-search');
search.addEventListener('input', () => drawSignings());
const paidOnly = document.getElementById('paid-only');
paidOnly.addEventListener('change', () => drawSignings());
document.querySelectorAll('#sign-table .bx-sort').forEach((b) => {
  b.addEventListener('click', () => {
    const k = b.dataset.k;
    if (sortKey === k) sortAsc = !sortAsc;
    else { sortKey = k; sortAsc = !(k === 'fee_eur' || k === 'fee_gbp_reported'); }
    drawSignings();
  });
});

function drawSignings() {
  const club = dash.params().club || 'Man City';
  pick.value = club;
  const w = `club=${whereVal(club)}`;
  ['sum-club', 'sum-moves', 'sum-total'].forEach((id) => { document.getElementById(id).dataset.where = w; });
  const ct = dash.data('club_totals');
  const row = ct.status === 'ok' ? ct.data.find((r) => r.club === club) : null;
  setText('sum-club', row ? row.club : '—');
  setText('sum-moves', row ? d3.format(',')(row.signings) : '—');
  setText('sum-total', row ? fmtE(row.total_eur) : '—');

  document.querySelectorAll('#sign-table th').forEach((th) => {
    const k = th.querySelector('.bx-sort')?.dataset.k;
    if (k === sortKey) th.setAttribute('aria-sort', sortAsc ? 'ascending' : 'descending');
    else th.removeAttribute('aria-sort');
  });

  const body = document.getElementById('sign-body');
  body.replaceChildren();
  const st = dash.data('signings');
  if (st.status !== 'ok') {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 8;
    if (failed(st)) td.append(failNote());
    else { td.textContent = '—'; td.classList.toggle('dash-skeleton', st.status === 'loading'); }
    tr.append(td);
    body.append(tr);
    return;
  }
  const srcSt = dash.data('signing_src');
  const srcName = {};
  if (srcSt.status === 'ok') srcSt.data.forEach((r) => { srcName[r.id] = r.source; });
  const q = search.value.trim().toLowerCase();
  let list = st.data.filter((r) => r.club === club);
  if (paidOnly.checked) list = list.filter((r) => Number(r.fee_eur) > 0);
  if (q) list = list.filter((r) => `${r.player} ${r.from}`.toLowerCase().includes(q));
  const val = (r, k) => (k === 'source' ? srcName[r.id] || '' : r[k]);
  const num = (v) => (v == null || v === '' ? -1 : Number(v));
  const isNum = sortKey === 'fee_eur' || sortKey === 'fee_gbp_reported';
  list.sort((a, b) => {
    const va = val(a, sortKey);
    const vb = val(b, sortKey);
    let c = isNum ? num(va) - num(vb) : String(va ?? '').localeCompare(String(vb ?? ''));
    if (!sortAsc) c = -c;
    if (c === 0) c = (a.window === b.window ? 0 : a.window === 'Summer' ? -1 : 1) || num(b.fee_eur) - num(a.fee_eur);
    return c;
  });
  const f2 = d3.format(',.2~f');
  list.forEach((r) => {
    const tr = document.createElement('tr');
    tr.dataset.key = r.id;
    const cells = [
      r.season, r.window, r.player, r.from, r.type,
      r.fee_eur == null ? '—' : f2(Number(r.fee_eur)),
      r.fee_gbp_reported == null ? '—' : f2(Number(r.fee_gbp_reported)),
      srcName[r.id] || '—',
    ];
    cells.forEach((t, i) => {
      const td = document.createElement('td');
      if (i === 5 || i === 6) td.className = 'bx-num';
      td.textContent = t;
      tr.append(td);
    });
    body.append(tr);
  });
  document.getElementById('sign-empty').hidden = list.length > 0;
}

// ---------- sources ----------
function drawSources() {
  const body = document.getElementById('src-body');
  body.replaceChildren();
  const st = dash.data('source_list');
  if (st.status === 'ok') {
    st.data.forEach((r) => {
      const tr = document.createElement('tr');
      tr.dataset.key = r.key;
      const td1 = document.createElement('td');
      const a = document.createElement('a');
      a.href = r.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = r.name;
      td1.append(a);
      const td2 = document.createElement('td');
      td2.textContent = r.covers;
      tr.append(td1, td2);
      body.append(tr);
    });
  } else if (failed(st)) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 2;
    td.append(failNote());
    tr.append(td);
    body.append(tr);
  }
  const fb = document.getElementById('fx-body');
  fb.replaceChildren();
  const fx = dash.data('fx');
  if (fx.status === 'ok') {
    fx.data.forEach((r) => {
      const tr = document.createElement('tr');
      tr.dataset.key = r.year;
      const td1 = document.createElement('td');
      td1.textContent = r.year;
      const td2 = document.createElement('td');
      td2.className = 'bx-num';
      td2.textContent = d3.format('.4f')(Number(r.gbp_to_eur));
      tr.append(td1, td2);
      fb.append(tr);
    });
  } else if (failed(fx)) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 2;
    td.append(failNote());
    tr.append(td);
    fb.append(tr);
  }
}

// =================== City's seasons page ===================
dash.calc('city_season_summary', {
  inputs: ['competitions', 'city_revenue', 'league_positions', 'totals'],
  title: 'City season summary',
  description: 'Per season for Man City: games and trophies from the competition list, league position, revenue by stream, revenue per game played, and transfer spend as a share of revenue.',
  fn: (competitions, city_revenue, league_positions, totals) => {
    const cityComps = competitions.filter((r) => r.club === 'Man City');
    const seasons = Array.from(new Set(cityComps.map((r) => r.season))).sort();
    const r2 = (v) => Math.round(v * 100) / 100;
    return seasons.map((s) => {
      const comps = cityComps.filter((r) => r.season === s);
      const games = comps.reduce((a, r) => a + Number(r.games), 0);
      const won = comps.filter((r) => r.won === 'Yes').map((r) => r.competition);
      const pos = league_positions.find((r) => r.season === s && r.club === 'Man City');
      const rev = city_revenue.find((r) => r.season === s);
      const spend = totals.find((r) => r.season === s && r.club === 'Man City');
      const revenue = rev ? Number(rev.total) : null;
      return {
        season: s,
        complete: !comps.some((r) => r.in_progress === true || r.in_progress === 'true'),
        league_position: pos ? Number(pos.position) : null,
        games,
        trophies: won.length,
        trophies_won: won.join(', '),
        matchday: rev ? Number(rev.matchday) : null,
        broadcasting: rev ? Number(rev.broadcasting) : null,
        commercial: rev ? Number(rev.commercial) : null,
        revenue,
        matchday_per_game: rev ? r2(Number(rev.matchday) / games) : null,
        broadcasting_per_game: rev ? r2(Number(rev.broadcasting) / games) : null,
        transfer_spend: spend ? Number(spend.spend_eur_m) : null,
        spend_share: rev && spend ? Math.round((Number(spend.spend_eur_m) / revenue) * 1000) / 1000 : null,
      };
    });
  },
});

dash.calc('city_headline', {
  inputs: ['city_season_summary'],
  title: 'City headline figures',
  description: 'Games and league titles over completed seasons, all trophies, and the first and latest seasons with published revenue.',
  fn: (city_season_summary) => {
    const done = city_season_summary.filter((r) => r.complete);
    const withRev = city_season_summary.filter((r) => r.revenue != null);
    const first = withRev[0];
    const last = withRev[withRev.length - 1];
    return [{
      first_season: done[0].season,
      last_season: done[done.length - 1].season,
      games: done.reduce((a, r) => a + r.games, 0),
      trophies: city_season_summary.reduce((a, r) => a + r.trophies, 0),
      league_titles: done.filter((r) => r.league_position === 1).length,
      first_rev_season: first.season,
      first_revenue_eur: first.revenue * 1e6,
      latest_rev_season: last.season,
      latest_revenue_eur: last.revenue * 1e6,
      latest_broadcast_share: Math.round((last.broadcasting / last.revenue) * 1000) / 1000,
      latest_matchday_share: Math.round((last.matchday / last.revenue) * 1000) / 1000,
      latest_matchday_per_game_eur: last.matchday_per_game * 1e6,
    }];
  },
});

dash.calc('club_records', {
  inputs: ['competitions'],
  title: 'Games and trophies per club',
  description: 'Each club’s competitive games over completed seasons, and trophies won since 2009/10 including 2026/27 so far.',
  fn: (competitions) => {
    const clubs = Array.from(new Set(competitions.map((r) => r.club)));
    return clubs.map((club) => {
      const rs = competitions.filter((r) => r.club === club);
      const done = rs.filter((r) => !(r.in_progress === true || r.in_progress === 'true'));
      return {
        club,
        games: done.reduce((a, r) => a + Number(r.games), 0),
        trophies: rs.filter((r) => r.won === 'Yes').length,
        league_titles: rs.filter((r) => r.competition === 'Premier League' && r.won === 'Yes').length,
      };
    });
  },
});

const STREAMS = [
  { key: 'matchday', label: 'Matchday (tickets)', color: () => dash.colors[2] },
  { key: 'broadcasting', label: 'Broadcasting (TV and prize money)', color: () => dash.colors[1] },
  { key: 'commercial', label: 'Commercial', color: () => dash.colors[3] },
];
const GROUPS = [
  { key: 'league', label: 'Premier League', comps: ['Premier League'], color: () => dash.colors[1] },
  { key: 'cups', label: 'FA Cup, League Cup, Community Shield', comps: ['FA Cup', 'League Cup', 'Community Shield'], color: () => dash.colors[2] },
  { key: 'europe', label: 'European competitions', comps: ['Champions League', 'Europa League', 'Conference League', 'UEFA Super Cup'], color: () => dash.colors[3] },
  { key: 'world', label: 'Club World Cup', comps: ['Club World Cup'], color: () => dash.colors[4] },
];
const fmtPct = d3.format('.0%');
let bumpFocus = null;

function staticLegend(el, items) {
  if (el.children.length) return;
  items.forEach(([label, color, dashed]) => {
    const s = document.createElement('span');
    s.className = 'bx-leg';
    const sw = document.createElement('span');
    sw.className = 'bx-sw';
    sw.style.background = color;
    if (dashed) { sw.style.height = '3px'; sw.style.borderRadius = '2px'; }
    s.append(sw, document.createTextNode(label));
    el.append(s);
  });
}
staticLegend(document.getElementById('rev-legend'), STREAMS.map((s) => [s.label, s.color()]).concat([['Transfer spend', 'var(--color-fg)', true]]));
staticLegend(document.getElementById('games-legend'), GROUPS.map((g) => [g.label, g.color()]));

const bumpLegend = document.getElementById('bump-legend');
CLUBS.forEach((club) => {
  const b = document.createElement('button');
  b.className = 'bx-leg';
  b.dataset.club = club;
  b.setAttribute('aria-pressed', 'false');
  const sw = document.createElement('span');
  sw.className = 'bx-sw';
  sw.style.background = colorOf(club);
  b.append(sw, document.createTextNode(club));
  b.addEventListener('click', () => {
    bumpFocus = bumpFocus === club ? null : club;
    bumpLegend.querySelectorAll('.bx-leg').forEach((x) => {
      const on = bumpFocus === x.dataset.club;
      x.setAttribute('aria-pressed', String(on));
      x.classList.toggle('bx-dim', bumpFocus !== null && !on);
    });
    drawBump();
  });
  bumpLegend.append(b);
});

function makeTip(box) {
  const tip = document.createElement('div');
  tip.className = 'bx-tip';
  tip.hidden = true;
  box.append(tip);
  return tip;
}
function fillTip(tip, head, rows) {
  const h = document.createElement('div');
  h.className = 'bx-tip-head';
  h.textContent = head;
  tip.replaceChildren(h);
  rows.forEach(([label, value, color]) => {
    const row = document.createElement('div');
    row.className = 'bx-tip-row';
    const sw = document.createElement('span');
    sw.className = 'bx-sw';
    if (color) sw.style.background = color;
    const name = document.createElement('span');
    name.textContent = label;
    const val = document.createElement('span');
    val.className = 'bx-tip-v';
    val.textContent = value;
    row.append(sw, name, val);
    tip.append(row);
  });
  tip.hidden = false;
}
function placeTip(tip, box, W, sx, sy) {
  const ratio = box.getBoundingClientRect().width / W;
  const tw = tip.offsetWidth;
  let left = sx * ratio + 14;
  if (left + tw > box.clientWidth) left = sx * ratio - tw - 14;
  tip.style.left = `${Math.max(0, left)}px`;
  tip.style.top = `${sy * ratio}px`;
}
function yAxisLeft(svg, labels) {
  let w = 0;
  const probe = svg.append('g');
  labels.forEach((t) => { w = Math.max(w, probe.append('text').attr('class', 'bx-tick').text(t).node().getComputedTextLength()); });
  probe.remove();
  return Math.ceil(w) + 10;
}
function seasonTicks(svg, x, seasons, y0, step) {
  const every = Math.max(1, Math.ceil(46 / step));
  seasons.forEach((s, i) => {
    if (i % every !== 0) return;
    svg.append('text').attr('class', 'bx-tick').attr('x', x(s) + (x.bandwidth ? x.bandwidth() / 2 : 0)).attr('y', y0 + 17).attr('text-anchor', 'middle').text(s.slice(2));
  });
}

function drawSeasonHeadline() {
  const st = dash.data('city_headline');
  const h = st.status === 'ok' ? st.data[0] : null;
  const f = d3.format(',');
  setText('st-first', h ? h.first_season : '—');
  setText('st-last', h ? h.last_season : '—');
  setText('st-games', h ? f(h.games) : '—', st);
  setText('st-trophies', h ? f(h.trophies) : '—', st);
  setText('st-titles', h ? f(h.league_titles) : '—', st);
  setText('st-rev-first', h ? fmtE(h.first_revenue_eur) : '—', st);
  setText('st-rev-first-season', h ? h.first_rev_season : '—');
  setText('st-rev-last', h ? fmtE(h.latest_revenue_eur) : '—', st);
  setText('st-rev-last-season', h ? h.latest_rev_season : '—');
  setText('st-bshare', h ? fmtPct(h.latest_broadcast_share) : '—');
  setText('st-mshare', h ? fmtPct(h.latest_matchday_share) : '—');
  setText('sk-trophies', h ? f(h.trophies) : '—', st);
  setText('sk-titles', h ? f(h.league_titles) : '—');
  setText('sk-games', h ? f(h.games) : '—', st);
  setText('sk-rev', h ? fmtE(h.latest_revenue_eur) : '—', st);
  setText('sk-rev-season', h ? h.latest_rev_season : '—');
  setText('sk-mpg', h ? fmtE(h.latest_matchday_per_game_eur) : '—', st);
}

function drawRevenue() {
  const box = document.getElementById('rev-chart');
  const st = dash.data('city_revenue');
  const sp = dash.data('totals');
  loading(box, st);
  box.replaceChildren();
  if (st.status !== 'ok') { if (failed(st)) box.append(failNote()); return; }
  const rows = st.data.map((r) => ({ season: r.season, matchday: Number(r.matchday), broadcasting: Number(r.broadcasting), commercial: Number(r.commercial), total: Number(r.total) }));
  const seasons = rows.map((r) => r.season).sort();
  const spend = sp.status === 'ok' ? sp.data.filter((r) => r.club === 'Man City' && seasons.includes(r.season)).map((r) => ({ season: r.season, v: Number(r.spend_eur_m) })) : [];
  const W = Math.max(280, box.clientWidth);
  const H = W < 520 ? 280 : 340;
  const m = { top: 12, right: 8, bottom: 26, left: 0 };
  const svg = d3.select(box).append('svg').attr('width', '100%').attr('viewBox', `0 0 ${W} ${H}`).attr('role', 'img').attr('aria-label', 'City revenue by stream and transfer spend per season');
  const ymax = Math.max(d3.max(rows, (r) => r.total), d3.max(spend, (r) => r.v) || 0);
  const y = d3.scaleLinear([0, ymax], [H - m.bottom, m.top]).nice();
  const yt = y.ticks(5);
  const lab = (t) => (t === 0 ? '€0' : `€${d3.format(',')(t)}m`);
  m.left = yAxisLeft(svg, yt.map(lab));
  const x = d3.scaleBand(seasons, [m.left, W - m.right]).paddingInner(0.25).paddingOuter(0.1);
  yt.forEach((t) => {
    svg.append('line').attr('x1', m.left).attr('x2', W - m.right).attr('y1', y(t)).attr('y2', y(t)).style('stroke', 'var(--cds-chart-grid)');
    svg.append('text').attr('class', 'bx-tick').attr('x', m.left - 8).attr('y', y(t)).attr('dy', '0.32em').attr('text-anchor', 'end').text(lab(t));
  });
  seasonTicks(svg, x, seasons, H - m.bottom, x.step());
  const bw = Math.min(32, x.bandwidth());
  const off = (x.bandwidth() - bw) / 2;
  rows.forEach((r) => {
    let base = 0;
    STREAMS.forEach((s, i) => {
      const v = r[s.key];
      svg.append('rect').attr('x', x(r.season) + off).attr('width', bw)
        .attr('y', y(base + v)).attr('height', Math.max(0, y(base) - y(base + v)))
        .attr('rx', i === STREAMS.length - 1 ? 3 : 0).style('fill', s.color());
      base += v;
    });
  });
  svg.append('line').attr('x1', m.left).attr('x2', W - m.right).attr('y1', y(0)).attr('y2', y(0)).style('stroke', 'var(--cds-chart-axis)');
  if (spend.length) {
    const pts = seasons.map((s) => spend.find((d) => d.season === s)).filter(Boolean);
    svg.append('path').datum(pts).attr('d', d3.line().x((d) => x(d.season) + x.bandwidth() / 2).y((d) => y(d.v)))
      .style('fill', 'none').style('stroke', 'var(--color-fg)').attr('stroke-width', 2).attr('stroke-linecap', 'round').attr('stroke-linejoin', 'round');
    svg.selectAll('circle.bx-sp').data(pts).join('circle').attr('cx', (d) => x(d.season) + x.bandwidth() / 2).attr('cy', (d) => y(d.v)).attr('r', 2.5)
      .style('fill', 'var(--color-fg)');
  }
  const tip = makeTip(box);
  const hl = svg.append('rect').attr('y', m.top).attr('height', H - m.top - m.bottom).style('fill', 'var(--cds-chart-grid)').attr('opacity', 0);
  svg.append('rect').attr('x', m.left).attr('y', m.top).attr('width', W - m.left - m.right).attr('height', H - m.top - m.bottom).style('fill', 'transparent')
    .on('pointermove', (ev) => {
      const [px] = d3.pointer(ev);
      const i = Math.max(0, Math.min(seasons.length - 1, Math.floor((px - m.left - x.step() * 0.1) / x.step())));
      const s = seasons[i];
      const r = rows.find((d) => d.season === s);
      const sv = spend.find((d) => d.season === s);
      hl.attr('x', x(s) - x.step() * 0.1).attr('width', x.step()).attr('opacity', 0.35).lower();
      fillTip(tip, s, STREAMS.map((k) => [k.label.split(' (')[0], fmtM(r[k.key]), k.color()]).concat([['Total revenue', fmtM(r.total), null], ['Transfer spend', sv ? fmtM(sv.v) : '—', 'var(--color-fg)']]));
      placeTip(tip, box, W, x(s) + x.bandwidth() / 2, m.top);
    })
    .on('pointerleave', () => { tip.hidden = true; hl.attr('opacity', 0); });
}

function groupOf(comp) {
  return GROUPS.find((g) => g.comps.includes(comp)) || GROUPS[2];
}
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-');
function drawGamesGrid() {
  const grid = document.getElementById('games-grid');
  const st = dash.data('competitions');
  const rec = dash.data('club_records');
  loading(grid, st);
  grid.replaceChildren();
  if (st.status !== 'ok') { if (failed(st)) grid.append(failNote()); return; }
  const all = st.data;
  const seasons = Array.from(new Set(all.map((r) => r.season))).sort();
  const sums = {};
  all.forEach((r) => { const k = `${r.club}|${r.season}`; sums[k] = (sums[k] || 0) + Number(r.games); });
  const ymax = d3.max(Object.values(sums));
  const f = d3.format(',');
  const boxes = [];
  CLUBS.forEach((club) => {
    const card = document.createElement('div');
    card.className = 'bx-mini';
    card.id = `games-${slug(club)}`;
    const head = document.createElement('div');
    head.className = 'bx-mini-head';
    const h3 = document.createElement('h3');
    const sw = document.createElement('span');
    sw.className = 'bx-sw';
    sw.style.background = colorOf(club);
    h3.append(sw, document.createTextNode(club));
    const rr = rec.status === 'ok' ? rec.data.find((d) => d.club === club) : null;
    const w = `club=${whereVal(club)}`;
    const mk = (field) => {
      const s = document.createElement('span');
      s.className = 'bx-em';
      s.dataset.source = 'club_records';
      s.dataset.where = w;
      s.dataset.field = field;
      s.textContent = rr ? f(rr[field]) : '—';
      return s;
    };
    const sub = document.createElement('div');
    sub.className = 'bx-mini-sub';
    sub.append(mk('games'), document.createTextNode(' games · '), mk('trophies'), document.createTextNode(rr && rr.trophies === 1 ? ' trophy' : ' trophies'));
    head.append(h3, sub);
    const box = document.createElement('div');
    box.className = 'bx-mchart';
    card.append(head, box);
    grid.append(card);
    boxes.push([club, box]);
  });
  // Draw only once every card is in the grid, so each chart is sized at its final width.
  const widths = boxes.map(([, box]) => box.clientWidth);
  const chartW = d3.min(widths.filter((v) => v > 0)) || 0;
  boxes.forEach(([club, box]) => drawGamesChart(box, all.filter((d) => d.club === club), seasons, ymax, club, chartW));
}
function drawGamesChart(box, comps, seasons, ymax, club, width) {
  const rows = seasons.map((s) => {
    const cs = comps.filter((r) => r.season === s);
    const o = { season: s, live: cs.some((r) => r.in_progress === true || r.in_progress === 'true'), comps: cs, total: 0, trophies: cs.filter((r) => r.won === 'Yes').length };
    GROUPS.forEach((g) => { o[g.key] = cs.filter((r) => g.comps.includes(r.competition)).reduce((a, r) => a + Number(r.games), 0); o.total += o[g.key]; });
    return o;
  });
  const W = Math.max(260, width || box.clientWidth);
  const H = 190;
  const m = { top: 18, right: 4, bottom: 24, left: 0 };
  const svg = d3.select(box).append('svg').attr('width', '100%').attr('viewBox', `0 0 ${W} ${H}`).attr('role', 'img').attr('aria-label', `${club}: competitive games per season by competition, with trophies`);
  const y = d3.scaleLinear([0, ymax], [H - m.bottom, m.top]).nice();
  const yt = y.ticks(3);
  m.left = yAxisLeft(svg, yt.map((t) => String(t)));
  const x = d3.scaleBand(seasons, [m.left, W - m.right]).paddingInner(0.25).paddingOuter(0.1);
  yt.forEach((t) => {
    svg.append('line').attr('x1', m.left).attr('x2', W - m.right).attr('y1', y(t)).attr('y2', y(t)).style('stroke', 'var(--cds-chart-grid)');
    svg.append('text').attr('class', 'bx-tick').attr('x', m.left - 8).attr('y', y(t)).attr('dy', '0.32em').attr('text-anchor', 'end').text(String(t));
  });
  seasonTicks(svg, x, seasons, H - m.bottom, x.step());
  const bw = Math.min(20, x.bandwidth());
  const off = (x.bandwidth() - bw) / 2;
  rows.forEach((r) => {
    let base = 0;
    const shown = GROUPS.filter((g) => r[g.key] > 0);
    shown.forEach((g, i) => {
      svg.append('rect').attr('x', x(r.season) + off).attr('width', bw)
        .attr('y', y(base + r[g.key])).attr('height', Math.max(0, y(base) - y(base + r[g.key])))
        .attr('rx', i === shown.length - 1 ? 3 : 0).style('fill', g.color()).attr('opacity', r.live ? 0.5 : 1);
      base += r[g.key];
    });
    if (r.trophies > 0) {
      svg.append('text').attr('class', 'bx-tick').attr('x', x(r.season) + x.bandwidth() / 2).attr('y', y(r.total) - 6).attr('text-anchor', 'middle')
        .style('fill', 'var(--color-fg)').style('font-weight', 'var(--cds-font-weight-medium)').text(String(r.trophies));
    }
  });
  svg.append('line').attr('x1', m.left).attr('x2', W - m.right).attr('y1', y(0)).attr('y2', y(0)).style('stroke', 'var(--cds-chart-axis)');
  const tip = makeTip(box);
  const hl = svg.append('rect').attr('y', m.top).attr('height', H - m.top - m.bottom).style('fill', 'var(--cds-chart-grid)').attr('opacity', 0);
  svg.append('rect').attr('x', m.left).attr('y', m.top).attr('width', W - m.left - m.right).attr('height', H - m.top - m.bottom).style('fill', 'transparent')
    .on('pointermove', (ev) => {
      const [px] = d3.pointer(ev);
      const i = Math.max(0, Math.min(seasons.length - 1, Math.floor((px - m.left - x.step() * 0.1) / x.step())));
      const r = rows[i];
      hl.attr('x', x(r.season) - x.step() * 0.1).attr('width', x.step()).attr('opacity', 0.35).lower();
      const lines = r.comps.map((c) => [`${c.competition}: ${c.stage}`, `${c.games}`, groupOf(c.competition).color()]);
      lines.push([r.live ? 'Games so far' : 'Total games', String(r.total), null]);
      fillTip(tip, r.trophies ? `${club}, ${r.season} · ${r.trophies} ${r.trophies === 1 ? 'trophy' : 'trophies'}` : `${club}, ${r.season}`, lines);
      placeTip(tip, box, W, x(r.season) + x.bandwidth() / 2, m.top);
    })
    .on('pointerleave', () => { tip.hidden = true; hl.attr('opacity', 0); });
}

function drawBump() {
  const box = document.getElementById('bump-chart');
  const st = dash.data('league_positions');
  loading(box, st);
  box.replaceChildren();
  if (st.status !== 'ok') { if (failed(st)) box.append(failNote()); return; }
  const rows = st.data.map((r) => ({ season: r.season, club: r.club, p: Number(r.position), final: r.final === true || r.final === 'true' }));
  const seasons = Array.from(new Set(rows.map((r) => r.season))).sort();
  const W = Math.max(280, box.clientWidth);
  const H = W < 520 ? 300 : 360;
  const m = { top: 10, right: 10, bottom: 26, left: 0 };
  const svg = d3.select(box).append('svg').attr('width', '100%').attr('viewBox', `0 0 ${W} ${H}`).attr('role', 'img').attr('aria-label', 'Premier League position per season for the Big Six');
  const maxP = Math.max(20, d3.max(rows, (r) => r.p));
  const y = d3.scaleLinear([1, maxP], [m.top, H - m.bottom]);
  const yt = [1, 4, 8, 12, 16, 20].filter((t) => t <= maxP);
  const lab = (t) => `${ordinal(t)}`;
  m.left = yAxisLeft(svg, yt.map(lab));
  const x = d3.scalePoint(seasons, [m.left, W - m.right]).padding(0.4);
  const step = x.step();
  svg.append('rect').attr('x', m.left).attr('width', W - m.left - m.right).attr('y', y(0.5)).attr('height', y(4.5) - y(0.5))
    .style('fill', 'color-mix(in srgb, var(--cds-chart-reference) 14%, transparent)');
  yt.forEach((t) => {
    svg.append('line').attr('x1', m.left).attr('x2', W - m.right).attr('y1', y(t)).attr('y2', y(t)).style('stroke', 'var(--cds-chart-grid)');
    svg.append('text').attr('class', 'bx-tick').attr('x', m.left - 8).attr('y', y(t)).attr('dy', '0.32em').attr('text-anchor', 'end').text(lab(t));
  });
  seasonTicks(svg, x, seasons, H - m.bottom, step);
  const order = CLUBS.slice(1).concat(['Man City']).filter((c) => c !== bumpFocus).concat(bumpFocus ? [bumpFocus] : []);
  const line = d3.line().x((d) => x(d.season)).y((d) => y(d.p));
  order.forEach((club) => {
    const pts = seasons.map((s) => rows.find((r) => r.club === club && r.season === s)).filter(Boolean);
    const done = pts.filter((d) => d.final);
    const live = pts.filter((d) => !d.final);
    const isCity = club === 'Man City';
    const op = bumpFocus ? (club === bumpFocus ? 1 : 0.15) : (isCity ? 1 : 0.75);
    const sw = isCity || club === bumpFocus ? 3 : 2;
    const g = svg.append('g').attr('opacity', op);
    g.append('path').datum(done).attr('d', line).style('fill', 'none').style('stroke', colorOf(club)).attr('stroke-width', sw).attr('stroke-linecap', 'round').attr('stroke-linejoin', 'round');
    if (live.length && done.length) {
      g.append('path').datum([done[done.length - 1]].concat(live)).attr('d', line).style('fill', 'none').style('stroke', colorOf(club)).attr('stroke-width', sw).attr('stroke-dasharray', '4 4');
    }
    g.selectAll('circle').data(pts).join('circle').attr('cx', (d) => x(d.season)).attr('cy', (d) => y(d.p)).attr('r', isCity ? 3.5 : 2.5)
      .style('fill', (d) => (d.final ? colorOf(club) : 'var(--color-panel)')).style('stroke', colorOf(club)).attr('stroke-width', 1.5);
  });
  const tip = makeTip(box);
  const rule = svg.append('line').attr('y1', m.top).attr('y2', H - m.bottom).style('stroke', 'var(--cds-chart-axis)').attr('opacity', 0);
  svg.append('rect').attr('x', m.left).attr('y', m.top).attr('width', W - m.left - m.right).attr('height', H - m.top - m.bottom).style('fill', 'transparent')
    .on('pointermove', (ev) => {
      const [px] = d3.pointer(ev);
      const i = Math.max(0, Math.min(seasons.length - 1, Math.round((px - x(seasons[0])) / step)));
      const s = seasons[i];
      rule.attr('x1', x(s)).attr('x2', x(s)).attr('opacity', 1);
      const here = rows.filter((r) => r.season === s).sort((a, b) => a.p - b.p);
      const live = here.some((r) => !r.final);
      fillTip(tip, live ? `${s} (after 6 games)` : s, here.map((r) => [r.club, ordinal(r.p), colorOf(r.club)]));
      placeTip(tip, box, W, x(s), m.top);
    })
    .on('pointerleave', () => { tip.hidden = true; rule.attr('opacity', 0); });
}

function drawSeasonTable() {
  const body = document.getElementById('season-body');
  body.replaceChildren();
  const st = dash.data('city_season_summary');
  if (st.status !== 'ok') {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 13;
    if (failed(st)) td.append(failNote()); else { td.textContent = '—'; td.classList.toggle('dash-skeleton', st.status === 'loading'); }
    tr.append(td);
    body.append(tr);
    return;
  }
  const f1 = d3.format(',.1f');
  const f2 = d3.format(',.2f');
  const pct = d3.format('.1%');
  const n = (v, f) => (v == null ? '—' : f(v));
  st.data.forEach((r) => {
    const tr = document.createElement('tr');
    if (!r.complete) tr.className = 'bx-live';
    const cells = [
      [r.season, false], [n(r.league_position, String), true], [String(r.games), true], [String(r.trophies), true], [r.trophies_won || '—', false],
      [n(r.matchday, f1), true], [n(r.broadcasting, f1), true], [n(r.commercial, f1), true], [n(r.revenue, f1), true],
      [n(r.matchday_per_game, f2), true], [n(r.broadcasting_per_game, f2), true], [n(r.transfer_spend, f1), true], [n(r.spend_share, pct), true],
    ];
    cells.forEach(([t, num]) => {
      const td = document.createElement('td');
      if (num) td.className = 'bx-num';
      td.textContent = t;
      tr.append(td);
    });
    body.append(tr);
  });
}

const wonOnly = document.getElementById('won-only');
wonOnly.addEventListener('change', () => drawCompTable());
const compClub = document.getElementById('comp-club');
CLUBS.forEach((c) => compClub.append(new Option(c, c)));
compClub.value = 'Man City';
compClub.addEventListener('change', () => drawCompTable());
function drawCompTable() {
  const body = document.getElementById('comp-body');
  body.replaceChildren();
  const st = dash.data('competitions');
  if (st.status !== 'ok') {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 5;
    if (failed(st)) td.append(failNote()); else { td.textContent = '—'; td.classList.toggle('dash-skeleton', st.status === 'loading'); }
    tr.append(td);
    body.append(tr);
    return;
  }
  st.data.filter((r) => r.club === compClub.value && (!wonOnly.checked || r.won === 'Yes')).forEach((r) => {
    const tr = document.createElement('tr');
    tr.dataset.key = r.id;
    if (r.won === 'Yes') tr.className = 'bx-won';
    else if (r.in_progress === true || r.in_progress === 'true') tr.className = 'bx-live';
    [r.season, r.competition, r.stage, String(r.games), r.won].forEach((t, i) => {
      const td = document.createElement('td');
      if (i === 3) td.className = 'bx-num';
      td.textContent = t;
      tr.append(td);
    });
    body.append(tr);
  });
}

function drawSeasonSources() {
  const body = document.getElementById('ssrc-body');
  body.replaceChildren();
  const st = dash.data('season_sources');
  if (st.status !== 'ok') {
    if (failed(st)) { const tr = document.createElement('tr'); const td = document.createElement('td'); td.colSpan = 2; td.append(failNote()); tr.append(td); body.append(tr); }
    return;
  }
  st.data.forEach((r) => {
    const tr = document.createElement('tr');
    tr.dataset.key = r.key;
    const td1 = document.createElement('td');
    const a = document.createElement('a');
    a.href = r.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = r.name;
    td1.append(a);
    const td2 = document.createElement('td');
    td2.textContent = r.covers;
    tr.append(td1, td2);
    body.append(tr);
  });
}

// =================== Wages page ===================
const fmtGBP = (v) => (v == null || Number.isNaN(Number(v)) ? '—' : `£${d3.format(',.1f')(Number(v))}m`);
const fmtWeek = (w) => (w == null ? '—' : `£${d3.format(',')(Math.round(Number(w) / 1000))}k`);
const isTrue = (v) => v === true || v === 'true';

dash.calc('wage_headline', {
  inputs: ['wages', 'top_earners', 'managers', 'manager_pay'],
  title: 'Wages headline figures',
  description: 'City’s first and latest wage bill, its rank that season among clubs with figures, wages as a share of revenue, its best-paid player this season and its manager’s latest reported pay.',
  fn: (wages, top_earners, managers, manager_pay) => {
    const city = wages.filter((r) => r.club === 'Man City' && r.wages_gbp_m != null).sort((a, b) => a.season.localeCompare(b.season));
    const first = city[0];
    const last = city[city.length - 1];
    const same = wages.filter((r) => r.season === last.season && r.wages_gbp_m != null).sort((a, b) => b.wages_gbp_m - a.wages_gbp_m);
    const seasons = Array.from(new Set(top_earners.map((r) => r.season))).sort();
    const now = seasons[seasons.length - 1];
    const top = top_earners.filter((r) => r.club === 'Man City' && r.season === now).sort((a, b) => b.weekly_gbp - a.weekly_gbp)[0];
    const mgr = managers.find((m) => m.club === 'Man City' && (m.current === true || m.current === 'true'));
    const pays = manager_pay.filter((p) => p.manager_id === mgr.id).sort((a, b) => b.year - a.year);
    return [{
      first_season: first.season,
      city_first_wages: Math.round(first.wages_gbp_m * 10) * 1e5,
      latest_season: last.season,
      city_latest_wages: Math.round(last.wages_gbp_m * 10) * 1e5,
      growth_multiple: Math.round((last.wages_gbp_m / first.wages_gbp_m) * 10) / 10,
      city_rank: same.findIndex((r) => r.club === 'Man City') + 1,
      clubs_reported: same.length,
      city_ratio: last.revenue_gbp_m ? Math.round((last.wages_gbp_m / last.revenue_gbp_m) * 1000) / 1000 : null,
      top_season: now,
      top_player: top.player,
      top_weekly: top.weekly_gbp,
      top_annual: Math.round(top.weekly_gbp * 52 / 1e5) * 1e5,
      manager: mgr.manager,
      manager_pay: pays.length ? Math.round(pays[0].pay_gbp_m * 10) * 1e5 : null,
      manager_pay_year: pays.length ? pays[0].year : null,
    }];
  },
});

dash.calc('wage_matrix', {
  inputs: ['wages'],
  title: 'Wage bill grid',
  description: 'Each season’s wage bill laid out with one column per club.',
  fn: (wages) => {
    const seasons = Array.from(new Set(wages.map((r) => r.season))).sort();
    return seasons.map((s) => {
      const o = { season: s };
      wages.filter((r) => r.season === s).forEach((r) => { o[r.club] = r.wages_gbp_m == null ? null : Number(r.wages_gbp_m); });
      return o;
    });
  },
});

dash.calc('earners_grid', {
  inputs: ['top_earners'],
  title: 'Top five earners per club and season',
  description: 'The five best-paid players for each club and season; players tied on the fifth wage are listed together.',
  fn: (top_earners) => {
    const keys = Array.from(new Set(top_earners.map((r) => `${r.club}|${r.season}`)));
    const k = (w) => `£${Math.round(w / 1000)}k`;
    return keys.map((key) => {
      const [club, season] = key.split('|');
      const rs = top_earners.filter((r) => r.club === club && r.season === season).sort((a, b) => b.weekly_gbp - a.weekly_gbp);
      const o = { key, club, season };
      for (let i = 0; i < 4; i += 1) o[`p${i + 1}`] = rs[i] ? `${rs[i].player} · ${k(rs[i].weekly_gbp)}` : '';
      const fifth = rs[4] ? rs.slice(4).filter((r) => r.weekly_gbp === rs[4].weekly_gbp) : [];
      o.p5 = fifth.length ? `${fifth.map((r) => r.player).join(', ')} · ${k(fifth[0].weekly_gbp)}` : '';
      return o;
    });
  },
});

dash.calc('top_paid_by_club', {
  inputs: ['top_earners'],
  title: 'Best-paid player per club and season',
  description: 'The highest weekly wage at each club each season, with the player or players on it.',
  fn: (top_earners) => {
    const keys = Array.from(new Set(top_earners.map((r) => `${r.club}|${r.season}`)));
    return keys.map((key) => {
      const [club, season] = key.split('|');
      const rs = top_earners.filter((r) => r.club === club && r.season === season);
      const max = Math.max(...rs.map((r) => Number(r.weekly_gbp)));
      return { key, club, season, weekly_gbp: max, players: rs.filter((r) => Number(r.weekly_gbp) === max).map((r) => r.player).join(', ') };
    });
  },
});

dash.calc('manager_summary', {
  inputs: ['managers', 'manager_pay'],
  title: 'Managers with reported pay',
  description: 'Each manager’s spell with every reported salary joined on, and the highest reported figure.',
  fn: (managers, manager_pay) => managers.map((m) => {
    const ps = manager_pay.filter((p) => p.manager_id === m.id).sort((a, b) => a.year - b.year);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const label = (ym) => (ym ? `${months[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}` : 'present');
    return {
      id: m.id,
      club: m.club,
      manager: m.manager,
      from: m.from,
      to: m.to || 'present',
      from_label: label(m.from),
      to_label: label(m.to),
      role: m.role,
      reports: ps.map((p) => `${p.reported} (${p.year})`).join(' · ') || 'Not reported',
      top_pay_gbp_m: ps.length ? Math.max(...ps.map((p) => Number(p.pay_gbp_m))) : null,
    };
  }),
});

const monthName = (ym) => {
  if (!ym || ym === 'present') return 'present';
  const [y, m] = ym.split('-').map(Number);
  return d3.utcFormat('%b %Y')(new Date(Date.UTC(y, m - 1, 1)));
};

function drawWageHeadline() {
  const st = dash.data('wage_headline');
  const h = st.status === 'ok' ? st.data[0] : null;
  const g = (v) => (v == null ? '—' : fmtGBP(v / 1e6));
  setText('wt-first', h ? g(h.city_first_wages) : '—', st);
  setText('wt-first-season', h ? h.first_season : '—');
  setText('wt-last', h ? g(h.city_latest_wages) : '—', st);
  setText('wt-last-season', h ? h.latest_season : '—');
  setText('wt-mult', h ? d3.format('.1f')(h.growth_multiple) : '—');
  setText('wt-rank', h ? ordinal(h.city_rank) : '—');
  setText('wt-n', h ? String(h.clubs_reported) : '—');
  setText('wt-top-season', h ? h.top_season : '—');
  setText('wt-top', h ? h.top_player : '—');
  setText('wt-top-w', h ? fmtWeek(h.top_weekly) : '—');
  setText('wt-mgr', h ? h.manager : '—');
  setText('wt-mgr-pay', h ? g(h.manager_pay) : '—');
  setText('wk-bill', h ? g(h.city_latest_wages) : '—', st);
  setText('wk-bill-season', h ? h.latest_season : '—');
  setText('wk-ratio', h && h.city_ratio != null ? d3.format('.0%')(h.city_ratio) : '—', st);
  setText('wk-top', h ? fmtWeek(h.top_weekly) : '—', st);
  setText('wk-top-name', h ? h.top_player : '—');
  setText('wk-top-year', h ? g(h.top_annual) : '—');
  setText('wk-mgr', h ? g(h.manager_pay) : '—', st);
  setText('wk-mgr-name', h ? h.manager : '—');
}

let wageFocus = null;
const wageLegend = document.getElementById('wage-legend');
CLUBS.forEach((club) => {
  const b = document.createElement('button');
  b.className = 'bx-leg';
  b.dataset.club = club;
  b.setAttribute('aria-pressed', 'false');
  const sw = document.createElement('span');
  sw.className = 'bx-sw';
  sw.style.background = colorOf(club);
  b.append(sw, document.createTextNode(club));
  b.addEventListener('click', () => {
    wageFocus = wageFocus === club ? null : club;
    wageLegend.querySelectorAll('.bx-leg').forEach((x) => {
      const on = wageFocus === x.dataset.club;
      x.setAttribute('aria-pressed', String(on));
      x.classList.toggle('bx-dim', wageFocus !== null && !on);
    });
    drawWageLines();
  });
  wageLegend.append(b);
});
staticLegend(document.getElementById('toppaid-legend'), CLUBS.map((c) => [c, colorOf(c)]));

function drawClubLines(box, rows, opts) {
  // rows: [{season, club, v, extra}] ; opts: {focus, fmtTick, fmtVal, aria, tipExtra}
  const seasons = Array.from(new Set(rows.map((r) => r.season))).sort();
  const W = Math.max(280, box.clientWidth);
  const H = W < 520 ? 280 : 340;
  const m = { top: 12, right: 10, bottom: 26, left: 0 };
  const svg = d3.select(box).append('svg').attr('width', '100%').attr('viewBox', `0 0 ${W} ${H}`).attr('role', 'img').attr('aria-label', opts.aria);
  const y = d3.scaleLinear([0, d3.max(rows, (r) => r.v)], [H - m.bottom, m.top]).nice();
  const yt = y.ticks(5);
  m.left = yAxisLeft(svg, yt.map(opts.fmtTick));
  const x = d3.scalePoint(seasons, [m.left, W - m.right]).padding(0.4);
  const step = x.step();
  yt.forEach((t) => {
    svg.append('line').attr('x1', m.left).attr('x2', W - m.right).attr('y1', y(t)).attr('y2', y(t)).style('stroke', 'var(--cds-chart-grid)');
    svg.append('text').attr('class', 'bx-tick').attr('x', m.left - 8).attr('y', y(t)).attr('dy', '0.32em').attr('text-anchor', 'end').text(opts.fmtTick(t));
  });
  svg.append('line').attr('x1', m.left).attr('x2', W - m.right).attr('y1', y(0)).attr('y2', y(0)).style('stroke', 'var(--cds-chart-axis)');
  seasonTicks(svg, x, seasons, H - m.bottom, step);
  const line = d3.line().defined((d) => d.v != null).x((d) => x(d.season)).y((d) => y(d.v));
  const order = CLUBS.slice(1).concat(['Man City']).filter((c) => c !== opts.focus).concat(opts.focus ? [opts.focus] : []);
  order.forEach((club) => {
    const pts = seasons.map((s) => rows.find((r) => r.club === club && r.season === s) || { season: s, club, v: null });
    const isCity = club === 'Man City';
    const op = opts.focus ? (club === opts.focus ? 1 : 0.15) : (isCity ? 1 : 0.8);
    const g = svg.append('g').attr('opacity', op);
    g.append('path').datum(pts).attr('d', line).style('fill', 'none').style('stroke', colorOf(club))
      .attr('stroke-width', isCity || club === opts.focus ? 3 : 2).attr('stroke-linecap', 'round').attr('stroke-linejoin', 'round');
    pts.filter((d, i) => d.v != null && (pts[i - 1]?.v == null) && (pts[i + 1]?.v == null)).forEach((d) => {
      g.append('circle').attr('cx', x(d.season)).attr('cy', y(d.v)).attr('r', 3).style('fill', colorOf(club));
    });
  });
  const rule = svg.append('line').attr('y1', m.top).attr('y2', H - m.bottom).style('stroke', 'var(--cds-chart-axis)').attr('opacity', 0);
  const dots = svg.append('g');
  const tip = makeTip(box);
  svg.append('rect').attr('x', m.left).attr('y', m.top).attr('width', W - m.left - m.right).attr('height', H - m.top - m.bottom).style('fill', 'transparent')
    .on('pointermove', (ev) => {
      const [px] = d3.pointer(ev);
      const i = Math.max(0, Math.min(seasons.length - 1, Math.round((px - x(seasons[0])) / step)));
      const s = seasons[i];
      rule.attr('x1', x(s)).attr('x2', x(s)).attr('opacity', 1);
      const here = rows.filter((r) => r.season === s && r.v != null).sort((a, b) => b.v - a.v);
      dots.selectAll('circle').data(here).join('circle').attr('cx', x(s)).attr('cy', (d) => y(d.v)).attr('r', 3.5)
        .style('fill', (d) => colorOf(d.club)).style('stroke', 'var(--color-panel)').attr('stroke-width', 1.5);
      const lines = here.map((d) => [opts.tipLabel ? opts.tipLabel(d) : d.club, opts.fmtVal(d), colorOf(d.club)]);
      const missing = CLUBS.filter((c) => !here.some((d) => d.club === c));
      if (missing.length && missing.length < CLUBS.length) lines.push([`No figure: ${missing.join(', ')}`, '', null]);
      fillTip(tip, s, lines);
      placeTip(tip, box, W, x(s), m.top);
    })
    .on('pointerleave', () => { tip.hidden = true; rule.attr('opacity', 0); dots.selectAll('circle').remove(); });
}

function drawWageLines() {
  const box = document.getElementById('wage-chart');
  const st = dash.data('wages');
  loading(box, st);
  box.replaceChildren();
  if (st.status !== 'ok') { if (failed(st)) box.append(failNote()); return; }
  const rows = st.data.map((r) => ({
    season: r.season, club: r.club,
    v: r.wages_gbp_m == null ? null : Number(r.wages_gbp_m),
    rev: r.revenue_gbp_m == null ? null : Number(r.revenue_gbp_m),
  }));
  drawClubLines(box, rows, {
    focus: wageFocus,
    aria: 'Wage bill per season for each Big Six club',
    fmtTick: (t) => (t === 0 ? '£0' : `£${d3.format(',')(t)}m`),
    fmtVal: (d) => (d.rev ? `${fmtGBP(d.v)} · ${d3.format('.0%')(d.v / d.rev)} of revenue` : fmtGBP(d.v)),
  });
}

function drawWageGrid() {
  const head = document.getElementById('wage-grid-head');
  const body = document.getElementById('wage-grid-body');
  const st = dash.data('wage_matrix');
  if (!head.children.length) {
    const th = document.createElement('th');
    th.dataset.field = 'season';
    th.textContent = 'Season';
    head.append(th);
    CLUBS.forEach((c) => {
      const h = document.createElement('th');
      h.dataset.field = c;
      h.className = c === 'Man City' ? 'bx-num bx-city' : 'bx-num';
      h.textContent = c;
      head.append(h);
    });
  }
  body.replaceChildren();
  if (st.status !== 'ok') {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = CLUBS.length + 1;
    if (failed(st)) td.append(failNote()); else { td.textContent = '—'; td.classList.toggle('dash-skeleton', st.status === 'loading'); }
    tr.append(td);
    body.append(tr);
    return;
  }
  const max = d3.max(st.data, (r) => d3.max(CLUBS, (c) => Number(r[c]) || 0)) || 1;
  st.data.forEach((r) => {
    const tr = document.createElement('tr');
    const td0 = document.createElement('td');
    td0.textContent = r.season;
    tr.append(td0);
    CLUBS.forEach((c) => {
      const td = document.createElement('td');
      td.className = 'bx-num';
      const v = r[c];
      td.textContent = v == null ? '—' : d3.format(',.1f')(Number(v));
      if (v != null) td.style.background = `color-mix(in srgb, ${colorOf('Man City')} ${Math.round(4 + 46 * (Number(v) / max))}%, transparent)`;
      tr.append(td);
    });
    body.append(tr);
  });
}

function drawTopPaid() {
  const box = document.getElementById('toppaid-chart');
  const st = dash.data('top_paid_by_club');
  loading(box, st);
  box.replaceChildren();
  if (st.status !== 'ok') { if (failed(st)) box.append(failNote()); return; }
  const rows = st.data.map((r) => ({ season: r.season, club: r.club, v: Number(r.weekly_gbp) / 1000, players: r.players }));
  drawClubLines(box, rows, {
    focus: null,
    aria: 'Best-paid player weekly wage per season for each club',
    fmtTick: (t) => (t === 0 ? '£0' : `£${d3.format(',')(t)}k`),
    fmtVal: (d) => `£${d3.format(',')(Math.round(d.v))}k`,
    tipLabel: (d) => `${d.club}: ${d.players}`,
  });
}

const earnClub = document.getElementById('earn-club');
CLUBS.forEach((c) => earnClub.append(new Option(c, c)));
earnClub.value = 'Man City';
earnClub.addEventListener('change', () => drawEarners());
function drawEarners() {
  const body = document.getElementById('earners-body');
  body.replaceChildren();
  const st = dash.data('earners_grid');
  if (st.status !== 'ok') {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 6;
    if (failed(st)) td.append(failNote()); else { td.textContent = '—'; td.classList.toggle('dash-skeleton', st.status === 'loading'); }
    tr.append(td);
    body.append(tr);
    return;
  }
  st.data.filter((r) => r.club === earnClub.value).sort((a, b) => b.season.localeCompare(a.season)).forEach((r) => {
    const tr = document.createElement('tr');
    tr.dataset.key = r.key;
    [r.season, r.p1, r.p2, r.p3, r.p4, r.p5].forEach((t, i) => {
      const td = document.createElement('td');
      td.className = i === 0 ? 'bx-nowrap' : 'bx-nowrap';
      td.textContent = t || '—';
      tr.append(td);
    });
    body.append(tr);
  });
}

function drawTimeline() {
  const box = document.getElementById('mgr-timeline');
  const st = dash.data('manager_summary');
  loading(box, st);
  box.replaceChildren();
  if (st.status !== 'ok') { if (failed(st)) box.append(failNote()); return; }
  const start = new Date(Date.UTC(2009, 6, 1));
  const today = new Date();
  const parse = (ym) => {
    if (!ym || ym === 'present') return today;
    const [yy, mm] = ym.split('-').map(Number);
    return new Date(Date.UTC(yy, mm - 1, 1));
  };
  const spells = st.data
    .filter((r) => r.role !== 'Caretaker')
    .map((r) => ({ ...r, a: parse(r.from), b: parse(r.to) }))
    .filter((r) => r.b > start);
  const W = Math.max(280, box.clientWidth);
  const rowH = 30;
  const gap = 10;
  const m = { top: 4, right: 8, bottom: 24, left: 0 };
  const H = m.top + m.bottom + CLUBS.length * (rowH + gap) - gap;
  box.style.minHeight = `${H}px`;
  const svg = d3.select(box).append('svg').attr('width', '100%').attr('viewBox', `0 0 ${W} ${H}`).attr('role', 'img').attr('aria-label', 'Timeline of Big Six managers since 2009, shaded by reported pay');
  m.left = yAxisLeft(svg, CLUBS) + 4;
  const x = d3.scaleUtc([start, today], [m.left, W - m.right]);
  const years = d3.utcYear.every(W < 520 ? 4 : 2).range(new Date(Date.UTC(2010, 0, 1)), today);
  years.forEach((d) => {
    svg.append('line').attr('x1', x(d)).attr('x2', x(d)).attr('y1', m.top).attr('y2', H - m.bottom).style('stroke', 'var(--cds-chart-grid)');
    svg.append('text').attr('class', 'bx-tick').attr('x', x(d)).attr('y', H - m.bottom + 17).attr('text-anchor', 'middle').text(d3.utcFormat('%Y')(d));
  });
  const payMax = d3.max(spells, (s) => s.top_pay_gbp_m) || 1;
  const op = d3.scaleSqrt([0, payMax], [0.25, 1]);
  const tip = makeTip(box);
  CLUBS.forEach((club, i) => {
    const yy = m.top + i * (rowH + gap);
    svg.append('text').attr('class', 'bx-tick').attr('x', m.left - 8).attr('y', yy + rowH / 2).attr('dy', '0.32em').attr('text-anchor', 'end')
      .style('fill', club === 'Man City' ? 'var(--color-fg)' : 'var(--color-fg-muted)').text(club);
    spells.filter((s) => s.club === club).forEach((s) => {
      const x0 = x(s.a < start ? start : s.a);
      const x1 = x(s.b > today ? today : s.b);
      const w = Math.max(2, x1 - x0 - 1.5);
      const known = s.top_pay_gbp_m != null;
      const rect = svg.append('rect').attr('x', x0).attr('y', yy).attr('width', w).attr('height', rowH).attr('rx', 3);
      if (known) rect.style('fill', colorOf(club)).attr('fill-opacity', op(s.top_pay_gbp_m));
      else rect.style('fill', 'transparent').style('stroke', colorOf(club)).attr('stroke-dasharray', '3 2').attr('stroke-width', 1.2);
      const last = s.manager.split(' ').slice(-1)[0];
      const label = svg.append('text').attr('class', 'bx-tl-label').attr('x', x0 + 5).attr('y', yy + rowH / 2).attr('dy', '0.32em').text(last);
      if (label.node().getComputedTextLength() > w - 8) label.remove();
      svg.append('rect').attr('x', x0).attr('y', yy).attr('width', w).attr('height', rowH).style('fill', 'transparent')
        .on('pointerenter', () => {
          fillTip(tip, `${s.manager}, ${club}`, [
            [`${s.from_label} to ${s.to_label}`, '', null],
            [s.role, '', null],
            [known ? `Highest reported: ${fmtGBP(s.top_pay_gbp_m)} a year` : 'No pay figure found', '', known ? colorOf(club) : null],
          ].concat(known ? s.reports.split(' · ').map((t) => [t, '', null]) : []));
          placeTip(tip, box, W, Math.min(x1, W - 10), yy + rowH);
        })
        .on('pointerleave', () => { tip.hidden = true; });
    });
  });
}

const mgrClub = document.getElementById('mgr-club');
mgrClub.append(new Option('All clubs', ''));
CLUBS.forEach((c) => mgrClub.append(new Option(c, c)));
mgrClub.addEventListener('change', () => drawManagerTable());
function drawManagerTable() {
  const body = document.getElementById('mgr-body');
  body.replaceChildren();
  const st = dash.data('manager_summary');
  if (st.status !== 'ok') {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 7;
    if (failed(st)) td.append(failNote()); else { td.textContent = '—'; td.classList.toggle('dash-skeleton', st.status === 'loading'); }
    tr.append(td);
    body.append(tr);
    return;
  }
  st.data.filter((r) => !mgrClub.value || r.club === mgrClub.value)
    .sort((a, b) => CLUBS.indexOf(a.club) - CLUBS.indexOf(b.club) || b.from.localeCompare(a.from))
    .forEach((r) => {
      const tr = document.createElement('tr');
      tr.dataset.key = r.id;
      const cells = [
        [r.club, 'bx-nowrap'], [r.manager, 'bx-nowrap'], [r.from_label, 'bx-nowrap'], [r.to_label, 'bx-nowrap'],
        [r.role, ''], [r.top_pay_gbp_m == null ? '—' : d3.format(',.2~f')(r.top_pay_gbp_m), 'bx-num'], [r.reports, 'bx-wrap'],
      ];
      cells.forEach(([t, cls]) => {
        const td = document.createElement('td');
        if (cls) td.className = cls;
        td.textContent = t;
        tr.append(td);
      });
      body.append(tr);
    });
}

function drawWageSources() {
  const body = document.getElementById('wsrc-body');
  body.replaceChildren();
  const st = dash.data('wage_sources');
  if (st.status !== 'ok') {
    if (failed(st)) { const tr = document.createElement('tr'); const td = document.createElement('td'); td.colSpan = 2; td.append(failNote()); tr.append(td); body.append(tr); }
    return;
  }
  st.data.forEach((r) => {
    const tr = document.createElement('tr');
    tr.dataset.key = r.key;
    const td1 = document.createElement('td');
    const a = document.createElement('a');
    a.href = r.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = r.name;
    td1.append(a);
    const td2 = document.createElement('td');
    td2.textContent = r.covers;
    tr.append(td1, td2);
    body.append(tr);
  });
}

// =================== sales page ===================
dash.calc('sales_club_totals', {
  inputs: ['sales_totals', 'sales'],
  title: 'Sales, net spend and fee gain per club',
  description: 'Each club’s sale income and spend over every season, net spend (spend minus sales), academy sales, the gain on players sold against what they cost, and the biggest sale, with ranks.',
  fn: (totals, sales) => {
    const r1 = (v) => Math.round(v * 10) / 10;
    const full = (m) => Math.round(m * 1e6);
    const rows = Array.from(new Set(totals.map((r) => r.club))).map((club) => {
      const rs = totals.filter((r) => r.club === club);
      const sum = (k, keep) => rs.filter(keep || (() => true)).reduce((a, r) => a + Number(r[k]), 0);
      const salesM = r1(sum('sales_eur_m'));
      const spendM = r1(sum('spend_eur_m'));
      const sinceM = r1(sum('sales_eur_m', (r) => r.season > LAST_CHARGED));
      const netM = r1(spendM - salesM);
      const paid = sales.filter((r) => r.club === club && Number(r.fee_eur) > 0);
      const perm = paid.filter((r) => r.type === 'Transfer');
      const acad = perm.filter((r) => r.origin === 'Academy');
      const academyM = r1(acad.reduce((a, r) => a + Number(r.fee_eur), 0));
      const bought = perm.filter((r) => r.gain_eur != null && r.origin !== 'Academy');
      const posM = r1(bought.filter((r) => Number(r.gain_eur) > 0).reduce((a, r) => a + Number(r.gain_eur), 0));
      const negM = r1(bought.filter((r) => Number(r.gain_eur) < 0).reduce((a, r) => a + Number(r.gain_eur), 0));
      const gainM = r1(academyM + posM + negM);
      const big = paid.reduce((b, r) => (b == null || Number(r.fee_eur) > Number(b.fee_eur) ? r : b), null);
      return {
        club,
        sales_eur_m: salesM, sales_eur: full(salesM),
        spend_eur_m: spendM, spend_eur: full(spendM),
        net_eur_m: netM, net_eur: full(netM),
        since_eur: full(sinceM), since_share: salesM ? sinceM / salesM : null,
        recouped: spendM ? salesM / spendM : null,
        sold_count: perm.length,
        academy_count: acad.length, academy_eur_m: academyM, academy_eur: full(academyM),
        gain_pos_eur_m: posM, gain_neg_eur_m: negM,
        fee_gain_eur_m: gainM, fee_gain_eur: full(gainM),
        unknown_cost: perm.filter((r) => r.gain_eur == null).length,
        biggest_player: big ? big.player : null, biggest_to: big ? big.to : null,
        biggest_season: big ? big.season : null, biggest_fee_eur: big ? full(Number(big.fee_eur)) : null,
      };
    });
    [...rows].sort((a, b) => b.sales_eur_m - a.sales_eur_m).forEach((r, i) => { r.sales_rank = i + 1; });
    [...rows].sort((a, b) => b.net_eur_m - a.net_eur_m).forEach((r, i) => { r.net_rank = i + 1; });
    [...rows].sort((a, b) => b.fee_gain_eur_m - a.fee_gain_eur_m).forEach((r, i) => { r.gain_rank = i + 1; });
    return rows;
  },
});

dash.calc('sales_matrix', {
  inputs: ['sales_totals'],
  title: 'Season by club grid of sales and net spend',
  description: 'Sale income and net spend (spend minus sales) per season with one column per club, each with an all-seasons total row.',
  fn: (totals) => {
    const seasons = Array.from(new Set(totals.map((r) => r.season))).sort();
    const clubs = Array.from(new Set(totals.map((r) => r.club)));
    const out = [];
    [['net', 'net_spend_eur_m'], ['sales', 'sales_eur_m']].forEach(([metric, k]) => {
      seasons.forEach((s) => {
        const o = { key: `${metric}|${s}`, metric, season: s };
        totals.filter((r) => r.season === s).forEach((r) => { o[r.club] = Number(r[k]); });
        out.push(o);
      });
      // total row: net is all spend minus all sales, so it matches the club totals exactly
      const all = { key: `${metric}|All seasons`, metric, season: 'All seasons' };
      clubs.forEach((c) => {
        const rs = totals.filter((r) => r.club === c);
        const sales = rs.reduce((a, r) => a + Number(r.sales_eur_m), 0);
        const spend = rs.reduce((a, r) => a + Number(r.spend_eur_m), 0);
        all[c] = Math.round((metric === 'net' ? Math.round(spend * 10) / 10 - Math.round(sales * 10) / 10 : sales) * 10) / 10;
      });
      out.push(all);
    });
    return out;
  },
});

dash.calc('sale_src', {
  inputs: ['sales', 'sales_sources'],
  title: 'Source name per sale',
  description: 'Looks up the full source name for each sale’s source code.',
  fn: (sales, sources) => {
    const name = {};
    sources.forEach((s) => { name[s.key] = s.name; });
    return sales.map((r) => ({ id: r.id, source: name[r.src] || r.src }));
  },
});

const fmtH = d3.formatLocale({ decimal: '.', thousands: ',', grouping: [3], currency: ['€', ''], minus: '-' }).format;
const fmtSignedM = (v) => (v == null ? '—' : `${v < 0 ? '-' : '+'}${fmtM(Math.abs(v))}`);
const fmtSignedE = (v) => (v == null ? '—' : fmtSignedM(v / 1e6));
let salesFocus = null;
let profitFocus = null;
let saleSortKey = 'fee_eur';
let saleSortAsc = false;

function clubLegend(el, get, set, redraw) {
  CLUBS.forEach((club) => {
    const b = document.createElement('button');
    b.className = 'bx-leg';
    b.dataset.club = club;
    b.setAttribute('aria-pressed', 'false');
    const sw = document.createElement('span');
    sw.className = 'bx-sw';
    sw.style.background = colorOf(club);
    b.append(sw, document.createTextNode(club));
    b.addEventListener('click', () => {
      set(get() === club ? null : club);
      el.querySelectorAll('.bx-leg').forEach((x) => {
        const on = get() === x.dataset.club;
        x.setAttribute('aria-pressed', String(on));
        x.classList.toggle('bx-dim', get() !== null && !on);
      });
      redraw();
    });
    el.append(b);
  });
}
clubLegend(document.getElementById('sales-legend'), () => salesFocus, (v) => { salesFocus = v; }, () => drawSalesLines());
clubLegend(document.getElementById('profit-legend'), () => profitFocus, (v) => { profitFocus = v; }, () => drawProfitLines());
staticLegend(document.getElementById('net-legend'), [['Paid for by sales', dash.colors[0]], ['Net spend', 'var(--cds-chart-muted)']]);
const GAIN_PARTS = [
  { key: 'academy', label: 'Academy graduates sold', color: () => dash.colors[2] },
  { key: 'pos', label: 'Bought players sold for more than they cost', color: () => dash.colors[0] },
  { key: 'neg', label: 'Bought players sold for less', color: () => 'var(--color-bad)' },
];
staticLegend(document.getElementById('gain-legend'), GAIN_PARTS.map((p) => [p.label, p.color()]));

function drawSalesHeadline() {
  const st = dash.data('sales_club_totals');
  const rows = st.status === 'ok' ? st.data : [];
  const c = rows.find((r) => r.club === 'Man City');
  const ok = Boolean(c);
  setText('st-sales', ok ? fmtE(c.sales_eur) : '—', st);
  setText('st-rank', ok ? ordinal(c.sales_rank) : '—', st);
  const leader = rows.find((r) => r.sales_rank === 1);
  const wrap = document.getElementById('st-leader-wrap');
  if (ok && leader && leader.club !== 'Man City') {
    wrap.hidden = false;
    const w = `club=${whereVal(leader.club)}`;
    document.getElementById('st-leader').dataset.where = w;
    document.getElementById('st-leader-sales').dataset.where = w;
    setText('st-leader', leader.club, st);
    setText('st-leader-sales', fmtE(leader.sales_eur), st);
  } else {
    wrap.hidden = ok;
    setText('st-leader', '—', st);
    setText('st-leader-sales', '—', st);
  }
  setText('st-spend', ok ? fmtE(c.spend_eur) : '—', st);
  setText('st-net', ok ? fmtE(c.net_eur) : '—', st);
  setText('st-net-rank', ok ? ordinal(c.net_rank) : '—');
  setText('st-since', ok && c.since_share != null ? fmtPct(c.since_share) : '—');
  setText('st-academy', ok ? fmtE(c.academy_eur) : '—');
  setText('sk-sales', ok ? fmtE(c.sales_eur) : '—', st);
  setText('sk-sold', ok ? d3.format(',')(c.sold_count) : '—');
  setText('sk-net', ok ? fmtE(c.net_eur) : '—', st);
  setText('sk-recouped', ok && c.recouped != null ? fmtPct(c.recouped) : '—');
  setText('sk-academy', ok ? fmtE(c.academy_eur) : '—', st);
  setText('sk-academy-n', ok ? String(c.academy_count) : '—');
  setText('sk-big', ok && c.biggest_fee_eur != null ? fmtE(c.biggest_fee_eur) : '—', st);
  setText('sk-big-player', ok && c.biggest_player ? c.biggest_player : '—');
  setText('sk-big-to', ok && c.biggest_to ? c.biggest_to : '—');
  setText('sk-big-season', ok && c.biggest_season ? c.biggest_season : '—');
}

function drawSalesLines() {
  const box = document.getElementById('sales-chart');
  const st = dash.data('sales_totals');
  loading(box, st);
  box.replaceChildren();
  if (st.status !== 'ok') { if (failed(st)) box.append(failNote()); return; }
  const rows = st.data.map((r) => ({ season: r.season, club: r.club, v: Number(r.sales_eur_m), n: Number(r.sales_count) }));
  drawClubLines(box, rows, {
    focus: salesFocus,
    aria: 'Sale income per season for each Big Six club',
    fmtTick: (t) => (t === 0 ? '€0' : `€${d3.format(',')(t)}m`),
    fmtVal: (d) => `${fmtM(d.v)} · ${d.n} ${d.n === 1 ? 'sale' : 'sales'}`,
  });
}

function drawNetBars() {
  const box = document.getElementById('net-chart');
  const st = dash.data('sales_club_totals');
  loading(box, st);
  box.replaceChildren();
  if (st.status !== 'ok') { if (failed(st)) box.append(failNote()); return; }
  const rows = [...st.data].sort((a, b) => b.net_eur_m - a.net_eur_m);
  const W = Math.max(280, box.clientWidth);
  const bar = 26;
  const gap = 18;
  const m = { top: 4, right: 0, bottom: 4, left: 0 };
  const H = m.top + m.bottom + rows.length * (bar + gap) - gap;
  box.style.minHeight = `${H}px`;
  const svg = d3.select(box).append('svg').attr('width', '100%').attr('viewBox', `0 0 ${W} ${H}`)
    .attr('role', 'img').attr('aria-label', 'Total spend, sale income and net spend by club');
  const label = (r) => `net ${fmtM(r.net_eur_m)}`;
  m.left = yAxisLeft(svg, rows.map((r) => r.club)) + 2;
  m.right = yAxisLeft(svg, rows.map(label)) + 4;
  const x = d3.scaleLinear([0, d3.max(rows, (r) => Math.max(r.spend_eur_m, r.sales_eur_m))], [m.left, W - m.right]);
  const tip = makeTip(box);
  rows.forEach((r, i) => {
    const yy = m.top + i * (bar + gap);
    const g = svg.append('g');
    g.append('text').attr('class', 'bx-tick').attr('x', m.left - 10).attr('y', yy + bar / 2).attr('dy', '0.32em').attr('text-anchor', 'end')
      .style('fill', r.club === 'Man City' ? 'var(--color-fg)' : 'var(--color-fg-muted)').text(r.club);
    g.append('rect').attr('x', x(0)).attr('y', yy).attr('height', bar).attr('width', Math.max(0, x(r.spend_eur_m) - x(0))).attr('rx', 4)
      .style('fill', 'var(--cds-chart-muted)');
    g.append('rect').attr('x', x(0)).attr('y', yy).attr('height', bar).attr('width', Math.max(0, x(r.sales_eur_m) - x(0))).attr('rx', 4)
      .style('fill', dash.colors[0]);
    g.append('text').attr('class', 'bx-tick').attr('x', x(Math.max(r.spend_eur_m, r.sales_eur_m)) + 8).attr('y', yy + bar / 2).attr('dy', '0.32em')
      .style('fill', 'var(--color-fg)').text(label(r));
    g.append('rect').attr('x', 0).attr('y', yy - gap / 2).attr('width', W).attr('height', bar + gap).style('fill', 'transparent')
      .on('pointerenter', () => {
        fillTip(tip, r.club, [
          ['Spend', fmtM(r.spend_eur_m), 'var(--cds-chart-muted)'],
          ['Sale income', fmtM(r.sales_eur_m), dash.colors[0]],
          ['Net spend', fmtM(r.net_eur_m), null],
          ['Share paid for by sales', r.recouped == null ? '—' : fmtPct(r.recouped), null],
        ]);
        const ratio = box.getBoundingClientRect().width / W;
        const tw = tip.offsetWidth;
        let left = x(r.sales_eur_m) * ratio;
        if (left + tw > box.clientWidth) left = box.clientWidth - tw;
        tip.style.left = `${Math.max(0, left)}px`;
        tip.style.top = `${i < rows.length / 2 ? (yy + bar + 6) * ratio : Math.max(0, yy * ratio - tip.offsetHeight - 6)}px`;
      })
      .on('pointerleave', () => { tip.hidden = true; });
  });
}

const sgridMetric = document.getElementById('sgrid-metric');
sgridMetric.addEventListener('change', () => drawSalesGrid());
function drawSalesGrid() {
  const head = document.getElementById('sgrid-head');
  const body = document.getElementById('sgrid-body');
  const leg = document.getElementById('sgrid-legend');
  const metric = sgridMetric.value;
  const neg = dash.colors[2];
  const posCol = dash.colors[0];
  leg.replaceChildren();
  (metric === 'net' ? [['Spent more than it sold', posCol], ['Sold more than it spent', neg]] : [['Bigger season, darker cell', posCol]]).forEach(([t, c]) => {
    const s = document.createElement('span');
    s.className = 'bx-leg';
    const sw = document.createElement('span');
    sw.className = 'bx-sw';
    sw.style.background = c;
    s.append(sw, document.createTextNode(t));
    leg.append(s);
  });
  const st = dash.data('sales_matrix');
  if (!head.children.length) {
    const th = document.createElement('th');
    th.dataset.field = 'season';
    th.textContent = 'Season';
    head.append(th);
    CLUBS.forEach((c) => {
      const h = document.createElement('th');
      h.dataset.field = c;
      h.className = c === 'Man City' ? 'bx-num bx-city' : 'bx-num';
      h.textContent = c;
      head.append(h);
    });
  }
  body.replaceChildren();
  if (st.status !== 'ok') {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = CLUBS.length + 1;
    if (failed(st)) td.append(failNote()); else { td.textContent = '—'; td.classList.toggle('dash-skeleton', st.status === 'loading'); }
    tr.append(td);
    body.append(tr);
    return;
  }
  const rows = st.data.filter((r) => r.metric === metric);
  const seasonRows = rows.filter((r) => r.season !== 'All seasons');
  const max = d3.max(seasonRows, (r) => d3.max(CLUBS, (c) => Math.abs(Number(r[c]) || 0))) || 1;
  rows.forEach((r) => {
    const tr = document.createElement('tr');
    tr.dataset.key = r.key;
    const isTotal = r.season === 'All seasons';
    if (isTotal) tr.className = 'bx-total';
    const td0 = document.createElement('td');
    td0.textContent = r.season;
    tr.append(td0);
    CLUBS.forEach((c) => {
      const td = document.createElement('td');
      td.className = 'bx-num';
      const v = r[c];
      td.textContent = v == null ? '—' : fmtH(',.1f')(Number(v));
      if (!isTotal && v != null && Number(v) !== 0) {
        const pct = Math.round(4 + 46 * (Math.abs(Number(v)) / max));
        td.style.background = `color-mix(in srgb, ${Number(v) < 0 ? neg : posCol} ${pct}%, transparent)`;
      }
      tr.append(td);
    });
    body.append(tr);
  });
}

function drawGainBars() {
  const box = document.getElementById('gain-chart');
  const st = dash.data('sales_club_totals');
  loading(box, st);
  box.replaceChildren();
  if (st.status !== 'ok') { if (failed(st)) box.append(failNote()); return; }
  const rows = [...st.data].sort((a, b) => b.fee_gain_eur_m - a.fee_gain_eur_m);
  const W = Math.max(280, box.clientWidth);
  const bar = 26;
  const gap = 18;
  const m = { top: 4, right: 0, bottom: 22, left: 0 };
  const H = m.top + m.bottom + rows.length * (bar + gap) - gap;
  box.style.minHeight = `${H}px`;
  const svg = d3.select(box).append('svg').attr('width', '100%').attr('viewBox', `0 0 ${W} ${H}`)
    .attr('role', 'img').attr('aria-label', 'Gain on players sold by club, split into academy sales, gains and losses on bought players');
  const label = (r) => `net ${fmtSignedM(r.fee_gain_eur_m)}`;
  m.left = yAxisLeft(svg, rows.map((r) => r.club)) + 2;
  m.right = yAxisLeft(svg, rows.map(label)) + 4;
  const lo = Math.min(0, d3.min(rows, (r) => r.gain_neg_eur_m));
  const hi = d3.max(rows, (r) => r.academy_eur_m + r.gain_pos_eur_m);
  const x = d3.scaleLinear([lo, hi], [m.left, W - m.right]).nice();
  x.ticks(W < 520 ? 4 : 6).forEach((t) => {
    svg.append('line').attr('x1', x(t)).attr('x2', x(t)).attr('y1', m.top).attr('y2', H - m.bottom).style('stroke', t === 0 ? 'var(--cds-chart-axis)' : 'var(--cds-chart-grid)');
    svg.append('text').attr('class', 'bx-tick').attr('x', x(t)).attr('y', H - m.bottom + 16).attr('text-anchor', 'middle')
      .text(t === 0 ? '€0' : `${t < 0 ? '-' : ''}€${d3.format(',')(Math.abs(t))}m`);
  });
  const tip = makeTip(box);
  rows.forEach((r, i) => {
    const yy = m.top + i * (bar + gap);
    const g = svg.append('g');
    g.append('text').attr('class', 'bx-tick').attr('x', m.left - 10).attr('y', yy + bar / 2).attr('dy', '0.32em').attr('text-anchor', 'end')
      .style('fill', r.club === 'Man City' ? 'var(--color-fg)' : 'var(--color-fg-muted)').text(r.club);
    const segs = [
      [0, r.academy_eur_m, GAIN_PARTS[0].color()],
      [r.academy_eur_m, r.academy_eur_m + r.gain_pos_eur_m, GAIN_PARTS[1].color()],
      [r.gain_neg_eur_m, 0, GAIN_PARTS[2].color()],
    ];
    segs.forEach(([a, b, col]) => {
      if (b - a <= 0) return;
      g.append('rect').attr('x', x(a)).attr('y', yy).attr('height', bar).attr('width', Math.max(0, x(b) - x(a) - 1)).style('fill', col);
    });
    const nx = x(r.fee_gain_eur_m);
    g.append('line').attr('x1', nx).attr('x2', nx).attr('y1', yy - 4).attr('y2', yy + bar + 4).style('stroke', 'var(--color-fg)').attr('stroke-width', 2.5);
    g.append('text').attr('class', 'bx-tick').attr('x', x(r.academy_eur_m + r.gain_pos_eur_m) + 8).attr('y', yy + bar / 2).attr('dy', '0.32em')
      .style('fill', 'var(--color-fg)').text(label(r));
    g.append('rect').attr('x', 0).attr('y', yy - gap / 2).attr('width', W).attr('height', bar + gap).style('fill', 'transparent')
      .on('pointerenter', () => {
        fillTip(tip, r.club, [
          [`Academy graduates (${r.academy_count})`, fmtSignedM(r.academy_eur_m), GAIN_PARTS[0].color()],
          ['Bought, sold for more', fmtSignedM(r.gain_pos_eur_m), GAIN_PARTS[1].color()],
          ['Bought, sold for less', fmtSignedM(r.gain_neg_eur_m), GAIN_PARTS[2].color()],
          ['Net gain on fees', fmtSignedM(r.fee_gain_eur_m), null],
          ['Sales with unknown cost', String(r.unknown_cost), null],
        ]);
        const ratio = box.getBoundingClientRect().width / W;
        const tw = tip.offsetWidth;
        let left = nx * ratio + 10;
        if (left + tw > box.clientWidth) left = box.clientWidth - tw;
        tip.style.left = `${Math.max(0, left)}px`;
        tip.style.top = `${i < rows.length / 2 ? (yy + bar + 6) * ratio : Math.max(0, yy * ratio - tip.offsetHeight - 6)}px`;
      })
      .on('pointerleave', () => { tip.hidden = true; });
  });
}

function drawProfitLines() {
  const box = document.getElementById('profit-chart');
  const st = dash.data('sales_profit');
  loading(box, st);
  box.replaceChildren();
  if (st.status !== 'ok') { if (failed(st)) box.append(failNote()); return; }
  const rows = st.data.map((r) => ({ season: r.season, club: r.club, v: r.profit_gbp_m == null ? null : Number(r.profit_gbp_m) }));
  drawClubLines(box, rows, {
    focus: profitFocus,
    aria: 'Profit on player sales in the accounts, per season, for each Big Six club',
    fmtTick: (t) => (t === 0 ? '£0' : `£${d3.format(',')(t)}m`),
    fmtVal: (d) => fmtGBP(d.v),
  });
}

const saleClub = document.getElementById('sale-club');
CLUBS.forEach((c) => saleClub.append(new Option(c, c)));
saleClub.addEventListener('change', () => dash.setParams({ club: saleClub.value }));
const saleOrigin = document.getElementById('sale-origin');
saleOrigin.addEventListener('change', () => drawSalesTable());
const saleSearch = document.getElementById('sale-search');
saleSearch.addEventListener('input', () => drawSalesTable());
const feeOnly = document.getElementById('fee-only');
feeOnly.addEventListener('change', () => drawSalesTable());
const SALE_NUM = ['fee_eur', 'fee_gbp_reported', 'cost_eur', 'gain_eur'];
document.querySelectorAll('#sale-table .bx-sort').forEach((b) => {
  b.addEventListener('click', () => {
    const k = b.dataset.k;
    if (saleSortKey === k) saleSortAsc = !saleSortAsc;
    else { saleSortKey = k; saleSortAsc = !SALE_NUM.includes(k); }
    drawSalesTable();
  });
});

function drawSalesTable() {
  const club = dash.params().club || 'Man City';
  saleClub.value = club;
  const w = `club=${whereVal(club)}`;
  ['ss-club', 'ss-sold', 'ss-sales', 'ss-gain'].forEach((id) => { document.getElementById(id).dataset.where = w; });
  const ct = dash.data('sales_club_totals');
  const row = ct.status === 'ok' ? ct.data.find((r) => r.club === club) : null;
  setText('ss-club', row ? row.club : '—');
  setText('ss-sold', row ? d3.format(',')(row.sold_count) : '—');
  setText('ss-sales', row ? fmtE(row.sales_eur) : '—');
  setText('ss-gain', row ? fmtSignedE(row.fee_gain_eur) : '—');

  document.querySelectorAll('#sale-table th').forEach((th) => {
    const k = th.querySelector('.bx-sort')?.dataset.k;
    if (k === saleSortKey) th.setAttribute('aria-sort', saleSortAsc ? 'ascending' : 'descending');
    else th.removeAttribute('aria-sort');
  });

  const body = document.getElementById('sale-body');
  body.replaceChildren();
  const st = dash.data('sales');
  if (st.status !== 'ok') {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 11;
    if (failed(st)) td.append(failNote());
    else { td.textContent = '—'; td.classList.toggle('dash-skeleton', st.status === 'loading'); }
    tr.append(td);
    body.append(tr);
    return;
  }
  const srcSt = dash.data('sale_src');
  const srcName = {};
  if (srcSt.status === 'ok') srcSt.data.forEach((r) => { srcName[r.id] = r.source; });
  const q = saleSearch.value.trim().toLowerCase();
  let list = st.data.filter((r) => r.club === club);
  if (feeOnly.checked) list = list.filter((r) => Number(r.fee_eur) > 0);
  if (saleOrigin.value) list = list.filter((r) => r.origin === saleOrigin.value);
  if (q) list = list.filter((r) => `${r.player} ${r.to}`.toLowerCase().includes(q));
  const val = (r, k) => (k === 'source' ? srcName[r.id] || '' : r[k]);
  const num = (v) => (v == null || v === '' ? -Infinity : Number(v));
  const isNum = SALE_NUM.includes(saleSortKey);
  list.sort((a, b) => {
    const va = val(a, saleSortKey);
    const vb = val(b, saleSortKey);
    let c = isNum ? (num(va) === num(vb) ? 0 : num(va) < num(vb) ? -1 : 1) : String(va ?? '').localeCompare(String(vb ?? ''));
    if (!saleSortAsc) c = -c;
    if (c === 0) c = a.season.localeCompare(b.season) || (num(b.fee_eur) > num(a.fee_eur) ? 1 : num(b.fee_eur) < num(a.fee_eur) ? -1 : 0);
    return c;
  });
  const f2 = fmtH(',.2~f');
  const s2 = fmtH('+,.2~f');
  list.forEach((r) => {
    const tr = document.createElement('tr');
    tr.dataset.key = r.id;
    const cells = [
      [r.season], [r.window], [r.player], [r.to || '—'], [r.type],
      [r.fee_eur == null ? '—' : f2(Number(r.fee_eur)), 'bx-num'],
      [r.fee_gbp_reported == null ? '—' : f2(Number(r.fee_gbp_reported)), 'bx-num'],
      [r.origin],
      [r.cost_eur == null ? '—' : f2(Number(r.cost_eur)), 'bx-num'],
      [r.gain_eur == null ? '—' : s2(Number(r.gain_eur)), r.gain_eur == null ? 'bx-num' : Number(r.gain_eur) < 0 ? 'bx-num bx-neg' : 'bx-num bx-pos'],
      [srcName[r.id] || '—'],
    ];
    cells.forEach(([t, cls]) => {
      const td = document.createElement('td');
      if (cls) td.className = cls;
      td.textContent = t;
      tr.append(td);
    });
    body.append(tr);
  });
  document.getElementById('sale-empty').hidden = list.length > 0;
}

function drawSalesSources() {
  const body = document.getElementById('salesrc-body');
  body.replaceChildren();
  const st = dash.data('sales_sources');
  if (st.status !== 'ok') {
    if (failed(st)) { const tr = document.createElement('tr'); const td = document.createElement('td'); td.colSpan = 2; td.append(failNote()); tr.append(td); body.append(tr); }
    return;
  }
  st.data.forEach((r) => {
    const tr = document.createElement('tr');
    tr.dataset.key = r.key;
    const td1 = document.createElement('td');
    const a = document.createElement('a');
    a.href = r.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = r.name;
    td1.append(a);
    const td2 = document.createElement('td');
    td2.textContent = r.covers;
    tr.append(td1, td2);
    body.append(tr);
  });
}

// =================== pages ===================
let page = 'spend';
const pages = { spend: document.getElementById('spend'), seasons: document.getElementById('seasons'), wages: document.getElementById('wages'), sales: document.getElementById('sales') };
function render() {
  if (page === 'spend') {
    drawHeadline(); drawTrend(); drawRanking(); drawMatrix(); drawSignings(); drawSources();
    if (dash.data('totals').status === 'ok') firstDraw = false;
  } else if (page === 'seasons') {
    drawSeasonHeadline(); drawRevenue(); drawGamesGrid(); drawBump(); drawSeasonTable(); drawCompTable(); drawSeasonSources();
  } else if (page === 'wages') {
    drawWageHeadline(); drawWageLines(); drawWageGrid(); drawTopPaid(); drawEarners(); drawTimeline(); drawManagerTable(); drawWageSources();
  } else {
    drawSalesHeadline(); drawSalesLines(); drawNetBars(); drawSalesGrid(); drawGainBars(); drawProfitLines(); drawSalesTable(); drawSalesSources();
  }
}
function showPage(name) {
  page = name;
  Object.entries(pages).forEach(([k, el]) => { el.hidden = k !== name; });
  document.querySelectorAll('.bx-tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.page === name)));
  render();
}
document.querySelectorAll('.bx-tab').forEach((t) => t.addEventListener('click', () => { showPage(t.dataset.page); dash.setLink(t.dataset.page); }));

const hashTarget = location.hash ? document.getElementById(location.hash.slice(1)) : null;
if (hashTarget && pages.seasons.contains(hashTarget)) showPage('seasons');
if (hashTarget && pages.wages.contains(hashTarget)) showPage('wages');
if (hashTarget && pages.sales.contains(hashTarget)) showPage('sales');

const pageSource = { spend: 'signings', seasons: 'competitions', wages: 'wages', sales: 'sales' };
let linked = false;
dash.onData(() => {
  render();
  if (!linked && hashTarget && dash.data(pageSource[page]).status === 'ok') {
    linked = true;
    if (hashTarget !== pages[page]) { hashTarget.scrollIntoView(); dash.setLink(hashTarget.id); }
  }
});
