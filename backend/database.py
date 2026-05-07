from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

# Configuramos la URL de conexión usando los datos de tu propuesta
# Formato: postgresql://usuario:password@localhost:puerto/nombre_db
SQLALCHEMY_DATABASE_URL = "postgresql://usuario_reparto:password_seguro@localhost:5432/reparto_db"
# El 'engine' es el encargado de hablar con la base de datos
engine = create_engine(SQLALCHEMY_DATABASE_URL)

# La 'SessionLocal' es lo que usaremos cada vez que queramos guardar algo
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Esta es la base de la que heredarán todas nuestras futuras tablas (Paquetes, Rutas...)
Base = declarative_base()