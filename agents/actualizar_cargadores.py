#!/usr/bin/env python3
"""Agente diario: mapa de cargadores públicos de Uruguay.

Fuentes (gratuitas):
  0. UTE: el mapa público de movilidad eléctrica (movilidad.ute.com.uy/mapa.html) carga todas las
     estaciones de la red de UTE desde un JSON. Es la fuente oficial para la red de UTE.
     Se consulta una vez por día, igual que una visita al mapa.
  1. Open Charge Map (licencia CC BY 4.0). Con la variable OCM_API_KEY usa la API;
     sin clave descarga la exportación pública del repositorio openchargemap/ocm-export.
  2. OpenStreetMap vía Overpass (licencia ODbL): suma los cargadores que no estén en OCM.

Genera data/cargadores.json. Si todas las fuentes fallan, conserva el archivo anterior.

Uso:  python agents/actualizar_cargadores.py [--ocm-dir RUTA_A_ocm-export/data]
"""
import glob
import json
import math
import os
import re
import subprocess
import sys
import tempfile
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
SALIDA = RAIZ / "data" / "cargadores.json"
UA = {"User-Agent": "VoltUY-bot/1.0"}

CONECTOR_OCM = {  # ConnectionTypeID de Open Charge Map -> nombre corto
    33: "CCS2", 32: "CCS1", 25: "Tipo 2", 1036: "Tipo 2", 2: "CHAdeMO",
    1039: "GB/T DC", 1038: "GB/T AC", 28: "Schuko", 1: "Tipo 1", 30: "Tesla",
}
DEPTOS = {  # normaliza nombres de departamento
    "rio negro": "Río Negro", "río negro": "Río Negro", "san jose": "San José", "san josé": "San José",
    "paysandu": "Paysandú", "paysandú": "Paysandú", "tacuarembo": "Tacuarembó", "tacuarembó": "Tacuarembó",
}


DEPARTAMENTOS = ["Artigas", "Canelones", "Cerro Largo", "Colonia", "Durazno", "Flores", "Florida", "Lavalleja",
                 "Maldonado", "Montevideo", "Paysandú", "Río Negro", "Rivera", "Rocha", "Salto", "San José",
                 "Soriano", "Tacuarembó", "Treinta y Tres"]


def depto(nombre):
    n = (nombre or "").strip().replace("Departamento de ", "")
    n = DEPTOS.get(n.lower(), n)
    for d in DEPARTAMENTOS:  # admite mayúsculas o sin tildes
        if n.lower() == d.lower() or n.lower() == d.lower().translate(str.maketrans("áéíóú", "aeiou")):
            return d
    return ""  # se completa luego por cercanía


def completar_departamentos(lista):
    conocidos = [c for c in lista if c["departamento"]]
    for c in lista:
        if not c["departamento"] and conocidos:
            c["departamento"] = min(conocidos, key=lambda k: distancia_m(c, k))["departamento"]


def http_json(url, data=None, timeout=90):
    req = urllib.request.Request(url, data=data, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


# ---------- UTE ----------
UTE_API = "https://movilidad.ute.com.uy/api/v1/station/status/map"
TIPO_UTE = {"CCS2": "CCS2", "Tipo 2": "Tipo 2", "GB/T": "GB/T DC", "CHAdeMO": "CHAdeMO"}


def ute():
    req = urllib.request.Request(UTE_API, headers={**UA, "uniqueKeyUser": "nginx"})  # cabecera que usa el mapa público
    with urllib.request.urlopen(req, timeout=60) as r:
        datos = json.loads(r.read().decode("utf-8"))["data"]
    salida = []
    for e in datos:
        if e.get("lat") is None:
            continue
        lista = [{"tipo": TIPO_UTE.get(c["type"], c["type"]), "kw": round(c["power"]) if c.get("power") else None,
                  "cantidad": c.get("count") or 1, "cable": bool(c.get("hose"))} for c in e.get("connectorStatusAcc") or []]
        lista.sort(key=lambda c: -(c["kw"] or 0))
        salida.append({
            "id": "ute-" + re.sub(r"[^a-z0-9]+", "-", f"{e['name']}-{e['lat']:.4f}".lower()).strip("-"),
            "nombre": e["name"].strip(), "direccion": (e.get("address") or "").strip(),
            "ciudad": (e.get("city") or "").strip(), "departamento": depto(e.get("department")),
            "lat": round(e["lat"], 6), "lon": round(e["lng"], 6), "operador": "UTE",
            "horario": None, "costo": "Tarifa UTE (ver Costos)", "conectores": lista,
            "max_kw": max([c["kw"] or 0 for c in lista] or [0]) or None,
            "puntos": sum(c["cantidad"] for c in lista) or 1,
            "verificado": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
            "fuente": "UTE", "url": "https://movilidad.ute.com.uy/mapa.html",
        })
    return salida


# ---------- Open Charge Map ----------
def ocm_desde_api(clave):
    url = "https://api.openchargemap.io/v3/poi/?" + urllib.parse.urlencode(
        {"output": "json", "countrycode": "UY", "maxresults": 5000, "compact": "true", "verbose": "false", "key": clave})
    pois = http_json(url)
    ref = http_json("https://api.openchargemap.io/v3/referencedata/?" + urllib.parse.urlencode({"key": clave}))
    return pois, ref


def ocm_desde_export(carpeta=None):
    if carpeta is None:
        tmp = tempfile.mkdtemp()
        subprocess.run(["git", "clone", "-q", "--depth", "1", "--filter=blob:none", "--sparse",
                        "https://github.com/openchargemap/ocm-export", tmp], check=True, timeout=300)
        subprocess.run(["git", "-C", tmp, "sparse-checkout", "set", "data/UY"], check=True, timeout=300)
        carpeta = os.path.join(tmp, "data")
    ref = json.load(open(os.path.join(carpeta, "referencedata.json"), encoding="utf-8"))
    pois = [json.load(open(f, encoding="utf-8")) for f in glob.glob(os.path.join(carpeta, "UY", "OCM-*.json"))]
    return pois, ref


def tipo_conector(titulo):
    t = (titulo or "").lower()
    for clave, nombre in [("ccs (type 2)", "CCS2"), ("ccs (type 1)", "CCS1"), ("chademo", "CHAdeMO"),
                          ("gb-t dc", "GB/T DC"), ("gb-t ac", "GB/T AC"), ("type 2", "Tipo 2"),
                          ("type 1", "Tipo 1"), ("schuko", "Schuko"), ("tesla", "Tesla")]:
        if clave in t:
            return nombre
    return "Otro"


def normalizar_ocm(pois, ref):
    tipos = {c["ID"]: tipo_conector(c["Title"]) for c in ref.get("ConnectionTypes", [])}
    operadores = {o["ID"]: o["Title"] for o in ref.get("Operators", [])}
    estados = {s["ID"]: s for s in ref.get("StatusTypes", [])}
    salida = []
    for p in pois:
        a = p.get("AddressInfo") or {}
        if a.get("Latitude") is None:
            continue
        estado = estados.get(p.get("StatusTypeID"), {})
        if estado.get("IsOperational") is False:
            continue  # fuera de servicio o retirado
        conectores = {}
        for c in p.get("Connections") or []:
            tipo = tipos.get(c.get("ConnectionTypeID"), "Otro")
            kw = round(c.get("PowerKW") or 0)
            k = (tipo, kw)
            conectores[k] = conectores.get(k, 0) + (c.get("Quantity") or 1)
        lista = [{"tipo": t, "kw": kw or None, "cantidad": n} for (t, kw), n in sorted(conectores.items(), key=lambda x: -x[0][1])]
        op = operadores.get(p.get("OperatorID"), "")
        op = "" if "Unknown" in op else op.replace(" (Uruguay)", "").replace(" (UY)", "")
        salida.append({
            "id": f"ocm-{p['ID']}",
            "nombre": (a.get("Title") or "Punto de carga").strip(),
            "direccion": (a.get("AddressLine1") or "").strip(),
            "ciudad": (a.get("Town") or "").strip(),
            "departamento": depto(a.get("StateOrProvince") or a.get("Town")),
            "lat": round(a["Latitude"], 6), "lon": round(a["Longitude"], 6),
            "operador": op or "Sin dato",
            "horario": (p.get("GeneralComments") or "").strip()[:80] or None,
            "costo": (p.get("UsageCost") or "").strip() or None,
            "conectores": lista,
            "max_kw": max([c["kw"] or 0 for c in lista] or [0]) or None,
            "puntos": p.get("NumberOfPoints") or sum(c["cantidad"] for c in lista) or 1,
            "verificado": (p.get("DateLastVerified") or p.get("DateLastStatusUpdate") or p.get("DateCreated") or "")[:10],
            "fuente": "Open Charge Map",
            "url": f"https://map.openchargemap.io/?id={p['ID']}",
        })
    return salida


# ---------- OpenStreetMap ----------
OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]
CONSULTA = '[out:json][timeout:90];area["ISO3166-1"="UY"][admin_level=2]->.a;nwr["amenity"="charging_station"](area.a);out center tags;'
SOCKET_OSM = {"type2_combo": "CCS2", "type2": "Tipo 2", "type2_cable": "Tipo 2", "chademo": "CHAdeMO",
              "gb_dc": "GB/T DC", "gb_ac": "GB/T AC", "schuko": "Schuko", "type1": "Tipo 1"}


def osm():
    for url in OVERPASS:
        try:
            d = http_json(url, data=urllib.parse.urlencode({"data": CONSULTA}).encode(), timeout=120)
            break
        except Exception as e:
            print(f"[aviso] Overpass {url}: {e}", file=sys.stderr)
    else:
        return []
    salida = []
    for e in d.get("elements", []):
        t = e.get("tags", {})
        lat = e.get("lat") or (e.get("center") or {}).get("lat")
        lon = e.get("lon") or (e.get("center") or {}).get("lon")
        if lat is None:
            continue
        lista = []
        for clave, nombre in SOCKET_OSM.items():
            n = t.get(f"socket:{clave}")
            if n and n.isdigit():
                kw = t.get(f"socket:{clave}:output", "").lower().replace("kw", "").strip()
                lista.append({"tipo": nombre, "kw": round(float(kw)) if kw.replace(".", "").isdigit() else None, "cantidad": int(n)})
        salida.append({
            "id": f"osm-{e['type'][0]}{e['id']}",
            "nombre": t.get("name") or t.get("operator") or "Punto de carga",
            "direccion": " ".join(x for x in [t.get("addr:street"), t.get("addr:housenumber")] if x),
            "ciudad": t.get("addr:city", ""), "departamento": depto(t.get("addr:state", "")),
            "lat": round(lat, 6), "lon": round(lon, 6),
            "operador": t.get("operator") or t.get("network") or "Sin dato",
            "horario": t.get("opening_hours"), "costo": t.get("charge") or t.get("fee"),
            "conectores": lista, "max_kw": max([c["kw"] or 0 for c in lista] or [0]) or None,
            "puntos": int(t["capacity"]) if t.get("capacity", "").isdigit() else max(1, sum(c["cantidad"] for c in lista)),
            "verificado": None, "fuente": "OpenStreetMap",
            "url": f"https://www.openstreetmap.org/{ {'n': 'node', 'w': 'way', 'r': 'relation'}[e['type'][0]] }/{e['id']}",
        })
    return salida


def distancia_m(a, b):
    r = 6371000
    p1, p2 = math.radians(a["lat"]), math.radians(b["lat"])
    dp, dl = p2 - p1, math.radians(b["lon"] - a["lon"])
    return 2 * r * math.asin(math.sqrt(math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2))


def main():
    ocm_dir = sys.argv[sys.argv.index("--ocm-dir") + 1] if "--ocm-dir" in sys.argv else None
    oficiales = []
    try:
        oficiales = ute()
    except Exception as e:
        print(f"[aviso] UTE: {e}", file=sys.stderr)
    base = []
    try:
        clave = os.environ.get("OCM_API_KEY")
        pois, ref = ocm_desde_api(clave) if clave and not ocm_dir else ocm_desde_export(ocm_dir)
        base = normalizar_ocm(pois, ref)
    except Exception as e:
        print(f"[aviso] Open Charge Map: {e}", file=sys.stderr)
    if oficiales:  # la red de UTE se toma de UTE; de OCM quedan los otros operadores
        base = [c for c in base if c["operador"] != "UTE" and all(distancia_m(c, u) > 80 for u in oficiales)]
    base = oficiales + base
    nuevos_osm = [] if "--sin-osm" in sys.argv else osm()
    extra = [c for c in nuevos_osm if all(distancia_m(c, b) > 80 for b in base)]
    todos = base + extra
    completar_departamentos(todos)
    if not todos:
        print("[aviso] Sin datos nuevos; se conserva el archivo anterior.", file=sys.stderr)
        return
    todos.sort(key=lambda c: (c["departamento"], c["nombre"]))
    datos = {
        "actualizado": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "total": len(todos),
        "fuentes": ["UTE (mapa público de movilidad eléctrica)", "Open Charge Map (CC BY 4.0)", "© colaboradores de OpenStreetMap (ODbL)"],
        "nota": "Red de UTE: datos oficiales de UTE. Otros operadores: datos colaborativos, pueden faltar cargadores recientes.",
        "cargadores": todos,
    }
    SALIDA.write_text(json.dumps(datos, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"Cargadores: {len(oficiales)} de UTE + {len(base) - len(oficiales)} de otros operadores (OCM) + {len(extra)} de OSM")


if __name__ == "__main__":
    main()
