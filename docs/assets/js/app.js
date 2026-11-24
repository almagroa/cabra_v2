(function () {
  "use strict";

  const I18N = window.CABRA_I18N;
  const D = window.CabraData;
  const $ = (s) => document.querySelector(s);

  // ------------------------------------------------------------------ idioma
  let lang = "pt";
  try { lang = localStorage.getItem("cabra-lang") || ((navigator.language || "pt").startsWith("pt") ? "pt" : "en"); } catch (e) { /* sem storage */ }
  if (!I18N[lang]) lang = "en";
  const t = (k) => (I18N[lang][k] !== undefined ? I18N[lang][k] : k);

  function applyLang() {
    document.documentElement.lang = lang === "pt" ? "pt-BR" : "en";
    document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
    document.querySelectorAll("[data-i18n-html]").forEach((el) => { el.innerHTML = t(el.dataset.i18nHtml); });
    document.querySelectorAll("[data-i18n-ph]").forEach((el) => { el.placeholder = t(el.dataset.i18nPh); });
    document.querySelectorAll(".lang button").forEach((b) => b.classList.toggle("on", b.dataset.lang === lang));
  }
  document.querySelectorAll(".lang button").forEach((b) => b.addEventListener("click", () => {
    if (b.dataset.lang === lang) return;
    lang = b.dataset.lang;
    try { localStorage.setItem("cabra-lang", lang); } catch (e) { /* ok */ }
    applyLang();
    refreshAll();
  }));

  // ------------------------------------------------------------------ formatos
  const loc = () => (lang === "pt" ? "pt-BR" : "en-US");
  const nf = (v, d = 0) => (v === null || v === undefined || v === "" || Number.isNaN(+v) ? "–"
    : Number(v).toLocaleString(loc(), { maximumFractionDigits: d, minimumFractionDigits: d }));
  const autoD = (v) => (Math.abs(v) >= 100 ? 0 : Math.abs(v) >= 10 ? 1 : 2);
  const biomeName = (b) => (t("biome")[b] || b);
  const hregName = (h) => h.replace(/([a-z])([A-Z])/g, "$1 $2");
  const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
  const fmtDate = (s) => { const [y, m, d] = s.split("-"); return lang === "pt" ? `${d}/${m}/${y}` : `${y}-${m}-${d}`; };

  // ------------------------------------------------------------------ estado
  let catchments = [];
  let byId = new Map();
  let attributes = null;
  let attrIndex = {};          // classe -> Map(id -> {coluna: valor})
  let selected = null;
  let filters = { state: "", biome: "" };

  // ------------------------------------------------------------------ mapa
  const map = L.map("leaflet-map", { zoomControl: true, preferCanvas: true, minZoom: 3 }).setView([-15, -52], 4);
  L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: "abcd", maxZoom: 18,
  }).addTo(map);
  const canvas = L.canvas({ padding: 0.3 });
  const outlineLayer = L.layerGroup().addTo(map);
  const pointsLayer = L.layerGroup().addTo(map);
  let boundaryLayer = null;
  const markers = new Map();

  const BIOME_COLORS = { Amazon: "#22c55e", Atlanticforest: "#62cbff", Cerrado: "#eab308", Caatinga: "#f97316", Pampa: "#a78bfa", Pantanal: "#e9effc" };
  const RAMP = ["#0b2a5b", "#005adf", "#3d8bff", "#62cbff", "#bfe9ff"];
  const RAMP_DRY = ["#62cbff", "#3d8bff", "#a78bfa", "#eab308", "#f97316"];
  const VARIABLES = {
    none: {},
    aridity: { key: "aridity", d: 2, ramp: RAMP_DRY },
    prec: { key: "prec", d: 0, ramp: RAMP },
    qmean: { key: "qmean", d: 2, ramp: RAMP },
    area: { key: "area", d: 0, ramp: RAMP },
    hdi: { key: "hdi", d: 2, ramp: RAMP_DRY },
    forest: { get: (c) => c.cover.forest, d: 0, ramp: ["#0b2a5b", "#14532d", "#16a34a", "#4ade80", "#bbf7d0"] },
    biome: { cat: true },
  };
  let colorBy = "none";
  const POINT = { fill: "#3d8bff", stroke: "#62cbff" };
  const SEL = "#ef4444";

  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  function rampColor(ramp, x) {
    const n = ramp.length - 1;
    const i = Math.min(n - 1, Math.floor(x * n));
    const f = x * n - i;
    const a = hex(ramp[i]), b = hex(ramp[i + 1]);
    return `rgb(${a.map((v, k) => Math.round(v + (b[k] - v) * f)).join(",")})`;
  }

  function colorFn() {
    const v = VARIABLES[colorBy];
    if (colorBy === "none") return { fn: () => POINT.fill, none: true };
    if (v.cat) return { cat: true, fn: (c) => BIOME_COLORS[c.biome] || "#888" };
    const get = v.get || ((c) => c[v.key]);
    const vals = catchments.map(get).filter((x) => x !== null && !isNaN(x)).sort((a, b) => a - b);
    const rank = (x) => {   // cor pelo percentil: legível mesmo com distribuições assimétricas
      let lo = 0, hi = vals.length - 1;
      while (lo < hi) { const m = (lo + hi) >> 1; if (vals[m] < x) lo = m + 1; else hi = m; }
      return lo / (vals.length - 1);
    };
    const q = (p) => vals[Math.round(p * (vals.length - 1))];
    return { fn: (c) => (get(c) === null ? "#555" : rampColor(v.ramp, rank(get(c)))), q, d: v.d, ramp: v.ramp };
  }

  const visible = (c) => (!filters.state || c.state === filters.state) && (!filters.biome || c.biome === filters.biome);

  function drawPoints() {
    const cf = colorFn();
    pointsLayer.clearLayers();
    markers.clear();
    catchments.filter(visible).forEach((c) => {
      const m = L.circleMarker([c.lat, c.lon], {
        renderer: canvas, radius: 5, weight: 1, color: cf.none ? POINT.stroke : "#050d1f", fillColor: cf.fn(c), fillOpacity: 0.9,
      });
      m._fill = cf.fn(c);
      m.bindTooltip(`<b>${c.ana} - ${esc(c.name.toUpperCase())}</b><span>CABra ${c.id} · ${c.state} · ${nf(c.area)} km²</span>`, { direction: "top", offset: [0, -6] });
      m.on("click", () => go(`#map/${c.id}`));
      m.addTo(pointsLayer);
      markers.set(c.id, m);
    });
    if (selected) highlight(selected.id);
    drawLegend(cf);
  }

  function drawLegend(cf) {
    $("#colorby").innerHTML = Object.keys(VARIABLES).map((k) => `<option value="${k}" ${k === colorBy ? "selected" : ""}>${t("v_" + k)}</option>`).join("");
    const body = $("#legend-body");
    if (cf.none) body.innerHTML = "";
    else if (cf.cat) body.innerHTML = `<div class="cats">${Object.keys(BIOME_COLORS).map((b) => `<span style="--c:${BIOME_COLORS[b]}">${biomeName(b)}</span>`).join("")}</div>`;
    else body.innerHTML = `<div class="rampa" style="background:linear-gradient(90deg,${cf.ramp.join(",")})"></div>
      <div class="escala"><span>${nf(cf.q(0), cf.d)}</span><span>${nf(cf.q(0.5), cf.d)}</span><span>${nf(cf.q(1), cf.d)}</span></div>`;
  }
  $("#colorby").addEventListener("change", (e) => { colorBy = e.target.value; drawPoints(); });

  function highlight(id) {
    markers.forEach((m, k) => {
      if (k === id) m.setStyle({ radius: 8, weight: 2, color: "#fff", fillColor: SEL, fillOpacity: 1 });
      else m.setStyle({ radius: 5, weight: 1, color: colorBy === "none" ? POINT.stroke : "#050d1f", fillColor: m._fill, fillOpacity: 0.9 });
    });
    const m = markers.get(id);
    if (m) m.bringToFront();
  }

  function fitAll() {
    const cs = catchments.filter(visible);
    if (!cs.length) return;
    map.fitBounds(L.latLngBounds(cs.map((c) => [c.lat, c.lon])), { padding: [30, 30], maxZoom: 8 });
  }

  // contornos de todas as bacias, bem discretos, como referência
  D.outlines().then((fc) => {
    L.geoJSON(fc, { renderer: canvas, interactive: false, style: { color: "#3d8bff", weight: 0.5, opacity: 0.25, fillOpacity: 0 } }).addTo(outlineLayer);
  }).catch(() => { /* opcional */ });

  // ------------------------------------------------------------------ filtros
  function renderFilters() {
    const states = [...new Set(catchments.map((c) => c.state))].sort();
    $("#f-state").innerHTML = `<option value="">${t("all_states")}</option>` + states.map((s) => `<option ${s === filters.state ? "selected" : ""}>${s}</option>`).join("");
    const biomes = Object.keys(BIOME_COLORS);
    $("#f-biome").innerHTML = `<option value="">${t("all_biomes")}</option>` + biomes.map((b) => `<option value="${b}" ${b === filters.biome ? "selected" : ""}>${biomeName(b)}</option>`).join("");
  }
  $("#f-state").addEventListener("change", (e) => { filters.state = e.target.value; drawPoints(); fitAll(); });
  $("#f-biome").addEventListener("change", (e) => { filters.biome = e.target.value; drawPoints(); fitAll(); });

  // ------------------------------------------------------------------ busca
  const search = $("#search"), results = $("#search-results");
  let hits = [], hitIdx = 0;
  const norm = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  search.addEventListener("input", () => {
    const q = norm(search.value.trim());
    if (!q) { results.hidden = true; return; }
    hits = catchments.filter((c) => visible(c) && (norm(c.name).includes(q) || String(c.ana).startsWith(q) || String(c.id) === q || norm(c.state) === q)).slice(0, 15);
    hitIdx = 0;
    renderHits();
  });
  search.addEventListener("keydown", (e) => {
    if (results.hidden) return;
    if (e.key === "ArrowDown") { hitIdx = Math.min(hits.length - 1, hitIdx + 1); renderHits(); e.preventDefault(); }
    if (e.key === "ArrowUp") { hitIdx = Math.max(0, hitIdx - 1); renderHits(); e.preventDefault(); }
    if (e.key === "Enter" && hits[hitIdx]) pick(hits[hitIdx].id);
    if (e.key === "Escape") results.hidden = true;
  });
  function renderHits() {
    results.hidden = hits.length === 0;
    results.innerHTML = hits.map((c, i) =>
      `<li data-id="${c.id}" class="${i === hitIdx ? "on" : ""}"><span><b>${c.ana}</b>${esc(c.name.toUpperCase())}</span><small>${c.state} · CABra ${c.id}</small></li>`).join("");
  }
  results.addEventListener("mousedown", (e) => { const li = e.target.closest("li"); if (li) pick(+li.dataset.id); });
  function pick(id) { results.hidden = true; search.value = ""; search.blur(); go(`#map/${id}`); }
  search.addEventListener("blur", () => setTimeout(() => { results.hidden = true; }, 150));

  // ------------------------------------------------------------------ detalhe
  const TABS = [
    { k: "q", blocks: [{ title: "blk_sig", cls: "streamflow", cols: ["q_mean", "q_95", "q_5", "q_1", "q_99", "baseflow_index", "runoff_coef", "q_elasticity", "fdc_slope", "q_cv", "q_hfd", "q_zero"] }] },
    { k: "clim", blocks: [{ title: "blk_clim", cls: "climate", cols: ["clim_p", "clim_pet", "clim_et", "aridity_index", "p_seasonality", "clim_tmin", "clim_tmax", "clim_rh", "clim_srad", "clim_wind"] }] },
    { k: "land", blocks: [{ title: "blk_cover", special: "cover" }, { title: "blk_soil", special: "soil" }, { title: "blk_soilattr", cls: "soil", cols: ["soil_type", "soil_textclass", "soil_depth", "soil_carbon", "soil_bulk"] }, { title: "", cls: "landcover", cols: ["cover_main", "ndvi_djf", "ndvi_jja"] }] },
    { k: "phys", blocks: [{ title: "blk_topo", cls: "topography", cols: ["elev_mean", "elev_min", "elev_max", "elev_gauge", "catch_slope", "catch_order"] }, { title: "blk_geo", cls: "geology", cols: ["catch_lith", "sub_porosity", "sub_permeability", "sub_hconduc"], more: { cls: "groundwater", cols: ["aquif_name", "aquif_type", "catch_wtd", "catch_hand"] } }] },
    { k: "dist", blocks: [{ title: "blk_dist", cls: "disturbance", cols: ["hdisturb_index", "res_number", "res_area", "res_volume", "res_regulation", "water_demand", "cover_urban", "cover_crops", "dist_urban"] }] },
  ];
  let activeTab = "q";

  function unitOf(cls, col) {
    const a = attributes[cls];
    const i = a.columns.indexOf(col);
    return i >= 0 ? a.units[i] : "";
  }
  function metricCells(cls, cols, id) {
    const row = attrIndex[cls].get(id) || {};
    return cols.filter((c) => c in row).map((c) => {
      const v = row[c];
      const isTxt = typeof v === "string";
      const u = unitOf(cls, c);
      const val = v === null ? "–" : isTxt ? esc(v) : `${nf(v, autoD(v))}${u ? `<small>${esc(u)}</small>` : ""}`;
      return `<div class="metric-card" title="${c}"><span class="metric-label">${t("labels")[c] || c}</span><span class="metric-value${isTxt ? " txt" : ""}">${val}</span></div>`;
    }).join("");
  }

  const COVER_COLORS = { forest: "#22c55e", grass: "#a3e635", shrub: "#84cc16", crops: "#eab308", urban: "#93a3c4", waterp: "#62cbff", bare: "#f97316" };
  const SOIL_COLORS = { sand: "#fcd34d", silt: "#d97706", clay: "#92400e" };
  const barras = (pairs, colors, label) => `<div class="barras">${pairs.map(([k, v]) =>
    `<div class="barra-l"><span>${label(k)}</span><div class="trilho"><i style="width:${Math.min(100, Math.max(0, v))}%;background:${colors[k]}"></i></div><b>${nf(v, 0)}%</b></div>`).join("")}</div>`;

  function renderTabBody() {
    const c = selected;
    if (!c || !attributes) return;
    $("#d-tabs").innerHTML = TABS.map((tb) => `<li><button type="button" class="tab-button ${tb.k === activeTab ? "active" : ""}" data-k="${tb.k}">${t("tab_" + tb.k)}</button></li>`).join("");
    const tab = TABS.find((x) => x.k === activeTab);
    $("#d-tab-body").innerHTML = tab.blocks.map((b) => {
      let inner = "";
      if (b.special === "cover") {
        const pairs = Object.entries(c.cover).filter(([, v]) => v !== null && v >= 0.5).sort((x, y) => y[1] - x[1]);
        inner = barras(pairs, COVER_COLORS, (k) => t("c_" + k));
      } else if (b.special === "soil") {
        inner = barras(["sand", "silt", "clay"].map((k) => [k, c.soil[k]]), SOIL_COLORS, (k) => t("s_" + k));
      } else {
        inner = `<div class="metrics-grid">${metricCells(b.cls, b.cols, c.id)}${b.more ? metricCells(b.more.cls, b.more.cols, c.id) : ""}</div>`;
      }
      return `<div class="bloco">${b.title ? `<h4>${t(b.title)}</h4>` : ""}${inner}</div>`;
    }).join("");
  }
  $("#d-tabs").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    activeTab = b.dataset.k;
    renderTabBody();
  });

  const IC = {
    area: '<svg viewBox="0 0 24 24" width="20" height="20"><path d="M4 7l5-3 6 3 5-3v13l-5 3-6-3-5 3z M9 4v13 M15 7v13" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>',
    pin: '<svg viewBox="0 0 24 24" width="20" height="20"><path d="M12 21s-6.5-6.2-6.5-11.2a6.5 6.5 0 0 1 13 0C18.5 14.8 12 21 12 21Z" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="12" cy="9.8" r="2.3" fill="none" stroke="currentColor" stroke-width="1.7"/></svg>',
    globe: '<svg viewBox="0 0 24 24" width="20" height="20"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M3.5 12h17M12 3.5c2.5 2.6 3.6 5.4 3.6 8.5s-1.1 5.9-3.6 8.5c-2.5-2.6-3.6-5.4-3.6-8.5S9.5 6.1 12 3.5Z" fill="none" stroke="currentColor" stroke-width="1.7"/></svg>',
  };

  function renderDetail() {
    const c = selected;
    if (!c) return;
    $("#d-name").innerHTML = `${c.ana} - ${esc(c.name.toUpperCase())}<small>CABra ${c.id} · ${c.state} · ${biomeName(c.biome)} · ${hregName(c.hreg)}</small>`;
    $("#d-meta").innerHTML = [
      [IC.area, t("m_area"), `${nf(c.area, 1)} km²`], [IC.pin, t("m_lat"), nf(c.lat, 5)], [IC.globe, t("m_lon"), nf(c.lon, 5)],
    ].map(([ic, l, v]) => `<div>${ic}<p><span>${l}</span><b>${v}</b></p></div>`).join("");
    renderTabBody();
  }

  async function select(id) {
    const c = byId.get(id);
    if (!c) return;
    selected = c;
    $("#intro").hidden = true;
    $("#detail").hidden = false;
    $("#d-csv").disabled = false;
    renderDetail();
    highlight(id);
    const geom = await D.boundary(id);
    if (selected !== c) return;
    if (boundaryLayer) map.removeLayer(boundaryLayer);
    boundaryLayer = L.geoJSON(geom, { style: { color: "#62cbff", weight: 2, fillColor: "#3d8bff", fillOpacity: 0.18 }, interactive: false }).addTo(map);
    map.flyToBounds(boundaryLayer.getBounds(), { padding: [30, 30], maxZoom: 10, duration: 0.6 });
    loadSeries(c);
  }

  function clearSelection() {
    selected = null;
    seriesToken++;
    destroyPlot();
    if (boundaryLayer) { map.removeLayer(boundaryLayer); boundaryLayer = null; }
    $("#detail").hidden = true;
    $("#intro").hidden = false;
    $("#d-csv").disabled = true;
    $("#chart").innerHTML = `<div class="vazio">${t("chart_empty")}</div>`;
    $("#chart-title").innerHTML = "";
    $("#chart-hint").hidden = true;
    highlight(-1);
  }
  $("#d-close").addEventListener("click", () => go("#map"));

  // ------------------------------------------------------------------ gráfico
  let plot = null, series = null, chartMode = "q", seriesToken = 0, xZoom = null;
  const X_RANGE = [Date.parse("1980-01-01T00:00:00Z") / 1000, Date.parse("2010-12-31T00:00:00Z") / 1000];

  function destroyPlot() { if (plot) { plot.destroy(); plot = null; } }

  async function loadSeries(c) {
    const token = ++seriesToken;
    destroyPlot();
    xZoom = null;
    $("#chart").innerHTML = `<div class="vazio">${t("loading")}</div>`;
    const s = await D.series(c.id);
    if (token !== seriesToken) return;
    series = s;
    drawChart();
  }

  document.querySelectorAll("#chart-modes button").forEach((b) => b.addEventListener("click", () => {
    chartMode = b.dataset.mode;
    document.querySelectorAll("#chart-modes button").forEach((x) => x.classList.toggle("on", x === b));
    if (selected && series) drawChart();
  }));

  const axis = { stroke: "#93a3c4", grid: { stroke: "#13284f", width: 1 }, ticks: { stroke: "#13284f", width: 1 }, font: "11px 'Exo 2', sans-serif" };

  function drawChart() {
    destroyPlot();
    const el = $("#chart");
    el.innerHTML = "";
    const w = el.clientWidth, h = el.clientHeight;
    let opts, data;
    if (chartMode === "fdc") {
      const v = series.q.values.filter((x) => x !== null && x > 0).sort((a, b) => b - a);
      const n = v.length, step = Math.max(1, Math.floor(n / 800));
      const xs = [], ys = [];
      for (let i = 0; i < n; i += step) { xs.push(((i + 1) / (n + 1)) * 100); ys.push(v[i]); }
      xs.push((n / (n + 1)) * 100); ys.push(v[n - 1]);
      data = [xs, ys];
      opts = {
        width: w, height: h, legend: { show: false }, cursor: { drag: { x: false, y: false }, points: { size: 6, fill: "#62cbff" } },
        scales: { x: { time: false, range: [0, 100] }, y: { distr: 3 } },
        axes: [Object.assign({}, axis, { values: (u, vs) => vs.map((x) => x + "%") }), Object.assign({}, axis, { size: 56, values: (u, vs) => vs.map((x) => nf(x, x < 1 ? 2 : 0)) })],
        series: [{}, { stroke: "#62cbff", width: 2, fill: "rgba(98,203,255,0.08)" }],
      };
      $("#chart-title").innerHTML = `<i style="background:#62cbff"></i>${t("t_fdc")}`;
      $("#chart-hint").hidden = true;
    } else {
      const s = chartMode === "q" ? series.q : series.p;
      const n = s.values.length, t0 = Date.parse(s.start + "T00:00:00Z") / 1000;
      const xs = new Float64Array(n);
      for (let i = 0; i < n; i++) xs[i] = t0 + i * 86400;
      data = [xs, s.values];
      const isQ = chartMode === "q";
      opts = {
        width: w, height: h, legend: { show: false },
        tzDate: (ts) => uPlot.tzDate(new Date(ts * 1e3), "Etc/UTC"),
        cursor: { drag: { x: true, y: false, setScale: true }, points: { show: false } },
        scales: { x: { time: true }, y: { range: (u, mn, mx) => [0, (mx || 1) * 1.05] } },
        axes: [axis, Object.assign({}, axis, { size: 56, values: (u, vs) => vs.map((x) => nf(x, 0)) })],
        series: [{}, isQ
          ? { stroke: "#62cbff", width: 1.2, fill: "rgba(98,203,255,0.10)" }
          : { stroke: "#3d8bff", width: 0, fill: "rgba(0,90,223,0.75)", paths: uPlot.paths.bars({ size: [1, 3], gap: 0 }) }],
        hooks: { setScale: [(u, k) => { if (k === "x") xZoom = [u.scales.x.min, u.scales.x.max]; }] },
      };
      $("#chart-title").innerHTML = `<i style="background:${isQ ? "#62cbff" : "#005adf"}"></i>${t(isQ ? "t_q" : "t_p")}`;
      $("#chart-hint").hidden = false;
    }
    plot = new uPlot(opts, data, el);
    if (chartMode !== "fdc") {
      const r = xZoom || X_RANGE;
      plot.setScale("x", { min: r[0], max: r[1] });
      plot.over.addEventListener("dblclick", () => { xZoom = null; plot.setScale("x", { min: X_RANGE[0], max: X_RANGE[1] }); });
    }
    const st = chartMode === "p" ? series.p : series.q;
    const end = new Date(Date.parse(st.start + "T00:00:00Z") + (st.values.length - 1) * 86400000).toISOString().slice(0, 10);
    $("#period").textContent = `${fmtDate(st.start)} – ${fmtDate(end)}`;
  }
  let rT;
  window.addEventListener("resize", () => { clearTimeout(rT); rT = setTimeout(() => { if (plot && series) drawChart(); map.invalidateSize(); }, 150); });

  $("#d-csv").addEventListener("click", async () => {
    const c = selected;
    if (!c) return;
    const s = await D.series(c.id);
    const rows = new Map();
    const add = (ser, col) => {
      const t0 = Date.parse(ser.start + "T00:00:00Z");
      ser.values.forEach((v, i) => {
        const d = new Date(t0 + i * 86400000).toISOString().slice(0, 10);
        if (!rows.has(d)) rows.set(d, {});
        rows.get(d)[col] = v;
      });
    };
    add(s.p, "p");
    add(s.q, "q");
    const lines = ["date,precipitation_mm,streamflow_m3s"];
    [...rows.keys()].sort().forEach((d) => { const r = rows.get(d); lines.push(`${d},${r.p ?? ""},${r.q ?? ""}`); });
    download(`CABra_${c.id}_${c.ana}.csv`, `# CABra ${c.id} - ${c.name} (ANA ${c.ana})\n# CABra v1, https://doi.org/10.5281/zenodo.4070146\n` + lines.join("\n"));
  });

  function download(name, text) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }

  // ------------------------------------------------------------------ tabela
  const CLASS_KEYS = ["general", "topography", "climate", "streamflow", "groundwater", "geology", "soil", "landcover", "disturbance"];
  let tClass = "general", tSort = { col: 0, dir: 1 }, tFilter = "";

  function renderClasses() {
    $("#classes").innerHTML = CLASS_KEYS.map((k) => `<li><button type="button" class="tab-button ${k === tClass ? "active" : ""}" data-k="${k}">${t("cls_" + k)}</button></li>`).join("");
    $("#about-classes").innerHTML = CLASS_KEYS.map((k) => `<li>${t("cls_" + k)}</li>`).join("");
  }
  $("#classes").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) go(`#attributes/${b.dataset.k}`); });
  $("#tfilter").addEventListener("input", (e) => { tFilter = norm(e.target.value.trim()); renderTable(); });

  function renderTable() {
    if (!attributes) return;
    const a = attributes[tClass];
    let rows = a.rows;
    if (tFilter) rows = rows.filter((r) => r.some((v) => v !== null && norm(v).includes(tFilter)));
    const { col, dir } = tSort;
    rows = [...rows].sort((x, y) => {
      const a1 = x[col], b1 = y[col];
      if (a1 === null) return 1;
      if (b1 === null) return -1;
      return (typeof a1 === "number" && typeof b1 === "number" ? a1 - b1 : String(a1).localeCompare(String(b1))) * dir;
    });
    const labels = t("labels");
    const head = a.columns.map((c, i) =>
      `<th data-i="${i}" class="${i === col ? "sorted" : ""}" title="${esc(c)}">${esc(labels[c] || c)}${i === col ? (dir > 0 ? " ↑" : " ↓") : ""}<small>${a.units[i] ? esc(a.units[i]) : esc(c)}</small></th>`).join("");
    const body = rows.map((r) => `<tr data-id="${r[0]}">${r.map((v) => `<td class="${typeof v === "string" ? "txt" : ""}">${v === null ? "–" : esc(v)}</td>`).join("")}</tr>`).join("");
    $("#table").innerHTML = `<thead><tr>${head}</tr></thead><tbody>${body}</tbody>`;
    $("#tcount").textContent = t("rows_shown")(rows.length, a.rows.length);
  }
  $("#table").addEventListener("click", (e) => {
    const th = e.target.closest("th");
    if (th) { const i = +th.dataset.i; tSort = { col: i, dir: tSort.col === i ? -tSort.dir : 1 }; renderTable(); return; }
    const tr = e.target.closest("tr[data-id]");
    if (tr) go(`#map/${tr.dataset.id}`);
  });
  $("#tcsv").addEventListener("click", () => {
    const a = attributes[tClass];
    const q = (v) => (v === null ? "" : typeof v === "string" && /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    download(`CABra_${tClass}_attributes.csv`, [a.columns.map(q).join(","), a.units.map(q).join(","), ...a.rows.map((r) => r.map(q).join(","))].join("\n"));
  });

  // ------------------------------------------------------------------ rotas
  function go(hash) { if (location.hash === hash) route(); else location.hash = hash; }

  function route() {
    const [view, arg] = (location.hash.slice(1) || "map").split("/");
    const v = ["map", "attributes", "about"].includes(view) ? view : "map";
    document.querySelectorAll(".view").forEach((el) => { el.hidden = el.id !== `view-${v}`; });
    document.querySelectorAll(".barra-acoes > a[data-view]").forEach((a) => a.classList.toggle("active", a.dataset.view === v));
    if (v === "map") {
      setTimeout(() => map.invalidateSize(), 0);
      if (arg && byId.has(+arg)) {
        if (!selected || selected.id !== +arg) { select(+arg); if (window.innerWidth <= 960) window.scrollTo({ top: 0, behavior: "smooth" }); }
      } else if (selected) { clearSelection(); fitAll(); }
    } else window.scrollTo(0, 0);
    if (v === "attributes") {
      if (arg && CLASS_KEYS.includes(arg) && arg !== tClass) { tClass = arg; tSort = { col: 0, dir: 1 }; }
      renderClasses();
      renderTable();
    }
  }
  window.addEventListener("hashchange", route);

  function refreshAll() {
    drawPoints();
    renderFilters();
    renderClasses();
    renderTable();
    if (selected) { renderDetail(); if (series) drawChart(); }
    else $("#chart").innerHTML = `<div class="vazio">${t("chart_empty")}</div>`;
  }

  // ------------------------------------------------------------------ início
  applyLang();
  renderClasses();
  Promise.all([D.catchments(), D.attributes()]).then(([cs, at]) => {
    catchments = cs;
    byId = new Map(cs.map((c) => [c.id, c]));
    attributes = at;
    for (const k of Object.keys(at)) {
      const m = new Map();
      at[k].rows.forEach((r) => { const o = {}; at[k].columns.forEach((c, i) => { o[c] = r[i]; }); m.set(r[0], o); });
      attrIndex[k] = m;
    }
    renderFilters();
    drawPoints();
    if (!location.hash.startsWith("#map/")) fitAll();
    route();
  }).catch((err) => {
    $("#intro").insertAdjacentHTML("beforeend", `<p class="dica" style="color:#ff6b7a">Erro ao carregar dados: ${esc(err.message)}</p>`);
  });
})();
