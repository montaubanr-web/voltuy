#!/usr/bin/env python3
"""Genera páginas estáticas para buscadores (Google) a partir de los datos del sitio.

Crea una página por versión (/modelos/<id>/), por marca (/marcas/<marca>/), por tipo de vehículo,
por departamento con cargadores (/cargadores/<depto>/), la tabla de precios y la guía del MIEM,
más sitemap.xml y robots.txt. Cada página tiene título, descripción, datos estructurados
(schema.org) y enlaces a las herramientas interactivas del sitio.

Se ejecuta todos los días después de los agentes de datos: si cambia un precio o aparece un
cargador, la página se actualiza sola. Usa SITIO_URL (por defecto https://autoselectricosuy.pages.dev).
"""
import html
import json
import os
import re
import shutil
import unicodedata
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

R = Path(__file__).resolve().parent.parent
SITIO = (os.environ.get("SITIO_URL") or "https://autoselectricosuy.pages.dev").rstrip("/")
NOMBRE = "AutosEléctricosUY"
HOY = datetime.now(timezone.utc).strftime("%Y-%m-%d")
MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "setiembre", "octubre", "noviembre", "diciembre"]
CARPETAS = ["modelos", "marcas", "cargadores", "autos-electricos", "suv-electricas", "pick-ups-electricas",
            "utilitarios-electricos", "autos-electricos-baratos", "precios-autos-electricos", "devolucion-miem"]


def leer(n):
    p = R / "data" / n
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}


def slug(t):
    t = unicodedata.normalize("NFKD", str(t)).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", t).strip("-")


e = lambda t: html.escape(str(t if t is not None else ""), quote=True)


def usd(n):
    return f"US$ {n:,.0f}".replace(",", ".") if n else "Consultar"


def mes_txt(f):
    try:
        a, m = str(f)[:7].split("-")
        return f"{MESES[int(m) - 1]} de {a}"
    except Exception:
        return str(f or "")


def conectores_txt(c):
    partes = []
    for k in c.get("conectores", []):
        kw = f" {round(k['kw'])} kW" if k.get("kw") else ""
        partes.append(f"{k.get('cantidad') or 1}× {k.get('tipo') or ''}{kw}")
    return ", ".join(partes)


def nombre(m):
    return " ".join(x for x in [m["marca"], m["modelo"], m.get("version") or ""] if x).strip()


CSS = """
.pg{max-width:1080px;margin:0 auto;padding:28px 20px 60px}
.pg h1{font-family:'Space Grotesk',sans-serif;font-size:clamp(1.6rem,3.4vw,2.3rem);line-height:1.15;margin:.2em 0 .4em}
.pg h2{font-family:'Space Grotesk',sans-serif;margin-top:1.8em}
.migas{font-size:.85rem;color:#5b6b5f}.migas a{color:inherit}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin:18px 0}
.kpis div{background:#fff;border:1px solid rgba(0,0,0,.08);border-radius:14px;padding:14px}
.kpis b{display:block;font-size:1.35rem;font-family:'Space Grotesk',sans-serif}
.kpis span{font-size:.82rem;color:#5b6b5f}
.tabla{width:100%;border-collapse:collapse;background:#fff;border-radius:12px;overflow:hidden;font-size:.94rem}
.tabla th,.tabla td{padding:9px 10px;border-bottom:1px solid rgba(0,0,0,.07);text-align:left}
.tabla th{background:#EEF6EE;font-weight:600}
.tabla td.n{text-align:right;white-space:nowrap}
.ctas{display:flex;flex-wrap:wrap;gap:10px;margin:20px 0}
.lista{columns:3 220px;padding-left:18px}
.nota{font-size:.85rem;color:#5b6b5f}
.tw{overflow-x:auto;-webkit-overflow-scrolling:touch;border-radius:12px}
@media(max-width:900px){.topbar #nav.nav-estatica{display:flex;position:static;flex-direction:row;overflow-x:auto;gap:4px;background:none;box-shadow:none;padding:0 0 8px;width:100%}
.topbar #nav.nav-estatica a{white-space:nowrap;font-size:.9rem}.topbar-in{flex-wrap:wrap;height:auto;min-height:0;padding-top:10px}.topbar{height:auto}}
.caja{background:#fff;border:1px solid rgba(0,0,0,.08);border-radius:14px;padding:16px 18px;margin:16px 0}
"""


def pagina(ruta, titulo, descripcion, cuerpo, migas, jsonld=None):
    """Escribe /<ruta>/index.html. ruta sin barras al inicio ni al final."""
    url = f"{SITIO}/{ruta}/" if ruta else f"{SITIO}/"
    lds = [{"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
        {"@type": "ListItem", "position": i + 1, "name": n, "item": SITIO + h} for i, (n, h) in enumerate(migas)]}]
    if jsonld:
        lds.append(jsonld)
    ld = "\n".join(f'<script type="application/ld+json">{json.dumps(x, ensure_ascii=False)}</script>' for x in lds)
    migas_html = " › ".join(f'<a href="{e(h)}">{e(n)}</a>' for n, h in migas[:-1]) + f" › {e(migas[-1][0])}"
    doc = f"""<!DOCTYPE html>
<html lang="es-UY">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{e(titulo)}</title>
<meta name="description" content="{e(descripcion)}">
<link rel="canonical" href="{e(url)}">
<meta property="og:type" content="website"><meta property="og:site_name" content="{NOMBRE}">
<meta property="og:title" content="{e(titulo)}"><meta property="og:description" content="{e(descripcion)}"><meta property="og:url" content="{e(url)}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/assets/styles.css">
<style>{CSS}</style>
{ld}
</head>
<body>
<header class="topbar"><div class="wrap topbar-in">
  <a href="/" class="logo"><span class="bolt">⚡</span>AutosEléctricos<b>UY</b></a>
  <nav id="nav" class="nav-estatica">
    <a href="/modelos/">Modelos</a><a href="/precios-autos-electricos/">Precios</a><a href="/#comparar">Comparar</a>
    <a href="/cargadores/">Cargadores</a><a href="/devolucion-miem/">Devolución MIEM</a><a href="/#noticias">Noticias</a><a href="/#calculadora">Costos</a>
  </nav>
</div></header>
<main class="pg">
<div class="migas">{migas_html}</div>
{cuerpo}
<p class="nota">Actualizado el {e(HOY)}. {NOMBRE} es un sitio independiente: los datos se actualizan todos los días desde fuentes públicas (importadores, URSEA, UTE, operadores de carga). Verificá precio y condiciones con el concesionario.</p>
</main>
<footer class="foot"><div class="wrap"><p class="muted small"><a href="/">{NOMBRE}</a> · Información independiente sobre movilidad eléctrica en Uruguay.</p></div></footer>
</body>
</html>
"""
    doc = doc.replace('<table class="tabla">', '<div class="tw"><table class="tabla">').replace("</table>", "</table></div>")
    d = R / ruta if ruta else R
    d.mkdir(parents=True, exist_ok=True)
    (d / "index.html").write_text(doc, encoding="utf-8")
    return url


def main():
    modelos = [m for m in leer("modelos.json").get("modelos", []) if m.get("id")]
    hist = leer("precios_historial.json").get("historial", {})
    ventas = leer("ventas.json")
    tarifas = leer("tarifas.json")
    comb = leer("combustible.json")
    cg = leer("cargadores.json")
    miem = leer("miem.json")

    # Limpiar lo generado antes (por si un modelo o departamento desaparece)
    for c in CARPETAS:
        shutil.rmtree(R / c, ignore_errors=True)
    urls = [f"{SITIO}/"]

    # Precio de la energía (UTE valle con IVA) y nafta para el costo cada 100 km
    valle = None
    for t in tarifas.get("residencial", []):
        for f in t.get("franjas", []):
            if f.get("id") == "valle":
                valle = f["sin_iva"] * (1 + tarifas.get("iva", 0.22))
                break
        if valle:
            break
    nafta = next((p["precio_uyu"] for p in comb.get("productos", []) if p.get("clave") == "super95"), None)

    # Ventas 2026 acumuladas por marca+modelo
    vend = defaultdict(int)
    for mes in ventas.get("meses", []):
        for v in mes.get("modelos", []):
            vend[(slug(v["marca"]), slug(v["modelo"]))] += v.get("unidades") or 0

    def ventas_de(m):
        k = (slug(m["marca"]), slug(m["modelo"]))
        if k in vend:
            return vend[k]
        for (ma, mo), n in vend.items():  # "Yuan Pro" vs "Yuan Pro GS"
            if ma == k[0] and (mo.startswith(k[1]) or k[1].startswith(mo)):
                return n
        return None

    por_marca = defaultdict(list)
    for m in modelos:
        por_marca[m["marca"]].append(m)

    def fila(m, extra=True):
        u = m.get("ursea") or {}
        aut = m.get("autonomia_km") or u.get("autonomia_km")
        return (f'<tr><td><a href="/modelos/{e(m["id"])}/">{e(nombre(m))}</a></td><td>{e(m.get("carroceria") or "")}</td>'
                f'<td>{e(m.get("tipo"))}</td><td class="n">{e(f"{m["bateria_kwh"]:g} kWh" if m.get("bateria_kwh") else "—")}</td>'
                f'<td class="n">{e(f"{aut:.0f} km" if aut else "—")}</td><td class="n"><b>{e(usd(m.get("precio_usd")))}</b></td></tr>')

    CAB = '<table class="tabla"><thead><tr><th>Versión</th><th>Tipo</th><th>Motor</th><th>Batería</th><th>Autonomía</th><th>Precio</th></tr></thead><tbody>'

    # ---------- Una página por versión ----------
    for m in modelos:
        u = m.get("ursea") or {}
        n = nombre(m)
        aut = m.get("autonomia_km") or u.get("autonomia_km")
        cons = u.get("consumo_kwh_100km")
        precio = m.get("precio_usd")
        vs = ventas_de(m)
        kpis = [(usd(precio), f"Precio de lista ({mes_txt(m.get('fecha_precio'))})")]
        if aut:
            kpis.append((f"{aut:.0f} km", "Autonomía " + ("homologada URSEA" if m.get("ciclo") == "URSEA" or u else (m.get("ciclo") or ""))))
        if m.get("bateria_kwh"):
            kpis.append((f"{m['bateria_kwh']:g} kWh", "Batería"))
        if cons:
            kpis.append((f"{cons:g} kWh/100 km", "Consumo URSEA"))
        if vs:
            kpis.append((f"{vs:,}".replace(",", "."), "Unidades vendidas en 2026"))
        costo = ""
        if cons and valle:
            c100 = cons * valle
            costo = f"<h2>¿Cuánto cuesta cargarlo?</h2><p>Con el consumo homologado por URSEA ({cons:g} kWh cada 100 km) y la tarifa de UTE en horario valle (${valle:.2f} el kWh con IVA), recorrer 100 km cuesta unos <b>$ {c100:.0f}</b>"
            if nafta:
                costo += f". Un auto naftero que gaste 7 litros cada 100 km gasta $ {7 * nafta:.0f} con Súper 95 a $ {nafta:.2f}: el eléctrico cuesta alrededor de un {100 - c100 / (7 * nafta) * 100:.0f}% menos por kilómetro"
            costo += '. <a href="/#calculadora">Calculá tu caso con la calculadora de costos</a>.</p>'
        hp = hist.get(m["id"]) or []
        hist_html = ""
        if len(hp) > 1:
            hist_html = "<h2>Historial de precio</h2><ul>" + "".join(f"<li>{e(mes_txt(f))}: {e(usd(p))}</li>" for f, p in hp) + "</ul>"
        hermanas = [x for x in por_marca[m["marca"]] if x["modelo"] == m["modelo"] and x["id"] != m["id"]]
        rivales = sorted([x for x in modelos if x["id"] != m["id"] and x["modelo"] != m["modelo"] and x.get("carroceria") == m.get("carroceria") and x.get("precio_usd")],
                         key=lambda x: abs((x.get("precio_usd") or 0) - (precio or 0)))[:6] if precio else []
        miem_txt = ""
        if m.get("tipo") == "BEV" and m.get("carroceria") in ("Auto", "SUV", "Pick-up", "Utilitario"):
            miem_txt = '<div class="caja">Al ser 100% eléctrico, comprado 0 km puede acceder a la <a href="/devolucion-miem/">devolución del MIEM (Certificados de Eficiencia Energética)</a>, sujeto a las condiciones vigentes.</div>'
        desc = f"{n}: precio en Uruguay {usd(precio)}" + (f", autonomía {aut:.0f} km" if aut else "") + (f", batería {m['bateria_kwh']:g} kWh" if m.get("bateria_kwh") else "") + ". Ficha, costo de carga, historial de precio y alternativas."
        cuerpo = f"""<h1>{e(n)}: precio en Uruguay y ficha técnica</h1>
<p>{e(m.get('tipo') == 'BEV' and '100% eléctrico' or 'Híbrido enchufable')} · {e(m.get('carroceria') or '')} · segmento {e(m.get('segmento') or '')}{' · importa ' + e(m['importador']) if m.get('importador') else ''}</p>
<div class="kpis">{''.join(f'<div><b>{e(a)}</b><span>{e(b)}</span></div>' for a, b in kpis)}</div>
<div class="ctas"><a class="btn btn-primary" href="/#modelos">🔔 Avisame si baja el precio</a><a class="btn btn-ghost-dark" href="/#comparar">Comparar con otros modelos</a><a class="btn btn-ghost-dark" href="/cargadores/">Ver cargadores</a></div>
{costo}
{miem_txt}
{hist_html}
{('<h2>Otras versiones del ' + e(m['marca'] + ' ' + m['modelo']) + '</h2>' + CAB + ''.join(fila(x) for x in hermanas) + '</tbody></table>') if hermanas else ''}
{('<h2>Alternativas a precio parecido</h2>' + CAB + ''.join(fila(x) for x in rivales) + '</tbody></table>') if rivales else ''}
<p class="nota">Fuente del precio: <a href="{e(m.get('fuente_precio') or m.get('fuente') or '#')}" rel="nofollow noopener">{e(re.sub(r'^https?://(www\.)?', '', (m.get('fuente_precio') or m.get('fuente') or '')).split('/')[0])}</a>{(' · Registro URSEA ' + e(u['registro'])) if u.get('registro') else ''}. Ver más de <a href="/marcas/{slug(m['marca'])}/">{e(m['marca'])}</a>.</p>"""
        ld = {"@context": "https://schema.org", "@type": "Car", "name": n, "brand": {"@type": "Brand", "name": m["marca"]},
              "model": m["modelo"], "fuelType": "Electricity" if m.get("tipo") == "BEV" else "Electricity, Gasoline",
              "url": f"{SITIO}/modelos/{m['id']}/", "description": desc}
        if precio:
            ld["offers"] = {"@type": "Offer", "price": precio, "priceCurrency": "USD", "availability": "https://schema.org/InStock",
                            "areaServed": "UY", "url": f"{SITIO}/modelos/{m['id']}/"}
        if m.get("bateria_kwh"):
            ld["additionalProperty"] = [{"@type": "PropertyValue", "name": "Batería", "value": m["bateria_kwh"], "unitText": "kWh"}]
        urls.append(pagina(f"modelos/{m['id']}", f"{n}: precio en Uruguay, autonomía y ficha | {NOMBRE}", desc, cuerpo,
                           [("Inicio", "/"), ("Modelos", "/modelos/"), (m["marca"], f"/marcas/{slug(m['marca'])}/"), (n, f"/modelos/{m['id']}/")], ld))

    # ---------- Marcas ----------
    for marca, lista in sorted(por_marca.items()):
        lista = sorted(lista, key=lambda x: x.get("precio_usd") or 9e9)
        precios = [x["precio_usd"] for x in lista if x.get("precio_usd")]
        imp = sorted({x["importador"] for x in lista if x.get("importador")})
        desde = f" desde {usd(min(precios))}" if precios else ""
        cuerpo = f"""<h1>{e(marca)} eléctricos en Uruguay: modelos y precios</h1>
<p>{len(lista)} versiones de {e(marca)} a la venta en Uruguay{e(desde)}{('. Importador: ' + e(', '.join(imp))) if imp else ''}.</p>
{CAB}{''.join(fila(x) for x in lista)}</tbody></table>
<div class="ctas"><a class="btn btn-primary" href="/#comparar">Comparar modelos</a><a class="btn btn-ghost-dark" href="/#elegir">¿Cuál me conviene?</a></div>"""
        urls.append(pagina(f"marcas/{slug(marca)}", f"{marca} eléctricos en Uruguay: precios {datetime.now().year} | {NOMBRE}",
                           f"Todos los {marca} eléctricos que se venden en Uruguay{desde}: versiones, autonomía, batería y precio de lista actualizado.",
                           cuerpo, [("Inicio", "/"), ("Modelos", "/modelos/"), (marca, f"/marcas/{slug(marca)}/")]))

    # ---------- Índice de modelos ----------
    cuerpo = f"<h1>Todos los vehículos eléctricos en Uruguay</h1><p>{len(modelos)} versiones de {len(por_marca)} marcas, con precio de lista actualizado todos los días.</p><h2>Por marca</h2><ul class=\"lista\">" + "".join(
        f'<li><a href="/marcas/{slug(k)}/">{e(k)}</a> ({len(v)})</li>' for k, v in sorted(por_marca.items())) + "</ul><h2>Por tipo</h2><ul class=\"lista\">" + \
        '<li><a href="/autos-electricos/">Autos eléctricos</a></li><li><a href="/suv-electricas/">SUV eléctricas</a></li><li><a href="/pick-ups-electricas/">Pick-ups eléctricas</a></li><li><a href="/utilitarios-electricos/">Utilitarios eléctricos</a></li><li><a href="/autos-electricos-baratos/">Eléctricos más baratos</a></li><li><a href="/precios-autos-electricos/">Lista completa de precios</a></li></ul>'
    urls.append(pagina("modelos", f"Vehículos eléctricos en Uruguay: todas las marcas y modelos | {NOMBRE}",
                       f"Los {len(modelos)} vehículos eléctricos a la venta en Uruguay, por marca y tipo: autos, SUV, pick-ups y utilitarios con precio y autonomía.",
                       cuerpo, [("Inicio", "/"), ("Modelos", "/modelos/")]))

    # ---------- Tipos y listas ----------
    def lista_tipo(ruta, titulo_h1, titulo, desc, filtro, intro):
        sel = sorted([x for x in modelos if filtro(x)], key=lambda x: x.get("precio_usd") or 9e9)
        if not sel:
            return
        precios = [x["precio_usd"] for x in sel if x.get("precio_usd")]
        cuerpo = f"<h1>{e(titulo_h1)}</h1><p>{e(intro.format(n=len(sel), desde=usd(min(precios)) if precios else ''))}</p>{CAB}{''.join(fila(x) for x in sel)}</tbody></table>" + \
            '<div class="ctas"><a class="btn btn-primary" href="/#elegir">¿Cuál me conviene? (recomendador)</a><a class="btn btn-ghost-dark" href="/#comparar">Comparar</a></div>'
        urls.append(pagina(ruta, titulo, desc, cuerpo, [("Inicio", "/"), ("Modelos", "/modelos/"), (titulo_h1.split(":")[0], f"/{ruta}/")]))

    a = datetime.now().year
    lista_tipo("autos-electricos", f"Autos eléctricos en Uruguay: precios {a}", f"Autos eléctricos en Uruguay {a}: precios y modelos | {NOMBRE}",
               "Todos los autos eléctricos (no SUV) que se venden en Uruguay, del más barato al más caro, con autonomía y batería.",
               lambda x: x.get("carroceria") == "Auto", "{n} autos eléctricos a la venta, desde {desde}.")
    lista_tipo("suv-electricas", f"SUV eléctricas en Uruguay: precios {a}", f"SUV eléctricas en Uruguay {a}: precios y modelos | {NOMBRE}",
               "Todas las SUV eléctricas e híbridas enchufables que se venden en Uruguay, con precio, autonomía y batería.",
               lambda x: x.get("carroceria") == "SUV", "{n} versiones de SUV eléctricas e híbridas enchufables, desde {desde}.")
    lista_tipo("pick-ups-electricas", f"Pick-ups eléctricas en Uruguay: precios {a}", f"Pick-ups eléctricas en Uruguay {a}: precios | {NOMBRE}",
               "Las camionetas pick-up eléctricas e híbridas enchufables a la venta en Uruguay, con precio y autonomía.",
               lambda x: x.get("carroceria") == "Pick-up", "{n} versiones de pick-ups eléctricas, desde {desde}.")
    lista_tipo("utilitarios-electricos", f"Utilitarios y furgones eléctricos en Uruguay: precios {a}", f"Utilitarios eléctricos en Uruguay {a}: precios | {NOMBRE}",
               "Furgones, utilitarios y camionetas de carga eléctricas en Uruguay, con precio, batería y autonomía. Ideal para empresas y flotas.",
               lambda x: x.get("carroceria") == "Utilitario", "{n} utilitarios y furgones eléctricos, desde {desde}.")
    lista_tipo("autos-electricos-baratos", "Los autos eléctricos más baratos de Uruguay", f"Autos eléctricos baratos en Uruguay {a}: menos de US$ 25.000 | {NOMBRE}",
               "Los vehículos eléctricos más económicos que se venden en Uruguay, todos por debajo de US$ 25.000, con autonomía y batería.",
               lambda x: (x.get("precio_usd") or 9e9) < 25000 and x.get("carroceria") != "Cuadriciclo",
               "{n} versiones por menos de US$ 25.000, desde {desde}.")
    lista_tipo("precios-autos-electricos", f"Precios de autos eléctricos en Uruguay ({mes_txt(HOY)})", f"Precios de autos eléctricos en Uruguay {a}: lista completa | {NOMBRE}",
               "Lista completa y actualizada de precios de todos los autos, SUV, pick-ups y utilitarios eléctricos e híbridos enchufables en Uruguay.",
               lambda x: True, "Los {n} vehículos eléctricos e híbridos enchufables a la venta, desde {desde}. Se actualiza todos los días.")

    # ---------- Cargadores por departamento ----------
    deps = defaultdict(list)
    for c in cg.get("cargadores", []):
        if c.get("departamento"):
            deps[c["departamento"]].append(c)
    for dep, lista in sorted(deps.items()):
        lista.sort(key=lambda c: (c.get("ciudad") or "", c.get("nombre") or ""))
        rapidos = sum(1 for c in lista if (c.get("max_kw") or 0) >= 40)
        ops = defaultdict(int)
        for c in lista:
            ops[c.get("operador") or "Sin dato"] += 1
        filas = "".join(
            f"<tr><td>{e(c.get('nombre'))}</td><td>{e(c.get('ciudad') or '')}{(' · ' + e(c['direccion'])) if c.get('direccion') else ''}</td><td>{e(c.get('operador') or '')}</td>"
            f"<td>{e(conectores_txt(c))}</td>"
            f"<td><a href=\"https://www.google.com/maps/dir/?api=1&destination={c['lat']},{c['lon']}\" rel=\"nofollow noopener\">Cómo llegar</a></td></tr>" for c in lista)
        cuerpo = f"""<h1>Cargadores de autos eléctricos en {e(dep)}</h1>
<p>{len(lista)} puntos de carga públicos en {e(dep)}, {rapidos} de carga rápida (40 kW o más). Operadores: {e(', '.join(f'{k} ({v})' for k, v in sorted(ops.items(), key=lambda x: -x[1])))}.</p>
<div class="ctas"><a class="btn btn-primary" href="/#cargadores">Ver el mapa con disponibilidad en vivo</a><a class="btn btn-ghost-dark" href="/#viaje">Planificar un viaje</a></div>
<table class="tabla"><thead><tr><th>Lugar</th><th>Ciudad y dirección</th><th>Operador</th><th>Conectores</th><th></th></tr></thead><tbody>{filas}</tbody></table>
<p class="nota">Fuentes: UTE, mapa interoperable de operadores, Open Charge Map y OpenStreetMap. Se actualiza todos los días.</p>"""
        urls.append(pagina(f"cargadores/{slug(dep)}", f"Cargadores eléctricos en {dep}: mapa y lista | {NOMBRE}",
                           f"Los {len(lista)} cargadores para autos eléctricos en {dep} ({rapidos} rápidos): ubicación, operador, conectores y disponibilidad en vivo.",
                           cuerpo, [("Inicio", "/"), ("Cargadores", "/cargadores/"), (dep, f"/cargadores/{slug(dep)}/")]))
    total = cg.get("total") or sum(len(v) for v in deps.values())
    cuerpo = f"""<h1>Cargadores de autos eléctricos en Uruguay</h1>
<p>{total} ubicaciones y {cg.get('puntos') or ''} conectores de carga pública en todo el país: red de UTE y operadores privados ({e(', '.join(k for k in (cg.get('por_operador') or {}) if k not in ('UTE', 'Sin dato', 'Otro operador', 'Operador local'))[:200])}).</p>
<div class="ctas"><a class="btn btn-primary" href="/#cargadores">Abrir el mapa con disponibilidad en vivo</a></div>
<h2>Por departamento</h2><ul class="lista">{''.join(f'<li><a href="/cargadores/{slug(d)}/">{e(d)}</a> ({len(v)})</li>' for d, v in sorted(deps.items()))}</ul>"""
    urls.append(pagina("cargadores", f"Cargadores para autos eléctricos en Uruguay: mapa {a} | {NOMBRE}",
                       f"Mapa y lista de los {total} cargadores para autos eléctricos de Uruguay, por departamento, con operador, potencia y disponibilidad en vivo.",
                       cuerpo, [("Inicio", "/"), ("Cargadores", "/cargadores/")]))

    # ---------- Devolución del MIEM ----------
    pasos = miem.get("pasos") or []
    req = miem.get("requisitos") or []
    li = lambda xs: "".join(f"<li>{e(x if isinstance(x, str) else (x.get('titulo') or x.get('texto') or ''))}{(': ' + e(x.get('texto') or x.get('detalle'))) if isinstance(x, dict) and x.get('titulo') and (x.get('texto') or x.get('detalle')) else ''}</li>" for x in xs)
    cuerpo = f"""<h1>Devolución del MIEM por comprar un auto eléctrico: cómo pedirla</h1>
<p>Por la convocatoria {e(miem.get('convocatoria') or 'CEE')}, el MIEM paga hasta <b>$ {f"{miem.get('tope_uyu') or 0:,}".replace(',', '.')}</b> por vehículo liviano 100% eléctrico comprado 0 km, a través de los Certificados de Eficiencia Energética. Postulaciones hasta el <b>{e('/'.join(reversed(str(miem.get('cierre') or '').split('-'))))}</b>.</p>
{('<h2>Requisitos</h2><ul>' + li(req) + '</ul>') if req else ''}
{('<h2>Paso a paso</h2><ol>' + li(pasos) + '</ol>') if pasos else ''}
<div class="ctas"><a class="btn btn-primary" href="/#miem">Ver si mi vehículo califica</a></div>
<p class="nota">El trámite lo hace cada propietario directamente ante el MIEM, sin intermediarios. Verificá las bases vigentes en gub.uy.</p>"""
    urls.append(pagina("devolucion-miem", f"Devolución del MIEM para autos eléctricos {a}: requisitos y trámite | {NOMBRE}",
                       "Cómo pedir la devolución del MIEM (Certificados de Eficiencia Energética) por un auto eléctrico 0 km: requisitos, montos, plazos y paso a paso.",
                       cuerpo, [("Inicio", "/"), ("Devolución del MIEM", "/devolucion-miem/")]))

    # Dirección canónica de la página principal, con la misma base que el resto
    ix = R / "index.html"
    t = ix.read_text(encoding="utf-8")
    t2 = re.sub(r'<link rel="canonical" href="[^"]*">', f'<link rel="canonical" href="{SITIO}/">', t)
    if t2 != t:
        ix.write_text(t2, encoding="utf-8")

    # ---------- sitemap.xml y robots.txt ----------
    xml = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    xml += [f"<url><loc>{e(u)}</loc><lastmod>{HOY}</lastmod></url>" for u in urls]
    xml.append("</urlset>")
    (R / "sitemap.xml").write_text("\n".join(xml) + "\n", encoding="utf-8")
    (R / "robots.txt").write_text(f"User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /agents/\nDisallow: /functions/\n\nSitemap: {SITIO}/sitemap.xml\n", encoding="utf-8")
    print(f"Páginas generadas: {len(urls)} (sitemap con base {SITIO})")


if __name__ == "__main__":
    main()
