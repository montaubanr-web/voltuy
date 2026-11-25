#!/usr/bin/env python3
"""Agente semanal: arma el newsletter de AutosEléctricosUY con los datos de la semana.

Genera newsletter/AAAA-MM-DD.html (HTML apto para correo, estilos en línea) con:
  1. Lo más importante de la semana (noticias de Uruguay)   4. Test destacado
  2. Precios que cambiaron en el catálogo                  5. Cargadores nuevos en el mapa
  3. Cuánto cuesta moverse (nafta vs. eléctrico)           6. Debate de la semana + espacio patrocinado
Si hay BREVO_API_KEY y BREVO_LIST_ID, lo deja como BORRADOR de campaña en Brevo:
nunca lo envía solo; alguien lo revisa y aprieta «Enviar».
"""
import html
import json
import os
import shutil
import sys
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
D = RAIZ / "data"
HIST = D / "historial"
SALIDA = RAIZ / "newsletter"
SITIO = os.environ.get("SITIO_URL") or "https://autoselectricosuy.pages.dev"
NOMBRE = os.environ.get("SITIO_NOMBRE", "AutosEléctricosUY")
MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "setiembre", "octubre", "noviembre", "diciembre"]

e = lambda s: html.escape(str(s or ""))
leer = lambda p: json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}
pesos = lambda n: "$ " + f"{n:,.0f}".replace(",", ".")
usd = lambda n: "US$ " + f"{n:,.0f}".replace(",", ".")


def seccion(titulo, cuerpo):
    return f"""<tr><td style="padding:24px 32px 8px"><h2 style="margin:0 0 12px;font:700 19px Arial,sans-serif;color:#0B1020">{titulo}</h2>{cuerpo}</td></tr>"""


def item(titulo, url, meta="", texto=""):
    return f"""<p style="margin:0 0 14px;font:15px/1.5 Arial,sans-serif;color:#1C2333"><a href="{e(url)}" style="color:#2563EB;font-weight:700;text-decoration:none">{e(titulo)}</a>
      {f'<br><span style="color:#5B6478;font-size:13px">{e(meta)}</span>' if meta else ""}{f'<br>{e(texto)}' if texto else ""}</p>"""


def main():
    hoy = datetime.now(timezone.utc)
    desde = (hoy - timedelta(days=7)).strftime("%Y-%m-%d")
    noticias = leer(D / "noticias.json").get("uruguay", [])
    modelos = leer(D / "modelos.json").get("modelos", [])
    cargadores = leer(D / "cargadores.json").get("cargadores", [])
    tests = leer(D / "tests.json").get("uruguay", [])
    comb = leer(D / "combustible.json")
    tar = leer(D / "tarifas.json")
    debates = leer(D / "debates.json").get("temas", [])
    previo_m = {m["id"]: m for m in leer(HIST / "modelos.json").get("modelos", [])}
    previo_c = {c["id"] for c in leer(HIST / "cargadores.json").get("cargadores", [])}

    bloques = []
    # 1. Noticias
    sem = [n for n in noticias if (n.get("fecha") or "") >= desde][:5] or noticias[:3]
    if sem:
        bloques.append(seccion("📰 Lo más importante de la semana",
                               "".join(item(n["titulo"], n["url"], f'{n.get("fuente", "")} · {n.get("categoria", "")}', n.get("resumen", "")) for n in sem)))
    # 2. Precios
    cambios = []
    for m in modelos:
        p = previo_m.get(m["id"])
        if p and p.get("precio_usd") and m.get("precio_usd") and p["precio_usd"] != m["precio_usd"]:
            dif = m["precio_usd"] - p["precio_usd"]
            cambios.append(f'<tr><td style="padding:6px 0;font:14px Arial">{e(m["marca"])} {e(m["modelo"])} {e(m.get("version") or "")}</td>'
                           f'<td style="padding:6px 0;font:14px Arial;text-align:right">{usd(p["precio_usd"])} → <b>{usd(m["precio_usd"])}</b> '
                           f'<span style="color:{"#15803D" if dif < 0 else "#B91C1C"}">({"−" if dif < 0 else "+"}{usd(abs(dif))[4:]})</span></td></tr>')
    nuevos = [m for m in modelos if previo_m and m["id"] not in previo_m]
    if cambios or nuevos:
        cuerpo = f'<table width="100%" cellpadding="0" cellspacing="0">{"".join(cambios)}</table>' if cambios else ""
        if nuevos:
            cuerpo += "<p style='font:14px Arial;margin:10px 0 0'>Nuevos en el catálogo: " + ", ".join(f"<b>{e(m['marca'])} {e(m['modelo'])}</b>" for m in nuevos) + "</p>"
        bloques.append(seccion("💲 Precios que cambiaron", cuerpo + f'<p style="font:13px Arial;margin:8px 0 0"><a href="{SITIO}/#modelos" style="color:#2563EB">Ver todo el catálogo →</a></p>'))
    # 3. Costo de moverse
    sup = next((p for p in comb.get("productos", []) if p["clave"] == "super95"), None)
    triple = next((r for r in tar.get("residencial", []) if r["id"] == "triple"), None)
    if sup and triple:
        valle = next(f["sin_iva"] for f in triple["franjas"] if f["id"] == "valle") * (1 + tar.get("iva", 0.22))
        nafta100, elec100 = 7 * sup["precio_uyu"], 15 * valle
        bloques.append(seccion("⛽ Cuánto cuesta moverse esta semana",
            f"""<table width="100%" cellpadding="0" cellspacing="0"><tr>
            <td width="50%" style="background:#FEE2E2;border-radius:10px;padding:14px;font:14px Arial;color:#991B1B">Nafta Súper 95<br><b style="font-size:22px">{pesos(nafta100)}</b><br>cada 100 km (7 l/100 km a $ {str(sup["precio_uyu"]).replace(".", ",")}/l)</td>
            <td width="4%"></td>
            <td width="46%" style="background:#ECFCCB;border-radius:10px;padding:14px;font:14px Arial;color:#3F6212">Eléctrico cargando en casa<br><b style="font-size:22px">{pesos(elec100)}</b><br>cada 100 km (15 kWh, Triple Horario valle)</td>
            </tr></table><p style="font:13px Arial;margin:10px 0 0"><a href="{SITIO}/#calculadora" style="color:#2563EB">Calculá tu caso →</a></p>"""))
    # 4. Test
    t = next((x for x in tests if (x.get("fecha") or "") >= desde), tests[0] if tests else None)
    if t:
        bloques.append(seccion("🧪 Test destacado", item(t["titulo"], t["url"], f'{t.get("medio", "")} · {t.get("tipo", "")}')))
    # 5. Cargadores
    nuevos_c = [c for c in cargadores if previo_c and c["id"] not in previo_c]
    if nuevos_c:
        lis = "".join(f'<li style="margin:0 0 6px">{e(c["nombre"])} · {e(c["ciudad"] or c["departamento"])} · {e(c["operador"])}{f" · hasta {c["max_kw"]} kW" if c.get("max_kw") else ""}</li>' for c in nuevos_c[:8])
        bloques.append(seccion(f"🔌 {len(nuevos_c)} cargador{'es' if len(nuevos_c) > 1 else ''} nuevo{'s' if len(nuevos_c) > 1 else ''} en el mapa",
                               f'<ul style="font:14px/1.5 Arial;padding-left:18px;margin:0">{lis}</ul><p style="font:13px Arial;margin:8px 0 0"><a href="{SITIO}/#cargadores" style="color:#2563EB">Ver mapa →</a></p>'))
    # 6. Debate + patrocinio
    if debates:
        d = debates[hoy.isocalendar()[1] % len(debates)]
        bloques.append(seccion("💬 Debate de la semana", item(d["titulo"], f"{SITIO}/#debates", texto=d["descripcion"])))
    bloques.append(f"""<tr><td style="padding:16px 32px"><div style="border:1px dashed #C5CCDA;border-radius:10px;padding:16px;text-align:center;font:13px Arial;color:#97A0B3">
        Espacio patrocinado · ¿Querés anunciar acá? Respondé este correo.</div></td></tr>""")

    fecha_txt = f"{hoy.day} de {MESES[hoy.month - 1]} de {hoy.year}"
    doc = f"""<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>{NOMBRE} · resumen semanal · {fecha_txt}</title></head>
<body style="margin:0;background:#F5F7FB">
<span style="display:none;max-height:0;overflow:hidden">Lo que pasó esta semana con los vehículos eléctricos en Uruguay.</span>
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F7FB"><tr><td align="center" style="padding:20px 10px">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#FFFFFF;border-radius:16px;overflow:hidden">
<tr><td style="background:#0B1020;padding:26px 32px">
  <div style="font:700 24px Arial,sans-serif;color:#FFFFFF"><span style="color:#FBBF24">⚡</span>{NOMBRE}</div>
  <div style="font:14px Arial;color:#9AA6C1;margin-top:6px">Resumen semanal · {fecha_txt}</div>
</td></tr>
<tr><td style="height:4px;background:linear-gradient(90deg,#22D3EE,#A3E635);background-color:#22D3EE"></td></tr>
{"".join(bloques)}
<tr><td style="padding:24px 32px;background:#0B1020;font:12px/1.6 Arial;color:#9AA6C1">
  Recibís este correo porque te suscribiste en <a href="{SITIO}" style="color:#22D3EE">{SITIO.replace("https://", "")}</a>.<br>
  ¿Dudas, correcciones o querés anunciar? Respondé este correo.<br>
  <a href="{{{{ unsubscribe }}}}" style="color:#22D3EE">Darte de baja</a>
</td></tr></table></td></tr></table></body></html>"""
    SALIDA.mkdir(exist_ok=True)
    archivo = SALIDA / f"{hoy:%Y-%m-%d}.html"
    archivo.write_text(doc, encoding="utf-8")
    print(f"Newsletter: {archivo.name} ({len(bloques)} bloques)")

    # Borrador en Brevo (no se envía)
    clave, lista = os.environ.get("BREVO_API_KEY"), os.environ.get("BREVO_LIST_ID")
    if clave and lista:
        cuerpo = json.dumps({
            "name": f"{NOMBRE} semanal {hoy:%Y-%m-%d}", "subject": f"{NOMBRE} · lo que pasó esta semana con los eléctricos",
            "sender": {"name": NOMBRE, "email": os.environ.get("NEWSLETTER_REMITENTE", os.environ.get("CONTACTO_EMAIL", ""))},
            "replyTo": os.environ.get("CONTACTO_EMAIL", os.environ.get("NEWSLETTER_REMITENTE", "")),
            "recipients": {"listIds": [int(lista)]}, "htmlContent": doc.replace("{{ unsubscribe }}", "{{ unsubscribe }}"),
        }).encode()
        req = urllib.request.Request("https://api.brevo.com/v3/emailCampaigns", data=cuerpo,
                                     headers={"api-key": clave, "content-type": "application/json", "accept": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                print("Borrador creado en Brevo:", r.read().decode())
        except Exception as ex:
            print(f"[aviso] Brevo: {ex}", file=sys.stderr)

    # Foto de esta semana para comparar la próxima
    HIST.mkdir(exist_ok=True)
    for n in ("modelos.json", "cargadores.json"):
        shutil.copy(D / n, HIST / n)


if __name__ == "__main__":
    main()
