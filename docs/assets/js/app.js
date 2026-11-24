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
  let selected = null, stateF = "";

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
  const visible = (c) => !stateF || c.state === stateF;

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
        kpi(t("k_period"), "1980–2010", "", t("k_period_n")),
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
    boundaryLayer = L.geoJSON(geom, { style: { color: css("--brand"), weight: 2, fillColor: css("--brand"), fillOpacity: 0.15 }, interactive: false }).addTo(map);
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

  // ------------------------------------------------------------------ gráfico
  let plot = null, series = null, chartMode = "q", seriesToken = 0, xZoom = null;
  const X_RANGE = [Date.parse("1980-01-01T00:00:00Z") / 1000, Date.parse("2010-12-31T00:00:00Z") / 1000];
  function destroyPlot() { if (plot) { plot.destroy(); plot = null; } }

  async function loadSeries(c) {
    const token = ++seriesToken;
    destroyPlot(); xZoom = null;
    $("#chart").innerHTML = `<div class="loading">${t("loading")}</div>`;
    const s = await D.series(c.id);
    if (token !== seriesToken) return;
    series = s;
    drawChart();
  }
  document.querySelectorAll("#chart-modes button").forEach((b) => b.addEventListener("click", () => {
    chartMode = b.dataset.mode;
    document.querySelectorAll("#chart-modes button").forEach((x) => x.setAttribute("aria-pressed", x === b));
    if (selected && series) drawChart();
  }));

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
      const isQ = chartMode === "q", s = isQ ? series.q : series.p;
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
              : { label: lang === "pt" ? "Precipitação (mm)" : "Precipitation (mm)", stroke: cp, width: 0, fill: cp + "cc", paths: uPlot.paths.bars({ size: [1, 3], gap: 0 }), value: (u, x) => (x == null ? "–" : nf(x, 1)) }],
        hooks: { setScale: [(u, k) => { if (k === "x") xZoom = [u.scales.x.min, u.scales.x.max]; }] },
      };
      $("#chart-hint").hidden = false;
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
    const st = chartMode === "p" ? series.p : series.q;
    const end = new Date(Date.parse(st.start + "T00:00:00Z") + (st.values.length - 1) * 86400000).toISOString().slice(0, 10);
    $("#series-sub").textContent = `${selected.name}/${selected.state} · ANA ${selected.ana} · ${fmtDate(st.start)} – ${fmtDate(end)}`;
  }
  let rT;
  window.addEventListener("resize", () => { clearTimeout(rT); rT = setTimeout(() => { if (plot && series) drawChart(); map.invalidateSize(); }, 150); });

  $("#d-csv").addEventListener("click", async () => {
    const c = selected;
    if (!c) return;
    const s = await D.series(c.id), rows = new Map();
    const add = (ser, col) => { const t0 = Date.parse(ser.start + "T00:00:00Z"); ser.values.forEach((v, i) => { const d = new Date(t0 + i * 86400000).toISOString().slice(0, 10); if (!rows.has(d)) rows.set(d, {}); rows.get(d)[col] = v; }); };
    add(s.p, "p"); add(s.q, "q");
    const lines = ["date,precipitation_mm,streamflow_m3s"];
    [...rows.keys()].sort().forEach((d) => { const r = rows.get(d); lines.push(`${d},${r.p ?? ""},${r.q ?? ""}`); });
    download(`CABra_${c.id}_${c.ana}.csv`, `# CABra ${c.id} - ${c.name} (ANA ${c.ana})\n# CABra v1, https://doi.org/10.5281/zenodo.4070146\n` + lines.join("\n"));
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
    route();
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
