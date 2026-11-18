#!/usr/bin/env python3
"""Agente diario: precios de combustibles publicados por ANCAP.

Lee la ficha de cada producto en ancap.com.uy y guarda el "Precio máximo al público
decretado por Poder Ejecutivo" (impuestos incluidos) en data/combustible.json.
Si una ficha cambia de formato o no responde, conserva el último valor de ese producto.
"""
import html
import json
import re
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
SALIDA = RAIZ / "data" / "combustible.json"
PRODUCTOS = {  # clave: (nombre, id de la ficha en ancap.com.uy)
    "super95": ("Nafta Súper 95", 1636),
    "premium97": ("Nafta Premium 97", 1637),
    "gasoil10s": ("Gasoil 10-S", 1641),
    "gasoil50s": ("Gasoil 50-S", 1642),
}
PATRON = re.compile(r"Precio m[aá]ximo al p[uú]blico decretado por Poder Ejecutivo\s*\$\s*([\d.,]+)")


def url_de(pid):
    return f"https://www.ancap.com.uy/{pid}/1/precios-de-venta-al-publico.html"


def leer(pid):
    req = urllib.request.Request(url_de(pid), headers={"User-Agent": "VoltUY-bot/1.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        texto = html.unescape(re.sub(r"<[^>]+>", " ", r.read().decode("utf-8", errors="ignore")))
    m = PATRON.search(re.sub(r"\s+", " ", texto))
    if not m:
        raise ValueError("no encontré el precio en la ficha")
    valor = float(m.group(1).replace(",", "."))
    if not 20 < valor < 300:
        raise ValueError(f"precio fuera de rango: {valor}")
    return valor


def main():
    datos = json.loads(SALIDA.read_text(encoding="utf-8")) if SALIDA.exists() else {}
    previos = {p["clave"]: p for p in datos.get("productos", [])}
    hoy = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    productos = []
    for clave, (nombre, pid) in PRODUCTOS.items():
        prev = previos.get(clave, {})
        try:
            precio = leer(pid)
        except Exception as e:
            print(f"[aviso] {nombre}: {e}. Se mantiene el valor anterior.", file=sys.stderr)
            if prev:
                productos.append(prev)
            continue
        item = {"clave": clave, "producto": nombre, "precio_uyu": precio, "verificado": hoy, "url": url_de(pid)}
        if prev and prev.get("precio_uyu") != precio:
            item["cambio_detectado"] = hoy
        elif prev.get("cambio_detectado"):
            item["cambio_detectado"] = prev["cambio_detectado"]
        productos.append(item)
        print(f"{nombre}: $ {precio}")
    if not productos:
        return
    datos = {"fuente": "ANCAP", "detalle": "Precio máximo al público decretado por el Poder Ejecutivo, impuestos incluidos",
             "verificado": hoy, "productos": productos}
    sup = next((p for p in productos if p["clave"] == "super95"), None)
    if sup:  # atajo que usa la calculadora
        datos.update({"producto": sup["producto"], "precio_uyu": sup["precio_uyu"], "url": sup["url"]})
    SALIDA.write_text(json.dumps(datos, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
