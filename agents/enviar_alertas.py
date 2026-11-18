#!/usr/bin/env python3
"""Envía los avisos de baja de precio (diario, después de actualizar_precios.py).

Lee las alertas confirmadas (/api/admin/alertas), compara con el precio actual de data/modelos.json y,
si bajó, manda un correo por Brevo (transaccional) con enlace de baja. Requiere SITIO_URL, ADMIN_TOKEN,
BREVO_API_KEY y CONTACTO_EMAIL (remitente). Sin esas variables no hace nada.
"""
import json, os, sys, urllib.request
from pathlib import Path

R = Path(__file__).resolve().parent.parent
SITIO, TOKEN, BREVO, REMITE = (os.environ.get(k) for k in ("SITIO_URL", "ADMIN_TOKEN", "BREVO_API_KEY", "CONTACTO_EMAIL"))


def req(url, data=None, headers=None):
    h = {"User-Agent": "VoltUY-agente/1.0", "content-type": "application/json", **(headers or {})}
    with urllib.request.urlopen(urllib.request.Request(url, data=json.dumps(data).encode() if data is not None else None, headers=h), timeout=30) as r:
        return json.load(r)


def admin(path, data=None):
    return req(SITIO.rstrip("/") + "/api/admin/" + path, data, {"Authorization": f"Bearer {TOKEN}"})


def debe_avisar(a, precio):
    ref = a.get("ultimo_aviso_precio") or a.get("precio_alta")
    if a.get("objetivo"):
        return precio <= a["objetivo"] and (not a.get("ultimo_aviso_precio") or precio < a["ultimo_aviso_precio"])
    return ref is not None and precio < ref


def main():
    if not all((SITIO, TOKEN, BREVO, REMITE)):
        print("Faltan SITIO_URL / ADMIN_TOKEN / BREVO_API_KEY / CONTACTO_EMAIL: no se envían alertas.")
        return
    modelos = {m["id"]: m for m in json.loads((R / "data/modelos.json").read_text(encoding="utf-8"))["modelos"]}
    enviados = 0
    for a in admin("alertas").get("alertas", []):
        m = modelos.get(a["modelo_id"])
        if not m or not m.get("precio_usd"):
            continue
        precio = m["precio_usd"]
        if a.get("precio_alta") is None:
            admin("alertas/precio_alta", {"id": a["id"], "precio": precio})
            continue
        if not debe_avisar(a, precio):
            continue
        nombre = f'{m["marca"]} {m["modelo"]} {m.get("version") or ""}'.strip()
        antes = a.get("ultimo_aviso_precio") or a.get("precio_alta")
        html = (f"<p>Buenas noticias: el <b>{nombre}</b> bajó de US$ {antes:,} a <b>US$ {precio:,}</b>.</p>".replace(",", ".")
                + f'<p><a href="{SITIO}/#modelos">Ver en VoltUY</a> · <a href="{m.get("fuente_precio") or m.get("fuente")}">Fuente del precio</a></p>'
                + f'<p style="color:#888;font-size:12px">Recibís este correo porque creaste una alerta. <a href="{SITIO}/api/alertas/baja?t={a["token"]}">Dejar de recibir avisos de este modelo</a>.</p>')
        try:
            req("https://api.brevo.com/v3/smtp/email", {"sender": {"name": "VoltUY", "email": REMITE}, "to": [{"email": a["email"]}],
                                                         "subject": f"Bajó el precio: {nombre} a US$ {precio:,}".replace(",", "."), "htmlContent": html},
                {"api-key": BREVO})
            admin("alertas/avisado", {"id": a["id"], "precio": precio})
            enviados += 1
        except Exception as e:
            print(f"[aviso] {a['email']}: {e}", file=sys.stderr)
    print(f"Alertas enviadas: {enviados}")


if __name__ == "__main__":
    main()
