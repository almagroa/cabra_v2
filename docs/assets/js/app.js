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
  const biomeName = (b) => (t("biome")[b] || b);
  const hregName = (h) => h.replace(/([a-z])([A-Z])/g, "$1 $2");
  const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));

  // ------------------------------------------------------------------ estado
  let catchments = [];
  let byId = new Map();
  let attributes = null;
  let selected = null;

  // ------------------------------------------------------------------ mapa
  const map = L.map("map", { zoomControl: false, preferCanvas: true, minZoom: 3 }).setView([-15, -52], 4);
  L.control.zoom({ position: "topright" }).addTo(map);
  L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: "abcd", maxZoom: 18, opacity: 0.9,
  }).addTo(map);
  const canvas = L.canvas({ padding: 0.3 });
  const outlineLayer = L.layerGroup().addTo(map);
  const pointsLayer = L.layerGroup().addTo(map);
  let boundaryLayer = null;
  const markers = new Map();

  // paletas pensadas para fundo escuro
  const BIOME_COLORS = {
    Amazon: "#4fae6f", Atlanticforest: "#69c3e0", Cerrado: "#d8b470",
    Caatinga: "#c8643f", Pampa: "#a99be0", Pantanal: "#e7e3da",
  };
  const RAMPS = {
    wet: ["#c8643f", "#d8b470", "#e7e3da", "#8fd0e4", "#3b8fc4"],
    dry: ["#3b8fc4", "#8fd0e4", "#e7e3da", "#d8b470", "#c8643f"],
    seq: ["#2a3b4a", "#3b6f8f", "#69c3e0", "#c5ecf6"],
    hot: ["#2a3b4a", "#7a5a3a", "#d8b470", "#f3e1b5"],
    green: ["#2a3b4a", "#2f6b4a", "#4fae6f", "#b9e3a8"],
  };
  const VARIABLES = {
    aridity: { key: "aridity", d: 2, ramp: "dry" },
    prec: { key: "prec", d: 0, ramp: "wet", unit: "u_prec" },
    qmean: { key: "qmean", d: 2, ramp: "seq", unit: "u_qmean" },
    area: { key: "area", d: 0, ramp: "seq", unit: "u_area" },
    hdi: { key: "hdi", d: 2, ramp: "hot" },
    forest: { get: (c) => c.cover.forest, d: 0, ramp: "green", unit: "u_forest" },
    biome: { cat: true },
  };
  let colorBy = "aridity";

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
    if (v.cat) return { cat: true, fn: (c) => BIOME_COLORS[c.biome] || "#888" };
    const get = v.get || ((c) => c[v.key]);
    const ramp = RAMPS[v.ramp];
    const vals = catchments.map(get).filter((x) => x !== null && !isNaN(x)).sort((a, b) => a - b);
    // cor pelo percentil: legível mesmo com distribuições muito assimétricas (ex.: área)
    const rank = (x) => {
      let lo = 0, hi = vals.length - 1;
      while (lo < hi) { const m = (lo + hi) >> 1; if (vals[m] < x) lo = m + 1; else hi = m; }
      return lo / (vals.length - 1);
    };
    const q = (p) => vals[Math.round(p * (vals.length - 1))];
    return { fn: (c) => (get(c) === null ? "#555" : rampColor(ramp, rank(get(c)))), q, d: v.d, ramp, unit: v.unit };
  }

  function drawPoints() {
    const cf = colorFn();
    pointsLayer.clearLayers();
    markers.clear();
    catchments.forEach((c) => {
      const m = L.circleMarker([c.lat, c.lon], {
        renderer: canvas, radius: 4, weight: 1, color: "#0e1114", fillColor: cf.fn(c), fillOpacity: 1,
      });
      m.bindTooltip(`<b>${esc(c.name)}</b> <span>${c.state} · ${c.id}</span>`, { direction: "top", offset: [0, -5] });
      m.on("click", () => go(`#map/${c.id}`));
      m.addTo(pointsLayer);
      markers.set(c.id, m);
    });
    if (selected) highlight(selected.id);
    drawLegend(cf);
  }

  function drawLegend(cf) {
    $("#colorby").innerHTML = Object.keys(VARIABLES).map((k) =>
      `<button type="button" role="radio" aria-checked="${k === colorBy}" data-k="${k}" class="${k === colorBy ? "on" : ""}">${t("v_" + k)}</button>`).join("");
    const body = $("#legend-body");
    if (cf.cat) {
      body.innerHTML = `<div class="cats">${Object.keys(BIOME_COLORS).map((b) => `<span style="--c:${BIOME_COLORS[b]}">${biomeName(b)}</span>`).join("")}</div>`;
    } else {
      const u = cf.unit ? ` ${t(cf.unit)}` : "";
      body.innerHTML = `<div class="ramp" style="background:linear-gradient(90deg,${cf.ramp.join(",")})"></div>
        <div class="scale"><span>${nf(cf.q(0), cf.d)}</span><span>${nf(cf.q(0.5), cf.d)}</span><span>${nf(cf.q(1), cf.d)}${u}</span></div>`;
    }
  }
  $("#colorby").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    colorBy = b.dataset.k;
    drawPoints();
  });

  function highlight(id) {
    markers.forEach((m, k) => m.setStyle(k === id ? { radius: 7, weight: 2, color: "#ece7dc" } : { radius: 4, weight: 1, color: "#0e1114" }));
    const m = markers.get(id);
    if (m) m.bringToFront();
  }

  function fitAll() {
    if (!catchments.length) return;
    map.fitBounds(L.latLngBounds(catchments.map((c) => [c.lat, c.lon])), { padding: [30, 30] });
  }

  // contornos de todas as bacias como fundo (o próprio banco desenha o mapa)
  D.outlines().then((fc) => {
    const layer = L.geoJSON(fc, {
      renderer: canvas, interactive: false,
      style: { color: "#ece7dc", weight: 0.5, opacity: 0.22, fillColor: "#69c3e0", fillOpacity: 0.025 },
    }).addTo(outlineLayer);
    // os contornos de fundo são bem simplificados: somem aos poucos com o zoom
    const fade = () => { const z = map.getZoom(); layer.setStyle({ opacity: z >= 8 ? 0.06 : z >= 6 ? 0.14 : 0.22 }); };
    map.on("zoomend", fade);
    fade();
  }).catch(() => { /* opcional */ });

  // ------------------------------------------------------------------ busca
  const search = $("#search"), results = $("#search-results");
  let hits = [], hitIdx = 0;
  const norm = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
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
      `<li data-id="${c.id}" class="${i === hitIdx ? "on" : ""}"><span>${esc(c.name)}</span><small>${c.state} · ${c.ana}</small></li>`).join("");
  }
  results.addEventListener("mousedown", (e) => {
    const li = e.target.closest("li");
    if (li) pick(+li.dataset.id);
  });
  function pick(id) { results.hidden = true; search.value = ""; search.blur(); go(`#map/${id}`); }
  search.addEventListener("blur", () => setTimeout(() => { results.hidden = true; }, 150));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && selected && document.activeElement !== search) go("#map");
    if (e.key === "/" && document.activeElement.tagName !== "INPUT") { e.preventDefault(); search.focus(); }
  });

  // ------------------------------------------------------------------ detalhe
  let plots = [];
  let seriesToken = 0;

  async function select(id) {
    const c = byId.get(id);
    if (!c) return;
    selected = c;
    $("#intro").hidden = true;
    $("#detail").hidden = false;
    $("#panel").scrollTop = 0;
    $("#view-map").scrollTop = 0;
    renderDetail();
    highlight(id);

    const geom = await D.boundary(id);
    if (selected !== c) return;
    if (boundaryLayer) map.removeLayer(boundaryLayer);
    boundaryLayer = L.geoJSON(geom, {
      style: { color: "#ece7dc", weight: 1.5, fillColor: "#69c3e0", fillOpacity: 0.14 }, interactive: false,
    }).addTo(map);
    map.flyToBounds(boundaryLayer.getBounds(), { padding: [40, 40], maxZoom: 9, duration: 0.6 });
    loadSeries(c);
  }

  const COVER_COLORS = { forest: "#4fae6f", grass: "#b9d77a", shrub: "#8a9a5b", crops: "#d8b470", urban: "#9aa1a8", waterp: "#69c3e0", bare: "#c8643f", other: "#3a4148" };
  const SOIL_COLORS = { sand: "#e4c88f", silt: "#b08a5c", clay: "#7a4e33" };

  function stack(parts, colors, label) {
    const bar = parts.map(([k, v]) => `<i style="width:${v}%;background:${colors[k]}" title="${label(k)} ${nf(v, 0)}%"></i>`).join("");
    const li = parts.filter(([, v]) => v >= 0.5).map(([k, v]) => `<li style="--c:${colors[k]}">${label(k)}<b>${nf(v, 0)}%</b></li>`).join("");
    return `<div class="bar">${bar}</div><ul>${li}</ul>`;
  }

  function renderDetail() {
    const c = selected;
    if (!c) return;
    $("#d-kicker").textContent = `CABra ${String(c.id).padStart(3, "0")} · ${c.state} · ${biomeName(c.biome)}`;
    $("#d-name").textContent = c.name;
    $("#d-sub").textContent = `${hregName(c.hreg)} · ${nf(c.lat, 3)}°, ${nf(c.lon, 3)}°`;
    const facts = [
      ["f_ana", c.ana, ""], ["f_area", nf(c.area), "km²"],
      ["f_prec", nf(c.prec), t("u_prec")], ["f_qmean", nf(c.qmean, 2), t("u_qmean")],
      ["f_aridity", nf(c.aridity, 2), ""], ["f_elev", nf(c.elev), "m"],
      ["f_hdi", nf(c.hdi, 2), ""], ["f_missing", nf(c.missing, 1), "%"],
    ];
    $("#d-facts").innerHTML = facts.map(([k, v, u]) => `<div><dt>${t(k)}</dt><dd>${v}${u ? `<small>${u}</small>` : ""}</dd></div>`).join("");

    const cov = Object.entries(c.cover).filter(([, v]) => v !== null).sort((a, b) => b[1] - a[1]);
    const rest = Math.max(0, 100 - cov.reduce((s, [, v]) => s + v, 0));
    if (rest >= 0.5) cov.push(["other", rest]);
    $("#d-cover").innerHTML = stack(cov, COVER_COLORS, (k) => t("c_" + k));
    const tot = (c.soil.sand || 0) + (c.soil.silt || 0) + (c.soil.clay || 0) || 1;
    $("#d-soil").innerHTML = stack(["sand", "silt", "clay"].map((k) => [k, (c.soil[k] || 0) * 100 / tot]), SOIL_COLORS, (k) => t("s_" + k));
  }

  // mesmo eixo de tempo nos dois gráficos (período completo da v1)
  const X_RANGE = [Date.parse("1980-01-01T00:00:00Z") / 1000, Date.parse("2010-12-31T00:00:00Z") / 1000];

  async function loadSeries(c) {
    const token = ++seriesToken;
    plots.forEach((p) => p.destroy());
    plots = [];
    ["#chart-p", "#chart-q"].forEach((s) => { const el = $(s); el.classList.add("loading"); el.textContent = t("loading"); });
    const s = await D.series(c.id);
    if (token !== seriesToken) return;
    ["#chart-p", "#chart-q"].forEach((sel) => { const el = $(sel); el.classList.remove("loading"); el.textContent = ""; });
    plots = [
      timePlot($("#chart-p"), s.p, { color: "#69c3e0", bars: true, height: 92, invert: true, xAxis: false }),
      timePlot($("#chart-q"), s.q, { color: "#ece7dc", bars: false, height: 132, invert: false, xAxis: true }),
    ];
  }

  function timePlot(el, s, o) {
    const n = s.values.length;
    const t0 = Date.parse(s.start + "T00:00:00Z") / 1000;
    const xs = new Float64Array(n);
    for (let i = 0; i < n; i++) xs[i] = t0 + i * 86400;
    const axis = { stroke: "#8d949b", grid: { stroke: "#20262c", width: 1 }, ticks: { show: false }, font: "10.5px 'Plex Mono', monospace", gap: 4 };
    const opts = {
      width: el.clientWidth || 380, height: o.height, padding: [8, 4, 0, 0],
      tzDate: (ts) => uPlot.tzDate(new Date(ts * 1e3), "Etc/UTC"),
      legend: { show: false },
      cursor: { drag: { x: true, y: false, setScale: false }, points: { show: false }, sync: { key: "cabra" }, y: false },
      scales: { x: { time: true, range: (u, mn, mx) => [mn, mx] }, y: { dir: o.invert ? -1 : 1, range: (u, mn, mx) => [0, (mx || 1) * 1.05] } },
      axes: [
        Object.assign({}, axis, { show: o.xAxis, size: 26 }),
        Object.assign({}, axis, { size: 44, values: (u, vs) => vs.map((v) => nf(v, 0)) }),
      ],
      series: [
        {},
        {
          stroke: o.color, width: o.bars ? 0 : 1, fill: o.bars ? o.color + "aa" : "rgba(236,231,220,.06)",
          paths: o.bars ? uPlot.paths.bars({ size: [1, 3], gap: 0 }) : undefined,
        },
      ],
      hooks: {
        setSelect: [(u) => {
          if (u.select.width < 4) return;
          const min = u.posToVal(u.select.left, "x"), max = u.posToVal(u.select.left + u.select.width, "x");
          plots.forEach((p) => p.batch(() => { p.setScale("x", { min, max }); p.setSelect({ width: 0, height: 0 }, false); }));
        }],
      },
    };
    const u = new uPlot(opts, [xs, s.values], el);
    u.setScale("x", { min: X_RANGE[0], max: X_RANGE[1] });
    u.over.addEventListener("dblclick", () => plots.forEach((p) => p.setScale("x", { min: X_RANGE[0], max: X_RANGE[1] })));
    u._el = el;
    u._h = o.height;
    return u;
  }

  window.addEventListener("resize", () => plots.forEach((p) => p.setSize({ width: p._el.clientWidth, height: p._h })));
  $("#d-close").addEventListener("click", () => go("#map"));

  function clearSelection() {
    selected = null;
    seriesToken++;
    plots.forEach((p) => p.destroy());
    plots = [];
    if (boundaryLayer) { map.removeLayer(boundaryLayer); boundaryLayer = null; }
    $("#detail").hidden = true;
    $("#intro").hidden = false;
    highlight(-1);
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
    const lines = ["date,precipitation_mm,streamflow_m3s"];
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
    $("#classes").innerHTML = CLASS_KEYS.map((k) => `<button type="button" role="tab" data-k="${k}" class="${k === tClass ? "on" : ""}">${t("cls_" + k)}</button>`).join("");
  }
  $("#classes").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (b) go(`#attributes/${b.dataset.k}`);
  });
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
    const head = a.columns.map((c, i) =>
      `<th data-i="${i}" class="${i === col ? "sorted" : ""}">${esc(c)}${i === col ? (dir > 0 ? " ↑" : " ↓") : ""}<small>${a.units[i] ? esc(a.units[i]) : "&nbsp;"}</small></th>`).join("");
    const body = rows.map((r) =>
      `<tr data-id="${r[0]}">${r.map((v) => `<td class="${typeof v === "string" ? "txt" : ""}">${v === null ? "–" : esc(v)}</td>`).join("")}</tr>`).join("");
    $("#table").innerHTML = `<thead><tr>${head}</tr></thead><tbody>${body}</tbody>`;
    $("#tcount").textContent = t("rows_shown")(rows.length, a.rows.length);
  }
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
    document.querySelectorAll(".nav a").forEach((a) => a.classList.toggle("active", a.dataset.view === v));
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

  function refreshAll() {
    drawPoints();
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
    if (!location.hash.startsWith("#map/")) fitAll();
    route();
  }).catch((err) => {
    $("#intro").insertAdjacentHTML("beforeend", `<p style="color:#c8643f">Erro ao carregar dados: ${esc(err.message)}</p>`);
  });
})();
