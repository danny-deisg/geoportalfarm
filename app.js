/* ================== CONFIG ================== */
// ✅ Puedes dejar tus credenciales tal cual como en tu versión anterior.
// (Recomendación práctica: mover a variables de entorno cuando lo publiques)
const SUPABASE_URL = "https://awelnlgtikfmbfweypxy.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF3ZWxubGd0aWtmbWJmd2V5cHh5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjcwMzAwNTIsImV4cCI6MjA4MjYwNjA1Mn0.jLLzb2CzoRWTwt7xJxQAD834eeR5jtQpcgeQV4saGhg";

const ZOOM_BARRIOS_LABELS = 13;

/* ================== DOM ================== */
const sidebar = document.getElementById("sidebar");
const btnToggleSidebar = document.getElementById("btnToggleSidebar");
const btnHome = document.getElementById("btnHome");

const footerText = document.getElementById("footerText");
const statusEl = document.getElementById("status");
const layersEl = document.getElementById("layers");

const tabs = Array.from(document.querySelectorAll(".tab"));
const panels = Array.from(document.querySelectorAll(".panel"));

const repNombre = document.getElementById("repNombre");
const repTipo = document.getElementById("repTipo");
const repComentarios = document.getElementById("repComentarios");
const repLat = document.getElementById("repLat");
const repLon = document.getElementById("repLon");
const btnUbic = document.getElementById("btnUbic");
const repPickToggle = document.getElementById("repPickToggle");
const btnEnviarRep = document.getElementById("btnEnviarRep");
const btnCancelarPick = document.getElementById("btnCancelarPick");
const repMsg = document.getElementById("repMsg");

const barrioInput = document.getElementById("barrioInput");
const barrioResults = document.getElementById("barrioResults");
const barrioInfo = document.getElementById("barrioInfo");

const distToggle = document.getElementById("distToggle");
const distInfo = document.getElementById("distInfo");

const btnLoadLayers = document.getElementById("btnLoadLayers");
const btnClear = document.getElementById("btnClear");

/* ================== HELPERS ================== */
function setFooter(msg) {
  footerText.textContent = msg || "Listo";
}
function setStatus(msg, cls = "") {
  statusEl.className = `status ${cls}`.trim();
  statusEl.textContent = msg || "";
}
function setRepMsg(msg, cls = "") {
  repMsg.className = `status ${cls}`.trim();
  repMsg.textContent = msg || "";
}
function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/* ================== MAP ================== */
const map = L.map("map", { zoomControl: true }).setView([0, 0], 2);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 20,
  attribution: "&copy; OpenStreetMap",
}).addTo(map);

const loadedLayers = new Map(); // tableName -> L.GeoJSON
let barrioHighlight = null;

/* Barrios labels / interaction */
let barriosInteraction = null;
let barriosInteractionLabelsEnabled = false;
const barrioLabelLayers = [];

/* Distances */
let clickMarker = null;
let distLinesLayer = null;
let distTargetsLayer = null;

/* Report pick */
let reportPickMarker = null;
let reportPickActive = false;

/* ================== STYLES ================== */
const LAYER_COLORS = {
  alcantarillado: { line: "#ef4444" }, // rojo
  agua_potable: { line: "#2563eb" }, // azul
  bomberos_wgs84: { point: "#ef4444" }, // rojo
  policia_wgs84: { point: "#2563eb" }, // azul
  salud_wgs84: { point: "#facc15" }, // amarillo
};

function styleByLayer(tabla, geomType) {
  const t = (geomType || "").toLowerCase();
  if (t.includes("polygon")) {
    return { color: "#34d399", weight: 2, fillColor: "#10b981", fillOpacity: 0.20 };
  }
  if (t.includes("line")) {
    const col = LAYER_COLORS[tabla]?.line || "#22c55e";
    return { color: col, weight: 3, opacity: 0.95 };
  }
  const col = LAYER_COLORS[tabla]?.point || "#f97316";
  return { radius: 7, fillColor: col, color: "#ffffff", weight: 1, fillOpacity: 0.95 };
}

function highlightStyle() {
  return { color: "#a78bfa", weight: 4, fillColor: "#22d3ee", fillOpacity: 0.12 };
}

function reporteIcon(estadoRaw) {
  const estado = String(estadoRaw || "Pendiente").toLowerCase();

  // Pendiente: círculo rojo
  // En proceso: rombo amarillo
  // Atendido: cuadrado verde
  // Cerrado: triángulo azul
  let html = `<span class="repIcon repIcon--pendiente"></span>`;
  if (estado.includes("proceso")) html = `<span class="repIcon repIcon--proceso"></span>`;
  else if (estado.includes("atendido")) html = `<span class="repIcon repIcon--atendido"></span>`;
  else if (estado.includes("cerrado")) html = `<span class="repIcon repIcon--cerrado"></span>`;

  return L.divIcon({
    className: "",
    html,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
}

/* ================== POPUP ================== */
function popupHTML(properties) {
  const props = properties || {};
  const keys = Object.keys(props).filter((k) => k !== "geom" && k !== "geometry");

  const rows = keys
    .map((k) => {
      const v = props[k];
      return `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(v)}</td></tr>`;
    })
    .join("");

  return `<div style="max-height:260px;overflow:auto;min-width:240px">
    <table class="popTable">${rows}</table>
  </div>`;
}

/* ================== API ================== */
async function rpcPost(fnName, bodyObj) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fnName}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(bodyObj),
  });

  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(`${fnName} HTTP ${r.status} ${txt ? "- " + txt.slice(0, 180) : ""}`);
  }
  return r.json();
}

async function insertReporte(payload) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/reportes`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(payload),
  });

  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(`INSERT reportes HTTP ${r.status} ${txt ? "- " + txt.slice(0, 220) : ""}`);
  }
  return r.json();
}

function extractTableNamesFromOpenAPI(spec) {
  const paths = spec?.paths ? Object.keys(spec.paths) : [];
  return [...new Set(
    paths
      .filter((p) => p && p.startsWith("/") && !p.includes("{") && !p.startsWith("/rpc"))
      .map((p) => p.replace(/^\//, ""))
      .map((p) => p.replace(/^public\./, ""))
      .filter((name) => name.length > 0)
  )].sort();
}

async function loadOpenApiTables() {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/`, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      Accept: "application/openapi+json",
    },
  });

  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(`OpenAPI HTTP ${r.status} ${txt ? "- " + txt.slice(0, 160) : ""}`);
  }

  const spec = await r.json();
  return extractTableNamesFromOpenAPI(spec);
}

/* ================== LAYERS ================== */
async function addLayer(tabla) {
  if (loadedLayers.has(tabla)) return;

  setFooter(`Cargando ${tabla}…`);
  const fc = await rpcPost("layer_geojson", { t: tabla, g: "geom", lim: 5000 });

  const layer = L.geoJSON(fc, {
    style: (f) => styleByLayer(tabla, f?.geometry?.type),

    pointToLayer: (f, latlng) => {
      if (tabla === "reportes") {
        const est = f?.properties?.estado || "Pendiente";
        return L.marker(latlng, { icon: reporteIcon(est) });
      }
      return L.circleMarker(latlng, styleByLayer(tabla, f?.geometry?.type));
    },

    onEachFeature: (feature, lyr) => {
      lyr.on("click", async () => {
        lyr.bindPopup(popupHTML(feature.properties)).openPopup();

        if (tabla === "barrios") {
          const b = feature?.properties?.barrio;
          if (b) {
            barrioInput.value = b;
            barrioResults.style.display = "none";
            await cargarInfoBarrio(b);
            await resaltarBarrio(b);
          }
        }
      });
    },
  }).addTo(map);

  loadedLayers.set(tabla, layer);

  setFooter(`Cargada: ${tabla}`);
}

function removeLayer(tabla) {
  const layer = loadedLayers.get(tabla);
  if (layer) {
    map.removeLayer(layer);
    loadedLayers.delete(tabla);
  }
  setFooter("Listo");
}

async function refreshLayer(tabla) {
  if (!loadedLayers.has(tabla)) return;
  removeLayer(tabla);
  await addLayer(tabla);
}

function zoomToLayerIfAny(tabla) {
  const layer = loadedLayers.get(tabla);
  if (!layer) return false;
  const b = layer.getBounds();
  if (b && b.isValid()) {
    map.fitBounds(b, { padding: [24, 24] });
    return true;
  }
  return false;
}

/* ================== UI: Tabs & Sidebar ================== */
tabs.forEach((t) => {
  t.addEventListener("click", () => {
    tabs.forEach((x) => x.classList.remove("active"));
    t.classList.add("active");

    const tabId = t.dataset.tab;
    panels.forEach((p) => p.classList.remove("active"));
    document.getElementById(tabId).classList.add("active");
  });
});

btnToggleSidebar.addEventListener("click", () => {
  sidebar.classList.toggle("is-collapsed");
  setTimeout(() => map.invalidateSize(), 220);
});

btnHome.addEventListener("click", async () => {
  // "zona de trabajo": reportes, si no, barrios
  if (!zoomToLayerIfAny("reportes")) {
    zoomToLayerIfAny("barrios");
  }
});

/* ================== Render layer list ================== */
async function renderLayerList() {
  layersEl.innerHTML = "";
  setStatus("Consultando capas…");

  const tables = await loadOpenApiTables();

  for (const t of tables) {
    const row = document.createElement("div");
    row.className = "layerRow";

    const chk = document.createElement("input");
    chk.type = "checkbox";
    chk.dataset.table = t;

    const name = document.createElement("div");
    name.className = "layerName";
    name.textContent = t;

    const chip = document.createElement("span");
    chip.className = "chip";
    chip.id = `chip_${t}`;
    chip.textContent = "—";

    chk.onchange = async (ev) => {
      const table = ev.target.dataset.table;

      try {
        if (ev.target.checked) await addLayer(table);
        else removeLayer(table);

        if (table === "barrios") {
          barriosInteractionLabelsEnabled = ev.target.checked;
          updateBarrioLabelVisibility();
        }

        // Actualiza chip tipo geometry si aún es —
        if (chip.textContent === "—" && loadedLayers.has(table)) {
          const layer = loadedLayers.get(table);
          // no confiable para tipo exacto, pero suficiente
          chip.textContent = "OK";
        }
      } catch (e) {
        setStatus(`Error: ${e.message}`, "err");
        ev.target.checked = false;
      }
    };

    row.appendChild(chk);
    row.appendChild(name);
    row.appendChild(chip);
    layersEl.appendChild(row);
  }

  setStatus(`Listo: ${tables.length} capas`, "ok");
}

/* ================== BARRIOS: search + info + highlight ================== */
let searchTimer = null;

function showResults(items) {
  if (!items || items.length === 0) {
    barrioResults.style.display = "none";
    barrioResults.innerHTML = "";
    return;
  }
  barrioResults.style.display = "block";
  barrioResults.innerHTML = items
    .map((x) => `<div class="listItem" data-b="${escapeHtml(x.barrio)}">${escapeHtml(x.barrio)}</div>`)
    .join("");

  barrioResults.querySelectorAll(".listItem").forEach((el) => {
    el.onclick = async () => {
      const b = el.dataset.b;
      barrioInput.value = b;
      barrioResults.style.display = "none";
      await cargarInfoBarrio(b);
      await resaltarBarrio(b);
    };
  });
}

async function cargarInfoBarrio(barrioName) {
  barrioInfo.style.display = "none";
  barrioInfo.innerHTML = "";
  setFooter(`Consultando: ${barrioName}…`);

  const info = await rpcPost("barrio_servicios", { barrio_name: barrioName });

  if (info?.error) {
    barrioInfo.style.display = "block";
    barrioInfo.innerHTML = `<div class="status err">${escapeHtml(info.error)}</div>`;
    return;
  }

  barrioInfo.style.display = "block";
  barrioInfo.innerHTML = `
    <div class="kv"><div class="k">Barrio</div><div class="v">${escapeHtml(info.barrio)}</div></div>
    <div class="kv"><div class="k">Alcantarillado (m)</div><div class="v">${escapeHtml(info.alcantarillado_m)}</div></div>
    <div class="kv"><div class="k">Bomberos</div><div class="v">${escapeHtml(info.bomberos_count)}</div></div>
    <div class="kv"><div class="k">Policía</div><div class="v">${escapeHtml(info.policia_count)}</div></div>
    <div class="kv"><div class="k">Salud</div><div class="v">${escapeHtml(info.salud_count)}</div></div>
  `;
  setFooter("Listo");
}

async function resaltarBarrio(barrioName) {
  const fc = await rpcPost("barrio_geom", { barrio_name: barrioName });

  if (barrioHighlight) {
    map.removeLayer(barrioHighlight);
    barrioHighlight = null;
  }

  barrioHighlight = L.geoJSON(fc, { style: highlightStyle }).addTo(map);
  const b = barrioHighlight.getBounds();
  if (b && b.isValid()) map.fitBounds(b, { padding: [24, 24] });
}

barrioInput.addEventListener("input", () => {
  const q = barrioInput.value.trim();
  if (searchTimer) clearTimeout(searchTimer);

  if (q.length < 2) {
    showResults([]);
    return;
  }

  searchTimer = setTimeout(async () => {
    try {
      const res = await rpcPost("search_barrios", { q });
      showResults(res);
    } catch (e) {
      showResults([]);
      setFooter(`Error búsqueda: ${e.message}`);
    }
  }, 250);
});

/* ================== Barrios interaction + labels ================== */
async function initBarriosInteraction() {
  try {
    const fc = await rpcPost("layer_geojson", { t: "barrios", g: "geom", lim: 5000 });

    if (barriosInteraction) map.removeLayer(barriosInteraction);
    barrioLabelLayers.length = 0;

    barriosInteraction = L.geoJSON(fc, {
      style: () => ({ color: "#000", weight: 0, fillOpacity: 0, opacity: 0 }),
      onEachFeature: (feature, lyr) => {
        const b = feature?.properties?.barrio;
        if (b) {
          lyr.bindTooltip(String(b), {
            permanent: true,
            direction: "center",
            className: "barrio-label",
            opacity: 0.95,
          });
          barrioLabelLayers.push(lyr);
        }

        lyr.on("click", async () => {
          const b = feature?.properties?.barrio;
          if (!b) return;
          barrioInput.value = b;
          barrioResults.style.display = "none";
          await cargarInfoBarrio(b);
          await resaltarBarrio(b);
        });
      },
    }).addTo(map);

    updateBarrioLabelVisibility();
  } catch {
    // si no existe rpc/layer, simplemente no rompe la app
  }
}

function updateBarrioLabelVisibility() {
  const z = map.getZoom();
  const shouldShow = barriosInteractionLabelsEnabled && z >= ZOOM_BARRIOS_LABELS;

  barrioLabelLayers.forEach((l) => {
    if (!l.getTooltip) return;
    if (shouldShow) l.openTooltip();
    else l.closeTooltip();
  });
}
map.on("zoomend", updateBarrioLabelVisibility);

/* ================== Distances by click ================== */
function clearDistances() {
  if (clickMarker) map.removeLayer(clickMarker);
  if (distLinesLayer) map.removeLayer(distLinesLayer);
  if (distTargetsLayer) map.removeLayer(distTargetsLayer);
  clickMarker = distLinesLayer = distTargetsLayer = null;
  distInfo.style.display = "none";
  distInfo.innerHTML = "";
}

async function handleDistanceClick(latlng) {
  setFooter("Calculando distancias…");
  const res = await rpcPost("distancias_servicios", { lon: latlng.lng, lat: latlng.lat });

  clearDistances();
  clickMarker = L.circleMarker(latlng, {
    radius: 6,
    fillColor: "#fff",
    color: "#111827",
    weight: 2,
    fillOpacity: 0.9,
  }).addTo(map);

  const targets = [];
  const lines = [];

  function addTarget(name, distM, geojsonGeom) {
    if (!geojsonGeom) return;
    targets.push({ type: "Feature", geometry: geojsonGeom, properties: { name, dist_m: distM } });
    lines.push({
      type: "Feature",
      geometry: { type: "LineString", coordinates: [[latlng.lng, latlng.lat], geojsonGeom.coordinates] },
      properties: { name, dist_m: distM },
    });
  }

  addTarget("Policía", res.policia_m, res.policia_geom);
  addTarget("Bomberos", res.bomberos_m, res.bomberos_geom);
  addTarget("Salud", res.salud_m, res.salud_geom);

  distTargetsLayer = L.geoJSON({ type: "FeatureCollection", features: targets }, {
    pointToLayer: (_f, ll) => L.circleMarker(ll, {
      radius: 7, fillColor: "#22d3ee", color: "#0b1020", weight: 2, fillOpacity: 0.95
    }),
    onEachFeature: (f, lyr) => lyr.bindPopup(`<b>${escapeHtml(f.properties.name)}</b><br>${escapeHtml(f.properties.dist_m)} m`)
  }).addTo(map);

  distLinesLayer = L.geoJSON({ type: "FeatureCollection", features: lines }, {
    style: () => ({ color: "#a78bfa", weight: 2, opacity: 0.9 })
  }).addTo(map);

  distInfo.style.display = "block";
  distInfo.innerHTML = `
    <div class="kv"><div class="k">Policía (m)</div><div class="v">${escapeHtml(res.policia_m)}</div></div>
    <div class="kv"><div class="k">Bomberos (m)</div><div class="v">${escapeHtml(res.bomberos_m)}</div></div>
    <div class="kv"><div class="k">Salud (m)</div><div class="v">${escapeHtml(res.salud_m)}</div></div>
  `;

  setFooter("Listo");
}

distToggle.addEventListener("change", () => {
  clearDistances();
  if (distToggle.checked) setFooter("Modo distancias activo");
  else setFooter("Modo distancias desactivado");
});

/* ================== Reportes form ================== */
function setLatLon(lat, lon) {
  repLat.value = Number(lat).toFixed(6);
  repLon.value = Number(lon).toFixed(6);
}

function clearReportPick() {
  reportPickActive = false;
  repPickToggle.checked = false;
  btnCancelarPick.style.display = "none";
  if (reportPickMarker) map.removeLayer(reportPickMarker);
  reportPickMarker = null;
  setRepMsg("", "");
}

btnUbic.addEventListener("click", () => {
  setRepMsg("Solicitando ubicación…");
  if (!navigator.geolocation) {
    setRepMsg("Tu navegador no soporta geolocalización.", "err");
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude, longitude } = pos.coords;
      setLatLon(latitude, longitude);
      setRepMsg("Ubicación cargada.", "ok");

      if (reportPickMarker) map.removeLayer(reportPickMarker);
      reportPickMarker = L.circleMarker([latitude, longitude], {
        radius: 7,
        fillColor: "#22d3ee",
        color: "#0b1020",
        weight: 2,
        fillOpacity: 0.95,
      }).addTo(map);

      map.setView([latitude, longitude], Math.max(map.getZoom(), 16));
    },
    (err) => setRepMsg(`No se pudo obtener ubicación: ${err.message}`, "err"),
    { enableHighAccuracy: true, timeout: 10000 }
  );
});

repPickToggle.addEventListener("change", () => {
  reportPickActive = repPickToggle.checked;
  btnCancelarPick.style.display = reportPickActive ? "block" : "none";

  if (reportPickActive) {
    setRepMsg("Haz clic en el mapa para fijar Lat/Lon.", "ok");
    distToggle.checked = false;
    clearDistances();
  } else {
    setRepMsg("", "");
  }
});

btnCancelarPick.addEventListener("click", () => clearReportPick());

btnEnviarRep.addEventListener("click", async () => {
  const nombre = repNombre.value.trim();
  const tipo = repTipo.value.trim();
  const comentarios = repComentarios.value.trim();
  const lat = parseFloat(repLat.value);
  const lon = parseFloat(repLon.value);

  if (!nombre) return setRepMsg("Falta nombre.", "err");
  if (!tipo) return setRepMsg("Falta tipo de requerimiento.", "err");
  if (Number.isNaN(lat) || Number.isNaN(lon)) return setRepMsg("Falta Lat/Lon.", "err");

  setRepMsg("Enviando…");
  try {
    // estado queda por default Pendiente en DB
    await insertReporte({
      nombre,
      tipo_requerimiento: tipo,
      comentarios: comentarios || null,
      lat,
      lon,
    });

    setRepMsg("✅ Reporte enviado. Actualizando…", "ok");

    // Asegurar capa reportes activa
    const cb = document.querySelector(`input[type="checkbox"][data-table="reportes"]`);
    if (cb && !cb.checked) {
      cb.checked = true;
      await addLayer("reportes");
    } else {
      await refreshLayer("reportes");
    }

    // limpiar
    repComentarios.value = "";
    repTipo.value = "";
    clearReportPick();

    // zoom a reportes
    zoomToLayerIfAny("reportes");
  } catch (e) {
    setRepMsg(`Error: ${e.message}`, "err");
  }
});

/* Map click handler: report pick OR distances */
map.on("click", async (e) => {
  if (reportPickActive) {
    setLatLon(e.latlng.lat, e.latlng.lng);
    setRepMsg("Punto seleccionado en el mapa.", "ok");

    if (reportPickMarker) map.removeLayer(reportPickMarker);
    reportPickMarker = L.circleMarker(e.latlng, {
      radius: 7,
      fillColor: "#22d3ee",
      color: "#0b1020",
      weight: 2,
      fillOpacity: 0.95,
    }).addTo(map);
    return;
  }

  if (distToggle.checked) {
    await handleDistanceClick(e.latlng);
  }
});

/* ================== Buttons: Load / Clear ================== */
btnLoadLayers.addEventListener("click", async () => {
  try {
    await renderLayerList();
  } catch (e) {
    setStatus(`Error: ${e.message}`, "err");
  }
});

btnClear.addEventListener("click", () => {
  for (const [tabla, layer] of loadedLayers.entries()) {
    map.removeLayer(layer);
    loadedLayers.delete(tabla);
  }

  document.querySelectorAll(`input[type="checkbox"][data-table]`).forEach((cb) => (cb.checked = false));

  barriosInteractionLabelsEnabled = false;
  updateBarrioLabelVisibility();

  if (barrioHighlight) map.removeLayer(barrioHighlight);
  barrioHighlight = null;

  clearDistances();
  clearReportPick();

  map.setView([0, 0], 2);
  setStatus("");
  setFooter("Limpio");
  barrioResults.style.display = "none";
  barrioResults.innerHTML = "";
  barrioInfo.style.display = "none";
  barrioInfo.innerHTML = "";
});

/* ================== INIT ================== */
(async function init() {
  try {
    setFooter("Inicializando…");
    await renderLayerList();
    await initBarriosInteraction();

    // Auto activar reportes (si existe)
    const cbReportes = document.querySelector(`input[type="checkbox"][data-table="reportes"]`);
    if (cbReportes) {
      cbReportes.checked = true;
      await addLayer("reportes");
    }

    // Zoom zona trabajo: reportes si hay; si no, barrios
    if (!zoomToLayerIfAny("reportes")) {
      const cbBarrios = document.querySelector(`input[type="checkbox"][data-table="barrios"]`);
      if (cbBarrios) {
        cbBarrios.checked = true;
        barriosInteractionLabelsEnabled = true;
        await addLayer("barrios");
        updateBarrioLabelVisibility();
        zoomToLayerIfAny("barrios");
      }
    }

    setFooter("Listo");
  } catch (e) {
    setFooter(`Error init: ${e.message}`);
    setStatus(`Error init: ${e.message}`, "err");
  }
})();
