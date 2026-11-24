"""Acrescenta a docs/data/catchments.json estatísticas das séries de vazão publicadas.

q_missing: % de dias sem vazão entre o início da série e o fim do período do site (2025-12-31)
q_end: último dia com vazão observada

Uso: python site_tools/add_series_stats.py docs
"""
import json
import sys
from datetime import date, timedelta
from pathlib import Path

docs = Path(sys.argv[1] if len(sys.argv) > 1 else "docs")
END = date(2025, 12, 31)
cat_path = docs / "data" / "catchments.json"
cats = json.loads(cat_path.read_text(encoding="utf-8"))
for c in cats:
    q = json.loads((docs / "data" / "series" / f"{c['id']}.json").read_text(encoding="utf-8"))["q"]
    start = date.fromisoformat(q["start"])
    vals = q["values"]
    n_total = (END - start).days + 1
    n_ok = sum(v is not None for v in vals)
    last = max((i for i, v in enumerate(vals) if v is not None), default=None)
    c["q_missing"] = round(100 * (1 - n_ok / n_total), 1)
    c["q_end"] = (start + timedelta(days=last)).isoformat() if last is not None else None
cat_path.write_text(json.dumps(cats, ensure_ascii=False, separators=(",", ":"), allow_nan=False), encoding="utf-8")
m = sorted(c["q_missing"] for c in cats)
print("q_missing min/mediana/max:", m[0], m[len(m) // 2], m[-1])
