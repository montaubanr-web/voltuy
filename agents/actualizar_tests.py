#!/usr/bin/env python3
"""Agente diario de tests (pruebas de manejo) de AutosEléctricos.uy.

- Uruguay: pruebas publicadas por medios uruguayos (vía Google Noticias).
- Internacional: InsideEVs (test drives y first drives) y pruebas en español de otros países.
Asocia cada test a un modelo del catálogo cuando el título lo menciona.
"""
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from actualizar_noticias import descargar, parsear, clave  # noqa: E402

RAIZ = Path(__file__).resolve().parent.parent
SALIDA = RAIZ / "data" / "tests.json"
MODELOS = RAIZ / "data" / "modelos.json"
MAX = 120

FUENTES = {
    "uruguay": [
        ("Google: pruebas Autoblog", "https://news.google.com/rss/search?q=site:autoblog.com.uy+(prueba+OR+probamos+OR+contacto)&hl=es-419&gl=UY&ceid=UY:es-419"),
        ("Google: prueba eléctrico Uruguay", "https://news.google.com/rss/search?q=prueba+auto+el%C3%A9ctrico+Uruguay&hl=es-419&gl=UY&ceid=UY:es-419"),
    ],
    "internacional": [
        ("InsideEVs", "https://insideevs.com/rss/category/test-drives/"),
        ("InsideEVs", "https://insideevs.com/rss/category/first-drives/"),
        ("Google: prueba coche eléctrico (España)", "https://news.google.com/rss/search?q=prueba+coche+el%C3%A9ctrico+when:30d&hl=es&gl=ES&ceid=ES:es"),
    ],
}
ES_TEST = re.compile(r"^(prueba|probamos|contacto|primer contacto|manejamos)\b|\bprueba (del|de la|de autonom|a fondo)|a prueba:|"
                     r"\b(test drive|first drive|drive review|review|driven|range test)\b", re.I)
MEDIOS_UY = ("autoblog", "observador", "montevideo portal", "el país uruguay", "el pais uruguay", "motorlider",
             "subrayado", "la diaria", "teledoce", "telemundo", "búsqueda", "busqueda", "ámbito uruguay", "carburando")
ES_ELEC = re.compile(r"el[eé]ctric|electric|\bev\b|\bbev\b|phev|enchufable|kwh|e-tron|ioniq|tesla|byd", re.I)


def tipo_de(titulo):
    t = titulo.lower()
    if "autonom" in t or "range test" in t:
        return "Autonomía real"
    if "contacto" in t or "first drive" in t:
        return "Primer contacto"
    if "compar" in t or " vs " in t:
        return "Comparativa"
    return "Prueba"


def asociar(titulo, modelos):
    t = titulo.lower()
    hibrido = re.search(r"\b(reev|phev|dm-i|em-i|híbrido|hybrid)\b", t)
    mejor, puntaje = None, 0
    for m in modelos:
        if hibrido and m["tipo"] == "BEV":
            continue
        nombre = m["modelo"].lower().split(" / ")[0]
        if m["marca"].lower() in t and re.search(r"\b" + re.escape(nombre) + r"\b", t):
            p = len(nombre) * 10
            for palabra in re.findall(r"[a-z0-9+]+", (m.get("version") or "").lower()):
                if len(palabra) > 1 and re.search(r"\b" + re.escape(palabra) + r"\b", t):
                    p += 5
            if p > puntaje:
                mejor, puntaje = m["id"], p
    return mejor


def main():
    modelos = json.loads(MODELOS.read_text(encoding="utf-8"))["modelos"]
    datos = json.loads(SALIDA.read_text(encoding="utf-8")) if SALIDA.exists() else {"uruguay": [], "internacional": []}
    nuevas = 0
    for lista, fuentes in FUENTES.items():
        existentes = datos.get(lista, [])
        vistos = {clave(x) for x in existentes} | {x["url"] for x in existentes}
        for nombre, url in fuentes:
            try:
                items = list(parsear(descargar(url), nombre))
            except Exception as e:
                print(f"[aviso] {nombre}: {e}", file=sys.stderr)
                continue
            for n in items:
                titulo = n["titulo"]
                if not ES_TEST.search(titulo) or not ES_ELEC.search(titulo) and "insideevs" not in url:
                    continue
                if lista == "uruguay" and not any(x in n["fuente"].lower() for x in MEDIOS_UY):
                    continue
                if clave(n) in vistos or n["url"] in vistos:
                    continue
                medio = n["fuente"].split(",")[0].replace("Autoblog Uruguay", "Autoblog").strip()
                item = {"fecha": n["fecha"], "titulo": titulo, "medio": medio, "url": n["url"],
                        "modelo_id": asociar(titulo, modelos), "tipo": tipo_de(titulo)}
                if lista == "internacional":
                    item["pais"] = "España" if "gl=ES" in url else None
                existentes.append(item)
                vistos |= {clave(n), n["url"]}
                nuevas += 1
        existentes.sort(key=lambda x: x["fecha"], reverse=True)
        datos[lista] = existentes[:MAX]
    from datetime import datetime, timezone
    datos["actualizado"] = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    SALIDA.write_text(json.dumps(datos, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"Tests nuevos: {nuevas}")


if __name__ == "__main__":
    main()
