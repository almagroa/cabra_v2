// Camada de acesso aos dados do site.
//
// Todo o resto do site lê os dados só por estas funções. Hoje elas leem
// arquivos JSON estáticos em docs/data/; para usar um banco/API no futuro,
// basta trocar DATA_BASE (ou reescrever estas funções) mantendo o mesmo
// formato de retorno.
(function () {
  const DATA_BASE = window.CABRA_DATA_BASE || "data";
  const cache = new Map();

  function getJSON(path) {
    if (!cache.has(path)) {
      cache.set(
        path,
        fetch(`${DATA_BASE}/${path}`).then((r) => {
          if (!r.ok) throw new Error(`${r.status} ao ler ${path}`);
          return r.json();
        })
      );
    }
    return cache.get(path);
  }

  window.CabraData = {
    // [{id, ana, name, lon, lat, state, biome, hreg, area, elev, prec, aridity, hdi, qmean, cover{}, soil{}}]
    catchments: () => getJSON("catchments.json"),
    // {general: {columns, units, rows}, topography: {...}, ...}
    attributes: () => getJSON("attributes.json"),
    // FeatureCollection com os contornos simplificados de todas as bacias (fundo do mapa)
    outlines: () => getJSON("outlines.json"),
    // GeoJSON geometry of the catchment boundary
    boundary: (id) => getJSON(`boundaries/${id}.json`),
    // {q: {start, unit, values[]}, p: {start, unit, values[]}}
    series: (id) => getJSON(`series/${id}.json`),
    // chuva diária de outra fonte, série completa de uma só origem: {start, unit, source, values[]}
    // src: "brdwgd" (Xavier atualizado) ou "chirps"
    precip: (id, src) => getJSON(`precip/${src}/${id}.json`),
  };
})();
