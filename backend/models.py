from sqlalchemy import Column, Integer, String, Float, Boolean
from database import Base

class Paquete(Base):
    __tablename__ = "paquetes"

    id = Column(Integer, primary_key=True, index=True)
    direccion = Column(String)  # Para la geocodificación automática 
    cliente = Column(String)    # Nombre del cliente [cite: 6]
    tamano = Column(String)     # Campo para la capacidad de carga [cite: 5]
    observaciones = Column(String) # "Llamar al timbre", "vecina", etc [cite: 6]
    entregado = Column(Boolean, default=False) # Para marcar como entregado [cite: 6]
    latitud = Column(Float)     # Coordenada X para la ruta [cite: 4]
    longitud = Column(Float)    # Coordenada Y para la ruta [cite: 4]