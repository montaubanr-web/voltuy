#!/usr/bin/env python3
"""Agente de videos de VoltUY (lunes y jueves).

Busca en YouTube (API oficial YouTube Data API v3, clave gratuita YT_API_KEY) videos nuevos sobre
vehículos eléctricos: Uruguay (últimos 14 días) e internacional (últimos 7 días, los más vistos).
Escribe data/videos.json, que alimenta el recuadro "Lo que se habla esta semana".

Reglas (políticas de YouTube API Services):
  * Solo se muestran título, canal, miniatura, fecha y enlace al video, con atribución a YouTube.
  * No se leen ni analizan comentarios, ni se calculan métricas propias.
  * Los datos de la API se guardan como máximo 30 días: lo más viejo se borra en cada corrida.
  * El resumen automático sale de la descripción del canal (marcado como tal). La tarea de Claude
    lo reemplaza por un resumen propio de una línea (campo resumen_editorial).

Cuota: ~10 búsquedas x 100 unidades + 2 consultas de detalle = ~1.000 de las 10.000 diarias gratuitas.
"""
import json, os, re, sys, urllib.parse, urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

R = Path(__file__).resolve().parent.parent
SALIDA = R / "data/videos.json"
API = "https://www.googleapis.com/youtube/v3/"
AHORA = datetime.now(timezone.utc)
MAX_UY, MAX_INT, DIAS_GUARDA = 12, 8, 30

CONSULTAS_UY = ["auto eléctrico Uruguay", "vehículo eléctrico Uruguay", "BYD Uruguay", "cargador eléctrico Uruguay UTE",
                "prueba auto eléctrico Montevideo", "eléctricos Uruguay precios"]
CONSULTAS_INT = [("prueba coche eléctrico", "es"), ("auto eléctrico review", "es"), ("electric car review", "en"), ("EV news this week", "en")]
RE_UY = re.compile(r"uruguay|montevideo|punta del este|maldonado|canelones|colonia|paysand|salto|rivera|\bute\b|\buy\b", re.I)
RE_EV = re.compile(r"el[eé]ctric|\bev\b|\bbev\b|byd|tesla|kwh|cargador|carga r[aá]pida|bater[ií]a|autonom[ií]a|electric", re.I)


def api(endpoint, **params):
    params["key"] = os.environ["YT_API_KEY"]
    url = API + endpoint + "?" + urllib.parse.urlencode(params)
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "VoltUY-agente/1.0"}), timeout=30) as r:
        return json.load(r)


def buscar(q, dias, orden, lang, region=None):
    p = dict(part="snippet", type="video", q=q, maxResults=25, order=orden, relevanceLanguage=lang,
             publishedAfter=(AHORA - timedelta(days=dias)).strftime("%Y-%m-%dT%H:%M:%SZ"), safeSearch="strict")
    if region:
        p["regionCode"] = region
    try:
        return api("search", **p).get("items", [])
    except Exception as e:
        print(f"[aviso] búsqueda '{q}': {e}", file=sys.stderr)
        return []


def duracion_seg(iso):
    m = re.match(r"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?", iso or "")
    return sum(int(x or 0) * f for x, f in zip(m.groups(), (3600, 60, 1))) if m else 0


def detalles(ids):
    out = {}
    for i in range(0, len(ids), 50):
        try:
            for it in api("videos", part="statistics,contentDetails", id=",".join(ids[i:i + 50])).get("items", []):
                out[it["id"]] = {"vistas": int(it.get("statistics", {}).get("viewCount", 0)),
                                 "duracion": duracion_seg(it.get("contentDetails", {}).get("duration"))}
        except Exception as e:
            print(f"[aviso] detalles: {e}", file=sys.stderr)
    return out


def resumen_auto(desc):
    t = re.sub(r"https?://\S+|#\w+|[@]\w+", "", desc or "")
    t = re.sub(r"[^\w\s.,;:¿?¡!()%$/\-áéíóúñüÁÉÍÓÚÑÜ]", "", t)
    t = re.sub(r"\s+", " ", t).strip()
    frase = re.split(r"(?<=[.!?])\s", t)[0] if t else ""
    return (frase[:157] + "…") if len(frase) > 160 else frase


def modelo_de(titulo, catalogo):
    t = titulo.lower()
    cand = [m for m in catalogo if m["modelo"].lower() in t and (m["marca"].lower() in t or len(m["modelo"]) > 4)]
    return max(cand, key=lambda m: len(m["modelo"]))["id"] if cand else None


def item(s, catalogo):
    sn, vid = s["snippet"], s["id"]["videoId"]
    th = sn.get("thumbnails", {})
    return {"id": vid, "url": f"https://www.youtube.com/watch?v={vid}", "titulo": sn["title"].replace("&quot;", '"').replace("&#39;", "'").replace("&amp;", "&"),
            "canal": sn["channelTitle"], "fecha": sn["publishedAt"][:10], "miniatura": (th.get("medium") or th.get("default") or {}).get("url"),
            "resumen": resumen_auto(sn.get("description")), "modelo_id": modelo_de(sn["title"], catalogo), "obtenido": AHORA.strftime("%Y-%m-%d")}


def main():
    if not os.environ.get("YT_API_KEY"):
        print("Falta YT_API_KEY: no se buscan videos. No se modifica nada.")
        return
    catalogo = json.loads((R / "data/modelos.json").read_text(encoding="utf-8"))["modelos"]
    previo = json.loads(SALIDA.read_text(encoding="utf-8")) if SALIDA.exists() else {"uruguay": [], "internacional": []}
    corte = (AHORA - timedelta(days=DIAS_GUARDA)).strftime("%Y-%m-%d")

    uy, intl = {}, {}
    for q in CONSULTAS_UY:
        for s in buscar(q, 14, "date", "es", "UY"):
            sn = s["snippet"]; txt = sn["title"] + " " + sn.get("description", "") + " " + sn["channelTitle"]
            if RE_UY.search(txt) and RE_EV.search(txt):
                uy[s["id"]["videoId"]] = item(s, catalogo)
    for q, lang in CONSULTAS_INT:
        for s in buscar(q, 7, "relevance", lang):
            sn = s["snippet"]; vid = s["id"]["videoId"]
            if vid not in uy and RE_EV.search(sn["title"] + " " + sn.get("description", "")):
                intl[vid] = item(s, catalogo)
    det = detalles(list(uy) + list(intl))
    for d in (uy, intl):
        for vid in list(d):
            info = det.get(vid, {})
            if info.get("duracion", 999) < 75:  # descarta shorts
                del d[vid]; continue
            d[vid]["vistas"] = info.get("vistas")

    def fusionar(nuevos, viejos, maximo, clave):
        ed = {v["id"]: v.get("resumen_editorial") for v in viejos if v.get("resumen_editorial")}
        todos = {v["id"]: v for v in viejos if v.get("obtenido", v["fecha"]) >= corte}
        todos.update(nuevos)
        for vid, txt in ed.items():
            if vid in todos:
                todos[vid]["resumen_editorial"] = txt
        return sorted(todos.values(), key=clave, reverse=True)[:maximo]

    salida = {
        "actualizado": AHORA.strftime("%Y-%m-%d"),
        "nota": "Videos de YouTube (YouTube Data API). Se muestran con atribución y enlace; los datos se renuevan o borran a los 30 días.",
        "uruguay": fusionar(uy, previo.get("uruguay", []), MAX_UY, lambda v: v["fecha"]),
        "internacional": fusionar(intl, previo.get("internacional", []), MAX_INT, lambda v: (v["fecha"] >= (AHORA - timedelta(days=7)).strftime("%Y-%m-%d"), v.get("vistas") or 0)),
    }
    SALIDA.write_text(json.dumps(salida, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"videos.json: {len(salida['uruguay'])} de Uruguay · {len(salida['internacional'])} internacionales")


if __name__ == "__main__":
    main()
