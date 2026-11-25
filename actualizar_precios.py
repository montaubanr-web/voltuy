#!/usr/bin/env python3
"""Agente diario de precios y modelos de AutosEléctricosUY.

Fuentes, en orden de prioridad:
  1. Sitios de los importadores oficiales (agents/fuentes/importadores.json).
  2. Tiendas oficiales de MercadoLibre Uruguay (API oficial; requiere ML_CLIENT_ID y ML_CLIENT_SECRET).
  3. mielectrico.uy/explore: solo control cruzado. Nunca cambia un precio ni agrega un modelo por sí solo.

Reglas:
  * Un precio se actualiza solo si viene de 1 o 2 y cambia menos de 15 %. Si cambia más, queda como alerta.
  * Los modelos que aparecen en 1 o 2 y no están en el catálogo quedan como "posibles modelos nuevos".
  * Un modelo que deja de verse en todas las fuentes 14 días seguidos queda como "posible discontinuado".
  * Todo lo que necesita una persona va a data/precios_revision.json (el workflow abre un aviso en GitHub).

Uso:
  python agents/actualizar_precios.py                      # todas las fuentes disponibles
  python agents/actualizar_precios.py --sin-escribir       # prueba: no modifica el catálogo
  python agents/actualizar_precios.py --html-mielectrico archivo.html   # prueba con una copia local
"""
import argparse, html, json, os, re, sys, time, unicodedata, urllib.parse, urllib.request
from datetime import datetime, timezone
from pathlib import Path

R = Path(__file__).resolve().parent.parent
MODELOS = R / "data/modelos.json"
ESTADO = R / "data/precios_estado.json"
REVISION = R / "data/precios_revision.json"
UA = {"User-Agent": "AutosElectricosUY-agente/1.0 (+https://github.com/voltuy)"}
UMBRAL = 0.15
DIAS_DISCONTINUADO = 14
HOY = datetime.now(timezone.utc).strftime("%Y-%m-%d")

# Categoría "Autos y Camionetas" de MercadoLibre Uruguay (configurable por si cambia)
ML_CATEGORIA = os.environ.get("ML_CATEGORIA", "MLU1744")
# Variantes de escritura de nombres de modelo entre fuentes (se aplican sobre el texto normalizado y compacto)
ALIAS_MODELO = {"nami": "nammi", "so5": "s05", "s7": "s07", "wonder": "ewonder", "newe2": "e2", "eewonder": "ewonder", "chassis": "chasis"}
CLAVES_VERSION = {"plus", "max", "pro", "brabus", "flagship", "awd", "performance", "premium", "luxury", "comfort", "standard",
                  "long", "reev", "gt", "jcw", "xpower", "ultra", "core", "lux", "minibus", "chasis", "lwb", "swb"}
ALIAS_MARCA = {"gac motor": "gac", "omoda jaecoo": "omoda", "mercedes benz": "mercedes-benz", "lynk co": "lynk & co", "jmev": "jmc"}


def norm(s):
    s = unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9#.]+", " ", s).strip()


def precio(txt):
    m = re.search(r"(?:US\$|U\$S|USD)\s*([\d][\d.,]{3,})", txt)
    if not m:
        return None
    v = int(re.sub(r"[.,]", "", m.group(1)))
    return v if 5000 <= v <= 500000 else None


def get(url, headers=None, data=None, timeout=40):
    req = urllib.request.Request(url, headers={**UA, **(headers or {})}, data=data)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", "replace")


# ---------- Asociación de un anuncio con una versión del catálogo ----------
def compacto(s):
    s = norm(s).replace("+", " plus ")
    return re.sub(r"[^a-z0-9#]", "", s)


def tokens(s):
    s = norm(str(s).replace("+", " plus ")).replace("-", " ")
    s = re.sub(r"(\d)([a-z])", r"\1 \2", s)
    out = set()
    for x in s.split():
        x = re.sub(r"[^a-z0-9#]", "", x)
        out.add(ALIAS_MODELO.get(x, x))
    return out


def asociar(marca, titulo, catalogo, bateria=None):
    nm = norm(ALIAS_MARCA.get(norm(marca), marca))
    t, tc = tokens(titulo), compacto(titulo)
    for a, b in ALIAS_MODELO.items():
        tc = tc.replace(a, b)
    mejor, puntos_mejor, empate = None, 0, False
    for m in catalogo:
        if norm(m["marca"]) != nm and not norm(titulo).startswith(norm(m["marca"])) and norm(m["marca"]) not in t:
            continue
        mc = compacto(m["modelo"])
        tm = tokens(m["modelo"]) - {"ev", "bev"}
        if not (tm <= t or (len(mc) >= 3 and mc in tc)):
            continue
        p = 10 + 2 * len(tm)
        ver = [x for x in tokens(m.get("version") or "") if len(x) > 1 and x not in tm]
        p += sum(3 for x in ver if x in t) - sum(1 for x in ver if x not in t)
        p -= sum(3 for x in t - tm - set(ver) - tokens(marca) if x in CLAVES_VERSION)
        if bateria and m.get("bateria_kwh"):
            p += 3 if abs(bateria - m["bateria_kwh"]) <= 1.5 else -3
        if p > puntos_mejor:
            mejor, puntos_mejor, empate = m, p, False
        elif p == puntos_mejor:
            empate = True
    return mejor if puntos_mejor >= 12 and not empate else None


def bateria_de(titulo):
    m = re.search(r"\(?(\d{1,3}(?:[.,]\d{1,2})?)\s*kwh", titulo, re.I)
    return float(m.group(1).replace(",", ".")) if m else None


# ---------- Fuente 1: importadores ----------
def importadores(catalogo):
    cfg = json.loads((R / "agents/fuentes/importadores.json").read_text(encoding="utf-8"))
    vistos = []
    for imp in cfg["importadores"]:
        for url in imp.get("paginas", []):
            try:
                texto = html.unescape(re.sub(r"<[^>]+>", " ", get(url)))
                texto = re.sub(r"\s+", " ", texto)
            except Exception as e:
                print(f"[aviso] {imp['importador']} {url}: {e}", file=sys.stderr)
                continue
            # cada mención de precio se asocia con el texto inmediatamente anterior (nombre del modelo)
            for mm in re.finditer(r"(?:US\$|U\$S|USD)\s*[\d][\d.,]{3,}", texto):
                contexto = texto[max(0, mm.start() - 160): mm.end()]
                v = precio(contexto[-40:])
                for marca in imp["marcas"]:
                    m = asociar(marca, contexto, catalogo, bateria_de(contexto))
                    if m and v:
                        vistos.append({"fuente": "importador", "nombre": imp["importador"], "url": url, "id": m["id"], "precio": v})
                        break
            time.sleep(2)
    return vistos


# ---------- Fuente 2: MercadoLibre (tiendas oficiales) ----------
def ml_token():
    cid, sec = os.environ.get("ML_CLIENT_ID"), os.environ.get("ML_CLIENT_SECRET")
    if not (cid and sec):
        return None
    data = urllib.parse.urlencode({"grant_type": "client_credentials", "client_id": cid, "client_secret": sec}).encode()
    r = json.loads(get("https://api.mercadolibre.com/oauth/token", {"content-type": "application/x-www-form-urlencoded"}, data))
    return r.get("access_token")


def mercadolibre(catalogo):
    try:
        tok = ml_token()
    except Exception as e:
        print(f"[aviso] MercadoLibre: no se obtuvo token ({e})", file=sys.stderr)
        return [], []
    if not tok:
        print("[info] MercadoLibre: faltan ML_CLIENT_ID / ML_CLIENT_SECRET; se omite.")
        return [], []
    vistos, sin_asociar = [], []
    marcas = sorted({m["marca"] for m in catalogo})
    for marca in marcas:
        for offset in (0, 50):
            q = urllib.parse.urlencode({"q": f"{marca} electrico", "category": ML_CATEGORIA, "official_store": "all",
                                        "ITEM_CONDITION": "2230284", "limit": 50, "offset": offset})
            try:
                r = json.loads(get(f"https://api.mercadolibre.com/sites/MLU/search?{q}", {"Authorization": f"Bearer {tok}"}))
            except Exception as e:
                print(f"[aviso] MercadoLibre {marca}: {e}", file=sys.stderr)
                break
            for it in r.get("results", []):
                if it.get("currency_id") != "USD" or not it.get("official_store_id"):
                    continue
                titulo = it.get("title", "")
                if norm(marca) not in norm(titulo):
                    continue
                m = asociar(marca, titulo, catalogo, bateria_de(titulo))
                reg = {"fuente": "mercadolibre", "nombre": "MercadoLibre · tienda oficial", "url": it.get("permalink"),
                       "titulo": titulo, "precio": int(it["price"])}
                if m:
                    vistos.append({**reg, "id": m["id"]})
                elif re.search(r"\b0[.,]0\b|kwh|electric|el[eé]ctrico|ev\b", titulo, re.I):
                    sin_asociar.append(reg)
            if len(r.get("results", [])) < 50:
                break
            time.sleep(1)
    return vistos, sin_asociar


# ---------- Fuente 3: mielectrico.uy (control cruzado) ----------
def mielectrico(catalogo, archivo=None):
    try:
        s = Path(archivo).read_text(encoding="utf-8") if archivo else get("https://mielectrico.uy/explore")
    except Exception as e:
        print(f"[aviso] mielectrico.uy: {e}", file=sys.stderr)
        return [], [], 0
    vistos, sin_asociar, total = [], [], 0
    for b in re.split(r'<a href="/autos-electricos/', s)[1:]:
        slug, b = b.split('"', 1)[0], b[: b.find("</a>")]
        marca = re.search(r'uppercase[^>]*>\s*([^<]+?)\s*</p>', b)
        mod = re.search(r'<h3[^>]*>\s*([^<]+?)\s*</h3>', b)
        if not (marca and mod):
            continue
        total += 1
        marca, nombre = html.unescape(marca.group(1)), html.unescape(mod.group(1))
        bat = re.search(r"([\d.]+)\s*kWh</span>", b)
        v = precio(b)
        m = asociar(marca, f"{marca} {nombre}", catalogo, float(bat.group(1)) if bat else None)
        reg = {"fuente": "mielectrico", "nombre": "mielectrico.uy", "url": f"https://mielectrico.uy/autos-electricos/{slug}", "titulo": f"{marca} {nombre}", "precio": v}
        (vistos if m else sin_asociar).append({**reg, "id": m["id"]} if m else reg)
    return vistos, sin_asociar, total


# ---------- Decisión ----------
PRIORIDAD = {"importador": 0, "mercadolibre": 1, "mielectrico": 2}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sin-escribir", action="store_true")
    ap.add_argument("--html-mielectrico")
    ap.add_argument("--sin-red", action="store_true", help="no consulta importadores ni MercadoLibre (pruebas)")
    a = ap.parse_args()

    cat = json.loads(MODELOS.read_text(encoding="utf-8"))
    catalogo = cat["modelos"]
    estado = json.loads(ESTADO.read_text(encoding="utf-8")) if ESTADO.exists() else {"ultima_vez_visto": {}}

    imp = [] if a.sin_red else importadores(catalogo)
    ml, ml_nuevos = ([], []) if a.sin_red else mercadolibre(catalogo)
    me, me_nuevos, me_total = mielectrico(catalogo, a.html_mielectrico)
    observaciones = imp + ml + me
    fuentes_ok = {"importador": bool(imp), "mercadolibre": bool(ml), "mielectrico": me_total > 0}

    por_id = {}
    for o in observaciones:
        if o.get("precio"):
            por_id.setdefault(o["id"], []).append(o)

    cambios, alertas = [], []
    for m in catalogo:
        obs = sorted(por_id.get(m["id"], []), key=lambda o: (PRIORIDAD[o["fuente"]], o["precio"]))
        if obs:
            estado["ultima_vez_visto"][m["id"]] = HOY
        oficial = next((o for o in obs if o["fuente"] in ("importador", "mercadolibre")), None)
        if oficial:
            actual = m.get("precio_usd")
            if actual and abs(oficial["precio"] - actual) / actual > UMBRAL:
                alertas.append({"tipo": "cambio_grande", "id": m["id"], "modelo": f'{m["marca"]} {m["modelo"]} {m.get("version") or ""}'.strip(),
                                "actual": actual, "nuevo": oficial["precio"], "fuente": oficial["url"]})
            elif oficial["precio"] != actual or m.get("verificar"):
                cambios.append({"id": m["id"], "antes": actual, "ahora": oficial["precio"], "fuente": oficial["url"]})
                m["precio_usd"], m["fecha_precio"], m["fuente_precio"], m["verificar"] = oficial["precio"], HOY, oficial["url"], False
        else:
            ref = next((o for o in obs if o["fuente"] == "mielectrico"), None)
            if ref and m.get("precio_usd") and abs(ref["precio"] - m["precio_usd"]) / m["precio_usd"] > 0.05:
                alertas.append({"tipo": "diferencia_referencia", "id": m["id"], "modelo": f'{m["marca"]} {m["modelo"]} {m.get("version") or ""}'.strip(),
                                "actual": m["precio_usd"], "referencia": ref["precio"], "fuente": ref["url"]})
        visto = estado["ultima_vez_visto"].get(m["id"])
        if any(fuentes_ok.values()) and visto and (datetime.fromisoformat(HOY) - datetime.fromisoformat(visto)).days >= DIAS_DISCONTINUADO:
            alertas.append({"tipo": "posible_discontinuado", "id": m["id"], "modelo": f'{m["marca"]} {m["modelo"]}', "ultima_vez_visto": visto})
        elif not visto and any(fuentes_ok.values()):
            estado["ultima_vez_visto"][m["id"]] = HOY  # primera corrida: arranca a contar desde hoy

    nuevos = [{"tipo": "posible_modelo_nuevo", **x} for x in ml_nuevos]
    nuevos += [{"tipo": "solo_en_referencia", **x} for x in me_nuevos]  # requieren confirmación oficial
    revision = {"fecha": HOY, "fuentes": fuentes_ok, "cambios_aplicados": cambios, "alertas": alertas, "modelos_sin_catalogar": nuevos}

    print(f"Importadores: {len(imp)} precios · MercadoLibre: {len(ml)} (+{len(ml_nuevos)} sin catalogar) · "
          f"mielectrico: {len(me)}/{me_total} asociados")
    print(f"Cambios aplicados: {len(cambios)} · alertas: {len(alertas)} · sin catalogar: {len(nuevos)}")
    if a.sin_escribir:
        for x in (alertas + nuevos)[:15]:
            print("  ", x)
        return
    REVISION.write_text(json.dumps(revision, ensure_ascii=False, indent=1), encoding="utf-8")
    ESTADO.write_text(json.dumps(estado, ensure_ascii=False, indent=1), encoding="utf-8")
    if cambios:
        cat["actualizado"] = HOY
        MODELOS.write_text(json.dumps(cat, ensure_ascii=False, indent=1), encoding="utf-8")
        hp = R / "data/precios_historial.json"
        hist = json.loads(hp.read_text(encoding="utf-8")) if hp.exists() else {"desde": HOY, "historial": {}}
        for c in cambios:
            serie = hist["historial"].setdefault(c["id"], [])
            if not serie or serie[-1][1] != c["ahora"]:
                serie.append([HOY, c["ahora"]])
        hp.write_text(json.dumps(hist, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
