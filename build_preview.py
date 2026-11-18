#!/usr/bin/env python3
"""Genera dist/preview.html: el sitio en un solo archivo, con los datos embebidos."""
import json
from pathlib import Path

R = Path(__file__).resolve().parent
html = (R / "index.html").read_text(encoding="utf-8")
css = (R / "assets/styles.css").read_text(encoding="utf-8")
js = (R / "assets/app.js").read_text(encoding="utf-8")
data = {n: json.loads((R / f"data/{n}.json" if n != "uruguay" else R / "data/uruguay.geojson").read_text(encoding="utf-8")) for n in ["modelos", "noticias", "normativa", "debates", "combustible", "tests", "cargadores", "uruguay", "tarifas", "localidades", "comunidad", "ventas", "videos", "miem", "alojamientos", "usados", "precios_historial"]}
rp = Path("/home/claude/tools/rutas_preview.json")
if rp.exists():
    data["rutas"] = json.loads(rp.read_text(encoding="utf-8"))
payload = json.dumps(data, ensure_ascii=False).replace("</", "<\\/")
leaflet = (R / "assets/leaflet.min.css").read_text(encoding="utf-8")
html = html.replace('<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css">', f"<style>{leaflet}</style>")
html = html.replace('<link rel="stylesheet" href="assets/styles.css">', f"<style>{css}</style>")
html = html.replace('<script src="assets/app.js"></script>', f"<script>window.__DATA__={payload};</script>\n<script>{js}</script>")
(R / "dist").mkdir(exist_ok=True)
(R / "dist/preview.html").write_text(html, encoding="utf-8")
print("ok", len(html))
