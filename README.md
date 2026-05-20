# Repartidor Posadas

Aplicacion web para cargar paquetes desde un CSV, guardarlos en PostgreSQL, calcular una ruta optimizada con OSRM y gestionar el estado de entrega de cada paquete.

## Funcionalidades

- Subida de paquetes desde CSV.
- Listado de paquetes cargados.
- Calculo de ruta optimizada sobre mapa.
- Consulta de observaciones por paquete.
- Marcado de paquetes como entregados.
- Opcion de volver a marcar un paquete como no entregado si se pulsa por error.

## Requisitos

- Git.
- Python 3.10 o superior.
- Docker Desktop.
- Docker Compose.

## Descargar el proyecto

```powershell
git clone https://github.com/antrummor/tfg_repartidor_posadas.git
cd tfg_repartidor_posadas
```

## Crear el entorno de Python

En Windows PowerShell:

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

Si PowerShell no permite activar el entorno virtual, ejecuta:

```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
.\.venv\Scripts\Activate.ps1
```

## Preparar OSRM

El proyecto usa OSRM para calcular rutas. Los archivos de mapa son grandes y no se suben a GitHub porque estan ignorados en `.gitignore`.

La carpeta esperada es:

```text
infra/osrm_data/
```

El `docker-compose.yml` espera encontrar estos archivos ya procesados:

```text
infra/osrm_data/posadas_editado.osrm
infra/osrm_data/posadas_editado.osrm.*
```

Si ya tienes esos archivos, copialos dentro de `infra/osrm_data/`.

Si tienes el archivo `posadas_editado.osm.pbf`, puedes generar los archivos de OSRM con:

```powershell
docker run -t -v "${PWD}\infra\osrm_data:/data" osrm/osrm-backend osrm-extract -p /opt/car.lua /data/posadas_editado.osm.pbf
docker run -t -v "${PWD}\infra\osrm_data:/data" osrm/osrm-backend osrm-partition /data/posadas_editado.osrm
docker run -t -v "${PWD}\infra\osrm_data:/data" osrm/osrm-backend osrm-customize /data/posadas_editado.osrm
```

## Levantar PostgreSQL y OSRM

Desde la raiz del proyecto:

```powershell
docker compose up -d
```

Esto levanta:

- PostgreSQL en `localhost:5432`.
- OSRM en `localhost:5000`.

Para comprobar que estan activos:

```powershell
docker ps
```

## Arrancar el backend

En otra terminal, desde la raiz del proyecto:

```powershell
.\.venv\Scripts\Activate.ps1
cd backend
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

Cuando arranque, abre:

```text
http://127.0.0.1:8000/
```

## Paginas principales

- Inicio: `http://127.0.0.1:8000/`
- Paquetes cargados: `http://127.0.0.1:8000/paquetes`
- Subir CSV: `http://127.0.0.1:8000/subir-csv`
- Ruta optimizada: `http://127.0.0.1:8000/ruta`

## Formato del CSV

El CSV debe tener estas columnas:

```csv
direccion,cliente,tamano,observaciones
"Calle Mesones 1, 14730, Posadas, Cordoba, Espana",Antonio,Mediano,Entregar en mano
```

Las direcciones se geocodifican al importar el CSV, por eso la carga puede tardar unos segundos por cada paquete.

## Uso basico

1. Abre `http://127.0.0.1:8000/`.
2. Entra en `Subir CSV`.
3. Carga un archivo con paquetes.
4. Entra en `Paquetes` para revisar los datos.
5. Entra en `Ruta` para generar el recorrido.
6. Usa `INFO` para ver observaciones.
7. Pulsa `Entregado` cuando un paquete se haya entregado.
8. Si te equivocas, pulsa `No entregado` para restaurarlo.

## Base de datos

La conexion esta configurada en `backend/database.py`:

```text
postgresql://usuario_reparto:password_seguro@localhost:5432/reparto_db
```

Esos valores coinciden con el servicio `db` de `docker-compose.yml`.

## Comandos utiles

Detener los contenedores:

```powershell
docker compose down
```

Ver logs:

```powershell
docker compose logs -f
```

Borrar todos los paquetes desde la aplicacion:

```text
http://127.0.0.1:8000/subir-csv
```

## Subir cambios a GitHub

```powershell
git status
git add .
git commit -m "Anade documentacion de instalacion"
git push origin main
```
