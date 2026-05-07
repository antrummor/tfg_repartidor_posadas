from fastapi import FastAPI, UploadFile, File, Depends
from sqlalchemy.orm import Session
import pandas as pd
import io
import requests
import time
from geopy.geocoders import Nominatim 

from database import SessionLocal, engine, Base
import models

# Crear las tablas si no existen
models.Base.metadata.create_all(bind=engine)

app = FastAPI()
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configuramos el buscador de mapas con un nombre único
geolocator = Nominatim(user_agent="tfg_reparto_posadas_antonio_2026")

# Función para obtener la conexión a la BD
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

@app.get("/")
def inicio():
    return {"mensaje": "Backend y Base de Datos conectados"}

@app.post("/importar-csv")
async def importar_csv(file: UploadFile = File(...), db: Session = Depends(get_db)):
    contenido = await file.read()
    df = pd.read_csv(io.BytesIO(contenido))
    
    contador = 0
    for _, fila in df.iterrows():
        # 1. Buscamos las coordenadas de la dirección
        print(f"Buscando: {fila['direccion']}...")
        location = geolocator.geocode(fila['direccion'])
        
        lat, lon = None, None
        if location:
            lat, lon = location.latitude, location.longitude
            print(f"✅ Encontrado: {lat}, {lon}")
        else:
            print(f"❌ No se encontró: {fila['direccion']}")

        # 2. Creamos el paquete con TODOS los datos (incluidas coordenadas)
        nuevo_paquete = models.Paquete(
            direccion=fila['direccion'],
            cliente=fila['cliente'],
            tamano=fila['tamano'],
            observaciones=fila['observaciones'],
            latitud=lat,  # <--- ¡Ahora sí!
            longitud=lon   # <--- ¡Ahora sí!
        )
        db.add(nuevo_paquete)
        contador += 1
        
        # Respetamos el límite del servicio gratuito (1 segundo entre búsquedas)
        time.sleep(1.2)
    
    db.commit()
    return {"mensaje": f"Se han importado {contador} paquetes. Revisa la terminal para ver si hubo errores de mapa."}

@app.get("/calcular-ruta-optima")
def calcular_ruta(db: Session = Depends(get_db)):
    paquetes = db.query(models.Paquete).filter(models.Paquete.latitud != None).all()
    if not paquetes:
        return {"error": "No hay paquetes con coordenadas"}

    # 1. Preparamos las coordenadas
    coords = ";".join([f"{p.longitud},{p.latitud}" for p in paquetes])
    
    # Quitamos el roundtrip=false para que tu versión de Docker no se queje
    url = f"http://localhost:5000/trip/v1/driving/{coords}?geometries=geojson&overview=full"

    try:
        response = requests.get(url)
        data = response.json()
        
        if data.get("code") != "Ok":
            # ¡AQUÍ ESTÁ LA TRAMPA PARA CAZAR EL ERROR!
            return {
                "error": "OSRM no pudo optimizar la ruta",
                "codigo_osrm": data.get("code"),
                "motivo_real": data.get("message")
            }

        # OSRM nos devuelve la línea de la calle
        geometria_calle = data['trips'][0]['geometry']

        # OSRM nos dice en qué orden debemos visitar los puntos
        puntos_ordenados = [None] * len(paquetes)
        for i, wp in enumerate(data['waypoints']):
            posicion_optima = wp['waypoint_index']
            puntos_ordenados[posicion_optima] = {
                "lat": paquetes[i].latitud,
                "lon": paquetes[i].longitud,
                "dir": paquetes[i].direccion
            }

        return {
            "mensaje": "Ruta optimizada con éxito",
            "puntos_entrega": puntos_ordenados,
            "ruta_completa": geometria_calle
        }
    except Exception as e:
        return {"error": f"Error de conexión: {str(e)}"}
    
@app.delete("/borrar-todos-los-paquetes")
def borrar_paquetes(db: Session = Depends(get_db)):
    try:
        # Esto borra las filas
        db.query(models.Paquete).delete()
        # Esto GUARDA el cambio en la base de datos (vital)
        db.commit()
        return {"mensaje": "Todos los paquetes borrados correctamente"}
    except Exception as e:
        db.rollback() # Si falla, deshace el error
        return {"error": f"Error al borrar: {str(e)}"}