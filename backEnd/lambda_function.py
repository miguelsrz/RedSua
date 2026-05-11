"""
lambda_function.py  –  Handler AWS Lambda para RedSua
Utiliza API Gateway HTTP

Endpoints:
  POST /calcular        Análisis económico completo
  POST /analisis        Recomendación IA (es Gemini) a partir de los resultados de /calcular
  GET  /municipios      Lista de municipios disponibles

Campos aceptados en el body de /calcular:
  ciudad              (str,   requerido)
  area_m2             (float, requerido)
  costo_instalacion   (float, requerido)
  tasa_interes        (float, opcional, default 0.12)
  anos_proyecto       (int,   opcional, default 20)
  eficiencia_override (float, opcional, usa valor del CSV si se omite)
"""

import json # para manejo de JSON en requests y responses
import os   # para acceder a variables de entorno (clave API de Gemini)

# urllib se usa para hacer llamadas HTTP a la API de Gemini y manejar errores HTTP
import urllib.request   # para hacer llamadas HTTP a la API de Gemini
import urllib.error # para manejar errores HTTP al llamar a Gemini

from cargador_datos import obtener_region, listar_ciudades  # funciones para cargar datos de municipios y regiones
from calculos import calcular_viabilidad    # función principal de cálculos económicos (VPN, TIR, etc)

# Configuración 
ALLOWED_ORIGIN   = "https://redsua.co"      # dominio permitido para CORS

SECRET_HEADER    = "[#+PN1o8[&m{[7%!"       # header de autenticación interna

GEMINI_API_KEY   = os.environ.get("GEMINI_API_KEY", "") # clave API de Gemini obtenida de variable de entorno
GEMINI_MODEL     = "gemini-3.1-flash-lite-preview"  # Modelo Gemini 3.1 Flash Lite
GEMINI_ENDPOINT  = ( # URL de la API de generación de contenido de Gemini
    f"https://generativelanguage.googleapis.com/v1beta/models/"
    f"{GEMINI_MODEL}:generateContent?key={GEMINI_API_KEY}"
)

HEADERS = { # encabezados comunes para CORS y tipo de contenido JSON que se usarán en todas las respuestas
    "Access-Control-Allow-Origin":  ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, headerabc",
    "Content-Type":                 "application/json",
}


# Helpers 

# Función para construir respuestas HTTP consistentes
def resp(status: int, body: dict) -> dict:
    return {
        "statusCode": status,
        "headers":    HEADERS,
        "body":       json.dumps(body, ensure_ascii=False),
    }

# Función para obtener método HTTP de la request (GET, POST, etc)
def get_method(event: dict) -> str:
    return (
        event.get("requestContext", {})
             .get("http", {})
             .get("method", "")
             .upper()
    )

# Función para obtener path de la request (ej. /calcular, /municipios)
def get_path(event: dict) -> str:
    return event.get("rawPath", event.get("path", "/"))


# Funcion para construir el prompt para la IA (es Gemini) 
def _construir_prompt(d: dict) -> str:
    """
    Genera el prompt detallado para Gemini actuando como experto en
    ingeniería económica y energía solar.
    """
    # Formatear indicadores clave para incluirlos en el prompt de Gemini
    tir_str = (
        f"{d['tir'] * 100:.1f}%" if d["tir"] is not None else "no calculable"
    )
    periodo_str = (
        f"{d['periodo_rec']:.1f} años"
        if d["periodo_rec"] is not None
        else f"más de {d['anos_proyecto']} años"
    )
    viabilidad_str = "VIABLE (VPN positivo)" if d["viable"] else "NO VIABLE (VPN negativo)"

    # El prompt es un texto detallado que le da a Gemini toda la información del proyecto y los resultados económicos para que pueda generar una recomendación informada y contextualizada. Se le pide a Gemini que escriba en español de Colombia, con un tono profesional pero accesible, y que siga una estructura específica en su respuesta (veredicto, análisis, llamado a la acción, contexto regional).
    prompt = f"""Eres un experto en ingeniería económica con más de 15 años de experiencia evaluando proyectos de energía solar fotovoltaica en Colombia y Latinoamérica. Tu función es analizar indicadores financieros y dar una recomendación ejecutiva clara, directa y orientada a la acción.

DATOS DEL PROYECTO SOLAR A EVALUAR:

- Municipio:              {d['ciudad']} (Cundinamarca, Colombia)
- Zona de radiación:      Grupo {d['grupo']} — {d['radiacion']} kWh/m²/día (fuente: Atlas Solar IDEAM)
- Área instalada:         {d['area_m2']:,.0f} m²
- Inversión inicial:      ${d['costo_instalacion']:,.0f} COP
- Tarifa eléctrica local: {d['tarifa']} COP/kWh
- Eficiencia de paneles:  {d['eficiencia'] * 100:.0f}%
- Tasa de descuento (i):  {d['tasa_interes'] * 100:.1f}% anual
- Horizonte del proyecto: {d['anos_proyecto']} años
- Degradación anual:      {d['degradacion_anual'] * 100:.1f}% por año

RESULTADOS ECONÓMICOS:

- Energía generada (año 1): {d['energia_anual_kwh']:,.0f} kWh/año
- Ahorro año 1:             ${d['ahorro_anual_cop']:,.0f} COP
- VPN (Valor Presente Neto): ${d['vpn']:,.0f} COP
- TIR (Tasa Interna de Retorno): {tir_str}
- Período de recuperación descontado: {periodo_str}
- Veredicto económico: {viabilidad_str}

INSTRUCCIONES PARA TU RESPUESTA:

1. Escribe en español de Colombia, tono profesional pero accesible.
2. Longitud máxima: 4 párrafos breves o 180 palabras.
3. Estructura obligatoria:
   a) VEREDICTO: Una oración contundente que diga si el proyecto ES o NO es rentable y por qué (usa el VPN y la TIR como argumentos centrales). DEBE INCLUIR NOMBRE DE MUNICIPIO/CIUDAD/ZONA AL INICIO! no incluyas Cundinamarca solo el lugar.
   b) ANÁLISIS: Interpreta brevemente el período de recuperación en contexto (¿es corto o largo para un proyecto solar en Colombia?). Menciona si la TIR supera la tasa de descuento y qué significa eso.
   c) LLAMADO A LA ACCIÓN: DE MANERA CORTA: Si es viable → di claramente qué debería hacer el inversionista ahora (proceder, buscar cotizaciones, etc.). Si no es viable → sugiere 1 o 2 ajustes concretos (reducir costo, ampliar área, revisar tarifa) para mejorar la rentabilidad.
   d) CONTEXTO REGIONAL: Una oración CORTA sobre la ventaja o desventaja solar de {d['ciudad']} vs otras zonas de Cundinamarca sin mencionar las otras zonas.
4. NO uses listas con viñetas. Escribe en párrafos fluidos.
5. NO incluyas saludos, despedidas ni metadatos. Empieza directo con el veredicto.
6. Usa cifras del análisis en tu texto para dar credibilidad."""

    return prompt

# Función para llamar a la API de Gemini con el prompt construido y obtener la recomendación generada por la IA. Se maneja cualquier error que pueda ocurrir durante la llamada HTTP y se retorna un mensaje de error amigable si no se puede obtener la recomendación.
def _llamar_gemini(prompt: str) -> str:
    """
    Llama a la API de Gemini y retorna el texto generado.
    Retorna un string vacío si falla (el front mostrará el análisis sin IA).
    """
    # Si no hay clave API, no se puede llamar a Gemini, así que se retorna un mensaje de error específico para ese caso.
    if not GEMINI_API_KEY:
        return "ERROR: Recomendación IA no disponible."

    # Payload (es decir los datos que se envian) para la API de Gemini, siguiendo la estructura requerida por la API. Se incluye el prompt en "contents" y se configuran los parámetros de generación (temperature, maxOutputTokens, topP) para obtener respuestas consistentes y profesionales, con una longitud máxima de aproximadamente 280 palabras.
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": { # Esta configuracion permite tener un uso consistente de los limites gratuito de la API de Gemini, evitando respuestas demasiado largas o inconsistentes
            "temperature":     0.4,   # respuestas consistentes y profesionales
            "maxOutputTokens": 400,   # alrededor de 280 palabras máximo
            "topP":            0.85,
        },
        "safetySettings": [
            {"category": "HARM_CATEGORY_DANGEROUS_CONTENT", "threshold": "BLOCK_NONE"},
        ],
    }

    try: # Intentamos hacer la llamada HTTP a la API de Gemini. Si ocurre cualquier error (como problemas de red, errores HTTP, o respuestas mal formateadas), se captura la excepción y se retorna un mensaje de error amigable en lugar de la recomendación IA.
        
        req = urllib.request.Request( # URL de la API de Gemini, con el payload JSON y los encabezados necesarios para indicar que el contenido es JSON
            GEMINI_ENDPOINT,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=30) as r: # Hacemos la llamada HTTP y esperamos la respuesta. Se establece un timeout de 30 segundos para evitar que la función Lambda quede colgada esperando una respuesta de Gemini.
            data = json.loads(r.read().decode("utf-8"))
        return data["candidates"][0]["content"]["parts"][0]["text"].strip() # Extraemos el texto generado por Gemini de la respuesta JSON y lo retornamos. Si la respuesta no tiene el formato esperado, esto podría lanzar una excepción que será capturada por el bloque except.
    except Exception as exc: # Cualquier error que ocurra durante la llamada a Gemini o el procesamiento de la respuesta se captura aquí. Se imprime el error en los logs para diagnóstico, y se retorna un mensaje de error amigable que indica que no fue posible generar la recomendación IA en este momento.
        print(f"[Gemini error] {exc}")
        return "No fue posible generar la recomendación IA en este momento."

# Handler principal, este maneja las solicitudes entrantes a la función Lambda, autentica usando un header secreto, enruta según el método HTTP y el path, valida los datos de entrada, llama a las funciones de cálculo y generación de recomendaciones, y construye las respuestas HTTP adecuadas para cada caso (incluyendo manejo de errores). 
# Es el punto de entrada para todas las solicitudes que llegan a esta función Lambda a través del API Gateway.
def lambda_handler(event, context):

    # Autenticación 
    headers_evt = {k.lower(): v for k, v in (event.get("headers") or {}).items()}
    if headers_evt.get("headerabc") != SECRET_HEADER:
        return resp(403, {"error": "Acceso denegado"})

    # Enrutamiento básico basado en método HTTP y path. Se obtiene el método (GET, POST, etc.) y el path de la solicitud para determinar qué acción tomar
    method = get_method(event)
    path   = get_path(event)

    # CORS preflight 
    # Las solicitudes OPTIONS son preflight requests que los navegadores envían para verificar permisos CORS antes de hacer la solicitud real. Aquí se responde con un status 200 y los encabezados CORS necesarios para permitir que el navegador proceda con la solicitud real.
    if method == "OPTIONS":
        return {"statusCode": 200, "headers": HEADERS, "body": ""}

    # GET /municipios 
    # Si la solicitud es un GET al path que termina con "municipios", se llama a la función listar_ciudades() 
    # para obtener la lista de municipios disponibles, y se retorna esa lista en una respuesta JSON. 
    # Si ocurre cualquier error durante este proceso, se captura la excepción y se retorna un error 500 con un mensaje de error amigable.
    if method == "GET" and path.rstrip("/").endswith("municipios"):
        try:
            return resp(200, {"municipios": listar_ciudades()})
        except Exception as e:
            return resp(500, {"error": f"Error interno: {e}"})

    # POST /calcular 
    # Si la solicitud es un POST al path que termina con "calcular", se espera que el body de la 
    # solicitud contenga los datos necesarios para realizar el análisis económico del proyecto solar. Se parsea el body, se validan los campos requeridos y sus tipos, 
    # se realizan los cálculos económicos llamando a calcular_viabilidad(), se genera la recomendación IA llamando a _llamar_gemini(), y finalmente se construye una respuesta JSON con todos los resultados y la recomendación IA. 
    # Si ocurre cualquier error durante este proceso (como JSON mal formado, campos faltantes, errores de validación, errores en los cálculos, o errores al llamar a Gemini), se captura la excepción y se retorna un error con un mensaje amigable que indique qué salió mal.
    if method == "POST" and path.rstrip("/").endswith("calcular"):

        # Parsear body
        try:
            body = (
                json.loads(event["body"])
                if isinstance(event.get("body"), str)
                else (event.get("body") or event)
            )
        except (json.JSONDecodeError, TypeError):
            return resp(400, {"error": "Body JSON inválido"})

        # Campos requeridos
        for campo in ["ciudad", "area_m2", "costo_instalacion"]:
            if campo not in body:
                return resp(400, {"error": f"Campo requerido faltante: {campo}"})

        # Parsear y validar tipos
        try:
            ciudad  = str(body["ciudad"]).strip()
            area    = float(body["area_m2"])
            costo   = float(body["costo_instalacion"])

            # Parámetros opcionales con valores por defecto
            tasa    = float(body.get("tasa_interes",  0.12))
            anos    = int(body.get("anos_proyecto",   20))
            efic_ov = body.get("eficiencia_override")
            if efic_ov is not None:
                efic_ov = float(efic_ov)

        except (ValueError, TypeError) as e:
            return resp(400, {"error": f"Tipo de dato inválido: {e}"})

        # Validaciones de rango
        if area <= 0 or area > 50_000:
            return resp(422, {"error": "area_m2 debe estar entre 1 y 50,000 m²"})
        if costo <= 0:
            return resp(422, {"error": "costo_instalacion debe ser mayor a 0"})
        if not (0 < tasa < 1):
            return resp(422, {"error": "tasa_interes debe ser un decimal entre 0 y 1 (ej. 0.12)"})
        if not (5 <= anos <= 40):
            return resp(422, {"error": "anos_proyecto debe estar entre 5 y 40"})
        if efic_ov is not None and not (0 < efic_ov < 1):
            return resp(422, {"error": "eficiencia_override debe ser decimal entre 0 y 1 (ej. 0.20)"})

        # Cálculos
        try:
            region    = obtener_region(ciudad)
            resultado = calcular_viabilidad(
                region              = region,
                area_m2             = area,
                costo_instalacion   = costo,
                tasa_interes        = tasa,
                anos_proyecto       = anos,
                eficiencia_override = efic_ov,
            )
        except ValueError as e:
            return resp(422, {"error": str(e)})
        except Exception as e:
            return resp(500, {"error": f"Error interno en cálculo: {e}"})

        return resp(200, resultado)

    # POST /analisis
    # Recibe el resultado completo de /calcular (ya calculado en el front) y llama a Gemini
    # para generar la recomendación IA. De esta manera el front puede mostrar los resultados
    # económicos de inmediato y cargar la recomendación IA de forma independiente.
    if method == "POST" and path.rstrip("/").endswith("analisis"):

        # Parsear body
        try:
            body = (
                json.loads(event["body"])
                if isinstance(event.get("body"), str)
                else (event.get("body") or event)
            )
        except (json.JSONDecodeError, TypeError):
            return resp(400, {"error": "Body JSON inválido"})

        # Recomendación IA (es Gemini)
        try:
            prompt        = _construir_prompt(body)
            recomendacion = _llamar_gemini(prompt)
        except Exception as e:
            print(f"Error al llamar a Gemini: {e}")
            recomendacion = "No fue posible generar la recomendación IA."

        return resp(200, {"recomendacion_ia": recomendacion})

    # Ruta no encontrada 
    return resp(404, {"error": f"Ruta '{path}' con método '{method}' no encontrada"})