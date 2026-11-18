#!/usr/bin/env python3
"""Arma el texto del aviso de revisión de precios (para un issue de GitHub). Sin alertas, no imprime nada."""
import json
from pathlib import Path

r = json.loads((Path(__file__).resolve().parent.parent / "data/precios_revision.json").read_text(encoding="utf-8"))
al, nuevos = r["alertas"], [x for x in r["modelos_sin_catalogar"] if x["tipo"] == "posible_modelo_nuevo"]
ref = [x for x in r["modelos_sin_catalogar"] if x["tipo"] == "solo_en_referencia"]
if not (al or nuevos or ref):
    raise SystemExit(0)
L = [f"## Revisión de precios y modelos · {r['fecha']}", "",
     f"Fuentes que respondieron: " + ", ".join(k for k, v in r["fuentes"].items() if v), "",
     f"Cambios aplicados automáticamente: {len(r['cambios_aplicados'])}", ""]
def sec(titulo, filas):
    if filas:
        L.extend([f"### {titulo}", *filas, ""])
sec("Cambios de precio mayores al 15 % (no aplicados)", [f"- [ ] {a['modelo']}: US$ {a['actual']:,} → US$ {a['nuevo']:,} · [fuente]({a['fuente']})" for a in al if a["tipo"] == "cambio_grande"])
sec("Posibles modelos nuevos (tiendas oficiales)", [f"- [ ] {x['titulo']} · US$ {x['precio']:,} · [ver]({x['url']})" for x in nuevos])
sec("Posibles discontinuados (14 días sin verse)", [f"- [ ] {a['modelo']} (visto por última vez {a['ultima_vez_visto']})" for a in al if a["tipo"] == "posible_discontinuado"])
sec("Diferencias con mielectrico.uy (solo referencia)", [f"- [ ] {a['modelo']}: nuestro US$ {a['actual']:,} · referencia US$ {a['referencia']:,} · [ver]({a['fuente']})" for a in al if a["tipo"] == "diferencia_referencia"])
sec("Solo aparecen en mielectrico.uy (confirmar con el importador)", [f"- [ ] {x['titulo']}" + (f" · US$ {x['precio']:,}" if x.get("precio") else "") for x in ref])
L.append("_Marcá cada punto al resolverlo. Lo genera agents/actualizar_precios.py._")
print("\n".join(L).replace(",", "."))
