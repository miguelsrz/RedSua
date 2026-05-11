"""
cargador_datos.py  –  Carga y cacheo del CSV de regiones

El CSV tiene las columnas:
  ciudad, grupo, radiacion_kwh_m2_dia, tarifa_kwh_cop, eficiencia_paneles

Se expone:
  obtener_region(ciudad)  , dict con los datos de la ciudad
  listar_ciudades()       , lista ordenada de nombres de ciudades disponibles
"""

import csv  # Para leer el archivo CSV de datos de regiones
import os   # Para construir la ruta al archivo CSV de manera independiente del sistema operativo

RUTA_CSV = os.path.join(os.path.dirname(__file__), "datos", "regiones.csv")

_cache: dict | None = None


def _cargar():
    """Carga el CSV en memoria la primera vez (caché en proceso)."""
    global _cache
    if _cache is not None:
        return

    _cache = {}
    with open(RUTA_CSV, newline="", encoding="utf-8") as f:
        for fila in csv.DictReader(f):
            nombre = fila["ciudad"].strip()
            _cache[nombre] = {
                "ciudad":              nombre,
                "grupo":               int(fila["grupo"]),
                "radiacion_kwh_m2_dia": float(fila["radiacion_kwh_m2_dia"]),
                "tarifa_kwh_cop":       float(fila["tarifa_kwh_cop"]),
                "eficiencia_paneles":   float(fila["eficiencia_paneles"]),
            }


def obtener_region(ciudad: str) -> dict:
    """
    Retorna el dict de datos de la ciudad solicitada.
    Lanza ValueError si la ciudad no existe en el CSV.
    La búsqueda es insensible a mayúsculas/minúsculas y a tildes básicas.
    """
    _cargar()

    # Búsqueda exacta primero
    if ciudad in _cache:
        return _cache[ciudad]

    # Búsqueda case-insensitive como fallback
    ciudad_lower = ciudad.lower().strip()
    for key, val in _cache.items():
        if key.lower() == ciudad_lower:
            return val

    raise ValueError(f"Ciudad '{ciudad}' no encontrada en el catálogo.")


def listar_ciudades() -> list[str]:
    """Retorna lista de ciudades disponibles, ordenada alfabéticamente."""
    _cargar()
    return sorted(_cache.keys())