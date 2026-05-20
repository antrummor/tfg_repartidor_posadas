from pathlib import Path
import io
import time

import pandas as pd
import requests
from fastapi import Depends, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from geopy.geocoders import Nominatim
from pydantic import BaseModel
from sqlalchemy import or_
from sqlalchemy.orm import Session

from database import Base, SessionLocal, engine
import models


Base.metadata.create_all(bind=engine)

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_DIR = Path(__file__).resolve().parent.parent
FRONTEND_DIR = BASE_DIR / "frontend"

app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")

# Configuramos el buscador de mapas con un nombre unico.
geolocator = Nominatim(user_agent="tfg_reparto_posadas_antonio_2026")


class EstadoEntrega(BaseModel):
    entregado: bool


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def frontend_file(nombre: str):
    ruta = FRONTEND_DIR / nombre
    if not ruta.exists():
        raise HTTPException(status_code=404, detail="Pagina no encontrada")
    return FileResponse(ruta)


def texto_csv(valor):
    if pd.isna(valor):
        return ""
    return str(valor).strip()


def paquete_dict(paquete: models.Paquete):
    return {
        "id": paquete.id,
        "direccion": paquete.direccion or "",
        "cliente": paquete.cliente or "",
        "tamano": paquete.tamano or "",
        "observaciones": paquete.observaciones or "",
        "entregado": bool(paquete.entregado),
        "latitud": paquete.latitud,
        "longitud": paquete.longitud,
        "tiene_coordenadas": paquete.latitud is not None and paquete.longitud is not None,
    }


def paquete_ruta_dict(paquete: models.Paquete):
    datos = paquete_dict(paquete)
    datos.update(
        {
            "lat": paquete.latitud,
            "lon": paquete.longitud,
            "dir": paquete.direccion or "",
        }
    )
    return datos


def consulta_pendientes_con_coordenadas(db: Session):
    return (
        db.query(models.Paquete)
        .filter(models.Paquete.latitud.isnot(None))
        .filter(models.Paquete.longitud.isnot(None))
        .filter(or_(models.Paquete.entregado.is_(False), models.Paquete.entregado.is_(None)))
        .order_by(models.Paquete.id)
    )


@app.get("/")
def inicio():
    return frontend_file("index.html")


@app.get("/subir-csv")
def pagina_subir_csv():
    return frontend_file("subir-csv.html")


@app.get("/paquetes")
def pagina_paquetes():
    return frontend_file("paquetes.html")


@app.get("/ruta")
def pagina_ruta():
    return frontend_file("ruta.html")


@app.get("/mapa.html")
def ver_mapa_compatibilidad():
    return frontend_file("ruta.html")


@app.get("/estado")
def estado():
    return {"mensaje": "Backend y Base de Datos conectados"}


@app.get("/api/paquetes")
def listar_paquetes(db: Session = Depends(get_db)):
    paquetes = db.query(models.Paquete).order_by(models.Paquete.id).all()
    paquetes_json = [paquete_dict(paquete) for paquete in paquetes]
    entregados = sum(1 for paquete in paquetes_json if paquete["entregado"])

    return {
        "paquetes": paquetes_json,
        "total": len(paquetes_json),
        "pendientes": len(paquetes_json) - entregados,
        "entregados": entregados,
    }


@app.patch("/api/paquetes/{paquete_id}/entrega")
def actualizar_entrega(paquete_id: int, estado_entrega: EstadoEntrega, db: Session = Depends(get_db)):
    paquete = db.query(models.Paquete).filter(models.Paquete.id == paquete_id).first()
    if not paquete:
        raise HTTPException(status_code=404, detail="Paquete no encontrado")

    paquete.entregado = estado_entrega.entregado
    db.commit()
    db.refresh(paquete)
    return {"mensaje": "Estado actualizado", "paquete": paquete_dict(paquete)}


@app.post("/importar-csv")
async def importar_csv(file: UploadFile = File(...), db: Session = Depends(get_db)):
    contenido = await file.read()
    df = pd.read_csv(io.BytesIO(contenido))

    columnas_obligatorias = {"direccion", "cliente", "tamano", "observaciones"}
    faltantes = columnas_obligatorias.difference(df.columns)
    if faltantes:
        raise HTTPException(
            status_code=400,
            detail=f"Faltan columnas en el CSV: {', '.join(sorted(faltantes))}",
        )

    importados = 0
    omitidos = 0

    for _, fila in df.iterrows():
        direccion = texto_csv(fila["direccion"])
        if not direccion:
            omitidos += 1
            continue

        print(f"Buscando: {direccion}...")
        try:
            location = geolocator.geocode(direccion)
        except Exception as exc:
            print(f"No se pudo geocodificar {direccion}: {exc}")
            location = None

        lat, lon = None, None
        if location:
            lat, lon = location.latitude, location.longitude
            print(f"Encontrado: {lat}, {lon}")
        else:
            print(f"No se encontro: {direccion}")

        nuevo_paquete = models.Paquete(
            direccion=direccion,
            cliente=texto_csv(fila["cliente"]),
            tamano=texto_csv(fila["tamano"]),
            observaciones=texto_csv(fila["observaciones"]),
            entregado=False,
            latitud=lat,
            longitud=lon,
        )
        db.add(nuevo_paquete)
        importados += 1

        # Respetamos el limite del servicio gratuito.
        time.sleep(1.2)

    db.commit()

    mensaje = f"Se han importado {importados} paquetes."
    if omitidos:
        mensaje += f" Se han omitido {omitidos} filas sin direccion."
    return {"mensaje": mensaje}


@app.get("/calcular-ruta-optima")
def calcular_ruta(db: Session = Depends(get_db)):
    paquetes = consulta_pendientes_con_coordenadas(db).all()
    if not paquetes:
        return {"error": "No hay paquetes pendientes con coordenadas"}

    if len(paquetes) == 1:
        paquete = paquetes[0]
        return {
            "mensaje": "Solo hay un paquete pendiente con coordenadas",
            "puntos_entrega": [paquete_ruta_dict(paquete)],
            "ruta_completa": {
                "type": "LineString",
                "coordinates": [
                    [paquete.longitud, paquete.latitud],
                    [paquete.longitud, paquete.latitud],
                ],
            },
        }

    coords = ";".join([f"{p.longitud},{p.latitud}" for p in paquetes])
    url = f"http://localhost:5000/trip/v1/driving/{coords}?geometries=geojson&overview=full"

    try:
        response = requests.get(url, timeout=20)
        data = response.json()

        if data.get("code") != "Ok":
            return {
                "error": "OSRM no pudo optimizar la ruta",
                "codigo_osrm": data.get("code"),
                "motivo_real": data.get("message"),
            }

        geometria_calle = data["trips"][0]["geometry"]

        puntos_ordenados = [None] * len(paquetes)
        for i, waypoint in enumerate(data["waypoints"]):
            posicion_optima = waypoint["waypoint_index"]
            puntos_ordenados[posicion_optima] = paquete_ruta_dict(paquetes[i])

        return {
            "mensaje": "Ruta optimizada con exito",
            "puntos_entrega": puntos_ordenados,
            "ruta_completa": geometria_calle,
        }
    except Exception as exc:
        return {"error": f"Error de conexion: {str(exc)}"}


@app.delete("/borrar-todos-los-paquetes")
def borrar_paquetes(db: Session = Depends(get_db)):
    try:
        db.query(models.Paquete).delete()
        db.commit()
        return {"mensaje": "Todos los paquetes borrados correctamente"}
    except Exception as exc:
        db.rollback()
        return {"error": f"Error al borrar: {str(exc)}"}
