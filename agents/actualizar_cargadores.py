#!/usr/bin/env python3
"""Agente diario: mapa de cargadores públicos de Uruguay.

Fuentes (gratuitas):
  0. UTE: el mapa público de movilidad eléctrica (movilidad.ute.com.uy/mapa.html) carga todas las
     estaciones de la red de UTE desde un JSON. Es la fuente oficial para la red de UTE.
     Se consulta una vez por día, igual que una visita al mapa.
  1. Open Charge Map (licencia CC BY 4.0). Con la variable OCM_API_KEY usa la API;
     sin clave descarga la exportación pública del repositorio openchargemap/ocm-export.
  2. OpenStreetMap vía Overpass (licencia ODbL): suma los cargadores que no estén en OCM.
  3. Mapa interoperable de operadores (el que publica Eve Move para el MIEM: back-app.eve-move.com/eve/miem).
     Trae UTE y la mayoría de los operadores privados (eOne, DMC, Evergo, Eve…) con su estado en tiempo
     real y tarifas. Es la fuente principal para los operadores privados; OCM y OSM completan lo que falte.

Genera data/cargadores.json y data/cargadores_salud.json (conteos por fuente y operador, para el control).
Si una fuente falla, se conservan sus cargadores del día anterior: el mapa nunca se vacía por una caída.
Los cargadores que desaparecen de su fuente se mantienen 14 días marcados y después se quitan.

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
            "fuente": "UTE", "url": "https://movilidad.ute.com.uy/mapa.html", "tiempo_real": True,
        })
    return salida


# ---------- Mapa interoperable (MIEM / Eve Move) ----------
INTEROP_API = "https://back-app.eve-move.com/eve/miem"
TIPO_INTEROP = {"CCS 2": "CCS2", "Tipo 2": "Tipo 2", "GBT": "GB/T DC", "CHAdeMO": "CHAdeMO"}


def red_interop(x):
    m = re.search(r"/(\d+)-[a-z]+-[^/]*$", x.get("logoUrl") or "")
    return m.group(1) if m else ""


def tarifa_interop(cnns):
    precios = sorted({r["price"] for c in cnns for r in (c.get("rate") or []) if r.get("price") is not None})
    if not precios:
        return None
    if precios == [0]:
        return "Gratis"
    txt = f"$ {precios[0]:.0f}" + (f" a {precios[-1]:.0f}" if len(precios) > 1 else "") + " por kWh"
    fijo = max([c.get("fixedCost") or 0 for c in cnns] or [0])
    return txt + (f" + $ {fijo:.0f} por sesión" if fijo else "")


def interoperable():
    nombres = json.loads((RAIZ / "agents" / "fuentes" / "redes_interop.json").read_text(encoding="utf-8"))
    req = urllib.request.Request(INTEROP_API, headers=UA)
    with urllib.request.urlopen(req, timeout=60) as r:
        texto = r.read().decode("utf-8")
    datos = json.JSONDecoder().raw_decode(texto.lstrip())[0]  # a veces trae basura después del JSON
    hoy = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    salida = []
    for e in datos:
        if e.get("latitude") is None:
            continue
        cnns = e.get("cnns") or []
        conectores = {}
        for c in cnns:
            k = (TIPO_INTEROP.get(c.get("type"), c.get("type") or "Otro"), round(c.get("power") or 0))
            conectores[k] = conectores.get(k, 0) + 1
        lista = [{"tipo": t, "kw": kw or None, "cantidad": n} for (t, kw), n in sorted(conectores.items(), key=lambda x: -x[0][1])]
        red = red_interop(e)
        op = "UTE" if e.get("ute") else nombres.get(red, "Otro operador")
        nombre = (e.get("name") or "Punto de carga").strip()
        salida.append({
            "id": "int-" + re.sub(r"[^a-z0-9]+", "-", f"{nombre}-{float(e['latitude']):.4f}".lower()).strip("-"),
            "nombre": nombre, "direccion": "", "ciudad": "", "departamento": "",
            "lat": round(float(e["latitude"]), 6), "lon": round(float(e["longitude"]), 6),
            "operador": op, "red": red,
            "horario": (e.get("openTime") or "").strip() or None,
            "costo": "Tarifa UTE (ver Costos)" if e.get("ute") else tarifa_interop(cnns),
            "conectores": lista, "max_kw": max([c["kw"] or 0 for c in lista] or [0]) or None,
            "puntos": len(cnns) or 1, "verificado": hoy, "tiempo_real": True,
            "fuente": "Mapa interoperable de operadores", "url": "https://manager.eve-move.com/mapa",
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


def cerca(c, lista, m=80):
    return any(distancia_m(c, b) <= m for b in lista)


SALUD = RAIZ / "data" / "cargadores_salud.json"
DIAS_GRACIA = 14


def main():
    ocm_dir = sys.argv[sys.argv.index("--ocm-dir") + 1] if "--ocm-dir" in sys.argv else None
    hoy = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    anterior = json.loads(SALIDA.read_text(encoding="utf-8")).get("cargadores", []) if SALIDA.exists() else []
    estado = {}  # fuente -> "ok" / "falló: ..."

    def correr(nombre, f):
        try:
            r = f()
            estado[nombre] = "ok" if r else "no devolvió datos"
            return r
        except Exception as e:
            print(f"[aviso] {nombre}: {e}", file=sys.stderr)
            estado[nombre] = f"falló: {str(e)[:120]}"
            return None

    def de_antes(fuente):  # si una fuente cae, se usa lo que había ayer
        return [c for c in anterior if c.get("fuente") == fuente]

    oficiales = correr("UTE", ute)
    if not oficiales:
        oficiales = de_antes("UTE")
    inter = correr("Mapa interoperable de operadores", interoperable)
    if not inter:
        inter = de_antes("Mapa interoperable de operadores")
    def ocm():
        clave = os.environ.get("OCM_API_KEY")
        pois, ref = ocm_desde_api(clave) if clave and not ocm_dir else ocm_desde_export(ocm_dir)
        return normalizar_ocm(pois, ref)
    base_ocm = correr("Open Charge Map", ocm)
    if base_ocm is None or not base_ocm:
        base_ocm = de_antes("Open Charge Map")
    nuevos_osm = [] if "--sin-osm" in sys.argv else correr("OpenStreetMap", osm)
    if not nuevos_osm:
        nuevos_osm = de_antes("OpenStreetMap")

    # 1) Red de UTE: datos de UTE + estaciones UTE del mapa interoperable que UTE todavía no lista
    ute_extra = [c for c in inter if c["operador"] == "UTE" and not cerca(c, oficiales)]
    todos = oficiales + ute_extra
    # 2) Privados del mapa interoperable (datos de los propios operadores, con estado en vivo)
    privados = [c for c in inter if c["operador"] != "UTE" and not cerca(c, todos, 40)]
    todos += privados
    # 3) Open Charge Map y OpenStreetMap completan lo que no está en las fuentes de operadores
    todos += [c for c in base_ocm if c["operador"] != "UTE" and not cerca(c, todos)]
    todos += [c for c in nuevos_osm if not cerca(c, todos)]

    # Datos de dirección / ciudad: se completan desde la fuente colaborativa más cercana
    colab = base_ocm + nuevos_osm + oficiales
    for c in todos:
        if not c["ciudad"]:
            par = min(colab, key=lambda k: distancia_m(c, k), default=None)
            if par and distancia_m(c, par) < 300:
                c["ciudad"] = c["ciudad"] or par["ciudad"]
                c["direccion"] = c["direccion"] or par["direccion"]
                c["departamento"] = c["departamento"] or par["departamento"]
        if not c["ciudad"]:  # ciudad aproximada: la de la estación con ciudad más cercana (hasta 5 km)
            par = min((k for k in todos + colab if k.get("ciudad")), key=lambda k: distancia_m(c, k), default=None)
            if par and distancia_m(c, par) < 5000:
                c["ciudad"] = par["ciudad"]
        c["visto"] = hoy

    # Cargadores que ayer estaban y hoy no aparecen en ninguna fuente: se mantienen 14 días marcados
    for c in anterior:
        if not cerca(c, todos, 40):
            visto = c.get("visto") or c.get("verificado") or hoy
            try:
                dias = (datetime.fromisoformat(hoy) - datetime.fromisoformat(visto)).days
            except ValueError:
                dias = 0
            if dias < DIAS_GRACIA:
                c["no_visto_dias"] = dias
                todos.append(c)
    completar_departamentos(todos)
    if not todos:
        print("[aviso] Sin datos nuevos; se conserva el archivo anterior.", file=sys.stderr)
        return
    todos.sort(key=lambda c: (c["departamento"], c["nombre"]))

    cuenta = lambda clave: dict(sorted(__import__("collections").Counter(c[clave] for c in todos).items(), key=lambda x: -x[1]))
    datos = {
        "actualizado": hoy,
        "total": len(todos),
        "puntos": sum(c.get("puntos") or 1 for c in todos),
        "por_operador": cuenta("operador"),
        "por_departamento": cuenta("departamento"),
        "fuentes": ["UTE (mapa público de movilidad eléctrica)", "Mapa interoperable de operadores (Eve Move / MIEM)",
                    "Open Charge Map (CC BY 4.0)", "© colaboradores de OpenStreetMap (ODbL)"],
        "nota": "UTE y la mayoría de los operadores privados se toman de sus propios mapas, todos los días. Open Charge Map y OpenStreetMap completan los que falten.",
        "cargadores": todos,
    }
    SALIDA.write_text(json.dumps(datos, ensure_ascii=False, indent=1), encoding="utf-8")

    # Control de salud: se compara con el día anterior y se anotan los problemas para el issue de aviso
    salud_ant = json.loads(SALUD.read_text(encoding="utf-8")) if SALUD.exists() else {}
    por_fuente = cuenta("fuente")
    problemas = [f"La fuente «{f}» {e} (se usaron sus datos del día anterior)." for f, e in estado.items() if e != "ok"]
    for clave, nuevo, viejo in [("fuente", por_fuente, salud_ant.get("por_fuente", {})), ("operador", datos["por_operador"], salud_ant.get("por_operador", {}))]:
        for k, v in viejo.items():
            n = nuevo.get(k, 0)
            if v >= 5 and n < v * 0.9:
                problemas.append(f"El {clave} «{k}» bajó de {v} a {n} ubicaciones.")
    redes_nuevas = sorted({c.get("red") for c in todos if c.get("operador") == "Otro operador" and c.get("red")})
    if redes_nuevas:
        problemas.append("Redes del mapa interoperable sin nombre asignado: " + ", ".join(redes_nuevas) + " (completar agents/fuentes/redes_interop.json).")
    ocultos = [c["nombre"] for c in todos if c.get("no_visto_dias")]
    historial = (salud_ant.get("historial") or [])[-89:] + [{"fecha": hoy, "total": len(todos), "puntos": datos["puntos"]}]
    SALUD.write_text(json.dumps({"fecha": hoy, "estado_fuentes": estado, "por_fuente": por_fuente,
                                 "por_operador": datos["por_operador"], "sin_ver": ocultos, "problemas": problemas,
                                 "historial": historial}, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"Cargadores: {len(todos)} ubicaciones ({datos['puntos']} conectores). Por fuente: {por_fuente}")
    for p in problemas:
        print("[problema]", p)


if __name__ == "__main__":
    main()
