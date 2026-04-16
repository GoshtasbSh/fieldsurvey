/*  KeyStone Survey Dashboard – main client logic  */

// ── Basemap styles ──────────────────────────────────────────────────────────
const BASEMAPS = {
  streets: {
    name: 'Streets',
    tiles: ['https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png'],
    attr: '&copy; <a href="https://carto.com">CARTO</a>',
  },
  satellite: {
    name: 'Satellite',
    tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
    attr: '&copy; Esri',
  },
  dark: {
    name: 'Dark',
    tiles: ['https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png'],
    attr: '&copy; CARTO',
  },
  light: {
    name: 'Light',
    tiles: ['https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png'],
    attr: '&copy; CARTO',
  },
  topo: {
    name: 'Topographic',
    tiles: ['https://tile.opentopomap.org/{z}/{x}/{y}.png'],
    attr: '&copy; OpenTopoMap',
    tileSize: 256,
  },
  osm: {
    name: 'OpenStreetMap',
    tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
    attr: '&copy; OpenStreetMap contributors',
    tileSize: 256,
  },
};

const STATUS_COLORS = {};
let currentBasemap = 'streets';
let map, surveyData, parcelsData, analysisData;
let activeFilters = new Set();
let charts = {};
let iaqData = null, iaqAnalysis = null, chatHistory = [];
let currentContactFilter = null;
let currentIAQFilter = null;
let panelSizes = { sidebar: 280, analysis: 300, chat: 340 };
// When `highlight_streets` is active, we pin the list of streets so any later
// chatbot action (e.g. filter_iaq_symptom) intersects with it instead of
// replacing it. Prevents "show all mold points" from leaking points from
// streets other than the one the user asked about.
let activeStreetHighlight = null;   // string[] | null
let _resultsCharts = {};

// ── Helpers ─────────────────────────────────────────────────────────────────
function fmt(n) {
  if (n == null) return '—';
  if (typeof n === 'number') return n.toLocaleString();
  return n;
}

function fmtCurrency(n) {
  if (n == null || n === 0) return '—';
  return '$' + Number(n).toLocaleString();
}

// ── Map init ────────────────────────────────────────────────────────────────
function initMap() {
  const bm = BASEMAPS[currentBasemap];
  map = new maplibregl.Map({
    container: 'map',
    style: {
      version: 8,
      sources: { basemap: { type: 'raster', tiles: bm.tiles, tileSize: bm.tileSize || 256, attribution: bm.attr } },
      layers: [{ id: 'basemap-layer', type: 'raster', source: 'basemap' }],
    },
    center: [-82.00, 29.79],
    zoom: 14,
    maxZoom: 20,
    minZoom: 10,
  });

  map.addControl(new maplibregl.NavigationControl(), 'top-right');
  map.addControl(new maplibregl.ScaleControl({ maxWidth: 150 }), 'bottom-left');
  map.addControl(new maplibregl.GeolocateControl(), 'top-right');

  map.on('load', loadData);
}

// ── Data loading ────────────────────────────────────────────────────────────
async function loadData() {
  try {
    const [ptsRes, parRes, anaRes, iaqPtsRes, iaqAnaRes] = await Promise.all([
      fetch('/api/survey-points'),
      fetch('/api/parcels'),
      fetch('/api/analysis'),
      fetch('/api/iaq-points'),
      fetch('/api/iaq-analysis'),
    ]);
    surveyData = await ptsRes.json();
    parcelsData = await parRes.json();
    analysisData = await anaRes.json();
    iaqData = await iaqPtsRes.json();
    const iaqAnaData = await iaqAnaRes.json();
    if (iaqAnaData.loaded) iaqAnalysis = iaqAnaData;

    if (analysisData.status_colors) {
      Object.assign(STATUS_COLORS, analysisData.status_colors);
    }

    addLayers();
    addIAQLayers();
    buildLegend();
    buildAnalysis();

    // If IAQ data was already loaded (e.g. after re-deploy with warm state)
    if (iaqData && iaqData.features && iaqData.features.length) {
      updateIAQOnMap();
      buildSurveyResultsTab(iaqAnalysis);
    }

    fitBounds();
    document.getElementById('loading').classList.add('hide');
  } catch (e) {
    console.error('Data load error:', e);
    document.querySelector('#loading p').textContent = 'Error loading data. Is the server running?';
  }
}

// ── Fit map to data ─────────────────────────────────────────────────────────
function fitBounds() {
  if (!surveyData?.features?.length) return;
  const coords = surveyData.features.map(f => f.geometry.coordinates);
  const lngs = coords.map(c => c[0]);
  const lats = coords.map(c => c[1]);
  map.fitBounds(
    [[Math.min(...lngs) - 0.005, Math.min(...lats) - 0.005],
     [Math.max(...lngs) + 0.005, Math.max(...lats) + 0.005]],
    { padding: 60, duration: 1000 }
  );
}

// ── Add map layers ──────────────────────────────────────────────────────────
function addLayers() {
  // Parcels source
  map.addSource('parcels', { type: 'geojson', data: parcelsData || { type: 'FeatureCollection', features: [] } });

  // Parcel fill
  map.addLayer({
    id: 'parcels-fill', type: 'fill', source: 'parcels',
    paint: {
      'fill-color': buildParcelColorExpr('land_use'),
      'fill-opacity': 0.35,
    },
  });
  map.addLayer({
    id: 'parcels-outline', type: 'line', source: 'parcels',
    paint: { 'line-color': 'rgba(255,255,255,0.2)', 'line-width': 0.5 },
  });

  // Parcel 3D extrusion (hidden by default)
  map.addLayer({
    id: 'parcels-3d', type: 'fill-extrusion', source: 'parcels',
    layout: { visibility: 'none' },
    paint: {
      'fill-extrusion-color': buildParcelColorExpr('land_use'),
      'fill-extrusion-height': ['/', ['coalesce', ['get', 'just_value'], 0], 3000],
      'fill-extrusion-opacity': 0.7,
    },
  });

  // Survey points source
  map.addSource('survey', { type: 'geojson', data: surveyData });

  // Clustered source
  map.addSource('survey-clustered', {
    type: 'geojson', data: surveyData,
    cluster: true, clusterMaxZoom: 15, clusterRadius: 40,
    clusterProperties: {
      'cnt_completed':     ['+', ['case', ['==', ['get', 'status'], 'Completed'], 1, 0]],
      'cnt_no_answer':     ['+', ['case', ['==', ['get', 'status'], 'No Answer'], 1, 0]],
      'cnt_inaccessible':  ['+', ['case', ['==', ['get', 'status'], 'Inaccessible'], 1, 0]],
      'cnt_not_interested':['+', ['case', ['==', ['get', 'status'], 'Not Interested'], 1, 0]],
      'cnt_left_info':     ['+', ['case', ['==', ['get', 'status'], 'Left Info'], 1, 0]],
      'cnt_vacant':        ['+', ['case', ['==', ['get', 'status'], 'Vacant'], 1, 0]],
      'cnt_follow_up':     ['+', ['case', ['==', ['get', 'status'], 'Follow Up'], 1, 0]],
      'cnt_other':         ['+', ['case', ['any',
                              ['==', ['get', 'status'], 'Other'],
                              ['==', ['get', 'status'], 'Unknown']], 1, 0]],
    },
  });

  // Heatmap (hidden by default)
  map.addLayer({
    id: 'heatmap', type: 'heatmap', source: 'survey',
    layout: { visibility: 'none' },
    paint: {
      'heatmap-weight': 1,
      'heatmap-intensity': 1.5,
      'heatmap-radius': 25,
      'heatmap-color': [
        'interpolate', ['linear'], ['heatmap-density'],
        0, 'rgba(0,0,0,0)', 0.2, '#3b82f6', 0.4, '#06b6d4',
        0.6, '#10b981', 0.8, '#f59e0b', 1, '#ef4444',
      ],
      'heatmap-opacity': 0.7,
    },
  });

  // Cluster circles – colored by dominant status (hidden by default)
  map.addLayer({
    id: 'cluster-circles', type: 'circle', source: 'survey-clustered',
    filter: ['has', 'point_count'],
    layout: { visibility: 'none' },
    paint: {
      'circle-color': [
        'case',
        // Dominant status = whichever count is highest
        ['>=', ['get', 'cnt_completed'],     ['max', ['get', 'cnt_no_answer'], ['get', 'cnt_inaccessible'], ['get', 'cnt_left_info'], ['get', 'cnt_not_interested'], ['get', 'cnt_vacant'], ['get', 'cnt_follow_up'], ['get', 'cnt_other']]], '#10b981',
        ['>=', ['get', 'cnt_no_answer'],     ['max', ['get', 'cnt_completed'], ['get', 'cnt_inaccessible'], ['get', 'cnt_left_info'], ['get', 'cnt_not_interested'], ['get', 'cnt_vacant'], ['get', 'cnt_follow_up'], ['get', 'cnt_other']]], '#f97316',
        ['>=', ['get', 'cnt_inaccessible'],  ['max', ['get', 'cnt_completed'], ['get', 'cnt_no_answer'], ['get', 'cnt_left_info'], ['get', 'cnt_not_interested'], ['get', 'cnt_vacant'], ['get', 'cnt_follow_up'], ['get', 'cnt_other']]], '#ef4444',
        ['>=', ['get', 'cnt_left_info'],     ['max', ['get', 'cnt_completed'], ['get', 'cnt_no_answer'], ['get', 'cnt_inaccessible'], ['get', 'cnt_not_interested'], ['get', 'cnt_vacant'], ['get', 'cnt_follow_up'], ['get', 'cnt_other']]], '#3b82f6',
        '#8b5cf6'
      ],
      'circle-radius': [
        'interpolate', ['linear'], ['get', 'point_count'],
        2, 14,    // 2 points = 14px
        5, 18,    // 5 points = 18px
        10, 24,   // 10 points = 24px
        20, 30,   // 20 points = 30px
        40, 38,   // 40 points = 38px
        80, 46,   // 80+ points = 46px
      ],
      'circle-stroke-width': 3, 'circle-stroke-color': 'rgba(255,255,255,0.35)',
    },
  });
  map.addLayer({
    id: 'cluster-count', type: 'symbol', source: 'survey-clustered',
    filter: ['has', 'point_count'],
    layout: {
      visibility: 'none',
      'text-field': '{point_count_abbreviated}',
      'text-size': ['interpolate', ['linear'], ['get', 'point_count'], 2, 11, 10, 14, 40, 17],
      'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
    },
    paint: { 'text-color': '#ffffff' },
  });

  // Survey point circles (hidden by default — user uploads or toggles on)
  map.addLayer({
    id: 'survey-points', type: 'circle', source: 'survey',
    layout: { visibility: 'none' },
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 5, 16, 9, 19, 14],
      'circle-color': ['get', 'color'],
      'circle-stroke-width': 2,
      'circle-stroke-color': 'rgba(255,255,255,0.5)',
      'circle-opacity': 0.9,
    },
  });

  // Point labels (address)
  map.addLayer({
    id: 'survey-labels', type: 'symbol', source: 'survey',
    layout: {
      'text-field': ['get', 'address'],
      'text-size': 10,
      'text-offset': [0, 1.5],
      'text-anchor': 'top',
      'text-font': ['Open Sans Regular', 'Arial Unicode MS Regular'],
      'text-max-width': 12,
    },
    paint: {
      'text-color': '#e2e8f0',
      'text-halo-color': 'rgba(0,0,0,0.7)',
      'text-halo-width': 1,
    },
    minzoom: 16,
  });

  // Click handlers
  map.on('click', 'survey-points', onPointClick);
  map.on('click', 'parcels-fill', onParcelClick);
  map.on('click', 'cluster-circles', onClusterClick);
  map.on('mouseenter', 'survey-points', () => map.getCanvas().style.cursor = 'pointer');
  map.on('mouseleave', 'survey-points', () => map.getCanvas().style.cursor = '');
  map.on('mouseenter', 'parcels-fill', () => map.getCanvas().style.cursor = 'pointer');
  map.on('mouseleave', 'parcels-fill', () => map.getCanvas().style.cursor = '');
  setupClusterHover();
}

// ── Parcel color expression ─────────────────────────────────────────────────
function buildParcelColorExpr(field) {
  if (field === 'land_use') {
    return ['match', ['coalesce', ['get', 'land_use'], 'Other'],
      'Residential', PARCEL_LU_COLORS['Residential'] || '#3b82f6',
      'Commercial', PARCEL_LU_COLORS['Commercial'] || '#f59e0b',
      'Institutional', PARCEL_LU_COLORS['Institutional'] || '#8b5cf6',
      'Government', PARCEL_LU_COLORS['Government'] || '#ef4444',
      'Agriculture', PARCEL_LU_COLORS['Agriculture'] || '#10b981',
      'Vacant Land', PARCEL_LU_COLORS['Vacant Land'] || '#94a3b8',
      PARCEL_LU_COLORS['Other'] || '#6b7280'];
  }
  if (field === 'just_value') {
    return ['interpolate', ['linear'], ['coalesce', ['get', 'just_value'], 0],
      0, '#1e293b', 50000, '#3b82f6', 100000, '#06b6d4',
      200000, '#10b981', 400000, '#f59e0b', 800000, '#ef4444'];
  }
  if (field === 'year_built') {
    return ['interpolate', ['linear'], ['coalesce', ['get', 'year_built'], 1950],
      1920, '#ef4444', 1960, '#f97316', 1980, '#f59e0b',
      2000, '#10b981', 2020, '#3b82f6'];
  }
  if (field === 'living_area') {
    return ['interpolate', ['linear'], ['coalesce', ['get', 'living_area'], 0],
      0, '#1e293b', 500, '#3b82f6', 1000, '#06b6d4',
      1500, '#10b981', 2500, '#f59e0b', 4000, '#ef4444'];
  }
  return '#6b7280';
}

// ── Popup HTML builders ─────────────────────────────────────────────────────
function buildSurveyTab(p) {
  return `
    <div class="popup-body">
      ${p.status_detail ? `<div class="popup-row"><span class="popup-label">First Attempt</span><span class="popup-value">${p.status_detail}</span></div>` : ''}
      ${p.second_attempt ? `<div class="popup-row"><span class="popup-label">Second Attempt</span><span class="popup-value">${p.second_attempt}</span></div>` : ''}
      ${p.date ? `<div class="popup-row"><span class="popup-label">Date</span><span class="popup-value">${p.date}</span></div>` : ''}
      ${p.notes ? `<div class="popup-row"><span class="popup-label">Notes</span><span class="popup-value">${p.notes}</span></div>` : ''}
      <div class="popup-row"><span class="popup-label">Street</span><span class="popup-value">${p.street_name}</span></div>
      <div class="popup-row"><span class="popup-label">Status</span><span class="popup-value"><span class="popup-badge" style="background:${p.color}22;color:${p.color};border:1px solid ${p.color}44">${p.status}</span></span></div>
    </div>`;
}

function buildParcelTab(p) {
  return `
    <div class="popup-body">
      <div class="popup-row"><span class="popup-label">Parcel ID</span><span class="popup-value" style="font-family:var(--mono)">${fmt(p.parcel_id)}</span></div>
      <div class="popup-row"><span class="popup-label">Owner</span><span class="popup-value">${fmt(p.owner)}</span></div>
      <div class="popup-row"><span class="popup-label">Land Use</span><span class="popup-value">${fmt(p.land_use || p.use_code)}</span></div>
      <div class="popup-row"><span class="popup-label">Just Value</span><span class="popup-value" style="color:var(--green)">${fmtCurrency(p.just_value)}</span></div>
      <div class="popup-row"><span class="popup-label">Land Value</span><span class="popup-value">${fmtCurrency(p.land_value)}</span></div>
      <div class="popup-row"><span class="popup-label">Assessed</span><span class="popup-value">${fmtCurrency(p.assessed_value)}</span></div>
      <div class="popup-row"><span class="popup-label">Living Area</span><span class="popup-value">${p.living_area ? fmt(p.living_area) + ' sqft' : '—'}</span></div>
      <div class="popup-row"><span class="popup-label">Year Built</span><span class="popup-value">${fmt(p.year_built)}</span></div>
      <div class="popup-row"><span class="popup-label">Buildings</span><span class="popup-value">${fmt(p.num_buildings)}</span></div>
      <div class="popup-row"><span class="popup-label">Lot Size</span><span class="popup-value">${p.lot_sqft ? fmt(Math.round(p.lot_sqft)) + ' sqft' : '—'}</span></div>
      <div class="popup-row"><span class="popup-label">Last Sale</span><span class="popup-value">${p.last_sale_price > 0 ? fmtCurrency(p.last_sale_price) + (p.last_sale_year ? ' (' + p.last_sale_year + ')' : '') : '—'}</span></div>
    </div>`;
}

function buildTabbedPopup(address, tabs, activeTab) {
  const tabHeaders = tabs.map((t, i) =>
    `<div class="popup-tab ${i === activeTab ? 'active' : ''}" data-idx="${i}">${t.label}</div>`
  ).join('');
  const tabPanes = tabs.map((t, i) =>
    `<div class="popup-pane ${i === activeTab ? 'active' : ''}" data-idx="${i}">${t.content}</div>`
  ).join('');

  return `<div class="popup-card">
    <div class="popup-header">
      <h3>${address}</h3>
    </div>
    <div class="popup-tabs">${tabHeaders}</div>
    <div class="popup-panes">${tabPanes}</div>
  </div>`;
}

function attachPopupTabEvents(popup) {
  // Delay slightly to ensure DOM is ready
  setTimeout(() => {
    const el = popup.getElement();
    if (!el) return;
    el.querySelectorAll('.popup-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const idx = tab.dataset.idx;
        el.querySelectorAll('.popup-tab').forEach(t => t.classList.remove('active'));
        el.querySelectorAll('.popup-pane').forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        el.querySelector(`.popup-pane[data-idx="${idx}"]`)?.classList.add('active');
      });
    });
  }, 50);
}

// ── Click handlers ──────────────────────────────────────────────────────────
function onPointClick(e) {
  e.preventDefault && e.preventDefault();
  const f = e.features[0];
  const sp = f.properties;
  const coords = f.geometry.coordinates.slice();

  // Query parcel underneath this point
  const parcelFeats = map.queryRenderedFeatures(e.point, { layers: ['parcels-fill'] });
  const pp = parcelFeats.length > 0 ? parcelFeats[0].properties : null;

  const tabs = [
    { label: 'Survey Contact', content: buildSurveyTab(sp) },
  ];
  if (pp) {
    tabs.push({ label: 'Parcel Data (FL DOR)', content: buildParcelTab(pp) });
  }
  // Future tab placeholder
  // tabs.push({ label: 'Survey Results', content: '<div class="popup-body"><p style="color:var(--muted);text-align:center;padding:12px">No survey results yet</p></div>' });

  const html = buildTabbedPopup(sp.address, tabs, 0);
  const popup = new maplibregl.Popup({ offset: 15, maxWidth: '400px' })
    .setLngLat(coords)
    .setHTML(html)
    .addTo(map);
  attachPopupTabEvents(popup);
}

function onParcelClick(e) {
  // Don't open parcel popup if a survey point was also clicked
  const pointFeats = map.queryRenderedFeatures(e.point, { layers: ['survey-points'] });
  if (pointFeats.length > 0) return; // let onPointClick handle it

  const f = e.features[0];
  const pp = f.properties;
  const center = e.lngLat;

  const tabs = [
    { label: 'Parcel Data (FL DOR)', content: buildParcelTab(pp) },
  ];

  const html = buildTabbedPopup(pp.address || 'Parcel', tabs, 0);
  const popup = new maplibregl.Popup({ offset: 5, maxWidth: '400px' })
    .setLngLat(center)
    .setHTML(html)
    .addTo(map);
  attachPopupTabEvents(popup);
}

function onClusterClick(e) {
  const features = map.queryRenderedFeatures(e.point, { layers: ['cluster-circles'] });
  if (!features.length) return;
  const f = features[0];
  const p = f.properties;
  const coords = f.geometry.coordinates;

  // Build breakdown popup
  const total = p.point_count;
  const items = [
    { label: 'Completed', count: p.cnt_completed || 0, color: '#10b981' },
    { label: 'No Answer', count: p.cnt_no_answer || 0, color: '#f97316' },
    { label: 'Inaccessible', count: p.cnt_inaccessible || 0, color: '#ef4444' },
    { label: 'Not Interested', count: p.cnt_not_interested || 0, color: '#8b5cf6' },
    { label: 'Left Info', count: p.cnt_left_info || 0, color: '#3b82f6' },
    { label: 'Vacant', count: p.cnt_vacant || 0, color: '#6b7280' },
    { label: 'Follow Up', count: p.cnt_follow_up || 0, color: '#06b6d4' },
    { label: 'Other', count: p.cnt_other || 0, color: '#ec4899' },
  ].filter(i => i.count > 0);

  // Stacked bar
  const bar = items.map(i =>
    `<div style="flex:${i.count};background:${i.color};height:100%;min-width:2px" title="${i.label}: ${i.count}"></div>`
  ).join('');

  const rows = items.map(i => {
    const pct = Math.round(i.count / total * 100);
    return `<div style="display:flex;align-items:center;gap:6px;padding:3px 0;font-size:11px">
      <span style="width:8px;height:8px;border-radius:50%;background:${i.color};flex-shrink:0"></span>
      <span style="flex:1;color:#94a3b8">${i.label}</span>
      <span style="font-family:var(--mono);color:#e2e8f0">${i.count}</span>
      <span style="font-family:var(--mono);color:#64748b;font-size:10px;width:32px;text-align:right">${pct}%</span>
    </div>`;
  }).join('');

  const html = `<div class="popup-card" style="min-width:220px">
    <div class="popup-header" style="padding-bottom:8px">
      <h3 style="font-size:13px">${total} Survey Points</h3>
      <span style="font-size:11px;color:#64748b">Cluster breakdown by status</span>
    </div>
    <div style="display:flex;height:6px;border-radius:3px;overflow:hidden;margin:0 16px">${bar}</div>
    <div style="padding:8px 16px 12px">${rows}</div>
    <div style="padding:0 16px 10px;text-align:center">
      <span style="font-size:10px;color:#3b82f6;cursor:pointer" class="cluster-zoom-btn">Click to zoom in</span>
    </div>
  </div>`;

  const popup = new maplibregl.Popup({ offset: 15, maxWidth: '300px' })
    .setLngLat(coords)
    .setHTML(html)
    .addTo(map);

  // Zoom on button click
  setTimeout(() => {
    const el = popup.getElement();
    if (!el) return;
    const btn = el.querySelector('.cluster-zoom-btn');
    if (btn) {
      btn.addEventListener('click', () => {
        popup.remove();
        map.getSource('survey-clustered').getClusterExpansionZoom(p.cluster_id, (err, zoom) => {
          if (err) return;
          map.easeTo({ center: coords, zoom: zoom + 1, duration: 500 });
        });
      });
    }
  }, 50);
}

// Cluster hover effect
let clusterHoverPopup = null;
function setupClusterHover() {
  map.on('mouseenter', 'cluster-circles', (e) => {
    map.getCanvas().style.cursor = 'pointer';
    const f = e.features[0];
    const p = f.properties;
    const total = p.point_count;
    const items = [
      { label: 'Completed', count: p.cnt_completed || 0, color: '#10b981' },
      { label: 'No Answer', count: p.cnt_no_answer || 0, color: '#f97316' },
      { label: 'Inaccessible', count: p.cnt_inaccessible || 0, color: '#ef4444' },
    ].filter(i => i.count > 0);
    const summary = items.map(i => `<span style="color:${i.color}">${i.count}</span>`).join(' / ');
    const rest = total - items.reduce((s, i) => s + i.count, 0);

    clusterHoverPopup = new maplibregl.Popup({ offset: 20, closeButton: false, closeOnClick: false, maxWidth: '220px' })
      .setLngLat(f.geometry.coordinates)
      .setHTML(`<div style="padding:8px 12px;font-size:11px;color:#94a3b8;background:#111827;border:1px solid rgba(255,255,255,0.08);border-radius:8px">
        <strong style="color:#e2e8f0">${total} points</strong> — ${summary}${rest > 0 ? ` + ${rest} other` : ''}
        <div style="font-size:10px;color:#64748b;margin-top:2px">Click for full breakdown</div>
      </div>`)
      .addTo(map);
  });
  map.on('mouseleave', 'cluster-circles', () => {
    map.getCanvas().style.cursor = '';
    if (clusterHoverPopup) { clusterHoverPopup.remove(); clusterHoverPopup = null; }
  });
}

// ── Basemap switching ───────────────────────────────────────────────────────
function switchBasemap(style) {
  currentBasemap = style;
  const bm = BASEMAPS[style];

  // Save current data sources and layers
  const savedSources = {};
  const savedLayers = [];
  const dataSrcIds = ['parcels', 'survey', 'survey-clustered'];
  const dataLayerIds = [
    'parcels-fill', 'parcels-outline', 'parcels-3d',
    'heatmap', 'cluster-circles', 'cluster-count',
    'survey-points', 'survey-labels',
  ];

  dataLayerIds.forEach(id => {
    const l = map.getLayer(id);
    if (l) {
      savedLayers.push({
        id, type: l.type, source: l.source,
        layout: { ...map.getLayoutProperty(id, 'visibility') !== undefined ? { visibility: map.getLayoutProperty(id, 'visibility') } : {} },
        paint: {},
        filter: map.getFilter(id) || undefined,
        minzoom: l.minzoom, maxzoom: l.maxzoom,
      });
    }
  });

  // Update basemap source tiles
  const src = map.getSource('basemap');
  if (src) {
    map.removeLayer('basemap-layer');
    map.removeSource('basemap');
    map.addSource('basemap', {
      type: 'raster',
      tiles: bm.tiles,
      tileSize: bm.tileSize || 256,
      attribution: bm.attr,
    });
    // Re-add basemap layer at bottom
    const firstDataLayer = map.getStyle().layers.find(l => l.id !== 'basemap-layer');
    map.addLayer({ id: 'basemap-layer', type: 'raster', source: 'basemap' },
      firstDataLayer ? firstDataLayer.id : undefined);
  }

  // Update active button
  document.querySelectorAll('.basemap-opt').forEach(el => el.classList.remove('active'));
  document.querySelector(`.basemap-opt[data-style="${style}"]`)?.classList.add('active');
}

// ── Legend (unified: color picker + filter) ─────────────────────────────────
function buildUnifiedStatusControls() {
  const container = document.getElementById('unified-status-controls');
  if (!container) return;
  const counts = analysisData?.status_counts || {};
  container.innerHTML = '';

  Object.entries(STATUS_COLORS).forEach(([status, color]) => {
    const count = counts[status] || 0;
    if (count === 0 && status === 'Unknown') return;
    const row = document.createElement('div');
    row.className = 'legend-item';
    row.dataset.status = status;
    row.style.cssText = 'display:flex;align-items:center;gap:6px;padding:4px 0;font-size:12px;color:var(--text2);transition:opacity .15s';

    row.innerHTML = `
      <input type="color" value="${color}" data-status="${status}"
        style="width:20px;height:16px;border:1px solid var(--border);border-radius:3px;background:none;cursor:pointer;padding:0;flex-shrink:0;-webkit-appearance:none">
      <span class="sym-label" style="flex:1;cursor:pointer;user-select:none">${status}</span>
      <span class="legend-count" style="font-family:var(--mono);color:var(--muted);font-size:11px">${count}</span>`;

    // Color picker
    row.querySelector('input[type="color"]').addEventListener('input', (e) => {
      e.stopPropagation();
      const newColor = e.target.value;
      customStatusColors[status] = newColor;
      STATUS_COLORS[status] = newColor;
      updateSurveyPointColors();
    });

    // Click name/count to toggle filter
    row.querySelector('.sym-label').addEventListener('click', () => toggleStatusFilter(status, row));
    row.querySelector('.legend-count').addEventListener('click', () => toggleStatusFilter(status, row));

    container.appendChild(row);
  });
}

function buildLegend() {
  // Now handled by buildUnifiedStatusControls
  buildUnifiedStatusControls();
}

function toggleStatusFilter(status, el) {
  if (activeFilters.has(status)) {
    activeFilters.delete(status);
    el.style.opacity = '1';
  } else {
    activeFilters.add(status);
    el.style.opacity = '0.25';
  }
  applyFilters();
}

function applyFilters() {
  const search = document.getElementById('search-input').value.toLowerCase();
  let filter = ['all'];

  // Status filter
  if (activeFilters.size > 0) {
    const shown = Object.keys(STATUS_COLORS).filter(s => !activeFilters.has(s));
    filter.push(['in', 'status', ...shown]);
  }

  // Search filter
  if (search) {
    filter.push(['any',
      ['in', search, ['downcase', ['get', 'address']]],
      ['in', search, ['downcase', ['get', 'street_name']]],
    ]);
  }

  map.setFilter('survey-points', filter.length > 1 ? filter : null);
  map.setFilter('survey-labels', filter.length > 1 ? filter : null);
}

// ── Central layer definition map ─────────────────────────────────────────────
const LAYER_DEFS = {
  iaq_points:     { toggle: 'layer-iaq',              mapLayers: ['iaq-points'] },
  iaq_highlights: { toggle: 'layer-iaq-highlighted',  mapLayers: ['iaq-highlighted', 'iaq-street-line', 'iaq-street-line-core'] },
  contact_survey: { toggle: 'layer-points',           mapLayers: ['survey-points'] },
  parcels:        { toggle: 'layer-parcels',          mapLayers: ['parcels-fill', 'parcels-outline'] },
  clusters:       { toggle: 'layer-clusters',         mapLayers: ['cluster-circles', 'cluster-count'] },
  heatmap:        { toggle: 'layer-heatmap',          mapLayers: ['heatmap'] },
  labels:         { toggle: 'layer-labels',           mapLayers: ['survey-labels'] },
  '3d':           { toggle: 'layer-3d',               mapLayers: ['parcels-3d'] },
};

/**
 * Central function — sets map layer visibility AND syncs the sidebar checkbox.
 * Always use this instead of calling setLayoutProperty directly from chatbot actions.
 */
function setLayerVisibility(name, visible) {
  const def = LAYER_DEFS[name];
  if (!def) return;
  def.mapLayers.forEach(l => {
    if (map.getLayer(l)) map.setLayoutProperty(l, 'visibility', visible ? 'visible' : 'none');
  });
  const el = document.getElementById(def.toggle);
  if (el) el.checked = visible;
  // Special side-effects
  if (name === '3d') {
    if (visible) {
      map.easeTo({ pitch: 55, bearing: -15, duration: 800 });
      setLayerVisibility('parcels', false);
    } else {
      map.easeTo({ pitch: 0, bearing: 0, duration: 800 });
    }
  }
  if (name === 'heatmap') {
    const leg = document.getElementById('heatmap-legend');
    if (leg) leg.style.display = visible ? 'block' : 'none';
  }
  if (name === 'clusters') {
    const leg = document.getElementById('cluster-legend');
    if (leg) leg.style.display = visible ? 'block' : 'none';
    if (visible) setLayerVisibility('contact_survey', false);
  }
}

// ── Layer toggles ───────────────────────────────────────────────────────────
function setupLayerToggles() {
  const toggles = {
    'layer-points': ['survey-points'],
    'layer-parcels': ['parcels-fill', 'parcels-outline'],
    'layer-3d': ['parcels-3d'],
    'layer-heatmap': ['heatmap'],
    'layer-clusters': ['cluster-circles', 'cluster-count'],
    'layer-labels': ['survey-labels'],
    'layer-iaq': ['iaq-points'],
    'layer-iaq-highlighted': ['iaq-highlighted'],
  };

  Object.entries(toggles).forEach(([id, layers]) => {
    document.getElementById(id).addEventListener('change', (e) => {
      const vis = e.target.checked ? 'visible' : 'none';
      layers.forEach(l => { if (map.getLayer(l)) map.setLayoutProperty(l, 'visibility', vis); });

      // When 3D is toggled, adjust pitch
      if (id === 'layer-3d') {
        if (e.target.checked) {
          map.easeTo({ pitch: 55, bearing: -15, duration: 800 });
          // Hide 2D parcels when 3D is on
          map.setLayoutProperty('parcels-fill', 'visibility', 'none');
        } else {
          map.easeTo({ pitch: 0, bearing: 0, duration: 800 });
          if (document.getElementById('layer-parcels').checked) {
            map.setLayoutProperty('parcels-fill', 'visibility', 'visible');
          }
        }
      }

      // Hide individual points when clusters are on
      if (id === 'layer-clusters' && e.target.checked) {
        map.setLayoutProperty('survey-points', 'visibility', 'none');
        document.getElementById('layer-points').checked = false;
      }
      if (id === 'layer-points' && e.target.checked) {
        map.setLayoutProperty('cluster-circles', 'visibility', 'none');
        map.setLayoutProperty('cluster-count', 'visibility', 'none');
        document.getElementById('layer-clusters').checked = false;
      }

      // Show/hide layer-specific legends
      if (id === 'layer-heatmap') {
        document.getElementById('heatmap-legend').style.display = e.target.checked ? 'block' : 'none';
      }
      if (id === 'layer-clusters') {
        document.getElementById('cluster-legend').style.display = e.target.checked ? 'block' : 'none';
      }
    });
  });
}

// ── Parcel color by ─────────────────────────────────────────────────────────
function setupParcelColorBy() {
  document.getElementById('parcel-color-by').addEventListener('change', (e) => {
    const field = e.target.value;
    const expr = buildParcelColorExpr(field);
    map.setPaintProperty('parcels-fill', 'fill-color', expr);
    map.setPaintProperty('parcels-3d', 'fill-extrusion-color', expr);

    // Update parcel color legend
    if (typeof buildParcelColorLegend === 'function') buildParcelColorLegend();

    // Update 3D height based on field
    if (field === 'just_value') {
      map.setPaintProperty('parcels-3d', 'fill-extrusion-height', ['/', ['coalesce', ['get', 'just_value'], 0], 3000]);
    } else if (field === 'living_area') {
      map.setPaintProperty('parcels-3d', 'fill-extrusion-height', ['/', ['coalesce', ['get', 'living_area'], 0], 5]);
    } else if (field === 'year_built') {
      map.setPaintProperty('parcels-3d', 'fill-extrusion-height', ['-', ['coalesce', ['get', 'year_built'], 1950], 1900]);
    } else {
      map.setPaintProperty('parcels-3d', 'fill-extrusion-height', 30);
    }
  });
}

// ── Analysis ────────────────────────────────────────────────────────────────
function buildAnalysis() {
  if (!analysisData) return;
  const a = analysisData;

  // Summary bar text
  document.getElementById('analysis-summary').textContent =
    `${a.total_points} points | ${a.completion_rate}% completed | ${a.parcel_stats?.total || 0} parcels`;

  // Stat cards
  const cards = document.getElementById('stat-cards');
  cards.innerHTML = `
    <div class="stat-card"><div class="label">Total Addresses</div><div class="value">${a.total_points}</div></div>
    <div class="stat-card"><div class="label">Completed</div><div class="value" style="color:var(--green)">${a.status_counts.Completed || 0}</div><div class="sub">${a.completion_rate}% rate</div></div>
    <div class="stat-card"><div class="label">No Answer</div><div class="value" style="color:var(--orange)">${a.status_counts['No Answer'] || 0}</div></div>
    <div class="stat-card"><div class="label">Inaccessible</div><div class="value" style="color:var(--red)">${a.status_counts.Inaccessible || 0}</div></div>
    <div class="stat-card"><div class="label">Follow Up</div><div class="value" style="color:var(--cyan)">${a.status_counts['Follow Up'] || 0}</div></div>
    <div class="stat-card"><div class="label">Parcels Loaded</div><div class="value">${fmt(a.parcel_stats?.total || 0)}</div></div>
  `;

  // Status pie chart
  buildStatusChart(a);
  buildStreetsChart(a);
  buildStreetsTable(a);
  buildParcelAnalysis(a);
}

function buildStatusChart(a) {
  const ctx = document.getElementById('chart-status');
  if (!ctx) return;
  const labels = Object.keys(a.status_counts);
  const data = Object.values(a.status_counts);
  const colors = labels.map(l => STATUS_COLORS[l] || '#6b7280');

  if (charts.status) charts.status.destroy();
  charts.status = new Chart(ctx, {
    type: 'doughnut',
    data: { labels, datasets: [{ data, backgroundColor: colors, borderWidth: 0, hoverOffset: 6 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'right', labels: { color: '#94a3b8', font: { size: 11 }, padding: 8, usePointStyle: true, pointStyleWidth: 8 } },
      },
      cutout: '55%',
    },
  });
}

function buildStreetsChart(a) {
  const ctx = document.getElementById('chart-streets');
  if (!ctx) return;
  const top = (a.streets || []).slice(0, 12);
  const labels = top.map(s => s.name);
  const completed = top.map(s => s.statuses.Completed || 0);
  const other = top.map(s => s.count - (s.statuses.Completed || 0));

  if (charts.streets) charts.streets.destroy();
  charts.streets = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Completed', data: completed, backgroundColor: '#10b981', borderRadius: 3 },
        { label: 'Other', data: other, backgroundColor: '#1e293b', borderRadius: 3 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      indexAxis: 'y',
      scales: {
        x: { stacked: true, grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#64748b', font: { size: 10 } } },
        y: { stacked: true, grid: { display: false }, ticks: { color: '#94a3b8', font: { size: 10 } } },
      },
      plugins: { legend: { display: false } },
    },
  });
}

function buildStreetsTable(a) {
  const tbody = document.querySelector('#streets-table tbody');
  if (!tbody) return;
  tbody.innerHTML = (a.streets || []).map(s => `
    <tr>
      <td>${s.name}</td>
      <td style="font-family:var(--mono)">${s.count}</td>
      <td style="color:var(--green)">${s.statuses.Completed || 0}</td>
      <td style="color:var(--orange)">${s.statuses['No Answer'] || 0}</td>
      <td style="color:var(--red)">${s.statuses.Inaccessible || 0}</td>
      <td>${s.count - (s.statuses.Completed || 0) - (s.statuses['No Answer'] || 0) - (s.statuses.Inaccessible || 0)}</td>
    </tr>
  `).join('');
}

function buildParcelAnalysis(a) {
  const ps = a.parcel_stats;
  if (!ps || !ps.total) {
    document.getElementById('parcel-stats').innerHTML = '<p style="color:var(--muted)">No parcel data loaded</p>';
    return;
  }

  document.getElementById('parcel-stats').innerHTML = `
    <div class="stat-card"><div class="label">Total Parcels</div><div class="value">${fmt(ps.total)}</div></div>
    <div class="stat-card"><div class="label">Avg Value</div><div class="value" style="font-size:18px">${fmtCurrency(ps.values?.mean)}</div></div>
    <div class="stat-card"><div class="label">Median Value</div><div class="value" style="font-size:18px">${fmtCurrency(ps.values?.median)}</div></div>
    <div class="stat-card"><div class="label">Avg Living Area</div><div class="value" style="font-size:18px">${fmt(ps.areas?.mean)} ft²</div></div>
    <div class="stat-card"><div class="label">Avg Year Built</div><div class="value">${ps.years?.mean || '—'}</div>
      <div class="sub">${ps.years?.oldest || '—'} – ${ps.years?.newest || '—'}</div></div>
  `;

  // Value histogram
  if (ps.value_histogram?.length) {
    const ctx = document.getElementById('chart-values');
    if (charts.values) charts.values.destroy();
    charts.values = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: ps.value_histogram.map(b => b.label),
        datasets: [{ data: ps.value_histogram.map(b => b.count), backgroundColor: '#3b82f6', borderRadius: 3 }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false }, ticks: { color: '#64748b', font: { size: 9 } } },
          y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#64748b', font: { size: 10 } } },
        },
      },
    });
  }

  // Year histogram
  if (ps.year_histogram?.length) {
    const ctx = document.getElementById('chart-years');
    if (charts.years) charts.years.destroy();
    charts.years = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: ps.year_histogram.map(b => b.label),
        datasets: [{ data: ps.year_histogram.map(b => b.count), backgroundColor: '#06b6d4', borderRadius: 3 }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false }, ticks: { color: '#64748b', font: { size: 9 } } },
          y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#64748b', font: { size: 10 } } },
        },
      },
    });
  }

  // Land use pie
  if (ps.land_use) {
    const ctx = document.getElementById('chart-landuse');
    const luColors = {
      Residential: '#3b82f6', Commercial: '#f59e0b', Institutional: '#8b5cf6',
      Government: '#ef4444', Agriculture: '#10b981', 'Vacant Land': '#94a3b8', Other: '#6b7280',
    };
    if (charts.landuse) charts.landuse.destroy();
    charts.landuse = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: Object.keys(ps.land_use),
        datasets: [{ data: Object.values(ps.land_use),
          backgroundColor: Object.keys(ps.land_use).map(k => luColors[k] || '#6b7280'),
          borderWidth: 0 }],
      },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '50%',
        plugins: { legend: { position: 'right', labels: { color: '#94a3b8', font: { size: 10 }, padding: 6, usePointStyle: true, pointStyleWidth: 8 } } },
      },
    });
  }
}

// ── UI interactions ─────────────────────────────────────────────────────────
function setupUI() {
  // Sidebar toggle
  document.getElementById('sidebar-toggle').addEventListener('click', () => {
    const sb = document.getElementById('sidebar');
    if (sb.classList.contains('collapsed')) {
      sb.classList.remove('collapsed');
      if (panelSizes.sidebar !== 280) sb.style.width = panelSizes.sidebar + 'px';
    } else {
      sb.style.width = '';
      sb.classList.add('collapsed');
    }
    setTimeout(() => map && map.resize(), 350);
  });

  // Analysis panel toggle
  document.getElementById('analysis-toggle').addEventListener('click', () => {
    const panel = document.getElementById('analysis-panel');
    const toggle = document.getElementById('analysis-toggle');
    if (panel.classList.contains('open')) {
      panel.style.transition = 'height .3s ease';
      panel.style.height = '0';
      panel.classList.remove('open');
      toggle.classList.remove('open');
    } else {
      panel.style.transition = 'height .3s ease';
      panel.style.height = panelSizes.analysis + 'px';
      panel.classList.add('open');
      toggle.classList.add('open');
    }
    setTimeout(() => map && map.resize(), 350);
  });

  // Analysis tabs
  document.querySelectorAll('.analysis-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.analysis-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.analysis-pane').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById('pane-' + tab.dataset.tab)?.classList.add('active');
    });
  });

  // Basemap selector
  document.querySelectorAll('.basemap-opt').forEach(opt => {
    opt.addEventListener('click', () => switchBasemap(opt.dataset.style));
  });

  // Search
  document.getElementById('search-input').addEventListener('input', () => applyFilters());

  // Legend reset
  document.getElementById('legend-reset').addEventListener('click', () => {
    activeFilters.clear();
    document.querySelectorAll('#unified-status-controls .legend-item').forEach(el => {
      el.classList.remove('dimmed');
      el.style.opacity = '1';
    });
    applyFilters();
  });

  // Fullscreen
  document.getElementById('btn-fullscreen').addEventListener('click', () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  });

  // Import modal
  document.getElementById('btn-import').addEventListener('click', () => {
    document.getElementById('import-modal').classList.add('show');
  });
  document.getElementById('modal-close').addEventListener('click', () => {
    document.getElementById('import-modal').classList.remove('show');
  });
  document.getElementById('import-modal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) {
      document.getElementById('import-modal').classList.remove('show');
    }
  });

  // Upload zones
  setupUploadZones();
  setupLayerToggles();
  setupParcelColorBy();
  setupSymbology();
  initChat();
}

// ── Symbology controls ──────────────────────────────────────────────────────
// Custom colors that override defaults
const customStatusColors = {};
const customParcelColors = {};

const PARCEL_LU_COLORS = {
  'Residential': '#3b82f6', 'Commercial': '#f59e0b', 'Institutional': '#8b5cf6',
  'Government': '#ef4444', 'Agriculture': '#10b981', 'Vacant Land': '#94a3b8', 'Other': '#6b7280',
};

function setupSymbology() {
  // ── Survey point controls ──
  const ptSize = document.getElementById('pt-size');
  const ptOpacity = document.getElementById('pt-opacity');
  const ptStroke = document.getElementById('pt-stroke');

  ptSize.addEventListener('input', () => {
    const v = parseInt(ptSize.value);
    document.getElementById('pt-size-val').textContent = v;
    map.setPaintProperty('survey-points', 'circle-radius',
      ['interpolate', ['linear'], ['zoom'], 12, Math.max(2, v - 4), 16, v, 19, v + 5]);
  });

  ptOpacity.addEventListener('input', () => {
    const v = parseInt(ptOpacity.value) / 100;
    document.getElementById('pt-opacity-val').textContent = v.toFixed(2);
    map.setPaintProperty('survey-points', 'circle-opacity', v);
  });

  ptStroke.addEventListener('input', () => {
    const v = parseInt(ptStroke.value);
    document.getElementById('pt-stroke-val').textContent = v;
    map.setPaintProperty('survey-points', 'circle-stroke-width', v);
  });

  // ── Unified status controls: color + name + count + filter ──
  buildUnifiedStatusControls();

  // ── Parcel controls ──
  const parOpacity = document.getElementById('par-opacity');
  const parOutline = document.getElementById('par-outline');
  const parOutlineColor = document.getElementById('par-outline-color');

  parOpacity.addEventListener('input', () => {
    const v = parseInt(parOpacity.value) / 100;
    document.getElementById('par-opacity-val').textContent = v.toFixed(2);
    map.setPaintProperty('parcels-fill', 'fill-opacity', v);
  });

  parOutline.addEventListener('input', () => {
    const v = parseInt(parOutline.value) / 10;
    document.getElementById('par-outline-val').textContent = v.toFixed(1);
    map.setPaintProperty('parcels-outline', 'line-width', v);
  });

  parOutlineColor.addEventListener('input', () => {
    const c = parOutlineColor.value;
    const rgba = `rgba(${parseInt(c.slice(1,3),16)},${parseInt(c.slice(3,5),16)},${parseInt(c.slice(5,7),16)},0.4)`;
    map.setPaintProperty('parcels-outline', 'line-color', rgba);
  });

  // ── Parcel land use color pickers ──
  buildParcelColorLegend();

  // ── Heatmap symbology ──
  const heatRadius = document.getElementById('heat-radius');
  const heatIntensity = document.getElementById('heat-intensity');
  const heatOpacity = document.getElementById('heat-opacity');

  if (heatRadius) heatRadius.addEventListener('input', () => {
    const v = parseInt(heatRadius.value);
    document.getElementById('heat-radius-val').textContent = v;
    if (map.getLayer('heatmap')) map.setPaintProperty('heatmap', 'heatmap-radius', v);
  });
  if (heatIntensity) heatIntensity.addEventListener('input', () => {
    const v = parseInt(heatIntensity.value) / 10;
    document.getElementById('heat-intensity-val').textContent = v.toFixed(1);
    if (map.getLayer('heatmap')) map.setPaintProperty('heatmap', 'heatmap-intensity', v);
  });
  if (heatOpacity) heatOpacity.addEventListener('input', () => {
    const v = parseInt(heatOpacity.value) / 100;
    document.getElementById('heat-opacity-val').textContent = v.toFixed(2);
    if (map.getLayer('heatmap')) map.setPaintProperty('heatmap', 'heatmap-opacity', v);
  });

  // ── Heatmap status filter ──
  const heatFilter = document.getElementById('heatmap-status-filter');
  if (heatFilter) heatFilter.addEventListener('change', () => {
    applyHeatmapClusterFilter();
  });

  // ── Cluster status filter ──
  const clusterFilter = document.getElementById('cluster-status-filter');
  if (clusterFilter) clusterFilter.addEventListener('change', () => {
    applyHeatmapClusterFilter();
  });
}

function applyHeatmapClusterFilter() {
  const heatStatus = document.getElementById('heatmap-status-filter')?.value || 'all';
  const clusterStatus = document.getElementById('cluster-status-filter')?.value || 'all';

  // Filter heatmap data
  if (surveyData?.features) {
    const heatFiltered = heatStatus === 'all'
      ? surveyData
      : { type: 'FeatureCollection', features: surveyData.features.filter(f => f.properties.status === heatStatus) };

    if (map.getSource('survey')) {
      // Heatmap uses 'survey' source - we need a separate source for filtered heatmap
      if (!map.getSource('survey-heat-filtered')) {
        map.addSource('survey-heat-filtered', { type: 'geojson', data: heatFiltered });
      } else {
        map.getSource('survey-heat-filtered').setData(heatFiltered);
      }
      // Point heatmap layer to filtered source
      if (map.getLayer('heatmap')) {
        const vis = map.getLayoutProperty('heatmap', 'visibility');
        const paint = {
          'heatmap-weight': 1,
          'heatmap-intensity': parseFloat(document.getElementById('heat-intensity-val')?.textContent || '1.5'),
          'heatmap-radius': parseInt(document.getElementById('heat-radius-val')?.textContent || '25'),
          'heatmap-opacity': parseFloat(document.getElementById('heat-opacity-val')?.textContent || '0.7'),
        };
        // Use status color for single-status heatmap
        let heatColor;
        if (heatStatus !== 'all' && STATUS_COLORS[heatStatus]) {
          const c = STATUS_COLORS[heatStatus];
          heatColor = [
            'interpolate', ['linear'], ['heatmap-density'],
            0, 'rgba(0,0,0,0)', 0.3, c + '40', 0.5, c + '80', 0.7, c + 'bb', 1, c,
          ];
          // Update gradient bar
          const bar = document.getElementById('heat-gradient-bar');
          if (bar) bar.style.background = `linear-gradient(to right, rgba(0,0,0,0), ${c}40, ${c}80, ${c}bb, ${c})`;
        } else {
          heatColor = [
            'interpolate', ['linear'], ['heatmap-density'],
            0, 'rgba(0,0,0,0)', 0.2, '#3b82f6', 0.4, '#06b6d4',
            0.6, '#10b981', 0.8, '#f59e0b', 1, '#ef4444',
          ];
          const bar = document.getElementById('heat-gradient-bar');
          if (bar) bar.style.background = 'linear-gradient(to right,rgba(0,0,0,0),#3b82f6,#06b6d4,#10b981,#f59e0b,#ef4444)';
        }

        map.removeLayer('heatmap');
        map.addLayer({
          id: 'heatmap', type: 'heatmap', source: 'survey-heat-filtered',
          layout: { visibility: vis || 'none' },
          paint: { ...paint, 'heatmap-color': heatColor },
        }, 'cluster-circles');
      }
    }

    // Filter cluster data
    const clusterFiltered = clusterStatus === 'all'
      ? surveyData
      : { type: 'FeatureCollection', features: surveyData.features.filter(f => f.properties.status === clusterStatus) };

    if (map.getSource('survey-clustered')) {
      map.getSource('survey-clustered').setData(clusterFiltered);
    }

    // When filtering clusters to a single status, color them with that status color
    if (map.getLayer('cluster-circles')) {
      if (clusterStatus !== 'all' && STATUS_COLORS[clusterStatus]) {
        map.setPaintProperty('cluster-circles', 'circle-color', STATUS_COLORS[clusterStatus]);
        // Update legend info
        const info = document.getElementById('cluster-legend-info');
        if (info) info.innerHTML = `<div style="font-size:11px;color:var(--text2)">Showing <strong style="color:${STATUS_COLORS[clusterStatus]}">${clusterStatus}</strong> points only</div>`;
      } else {
        // Restore dominant-status coloring
        map.setPaintProperty('cluster-circles', 'circle-color', [
          'case',
          ['>=', ['get', 'cnt_completed'],     ['max', ['get', 'cnt_no_answer'], ['get', 'cnt_inaccessible'], ['get', 'cnt_left_info'], ['get', 'cnt_not_interested'], ['get', 'cnt_vacant'], ['get', 'cnt_follow_up'], ['get', 'cnt_other']]], '#10b981',
          ['>=', ['get', 'cnt_no_answer'],     ['max', ['get', 'cnt_completed'], ['get', 'cnt_inaccessible'], ['get', 'cnt_left_info'], ['get', 'cnt_not_interested'], ['get', 'cnt_vacant'], ['get', 'cnt_follow_up'], ['get', 'cnt_other']]], '#f97316',
          ['>=', ['get', 'cnt_inaccessible'],  ['max', ['get', 'cnt_completed'], ['get', 'cnt_no_answer'], ['get', 'cnt_left_info'], ['get', 'cnt_not_interested'], ['get', 'cnt_vacant'], ['get', 'cnt_follow_up'], ['get', 'cnt_other']]], '#ef4444',
          ['>=', ['get', 'cnt_left_info'],     ['max', ['get', 'cnt_completed'], ['get', 'cnt_no_answer'], ['get', 'cnt_inaccessible'], ['get', 'cnt_not_interested'], ['get', 'cnt_vacant'], ['get', 'cnt_follow_up'], ['get', 'cnt_other']]], '#3b82f6',
          '#8b5cf6'
        ]);
        const info = document.getElementById('cluster-legend-info');
        if (info) info.innerHTML = `
          <div style="font-size:11px;color:var(--text2);margin-bottom:4px">Circle color = most common status:</div>
          <div style="display:flex;flex-wrap:wrap;gap:6px;font-size:10px;color:var(--text2)">
            <span><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#10b981"></span> Completed</span>
            <span><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#f97316"></span> No Answer</span>
            <span><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#ef4444"></span> Inaccessible</span>
            <span><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#3b82f6"></span> Left Info</span>
          </div>`;
      }
    }
  }
}

function buildParcelColorLegend() {
  const container = document.getElementById('parcel-color-legend');
  const field = document.getElementById('parcel-color-by').value;
  container.innerHTML = '';

  if (field === 'land_use') {
    container.innerHTML = '<div style="font-size:11px;color:var(--muted);font-weight:600;margin-bottom:6px">Land Use Colors</div>';
    Object.entries(PARCEL_LU_COLORS).forEach(([lu, color]) => {
      const row = document.createElement('div');
      row.className = 'sym-color-row';
      row.innerHTML = `
        <input type="color" value="${customParcelColors[lu] || color}" data-lu="${lu}">
        <span class="sym-label">${lu}</span>`;
      row.querySelector('input').addEventListener('input', (e) => {
        customParcelColors[lu] = e.target.value;
        PARCEL_LU_COLORS[lu] = e.target.value;
        const expr = buildParcelColorExpr('land_use');
        map.setPaintProperty('parcels-fill', 'fill-color', expr);
        map.setPaintProperty('parcels-3d', 'fill-extrusion-color', expr);
      });
      container.appendChild(row);
    });
  } else if (field === 'just_value') {
    container.innerHTML = `<div style="font-size:11px;color:var(--muted);margin-top:4px">
      <div style="display:flex;align-items:center;gap:4px;margin-bottom:2px">
        <span style="font-size:10px">$0</span>
        <div style="flex:1;height:8px;border-radius:4px;background:linear-gradient(to right,#1e293b,#3b82f6,#06b6d4,#10b981,#f59e0b,#ef4444)"></div>
        <span style="font-size:10px">$800k+</span>
      </div></div>`;
  } else if (field === 'year_built') {
    container.innerHTML = `<div style="font-size:11px;color:var(--muted);margin-top:4px">
      <div style="display:flex;align-items:center;gap:4px;margin-bottom:2px">
        <span style="font-size:10px">1920</span>
        <div style="flex:1;height:8px;border-radius:4px;background:linear-gradient(to right,#ef4444,#f97316,#f59e0b,#10b981,#3b82f6)"></div>
        <span style="font-size:10px">2020+</span>
      </div></div>`;
  } else if (field === 'living_area') {
    container.innerHTML = `<div style="font-size:11px;color:var(--muted);margin-top:4px">
      <div style="display:flex;align-items:center;gap:4px;margin-bottom:2px">
        <span style="font-size:10px">0</span>
        <div style="flex:1;height:8px;border-radius:4px;background:linear-gradient(to right,#1e293b,#3b82f6,#06b6d4,#10b981,#f59e0b,#ef4444)"></div>
        <span style="font-size:10px">4000+ sqft</span>
      </div></div>`;
  }
}

function updateSurveyPointColors() {
  // Rebuild the color expression using current STATUS_COLORS
  const colorExpr = ['match', ['get', 'status']];
  Object.entries(STATUS_COLORS).forEach(([status, color]) => {
    colorExpr.push(status, color);
  });
  colorExpr.push('#9ca3af'); // fallback
  map.setPaintProperty('survey-points', 'circle-color', colorExpr);

  // Also update each feature's stored color for popups
  if (surveyData?.features) {
    surveyData.features.forEach(f => {
      f.properties.color = STATUS_COLORS[f.properties.status] || '#9ca3af';
    });
    map.getSource('survey')?.setData(surveyData);
    map.getSource('survey-clustered')?.setData(surveyData);
  }
}

function updateLegendColors() {
  document.querySelectorAll('#legend-container .legend-item').forEach(el => {
    const status = el.dataset.status;
    const dot = el.querySelector('.legend-dot');
    if (dot && STATUS_COLORS[status]) {
      dot.style.background = STATUS_COLORS[status];
    }
  });
}

function setupUploadZones() {
  document.querySelectorAll('.upload-zone').forEach(zone => {
    const input = zone.querySelector('input[type="file"]');
    const endpoint = zone.dataset.endpoint;

    zone.addEventListener('click', () => input.click());
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('dragover'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('dragover');
      if (e.dataTransfer.files.length) uploadFile(zone, endpoint, e.dataTransfer.files[0]);
    });
    input.addEventListener('change', () => {
      if (input.files.length) uploadFile(zone, endpoint, input.files[0]);
    });
  });
}

// ── Analysis overlay management ─────────────────────────────────────────────
const OVERLAY_STEPS = ['ostep-upload','ostep-parse','ostep-geo','ostep-score','ostep-analysis','ostep-validate'];

function showAnalysisOverlay() {
  OVERLAY_STEPS.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('done','active');
    const icon = el.querySelector('.step-icon');
    if (icon) icon.textContent = OVERLAY_STEPS.indexOf(id) + 1;
  });
  setOverlayProgress(0, 'Preparing...');
  setOverlayStep('ostep-upload');
  document.getElementById('analysis-overlay')?.classList.add('show');
}

function setOverlayProgress(pct, label) {
  const fill = document.getElementById('overlay-progress-fill');
  if (fill) fill.style.width = pct + '%';
  const pctEl = document.getElementById('overlay-progress-pct');
  if (pctEl) pctEl.textContent = pct + '%';
  const labelEl = document.getElementById('overlay-progress-label');
  if (labelEl) labelEl.textContent = label;
}

function setOverlayStep(activeId) {
  const idx = OVERLAY_STEPS.indexOf(activeId);
  OVERLAY_STEPS.forEach((id, i) => {
    const el = document.getElementById(id);
    if (!el) return;
    const icon = el.querySelector('.step-icon');
    if (i < idx) {
      el.classList.remove('active'); el.classList.add('done');
      if (icon) icon.textContent = '✓';
    } else if (i === idx) {
      el.classList.remove('done'); el.classList.add('active');
    } else {
      el.classList.remove('done','active');
      if (icon) icon.textContent = i + 1;
    }
  });
}

function finishOverlaySteps() {
  OVERLAY_STEPS.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('active'); el.classList.add('done');
    const icon = el.querySelector('.step-icon');
    if (icon) icon.textContent = '✓';
  });
}

function hideAnalysisOverlay() {
  document.getElementById('analysis-overlay')?.classList.remove('show');
}

function simulateIAQSteps(xhrRef) {
  const schedule = [
    { delay: 1000, stepId: 'ostep-parse',    pct: 25, label: 'Parsing Qualtrics CSV...' },
    { delay: 3000, stepId: 'ostep-geo',       pct: 42, label: 'Validating GPS coordinates...' },
    { delay: 7000, stepId: 'ostep-score',     pct: 60, label: 'Computing risk scores...' },
    { delay: 12000,stepId: 'ostep-analysis',  pct: 75, label: 'Running street-level analysis...' },
    { delay: 18000,stepId: 'ostep-validate',  pct: 88, label: 'Cross-validating with contact data...' },
  ];
  schedule.forEach(({ delay, stepId, pct, label }) => {
    setTimeout(() => {
      if (xhrRef.done) return;
      setOverlayStep(stepId);
      setOverlayProgress(pct, label);
    }, delay);
  });
  // After all steps fire, pulse the bar if server is still working (geocoding can be slow)
  setTimeout(() => {
    if (xhrRef.done) return;
    let tick = 0;
    const pulse = setInterval(() => {
      if (xhrRef.done) { clearInterval(pulse); return; }
      tick++;
      // Forward-only: 88→89→90→91→92→93→94→95→94→93...  (never goes below 88)
      const swing = Math.sin(tick * 0.4) * 3.5;
      const pct = Math.min(95, Math.max(88, Math.round(88 + Math.abs(swing) + tick * 0.12)));
      const spinner = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'][tick % 10];
      setOverlayProgress(pct, `${spinner} Cross-validating with contact data…`);
    }, 900);
    xhrRef.pulse = pulse;
  }, 21000);
}

// ── Summary popup ────────────────────────────────────────────────────────────
function showSummaryPopup(uploadResult, iaqAnaData) {
  const body = document.getElementById('summary-card-body');
  if (!body) return;

  const a   = iaqAnaData?.analysis || {};
  const v   = iaqAnaData?.validation || {};
  const scores   = a.scores    || {};
  const health   = a.health    || {};
  const riskTiers = a.risk_tiers || {};
  const ownership = a.ownership  || {};
  const housing   = a.housing    || {};

  // Top risk streets
  const allStreets = iaqAnaData?.street_stats || {};
  const topStreets = Object.entries(allStreets)
    .filter(([, d]) => !d.insufficient_data)
    .sort(([, a2], [, b]) => b.mean_risk - a2.mean_risk)
    .slice(0, 5);

  // Unmatched breakdown
  const unmatchedDetails = (v.match_details || []).filter(d => !d.matched);
  const unmatchedByReason = {
    gpsOffset:   unmatchedDetails.filter(d => d.nearest_contact_m != null && d.nearest_contact_m < 300).length,
    notInList:   unmatchedDetails.filter(d => d.nearest_contact_m != null && d.nearest_contact_m >= 300 && d.nearest_contact_m < 1000).length,
    noContact:   unmatchedDetails.filter(d => d.nearest_contact_m == null || d.nearest_contact_m >= 1000).length,
    geocoded:    unmatchedDetails.filter(d => d.coord_source === 'geocoded').length,
  };
  const unmatchedByStreet = {};
  unmatchedDetails.forEach(d => {
    if (!unmatchedByStreet[d.street_name]) unmatchedByStreet[d.street_name] = { count: 0, reasons: [] };
    unmatchedByStreet[d.street_name].count++;
    const r = (d.nearest_contact_m != null && d.nearest_contact_m < 300) ? 'GPS/geocode offset'
            : (d.nearest_contact_m != null && d.nearest_contact_m < 1000) ? 'Not in canvassing list'
            : 'No contact found';
    if (!unmatchedByStreet[d.street_name].reasons.includes(r))
      unmatchedByStreet[d.street_name].reasons.push(r);
  });
  const unmatchedStreetRows = Object.entries(unmatchedByStreet)
    .sort(([, a2], [, b2]) => b2.count - a2.count)
    .slice(0, 8);

  // Geocoding source breakdown from match_details
  const _md = v.match_details || [];
  const _gpsCt    = _md.filter(d => d.coord_source === 'gps').length;
  const _addrCt   = _md.filter(d => d.coord_source === 'address_matched').length;
  const _geoCt    = _md.filter(d => d.coord_source === 'geocoded').length;
  const _totalMap = uploadResult.points || a.geocoded || 0;

  body.innerHTML = `
    <!-- Data match banner -->
    <div style="background:rgba(16,185,129,.07);border:1px solid rgba(16,185,129,.2);border-radius:10px;padding:16px;margin-bottom:18px">
      <div style="font-size:11px;font-weight:700;color:var(--green);margin-bottom:12px;text-transform:uppercase;letter-spacing:.06em">Survey Points — Mapping &amp; Geocoding</div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px">
        <div style="flex:1;min-width:100px;background:rgba(255,255,255,.04);border-radius:8px;padding:10px 14px;text-align:center">
          <div style="font-size:26px;font-weight:700;font-family:var(--mono)">${_totalMap}</div>
          <div style="font-size:11px;color:var(--text2);margin-top:2px">Responses Placed on Map</div>
        </div>
        <div style="flex:2;min-width:200px;background:rgba(255,255,255,.04);border-radius:8px;padding:10px 14px">
          <div style="font-size:10px;font-weight:700;color:var(--muted);margin-bottom:7px;text-transform:uppercase;letter-spacing:.06em">Coordinate Source Breakdown</div>
          ${_gpsCt  ? `<div style="display:flex;justify-content:space-between;padding:3px 0;font-size:12px;border-bottom:1px solid var(--border)"><span style="color:var(--green)">✓ GPS (in-field Qualtrics)</span><span style="font-family:var(--mono);font-weight:600">${_gpsCt} <span style="color:var(--muted);font-size:10px">(${Math.round(_gpsCt/_totalMap*100)}%)</span></span></div>` : ''}
          ${_addrCt ? `<div style="display:flex;justify-content:space-between;padding:3px 0;font-size:12px;border-bottom:1px solid var(--border)"><span style="color:var(--cyan)">⊞ Address-matched to contact data</span><span style="font-family:var(--mono);font-weight:600">${_addrCt} <span style="color:var(--muted);font-size:10px">(${Math.round(_addrCt/_totalMap*100)}%)</span></span></div>` : ''}
          ${_geoCt  ? `<div style="display:flex;justify-content:space-between;padding:3px 0;font-size:12px"><span style="color:var(--purple)">◎ Census geocoded (address fallback)</span><span style="font-family:var(--mono);font-weight:600">${_geoCt} <span style="color:var(--muted);font-size:10px">(${Math.round(_geoCt/_totalMap*100)}%)</span></span></div>` : ''}
        </div>
        <div style="flex:1;min-width:100px;background:rgba(255,255,255,.04);border-radius:8px;padding:10px 14px;text-align:center">
          <div style="font-size:26px;font-weight:700;font-family:var(--mono)">${uploadResult.streets_analyzed || 0}</div>
          <div style="font-size:11px;color:var(--text2);margin-top:2px">Streets Analyzed</div>
          <div style="font-size:10px;color:var(--muted);margin-top:2px">≥3 responses each</div>
        </div>
      </div>

      <!-- Community data match row -->
      ${v.total_completed_contacts ? `
      <div style="border-top:1px solid rgba(16,185,129,.2);padding-top:12px">
        <div style="font-size:10px;font-weight:700;color:var(--muted);margin-bottom:8px;text-transform:uppercase;letter-spacing:.06em">Match with Community Contact Data (Completed visits)</div>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <div style="flex:1;min-width:90px;text-align:center">
            <div style="font-size:22px;font-weight:700;font-family:var(--mono)">${v.total_completed_contacts}</div>
            <div style="font-size:11px;color:var(--text2)">Completed Contacts</div>
          </div>
          <div style="flex:1;min-width:90px;text-align:center">
            <div style="font-size:22px;font-weight:700;font-family:var(--mono);color:var(--green)">${v.matched_iaq_responses}</div>
            <div style="font-size:11px;color:var(--text2)">Survey → Contact Confirmed</div>
            <div style="font-size:10px;color:var(--muted);margin-top:2px">geo-proximity ≤150 m</div>
          </div>
          <div style="flex:1;min-width:90px;text-align:center">
            <div style="font-size:22px;font-weight:700;font-family:var(--mono);color:${v.match_rate_pct>60?'var(--green)':v.match_rate_pct>30?'var(--orange)':'var(--red)'}">${v.match_rate_pct}%</div>
            <div style="font-size:11px;color:var(--text2)">Confirmation Rate</div>
            <div style="font-size:10px;color:var(--muted);margin-top:2px">${v.unmatched_iaq} not confirmed</div>
          </div>
        </div>
      </div>` : `
      <div style="border-top:1px solid rgba(16,185,129,.2);padding-top:10px;font-size:12px;color:var(--muted)">
        Upload the Community Contact Excel file to see match rate against completed visits.
      </div>`}
    </div>

    <!-- Unmatched points — why -->
    ${unmatchedDetails.length ? `
    <div style="background:rgba(239,68,68,.06);border:1px solid rgba(239,68,68,.18);border-radius:10px;padding:16px;margin-bottom:18px">
      <div style="font-size:11px;font-weight:700;color:var(--red);margin-bottom:10px;text-transform:uppercase;letter-spacing:.06em">
        Unmatched Points — Why (${unmatchedDetails.length} of ${v.total_iaq_responses || 0})
      </div>
      <!-- Reason chips -->
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">
        ${unmatchedByReason.gpsOffset ? `<span style="padding:3px 10px;border-radius:10px;background:rgba(234,179,8,.12);border:1px solid rgba(234,179,8,.3);color:#ca8a04;font-size:10px;font-weight:600">
          GPS/geocode offset: ${unmatchedByReason.gpsOffset} — nearest contact 150–300m (precision gap)</span>` : ''}
        ${unmatchedByReason.notInList ? `<span style="padding:3px 10px;border-radius:10px;background:rgba(249,115,22,.12);border:1px solid rgba(249,115,22,.3);color:#ea580c;font-size:10px;font-weight:600">
          Not in canvassing list: ${unmatchedByReason.notInList} — respondent address not canvassed</span>` : ''}
        ${unmatchedByReason.noContact ? `<span style="padding:3px 10px;border-radius:10px;background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.3);color:var(--red);font-size:10px;font-weight:600">
          No contact found: ${unmatchedByReason.noContact} — respondent outside contact database</span>` : ''}
        ${unmatchedByReason.geocoded ? `<span style="padding:3px 10px;border-radius:10px;background:rgba(99,102,241,.12);border:1px solid rgba(99,102,241,.3);color:#818cf8;font-size:10px;font-weight:600">
          Address-geocoded: ${unmatchedByReason.geocoded} — lower positional accuracy</span>` : ''}
      </div>
      <!-- Per-street table -->
      ${unmatchedStreetRows.length ? `
      <table class="data-table" style="font-size:11px">
        <thead><tr><th>Street</th><th style="text-align:center">Unmatched</th><th>Reason(s)</th></tr></thead>
        <tbody>
          ${unmatchedStreetRows.map(([street, d]) => `
            <tr>
              <td style="font-weight:500">${street}</td>
              <td style="text-align:center;font-family:var(--mono);color:var(--red)">${d.count}</td>
              <td style="color:var(--muted)">${d.reasons.join(', ')}</td>
            </tr>`).join('')}
        </tbody>
      </table>` : ''}
    </div>` : ''}

    <!-- Risk summary -->
    <div style="margin-bottom:18px">
      <div style="font-size:11px;font-weight:700;color:var(--text2);margin-bottom:10px;text-transform:uppercase;letter-spacing:.06em">Risk Summary</div>
      <div class="stat-grid" style="grid-template-columns:repeat(4,1fr)">
        <div class="stat-card"><div class="label">Mean Risk</div><div class="value" style="color:var(--orange);font-size:22px">${scores.mean_risk || 0}</div><div class="sub">out of 100</div></div>
        <div class="stat-card"><div class="label">High Risk</div><div class="value" style="color:var(--red);font-size:22px">${riskTiers.high || 0}</div><div class="sub">households</div></div>
        <div class="stat-card"><div class="label">Mold Reports</div><div class="value" style="color:var(--orange);font-size:22px">${health.mold_pct || 0}%</div></div>
        <div class="stat-card"><div class="label">Hospital Visits</div><div class="value" style="font-size:22px">${health.hospital_pct || 0}%</div><div class="sub">respiratory</div></div>
      </div>
    </div>

    <!-- What was analyzed -->
    <div style="margin-bottom:18px">
      <div style="font-size:11px;font-weight:700;color:var(--text2);margin-bottom:8px;text-transform:uppercase;letter-spacing:.06em">Analysis Completed</div>
      <div style="display:flex;flex-wrap:wrap;gap:5px">
        ${['Health Score (0–100)', 'Indoor Air Quality Score', 'Structural Score', 'Overall Risk Score',
           'Street Risk Rankings', 'Mold Analysis', 'Respiratory Health', 'Asthma &amp; Wheeze',
           'Housing Age', 'Housing Type Breakdown', 'Owner vs Renter', 'GPS Cross-Validation',
           'Privacy Enforcement (≥3 threshold)', 'LLM Context Builder'].map(tag =>
          `<span style="padding:3px 9px;border-radius:10px;background:rgba(59,130,246,.1);border:1px solid rgba(59,130,246,.2);color:var(--accent);font-size:10px">${tag}</span>`
        ).join('')}
      </div>
    </div>

    <!-- Top risk streets table -->
    ${topStreets.length ? `
    <div>
      <div style="font-size:11px;font-weight:700;color:var(--text2);margin-bottom:8px;text-transform:uppercase;letter-spacing:.06em">Highest Risk Streets</div>
      <table class="data-table">
        <thead><tr><th>#</th><th>Street</th><th>N</th><th>Risk</th><th>Main Concern</th></tr></thead>
        <tbody>
          ${topStreets.map(([street, d], i) => {
            const concern = d.pct_mold > 40 ? `Mold ${d.pct_mold}%`
              : d.pct_respiratory > 30 ? `Resp. ${d.pct_respiratory}%`
              : d.pct_asthma > 20 ? `Asthma ${d.pct_asthma}%`
              : `Struct. ${d.mean_struct || '—'}`;
            const rc = d.mean_risk > 66 ? 'var(--red)' : d.mean_risk > 33 ? 'var(--orange)' : 'var(--green)';
            return `<tr>
              <td style="color:var(--muted);font-family:var(--mono)">${i+1}</td>
              <td style="font-weight:500">${street}</td>
              <td style="font-family:var(--mono)">${d.n}</td>
              <td style="font-family:var(--mono);font-weight:700;color:${rc}">${d.mean_risk}</td>
              <td style="font-size:11px;color:var(--text2)">${concern}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
      <p style="font-size:11px;color:var(--muted);margin-top:6px">Ask the AI chatbot about any of these streets for a detailed breakdown.</p>
    </div>` : ''}
  `;

  document.getElementById('summary-overlay')?.classList.add('show');

  // Bind close (use once to avoid stacking listeners)
  const closeBtn = document.getElementById('summary-close');
  if (closeBtn) {
    const handler = () => {
      document.getElementById('summary-overlay').classList.remove('show');
      const panel = document.getElementById('analysis-panel');
      if (!panel.classList.contains('open')) {
        panel.classList.add('open');
        setTimeout(() => map.resize(), 350);
      }
      document.querySelector('.analysis-tab[data-tab="results"]')?.click();
      closeBtn.removeEventListener('click', handler);
    };
    closeBtn.addEventListener('click', handler);
  }
}

async function uploadFile(zone, endpoint, file) {
  const origHtml = zone.innerHTML;
  const isIAQ = endpoint === '/api/upload/iaq';

  // Show appropriate UI
  if (isIAQ) {
    showAnalysisOverlay();
  } else {
    zone.innerHTML = `<h4>Uploading...</h4><div class="upload-progress"><div class="upload-progress-bar" id="inline-bar"></div></div>`;
  }

  const fd = new FormData();
  fd.append('file', file);

  // Use XHR for upload progress events
  const xhrRef = { done: false };

  try {
    const data = await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();

      xhr.upload.onprogress = (e) => {
        if (!e.lengthComputable) return;
        const pct = Math.round(e.loaded / e.total * 100);
        if (isIAQ) {
          // Upload is ~15% of total work
          setOverlayProgress(Math.round(pct * 0.15), 'Uploading file...');
        } else {
          const bar = document.getElementById('inline-bar');
          if (bar) bar.style.width = pct + '%';
        }
      };

      xhr.upload.onload = () => {
        if (isIAQ) {
          // Upload done — advance to parse step and simulate the rest
          setOverlayStep('ostep-parse');
          setOverlayProgress(20, 'File received — processing...');
          simulateIAQSteps(xhrRef);
        }
      };

      xhr.onload = () => {
        xhrRef.done = true;
        if (xhr.status >= 200 && xhr.status < 300) {
          try { resolve(JSON.parse(xhr.responseText)); }
          catch { resolve({}); }
        } else {
          try { reject(new Error(JSON.parse(xhr.responseText).detail || 'Upload failed')); }
          catch { reject(new Error('Upload failed')); }
        }
      };

      xhr.onerror = () => { xhrRef.done = true; reject(new Error('Network error')); };
      xhr.open('POST', endpoint);
      xhr.send(fd);
    });

    // ── Success ──
    if (isIAQ) {
      if (xhrRef.pulse) clearInterval(xhrRef.pulse);
      finishOverlaySteps();
      setOverlayProgress(100, 'Analysis complete!');
      await new Promise(r => setTimeout(r, 700));
      hideAnalysisOverlay();

      // Fetch processed data
      const [iaqPtsRes, iaqAnaRes] = await Promise.all([
        fetch('/api/iaq-points'), fetch('/api/iaq-analysis'),
      ]);
      iaqData = await iaqPtsRes.json();
      const iaqAnaRaw = await iaqAnaRes.json();
      if (iaqAnaRaw.loaded) iaqAnalysis = iaqAnaRaw;

      updateIAQOnMap();
      // Auto-show IAQ points immediately after a fresh upload
      if (map.getLayer('iaq-points')) map.setLayoutProperty('iaq-points', 'visibility', 'visible');
      const iaqToggle = document.getElementById('layer-iaq');
      if (iaqToggle) iaqToggle.checked = true;
      buildSurveyResultsTab(iaqAnalysis);
      document.getElementById('chat-btn')?.classList.add('has-data');

      zone.classList.add('success');
      zone.innerHTML = `<h4>IAQ Data Loaded!</h4>
        <p>${data.points || 0} responses mapped · ${data.streets_analyzed || 0} streets</p>
        <p style="font-size:11px;color:var(--muted)">Mean risk score: ${data.mean_risk || 0}/100</p>`;

      // Show summary popup
      showSummaryPopup(data, iaqAnalysis);

    } else {
      zone.classList.add('success');
      zone.innerHTML = `<h4>Uploaded!</h4><p>${file.name}</p><p style="font-size:11px;color:var(--muted)">Loading data…</p>`;
      const [ptsRes, parRes, anaRes] = await Promise.all([
        fetch('/api/survey-points'), fetch('/api/parcels'), fetch('/api/analysis'),
      ]);
      surveyData = await ptsRes.json();
      parcelsData = await parRes.json();
      analysisData = await anaRes.json();
      map.getSource('survey')?.setData(surveyData);
      map.getSource('survey-clustered')?.setData(surveyData);
      map.getSource('parcels')?.setData(parcelsData);
      buildLegend();
      buildAnalysis();

      // Auto-enable survey points layer so the user can see the data immediately
      if (surveyData.features?.length) {
        map.setLayoutProperty('survey-points', 'visibility', 'visible');
        const toggle = document.getElementById('layer-points');
        if (toggle) toggle.checked = true;
        fitBounds();
      }

      // Auto-close the modal after a short pause
      await new Promise(r => setTimeout(r, 1200));
      document.getElementById('import-modal')?.classList.remove('show');
    }

  } catch (e) {
    xhrRef.done = true;
    if (xhrRef.pulse) clearInterval(xhrRef.pulse);
    if (isIAQ) hideAnalysisOverlay();
    zone.classList.remove('success');
    zone.innerHTML = `<h4 style="color:var(--red)">Upload failed</h4><p style="font-size:12px">${e.message}</p><p style="font-size:11px;color:var(--muted);margin-top:6px">Check the Render logs for details.</p>`;
    setTimeout(() => { zone.innerHTML = origHtml; zone.classList.remove('success'); }, 8000);
  }
}

// ── IAQ layers ──────────────────────────────────────────────────────────────
function addIAQLayers() {
  map.addSource('iaq-source', {
    type: 'geojson',
    data: iaqData || { type: 'FeatureCollection', features: [] },
  });

  // Main IAQ points (colored by risk tier)
  map.addLayer({
    id: 'iaq-points', type: 'circle', source: 'iaq-source',
    layout: { visibility: 'none' },
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 6, 16, 10, 19, 14],
      'circle-color': ['get', 'color'],
      'circle-stroke-width': 2.5,
      'circle-stroke-color': 'rgba(255,255,255,0.7)',
      'circle-opacity': 0.92,
    },
  });

  // Highlighted streets layer — bright yellow overlay on top of risk points
  map.addLayer({
    id: 'iaq-highlighted', type: 'circle', source: 'iaq-source',
    filter: ['==', ['get', 'street_name'], '__none__'],
    layout: { visibility: 'visible' },
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 11, 16, 16, 19, 20],
      'circle-color': '#facc15',
      'circle-stroke-width': 3,
      'circle-stroke-color': 'rgba(0,0,0,0.45)',
      'circle-opacity': 1,
    },
  });

  map.on('click', 'iaq-points', onIAQPointClick);
  map.on('mouseenter', 'iaq-points', () => map.getCanvas().style.cursor = 'pointer');
  map.on('mouseleave', 'iaq-points', () => map.getCanvas().style.cursor = '');
  // Also handle clicks on highlighted circles (visible when background layer is hidden)
  map.on('click', 'iaq-highlighted', onIAQPointClick);
  map.on('mouseenter', 'iaq-highlighted', () => map.getCanvas().style.cursor = 'pointer');
  map.on('mouseleave', 'iaq-highlighted', () => map.getCanvas().style.cursor = '');

  // Street line source (updated by highlightStreets)
  map.addSource('iaq-street-line-source', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  });
  // Glow halo layer
  map.addLayer({
    id: 'iaq-street-line', type: 'line', source: 'iaq-street-line-source',
    layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#facc15', 'line-width': 16, 'line-opacity': 0.35, 'line-blur': 6 },
  });
  // Solid core layer on top
  map.addLayer({
    id: 'iaq-street-line-core', type: 'line', source: 'iaq-street-line-source',
    layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#fde047', 'line-width': 5, 'line-opacity': 0.92 },
  });
}

function updateIAQOnMap() {
  if (!iaqData) return;
  if (map.getSource('iaq-source')) {
    map.getSource('iaq-source').setData(iaqData);
    // Do NOT auto-show the layer — the sidebar toggle controls visibility.
    // Only show if the toggle checkbox is already checked (e.g. warm-state reload).
    const toggle = document.getElementById('layer-iaq');
    if (toggle && toggle.checked) {
      map.setLayoutProperty('iaq-points', 'visibility', 'visible');
    }
  }
  // Show IAQ sidebar section
  document.getElementById('iaq-sidebar-section')?.classList.add('visible');

  // Reset filter button (guard against duplicate listeners)
  const resetBtn = document.getElementById('iaq-reset-filter');
  if (resetBtn && !resetBtn._listenerAdded) {
    resetBtn._listenerAdded = true;
    resetBtn.addEventListener('click', () => clearIAQHighlights());
  }
}

function onIAQPointClick(e) {
  const f = e.features[0];
  const p = f.properties;
  const coords = f.geometry.coordinates.slice();
  const rc = p.color || '#9ca3af';

  const html = `<div class="popup-card" style="min-width:260px">
    <div class="popup-header">
      <h3>${p.street_name || 'Survey Response'}</h3>
      <div style="display:flex;gap:6px;margin-top:4px;flex-wrap:wrap">
        <span class="popup-badge" style="background:${rc}22;color:${rc};border:1px solid ${rc}44">${p.risk_tier || '—'} Risk</span>
        <span class="popup-badge" style="background:rgba(255,255,255,.05);color:var(--text2);border:1px solid var(--border)">Overall: ${p.overall_risk}/100</span>
      </div>
    </div>
    <div class="popup-body">
      <div class="popup-row"><span class="popup-label">Health Score</span><span class="popup-value">${p.health_score}/100</span></div>
      <div class="popup-row"><span class="popup-label">IAQ Score</span><span class="popup-value">${p.iaq_score}/100</span></div>
      <div class="popup-row"><span class="popup-label">Structural Score</span><span class="popup-value">${p.struct_score}/100</span></div>
      <div class="popup-row"><span class="popup-label">Ownership</span><span class="popup-value">${p.ownership || '—'}</span></div>
      <div class="popup-row"><span class="popup-label">Housing Type</span><span class="popup-value">${p.housing_type || '—'}</span></div>
      <div class="popup-row"><span class="popup-label">Year Built</span><span class="popup-value">${p.year_built || '—'}</span></div>
      <div class="popup-row"><span class="popup-label">Mold Present</span><span class="popup-value">${p.has_mold ? '<span style="color:var(--orange)">Yes</span>' : 'No'}</span></div>
      <div class="popup-row"><span class="popup-label">Hospital Visit</span><span class="popup-value">${p.hospital_visit === 'yes' ? '<span style="color:var(--red)">Yes</span>' : 'No'}</span></div>
    </div>
  </div>`;

  new maplibregl.Popup({ offset: 15, maxWidth: '320px' })
    .setLngLat(coords)
    .setHTML(html)
    .addTo(map);
}

// ── Survey Results tab ──────────────────────────────────────────────────────
function buildSurveyResultsTab(data) {
  const container = document.getElementById('results-content');
  if (!container) return;
  if (!data || !data.analysis) {
    container.innerHTML = '<p style="color:var(--muted);text-align:center;padding:40px 0">No survey results uploaded yet.<br><span style="font-size:12px">Upload the Qualtrics CSV via the Import button.</span></p>';
    return;
  }

  // Destroy previous charts
  Object.values(_resultsCharts).forEach(c => { try { c.destroy(); } catch(e){} });
  _resultsCharts = {};

  const a          = data.analysis;
  const v          = data.validation || {};
  const scores     = a.scores      || {};
  const riskTiers  = a.risk_tiers  || {};
  const health     = a.health      || {};
  const housing    = a.housing     || {};
  const ownership  = a.ownership   || {};
  const streetStats = data.street_stats || {};

  const rankedStreets = Object.entries(streetStats)
    .filter(([, d]) => !d.insufficient_data)
    .sort(([, a2], [, b]) => b.mean_risk - a2.mean_risk);

  const matchDetails = v.match_details || [];
  const gpsCount    = matchDetails.filter(d => d.coord_source === 'gps').length;
  const addrCount   = matchDetails.filter(d => d.coord_source === 'address_matched').length;
  const geocodedCount = matchDetails.filter(d => d.coord_source === 'geocoded').length;
  const totalMapped = a.n_responses || 0;

  const _ctx = { scores, riskTiers, health, housing, ownership, rankedStreets, v, gpsCount, addrCount, geocodedCount, totalMapped };

  const TABS = ['Overview','Health','IAQ','Structural','Streets','Validation'];

  container.innerHTML = `
    <div style="display:flex;border-bottom:1px solid var(--border);margin-bottom:10px;overflow-x:auto;flex-shrink:0">
      ${TABS.map((t, i) =>
        `<div class="res-tab" data-rtab="${t.toLowerCase()}"
          style="padding:5px 13px;font-size:11px;font-weight:600;cursor:pointer;white-space:nowrap;
                 border-bottom:2px solid ${i===0?'var(--accent)':'transparent'};
                 color:${i===0?'var(--accent)':'var(--muted)'};transition:.15s">${t}</div>`
      ).join('')}
    </div>

    <!-- Overview -->
    <div id="res-pane-overview" class="res-pane">
      <div class="stat-grid" style="grid-template-columns:repeat(5,1fr);margin-bottom:8px">
        <div class="stat-card"><div class="label">Mapped</div><div class="value" style="font-size:18px">${totalMapped}</div><div class="sub">${gpsCount} GPS · ${addrCount} addr · ${geocodedCount} geo</div></div>
        <div class="stat-card"><div class="label">Mean Risk</div><div class="value" style="font-size:18px;color:var(--orange)">${scores.mean_risk||0}</div><div class="sub">/ 100</div></div>
        <div class="stat-card"><div class="label">High Risk</div><div class="value" style="font-size:18px;color:var(--red)">${riskTiers.high||0}</div><div class="sub">≥67 score</div></div>
        <div class="stat-card"><div class="label">Medium</div><div class="value" style="font-size:18px;color:var(--orange)">${riskTiers.medium||0}</div><div class="sub">34–66</div></div>
        <div class="stat-card"><div class="label">Low</div><div class="value" style="font-size:18px;color:var(--green)">${riskTiers.low||0}</div><div class="sub">0–33</div></div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <div class="chart-box" style="flex:2;min-width:160px"><h4>Mean Scores by Domain</h4><canvas id="rc-scores" height="110"></canvas></div>
        <div class="chart-box" style="flex:1;min-width:110px"><h4>Ownership</h4><canvas id="rc-ownership" height="110"></canvas></div>
        <div class="chart-box" style="flex:1;min-width:110px"><h4>Risk Tiers</h4><canvas id="rc-risk" height="110"></canvas></div>
      </div>
    </div>

    <!-- Health -->
    <div id="res-pane-health" class="res-pane" style="display:none">
      <div style="display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap">
        <div class="chart-box" style="flex:1.4;min-width:160px"><h4>Symptom Prevalence — All Households (%)</h4><canvas id="rc-symptoms" height="110"></canvas></div>
        <div class="chart-box" style="flex:1.6;min-width:180px"><h4>Respiratory &amp; Mold by Street (top 8 by risk)</h4><canvas id="rc-resp-street" height="110"></canvas></div>
      </div>
      <table class="data-table" style="font-size:11px">
        <thead><tr><th>Indicator</th><th>Overall</th><th>Severity</th><th>Scoring notes</th></tr></thead>
        <tbody>
          ${[['Respiratory Illness (active symptoms)',health.respiratory_pct,'weekly/monthly/seasonal reports'],
             ['Asthma (active)',health.asthma_pct,'weekly/monthly/seasonal'],
             ['Wheeze (active)',health.wheeze_pct,'weekly/monthly/seasonal'],
             ['Mold Exposure',health.mold_pct,'any mold present'],
             ['Hospital Visit (respiratory)',health.hospital_pct,'+20 pts to health score']
            ].map(([name,pct,note]) => {
              const p = pct||0;
              const c = p>40?'var(--red)':p>20?'var(--orange)':'var(--green)';
              const sev = p>40?'High':p>20?'Moderate':'Low';
              return `<tr><td>${name}</td>
                <td style="font-family:var(--mono);color:${c};font-weight:600">${p}%</td>
                <td><span style="padding:2px 8px;border-radius:8px;font-size:10px;font-weight:600;background:${c}22;color:${c}">${sev}</span></td>
                <td style="color:var(--muted);font-size:10px">${note}</td></tr>`;
            }).join('')}
        </tbody>
      </table>
    </div>

    <!-- IAQ -->
    <div id="res-pane-iaq" class="res-pane" style="display:none">
      <div style="display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap">
        <div class="chart-box" style="flex:1.5;min-width:160px"><h4>Mold Prevalence by Street — top 8 (%)</h4><canvas id="rc-mold-street" height="110"></canvas></div>
        <div class="chart-box" style="flex:1;min-width:110px"><h4>Housing Age</h4><canvas id="rc-yearbuilt" height="110"></canvas></div>
      </div>
      <div class="stat-grid" style="grid-template-columns:repeat(3,1fr)">
        <div class="stat-card"><div class="label">Mean IAQ Score</div>
          <div class="value" style="font-size:18px;color:${(scores.mean_iaq||0)>66?'var(--red)':(scores.mean_iaq||0)>33?'var(--orange)':'var(--green)'}">${scores.mean_iaq||0}</div>
          <div class="sub">higher = worse IAQ</div></div>
        <div class="stat-card"><div class="label">Mold Reported</div><div class="value" style="font-size:18px;color:var(--purple)">${health.mold_pct||0}%</div><div class="sub">of surveyed homes</div></div>
        <div class="stat-card"><div class="label">Streets w/ Mold</div>
          <div class="value" style="font-size:18px">${rankedStreets.filter(([,d])=>d.pct_mold>0).length}</div>
          <div class="sub">of ${rankedStreets.length} analyzed</div></div>
      </div>
    </div>

    <!-- Structural -->
    <div id="res-pane-structural" class="res-pane" style="display:none">
      <div style="display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap">
        <div class="chart-box" style="flex:1;min-width:120px"><h4>Housing Types</h4><canvas id="rc-htypes" height="110"></canvas></div>
        <div class="chart-box" style="flex:1;min-width:120px"><h4>Home Condition</h4><canvas id="rc-cond" height="110"></canvas></div>
        <div class="chart-box" style="flex:1.6;min-width:160px"><h4>Structural Score by Street (top 8)</h4><canvas id="rc-struct-street" height="110"></canvas></div>
      </div>
      <div class="stat-grid" style="grid-template-columns:repeat(auto-fit,minmax(100px,1fr))">
        ${Object.entries(housing.types||{}).map(([k,v3])=>`<div class="stat-card"><div class="label">${k}</div><div class="value" style="font-size:16px">${v3}</div></div>`).join('')}
      </div>
    </div>

    <!-- Streets -->
    <div id="res-pane-streets" class="res-pane" style="display:none">
      <div style="display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap">
        <div class="chart-box" style="flex:1"><h4>Overall Risk Score by Street</h4><canvas id="rc-risk-street" height="110"></canvas></div>
        <div class="chart-box" style="flex:1"><h4>Health vs IAQ vs Structural (top 6)</h4><canvas id="rc-compare-street" height="110"></canvas></div>
      </div>
      <div style="max-height:200px;overflow-y:auto">
        <table class="data-table" style="font-size:11px">
          <thead><tr><th>#</th><th>Street</th><th>N</th><th>Risk</th><th>Health</th><th>IAQ</th><th>Struct</th><th>Mold%</th><th>Resp%</th><th>Hosp%</th></tr></thead>
          <tbody>
            ${rankedStreets.map(([street,d],i)=>{
              const rc = d.mean_risk>66?'var(--red)':d.mean_risk>33?'var(--orange)':'var(--green)';
              return `<tr>
                <td style="color:var(--muted);font-family:var(--mono)">${i+1}</td>
                <td style="font-weight:500;white-space:nowrap">${street}</td>
                <td style="font-family:var(--mono)">${d.n}</td>
                <td style="font-family:var(--mono);font-weight:700;color:${rc}">${d.mean_risk}</td>
                <td style="font-family:var(--mono)">${d.mean_health}</td>
                <td style="font-family:var(--mono)">${d.mean_iaq}</td>
                <td style="font-family:var(--mono)">${d.mean_struct}</td>
                <td style="font-family:var(--mono)">${d.pct_mold}%</td>
                <td style="font-family:var(--mono)">${d.pct_respiratory}%</td>
                <td style="font-family:var(--mono)">${d.pct_hospital}%</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>

    <!-- Validation -->
    <div id="res-pane-validation" class="res-pane" style="display:none">
      <div class="stat-grid" style="grid-template-columns:repeat(4,1fr);margin-bottom:8px">
        <div class="stat-card"><div class="label">IAQ Mapped</div><div class="value" style="font-size:18px">${v.total_iaq_responses||totalMapped}</div></div>
        <div class="stat-card"><div class="label">Contact Completed</div><div class="value" style="font-size:18px">${v.total_completed_contacts||'—'}</div></div>
        <div class="stat-card"><div class="label">Confirmed</div><div class="value" style="font-size:18px;color:var(--green)">${v.matched_iaq_responses||'—'}</div><div class="sub">≤150m match</div></div>
        <div class="stat-card"><div class="label">Match Rate</div>
          <div class="value" style="font-size:18px;color:${(v.match_rate_pct||0)>60?'var(--green)':(v.match_rate_pct||0)>30?'var(--orange)':'var(--red)'}">${v.match_rate_pct||'—'}%</div>
          <div class="sub">${v.unmatched_iaq||0} not confirmed</div></div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <div class="chart-box" style="flex:1;min-width:110px"><h4>Coord Source</h4><canvas id="rc-coord-src" height="110"></canvas></div>
        ${v.unmatched_by_street && Object.keys(v.unmatched_by_street).length ? `
        <div class="chart-box" style="flex:2;min-width:160px"><h4>Unmatched Responses by Street</h4>
          <div style="display:flex;flex-wrap:wrap;gap:5px;padding-top:4px">
            ${Object.entries(v.unmatched_by_street).sort(([,a2],[,b2])=>b2-a2).slice(0,15).map(([street,cnt])=>
              `<span style="padding:2px 8px;border-radius:6px;font-size:11px;font-family:var(--mono);background:rgba(239,68,68,.12);color:var(--red);border:1px solid rgba(239,68,68,.25)">${street} <b>${cnt}</b></span>`
            ).join('')}
          </div>
          <p style="font-size:10px;color:var(--muted);margin-top:8px">Not confirmed = nearest completed contact &gt;150 m away or not in canvassing list</p>
        </div>` : ''}
      </div>
    </div>
  `;

  // ── Tab switching ──────────────────────────────────────────────────────────
  container.querySelectorAll('.res-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      container.querySelectorAll('.res-tab').forEach(t => {
        t.style.color = 'var(--muted)';
        t.style.borderBottomColor = 'transparent';
      });
      tab.style.color = 'var(--accent)';
      tab.style.borderBottomColor = 'var(--accent)';
      const key = tab.dataset.rtab;
      container.querySelectorAll('.res-pane').forEach(p => p.style.display = 'none');
      const pane = document.getElementById(`res-pane-${key}`);
      if (pane) pane.style.display = 'block';
      _initResultsCharts(key, _ctx);
    });
  });

  // Init overview immediately after render
  setTimeout(() => _initResultsCharts('overview', _ctx), 60);
}

function _initResultsCharts(tab, { scores, riskTiers, health, housing, rankedStreets, v, gpsCount, addrCount, geocodedCount, ownership }) {
  const OPTS = {
    animation: false,
    plugins: { legend: { labels: { color: '#94a3b8', font: { size: 10 }, boxWidth: 12 } } },
  };
  const AXIS = { ticks: { color: '#64748b', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.04)' } };
  const AXISR = { ...AXIS, max: 100, min: 0 };

  function mk(id, cfg) {
    const el = document.getElementById(id);
    if (!el) return;
    if (_resultsCharts[id]) { try { _resultsCharts[id].destroy(); } catch(e){} }
    _resultsCharts[id] = new Chart(el.getContext('2d'), cfg);
  }

  function shortStreet(s) { return s.replace(/\s+(Avenue|Drive|Street|Road|Boulevard|Lane|Court|Way|Place|Circle|Terrace)\.?$/i, '').replace(/\s+(Ave|Dr|St|Rd|Blvd|Ln|Ct|Pl|Cir|Ter)\.?$/i, ''); }

  if (tab === 'overview') {
    mk('rc-scores', {
      type: 'bar',
      data: { labels: ['Health','IAQ','Structural','Overall Risk'],
        datasets: [{ label: 'Mean Score', barThickness: 28,
          data: [scores.mean_health||0, scores.mean_iaq||0, scores.mean_struct||0, scores.mean_risk||0],
          backgroundColor: ['rgba(239,68,68,.75)','rgba(139,92,246,.75)','rgba(249,115,22,.75)','rgba(59,130,246,.75)'],
          borderRadius: 4 }] },
      options: { ...OPTS, scales: { x: AXIS, y: AXISR } },
    });
    mk('rc-ownership', {
      type: 'doughnut',
      data: { labels: ['Owners','Renters','Other'],
        datasets: [{ data: [ownership.owner||0, ownership.renter||0, ownership.other||0],
          backgroundColor: ['#06b6d4','#8b5cf6','#475569'], borderWidth: 0 }] },
      options: { ...OPTS, cutout: '60%' },
    });
    mk('rc-risk', {
      type: 'doughnut',
      data: { labels: ['High','Medium','Low'],
        datasets: [{ data: [riskTiers.high||0, riskTiers.medium||0, riskTiers.low||0],
          backgroundColor: ['#ef4444','#f97316','#10b981'], borderWidth: 0 }] },
      options: { ...OPTS, cutout: '60%' },
    });
  }

  if (tab === 'health') {
    mk('rc-symptoms', {
      type: 'bar',
      data: { labels: ['Respiratory','Asthma','Wheeze','Mold','Hospital'],
        datasets: [{ label: '% of households', barThickness: 22,
          data: [health.respiratory_pct||0, health.asthma_pct||0, health.wheeze_pct||0, health.mold_pct||0, health.hospital_pct||0],
          backgroundColor: ['rgba(239,68,68,.75)','rgba(249,115,22,.75)','rgba(234,179,8,.75)','rgba(139,92,246,.75)','rgba(6,182,212,.75)'],
          borderRadius: 4 }] },
      options: { ...OPTS, scales: { x: AXIS, y: AXISR } },
    });
    const top8 = rankedStreets.slice(0, 8);
    mk('rc-resp-street', {
      type: 'bar',
      data: { labels: top8.map(([s]) => shortStreet(s)),
        datasets: [
          { label: 'Respiratory%', data: top8.map(([,d])=>d.pct_respiratory||0), backgroundColor:'rgba(239,68,68,.75)', borderRadius:3 },
          { label: 'Mold%',        data: top8.map(([,d])=>d.pct_mold||0),        backgroundColor:'rgba(139,92,246,.75)', borderRadius:3 },
          { label: 'Hospital%',    data: top8.map(([,d])=>d.pct_hospital||0),    backgroundColor:'rgba(6,182,212,.60)',  borderRadius:3 },
        ] },
      options: { ...OPTS, scales: { x: { ...AXIS, ticks: { ...AXIS.ticks, maxRotation: 40 } }, y: AXISR } },
    });
  }

  if (tab === 'iaq') {
    const moldSorted = [...rankedStreets].sort(([,a2],[,b])=>b.pct_mold-a2.pct_mold).slice(0,8);
    mk('rc-mold-street', {
      type: 'bar',
      data: { labels: moldSorted.map(([s]) => shortStreet(s)),
        datasets: [{ label: 'Mold %', barThickness: 20,
          data: moldSorted.map(([,d])=>d.pct_mold||0),
          backgroundColor: 'rgba(139,92,246,.75)', borderRadius: 4 }] },
      options: { ...OPTS, scales: { x: { ...AXIS, ticks: { ...AXIS.ticks, maxRotation: 40 } }, y: AXISR } },
    });
    mk('rc-yearbuilt', {
      type: 'doughnut',
      data: { labels: Object.keys(housing.year_built||{}),
        datasets: [{ data: Object.values(housing.year_built||{}),
          backgroundColor: ['#ef4444','#f97316','#f59e0b','#10b981','#475569'], borderWidth: 0 }] },
      options: { ...OPTS, cutout: '55%' },
    });
  }

  if (tab === 'structural') {
    mk('rc-htypes', {
      type: 'doughnut',
      data: { labels: Object.keys(housing.types||{}),
        datasets: [{ data: Object.values(housing.types||{}),
          backgroundColor: ['#3b82f6','#8b5cf6','#10b981','#475569'], borderWidth: 0 }] },
      options: { ...OPTS, cutout: '55%' },
    });
    mk('rc-cond', {
      type: 'doughnut',
      data: { labels: Object.keys(housing.conditions||{}),
        datasets: [{ data: Object.values(housing.conditions||{}),
          backgroundColor: ['#10b981','#f97316','#ef4444','#475569'], borderWidth: 0 }] },
      options: { ...OPTS, cutout: '55%' },
    });
    const top8s = rankedStreets.slice(0, 8);
    mk('rc-struct-street', {
      type: 'bar',
      data: { labels: top8s.map(([s]) => shortStreet(s)),
        datasets: [{ label: 'Structural Score', barThickness: 20,
          data: top8s.map(([,d])=>d.mean_struct||0),
          backgroundColor: 'rgba(249,115,22,.75)', borderRadius: 4 }] },
      options: { ...OPTS, scales: { x: { ...AXIS, ticks: { ...AXIS.ticks, maxRotation: 40 } }, y: AXISR } },
    });
  }

  if (tab === 'streets') {
    const all = rankedStreets.slice(0, 10);
    mk('rc-risk-street', {
      type: 'bar',
      data: { labels: all.map(([s]) => shortStreet(s)),
        datasets: [{ label: 'Overall Risk', barThickness: 18,
          data: all.map(([,d])=>d.mean_risk),
          backgroundColor: all.map(([,d])=>d.mean_risk>66?'rgba(239,68,68,.8)':d.mean_risk>33?'rgba(249,115,22,.8)':'rgba(16,185,129,.8)'),
          borderRadius: 4 }] },
      options: { ...OPTS, scales: { x: { ...AXIS, ticks: { ...AXIS.ticks, maxRotation: 40 } }, y: AXISR } },
    });
    const top6 = rankedStreets.slice(0, 6);
    mk('rc-compare-street', {
      type: 'bar',
      data: { labels: top6.map(([s]) => shortStreet(s)),
        datasets: [
          { label: 'Health',     data: top6.map(([,d])=>d.mean_health||0),  backgroundColor:'rgba(239,68,68,.7)',  borderRadius:3 },
          { label: 'IAQ',        data: top6.map(([,d])=>d.mean_iaq||0),     backgroundColor:'rgba(139,92,246,.7)', borderRadius:3 },
          { label: 'Structural', data: top6.map(([,d])=>d.mean_struct||0),  backgroundColor:'rgba(249,115,22,.7)', borderRadius:3 },
        ] },
      options: { ...OPTS, scales: { x: { ...AXIS, ticks: { ...AXIS.ticks, maxRotation: 40 } }, y: AXISR } },
    });
  }

  if (tab === 'validation') {
    mk('rc-coord-src', {
      type: 'doughnut',
      data: { labels: ['GPS','Addr Match','Census Geo'],
        datasets: [{ data: [gpsCount, addrCount, geocodedCount],
          backgroundColor: ['#10b981','#3b82f6','#8b5cf6'], borderWidth: 0 }] },
      options: { ...OPTS, cutout: '55%' },
    });
  }
}

// ── Contact layer visibility helpers ────────────────────────────────────────
let _contactWasVisible = true;

function _hideContactLayers() {
  if (map.getLayer('survey-points')) {
    _contactWasVisible = map.getLayoutProperty('survey-points', 'visibility') !== 'none';
    map.setLayoutProperty('survey-points', 'visibility', 'none');
    if (map.getLayer('survey-labels')) map.setLayoutProperty('survey-labels', 'visibility', 'none');
  }
}

function _restoreContactLayers() {
  if (_contactWasVisible && map.getLayer('survey-points')) {
    map.setLayoutProperty('survey-points', 'visibility', 'visible');
  }
}

// ── Map action dispatcher (called by chatbot) ───────────────────────────────
// ── Clear all data layers before each chatbot action ─────────────────────────
function clearMapForChatbot() {
  Object.keys(LAYER_DEFS).forEach(name => setLayerVisibility(name, false));
  if (map.getLayer('iaq-points')) {
    map.setFilter('iaq-points', null);
    map.setPaintProperty('iaq-points', 'circle-color', ['get', 'color']);
  }
  if (map.getLayer('survey-points')) map.setFilter('survey-points', null);
  if (map.getLayer('iaq-highlighted'))
    map.setFilter('iaq-highlighted', ['==', ['get', 'street_name'], '__none__']);
  if (map.getSource('iaq-street-line-source'))
    map.getSource('iaq-street-line-source').setData({ type: 'FeatureCollection', features: [] });
  currentIAQFilter = null;
  currentContactFilter = null;
  activeStreetHighlight = null;
}

async function executeMapActions(actions) {
  if (!actions || !actions.length) return;
  clearMapForChatbot();
  for (const action of actions) {
    const { type, params = {} } = action;
    switch (type) {

      // ── New comprehensive actions ──────────────────────────────────────────
      case 'set_layer_visibility':
        setLayerVisibility(params.layer, params.visible !== false);
        break;

      case 'highlight_streets':
        await highlightStreets(params.streets || [], params.color);
        break;

      case 'zoom_to_street':
        zoomToStreet(params.street);
        break;

      case 'filter_contact_status':
        filterContactByStatus(params.statuses || []);
        setLayerVisibility('contact_survey', true);
        break;

      case 'filter_iaq_symptom': {
        const { field, values } = params;
        if (!field || !values || !map.getLayer('iaq-points')) break;
        currentIAQFilter = `${field}:${values.join(',')}`;
        _hideContactLayers();
        const exprs = values.map(v =>
          typeof v === 'boolean' ? ['==', ['get', field], v]
                                 : ['in', String(v).toLowerCase(), ['downcase', ['get', field]]]
        );
        const symptomFilter = exprs.length > 1 ? ['any', ...exprs] : exprs[0];

        // Intersect with active street highlight so a symptom filter emitted
        // alongside highlight_streets is scoped to that street only.
        let combined = symptomFilter;
        if (activeStreetHighlight && activeStreetHighlight.length) {
          const streetFilter = activeStreetHighlight.length === 1
            ? ['==', ['get', 'street_name'], activeStreetHighlight[0]]
            : ['any', ...activeStreetHighlight.map(n => ['==', ['get', 'street_name'], n])];
          combined = ['all', streetFilter, symptomFilter];
          console.log('[filter_iaq_symptom] intersecting with active street:', activeStreetHighlight);
        }
        map.setFilter('iaq-points', combined);
        setLayerVisibility('iaq_points', true);
        break;
      }

      case 'show_iaq_choropleth': {
        const valid = ['overall_risk', 'iaq_score', 'health_score', 'struct_score'];
        const f = valid.includes(params.field) ? params.field : 'overall_risk';
        if (map.getLayer('iaq-points')) {
          map.setPaintProperty('iaq-points', 'circle-color',
            ['interpolate', ['linear'], ['get', f],
              0, '#10b981', 33, '#10b981', 34, '#f97316', 66, '#f97316', 67, '#ef4444', 100, '#ef4444']);
          setLayerVisibility('iaq_points', true);
        }
        break;
      }

      case 'clear_filters':
        if (map.getLayer('iaq-points')) {
          map.setFilter('iaq-points', null);
          map.setPaintProperty('iaq-points', 'circle-color', ['get', 'color']);
        }
        if (map.getLayer('survey-points')) map.setFilter('survey-points', null);
        if (map.getLayer('iaq-highlighted'))
          map.setFilter('iaq-highlighted', ['==', ['get', 'street_name'], '__none__']);
        if (map.getSource('iaq-street-line-source'))
          map.getSource('iaq-street-line-source').setData({ type: 'FeatureCollection', features: [] });
        setLayerVisibility('iaq_highlights', false);
        setLayerVisibility('contact_survey', true);
        if (iaqData?.features?.length) setLayerVisibility('iaq_points', true);
        currentIAQFilter = null;
        currentContactFilter = null;
        break;

      case 'show_analysis_tab': {
        const panel = document.getElementById('analysis-panel');
        if (panel && !panel.classList.contains('open')) {
          panel.classList.add('open');
          setTimeout(() => map.resize(), 350);
        }
        document.querySelector(`.analysis-tab[data-tab="${params.tab}"]`)?.click();
        break;
      }

      // ── Legacy actions (backward compat) ──────────────────────────────────
      case 'show_layer':
        showIAQLayer(params.layer);
        break;
      case 'hide_all_layers':
        setLayerVisibility('iaq_points', false);
        setLayerVisibility('iaq_highlights', false);
        break;
      case 'filter_points':
        filterIAQPoints(params.field, params.values);
        break;
      case 'show_choropleth':
        showStreetChoropleth(params.field || 'overall_risk');
        break;
      case 'clear_all':
        clearIAQHighlights();
        _restoreContactLayers();
        break;
      case 'show_contact_layer':
        showContactLayer();
        break;
    }
  }
}

function showContactLayer() {
  filterContactByStatus([]);   // clear any contact filter
  setLayerVisibility('contact_survey', true);
  setLayerVisibility('iaq_points', false);
  setLayerVisibility('iaq_highlights', false);
  if (map.getSource('iaq-street-line-source'))
    map.getSource('iaq-street-line-source').setData({ type: 'FeatureCollection', features: [] });
}

function showIAQLayer(layer) {
  if (!layer) return;
  if (map.getLayer('iaq-points')) {
    map.setLayoutProperty('iaq-points', 'visibility', 'visible');
    map.setFilter('iaq-points', null);
    map.setPaintProperty('iaq-points', 'circle-color', ['get', 'color']);
  }
  // Hide contact survey points so only the IAQ filter layer shows
  _hideContactLayers();

  const activeLayers = {
    iaq_points:  () => { /* show all IAQ points — already cleared filter above */ },
    respiratory: () => filterIAQPoints('respiratory_ill', ['weekly', 'month', 'season']),
    asthma:      () => filterIAQPoints('asthma_freq',    ['weekly', 'month', 'season']),
    mold:        () => { if (map.getLayer('iaq-points')) map.setFilter('iaq-points', ['==', ['get', 'has_mold'], true]); },
    high_risk:   () => { if (map.getLayer('iaq-points')) map.setFilter('iaq-points', ['>=', ['get', 'overall_risk'], 67]); },
    owners_only: () => { if (map.getLayer('iaq-points')) map.setFilter('iaq-points', ['==', ['get', 'ownership'], 'Owner']); },
    renters_only:() => { if (map.getLayer('iaq-points')) map.setFilter('iaq-points', ['==', ['get', 'ownership'], 'Renter']); },
  };
  (activeLayers[layer] || (() => {}))();
}

// ── Fetch actual road geometry from OpenStreetMap via Overpass API ────────────
async function fetchOSMRoadGeometry(streetName) {
  // Build candidate name variants to try against OSM in order of specificity
  const abbrevMap = {
    'Ave': 'Avenue', 'Ave.': 'Avenue',
    'St': 'Street',  'St.': 'Street',
    'Dr': 'Drive',   'Dr.': 'Drive',
    'Rd': 'Road',    'Rd.': 'Road',
    'Ln': 'Lane',    'Ln.': 'Lane',
    'Blvd': 'Boulevard', 'Blvd.': 'Boulevard',
    'Ct': 'Court',   'Ct.': 'Court',
    'Pl': 'Place',   'Pl.': 'Place',
    'Cir': 'Circle', 'Hwy': 'Highway',
  };
  const candidates = new Set([streetName]);
  // Expand abbreviation (e.g. "Harvard Ave" → "Harvard Avenue")
  const expanded = streetName.replace(
    /\b(Ave\.?|St\.?|Dr\.?|Rd\.?|Ln\.?|Blvd\.?|Ct\.?|Pl\.?|Cir|Hwy)$/i,
    m => abbrevMap[m] || abbrevMap[m.replace(/\.$/, '')] || m
  );
  if (expanded !== streetName) candidates.add(expanded);
  // Contract full word back to abbreviation (e.g. "Harvard Avenue" → "Harvard Ave")
  const contracted = streetName.replace(
    /\b(Avenue|Street|Drive|Road|Lane|Boulevard|Court|Place|Circle|Highway)$/i,
    m => ({ Avenue:'Ave', Street:'St', Drive:'Dr', Road:'Rd', Lane:'Ln',
            Boulevard:'Blvd', Court:'Ct', Place:'Pl', Circle:'Cir', Highway:'Hwy' })[m] || m
  );
  if (contracted !== streetName) candidates.add(contracted);

  const bbox = '29.74,-82.06,29.84,-81.94'; // Keystone Heights (south,west,north,east)

  const _toFeatures = (elements, label) =>
    (elements || [])
      .filter(el => el.type === 'way' && el.geometry && el.geometry.length >= 2)
      .map(el => ({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: el.geometry.map(pt => [pt.lon, pt.lat]) },
        properties: { street_name: label },
      }));

  try {
    for (const name of candidates) {
      const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // Strategy 1: exact case-insensitive match
      const exactQuery = `[out:json][timeout:12];way["name"~"^${esc}$",i]["highway"](${bbox});out geom;`;
      const r1 = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(exactQuery),
      });
      if (r1.ok) {
        const d1 = await r1.json();
        const feats = _toFeatures(d1.elements, streetName);
        if (feats.length) { console.log(`[OSM] matched "${name}" (exact)`); return feats; }
      }
    }

    // Strategy 2: partial match on first word (e.g. "Harvard" inside "Harvard Avenue")
    const firstWord = streetName.split(/\s+/)[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const partialQuery = `[out:json][timeout:12];way["name"~"${firstWord}","i"]["highway"](${bbox});out geom;`;
    const r2 = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'data=' + encodeURIComponent(partialQuery),
    });
    if (r2.ok) {
      const d2 = await r2.json();
      // Filter to ways whose name actually starts with the first word (avoid false positives)
      const filtered = (d2.elements || []).filter(el =>
        el.type === 'way' && el.geometry?.length >= 2 &&
        el.tags?.name?.toLowerCase().startsWith(firstWord.toLowerCase())
      );
      if (filtered.length) {
        console.log(`[OSM] matched "${streetName}" via first-word "${firstWord}"`);
        return _toFeatures(filtered, streetName);
      }
    }

    console.warn(`[OSM] No road geometry found for "${streetName}"`);
    return [];
  } catch (e) {
    console.warn('[OSM] Road fetch failed for', streetName, ':', e.message);
    return [];
  }
}

async function highlightStreets(streets, color) {
  // Clear previous highlight
  if (!streets || !streets.length) {
    if (map.getSource('iaq-street-line-source'))
      map.getSource('iaq-street-line-source').setData({ type: 'FeatureCollection', features: [] });
    if (map.getLayer('iaq-street-line'))      map.setLayoutProperty('iaq-street-line',      'visibility', 'none');
    if (map.getLayer('iaq-street-line-core')) map.setLayoutProperty('iaq-street-line-core', 'visibility', 'none');
    // Keep circles hidden — never show them from chatbot
    if (map.getLayer('iaq-highlighted'))
      map.setFilter('iaq-highlighted', ['==', ['get', 'street_name'], '__none__']);
    return;
  }

  // Resolve line color — caller passes a semantic color based on query context:
  //   worst / health risk → #ef4444 (red)
  //   worst structural    → #f97316 (orange)
  //   worst IAQ / mold    → #8b5cf6 (purple)
  //   best / safest       → #10b981 (green)
  //   neutral / compare   → #3b82f6 (blue, default)
  const lineColor = color || '#3b82f6';

  // Apply color to both line layers
  if (map.getLayer('iaq-street-line')) {
    map.setPaintProperty('iaq-street-line', 'line-color', lineColor);
  }
  if (map.getLayer('iaq-street-line-core')) {
    map.setPaintProperty('iaq-street-line-core', 'line-color', lineColor);
  }

  const names = streets.map(s => s.trim());

  // Pin the street highlight so any later chatbot filter action intersects
  // with it instead of replacing it.
  activeStreetHighlight = [...names];

  // Show ONLY the IAQ survey points on the highlighted street(s). Use `any` +
  // `==` rather than `in` because some MapLibre versions evaluate `in` with
  // literal arrays inconsistently — `any` is universally reliable.
  if (map.getLayer('iaq-points')) {
    const streetFilter = names.length === 1
      ? ['==', ['get', 'street_name'], names[0]]
      : ['any', ...names.map(n => ['==', ['get', 'street_name'], n])];
    map.setFilter('iaq-points', streetFilter);
    map.setLayoutProperty('iaq-points', 'visibility', 'visible');
    const el = document.getElementById('layer-iaq');
    if (el) el.checked = true;

    // Diagnostic: how many actual features match the filter in the loaded data?
    const matchingFeatures = iaqData?.features?.filter(
      f => names.includes(f.properties?.street_name)
    ) || [];
    console.log(`[highlightStreets] streets=${JSON.stringify(names)} `
      + `matched ${matchingFeatures.length} iaq points `
      + `(street_name values: ${[...new Set(matchingFeatures.map(f => f.properties?.street_name))].join(', ') || 'none'})`);
    if (!matchingFeatures.length) {
      const allStreets = [...new Set((iaqData?.features || []).map(f => f.properties?.street_name))];
      console.warn(`[highlightStreets] NO IAQ points on ${JSON.stringify(names)}. `
        + `Known street_name values in data:`, allStreets.sort());
    }
  }

  // Also filter the iaq-highlighted halo layer with the same expression
  const haloFilter = names.length === 1
    ? ['==', ['get', 'street_name'], names[0]]
    : ['any', ...names.map(n => ['==', ['get', 'street_name'], n])];

  // Fetch actual road geometry from OSM for each street
  const lineFeatures = [];
  for (const streetName of names) {
    const osmFeatures = await fetchOSMRoadGeometry(streetName);
    lineFeatures.push(...osmFeatures);
  }

  if (map.getSource('iaq-street-line-source')) {
    map.getSource('iaq-street-line-source').setData({ type: 'FeatureCollection', features: lineFeatures });
    if (map.getLayer('iaq-street-line'))      map.setLayoutProperty('iaq-street-line',      'visibility', 'visible');
    if (map.getLayer('iaq-street-line-core')) map.setLayoutProperty('iaq-street-line-core', 'visibility', 'visible');
  }

  // Fallback when OSM returns no road geometry: highlight the IAQ survey
  // points on that street with an enlarged, colored halo so the user still
  // sees a clear visual marker for the street.
  if (map.getLayer('iaq-highlighted')) {
    if (lineFeatures.length) {
      map.setFilter('iaq-highlighted', ['==', ['get', 'street_name'], '__none__']);
    } else {
      map.setFilter('iaq-highlighted', haloFilter);
      map.setPaintProperty('iaq-highlighted', 'circle-color', lineColor);
      map.setPaintProperty('iaq-highlighted', 'circle-stroke-color', '#ffffff');
      map.setLayoutProperty('iaq-highlighted', 'visibility', 'visible');
      console.warn(`[highlightStreets] OSM returned no geometry for ${names.join(', ')}; highlighting IAQ points on that street instead`);
    }
  }

  // Zoom: prefer OSM road bounds, fall back to IAQ survey point bounds for that street
  const allCoords = lineFeatures.flatMap(f => f.geometry.coordinates);
  if (allCoords.length >= 2) {
    const lngs = allCoords.map(c => c[0]);
    const lats = allCoords.map(c => c[1]);
    map.fitBounds(
      [[Math.min(...lngs) - 0.001, Math.min(...lats) - 0.001],
       [Math.max(...lngs) + 0.001, Math.max(...lats) + 0.001]],
      { padding: 80, duration: 800 }
    );
  } else {
    // OSM returned nothing — zoom to the IAQ survey points on that street
    zoomToStreet(names[0]);
  }
}

function zoomToStreet(streetName) {
  if (!streetName || !iaqData || !iaqData.features) return;
  const pts = iaqData.features.filter(f => f.properties.street_name === streetName);
  if (!pts.length) return;
  const lngs = pts.map(f => f.geometry.coordinates[0]);
  const lats = pts.map(f => f.geometry.coordinates[1]);
  map.fitBounds(
    [[Math.min(...lngs) - 0.002, Math.min(...lats) - 0.002],
     [Math.max(...lngs) + 0.002, Math.max(...lats) + 0.002]],
    { padding: 80, duration: 800 }
  );
}

function filterIAQPoints(field, values) {
  if (!map.getLayer('iaq-points')) return;
  if (!field || !values || !values.length) {
    // Even when clearing the symptom filter, if a street highlight is active
    // keep the street scope — "show all symptoms" still means within Harvard Ave.
    if (activeStreetHighlight && activeStreetHighlight.length) {
      const streetOnly = activeStreetHighlight.length === 1
        ? ['==', ['get', 'street_name'], activeStreetHighlight[0]]
        : ['any', ...activeStreetHighlight.map(n => ['==', ['get', 'street_name'], n])];
      map.setFilter('iaq-points', streetOnly);
    } else {
      map.setFilter('iaq-points', null);
    }
    _restoreContactLayers();
    return;
  }
  // Hide contact points — only the filtered IAQ layer should show
  _hideContactLayers();
  // Partial case-insensitive match (e.g. 'weekly' matches 'Weekly or more often')
  const exprs = values.map(v => ['in', v.toLowerCase(), ['downcase', ['get', field]]]);
  const symptomFilter = exprs.length > 1 ? ['any', ...exprs] : exprs[0];

  // Intersect with active street highlight so "mold" after "Harvard Ave"
  // means "mold cases on Harvard Ave" — not every mold case in the city.
  let finalFilter = symptomFilter;
  if (activeStreetHighlight && activeStreetHighlight.length) {
    const streetFilter = activeStreetHighlight.length === 1
      ? ['==', ['get', 'street_name'], activeStreetHighlight[0]]
      : ['any', ...activeStreetHighlight.map(n => ['==', ['get', 'street_name'], n])];
    finalFilter = ['all', streetFilter, symptomFilter];
  }
  map.setFilter('iaq-points', finalFilter);
  map.setLayoutProperty('iaq-points', 'visibility', 'visible');
}

function showStreetChoropleth(field) {
  if (!map.getLayer('iaq-points')) return;
  const rampExpr = (f) => ['interpolate', ['linear'], ['get', f],
    0, '#10b981', 33, '#10b981', 34, '#f97316', 66, '#f97316', 67, '#ef4444', 100, '#ef4444'];
  const valid = ['overall_risk', 'health_score', 'iaq_score', 'struct_score'];
  map.setPaintProperty('iaq-points', 'circle-color',
    valid.includes(field) ? rampExpr(field) : ['get', 'color']);
  map.setLayoutProperty('iaq-points', 'visibility', 'visible');
}

function clearIAQHighlights() {
  if (map.getLayer('iaq-points')) {
    map.setFilter('iaq-points', null);
    map.setPaintProperty('iaq-points', 'circle-color', ['get', 'color']);
  }
  if (map.getLayer('iaq-highlighted'))
    map.setFilter('iaq-highlighted', ['==', ['get', 'street_name'], '__none__']);
  if (map.getSource('iaq-street-line-source'))
    map.getSource('iaq-street-line-source').setData({ type: 'FeatureCollection', features: [] });
  setLayerVisibility('iaq_highlights', false);
  currentIAQFilter = null;
  _restoreContactLayers();
}

function filterContactByStatus(statuses) {
  if (!map.getLayer('survey-points')) return;
  currentContactFilter = statuses && statuses.length ? statuses.join(',') : null;
  if (!statuses || !statuses.length) {
    map.setFilter('survey-points', null);
  } else {
    map.setFilter('survey-points', ['in', ['get', 'status'], ['literal', statuses]]);
  }
  setLayerVisibility('contact_survey', true);
}

function getCurrentMapState() {
  const checks = {
    iaq_points:     'layer-iaq',
    contact_survey: 'layer-points',
    parcels:        'layer-parcels',
    clusters:       'layer-clusters',
    heatmap:        'layer-heatmap',
    labels:         'layer-labels',
    '3d':           'layer-3d',
  };
  const on  = Object.entries(checks).filter(([, id]) => document.getElementById(id)?.checked).map(([k]) => k);
  const off = Object.entries(checks).filter(([, id]) => !document.getElementById(id)?.checked).map(([k]) => k);
  return `ON:${on.join(',') || 'none'} OFF:${off.join(',') || 'none'} iaq_filter:${currentIAQFilter || 'none'} contact_filter:${currentContactFilter || 'none'} zoom:${Math.round((map?.getZoom() || 14) * 10) / 10} iaq_loaded:${!!(iaqData?.features?.length)}`;
}

// ── Chat ─────────────────────────────────────────────────────────────────────
function initChat() {
  const chatBtn  = document.getElementById('chat-btn');
  const panel    = document.getElementById('chat-panel');
  const closeBtn = document.getElementById('chat-close');
  const input    = document.getElementById('chat-input');
  const sendBtn  = document.getElementById('chat-send');
  if (!chatBtn) return;

  chatBtn.addEventListener('click', () => {
    panel.classList.toggle('open');
    if (panel.classList.contains('open')) {
      input.focus();
      setTimeout(() => map.resize(), 350);
    } else {
      setTimeout(() => map.resize(), 350);
    }
  });

  closeBtn.addEventListener('click', () => {
    panel.classList.remove('open');
    setTimeout(() => map.resize(), 350);
  });

  sendBtn.addEventListener('click', sendChatMessage);

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendChatMessage();
    }
  });

  // Auto-resize textarea
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 90) + 'px';
  });

  // Suggestion chips
  document.querySelectorAll('.chat-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      input.value = chip.dataset.q;
      sendChatMessage();
    });
  });
}

let chatInFlight = false;
async function sendChatMessage() {
  if (chatInFlight) return;   // guard against double-submit (Enter + click, rapid Enter, etc.)
  const input   = document.getElementById('chat-input');
  const sendBtn = document.getElementById('chat-send');
  const message = input.value.trim();
  if (!message) return;

  chatInFlight = true;
  input.value = '';
  input.style.height = 'auto';
  sendBtn.disabled = true;

  appendChatBubble('user', message);
  const typingId = appendTyping();
  chatHistory.push({ role: 'user', content: message });

  try {
    const res  = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, history: chatHistory.slice(-8), map_state: getCurrentMapState() }),
    });
    const data = await res.json();
    removeTyping(typingId);

    const { text, map_actions, model_used } = data;

    // Update header badge with the model that answered
    if (model_used) {
      const badge = document.getElementById('model-badge');
      if (badge) {
        badge.textContent = model_used;
        // Color: green for primary, orange for fallbacks
        const isPrimary = model_used.includes('70B') || model_used.includes('70b');
        badge.style.background = isPrimary
          ? 'rgba(16,185,129,.15)' : 'rgba(249,115,22,.15)';
        badge.style.color = isPrimary ? 'var(--green)' : 'var(--orange)';
      }
    }

    if (map_actions && map_actions.length) executeMapActions(map_actions);
    appendChatBubble('assistant', text, map_actions);
    chatHistory.push({ role: 'assistant', content: text });
    if (chatHistory.length > 20) chatHistory = chatHistory.slice(-16);
  } catch (e) {
    removeTyping(typingId);
    appendChatBubble('assistant', 'Sorry, I encountered an error. Please try again.');
  } finally {
    chatInFlight = false;
    sendBtn.disabled = false;
    document.getElementById('chat-input').focus();
  }
}

function appendChatBubble(role, text, mapActions) {
  const container = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.className = `chat-bubble ${role}`;

  if (role === 'assistant') {
    const followupMatch = text ? text.match(/💡\s*Follow-up:\s*(.+)$/m) : null;
    const cleanText = text ? text.replace(/💡\s*Follow-up:\s*.+$/m, '').trim() : '...';
    div.innerHTML = renderMarkdown(cleanText);

    if (mapActions && mapActions.length) {
      const tag = document.createElement('div');
      tag.className = 'map-tag';
      tag.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="10" height="10"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/></svg> Map updated`;
      div.appendChild(tag);
    }

    if (followupMatch) {
      const fu = document.createElement('div');
      fu.className = 'chat-followup';
      fu.textContent = '💡 ' + followupMatch[1];
      fu.addEventListener('click', () => {
        document.getElementById('chat-input').value = followupMatch[1];
        sendChatMessage();
      });
      div.appendChild(fu);
    }
  } else {
    div.textContent = text;
  }

  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  return div;
}

function appendTyping() {
  const container = document.getElementById('chat-messages');
  const id  = 'typing-' + Date.now();
  const div = document.createElement('div');
  div.id = id;
  div.className = 'chat-typing';
  div.innerHTML = '<span></span><span></span><span></span>';
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  return id;
}

function removeTyping(id) {
  document.getElementById(id)?.remove();
}

function renderMarkdown(text) {
  if (!text) return '';
  let html = text
    // Tables (header | divider | rows)
    .replace(/^\|(.+)\|\s*\n\|[-| :]+\|\s*\n((?:\|.+\|\s*\n?)*)/gm, (_m, header, rows) => {
      const ths = header.split('|').filter(c => c.trim()).map(c => `<th>${c.trim()}</th>`).join('');
      const trs = rows.trim().split('\n').map(row => {
        const tds = row.split('|').filter(c => c !== '').map(c => `<td>${c.trim()}</td>`).join('');
        return `<tr>${tds}</tr>`;
      }).join('');
      return `<table><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table>`;
    })
    // Bold
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // Inline code
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // Bullet items → collect into ul in a second pass
    .replace(/^[•\-\*] (.+)$/gm, '<li>$1</li>');

  // Wrap consecutive <li> into <ul>
  html = html.replace(/(<li>.*?<\/li>\n?)+/gs, m => `<ul>${m}</ul>`);

  // Paragraphs
  html = html
    .replace(/\n{2,}/g, '</p><p>')
    .replace(/\n/g, '<br>');

  return `<p>${html}</p>`.replace(/<p>(\s*<table>)/g, '$1').replace(/<\/table>\s*<\/p>/g, '</table>');
}

// ── Panel resize handles ─────────────────────────────────────────────────────
function makeDraggable(handle, onDrag, axis) {
  handle.addEventListener('mousedown', e => {
    e.preventDefault();
    e.stopPropagation();
    let prevX = e.clientX, prevY = e.clientY;
    handle.classList.add('dragging');
    document.body.style.cursor = axis === 'ew' ? 'ew-resize' : 'ns-resize';
    document.body.style.userSelect = 'none';
    const onMove = e2 => {
      onDrag(e2.clientX - prevX, e2.clientY - prevY);
      prevX = e2.clientX;
      prevY = e2.clientY;
    };
    const onUp = () => {
      handle.classList.remove('dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      if (map) map.resize();
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

function initResizeHandles() {
  // Sidebar: drag right edge — wider/narrower
  const sidebarEl = document.getElementById('sidebar');
  makeDraggable(document.getElementById('sidebar-resize'), (dx) => {
    if (sidebarEl.classList.contains('collapsed')) return;
    panelSizes.sidebar = Math.max(160, Math.min(520, sidebarEl.offsetWidth + dx));
    sidebarEl.style.width = panelSizes.sidebar + 'px';
  }, 'ew');

  // Analysis panel: drag top edge — taller/shorter
  const analysisEl = document.getElementById('analysis-panel');
  makeDraggable(document.getElementById('analysis-resize'), (_dx, dy) => {
    if (!analysisEl.classList.contains('open')) return;
    panelSizes.analysis = Math.max(80, Math.min(Math.round(window.innerHeight * 0.75), analysisEl.offsetHeight - dy));
    analysisEl.style.transition = 'none';
    analysisEl.style.height = panelSizes.analysis + 'px';
  }, 'ns');

  // Chat panel: drag left edge — wider/narrower
  const chatEl = document.getElementById('chat-panel');
  makeDraggable(document.getElementById('chat-resize'), (dx) => {
    panelSizes.chat = Math.max(240, Math.min(700, chatEl.offsetWidth - dx));
    chatEl.style.width = panelSizes.chat + 'px';
  }, 'ew');
}

// ── Init ────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  setupUI();
  initMap();
  initResizeHandles();
});
