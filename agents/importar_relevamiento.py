#!/usr/bin/env python3
"""Suma al catálogo las versiones de un relevamiento de referencia (archivo en agents/fuentes/).

No pisa datos propios más recientes: solo completa precios vacíos o anteriores a la fecha de corte,
y agrega las versiones que faltan, marcadas con su fuente. Después conviene correr
`python agents/actualizar_ursea.py --offline` para completar autonomía y consumo homologado.
"""
import json, re, sys, unicodedata
from pathlib import Path

R = Path(__file__).resolve().parent.parent
FUENTE_URL = "https://mielectrico.uy/explore"
FECHA, CORTE = "2026-11", "2026-09"

def slug(s):
    s = s.replace("+", " plus ")
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")

def carroceria(seg):
    if seg.startswith("SUV"): return "SUV"
    if seg in ("Pick-up", "Utilitario", "Cuadriciclo"): return seg
    if seg == "Sin clasificar": return None
    return "Auto"

# Precios del relevamiento para versiones que ya teníamos (id -> (precio, versión nueva o None))
ACTUALIZAR = {
    "gac-aion-ut": (21990, None), "omoda-e5": (28990, None), "jaecoo-5-ev": (30990, None),
    "mg-zs-ev-comfort": (31990, None), "leapmotor-c11": (39990, None), "zeekr-x": (46990, "Premium 200 kW"),
    "xpeng-g6": (54990, "Performance 4x4"), "geely-ex5": (35990, None), "mg4": (29900, "Standard"),
    "fiat-600e": (37990, None), "chevrolet-captiva-ev": (33990, None), "geely-ex2": (22490, None), "kia-ev3": (49990, None),
}

def main(archivo):
    p = R / "data/modelos.json"; cat = json.loads(p.read_text(encoding="utf-8"))
    por_id = {m["id"]: m for m in cat["modelos"]}
    for m in cat["modelos"]:
        m.setdefault("carroceria", carroceria(m["segmento"]))
    for mid, (precio, version) in ACTUALIZAR.items():
        m = por_id[mid]
        if m["precio_usd"] is None or (m.get("fecha_precio") or "0") < CORTE:
            m["precio_usd"], m["fecha_precio"], m["fuente_precio"] = precio, FECHA, FUENTE_URL
        if version: m["version"] = version
    nuevos = 0
    for linea in Path(archivo).read_text(encoding="utf-8").splitlines():
        if not linea.strip() or linea.startswith("#"): continue
        marca, modelo, version, precio, bat, seg = linea.split("|")
        mid = slug(f"{marca} {modelo} {version}")
        if mid in por_id: continue
        reev = "REEV" in version
        m = {"id": mid, "marca": marca, "modelo": modelo, "version": version or None, "tipo": "PHEV" if reev else "BEV",
             "segmento": "Sin clasificar" if seg == "Sin clasificar" else seg, "carroceria": carroceria(seg),
             "precio_usd": int(precio), "bateria_kwh": float(bat) if bat else None, "autonomia_km": None, "ciclo": None,
             "importador": None, "ventas_2025": None, "destacado": False, "fecha_precio": FECHA,
             "fuente": FUENTE_URL, "fuente_precio": FUENTE_URL, "verificar": True}
        cat["modelos"].append(m); por_id[mid] = m; nuevos += 1
    cat["modelos"].sort(key=lambda m: (m["precio_usd"] is None, m["precio_usd"] or 0))
    cat["nota"] = ("Precios de lista en US$ publicados en Uruguay; cada versión indica su fuente y fecha. "
                   "Autonomía según el ciclo indicado (CLTC suele ser optimista; WLTP y URSEA son más realistas). "
                   "Campos vacíos = dato pendiente de verificar.")
    p.write_text(json.dumps(cat, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{nuevos} versiones nuevas · total {len(cat['modelos'])}")

if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else R / "agents/fuentes/mielectrico_2026-11-17.txt")
