import json
from cargador_datos import obtener_region
from calculos import calcular_viabilidad

# Cambiar al dominio real antes de produccion
ALLOWED_ORIGIN = "https://www.su-dominio.com"

HEADERS = {
    "Access-Control-Allow-Origin":  "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type":                 "application/json",
}


def resp(status: int, body: dict) -> dict:
    return {"statusCode": status, "headers": HEADERS, "body": json.dumps(body, ensure_ascii=False)}


def lambda_handler(event, context):

    # Preflight CORS
    if event.get("requestContext", {}).get("http", {}).get("method") == "OPTIONS":
        return {"statusCode": 200, "headers": HEADERS, "body": ""}

    # Parsear body
    try:
        body = json.loads(event["body"]) if isinstance(event.get("body"), str) else event.get("body") or event
    except (json.JSONDecodeError, TypeError):
        return resp(400, {"error": "Body JSON invalido"})

    # Validar campos
    for campo in ["ciudad", "area_m2", "costo_instalacion"]:
        if campo not in body:
            return resp(400, {"error": f"Campo requerido faltante: {campo}"})

    try:
        ciudad = str(body["ciudad"])
        area   = float(body["area_m2"])
        costo  = float(body["costo_instalacion"])
    except (ValueError, TypeError) as e:
        return resp(400, {"error": str(e)})

    try:
        region    = obtener_region(ciudad)
        resultado = calcular_viabilidad(region, area, costo)
        return resp(200, resultado)
    except ValueError as e:
        return resp(422, {"error": str(e)})
    except Exception as e:
        return resp(500, {"error": f"Error interno: {str(e)}"})
