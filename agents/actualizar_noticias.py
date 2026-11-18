#!/usr/bin/env python3
"""Agente diario de noticias de VoltUY (gratis, sin IA).

Lee los feeds RSS de agents/fuentes.json, filtra por palabras clave, clasifica por
categoría, elimina duplicados y actualiza data/noticias.json conservando las
noticias anteriores. Solo usa la biblioteca estándar de Python.

Uso:  python agents/actualizar_noticias.py
"""
import json
import re
import sys
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
FUENTES = RAIZ / "agents" / "fuentes.json"
SALIDA = RAIZ / "data" / "noticias.json"
MAX_POR_LISTA = 80

CATEGORIAS = [
    ("Normativa", r"\b(imesi|decreto|impuesto|ley|mef|patente|sucive|arancel|subsidio|regulaci|intendente)"),
    ("Carga", r"\b(carga|cargador|electrolinera|charging|charger|supercharger|v2g)"),
    ("Precios", r"\b(precio|rebaja|baja de precio|descuento|bono|price|cuesta)"),
    ("Lanzamiento", r"\b(lanza|lanzamiento|presenta|debut|launch|unveil|reveal|pre-order|preventa)"),
    ("Test", r"\b(prueba|probamos|test|review|manejamos|first drive)"),
    ("Mercado", r"\b(venta|ventas|vendieron|mercado|acau|récord|record|sales|cuota|share|puerto)"),
    ("Batería", r"\b(batería|battery|celda|solid-state)"),
]


def descargar(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "VoltUY-bot/1.0 (+https://voltuy.example)"})
    with urllib.request.urlopen(req, timeout=25) as r:
        return r.read()


def texto(el, tag):
    hijo = el.find(tag)
    return (hijo.text or "").strip() if hijo is not None and hijo.text else ""


def parsear(xml: bytes, fuente: str):
    raiz = ET.fromstring(xml)
    items = raiz.findall(".//item")
    for it in items:
        titulo = texto(it, "title")
        link = texto(it, "link")
        fecha_raw = texto(it, "pubDate")
        origen = texto(it, "source") or fuente
        # Google Noticias agrega " - Medio" al final del título
        if fuente.startswith("Google") and " - " in titulo:
            titulo, origen = titulo.rsplit(" - ", 1)
        try:
            fecha = parsedate_to_datetime(fecha_raw).astimezone(timezone.utc).strftime("%Y-%m-%d")
        except Exception:
            fecha = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        if titulo and link:
            yield {"fecha": fecha, "titulo": titulo.strip(), "resumen": "", "fuente": origen.strip(), "url": link}


def categoria(titulo: str) -> str:
    t = titulo.lower()
    for nombre, patron in CATEGORIAS:
        if re.search(patron, t):
            return nombre
    return "General"


def clave(n):
    return re.sub(r"\W+", "", n["titulo"].lower())[:80]


def main():
    cfg = json.loads(FUENTES.read_text(encoding="utf-8"))
    palabras = [p.lower() for p in cfg["palabras_clave"]]
    datos = json.loads(SALIDA.read_text(encoding="utf-8")) if SALIDA.exists() else {"uruguay": [], "internacional": []}
    nuevas_total = 0

    for lista in ("uruguay", "internacional"):
        existentes = datos.get(lista, [])
        vistos = {clave(n) for n in existentes} | {n["url"] for n in existentes}
        for f in cfg[lista]:
            try:
                items = list(parsear(descargar(f["url"]), f["nombre"]))
            except Exception as e:  # una fuente caída no frena al resto
                print(f"[aviso] {f['nombre']}: {e}", file=sys.stderr)
                continue
            for n in items:
                if f.get("filtrar") and not any(p in f" {n['titulo'].lower()}" for p in palabras):
                    continue
                if clave(n) in vistos or n["url"] in vistos:
                    continue
                n["categoria"] = categoria(n["titulo"])
                existentes.append(n)
                vistos |= {clave(n), n["url"]}
                nuevas_total += 1
        existentes.sort(key=lambda n: n["fecha"], reverse=True)
        datos[lista] = existentes[:MAX_POR_LISTA]

    datos["actualizado"] = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    SALIDA.write_text(json.dumps(datos, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"Noticias nuevas: {nuevas_total}")


if __name__ == "__main__":
    main()
