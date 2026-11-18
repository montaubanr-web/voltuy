#!/usr/bin/env python3
"""Agente semanal: datos homologados de eficiencia energética (URSEA).

Descarga del Registro de Etiquetado Vehicular de URSEA el CSV de eléctricos puros
(y de híbridos con recarga exterior) con rendimiento (km/kWh), batería y autonomía,
lo guarda en data/ursea.json y completa el catálogo (data/modelos.json) donde
encuentra coincidencia por marca y modelo. No pisa datos que ya tienen fuente propia,
salvo el consumo, que pasa a ser el homologado.
"""
import csv
import io
import json
import re
import sys
import unicodedata
import urllib.parse
import urllib.request
import http.cookiejar
from datetime import datetime, timezone
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
SALIDA = RAIZ / "data" / "ursea.json"
MODELOS = RAIZ / "data" / "modelos.json"
URL = "https://ursea.gub.uy/URSEA-web/pages/etiquetadoVehicular/productosEtiquetadoVehicular.xhtml"
TIPOS = {"4": "BEV", "3": "PHEV"}


def descargar_csv(tipo):
    cj = http.cookiejar.CookieJar()
    op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
    op.addheaders = [("User-Agent", "Mozilla/5.0 (VoltUY-bot)")]
    form = lambda html: {
        "vs": re.search(r'name="javax.faces.ViewState"[^>]*value="([^"]+)"', html).group(1),
        "buscar": re.search(r'<button id="(frmProductos:j_idt\d+)"', html).group(1),
    }
    base = {"frmProductos": "frmProductos", "frmProductos:tipoProducto": tipo, "frmProductos:marca": "",
            "frmProductos:modelo": "", "frmProductos:empresa": "", "frmProductos:nroAutorizacion": ""}
    html = op.open(URL, timeout=60).read().decode("utf-8", "ignore")
    f = form(html)
    post = lambda d: op.open(urllib.request.Request(URL, data=urllib.parse.urlencode(d).encode(),
                             headers={"Content-Type": "application/x-www-form-urlencoded"}), timeout=120).read()
    html = post({**base, f["buscar"]: "", "javax.faces.ViewState": f["vs"]}).decode("utf-8", "ignore")
    vs = re.search(r'name="javax.faces.ViewState"[^>]*value="([^"]+)"', html).group(1)
    exp = re.search(r'<button id="(frmProductos:productosTable:j_idt\d+)"[^>]*>\s*<span[^>]*>Exportar CSV', html).group(1)
    crudo = post({**base, exp: "", "javax.faces.ViewState": vs})
    for enc in ("utf-8-sig", "latin-1"):
        try:
            return crudo.decode(enc)
        except UnicodeDecodeError:
            continue


def num(x):
    try:
        return float(str(x).replace(",", ".").strip())
    except ValueError:
        return None


def norm(s):
    s = unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def leer(texto, tipo):
    filas = list(csv.reader(io.StringIO(texto)))
    cab = [norm(c) for c in filas[0]]
    col = lambda clave: next((i for i, c in enumerate(cab) if clave in c), None)
    i = {k: col(k) for k in ["marca", "modelo", "potencia", "capacidad", "rendimiento", "autonomia", "registro", "fecha registro"]}
    salida = {}
    for f in filas[1:]:
        if len(f) < len(cab):
            continue
        marca, modelo = f[i["marca"]].strip(), f[i["modelo"]].strip()
        clave = (norm(marca), norm(modelo))
        if clave in salida:  # el mismo modelo aparece una vez por importador
            continue
        rend = num(f[i["rendimiento"]]) if i["rendimiento"] is not None else None
        if tipo != "BEV" or not rend or not 3 <= rend <= 15:  # en enchufables el valor no es km/kWh
            rend = None
        salida[clave] = {
            "marca": marca, "modelo": modelo, "tipo": tipo,
            "potencia_kw": num(f[i["potencia"]]) if i["potencia"] is not None else None,
            "bateria_kwh": num(f[i["capacidad"]]) if i["capacidad"] is not None else None,
            "rendimiento_km_kwh": rend,
            "consumo_kwh_100km": round(100 / rend, 1) if rend else None,
            "autonomia_km": num(f[i["autonomia"]]) if i["autonomia"] is not None else None,
            "registro": f[i["registro"]].strip() if i["registro"] is not None else None,
        }
    return list(salida.values())


def coincide(m, u):
    """Coincidencia entre un modelo del catálogo y un registro de URSEA."""
    if norm(m["marca"]) != norm(u["marca"]):
        return 0
    nm, nu = norm(m["modelo"].split(" / ")[0]), norm(u["modelo"])
    if not re.search(r"\b" + re.escape(nm) + r"\b", nu):
        return 0
    puntos = 10
    propio = set(norm(m["modelo"] + " " + (m.get("version") or "")).split())
    for sub in ["urban", "mini", "surf", "max", "plus", "pro", "sport"]:  # submodelos distintos
        if sub in nu.split() and sub not in propio and sub not in nm.split():
            puntos -= 6
    for p in norm(m.get("version") or "").split():
        if len(p) > 1 and re.search(r"\b" + re.escape(p) + r"\b", nu):
            puntos += 3
    if m.get("bateria_kwh") and u.get("bateria_kwh"):
        dif = abs(m["bateria_kwh"] - u["bateria_kwh"])
        puntos += 4 if dif <= 2 else (-20 if dif > 5 else 0)  # baterías muy distintas: probablemente otra versión
    return max(puntos, 1)


def main():
    import time
    if "--offline" in sys.argv:  # reasocia el catálogo con el último registro descargado
        asociar(json.loads(SALIDA.read_text(encoding="utf-8"))["registros"])
        return
    registros = []
    for tipo, etiqueta in TIPOS.items():
        for intento in range(3):
            try:
                registros += leer(descargar_csv(tipo), etiqueta)
                break
            except Exception as e:
                print(f"[aviso] URSEA tipo {etiqueta}, intento {intento + 1}: {e}", file=sys.stderr)
                time.sleep(10)
        else:
            print("[aviso] Falló una descarga de URSEA; se conserva lo anterior.", file=sys.stderr)
            return
    if not registros:
        print("[aviso] Sin datos de URSEA; se conserva lo anterior.", file=sys.stderr)
        return
    hoy = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    SALIDA.write_text(json.dumps({"actualizado": hoy, "fuente": "URSEA · Registro de Etiquetado Vehicular", "url": URL,
                                  "nota": "Rendimiento homologado según norma UNIT 1130 (ciclo de ensayo estandarizado).",
                                  "registros": registros}, ensure_ascii=False, indent=1), encoding="utf-8")
    asociar(registros)


def asociar(registros):
    cat = json.loads(MODELOS.read_text(encoding="utf-8"))
    asociados = 0
    for m in cat["modelos"]:
        cands = [(coincide(m, u), u) for u in registros if u["tipo"] == m["tipo"]]
        cands = [c for c in cands if c[0]]
        if not cands:
            continue
        p, u = max(cands, key=lambda c: c[0])
        m["ursea"] = {"modelo": u["modelo"], "registro": u["registro"], "rendimiento_km_kwh": u["rendimiento_km_kwh"],
                      "consumo_kwh_100km": u["consumo_kwh_100km"], "bateria_kwh": u["bateria_kwh"], "autonomia_km": u["autonomia_km"],
                      "certeza": "alta" if p >= 13 else ("media" if p >= 10 else "baja")}
        if m["ursea"]["certeza"] == "baja":
            continue  # se guarda como referencia, pero no completa datos
        if m.get("bateria_kwh") is None and u["bateria_kwh"]:
            m["bateria_kwh"] = u["bateria_kwh"]
        if m.get("autonomia_km") is None and u["autonomia_km"]:
            m["autonomia_km"], m["ciclo"] = u["autonomia_km"], "URSEA"
        asociados += 1
    MODELOS.write_text(json.dumps(cat, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"URSEA: {len(registros)} modelos registrados · {asociados} asociados al catálogo")
    return asociados


if __name__ == "__main__":
    main()
