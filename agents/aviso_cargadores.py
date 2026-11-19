#!/usr/bin/env python3
"""Imprime el texto del issue «cargadores» si el control de salud del mapa encontró problemas."""
import json
from pathlib import Path

s = json.loads((Path(__file__).resolve().parent.parent / "data" / "cargadores_salud.json").read_text(encoding="utf-8"))
if s.get("problemas") or s.get("sin_ver"):
    print(f"### Control del mapa de cargadores · {s['fecha']}\n")
    for p in s.get("problemas", []):
        print(f"- {p}")
    if s.get("sin_ver"):
        print(f"\n{len(s['sin_ver'])} cargadores no aparecen hoy en ninguna fuente (se muestran marcados hasta 14 días): " + ", ".join(s["sin_ver"][:20]))
    print("\nTotales por fuente: " + ", ".join(f"{k} {v}" for k, v in s["por_fuente"].items()))
