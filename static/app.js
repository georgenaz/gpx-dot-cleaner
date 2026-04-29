(function () {
    "use strict";

    const ORIGINAL_COLOR = "#7f8c8d";
    const CLEANED_COLOR  = "#27ae60";
    const MARKER_RADIUS  = 3;
    const SELECTED_RADIUS = 5;
    const SELECTED_COLOR = "#e74c3c";
    const DELETED_COLOR  = "#bdc3c7";
    const NORMAL_COLOR   = "#2c3e50";

    let points = [];
    let selectedIndices = new Set();

    const fileInput = document.getElementById("file-input");
    const btnDelete = document.getElementById("btn-delete");
    const btnUndo   = document.getElementById("btn-undo");
    const btnExport = document.getElementById("btn-export");
    const statusEl  = document.getElementById("status");

    const map = L.map("map", { preferCanvas: true }).setView([55.75, 37.62], 10);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap contributors", maxZoom: 19,
    }).addTo(map);

    const originalLine = L.polyline([], { color: ORIGINAL_COLOR, weight: 3, opacity: 0.6 }).addTo(map);
    const cleanedLine  = L.polyline([], { color: CLEANED_COLOR,  weight: 3, opacity: 0.9 }).addTo(map);
    const markersGroup = L.layerGroup().addTo(map);

    let selectionRect = null;
    let isSelecting = false;
    let selectionStartLatLng = null;
    let selectionStartPx = null;

    async function api(method, path, body) {
        const opts = { method };
        if (body) { opts.headers = { "Content-Type": "application/json" }; opts.body = JSON.stringify(body); }
        const resp = await fetch("/api" + path, opts);
        if (!resp.ok) { const err = await resp.json().catch(() => ({})); throw new Error(err.detail || resp.statusText); }
        return resp;
    }

    fileInput.addEventListener("change", async () => {
        const file = fileInput.files[0];
        if (!file) return;
        statusEl.textContent = "Загрузка…";
        try {
            const fd = new FormData(); fd.append("file", file);
            const resp = await fetch("/api/upload", { method: "POST", body: fd });
            if (!resp.ok) { const err = await resp.json().catch(() => ({})); throw new Error(err.detail || resp.statusText); }
            const data = await resp.json();
            statusEl.textContent = "Загружен: " + (data.name || file.name) + " (" + data.total_points + " точек)";
            await refreshPoints();
            enableButtons();
        } catch (e) { statusEl.textContent = "Ошибка: " + e.message; }
        fileInput.value = "";
    });

    async function refreshPoints() {
        const resp = await api("GET", "/points");
        points = await resp.json();
        selectedIndices.clear();
        renderTrack();
        updateSelectionButtons();
    }

    function renderTrack() {
        const activeLatLngs = [];
        const allLatLngs = [];
        markersGroup.clearLayers();
        points.forEach(function (pt) {
            var ll = [pt.lat, pt.lon];
            allLatLngs.push(ll);
            if (!pt.deleted) activeLatLngs.push(ll);
            var isSelected = selectedIndices.has(pt.index);
            var radius = isSelected ? SELECTED_RADIUS : MARKER_RADIUS;
            var color = pt.deleted ? DELETED_COLOR : isSelected ? SELECTED_COLOR : NORMAL_COLOR;
            var marker = L.circleMarker(ll, {
                radius: radius, fillColor: color, color: color, weight: 1,
                opacity: pt.deleted ? 0.3 : 0.8, fillOpacity: pt.deleted ? 0.15 : 0.6,
                interactive: !pt.deleted,
            });
            marker.pointIndex = pt.index;
            if (!pt.deleted) marker.on("click", onMarkerClick);
            markersGroup.addLayer(marker);
        });
        originalLine.setLatLngs(allLatLngs);
        cleanedLine.setLatLngs(activeLatLngs);
        if (allLatLngs.length) map.fitBounds(L.latLngBounds(allLatLngs), { padding: [30, 30] });
    }

    function onMarkerClick(e) {
        var idx = e.target.pointIndex;
        if (selectedIndices.has(idx)) selectedIndices.delete(idx);
        else selectedIndices.add(idx);
        updateMarkerStyles();
        updateSelectionButtons();
    }

    function updateMarkerStyles() {
        markersGroup.eachLayer(function (marker) {
            if (marker.pointIndex === undefined) return;
            var pt = points[marker.pointIndex];
            if (!pt || pt.deleted) return;
            var isSel = selectedIndices.has(marker.pointIndex);
            marker.setStyle({
                radius: isSel ? SELECTED_RADIUS : MARKER_RADIUS,
                fillColor: isSel ? SELECTED_COLOR : NORMAL_COLOR,
                color: isSel ? SELECTED_COLOR : NORMAL_COLOR,
                opacity: isSel ? 1 : 0.8,
                fillOpacity: isSel ? 0.8 : 0.6,
            });
        });
    }

    var mapContainer = map.getContainer();
    mapContainer.addEventListener("mousedown", function (e) {
        if (e.button !== 0) return;
        if (e.target.closest(".leaflet-interactive")) return;
        isSelecting = true;
        var rect = mapContainer.getBoundingClientRect();
        selectionStartPx = { x: e.clientX, y: e.clientY };
        selectionStartLatLng = map.containerPointToLatLng(L.point(e.clientX - rect.left, e.clientY - rect.top));
        selectionRect = document.createElement("div");
        selectionRect.className = "selection-rect";
        selectionRect.style.left = e.clientX + "px";
        selectionRect.style.top = e.clientY + "px";
        selectionRect.style.width = "0";
        selectionRect.style.height = "0";
        document.body.appendChild(selectionRect);
        e.preventDefault();
    });

    document.addEventListener("mousemove", function (e) {
        if (!isSelecting || !selectionRect) return;
        selectionRect.style.left = Math.min(e.clientX, selectionStartPx.x) + "px";
        selectionRect.style.top  = Math.min(e.clientY, selectionStartPx.y) + "px";
        selectionRect.style.width  = Math.abs(e.clientX - selectionStartPx.x) + "px";
        selectionRect.style.height = Math.abs(e.clientY - selectionStartPx.y) + "px";
    });

    document.addEventListener("mouseup", function (e) {
        if (!isSelecting) return;
        isSelecting = false;
        if (selectionRect) { selectionRect.remove(); selectionRect = null; }
        if (e.button !== 0) return;
        var rect = mapContainer.getBoundingClientRect();
        var endLatLng = map.containerPointToLatLng(L.point(e.clientX - rect.left, e.clientY - rect.top));
        var bounds = L.latLngBounds(selectionStartLatLng, endLatLng);
        var inRect = new Set();
        markersGroup.eachLayer(function (marker) {
            if (marker.pointIndex === undefined) return;
            var pt = points[marker.pointIndex];
            if (!pt || pt.deleted) return;
            if (bounds.contains(marker.getLatLng())) inRect.add(marker.pointIndex);
        });
        if (inRect.size === 0) return;
        if (e.ctrlKey || e.metaKey) inRect.forEach(function (idx) { selectedIndices.delete(idx); });
        else if (e.shiftKey) inRect.forEach(function (idx) { selectedIndices.add(idx); });
        else selectedIndices = inRect;
        updateMarkerStyles();
        updateSelectionButtons();
    });

    btnDelete.addEventListener("click", async () => {
        if (selectedIndices.size === 0) return;
        try {
            await api("POST", "/points/delete", { indices: [...selectedIndices] });
            selectedIndices.clear();
            await refreshPoints();
            updateStateDisplay();
        } catch (e) { statusEl.textContent = "Ошибка удаления: " + e.message; }
    });

    btnUndo.addEventListener("click", async () => {
        try {
            const resp = await api("POST", "/undo");
            const data = await resp.json();
            statusEl.textContent = "Восстановлено: " + data.restored + ". Отмена: " + data.remaining_undo_levels;
            await refreshPoints();
            updateStateDisplay();
        } catch (e) { statusEl.textContent = "Ошибка отмены: " + e.message; }
    });

    btnExport.addEventListener("click", async () => {
        try {
            const resp = await fetch("/api/export");
            if (!resp.ok) throw new Error("Export failed");
            const blob = await resp.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url; a.download = "cleaned.gpx"; a.click();
            URL.revokeObjectURL(url);
        } catch (e) { statusEl.textContent = "Ошибка экспорта: " + e.message; }
    });

    function enableButtons() { btnExport.disabled = false; updateStateDisplay(); }

    function updateSelectionButtons() {
        btnDelete.disabled = selectedIndices.size === 0;
        updateStateDisplay();
    }

    async function updateStateDisplay() {
        try {
            const resp = await api("GET", "/state");
            const state = await resp.json();
            btnUndo.disabled = !state.loaded || state.undo_levels === 0;
            if (state.loaded && state.track_info) {
                var ti = state.track_info;
                statusEl.textContent = (ti.name || "Трек") + ": " + ti.total_points + " точек, удалено " + ti.deleted_points + ", активно " + ti.active_points + " | Отмена: " + state.undo_levels + " | Выбрано: " + selectedIndices.size;
            }
        } catch {}
    }
})();
