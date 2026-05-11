"""
calculos.py  – Análisis económico de viabilidad solar 

Calcula en el back-end los siguientes indicadores:
  - Energía anual (año 1)
  - Ahorro anual (año 1)
  - VPN  (Valor Presente Neto)
  - TIR  (Tasa Interna de Retorno) mediante Newton-Raphson
  - Período de recuperación descontado
  - Flujo de caja completo (20 años)
  - Viabilidad (VPN > 0)

Parámetros económicos con valores por defecto ajustables por el usuario:
  - tasa_interes      (defecto 12 % anual)
  - anos_proyecto     (defecto 20 años)
  - eficiencia_override (opcional, sobreescribe la del CSV)
"""

import math

# Constantes por defecto 
TASA_INTERES_DEFAULT  = 0.12   # 12 % anual
ANOS_PROYECTO_DEFAULT = 20     # vida útil estándar de paneles fotovoltaicos
DEGRADACION_ANUAL     = 0.005  # 0.5 % de pérdida de eficiencia anual

# Ajustes realistas para el modelo económico no dados en investigacion preliminar
INFLACION_ENERGIA_ANUAL = 0.05    # Aumento esperado del precio del kWh anual
OPEX_ANUAL_PCT          = 0.015   # 1.5% del costo inicial para mantenimiento que reduce el ahorro neto, opex significa gastos operativos, se esta asumiendo que el mantenimiento es un gasto operativo anual que reduce el ahorro neto del sistema fotovoltaico
PORCENTAJE_AUTOCONSUMO  = 0.70    # 70% ahorrado a tarifa plena
TARIFA_EXCEDENTES       = 250     # 30% vendido a precio de bolsa


# TIR basado en Newton-Raphson ya que no se vio en clase como tal
def _calcular_tir(flujos: list[float], tol: float = 1e-8, max_iter: int = 1000) -> float | None:
    """
    Calcula la TIR (tasa interna de retorno) para una serie de flujos de caja
    donde flujos[0] es la inversión inicial (negativa) y flujos[1..n] son los
    ahorros anuales.

    Retorna la TIR como decimal (ej. 0.15 = 15 %) o None si no converge.
    """
    # Estimación inicial: retorno simple aproximado
    inversion = abs(flujos[0])
    suma_pos   = sum(f for f in flujos[1:] if f > 0)
    tasa       = (suma_pos / inversion / len(flujos)) if inversion > 0 else 0.1

    for _ in range(max_iter):
        vpn  = sum(f / (1 + tasa) ** k for k, f in enumerate(flujos))
        dvpn = sum(-k * f / (1 + tasa) ** (k + 1) for k, f in enumerate(flujos) if k > 0)

        if abs(dvpn) < 1e-12:
            break

        nueva_tasa = tasa - vpn / dvpn

        # Se mantiene la tasa en un rango razonable para evitar divergencia
        nueva_tasa = max(-0.99, min(nueva_tasa, 10.0))

        if abs(nueva_tasa - tasa) < tol:
            return round(nueva_tasa, 6)

        tasa = nueva_tasa

    return None


# Función principal 
def calcular_viabilidad(
    region: dict,
    area_m2: float,
    costo_instalacion: float,
    tasa_interes: float = TASA_INTERES_DEFAULT,
    anos_proyecto: int  = ANOS_PROYECTO_DEFAULT,
    eficiencia_override: float | None = None,
) -> dict:
    """
    Realiza el análisis completo de viabilidad económica de un sistema fotovoltaico.

    Fórmulas aplicadas:
      energia_anual  = area × radiacion × 365 × eficiencia , Recordar que esto es teorico ya que se esta asumiendo que toda la energia obtenida se utiliza siempre
      ahorro_año_k   = energia_año_k × tarifa
      energia_año_k  = energia_anual × (1 − degradacion)^k
      VP_año_k       = ahorro_año_k / (1 + i)^k
      VPN            = Σ VP_k(k=1..n) − costo_instalacion
      TIR            = tasa tal que VPN = 0
      P recuperacion = k* + fracción lineal al cruce de VP acumulado

    Parámetros:
    region              : dict con radiacion_kwh_m2_dia, tarifa_kwh_cop, eficiencia_paneles
    area_m2             : área disponible en m²
    costo_instalacion   : inversión inicial en COP
    tasa_interes        : tasa de descuento anual (decimal)
    anos_proyecto       : horizonte de evaluación en años
    eficiencia_override : si se proporciona, sobreescribe la eficiencia del CSV

    Retorna:
    dict con todos los indicadores y el flujo de caja año a año.
    """
    eficiencia = eficiencia_override if eficiencia_override is not None \
                 else region["eficiencia_paneles"]

    radiacion  = region["radiacion_kwh_m2_dia"]
    tarifa     = region["tarifa_kwh_cop"]
    i          = tasa_interes
    n          = anos_proyecto
    deg        = DEGRADACION_ANUAL

    # Año base 
    energia_anual_base = area_m2 * radiacion * 365 * eficiencia
    
    # Cálculo de ahorro año 1 (ingresos mixtos - OPEX)
    ingreso_autoconsumo_base = (energia_anual_base * PORCENTAJE_AUTOCONSUMO) * tarifa
    ingreso_excedentes_base  = (energia_anual_base * (1 - PORCENTAJE_AUTOCONSUMO)) * TARIFA_EXCEDENTES
    mantenimiento_base       = costo_instalacion * OPEX_ANUAL_PCT
    ahorro_anual_base        = ingreso_autoconsumo_base + ingreso_excedentes_base - mantenimiento_base
    ahorro_anual_base_vp    = ahorro_anual_base / (1 + i)  # VP del año 1 para referencia

    # Flujo de caja y VP acumulado 
    flujos        = [-costo_instalacion]   # flujo[0] = inversión inicial (−)
    flujo_caja    = []
    vp_acumulado  = -costo_instalacion
    periodo_rec   = None

    for k in range(1, n + 1):
        energia_k = energia_anual_base * math.pow(1 - deg, k)
        
        # Tarifas con inflación para el año k
        tarifa_plena_k = tarifa * math.pow(1 + INFLACION_ENERGIA_ANUAL, k - 1)
        tarifa_bolsa_k = TARIFA_EXCEDENTES * math.pow(1 + INFLACION_ENERGIA_ANUAL, k - 1)
        
        # Ahorro neto realista del año k
        ingreso_auto = (energia_k * PORCENTAJE_AUTOCONSUMO) * tarifa_plena_k
        ingreso_exce = (energia_k * (1 - PORCENTAJE_AUTOCONSUMO)) * tarifa_bolsa_k
        mantenimiento = costo_instalacion * OPEX_ANUAL_PCT
        
        ahorro_k = ingreso_auto + ingreso_exce - mantenimiento
        vp_k      = ahorro_k / math.pow(1 + i, k)
        vp_acumulado += vp_k

        # Período de recuperación: interpolación lineal al cruce con 0
        if periodo_rec is None and vp_acumulado >= 0:
            vp_anterior = vp_acumulado - vp_k
            periodo_rec = round((k - 1) + (-vp_anterior / vp_k), 4)

        flujos.append(ahorro_k)
        flujo_caja.append({
            "ano":              k,
            "energia_kwh":      round(energia_k, 2),
            "ahorro_cop":       round(ahorro_k, 2),
            "ahorro_vp_cop":    round(vp_k, 2),
            "vp_acumulado_cop": round(vp_acumulado, 2),
        })

    # Indicadores globales 
    vpn = round(vp_acumulado, 2)          # VPN = VP acumulado año n

    # TIR
    tir = _calcular_tir(flujos)

    # VPN por fórmula de serie uniforme (PA)
    factor_pa = (1 - math.pow(1 + i, -n)) / i if i > 0 else n
    vpn_serie_uniforme = round(ahorro_anual_base * factor_pa - costo_instalacion, 2)

    return {
        # Datos de entrada confirmados 
        "ciudad":            region.get("ciudad", ""),
        "grupo":             region.get("grupo", ""),
        "radiacion":         radiacion,
        "tarifa":            tarifa,
        "eficiencia":        round(eficiencia, 4),
        "area_m2":           area_m2,
        "costo_instalacion": costo_instalacion,

        # Parámetros económicos aplicados 
        "tasa_interes":      round(i, 4),
        "anos_proyecto":     n,
        "degradacion_anual": deg,

        # Resultados principales 
        "energia_anual_kwh": round(energia_anual_base, 2),
        "ahorro_anual_cop":  round(ahorro_anual_base, 2),
        "ahorro_anual_vp_cop": round(ahorro_anual_base_vp, 2),
        "vpn":               vpn,
        "tir":               tir,                        # decimal o null
        "periodo_rec":       periodo_rec,                # años (decimal) o null
        "viable":            vpn > 0,

        # Indicadores complementarios 
        "vpn_serie_uniforme": vpn_serie_uniforme,

        # Flujo de caja completo 
        "flujo_caja": flujo_caja,
    }