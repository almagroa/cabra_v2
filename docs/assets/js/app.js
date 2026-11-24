(function () {
  "use strict";

  const I18N = window.CABRA_I18N;
  const D = window.CabraData;
  const $ = (s) => document.querySelector(s);

  // ------------------------------------------------------------------ idioma
  let lang = "pt";
  try { lang = localStorage.getItem("cabra-lang") || (navigator.language || "pt").slice(0, 2); } catch (e) { /* sem storage */ }
  if (!I18N[lang]) lang = "en";
  const t = (k) => (I18N[lang][k] !== undefined ? I18N[lang][k] : k);

  function applyLang() {
    document.documentElement.lang = lang === "pt" ? "pt-BR" : "en";
    document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
    document.querySelectorAll("[data-i18n-html]").forEach((el) => { el.innerHTML = t(el.dataset.i18nHtml); });
    document.querySelectorAll("[data-i18n-ph]").forEach((el) => { el.placeholder = t(el.dataset.i18nPh); });
    $("#lang").textContent = lang === "pt" ? "EN" : "PT";
  }
  $("#lang").addEventListener("click", () => {
    lang = lang === "pt" ? "en" : "pt";
    try { localStorage.setItem("cabra-lang", lang); } catch (e) { /* ok */ }
    applyLang();
    refreshAll();
  });

  // ------------------------------------------------------------------ formatos
  const nf = (v, d = 0) => (v === null || v === undefined || v === "" ? "–"
    : Number(v).toLocaleString(lang === "pt" ? "pt-BR" : "en-US", { maximumFractionDigits: d, minimumFractionDigits: 0 }));
  const biomeName = (b) => (t("biome")[b] || b);
  const hregName = (h) => h.replace(/([a-z])([A-Z])/g, "$1 $2");

  // ------------------------------------------------------------------ estado
  let catchments = [];
  let byId = new Map();
  let attributes = null;
  let selected = null;

  // ------------------------------------------------------------------ mapa
  const map = L.map("map", { zoomControl: false, preferCanvas: true, minZoom: 3 }).setView([-15, -54], 4);
  L.control.zoom({ position: "topleft" }).addTo(map);
  L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: "abcd", maxZoom: 18,
  }).addTo(map);
  const pointsLayer = L.layerGroup().addTo(map);
  let boundaryLayer = null;
  const markers = new Map();

  const BIOME_COLORS = {
    Amazon: "#1d7a3e", Atlanticforest: "#2b9e8f", Cerrado: "#d39b16",
    Caatinga: "#c4553b", Pampa: "#7d6bc2", Pantanal: "#2f7fe0",
  };
  const RAMP = ["#0b3a9e", "#2f6fc0", "#4fa6c9", "#9fd2b8", "#f3d77a", "#e48b3b"];
  const VARIABLES = {
    biome: { cat: true },
    aridity: { key: "aridity", d: 2 },
    prec: { key: "prec", d: 0 },
    qmean: { key: "qmean", d: 2 },
    area: { key: "area", d: 0 },
    hdi: { key: "hdi", d: 2 },
    forest: { get: (c) => c.cover.forest, d: 0 },
  };
  let colorBy = "biome";

  function rampColor(x) {
    const n = RAMP.length - 1;
    const i = Math.min(n - 1, Math.floor(x * n));
    const f = x * n - i;
    const a = hex(RAMP[i]), b = hex(RAMP[i + 1]);
    return `rgb(${a.map((v, k) => Math.round(v + (b[k] - v) * f)).join(",")})`;
  }
  function hex(h) { return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)); }

  function colorFn() {
    const v = VARIABLES[colorBy];
    if (v.cat) return { fn: (c) => BIOME_COLORS[c.biome] || "#888" };
    const get = v.get || ((c) => c[v.key]);
    const vals = catchments.map(get).filter((x) => x !== null && !isNaN(x)).sort((a, b) => a - b);
    // cor pelo percentil: legível mesmo com distribuições muito assimétricas (ex.: área)
    const rank = (x) => {
      let lo = 0, hi = vals.length - 1;
      while (lo < hi) { const m = (lo + hi) >> 1; if (vals[m] < x) lo = m + 1; else hi = m; }
      return lo / (vals.length - 1);
    };
    const q = (p) => vals[Math.round(p * (vals.length - 1))];
    return { fn: (c) => (get(c) === null ? "#999" : rampColor(rank(get(c)))), q, d: v.d };
  }

  function drawPoints() {
    const cf = colorFn();
    pointsLayer.clearLayers();
    markers.clear();
    catchments.forEach((c) => {
      const m = L.circleMarker([c.lat, c.lon], {
        radius: 5, weight: 1, color: "#fff", fillColor: cf.fn(c), fillOpacity: 0.9,
      });
      m.bindTooltip(`<b>${c.name}</b><br>CABra ${c.id} · ANA ${c.ana}`, { direction: "top", offset: [0, -4] });
      m.on("click", () => go(`#map/${c.id}`));
      m.addTo(pointsLayer);
      markers.set(c.id, m);
    });
    if (selected) highlight(selected.id);
    drawLegend(cf);
  }

  function fitAll() {
    const b = L.latLngBounds(catchments.map((c) => [c.lat, c.lon]));
    const wide = window.innerWidth > 820;
    map.fitBounds(b, wide ? { paddingTopLeft: [40, 40], paddingBottomRight: [Math.min(480, window.innerWidth * 0.45) + 20, 40] } : { padding: [16, 16] });
  }

  function drawLegend(cf) {
    const sel = $("#colorby");
    sel.innerHTML = Object.keys(VARIABLES).map((k) => `<option value="${k}" ${k === colorBy ? "selected" : ""}>${t("v_" + k)}</option>`).join("");
    const body = $("#legend-body");
    if (VARIABLES[colorBy].cat) {
      const counts = {};
      catchments.forEach((c) => { counts[c.biome] = (counts[c.biome] || 0) + 1; });
      body.innerHTML = Object.keys(BIOME_COLORS).map((b) =>
        `<div class="legend-item"><i style="background:${BIOME_COLORS[b]}"></i>${biomeName(b)} <span style="color:var(--muted);margin-left:auto">${counts[b] || 0}</span></div>`).join("");
    } else {
      body.innerHTML = `<div class="legend-ramp" style="background:linear-gradient(90deg,${RAMP.join(",")})"></div>
        <div class="legend-scale"><span>${nf(cf.q(0), cf.d)}</span><span>${nf(cf.q(0.5), cf.d)}</span><span>${nf(cf.q(1), cf.d)}</span></div>
        <div class="hint">${lang === "pt" ? "mín · mediana · máx" : "min · median · max"}</div>`;
    }
  }
  $("#colorby").addEventListener("change", (e) => { colorBy = e.target.value; drawPoints(); });

  function highlight(id) {
    markers.forEach((m, k) => m.setStyle(k === id ? { radius: 8, weight: 3, color: "#111" } : { radius: 5, weight: 1, color: "#fff" }));
    const m = markers.get(id);
    if (m) m.bringToFront();
  }

  // ------------------------------------------------------------------ busca
  const search = $("#search"), results = $("#search-results");
  let hits = [], hitIdx = 0;
  const norm = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  search.addEventListener("input", () => {
    const q = norm(search.value.trim());
    if (!q) { results.hidden = true; return; }
    hits = catchments.filter((c) => norm(c.name).includes(q) || String(c.ana).startsWith(q) || String(c.id) === q).slice(0, 12);
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
      `<li data-id="${c.id}" class="${i === hitIdx ? "on" : ""}">${c.name} <small>· ${c.state} · CABra ${c.id} · ANA ${c.ana}</small></li>`).join("");
  }
  results.addEventListener("mousedown", (e) => {
    const li = e.target.closest("li");
    if (li) pick(+li.dataset.id);
  });
  function pick(id) { results.hidden = true; search.value = ""; go(`#map/${id}`); }
  search.addEventListener("blur", () => setTimeout(() => { results.hidden = true; }, 150));

  // ------------------------------------------------------------------ detalhe
  let plots = [];
  let seriesToken = 0;

  async function select(id) {
    const c = byId.get(id);
    if (!c) return;
    selected = c;
    $("#intro").hidden = true;
    $("#detail").hidden = false;
    $("#side").scrollTop = 0;
    renderDetail();
    highlight(id);

    const geom = await D.boundary(id);
    if (selected !== c) return;
    if (boundaryLayer) map.removeLayer(boundaryLayer);
    boundaryLayer = L.geoJSON(geom, { style: { color: "#0b3a9e", weight: 2, fillColor: "#4fa6c9", fillOpacity: 0.18 }, interactive: false }).addTo(map);
    const pad = window.innerWidth > 820 ? { paddingTopLeft: [40, 40], paddingBottomRight: [Math.min(480, window.innerWidth * 0.45) + 40, 40] } : { padding: [20, 20] };
    map.fitBounds(boundaryLayer.getBounds(), { ...pad, maxZoom: 9 });
    loadSeries(c);
  }

  function renderDetail() {
    const c = selected;
    if (!c) return;
    $("#d-eyebrow").textContent = `CABra ${c.id} · ${c.state}`;
    $("#d-name").textContent = c.name;
    const facts = [
      ["f_ana", c.ana], ["f_biome", biomeName(c.biome)],
      ["f_hreg", hregName(c.hreg)], ["f_area", `${nf(c.area)} km²`],
      ["f_elev", `${nf(c.elev)} m`], ["f_prec", `${nf(c.prec)} mm`],
      ["f_qmean", `${nf(c.qmean, 2)} mm/${lang === "pt" ? "dia" : "day"}`], ["f_aridity", nf(c.aridity, 2)],
      ["f_hdi", nf(c.hdi, 2)], ["f_missing", `${nf(c.missing, 1)} %`],
    ];
    $("#d-facts").innerHTML = facts.map(([k, v]) => `<div><dt>${t(k)}</dt><dd>${v}</dd></div>`).join("");
    const coverColors = { forest: "#1d7a3e", grass: "#9cc65a", shrub: "#c9b458", crops: "#e8a33d", urban: "#8a8f98", waterp: "#2f7fe0", bare: "#c9a27e" };
    $("#d-cover").innerHTML = Object.entries(c.cover).filter(([, v]) => v !== null)
      .sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([k, v]) => bar(t("c_" + k), v, coverColors[k])).join("");
    const soilColors = { sand: "#e6b77e", silt: "#b98b5e", clay: "#8a5a3b" };
    $("#d-soil").innerHTML = Object.entries(c.soil).map(([k, v]) => bar(t("s_" + k), v, soilColors[k])).join("");
    $("#d-attr").href = `#attributes`;
  }
  const bar = (label, v, color) =>
    `<div class="bar"><span>${label}</span><div class="track"><div class="fill" style="width:${Math.max(0, Math.min(100, v))}%;background:${color}"></div></div><span class="val">${nf(v, 0)}</span></div>`;

  async function loadSeries(c) {
    const token = ++seriesToken;
    plots.forEach((p) => p.destroy());
    plots = [];
    ["#chart-p", "#chart-q"].forEach((s) => { const el = $(s); el.innerHTML = ""; el.classList.add("loading"); el.dataset.loading = t("loading"); });
    const s = await D.series(c.id);
    if (token !== seriesToken) return;
    ["#chart-p", "#chart-q"].forEach((sel) => $(sel).classList.remove("loading"));
    plots = [
      timePlot($("#chart-p"), s.p, "#2f7fe0", true),
      timePlot($("#chart-q"), s.q, "#0b3a9e", false),
    ];
  }

  // mesmo eixo de tempo nos dois gráficos (período completo da v1)
  const X_RANGE = [Date.parse("1980-01-01T00:00:00Z") / 1000, Date.parse("2010-12-31T00:00:00Z") / 1000];

  function dayStamps(start, n) {
    const t0 = Date.parse(start + "T00:00:00Z") / 1000;
    const xs = new Float64Array(n);
    for (let i = 0; i < n; i++) xs[i] = t0 + i * 86400;
    return xs;
  }

  function timePlot(el, s, color, bars) {
    const xs = dayStamps(s.start, s.values.length);
    const w = el.clientWidth || 400;
    const opts = {
      width: w, height: 150, tzDate: (ts) => uPlot.tzDate(new Date(ts * 1e3), "Etc/UTC"),
      legend: { show: false },
      cursor: { drag: { x: true, y: false }, points: { show: false }, sync: { key: "cabra" } },
      scales: { x: { time: true, range: (u, mn, mx) => [mn, mx] }, y: { range: (u, mn, mx) => [0, mx * 1.05 || 1] } },
      axes: [
        { stroke: "#5b6776", grid: { stroke: "#eef1f5" }, ticks: { stroke: "#e3e7ee" }, font: "11px system-ui" },
        { stroke: "#5b6776", grid: { stroke: "#eef1f5" }, ticks: { stroke: "#e3e7ee" }, font: "11px system-ui", size: 48 },
      ],
      series: [
        { label: lang === "pt" ? "Data" : "Date", value: "{YYYY}-{MM}-{DD}" },
        {
          label: s.unit, stroke: color, width: 1, fill: bars ? color : color + "22",
          paths: bars ? uPlot.paths.bars({ size: [1, 2], gap: 0 }) : undefined,
          value: (u, v) => (v === null ? "–" : nf(v, 2)),
        },
      ],
    };
    opts.hooks = {
      setSelect: [(u) => {
        if (u.select.width < 4) return;
        const min = u.posToVal(u.select.left, "x"), max = u.posToVal(u.select.left + u.select.width, "x");
        plots.forEach((p) => { p.batch(() => { p.setScale("x", { min, max }); p.setSelect({ width: 0, height: 0 }, false); }); });
      }],
    };
    opts.cursor.drag.setScale = false;
    const u = new uPlot(opts, [xs, s.values], el);
    u.setScale("x", { min: X_RANGE[0], max: X_RANGE[1] });
    u.over.addEventListener("dblclick", () => plots.forEach((p) => p.setScale("x", { min: X_RANGE[0], max: X_RANGE[1] })));
    u._el = el;
    return u;
  }

  window.addEventListener("resize", () => {
    plots.forEach((p) => p.setSize({ width: p._el.clientWidth, height: 150 }));
  });

  $("#d-close").addEventListener("click", () => go("#map"));

  function clearSelection() {
    selected = null;
    seriesToken++;
    plots.forEach((p) => p.destroy());
    plots = [];
    if (boundaryLayer) { map.removeLayer(boundaryLayer); boundaryLayer = null; }
    $("#detail").hidden = true;
    $("#intro").hidden = false;
    markers.forEach((m) => m.setStyle({ radius: 5, weight: 1, color: "#fff" }));
  }

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
    const lines = [`date,precipitation_mm,streamflow_m3s`];
    [...rows.keys()].sort().forEach((d) => {
      const r = rows.get(d);
      lines.push(`${d},${r.p ?? ""},${r.q ?? ""}`);
    });
    download(`CABra_${c.id}_series.csv`, `# CABra ${c.id} - ${c.name} (ANA ${c.ana})\n# CABra v1, https://doi.org/10.5281/zenodo.4070146\n` + lines.join("\n"));
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
    $("#classes").innerHTML = CLASS_KEYS.map((k) => `<button type="button" data-k="${k}" class="${k === tClass ? "on" : ""}">${t("cls_" + k)}</button>`).join("");
    $("#about-classes").innerHTML = CLASS_KEYS.map((k) => `<li>${t("cls_" + k)}</li>`).join("");
  }
  $("#classes").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    go(`#attributes/${b.dataset.k}`);
  });
  $("#tfilter").addEventListener("input", (e) => { tFilter = norm(e.target.value.trim()); renderTable(); });

  function renderTable() {
    if (!attributes) return;
    const a = attributes[tClass];
    let rows = a.rows;
    if (tFilter) rows = rows.filter((r) => r.some((v) => v !== null && norm(String(v)).includes(tFilter)));
    const { col, dir } = tSort;
    rows = [...rows].sort((x, y) => {
      const a1 = x[col], b1 = y[col];
      if (a1 === null) return 1;
      if (b1 === null) return -1;
      return (typeof a1 === "number" && typeof b1 === "number" ? a1 - b1 : String(a1).localeCompare(String(b1))) * dir;
    });
    const head = a.columns.map((c, i) =>
      `<th data-i="${i}" class="${i === col ? "sorted" : ""}">${c}${i === col ? (dir > 0 ? " ↑" : " ↓") : ""}<small>${a.units[i] || "&nbsp;"}</small></th>`).join("");
    const body = rows.map((r) =>
      `<tr data-id="${r[0]}">${r.map((v) => `<td class="${typeof v === "string" ? "txt" : ""}">${v === null ? "–" : (typeof v === "number" ? v : esc(v))}</td>`).join("")}</tr>`).join("");
    $("#table").innerHTML = `<thead><tr>${head}</tr></thead><tbody>${body}</tbody>`;
    $("#tcount").textContent = t("rows_shown")(rows.length, a.rows.length);
  }
  const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
  $("#table").addEventListener("click", (e) => {
    const th = e.target.closest("th");
    if (th) {
      const i = +th.dataset.i;
      tSort = { col: i, dir: tSort.col === i ? -tSort.dir : 1 };
      renderTable();
      return;
    }
    const tr = e.target.closest("tr[data-id]");
    if (tr) go(`#map/${tr.dataset.id}`);
  });
  $("#tcsv").addEventListener("click", () => {
    const a = attributes[tClass];
    const q = (v) => (v === null ? "" : typeof v === "string" && /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const lines = [a.columns.map(q).join(","), a.units.map(q).join(","), ...a.rows.map((r) => r.map(q).join(","))];
    download(`CABra_${tClass}_attributes.csv`, lines.join("\n"));
  });

  // ------------------------------------------------------------------ rotas
  function go(hash) { if (location.hash === hash) route(); else location.hash = hash; }

  function route() {
    const [view, arg] = (location.hash.slice(1) || "map").split("/");
    const v = ["map", "attributes", "about"].includes(view) ? view : "map";
    document.querySelectorAll(".view").forEach((el) => { el.hidden = el.id !== `view-${v}`; });
    document.querySelectorAll(".tabs a").forEach((a) => a.classList.toggle("active", a.dataset.view === v));
    if (v === "map") {
      map.invalidateSize();
      if (arg && byId.has(+arg)) { if (!selected || selected.id !== +arg) select(+arg); }
      else if (selected) { clearSelection(); fitAll(); }
    }
    if (v === "attributes") {
      if (arg && CLASS_KEYS.includes(arg) && arg !== tClass) { tClass = arg; tSort = { col: 0, dir: 1 }; }
      renderClasses();
      renderTable();
    }
  }
  window.addEventListener("hashchange", route);

  function renderStats() {
    const nAttr = attributes ? CLASS_KEYS.reduce((s, k) => s + attributes[k].columns.length - 2, 0) : 100;
    $("#stats").innerHTML = [
      [catchments.length, t("st_catch")], [30, t("st_years")], [9, t("st_classes")], [nAttr, t("st_attr")],
    ].map(([n, l]) => `<div class="stat"><b>${nf(n)}</b><span>${l}</span></div>`).join("");
  }

  function refreshAll() {
    drawPoints();
    renderStats();
    renderClasses();
    renderTable();
    if (selected) { renderDetail(); loadSeries(selected); }
  }

  // ------------------------------------------------------------------ início
  applyLang();
  renderClasses();
  Promise.all([D.catchments(), D.attributes()]).then(([cs, at]) => {
    catchments = cs;
    byId = new Map(cs.map((c) => [c.id, c]));
    attributes = at;
    drawPoints();
    renderStats();
    if (!location.hash.startsWith("#map/")) fitAll();
    route();
  }).catch((err) => {
    $("#intro").innerHTML += `<p style="color:#b00">Erro ao carregar dados: ${esc(err.message)}</p>`;
  });
})();
