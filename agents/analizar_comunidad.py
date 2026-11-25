#!/usr/bin/env python3
"""Agente semanal de la comunidad AutosEléctricosUY.

Lee las experiencias y los comentarios aprobados (endpoint /api/admin/export, con ADMIN_TOKEN),
extrae consumos mencionados en texto libre (kWh/100 km, km/kWh, autonomía), clasifica problemas
con una taxonomía fija y escribe data/comunidad.json, que alimenta las infografías del sitio.

Reglas:
  * Nunca se publican nombres ni textos completos: solo agregados y frases generadas.
  * Un promedio por modelo se publica solo con 3 o más aportes (lo controla también el sitio).
  * Solo datos propios del sitio (usuarios que aportan en AutosEléctricosUY). No se leen otras redes.

Uso:
  SITIO_URL=https://voltuy.com.uy ADMIN_TOKEN=... python agents/analizar_comunidad.py
  python agents/analizar_comunidad.py --archivo export.json      # prueba local
"""
import argparse, json, os, re, statistics, sys, urllib.request
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path

R = Path(__file__).resolve().parent.parent
MIN_N = 3

# Taxonomía de problemas (mismas claves que el formulario del sitio y la API)
PROBLEMAS = {
    "carga_publica": r"no carg(a|aba|ó)|fuera de servicio|cargador (roto|no funciona|andaba mal)|no anda(ba)? el cargador|marcaba disponible",
    "espera_carga": r"\bcola\b|esper(é|e|ar|amos)|ocupad[oa]s?|saturad[oa]s?",
    "posventa": r"\bservice\b|posventa|post ?venta|taller|garant[ií]a",
    "repuestos": r"repuesto",
    "software": r"\bapp\b|aplicaci[oó]n|software|actualizaci[oó]n|señal d[eé]bil|pantalla|conectividad",
    "bateria": r"autonom[ií]a (real )?(menor|baja|corta)|rinde menos|degradaci[oó]n|bater[ií]a (se )?(baja|degrad)",
    "cargador_casa": r"wallbox|cargador (en|de) (casa|mi casa)|electricista|potencia contratada|instalaci[oó]n",
    "terminaciones": r"ruido|terminaci[oó]n|traqueteo|grill[oa]",
    "entrega": r"entrega|me lo entregaron|demor(a|ó) (en )?la entrega",
}
ETIQ = {"carga_publica": "cargadores públicos fuera de servicio", "espera_carga": "esperas para cargar", "posventa": "posventa / service", "repuestos": "demora de repuestos",
        "software": "app, software o conectividad", "bateria": "autonomía menor a la esperada", "cargador_casa": "instalación del cargador en casa",
        "terminaciones": "ruidos o terminaciones", "entrega": "demora en la entrega"}
RE_KWH100 = re.compile(r"(\d{1,2}(?:[.,]\d)?)\s*(?:kwh|kw/h|kw)\s*(?:/|cada|c/|por)\s*100", re.I)
RE_KMKWH = re.compile(r"(\d{1,2}(?:[.,]\d{1,2})?)\s*km\s*(?:/|por|x)\s*kwh", re.I)
RE_AUTON = re.compile(r"(?:autonom[ií]a|hago|hice|rinde|llego a)\D{0,25}(\d{2,3})\s*km", re.I)


def num(s):
    return float(s.replace(",", "."))


def cargar_export(args):
    if args.archivo:
        return json.loads(Path(args.archivo).read_text(encoding="utf-8"))
    url, token = os.environ.get("SITIO_URL"), os.environ.get("ADMIN_TOKEN")
    if not (url and token):
        print("Faltan SITIO_URL y ADMIN_TOKEN: no hay base para analizar todavía. No se modifica nada.")
        sys.exit(0)
    req = urllib.request.Request(url.rstrip("/") + "/api/admin/export", headers={"Authorization": f"Bearer {token}", "User-Agent": "AutosElectricosUY-agente/1.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def detectar_modelo(texto, modelos):
    t = texto.lower()
    mejores = [m for m in modelos if m["modelo"].lower() in t]
    if not mejores:
        return None
    return max(mejores, key=lambda m: len(m["modelo"]))["id"]


def extraer(texto):
    """Devuelve (consumos kWh/100 km mencionados, problemas detectados)."""
    vals = [num(x) for x in RE_KWH100.findall(texto)]
    vals += [round(100 / num(x), 1) for x in RE_KMKWH.findall(texto) if 3 <= num(x) <= 15]
    vals = [v for v in vals if 6 <= v <= 40]
    probs = [k for k, rx in PROBLEMAS.items() if re.search(rx, texto, re.I)]
    return vals, probs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--archivo")
    args = ap.parse_args()
    exp = cargar_export(args)
    modelos = json.loads((R / "data/modelos.json").read_text(encoding="utf-8"))["modelos"]
    nombres = {m["id"]: f'{m["marca"]} {m["modelo"]} {m.get("version") or ""}'.strip() for m in modelos}
    coma = lambda x: f"{x:.1f}".replace(".", ",")
    temas = {t["id"]: t for t in json.loads((R / "data/debates.json").read_text(encoding="utf-8"))["temas"]}

    experiencias = exp.get("experiencias", [])
    raw = [{"modelo": e["modelo"], "kwh100": e["kwh100"], "uso": e.get("uso"), "estacion": e.get("estacion"), "nota": e.get("nota"),
            "problemas": [p for p in (e.get("problemas") or "").split(",") if p]} if isinstance(e.get("problemas"), (str, type(None))) else
           {k: e.get(k) for k in ("modelo", "kwh100", "uso", "estacion", "nota", "problemas")} for e in experiencias]

    # Texto libre: comentarios de debates + textos aprobados de experiencias
    textos = [(c["tema"], c["texto"]) for c in exp.get("comentarios", [])]
    textos += [("_exp:" + e["modelo"], e["texto"]) for e in experiencias if e.get("texto")]
    menciones = defaultdict(list)
    por_tema = defaultdict(lambda: {"n": 0, "problemas": Counter(), "consumos": []})
    for tema, texto in textos:
        vals, probs = extraer(texto)
        mid = tema[5:] if tema.startswith("_exp:") else detectar_modelo(texto, modelos)
        if mid and vals:
            menciones[mid] += vals
        if not tema.startswith("_exp:"):
            pt = por_tema[tema]; pt["n"] += 1; pt["problemas"].update(probs); pt["consumos"] += vals

    votos = defaultdict(dict)
    for v in exp.get("votos", []):
        votos[v["tema"]][v["opcion"]] = v["n"]

    # Resúmenes por debate (frases armadas solo con agregados; el agente editorial de Claude puede reescribirlas)
    debates = {}
    for tid, pt in por_tema.items():
        if pt["n"] < MIN_N or tid not in temas:
            continue
        partes = [f'{pt["n"]} comentarios aprobados.']
        v = votos.get(tid)
        if v:
            tot = sum(v.values()); op, n = max(v.items(), key=lambda x: x[1])
            partes.append(f'La opción más votada es "{op}" ({round(n / tot * 100)}% de {tot} votos).')
        top = [k for k, _ in pt["problemas"].most_common(2)]
        if top:
            etiquetas = {"carga_publica": "cargadores fuera de servicio", "espera_carga": "esperas para cargar", "posventa": "la posventa", "repuestos": "los repuestos",
                         "software": "la app y el software", "bateria": "la autonomía", "cargador_casa": "la instalación en casa", "terminaciones": "ruidos y terminaciones", "entrega": "las demoras de entrega"}
            partes.append("Lo que más se menciona: " + " y ".join(etiquetas[k] for k in top) + ".")
        if len(pt["consumos"]) >= MIN_N:
            partes.append("Los consumos citados rondan " + f'{statistics.median(pt["consumos"]):.1f}'.replace(".", ",") + " kWh/100 km.")
        debates[tid] = {"n": pt["n"], "resumen": " ".join(partes)}

    # Puntos destacados de la semana
    puntos = []
    por_modelo = defaultdict(list)
    for e in raw:
        if 6 <= (e["kwh100"] or 0) <= 40:
            por_modelo[e["modelo"]].append(e["kwh100"])
    for mid, vals in sorted(por_modelo.items(), key=lambda x: -len(x[1])):
        if len(vals) < MIN_N:
            continue
        m = next((x for x in modelos if x["id"] == mid), None)
        hom = m and m.get("ursea") and m["ursea"].get("certeza") != "baja" and m["ursea"].get("consumo_kwh_100km")
        med = statistics.median(vals)
        txt = f'{nombres.get(mid, mid)}: {len(vals)} dueños reportan una mediana de {coma(med)} kWh/100 km'
        if hom:
            txt += f' ({(med / hom - 1) * 100:+.0f}% frente al homologado de URSEA)'
        puntos.append(txt + ".")
        if len(puntos) >= 3:
            break
    probs_tot = Counter(p for e in raw for p in e["problemas"])
    if raw and probs_tot:
        k, n = probs_tot.most_common(1)[0]
        puntos.append(f"El problema más reportado es «{ETIQ[k]}»: lo menciona el {round(n / len(raw) * 100)}% de los dueños.")

    salida = {
        "actualizado": date.today().isoformat(),
        "nota": "Generado por agents/analizar_comunidad.py con datos aportados por usuarios de AutosEléctricosUY. Promedios con 3 o más aportes.",
        "experiencias_raw": raw,
        "votos": votos,
        "debates": debates,
        "menciones": {mid: {"n": len(v), "mediana": round(statistics.median(v), 1)} for mid, v in menciones.items() if len(v) >= MIN_N},
        "resumen": {"titular": "Lo que dejó la semana en la comunidad", "puntos": puntos} if puntos else None,
    }
    (R / "data/comunidad.json").write_text(json.dumps(salida, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"comunidad.json: {len(raw)} experiencias, {len(textos)} textos, {len(debates)} debates resumidos, {len(puntos)} puntos.")


if __name__ == "__main__":
    main()
