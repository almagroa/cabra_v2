"""Converte os dados do CABra (pacote do app Shiny antigo) para os arquivos
estáticos usados pelo site em docs/.

Uso:
    python site_tools/build_site_data.py <pasta_do_app_antigo> [docs]

Gera em docs/data/:
    catchments.json          resumo de cada bacia (mapa e painel)
    attributes.json          as 9 classes de atributos (colunas, unidades, linhas)
    boundaries/<id>.json     contorno simplificado de cada bacia (GeoJSON)
    series/<id>.json         vazão e precipitação diárias de cada bacia

Dependências: pandas, pyshp, shapely.
"""
import json
import math
import sys
from pathlib import Path

import pandas as pd
import shapefile
from shapely.geometry import mapping, shape

SRC = Path(sys.argv[1])
OUT = Path(sys.argv[2] if len(sys.argv) > 2 else "docs") / "data"
SIMPLIFY_DEG = 0.003  # ~300 m; suficiente para visualização

CLASSES = [
    ("general", "CABra_general_attributes.txt"),
    ("topography", "CABra_topography_attributes.txt"),
    ("climate", "CABra_climate_attributes.txt"),
    ("streamflow", "CABra_streamflow_attributes.txt"),
    ("groundwater", "CABra_groundwater_attributes.txt"),
    ("geology", "CABra_geology_attributes.txt"),
    ("soil", "CABra_soil_attributes.txt"),
    ("landcover", "CABra_land-cover_attributes.txt"),
    ("disturbance", "CABra_hydrologic_disturbance_attributes.txt"),
]

UNIT_FIX = {"�C": "°C", "â°": "‰", "g cmÂ¯Â³": "g cm⁻³"}


def clean_unit(u):
    u = u.strip()
    for a, b in UNIT_FIX.items():
        u = u.replace(a, b)
    return u.replace("¯¹", "⁻¹").replace("¯²", "⁻²").replace("¯³", "⁻³").replace("��", "⁻¹")


def num(v):
    try:
        x = float(v)
    except ValueError:
        return v.strip()
    if math.isnan(x) or math.isinf(x):  # ex.: fdc_slope = -Inf no original
        return None
    return int(x) if x.is_integer() else x


SMALL = {"de", "do", "da", "dos", "das", "e", "d"}


def nice_name(s):
    words = s.strip().lower().split()
    return " ".join(w if (i and w in SMALL) else w[:1].upper() + w[1:] for i, w in enumerate(words))


def read_attributes(path):
    lines = path.read_bytes().decode("latin-1").splitlines()
    header = [h.strip() for h in lines[0].split("\t")]
    units = [clean_unit(u) for u in lines[1].split("\t")]
    units += [""] * (len(header) - len(units))
    rows = []
    for ln in lines[2:]:
        if not ln.strip():
            continue
        rows.append([num(v) for v in ln.split("\t")])
    return {"columns": header, "units": units[: len(header)], "rows": rows}


def main():
    (OUT / "boundaries").mkdir(parents=True, exist_ok=True)
    (OUT / "series").mkdir(parents=True, exist_ok=True)

    # --- atributos -------------------------------------------------------
    attrs = {k: read_attributes(SRC / f) for k, f in CLASSES}
    (OUT / "attributes.json").write_text(json.dumps(attrs, ensure_ascii=False, separators=(",", ":"), allow_nan=False))

    # --- resumo por bacia ------------------------------------------------
    names = pd.read_csv(SRC / "nomes_estacoes.CSV", sep=";", encoding="latin-1")
    summ = pd.read_csv(SRC / "summary.csv", sep=";", encoding="latin-1")
    land = pd.DataFrame(attrs["landcover"]["rows"], columns=attrs["landcover"]["columns"])
    soil = pd.DataFrame(attrs["soil"]["rows"], columns=attrs["soil"]["columns"])
    topo = pd.DataFrame(attrs["topography"]["rows"], columns=attrs["topography"]["columns"])
    clim = pd.DataFrame(attrs["climate"]["rows"], columns=attrs["climate"]["columns"])
    strm = pd.DataFrame(attrs["streamflow"]["rows"], columns=attrs["streamflow"]["columns"])
    catchments = []
    for i, s in summ.iterrows():
        cid = int(s.CABRAID)
        n = names[names.CABRAID == cid].iloc[0]
        lc = land[land["CABra ID"] == cid].iloc[0]
        so = soil[soil["CABra ID"] == cid].iloc[0]
        tp = topo[topo["CABra ID"] == cid].iloc[0]
        cl = clim[clim["CABra ID"] == cid].iloc[0]
        st = strm[strm["CABra ID"] == cid].iloc[0]
        catchments.append({
            "id": cid, "ana": int(s.ANAID), "name": nice_name(n.NOME),
            "lon": float(n.LON), "lat": float(n.LAT), "state": s.ESTADO,
            "biome": s.BIOMA, "hreg": s.HREG, "missing": float(s.MISS),
            "area": round(float(tp.catch_area), 1), "elev": float(s.ELEV),
            "prec": float(s.PREC), "aridity": float(s.ARID), "hdi": float(s.HDI),
            "qmean": st.q_mean, "pet": cl.clim_pet,
            "cover": {k: lc["cover_" + k] for k in ["forest", "grass", "shrub", "crops", "urban", "waterp", "bare"]},
            "soil": {"sand": so.soil_sand, "silt": so.soil_silt, "clay": so.soil_clay},
        })
    (OUT / "catchments.json").write_text(json.dumps(catchments, ensure_ascii=False, separators=(",", ":"), default=num, allow_nan=False))

    # --- contornos -------------------------------------------------------
    for c in catchments:
        r = shapefile.Reader(str(SRC / "shapefiles" / f"CABra_{c['id']}.shp"))
        geom = shape(r.shape(0).__geo_interface__).simplify(SIMPLIFY_DEG, preserve_topology=True)
        gj = mapping(geom)

        def rnd(o):
            if isinstance(o, (list, tuple)):
                if o and isinstance(o[0], float):
                    return [round(v, 4) for v in o]
                return [rnd(v) for v in o]
            return o

        gj = {"type": gj["type"], "coordinates": rnd(gj["coordinates"])}
        (OUT / "boundaries" / f"{c['id']}.json").write_text(json.dumps(gj, separators=(",", ":"), allow_nan=False))

    # --- séries ----------------------------------------------------------
    flow = pd.read_csv(SRC / "flows.csv")
    prec = pd.read_csv(SRC / "prec.csv")

    def series(df, col, nd):
        v = df[col].round(nd)
        return [None if pd.isna(x) else (int(x) if float(x).is_integer() else float(x)) for x in v]

    for c in catchments:
        col = f"CABra{c['id']}"
        out = {
            "q": {"start": "1980-10-01", "unit": "m³/s", "values": series(flow, col, 3)},
            "p": {"start": "1980-01-01", "unit": "mm", "values": series(prec, col, 2)},
        }
        (OUT / "series" / f"{c['id']}.json").write_text(json.dumps(out, separators=(",", ":"), allow_nan=False))

    print(f"{len(catchments)} bacias -> {OUT}")


if __name__ == "__main__":
    main()
