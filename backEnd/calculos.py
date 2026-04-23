def calcular_viabilidad(region: dict, area_m2: float, costo_instalacion: float) -> dict:
    """
    Primera version implementando ecuaciones del documento y agregando viabilidad
    
      energia_anual = area * radiacion * 365 * eficiencia   (formula del documento)
      ahorro_anual  = energia_anual * tarifa
      viable        = ahorro_anual * 10 > costo_instalacion
      
    """
    energia_anual = area_m2 * region["radiacion_kwh_m2_dia"] * 365 * region["eficiencia_paneles"]
    ahorro_anual  = energia_anual * region["tarifa_kwh_cop"]
    viable        = ahorro_anual * 10 > costo_instalacion

    return {
        "energia_anual_kwh": round(energia_anual, 2),
        "ahorro_anual_cop":  round(ahorro_anual, 2),
        "viable":            viable,
    }