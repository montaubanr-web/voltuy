#!/usr/bin/env python3
"""Precios de referencia de eléctricos usados (diario), con avisos de MercadoLibre Uruguay (API oficial).

Para cada modelo del catálogo busca avisos usados en "Autos y Camionetas", se queda con los que son
100% eléctricos (atributo de combustible o indicios en el título), y calcula por año: cantidad, mediana,
rango típico (p25–p75) y km típicos. Lista los avisos más convenientes frente a la mediana de su año.
Requiere ML_CLIENT_ID y ML_CLIENT_SECRET; sin ellos no modifica nada.
"""
import json, os, re, statistics, sys, time, urllib.parse
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from actualizar_precios import ml_token, get, asociar, ML_CATEGORIA  # noqa: E402

R = Path(__file__).resolve().parent.parent


def atributo(it, ids):
    for a in it.get("attributes", []):
        if a.get("id") in ids:
            return a.get("value_name")
    return None


def num(s):
    m = re.search(r"[\d.]+", (s or "").replace(",", ""))
    return int(float(m.group(0))) if m else None


def cuartil(v, q):
    v = sorted(v); i = (len(v) - 1) * q; lo = int(i)
    return round(v[lo] + (v[min(lo + 1, len(v) - 1)] - v[lo]) * (i - lo))


def main():
    try:
        tok = ml_token()
    except Exception as e:
        print(f"[aviso] MercadoLibre: {e}", file=sys.stderr); tok = None
    if not tok:
        print("Sin credenciales de MercadoLibre: no se actualizan usados."); return
    cat = json.loads((R / "data/modelos.json").read_text(encoding="utf-8"))["modelos"]
    modelos = {}
    for m in cat:
        if m["tipo"] == "BEV":
            modelos.setdefault((m["marca"], m["modelo"]), m)
    salida = {}
    for (marca, modelo), m in modelos.items():
        avisos = []
        for offset in (0, 50):
            q = urllib.parse.urlencode({"q": f"{marca} {modelo}", "category": ML_CATEGORIA, "ITEM_CONDITION": "2230581", "limit": 50, "offset": offset})
            try:
                r = json.loads(get(f"https://api.mercadolibre.com/sites/MLU/search?{q}", {"Authorization": f"Bearer {tok}"}))
            except Exception as e:
                print(f"[aviso] {marca} {modelo}: {e}", file=sys.stderr); break
            for it in r.get("results", []):
                t = it.get("title", "")
                comb = (atributo(it, {"FUEL_TYPE"}) or "").lower()
                if comb and "eléctrico" not in comb and "electrico" not in comb:
                    continue
                if not asociar(marca, t, [m]):
                    continue
                precio = it.get("price"); mon = it.get("currency_id")
                if mon == "UYU" and precio:
                    precio = round(precio / 39)
                anio, km = num(atributo(it, {"VEHICLE_YEAR"})), num(atributo(it, {"KILOMETERS"}))
                if not precio or not anio or precio < 3000:
                    continue
                avisos.append({"titulo": t, "precio": int(precio), "anio": anio, "km": km, "url": it.get("permalink"),
                               "lugar": (it.get("location") or {}).get("city", {}).get("name") or (it.get("address") or {}).get("city_name")})
            if len(r.get("results", [])) < 50:
                break
            time.sleep(0.5)
        if len(avisos) < 3:
            continue
        por_anio = []
        for anio in sorted({a["anio"] for a in avisos}, reverse=True):
            v = [a["precio"] for a in avisos if a["anio"] == anio]
            k = [a["km"] for a in avisos if a["anio"] == anio and a["km"]]
            if len(v) >= 2:
                por_anio.append({"anio": anio, "n": len(v), "mediana": round(statistics.median(v)), "p25": cuartil(v, .25), "p75": cuartil(v, .75), "km": round(statistics.median(k)) if k else None})
        med = {p["anio"]: p["mediana"] for p in por_anio}
        mejores = sorted([a for a in avisos if a["anio"] in med], key=lambda a: a["precio"] / med[a["anio"]])[:6]
        salida[m["id"]] = {"nombre": f"{marca} {modelo}", "n": len(avisos), "por_anio": por_anio, "avisos": mejores}
    (R / "data/usados.json").write_text(json.dumps({"actualizado": date.today().isoformat(), "nota": "Avisos usados de MercadoLibre Uruguay (API oficial). Precios en US$ (avisos en pesos convertidos a 39 $/US$).", "modelos": salida}, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"usados.json: {len(salida)} modelos con avisos")


if __name__ == "__main__":
    main()
