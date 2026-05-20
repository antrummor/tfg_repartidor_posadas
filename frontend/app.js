const API_URL = window.location.protocol === "file:" ? "http://127.0.0.1:8000" : "";

const htmlEscapeMap = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
};

function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => htmlEscapeMap[char]);
}

function detailToMessage(data) {
    if (!data) return "Error desconocido";
    if (typeof data.detail === "string") return data.detail;
    if (Array.isArray(data.detail)) return data.detail.map((item) => item.msg || JSON.stringify(item)).join(", ");
    return data.error || data.mensaje || "Error desconocido";
}

async function fetchJson(path, options = {}) {
    const response = await fetch(`${API_URL}${path}`, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(detailToMessage(data));
    }
    return data;
}

async function apiRequest(path, options = {}) {
    const data = await fetchJson(path, options);
    if (data.error) {
        throw new Error(detailToMessage(data));
    }
    return data;
}

function setStatus(element, message, type = "") {
    if (!element) return;
    element.textContent = message;
    element.classList.remove("ok", "error");
    if (type) element.classList.add(type);
}

function renderStats(data) {
    const total = document.getElementById("stat-total");
    const pending = document.getElementById("stat-pending");
    const delivered = document.getElementById("stat-delivered");

    if (total) total.textContent = data.total ?? 0;
    if (pending) pending.textContent = data.pendientes ?? 0;
    if (delivered) delivered.textContent = data.entregados ?? 0;
}

async function loadPackageSummary(statusElement) {
    try {
        const data = await apiRequest("/api/paquetes");
        renderStats(data);
        return data;
    } catch (error) {
        setStatus(statusElement, `No se pudo cargar el resumen: ${error.message}`, "error");
        throw error;
    }
}

async function markDelivery(packageId, delivered) {
    return apiRequest(`/api/paquetes/${packageId}/entrega`, {
        method: "PATCH",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ entregado: delivered })
    });
}

function initHome() {
    const status = document.getElementById("home-status");
    loadPackageSummary(status)
        .then((data) => {
            if (data.total === 0) {
                setStatus(status, "Todavia no hay paquetes cargados. Sube un CSV para empezar.");
            } else {
                setStatus(status, `${data.pendientes} paquetes pendientes preparados para la ruta.`, "ok");
            }
        })
        .catch(() => {});
}

function initUpload() {
    const fileInput = document.getElementById("csv-file");
    const uploadButton = document.getElementById("upload-button");
    const deleteButton = document.getElementById("delete-button");
    const status = document.getElementById("upload-status");

    uploadButton.addEventListener("click", async () => {
        const file = fileInput.files[0];
        if (!file) {
            setStatus(status, "Elige un archivo CSV antes de cargarlo.", "error");
            return;
        }

        const formData = new FormData();
        formData.append("file", file);

        uploadButton.disabled = true;
        deleteButton.disabled = true;
        setStatus(status, "Cargando paquetes y buscando coordenadas. Puede tardar unos segundos por direccion.");

        try {
            const data = await apiRequest("/importar-csv", {
                method: "POST",
                body: formData
            });
            setStatus(status, data.mensaje || "CSV importado correctamente.", "ok");
            fileInput.value = "";
        } catch (error) {
            setStatus(status, `Error: ${error.message}`, "error");
        } finally {
            uploadButton.disabled = false;
            deleteButton.disabled = false;
        }
    });

    deleteButton.addEventListener("click", async () => {
        if (!confirm("Seguro que quieres borrar todos los paquetes de la base de datos?")) {
            return;
        }

        uploadButton.disabled = true;
        deleteButton.disabled = true;
        setStatus(status, "Eliminando paquetes...");

        try {
            const data = await apiRequest("/borrar-todos-los-paquetes", { method: "DELETE" });
            setStatus(status, data.mensaje || "Datos eliminados correctamente.", "ok");
        } catch (error) {
            setStatus(status, `Error: ${error.message}`, "error");
        } finally {
            uploadButton.disabled = false;
            deleteButton.disabled = false;
        }
    });
}

function packageCard(packageItem) {
    const delivered = Boolean(packageItem.entregado);
    const statusClass = delivered ? "delivered" : "pending";
    const statusText = delivered ? "Entregado" : "Pendiente";
    const nextDelivered = delivered ? "false" : "true";
    const actionText = delivered ? "No entregado" : "Entregado";
    const coordText = packageItem.tiene_coordenadas ? "Con coordenadas" : "Sin coordenadas";
    const observations = packageItem.observaciones || "Sin observaciones";

    return `
        <article class="package-card" data-package-id="${packageItem.id}">
            <div class="package-main">
                <div class="package-heading">
                    <strong>${escapeHtml(packageItem.cliente || "Sin cliente")}</strong>
                    <span class="badge ${statusClass}">${statusText}</span>
                    <span class="badge">${escapeHtml(packageItem.tamano || "Sin tamano")}</span>
                    <span class="badge">${coordText}</span>
                </div>
                <p class="package-address">${escapeHtml(packageItem.direccion || "Sin direccion")}</p>
                <p class="package-observations">${escapeHtml(observations)}</p>
            </div>
            <div class="package-actions">
                <button class="button ghost small" type="button" data-delivery-id="${packageItem.id}" data-next-delivered="${nextDelivered}">
                    ${actionText}
                </button>
            </div>
        </article>
    `;
}

function initPackages() {
    const list = document.getElementById("packages-list");
    const status = document.getElementById("packages-status");
    const refreshButton = document.getElementById("refresh-packages");
    const filterButtons = Array.from(document.querySelectorAll("[data-filter]"));

    let currentFilter = "all";
    let packageData = [];

    function renderList() {
        const filtered = packageData.filter((packageItem) => {
            if (currentFilter === "pending") return !packageItem.entregado;
            if (currentFilter === "delivered") return packageItem.entregado;
            return true;
        });

        if (!filtered.length) {
            list.innerHTML = `<div class="empty-state">No hay paquetes para este filtro.</div>`;
            return;
        }

        list.innerHTML = filtered.map(packageCard).join("");
    }

    async function loadPackages() {
        setStatus(status, "Cargando paquetes...");
        try {
            const data = await apiRequest("/api/paquetes");
            packageData = data.paquetes || [];
            renderStats(data);
            renderList();
            setStatus(status, `${packageData.length} paquetes cargados.`, "ok");
        } catch (error) {
            setStatus(status, `Error: ${error.message}`, "error");
            list.innerHTML = "";
        }
    }

    filterButtons.forEach((button) => {
        button.addEventListener("click", () => {
            currentFilter = button.dataset.filter;
            filterButtons.forEach((item) => item.classList.toggle("active", item === button));
            renderList();
        });
    });

    refreshButton.addEventListener("click", loadPackages);

    list.addEventListener("click", async (event) => {
        const button = event.target.closest("[data-delivery-id]");
        if (!button) return;

        const packageId = Number(button.dataset.deliveryId);
        const nextDelivered = button.dataset.nextDelivered === "true";

        button.disabled = true;
        setStatus(status, "Actualizando estado del paquete...");

        try {
            await markDelivery(packageId, nextDelivered);
            await loadPackages();
        } catch (error) {
            setStatus(status, `Error: ${error.message}`, "error");
            button.disabled = false;
        }
    });

    loadPackages();
}

function initRoute() {
    const status = document.getElementById("route-status");
    const routeList = document.getElementById("route-list");
    const undoArea = document.getElementById("undo-area");
    const refreshButton = document.getElementById("refresh-route");

    if (!window.L) {
        setStatus(status, "No se pudo cargar Leaflet. Revisa la conexion para mostrar el mapa.", "error");
        return;
    }

    const map = L.map("map").setView([37.802, -5.103], 15);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap"
    }).addTo(map);

    const markerLayer = L.layerGroup().addTo(map);
    let routeLayer = null;
    let currentRoute = [];
    let recentlyDelivered = [];

    function markerClass(index, total) {
        if (index === 0) return "start";
        if (index === total - 1) return "finish";
        return "";
    }

    function routeCard(packageItem, index, total) {
        const stopNumber = index + 1;
        const markerType = markerClass(index, total);
        const observations = packageItem.observaciones || "Sin observaciones";

        return `
            <article class="route-card ${markerType}" data-package-id="${packageItem.id}">
                <div class="stop-number">${stopNumber}</div>
                <div class="route-card-main">
                    <strong>${escapeHtml(packageItem.cliente || "Sin cliente")}</strong>
                    <span>${escapeHtml(packageItem.direccion || "Sin direccion")}</span>
                    <span class="meta-line">${escapeHtml(packageItem.tamano || "Sin tamano")}</span>
                    <div class="route-actions">
                        <button class="button ghost small" type="button" data-action="info">INFO</button>
                        <button class="button primary small" type="button" data-action="deliver">Entregado</button>
                    </div>
                    <div class="observation" hidden>
                        <strong>Observaciones</strong>
                        <p>${escapeHtml(observations)}</p>
                    </div>
                </div>
            </article>
        `;
    }

    function renderUndo() {
        if (!recentlyDelivered.length) {
            undoArea.innerHTML = "";
            return;
        }

        undoArea.innerHTML = `
            <section class="undo-panel">
                <strong>Entregas marcadas en esta sesion</strong>
                ${recentlyDelivered.map((packageItem) => `
                    <div class="undo-item">
                        <span>${escapeHtml(packageItem.cliente || packageItem.direccion || `Paquete ${packageItem.id}`)}</span>
                        <button class="button danger-outline small" type="button" data-undo-id="${packageItem.id}">
                            No entregado
                        </button>
                    </div>
                `).join("")}
            </section>
        `;
    }

    function clearMap() {
        markerLayer.clearLayers();
        if (routeLayer) {
            map.removeLayer(routeLayer);
            routeLayer = null;
        }
    }

    async function renderRoute() {
        refreshButton.disabled = true;
        clearMap();
        routeList.innerHTML = "";
        setStatus(status, "Calculando ruta...");

        try {
            const data = await fetchJson("/calcular-ruta-optima");
            if (data.error) {
                setStatus(status, data.error);
                routeList.innerHTML = `<div class="empty-state">No hay una ruta pendiente para mostrar.</div>`;
                return;
            }

            currentRoute = (data.puntos_entrega || []).filter(Boolean);
            if (!currentRoute.length) {
                setStatus(status, "No hay paquetes pendientes con coordenadas.");
                routeList.innerHTML = `<div class="empty-state">Sube un CSV o marca algun paquete como no entregado.</div>`;
                return;
            }

            routeList.innerHTML = currentRoute.map((packageItem, index) => routeCard(packageItem, index, currentRoute.length)).join("");

            currentRoute.forEach((packageItem, index) => {
                const stopNumber = index + 1;
                const typeClass = markerClass(index, currentRoute.length);
                const icon = L.divIcon({
                    className: "",
                    html: `<span class="map-number ${typeClass}">${stopNumber}</span>`,
                    iconSize: [36, 36],
                    iconAnchor: [18, 18]
                });

                L.marker([packageItem.lat, packageItem.lon], { icon })
                    .addTo(markerLayer)
                    .bindPopup(`<strong>Parada ${stopNumber}</strong><br>${escapeHtml(packageItem.cliente)}<br>${escapeHtml(packageItem.dir)}`);
            });

            routeLayer = L.geoJSON(data.ruta_completa, {
                style: {
                    color: "#2563eb",
                    weight: 6,
                    opacity: 0.85,
                    lineJoin: "round"
                }
            }).addTo(map);

            const routeBounds = routeLayer.getBounds();
            if (routeBounds.isValid()) {
                map.fitBounds(routeBounds, { padding: [32, 32] });
            } else {
                const first = currentRoute[0];
                map.setView([first.lat, first.lon], 16);
            }

            setStatus(status, data.mensaje || `${currentRoute.length} paradas pendientes.`, "ok");
        } catch (error) {
            setStatus(status, `Error: ${error.message}`, "error");
            routeList.innerHTML = `<div class="empty-state">No se pudo generar la ruta.</div>`;
        } finally {
            refreshButton.disabled = false;
        }
    }

    routeList.addEventListener("click", async (event) => {
        const button = event.target.closest("[data-action]");
        if (!button) return;

        const card = button.closest("[data-package-id]");
        const packageId = Number(card.dataset.packageId);

        if (button.dataset.action === "info") {
            const observation = card.querySelector(".observation");
            observation.hidden = !observation.hidden;
            button.textContent = observation.hidden ? "INFO" : "Ocultar";
            return;
        }

        const packageItem = currentRoute.find((item) => item.id === packageId);
        button.disabled = true;
        setStatus(status, "Marcando paquete como entregado...");

        try {
            await markDelivery(packageId, true);
            if (packageItem && !recentlyDelivered.some((item) => item.id === packageId)) {
                recentlyDelivered.unshift(packageItem);
            }
            renderUndo();
            await renderRoute();
        } catch (error) {
            setStatus(status, `Error: ${error.message}`, "error");
            button.disabled = false;
        }
    });

    undoArea.addEventListener("click", async (event) => {
        const button = event.target.closest("[data-undo-id]");
        if (!button) return;

        const packageId = Number(button.dataset.undoId);
        button.disabled = true;
        setStatus(status, "Restaurando paquete como no entregado...");

        try {
            await markDelivery(packageId, false);
            recentlyDelivered = recentlyDelivered.filter((item) => item.id !== packageId);
            renderUndo();
            await renderRoute();
        } catch (error) {
            setStatus(status, `Error: ${error.message}`, "error");
            button.disabled = false;
        }
    });

    refreshButton.addEventListener("click", renderRoute);
    renderRoute();
}

const page = document.body.dataset.page;

if (page === "home") initHome();
if (page === "upload") initUpload();
if (page === "packages") initPackages();
if (page === "route") initRoute();
