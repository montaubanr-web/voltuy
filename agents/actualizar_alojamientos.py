#!/usr/bin/env python3
"""Directorio de alojamientos con cargador (semanal).

Fuentes: 1) cargadores públicos ubicados en hoteles o termas (data/cargadores.json: UTE + Open Charge Map),
2) OpenStreetMap: alojamientos con cargador propio (tags de carga) o con un cargador a menos de 300 m.
Las altas que mandan los propios alojamientos se sirven desde la base (API /api/alojamientos) una vez verificadas.
"""
import json, math, re, sys, urllib.parse, urllib.request
from datetime import date
from pathlib import Path

R = Path(__file__).resolve().parent.parent
OVERPASS = "https://overpass-api.de/api/interpreter"
TIPOS = {"hotel": "Hotel", "motel": "Hotel", "guest_house": "Posada o B&B", "apartment": "Casa o apartamento", "chalet": "Cabaña", "hostel": "Hostel", "camp_site": "Camping", "resort": "Hotel"}
RX = re.compile(r"hotel|posada|caba[ñn]a|hostel|resort|estancia|lodge|termas|apart", re.I)


def dist(a, b, c, d):
    p = math.pi / 180
    return 12742000 * math.asin(math.sqrt(math.sin((c - a) * p / 2) ** 2 + math.cos(a * p) * math.cos(c * p) * math.sin((d - b) * p / 2) ** 2))


def osm():
    q = """[out:json][timeout:120];area["ISO3166-1"="UY"]->.uy;
    (nwr["tourism"~"hotel|motel|guest_house|apartment|chalet|hostel|camp_site"](area.uy);nwr["leisure"="resort"](area.uy););out center tags;"""
    req = urllib.request.Request(OVERPASS, data=urllib.parse.urlencode({"data": q}).encode(), headers={"User-Agent": "VoltUY-agente/1.0"})
    with urllib.request.urlopen(req, timeout=180) as r:
        return json.load(r).get("elements", [])


def main():
    previo = json.loads((R / "data/alojamientos.json").read_text(encoding="utf-8"))
    cg = json.loads((R / "data/cargadores.json").read_text(encoding="utf-8"))["cargadores"]
    out, vistos = [], set()
    for x in cg:
        if RX.search(x["nombre"]):
            out.append({"id": f"cg-{x['id']}", "nombre": x["nombre"], "tipo": "Termas" if "termas" in x["nombre"].lower() else "Hotel", "localidad": x["ciudad"],
                        "departamento": x["departamento"], "lat": x["lat"], "lon": x["lon"], "cargador": f"{x['operador']} · hasta {x['max_kw']} kW",
                        "acceso": f"Público (red de {x['operador']})", "distancia_m": 0, "url": None, "fuente": x.get("fuente"), "origen": "cargadores", "destacado": False})
            vistos.add(x["nombre"].lower())
    try:
        elems = osm()
    except Exception as e:
        print(f"[aviso] Overpass: {e}; se conservan los alojamientos de OSM anteriores", file=sys.stderr)
        elems = None
    if elems is None:
        out += [a for a in previo.get("alojamientos", []) if a.get("origen") == "osm"]
    else:
        for el in elems:
            t = el.get("tags", {}); nombre = t.get("name")
            if not nombre or nombre.lower() in vistos:
                continue
            lat, lon = el.get("lat") or el.get("center", {}).get("lat"), el.get("lon") or el.get("center", {}).get("lon")
            propio = any(k.startswith(("socket:", "charging")) or (k == "amenity" and v == "charging_station") for k, v in t.items()) or t.get("capacity:charging")
            cerca = min(((dist(lat, lon, c["lat"], c["lon"]), c) for c in cg), key=lambda z: z[0])
            if not propio and cerca[0] > 300:
                continue
            out.append({"id": f"osm-{el['type'][0]}{el['id']}", "nombre": nombre, "tipo": TIPOS.get(t.get("tourism") or "resort", "Hotel"),
                        "localidad": t.get("addr:city") or cerca[1]["ciudad"], "departamento": cerca[1]["departamento"], "lat": lat, "lon": lon,
                        "cargador": "Cargador propio" if propio else f"{cerca[1]['operador']} · hasta {cerca[1]['max_kw']} kW",
                        "acceso": "Huéspedes" if propio else "Público, a pasos", "distancia_m": 0 if propio else int(round(cerca[0], -1)),
                        "url": t.get("website") or t.get("contact:website"), "fuente": "OpenStreetMap (ODbL)", "origen": "osm", "destacado": False})
            vistos.add(nombre.lower())
    previo["alojamientos"] = sorted(out, key=lambda a: (a["departamento"] or "", a["nombre"]))
    previo["actualizado"] = date.today().isoformat()
    (R / "data/alojamientos.json").write_text(json.dumps(previo, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"alojamientos.json: {len(out)} alojamientos")


if __name__ == "__main__":
    main()
