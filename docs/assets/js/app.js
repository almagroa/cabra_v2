(function () {
  "use strict";

  const I18N = window.CABRA_I18N;
  const D = window.CabraData;
  const $ = (s) => document.querySelector(s);
  const root = document.documentElement;

  // ------------------------------------------------------------------ idioma e tema
  let lang = "pt";
  try { lang = localStorage.getItem("cabra-lang") || ((navigator.language || "pt").startsWith("pt") ? "pt" : "en"); } catch (e) { /* sem storage */ }
  if (!I18N[lang]) lang = "en";
  const t = (k) => (I18N[lang][k] !== undefined ? I18N[lang][k] : k);

  const SUN = '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="3" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.4 1.4M11.6 11.6 13 13M3 13l1.4-1.4M11.6 4.4 13 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
  const MOON = '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M13.5 9.5A5.5 5.5 0 0 1 6.5 2.5a5.5 5.5 0 1 0 7 7z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>';
  const isDark = () => root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  const css = (v) => getComputedStyle(root).getPropertyValue(v).trim();

  function applyLang() {
    root.lang = lang === "pt" ? "pt-BR" : "en";
    document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
    document.querySelectorAll("[data-i18n-html]").forEach((el) => { el.innerHTML = t(el.dataset.i18nHtml); });
    document.querySelectorAll("[data-i18n-ph]").forEach((el) => { el.placeholder = t(el.dataset.i18nPh); });
    document.querySelectorAll(".lang button").forEach((b) => b.classList.toggle("on", b.dataset.lang === lang));
    applyThemeBtn();
  }
  function applyThemeBtn() {
    const b = $("#theme-t");
    b.innerHTML = isDark() ? SUN : MOON;
    b.title = b.ariaLabel = t(isDark() ? "theme_light" : "theme_dark");
  }
  document.querySelectorAll(".lang button").forEach((b) => b.addEventListener("click", () => {
    if (b.dataset.lang === lang) return;
    lang = b.dataset.lang;
    try { localStorage.setItem("cabra-lang", lang); } catch (e) { /* ok */ }
    applyLang();
    refreshAll();
  }));
  $("#theme-t").addEventListener("click", () => {
    root.dataset.theme = isDark() ? "light" : "dark";
    try { localStorage.setItem("cabra-theme", root.dataset.theme); } catch (e) { /* ok */ }
    applyThemeBtn();
    setBase();
    drawPoints();
    if (selected && series) drawChart();
  });
  $("#menu-btn").addEventListener("click", () => {
    const s = $("#side");
    s.classList.toggle("open");
    $("#menu-btn").setAttribute("aria-expanded", s.classList.contains("open"));
  });

  // ------------------------------------------------------------------ formatos
  const loc = () => (lang === "pt" ? "pt-BR" : "en-US");
  const nf = (v, d = 0) => (v === null || v === undefined || v === "" || Number.isNaN(+v) ? "–"
    : Number(v).toLocaleString(loc(), { maximumFractionDigits: d, minimumFractionDigits: d }));
  const autoD = (v) => (Math.abs(v) >= 100 ? 0 : Math.abs(v) >= 10 ? 1 : 2);
  const biomeName = (b) => (t("biome")[b] || b);
  const hregName = (h) => h.replace(/([a-z])([A-Z])/g, "$1 $2");
  const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
  const fmtDate = (s) => { const [y, m, d] = s.split("-"); return lang === "pt" ? `${d}/${m}/${y}` : s; };
  const norm = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const inkOn = (hex) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)); return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? "#0F1B2D" : "#fff"; };

  // ------------------------------------------------------------------ estado
  let catchments = [], byId = new Map(), attributes = null, attrIndex = {};
  let selected = null, stateF = "", areaSel = null, areaLayer = null;

  // ------------------------------------------------------------------ mapa
  const map = L.map("leaflet-map", { zoomControl: true, preferCanvas: true, minZoom: 3, attributionControl: true }).setView([-15, -52], 4);
  let base = null;
  function setBase() {
    if (base) map.removeLayer(base);
    base = L.tileLayer(`https://{s}.basemaps.cartocdn.com/${isDark() ? "dark_all" : "light_all"}/{z}/{x}/{y}{r}.png`, {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: "abcd", maxZoom: 18,
    }).addTo(map);
    base.bringToBack();
    if (outlines) outlines.setStyle(outlineStyle());
  }
  const canvas = L.canvas({ padding: 0.3 });
  // contorno da bacia selecionada num painel abaixo dos pontos e sem eventos,
  // para não cobrir o canvas dos pontos (senão os cliques no mapa param de funcionar)
  map.createPane("basin");
  map.getPane("basin").style.zIndex = 390;
  map.getPane("basin").style.pointerEvents = "none";
  const basinRenderer = L.canvas({ padding: 0.3, pane: "basin" });
  const pointsLayer = L.layerGroup().addTo(map);
  let outlines = null, boundaryLayer = null;
  const markers = new Map();
  const outlineStyle = () => ({ color: isDark() ? "#4C8DF6" : "#0A5CE0", weight: 0.5, opacity: isDark() ? 0.3 : 0.22, fillOpacity: 0 });
  setBase();

  // cores no padrão HidroNexus (status vai de laranja-seco a azul-úmido)
  const BIOME_COLORS = { Amazon: "#1F9E6E", Atlanticforest: "#0A5CE0", Cerrado: "#E08A1E", Caatinga: "#B4531A", Pampa: "#7B4FD6", Pantanal: "#13A5C4" };
  const DIV = ["#B4531A", "#D99A2B", "#8E9AAB", "#2F86E0", "#0B3F8F"];        // seco -> úmido
  const SEQ = ["#C9DCF5", "#7FB0EE", "#2F86E0", "#0A5CE0", "#003A8C"];
  const VARIABLES = {
    biome: { cat: true },
    aridity: { key: "aridity", d: 2, ramp: [...DIV].reverse() },
    prec: { key: "prec", d: 0, ramp: DIV },
    qmean: { key: "qmean", d: 2, ramp: SEQ },
    hdi: { key: "hdi", d: 2, ramp: ["#C9DCF5", "#D99A2B", "#B4531A", "#7a2d0c", "#4a1a06"] },
  };
  let colorBy = "biome";

  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  function rampColor(ramp, x) {
    const n = ramp.length - 1, i = Math.min(n - 1, Math.floor(x * n)), f = x * n - i;
    const a = hex(ramp[i]), b = hex(ramp[i + 1]);
    return "#" + a.map((v, k) => Math.round(v + (b[k] - v) * f).toString(16).padStart(2, "0")).join("");
  }
  function colorFn() {
    const v = VARIABLES[colorBy];
    if (v.cat) return { cat: true, fn: (c) => BIOME_COLORS[c.biome] || "#8E9AAB" };
    const get = (c) => c[v.key];
    const vals = catchments.map(get).filter((x) => x !== null && !isNaN(x)).sort((a, b) => a - b);
    const rank = (x) => { let lo = 0, hi = vals.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (vals[m] < x) lo = m + 1; else hi = m; } return lo / (vals.length - 1); };
    const q = (p) => vals[Math.round(p * (vals.length - 1))];
    return { fn: (c) => (get(c) === null ? "#8E9AAB" : rampColor(v.ramp, rank(get(c)))), q, d: v.d, ramp: v.ramp };
  }
  const visible = (c) => (!stateF || c.state === stateF) && (!areaSel || areaSel.has(c.id));

  function drawPoints() {
    const cf = colorFn();
    pointsLayer.clearLayers();
    markers.clear();
    const ring = isDark() ? "#0B1220" : "#ffffff";
    catchments.filter(visible).forEach((c) => {
      const col = cf.fn(c);
      const m = L.circleMarker([c.lat, c.lon], { renderer: canvas, radius: 5, weight: 1, color: ring, fillColor: col, fillOpacity: 0.95 });
      m._fill = col;
      m.bindTooltip(`<b>${esc(c.name)}</b><br>${c.state} · ANA ${c.ana} · CABra ${c.id}<br>${t("m_area")}: ${nf(c.area)} km²<br><span>${t("map_hint")}</span>`, { direction: "top", offset: [0, -6] });
      m.on("click", () => go(`#map/${c.id}`));
      m.addTo(pointsLayer);
      markers.set(c.id, m);
    });
    if (selected) highlight(selected.id);
    $("#colorby").innerHTML = Object.keys(VARIABLES).map((k) => `<button type="button" data-k="${k}" aria-pressed="${k === colorBy}">${t("v_" + k)}</button>`).join("");
    const lg = $("#legend");
    if (cf.cat) {
      const counts = {};
      catchments.filter(visible).forEach((c) => { counts[c.biome] = (counts[c.biome] || 0) + 1; });
      lg.innerHTML = Object.keys(BIOME_COLORS).map((b) => `<span><i style="background:${BIOME_COLORS[b]}"></i>${biomeName(b)} (${counts[b] || 0})</span>`).join("");
    } else {
      lg.innerHTML = `<span class="num">${nf(cf.q(0), cf.d)}</span><span class="ramp" style="background:linear-gradient(90deg,${cf.ramp.join(",")})"></span><span class="num">${nf(cf.q(1), cf.d)}</span><span>· ${t("v_" + colorBy)} (${lang === "pt" ? "mediana" : "median"} ${nf(cf.q(0.5), cf.d)})</span>`;
    }
  }
  $("#colorby").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { colorBy = b.dataset.k; drawPoints(); } });

  function highlight(id) {
    const ring = isDark() ? "#0B1220" : "#ffffff";
    markers.forEach((m, k) => {
      if (k === id) m.setStyle({ radius: 8, weight: 2.5, color: ring, fillColor: css("--sel"), fillOpacity: 1 });
      else m.setStyle({ radius: 5, weight: 1, color: ring, fillColor: m._fill, fillOpacity: 0.95 });
    });
    const m = markers.get(id);
    if (m) m.bringToFront();
  }
  function fitAll() {
    const cs = catchments.filter(visible);
    if (cs.length) map.fitBounds(L.latLngBounds(cs.map((c) => [c.lat, c.lon])), { padding: [24, 24], maxZoom: 8 });
  }
  D.outlines().then((fc) => {
    outlines = L.geoJSON(fc, { renderer: canvas, interactive: false, style: outlineStyle() }).addTo(map);
    outlines.bringToBack();
  }).catch(() => { /* opcional */ });

  // ------------------------------------------------------------------ seletor (barra de contexto)
  function renderPicker() {
    const states = [...new Set(catchments.map((c) => c.state))].sort();
    $("#f-state").innerHTML = `<option value="">${lang === "pt" ? "Todos os estados" : "All states"}</option>` + states.map((s) => `<option ${s === stateF ? "selected" : ""}>${s}</option>`).join("");
    const list = catchments.filter(visible).sort((a, b) => (a.state + a.name).localeCompare(b.state + b.name, "pt"));
    $("#basinSel").innerHTML = `<option value="">${t("all_basins")}</option>` + list.map((c) => `<option value="${c.id}" ${selected && selected.id === c.id ? "selected" : ""}>${esc(c.name)}/${c.state} · ${c.ana}</option>`).join("");
  }
  $("#f-state").addEventListener("change", (e) => {
    stateF = e.target.value;
    if (selected && !visible(selected)) { go("#map"); }
    renderPicker(); drawPoints(); renderList(); renderKpis();
    if (!selected || !visible(selected)) fitAll();
  });
  $("#basinSel").addEventListener("change", (e) => { if (e.target.value) go(`#map/${e.target.value}`); else go("#map"); });

  // ------------------------------------------------------------------ lista de bacias
  let listQ = "";
  function renderList() {
    const pool = catchments.filter((c) => visible(c) && (!listQ || norm(c.name).includes(listQ) || String(c.ana).startsWith(listQ) || String(c.id) === listQ || norm(c.state) === listQ));
    const sorted = [...pool].sort((a, b) => b.area - a.area);
    const lmax = Math.log10(sorted.length ? sorted[0].area : 1);
    $("#list-sub").textContent = t("list_sub")(pool.length);
    const cf = colorFn();
    $("#list").innerHTML = sorted.slice(0, 200).map((c) => {
      const col = cf.fn(c);
      return `<button class="row" type="button" data-id="${c.id}"><span class="n"><b>${esc(c.name)}</b><small>${c.state} · ANA ${c.ana} · ${biomeName(c.biome)}</small></span>
        <span class="bar" aria-hidden="true"><i style="width:${Math.max(4, (Math.log10(c.area) / lmax) * 100)}%;background:${col}"></i></span>
        <span class="pill" style="background:${col};color:${inkOn(col)}">${nf(c.area)} km²</span></button>`;
    }).join("");
  }
  $("#list").addEventListener("click", (e) => { const r = e.target.closest(".row"); if (r) go(`#map/${r.dataset.id}`); });
  $("#search").addEventListener("input", (e) => { listQ = norm(e.target.value.trim()); renderList(); });

  // ------------------------------------------------------------------ KPIs
  function kpi(label, value, unit, note, color) {
    return `<div class="kpi"><span>${label}</span><b${color ? ` style="color:${color}"` : ""}>${value}${unit ? `<small>${unit}</small>` : ""}</b><em>${note || "&nbsp;"}</em></div>`;
  }
  function renderKpis() {
    if (!catchments.length) return;
    if (selected) {
      const c = selected;
      $("#kpis").innerHTML = [
        kpi(t("k_area"), nf(c.area), "km²", `${c.state} · ${hregName(c.hreg)}`),
        kpi(t("k_qmean"), nf(c.qmean, 2), lang === "pt" ? "mm/dia" : "mm/day", `${t("labels").baseflow_index}: ${nf(row("streamflow", c.id).baseflow_index, 0)}`),
        kpi(t("k_prec"), nf(c.prec), "mm", `ET ${nf(row("climate", c.id).clim_et, 2)} mm/${lang === "pt" ? "dia" : "day"}`),
        kpi(t("k_arid"), nf(c.aridity, 2), "", c.aridity > 1 ? (lang === "pt" ? "limitada por água" : "water-limited") : (lang === "pt" ? "limitada por energia" : "energy-limited"), c.aridity > 1 ? "#D99A2B" : "#2F86E0"),
        kpi(t("k_hdi"), nf(c.hdi, 2), "", `${t("labels").res_number}: ${nf(row("disturbance", c.id).res_number)}`),
      ].join("");
    } else {
      const cs = catchments.filter(visible);
      const big = cs.reduce((a, b) => (b.area > a.area ? b : a), cs[0]);
      const qm = cs.map((c) => c.qmean).filter((x) => x != null).sort((a, b) => a - b);
      $("#kpis").innerHTML = [
        kpi(t("k_basins"), nf(cs.length), "", t("k_basins_n")(new Set(cs.map((c) => c.state)).size, new Set(cs.map((c) => c.biome)).size)),
        kpi(t("k_period"), "1980–2025", "", t("k_period_n")),
        kpi(t("k_area_max"), nf(big.area), "km²", `${esc(big.name)}/${big.state}`),
        kpi(t("k_qmean"), nf(qm[Math.floor(qm.length / 2)], 2), lang === "pt" ? "mm/dia" : "mm/day", lang === "pt" ? "mediana entre as bacias" : "median across catchments"),
        kpi(t("k_attr"), "85", "", t("k_attr_n")),
      ].join("");
    }
  }

  // ------------------------------------------------------------------ atributos da bacia
  const TABS = [
    { k: "q", blocks: [{ cls: "streamflow", cols: ["q_mean", "q_95", "q_5", "q_1", "q_99", "baseflow_index", "runoff_coef", "q_elasticity", "fdc_slope", "q_cv", "q_hfd", "q_zero"] }] },
    { k: "clim", blocks: [{ cls: "climate", cols: ["clim_p", "clim_pet", "clim_et", "aridity_index", "p_seasonality", "clim_tmin", "clim_tmax", "clim_rh", "clim_srad", "clim_wind"] }] },
    { k: "land", blocks: [{ title: "blk_cover", special: "cover" }, { title: "blk_soil", special: "soil" }, { title: "blk_soilattr", cls: "soil", cols: ["soil_type", "soil_textclass", "soil_depth", "soil_carbon"], more: { cls: "landcover", cols: ["cover_main", "ndvi_djf"] } }] },
    { k: "phys", blocks: [{ title: "blk_topo", cls: "topography", cols: ["elev_mean", "elev_min", "elev_max", "catch_slope", "catch_order", "elev_gauge"] }, { title: "blk_geo", cls: "geology", cols: ["catch_lith", "sub_porosity", "sub_permeability", "sub_hconduc"], more: { cls: "groundwater", cols: ["aquif_name", "aquif_type", "catch_wtd", "catch_hand"] } }] },
    { k: "dist", blocks: [{ cls: "disturbance", cols: ["hdisturb_index", "res_number", "res_area", "res_volume", "res_regulation", "water_demand", "cover_urban", "cover_crops", "dist_urban"] }] },
  ];
  let activeTab = "q";
  const row = (cls, id) => (attrIndex[cls] && attrIndex[cls].get(id)) || {};
  const unitOf = (cls, col) => { const a = attributes[cls], i = a.columns.indexOf(col); return i >= 0 ? a.units[i] : ""; };
  function facts(cls, cols, id) {
    const r = row(cls, id);
    return cols.filter((c) => c in r).map((c) => {
      const v = r[c], txt = typeof v === "string", u = unitOf(cls, c);
      return `<div title="${c}"><dt>${t("labels")[c] || c}</dt><dd class="${txt ? "txt" : ""}">${v === null ? "–" : txt ? esc(v) : nf(v, autoD(v))}${!txt && v !== null && u ? `<small>${esc(u)}</small>` : ""}</dd></div>`;
    }).join("");
  }
  const COVER_COLORS = { forest: "#1F9E6E", grass: "#9BC53D", shrub: "#6E8B3D", crops: "#E08A1E", urban: "#8E9AAB", waterp: "#13A5C4", bare: "#B4531A" };
  const SOIL_COLORS = { sand: "#E9C46A", silt: "#C08A3E", clay: "#8A4B22" };
  const hbars = (pairs, colors, label) => `<div class="hbars">${pairs.map(([k, v]) =>
    `<div class="hbar"><span>${label(k)}</span><span class="bar"><i style="width:${Math.min(100, Math.max(0, v))}%;background:${colors[k]}"></i></span><b>${nf(v, 0)}%</b></div>`).join("")}</div>`;


  // ------------------------------------------------------------------ pop-up sobre o mapa (como o painel do app Shiny)
  // As barras ficam fixas no DOM e só mudam de largura, para animarem de uma bacia para outra.
  const POP_COVER = ["forest", "grass", "shrub", "crops", "urban"];
  const POP_SOIL = ["sand", "silt", "clay"];
  let popMean = null, popBuilt = false;
  function popMeans() {
    if (popMean) return popMean;
    const m = {}; const avg = (f) => { const v = catchments.map(f).filter((x) => x != null); return v.reduce((a, b) => a + b, 0) / v.length; };
    POP_COVER.forEach((k) => (m["c_" + k] = avg((c) => c.cover && c.cover[k])));
    POP_SOIL.forEach((k) => (m["s_" + k] = avg((c) => c.soil && c.soil[k])));
    return (popMean = m);
  }
  function popBar(id, label, color) {
    return `<div class="pb" data-b="${id}"><span>${label}</span><span class="tr"><i style="background:${color}"></i><u></u></span><b>–</b></div>`;
  }
  function buildPop() {
    $("#map-pop").innerHTML = `<div class="ph"><div><small>${t("pop_head")}</small><b id="pop-name"></b></div><button type="button" class="x" id="pop-x" aria-label="${t("pop_close")}">×</button></div>
      <dl id="pop-dl"></dl>
      <div class="pt">${t("blk_cover")}</div>${POP_COVER.map((k) => popBar("c_" + k, t("c_" + k), COVER_COLORS[k])).join("")}
      <div class="pt">${t("blk_soil")}</div>${POP_SOIL.map((k) => popBar("s_" + k, t("s_" + k), SOIL_COLORS[k])).join("")}
      <div class="leg">${t("pop_vs")}</div>`;
    $("#pop-x").addEventListener("click", () => { $("#map-pop").hidden = true; });
    popBuilt = true;
  }
  function renderPop(c, rebuild) {
    const el = $("#map-pop");
    if (!c) { el.hidden = true; return; }
    if (!popBuilt || rebuild) buildPop();
    const wasHidden = el.hidden; el.hidden = false;
    const mm = lang === "pt" ? "mm/dia" : "mm/day";
    $("#pop-name").textContent = `${c.name}/${c.state}`;
    $("#pop-dl").innerHTML = [
      [t("pop_ana"), c.ana], [t("pop_biome"), biomeName(c.biome)], [t("pop_missing"), `${nf(c.missing, 1)}%`],
      [t("k_area"), `${nf(c.area)} km²`], [t("pop_elev"), `${nf(c.elev)} m`], [t("k_prec"), `${nf(c.prec)} mm`],
      [t("k_qmean"), `${nf(c.qmean, 2)} ${mm}`], [t("k_arid"), nf(c.aridity, 2)], [t("k_hdi"), nf(c.hdi, 2)],
    ].map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("");
    const means = popMeans();
    const vals = {}; POP_COVER.forEach((k) => (vals["c_" + k] = c.cover ? c.cover[k] : null)); POP_SOIL.forEach((k) => (vals["s_" + k] = c.soil ? c.soil[k] : null));
    const apply = () => Object.entries(vals).forEach(([id, v]) => {
      const r = el.querySelector(`[data-b="${id}"]`);
      r.querySelector("i").style.width = `${Math.min(100, Math.max(0, v || 0))}%`;
      r.querySelector("u").style.left = `calc(${Math.min(100, means[id] || 0)}% - 1px)`;
      r.querySelector("b").textContent = v == null ? "–" : `${nf(v, 0)}%`;
    });
    // na primeira abertura parte de zero, para a barra crescer
    if (wasHidden || rebuild) { el.querySelectorAll(".pb i").forEach((i) => (i.style.width = "0")); requestAnimationFrame(() => requestAnimationFrame(apply)); }
    else apply();
  }

  function renderAttrBox() {
    const c = selected;
    if (!c || !attributes) return;
    $("#d-tabs").innerHTML = TABS.map((tb) => `<button type="button" data-k="${tb.k}" aria-pressed="${tb.k === activeTab}">${t("tab_" + tb.k)}</button>`).join("");
    const tab = TABS.find((x) => x.k === activeTab);
    $("#d-tab-body").innerHTML = `<div class="bsel"><b>${c.ana} · ${esc(c.name)}</b><small>CABra ${c.id} · ${c.state} · ${biomeName(c.biome)} · ${nf(c.lat, 3)}°, ${nf(c.lon, 3)}°</small></div>` +
      tab.blocks.map((b) => {
        let inner;
        if (b.special === "cover") inner = hbars(Object.entries(c.cover).filter(([, v]) => v !== null && v >= 0.5).sort((x, y) => y[1] - x[1]), COVER_COLORS, (k) => t("c_" + k));
        else if (b.special === "soil") inner = hbars(["sand", "silt", "clay"].map((k) => [k, c.soil[k]]), SOIL_COLORS, (k) => t("s_" + k));
        else inner = `<dl class="facts">${facts(b.cls, b.cols, c.id)}${b.more ? facts(b.more.cls, b.more.cols, c.id) : ""}</dl>`;
        return `<div class="blk">${b.title ? `<div class="blk-title">${t(b.title)}</div>` : ""}${inner}</div>`;
      }).join("");
  }
  $("#d-tabs").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { activeTab = b.dataset.k; renderAttrBox(); } });

  async function select(id) {
    const c = byId.get(id);
    if (!c) return;
    selected = c;
    $("#list-panel").hidden = true;
    $("#chart-panel").hidden = false;
    $("#attr-panel").hidden = false;
    $(".grid2").classList.add("sel");
    map.invalidateSize();
    $("#d-csv").disabled = false;
    renderAttrBox(); renderKpis(); renderPicker(); highlight(id); renderPop(c);
    $("#series-sub").textContent = `${c.name}/${c.state} · ANA ${c.ana}`;
    const geom = await D.boundary(id);
    if (selected !== c) return;
    if (boundaryLayer) map.removeLayer(boundaryLayer);
    boundaryLayer = L.geoJSON(geom, { style: { color: css("--brand"), weight: 2, fillColor: css("--brand"), fillOpacity: 0.15 }, interactive: false, pane: "basin", renderer: basinRenderer }).addTo(map);
    const popW = getComputedStyle($("#map-pop")).position === "absolute" ? $("#map-pop").offsetWidth + 20 : 0;
    map.flyToBounds(boundaryLayer.getBounds(), { paddingTopLeft: [30, 30], paddingBottomRight: [30 + popW, 30], maxZoom: 10, duration: 0.6 });
    loadSeries(c);
  }
  function clearSelection() {
    selected = null; seriesToken++; destroyPlot();
    if (boundaryLayer) { map.removeLayer(boundaryLayer); boundaryLayer = null; }
    $("#list-panel").hidden = false;
    $("#chart-panel").hidden = true;
    $("#attr-panel").hidden = true;
    $(".grid2").classList.remove("sel");
    map.invalidateSize();
    $("#d-csv").disabled = true;
    $("#chart").innerHTML = `<div class="loading">${t("chart_empty")}</div>`;
    $("#chart-hint").hidden = true;
    $("#series-sub").textContent = t("series_sub_none");
    renderKpis(); renderPicker(); highlight(-1); renderPop(null);
  }
  $("#d-close").addEventListener("click", () => go("#map"));


  // ------------------------------------------------------------------ seleção por área (retângulo ou polígono enviado) e download
  // Uma bacia entra na seleção quando a estação (exutório) está dentro da área.
  const areaStyle = () => ({ color: css("--brand"), weight: 2, dashArray: "6 4", fillColor: css("--brand"), fillOpacity: 0.06, interactive: false, pane: "basin", renderer: basinRenderer });
  function ringsOf(geom) {
    // devolve uma lista de polígonos, cada um uma lista de anéis [[lon, lat], ...]
    if (!geom) return [];
    if (geom.type === "FeatureCollection") return geom.features.flatMap((f) => ringsOf(f.geometry));
    if (geom.type === "Feature") return ringsOf(geom.geometry);
    if (geom.type === "GeometryCollection") return geom.geometries.flatMap(ringsOf);
    if (geom.type === "Polygon") return [geom.coordinates];
    if (geom.type === "MultiPolygon") return geom.coordinates;
    return [];
  }
  function inRing(x, y, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  const inPolys = (polys, x, y) => polys.some((rings) => inRing(x, y, rings[0]) && !rings.slice(1).some((h) => inRing(x, y, h)));
  function kmlToGeoJSON(text) {
    const doc = new DOMParser().parseFromString(text, "application/xml");
    const polys = [...doc.getElementsByTagName("Polygon")].map((pg) => {
      const read = (el) => el.textContent.trim().split(/\s+/).map((tk) => tk.split(",").slice(0, 2).map(Number)).filter((c) => c.length === 2 && c.every(Number.isFinite));
      const outer = pg.getElementsByTagName("outerBoundaryIs")[0], inner = [...pg.getElementsByTagName("innerBoundaryIs")];
      const oc = outer && outer.getElementsByTagName("coordinates")[0];
      return oc ? [read(oc), ...inner.map((b) => read(b.getElementsByTagName("coordinates")[0]))] : null;
    }).filter(Boolean);
    return { type: "MultiPolygon", coordinates: polys };
  }
  function setArea(geojson) {
    const polys = ringsOf(geojson);
    if (!polys.length) { alertBar(t("area_bad")); return; }
    if (areaLayer) map.removeLayer(areaLayer);
    areaLayer = L.geoJSON(geojson, { style: areaStyle }).addTo(map);
    areaSel = new Set(catchments.filter((c) => inPolys(polys, c.lon, c.lat)).map((c) => c.id));
    if (selected && !areaSel.has(selected.id)) go("#map");
    refreshArea();
    map.fitBounds(areaLayer.getBounds(), { padding: [30, 30] });
  }
  function clearArea() {
    areaSel = null;
    if (areaLayer) { map.removeLayer(areaLayer); areaLayer = null; }
    refreshArea();
  }
  function refreshArea() {
    renderPicker(); drawPoints(); renderList(); renderKpis(); renderAreaBar();
  }
  function alertBar(msg) { const b = $("#area-bar"); b.hidden = false; b.innerHTML = `<span class="ab-msg">${esc(msg)}</span>`; setTimeout(renderAreaBar, 4000); }
  function renderAreaBar() {
    const b = $("#area-bar");
    if (!areaSel) { b.hidden = true; b.innerHTML = ""; return; }
    const n = [...areaSel].filter((id) => visible(byId.get(id))).length;
    b.hidden = false;
    b.innerHTML = `<b>${t("area_n")(n)}</b>
      <label>${t("area_rain")} <select id="area-src">${["v1", "brdwgd", "chirps", "all"].map((k) => `<option value="${k}">${k === "all" ? t("area_all") : P_LABEL[k]}</option>`).join("")}</select></label>
      <button class="btn" type="button" id="area-attr" ${n ? "" : "disabled"}>${t("area_dl_attr")}</button>
      <button class="btn primary" type="button" id="area-zip" ${n ? "" : "disabled"}>${t("area_dl_zip")}</button>
      <button class="btn" type="button" id="area-clear">${t("area_clear")}</button>
      <span class="ab-msg" id="area-msg"></span>`;
    $("#area-clear").addEventListener("click", clearArea);
    $("#area-attr").addEventListener("click", () => download(`CABra_atributos_${n}_bacias.csv`, attrCSV(areaIds())));
    $("#area-zip").addEventListener("click", areaZip);
  }
  const areaIds = () => [...areaSel].filter((id) => visible(byId.get(id))).sort((a, b) => a - b);
  function csvCell(v) { if (v === null || v === undefined) return ""; const s = String(v); return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }
  function attrCSV(ids) {
    const cols = [["CABra ID", null]];
    CLASS_KEYS.forEach((k) => attributes[k].columns.forEach((c) => { if (c !== "CABra ID" && !(c === "ANA ID" && k !== "general")) cols.push([c, k]); }));
    const lines = [cols.map(([c]) => csvCell(c)).join(",")];
    ids.forEach((id) => lines.push(cols.map(([c, k]) => csvCell(k ? row(k, id)[c] : id)).join(",")));
    return lines.join("\n");
  }
  async function areaZip() {
    const ids = areaIds(), src = $("#area-src").value, msg = $("#area-msg"), files = [];
    const srcs = src === "all" ? ["v1", "brdwgd", "chirps"] : [src];
    $("#area-zip").disabled = true;
    const enc = new TextEncoder();
    files.push(["atributos.csv", enc.encode(attrCSV(ids))]);
    for (let i = 0; i < ids.length; i++) {
      const c = byId.get(ids[i]);
      msg.textContent = `${t("area_prep")} ${i + 1}/${ids.length}`;
      const s = await D.series(c.id), cols = [["streamflow_m3s", s.q]];
      for (const k of srcs) {
        let ser = s.p;
        if (k !== "v1") { try { ser = await D.precip(c.id, k); } catch (e) { continue; } }
        cols.push([`precip_mm_${k === "v1" ? "xavier_v1" : k}`, ser]);
      }
      files.push([`series/CABra_${c.id}_${c.ana}.csv`, enc.encode(seriesCSV(c, cols))]);
    }
    files.push(["LEIA-ME.txt", enc.encode(t("area_readme")(ids.length, srcs.map((k) => P_LABEL[k]).join(", ")))]);
    msg.textContent = t("area_zip");
    const blob = zipStore(files);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `CABra_${ids.length}_bacias.zip`;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
    msg.textContent = ""; $("#area-zip").disabled = false;
  }
  function seriesCSV(c, cols) {
    const rows = new Map();
    cols.forEach(([name, ser], j) => { const t0 = Date.parse(ser.start + "T00:00:00Z"); ser.values.forEach((v, i) => { const d = new Date(t0 + i * 86400000).toISOString().slice(0, 10); if (!rows.has(d)) rows.set(d, new Array(cols.length).fill("")); rows.get(d)[j] = v ?? ""; }); });
    const out = [`# CABra ${c.id} - ${c.name} (ANA ${c.ana})`, "# streamflow: CABra v1 ate 2010-09-30; depois, dados ANA processados (previa da v2)", "date," + cols.map(([n]) => n).join(",")];
    [...rows.keys()].sort().forEach((d) => out.push(d + "," + rows.get(d).join(",")));
    return out.join("\n");
  }
  // ZIP sem compressão (método "store"), suficiente para CSV e sem bibliotecas externas
  const CRC_T = (() => { const tb = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; tb[n] = c >>> 0; } return tb; })();
  const crc32 = (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC_T[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  function zipStore(files) {
    const parts = [], central = []; let off = 0;
    const enc = new TextEncoder();
    for (const [name, data] of files) {
      const nm = enc.encode(name), crc = crc32(data);
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
      h.setUint16(10, 0, true); h.setUint16(12, 0x21, true); h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true);
      h.setUint16(26, nm.length, true); h.setUint16(28, 0, true);
      parts.push(h, nm, data);
      const cd = new DataView(new ArrayBuffer(46));
      cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true); cd.setUint16(8, 0x0800, true); cd.setUint16(10, 0, true);
      cd.setUint16(12, 0, true); cd.setUint16(14, 0x21, true); cd.setUint32(16, crc, true); cd.setUint32(20, data.length, true); cd.setUint32(24, data.length, true);
      cd.setUint16(28, nm.length, true); cd.setUint32(42, off, true);
      central.push(cd, nm);
      off += 30 + nm.length + data.length;
    }
    const cdSize = central.reduce((a, x) => a + x.byteLength, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, off, true);
    return new Blob([...parts, ...central, end], { type: "application/zip" });
  }
  // ferramentas no mapa: retângulo, enviar polígono, limpar área
  let drawing = false, drawStart = null, drawRect = null;
  const AreaCtl = L.Control.extend({
    options: { position: "topleft" },
    onAdd() {
      const d = L.DomUtil.create("div", "leaflet-bar area-ctl");
      d.innerHTML = `<a href="#" role="button" data-a="rect" title=""><svg width="16" height="16" viewBox="0 0 16 16"><rect x="2.5" y="3.5" width="11" height="9" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="2.5 1.8"/></svg></a>
        <a href="#" role="button" data-a="poly" title=""><svg width="16" height="16" viewBox="0 0 16 16"><path d="M3 5.5 8 2l5 3.5-1.5 7h-7z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M8 11V6.5m0 0L6.2 8.3M8 6.5l1.8 1.8" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg></a>`;
      L.DomEvent.disableClickPropagation(d); L.DomEvent.disableScrollPropagation(d);
      d.addEventListener("click", (e) => {
        const a = e.target.closest("a"); if (!a) return; e.preventDefault();
        if (a.dataset.a === "rect") toggleDraw(!drawing);
        else $("#area-file").click();
      });
      return d;
    },
  });
  map.addControl(new AreaCtl());
  setTimeout(areaTitles, 0);
  function areaTitles() {
    const d = document.querySelector(".area-ctl"); if (!d) return;
    d.querySelector('[data-a="rect"]').title = t("area_rect"); d.querySelector('[data-a="rect"]').setAttribute("aria-label", t("area_rect"));
    d.querySelector('[data-a="poly"]').title = t("area_poly"); d.querySelector('[data-a="poly"]').setAttribute("aria-label", t("area_poly"));
  }
  function toggleDraw(on) {
    drawing = on;
    const ct = map.getContainer();
    ct.classList.toggle("drawing", on);
    document.querySelector('.area-ctl [data-a="rect"]').classList.toggle("on", on);
    if (on) { map.dragging.disable(); map.boxZoom.disable(); alertBar(t("area_draw_hint")); }
    else { map.dragging.enable(); map.boxZoom.enable(); }
  }
  const mc = map.getContainer();
  mc.addEventListener("pointerdown", (e) => {
    if (!drawing || e.button > 0 || e.target.closest(".leaflet-control")) return;
    drawStart = map.mouseEventToLatLng(e);
    drawRect = L.rectangle(L.latLngBounds(drawStart, drawStart), areaStyle()).addTo(map);
    mc.setPointerCapture(e.pointerId); e.preventDefault();
  });
  mc.addEventListener("pointermove", (e) => { if (drawing && drawRect) drawRect.setBounds(L.latLngBounds(drawStart, map.mouseEventToLatLng(e))); });
  mc.addEventListener("pointerup", (e) => {
    if (!drawing || !drawRect) return;
    const bb = drawRect.getBounds(); map.removeLayer(drawRect); drawRect = null; toggleDraw(false);
    if (Math.abs(bb.getEast() - bb.getWest()) < 1e-4 || Math.abs(bb.getNorth() - bb.getSouth()) < 1e-4) { renderAreaBar(); return; }
    const [w, so, ea, no] = [bb.getWest(), bb.getSouth(), bb.getEast(), bb.getNorth()];
    setArea({ type: "Polygon", coordinates: [[[w, so], [ea, so], [ea, no], [w, no], [w, so]]] });
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && drawing) { if (drawRect) { map.removeLayer(drawRect); drawRect = null; } toggleDraw(false); renderAreaBar(); } });
  $("#area-file").addEventListener("change", async (e) => {
    const f = e.target.files[0]; e.target.value = "";
    if (!f) return;
    try {
      const text = await f.text();
      const gj = /\.kml$/i.test(f.name) || /^\s*<\?xml|<kml/i.test(text.slice(0, 200)) ? kmlToGeoJSON(text) : JSON.parse(text);
      setArea(gj);
    } catch (err) { alertBar(t("area_bad")); }
  });

  // ------------------------------------------------------------------ gráfico
  let plot = null, series = null, chartMode = "q", seriesToken = 0, xZoom = null;
  // fonte da chuva: "v1" (a do CABra v1, dentro de series) ou uma série completa de outra fonte
  let pSrc = "v1", pAlt = null, pMsg = "";
  const curP = () => (pSrc !== "v1" && pAlt ? pAlt : series.p);
  const P_LABEL = { v1: "Xavier et al. (2016) · CABra v1", brdwgd: "BR-DWGD (Xavier atualizado)", chirps: "CHIRPS" };
  async function loadPrecip(c, token) {
    pAlt = null; pMsg = "";
    if (pSrc === "v1") return;
    try { pAlt = await D.precip(c.id, pSrc); }
    catch (e) { pMsg = lang === "pt" ? `Chuva ${P_LABEL[pSrc]} ainda não disponível para esta bacia; mostrando a da v1.` : `${P_LABEL[pSrc]} rainfall is not available for this catchment yet; showing v1.`; }
    if (token !== seriesToken) return false;
  }
  // período do eixo x: do início ao fim da série mais longa (vazão pode ir além da chuva)
  let X_RANGE = [Date.parse("1980-01-01T00:00:00Z") / 1000, Date.parse("2010-12-31T00:00:00Z") / 1000];
  const V1_END = Date.parse("2010-10-01T00:00:00Z") / 1000;
  const serEnd = (ser) => Date.parse(ser.start + "T00:00:00Z") / 1000 + (ser.values.length - 1) * 86400;
  function setRange() {
    const q = series.q, p = curP();
    X_RANGE = [Math.min(Date.parse(q.start + "T00:00:00Z"), Date.parse(p.start + "T00:00:00Z")) / 1000, Math.max(serEnd(q), serEnd(p))];
  }
  function destroyPlot() { if (plot) { plot.destroy(); plot = null; } }

  async function loadSeries(c) {
    const token = ++seriesToken;
    destroyPlot(); xZoom = null;
    $("#chart").innerHTML = `<div class="loading">${t("loading")}</div>`;
    const s = await D.series(c.id);
    if (token !== seriesToken) return;
    series = s;
    if ((await loadPrecip(c, token)) === false || token !== seriesToken) return;
    setRange(); drawChart();
  }
  document.querySelectorAll("#chart-modes button").forEach((b) => b.addEventListener("click", () => {
    chartMode = b.dataset.mode;
    document.querySelectorAll("#chart-modes button").forEach((x) => x.setAttribute("aria-pressed", x === b));
    $("#p-src").hidden = chartMode !== "p";
    if (selected && series) drawChart();
  }));
  $("#p-src").addEventListener("click", async (e) => {
    const b = e.target.closest("button"); if (!b || b.dataset.src === pSrc) return;
    pSrc = b.dataset.src;
    document.querySelectorAll("#p-src button").forEach((x) => x.setAttribute("aria-pressed", x === b));
    if (!selected || !series) return;
    const token = seriesToken;
    if ((await loadPrecip(selected, token)) === false) return;
    xZoom = null; setRange(); drawChart();
  });

  function drawChart() {
    destroyPlot();
    const el = $("#chart");
    el.innerHTML = "";
    const w = el.clientWidth, h = el.clientHeight;
    const axis = { stroke: css("--fg-3"), grid: { stroke: css("--line"), width: 1 }, ticks: { stroke: css("--line"), width: 1 }, font: "11px 'IBM Plex Mono', monospace" };
    const cq = css("--q"), cp = css("--p");
    let opts, data;
    if (chartMode === "fdc") {
      const v = series.q.values.filter((x) => x !== null && x > 0).sort((a, b) => b - a);
      const n = v.length, step = Math.max(1, Math.floor(n / 800)), xs = [], ys = [];
      for (let i = 0; i < n; i += step) { xs.push(((i + 1) / (n + 1)) * 100); ys.push(v[i]); }
      xs.push((n / (n + 1)) * 100); ys.push(v[n - 1]);
      data = [xs, ys];
      opts = {
        width: w, height: h, legend: { show: true, live: true },
        cursor: { drag: { x: false, y: false }, points: { size: 7, fill: cq } },
        scales: { x: { time: false, range: [0, 100] }, y: { distr: 3 } },
        axes: [Object.assign({}, axis, { values: (u, vs) => vs.map((x) => x + "%") }), Object.assign({}, axis, { size: 60, values: (u, vs) => vs.map((x) => nf(x, x < 1 ? 2 : 0)) })],
        series: [{ label: lang === "pt" ? "Permanência" : "Exceedance", value: (u, x) => (x == null ? "–" : nf(x, 1) + "%") },
          { label: lang === "pt" ? "Vazão (m³/s)" : "Streamflow (m³/s)", stroke: cq, width: 2, fill: cq + "18", value: (u, x) => (x == null ? "–" : nf(x, autoD(x))) }],
      };
      $("#chart-hint").hidden = true;
    } else {
      const isQ = chartMode === "q", s = isQ ? series.q : curP();
      const n = s.values.length, t0 = Date.parse(s.start + "T00:00:00Z") / 1000, xs = new Float64Array(n);
      for (let i = 0; i < n; i++) xs[i] = t0 + i * 86400;
      data = [xs, s.values];
      opts = {
        width: w, height: h, legend: { show: true, live: true },
        tzDate: (ts) => uPlot.tzDate(new Date(ts * 1e3), "Etc/UTC"),
        cursor: { drag: { x: true, y: false, setScale: true }, points: { show: false } },
        scales: { x: { time: true }, y: { range: (u, mn, mx) => [0, (mx || 1) * 1.05] } },
        axes: [axis, Object.assign({}, axis, { size: 60, values: (u, vs) => vs.map((x) => nf(x, 0)) })],
        series: [{ label: lang === "pt" ? "Data" : "Date", value: (u, x) => (x == null ? "–" : fmtDate(new Date(x * 1000).toISOString().slice(0, 10))) },
          isQ ? { label: lang === "pt" ? "Vazão (m³/s)" : "Streamflow (m³/s)", stroke: cq, width: 1.2, fill: cq + "1f", value: (u, x) => (x == null ? "–" : nf(x, autoD(x))) }
              : { label: (lang === "pt" ? "Precipitação (mm) · " : "Precipitation (mm) · ") + P_LABEL[pAlt ? pSrc : "v1"], stroke: cp, width: 0, fill: cp + "cc", paths: uPlot.paths.bars({ size: [1, 3], gap: 0 }), value: (u, x) => (x == null ? "–" : nf(x, 1)) }],
        hooks: {
          setScale: [(u, k) => { if (k === "x") xZoom = [u.scales.x.min, u.scales.x.max]; }],
          // linha que separa a v1 (até set/2010) da prévia da v2
          draw: [(u) => {
            if (!isQ || serEnd(s) <= V1_END) return;
            const x = Math.round(u.valToPos(V1_END, "x", true));
            if (x < u.bbox.left || x > u.bbox.left + u.bbox.width) return;
            const g = u.ctx; g.save();
            g.strokeStyle = css("--fg-3"); g.setLineDash([5, 4]); g.lineWidth = devicePixelRatio;
            g.beginPath(); g.moveTo(x, u.bbox.top); g.lineTo(x, u.bbox.top + u.bbox.height); g.stroke();
            g.setLineDash([]); g.textAlign = "left"; g.textBaseline = "alphabetic"; g.fillStyle = css("--fg-3"); g.font = `${11 * devicePixelRatio}px 'IBM Plex Sans', sans-serif`;
            g.fillText(lang === "pt" ? "prévia v2 →" : "v2 preview →", x + 6 * devicePixelRatio, u.bbox.top + 14 * devicePixelRatio);
            g.restore();
          }],
        },
      };
      $("#chart-hint").hidden = false;
      $("#chart-hint").textContent = isQ ? t("zoom_hint") : (pMsg ? pMsg + " " : "") + t("zoom_hint_p");
    }
    plot = new uPlot(opts, data, el);
    // a legenda ocupa espaço: reajusta a altura
    const lgH = plot.root.querySelector(".u-legend")?.offsetHeight || 0;
    plot.setSize({ width: w, height: h - lgH });
    if (chartMode !== "fdc") {
      const r = xZoom || X_RANGE;
      plot.setScale("x", { min: r[0], max: r[1] });
      plot.over.addEventListener("dblclick", () => { xZoom = null; plot.setScale("x", { min: X_RANGE[0], max: X_RANGE[1] }); });
    }
    const st = chartMode === "p" ? curP() : series.q;
    const end = new Date(Date.parse(st.start + "T00:00:00Z") + (st.values.length - 1) * 86400000).toISOString().slice(0, 10);
    $("#series-sub").textContent = `${selected.name}/${selected.state} · ANA ${selected.ana} · ${fmtDate(st.start)} – ${fmtDate(end)}`;
  }
  let rT;
  window.addEventListener("resize", () => { clearTimeout(rT); rT = setTimeout(() => { if (plot && series) drawChart(); map.invalidateSize(); }, 150); });

  $("#d-csv").addEventListener("click", async () => {
    const c = selected;
    if (!c) return;
    const s = await D.series(c.id), rows = new Map(), p = series && selected === c ? curP() : s.p;
    const add = (ser, col) => { const t0 = Date.parse(ser.start + "T00:00:00Z"); ser.values.forEach((v, i) => { const d = new Date(t0 + i * 86400000).toISOString().slice(0, 10); if (!rows.has(d)) rows.set(d, {}); rows.get(d)[col] = v; }); };
    add(p, "p"); add(s.q, "q");
    const lines = ["date,precipitation_mm,streamflow_m3s"];
    [...rows.keys()].sort().forEach((d) => { const r = rows.get(d); lines.push(`${d},${r.p ?? ""},${r.q ?? ""}`); });
    download(`CABra_${c.id}_${c.ana}.csv`, `# CABra ${c.id} - ${c.name} (ANA ${c.ana})\n# Vazão: CABra v1 até 2010-09-30; depois, dados ANA processados (prévia da v2)\n# Chuva: ${P_LABEL[p === s.p ? "v1" : pSrc]}\n# CABra v1, https://doi.org/10.5281/zenodo.4070146\n` + lines.join("\n"));
  });
  function download(name, text) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
    a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }

  // ------------------------------------------------------------------ tabela
  const CLASS_KEYS = ["general", "topography", "climate", "streamflow", "groundwater", "geology", "soil", "landcover", "disturbance"];
  let tClass = "general", tSort = { col: 0, dir: 1 }, tFilter = "";
  function renderClasses() {
    $("#classes").innerHTML = CLASS_KEYS.map((k) => `<button type="button" data-k="${k}" aria-pressed="${k === tClass}">${t("cls_" + k)}</button>`).join("");
    $("#about-classes").innerHTML = CLASS_KEYS.map((k) => `<a class="btn" href="#attributes/${k}">${t("cls_" + k)}</a>`).join("");
    $("#tbl-title").textContent = t("cls_" + tClass);
  }
  $("#classes").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) go(`#attributes/${b.dataset.k}`); });
  $("#tfilter").addEventListener("input", (e) => { tFilter = norm(e.target.value.trim()); renderTable(); });
  function renderTable() {
    if (!attributes) return;
    const a = attributes[tClass];
    let rows = a.rows;
    if (tFilter) rows = rows.filter((r) => r.some((v) => v !== null && norm(v).includes(tFilter)));
    const { col, dir } = tSort;
    rows = [...rows].sort((x, y) => { const a1 = x[col], b1 = y[col]; if (a1 === null) return 1; if (b1 === null) return -1; return (typeof a1 === "number" && typeof b1 === "number" ? a1 - b1 : String(a1).localeCompare(String(b1))) * dir; });
    const labels = t("labels");
    const head = a.columns.map((c, i) => `<th data-i="${i}" class="${i === col ? "sorted" : ""}" title="${esc(c)}">${esc(labels[c] || c)}${i === col ? (dir > 0 ? " ↑" : " ↓") : ""}<small>${a.units[i] ? esc(a.units[i]) : esc(c)}</small></th>`).join("");
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
    document.querySelectorAll(".nav[data-view]").forEach((a) => { if (a.dataset.view === v) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
    const key = { map: "map", attributes: "attr", about: "about" }[v];
    $("#crumb").textContent = t("crumb_" + key);
    $("#title").textContent = t("title_" + key);
    $("#picker").hidden = v !== "map";
    $("#side").classList.remove("open");
    if (v === "map") {
      setTimeout(() => map.invalidateSize(), 0);
      if (arg && byId.has(+arg)) { if (!selected || selected.id !== +arg) { select(+arg); if (innerWidth <= 1100) scrollTo({ top: 0, behavior: "smooth" }); } }
      else if (selected) { clearSelection(); fitAll(); }
    } else scrollTo(0, 0);
    if (v === "attributes") {
      if (arg && CLASS_KEYS.includes(arg) && arg !== tClass) { tClass = arg; tSort = { col: 0, dir: 1 }; }
      renderClasses(); renderTable();
    }
  }
  window.addEventListener("hashchange", route);

  function refreshAll() {
    drawPoints(); renderPicker(); renderList(); renderKpis(); renderClasses(); renderTable();
    $("#map-title").textContent = t("map_title"); $("#map-sub").textContent = t("map_sub"); $("#map-stamp").textContent = t("map_stamp");
    route(); areaTitles(); renderAreaBar();
    if (selected) { renderAttrBox(); if (series) drawChart(); if (!$("#map-pop").hidden) renderPop(selected, true); }
    else { popBuilt = false; $("#chart").innerHTML = `<div class="loading">${t("chart_empty")}</div>`; $("#series-sub").textContent = t("series_sub_none"); }
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
    if (!location.hash.startsWith("#map/")) fitAll();
    refreshAll();
  }).catch((err) => {
    $("#chart").innerHTML = `<div class="loading">Erro ao carregar dados: ${esc(err.message)}</div>`;
  });
})();
