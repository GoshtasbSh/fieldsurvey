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
    const [ptsRes, parRes, anaRes] = await Promise.all([
      fetch('/api/survey-points'),
      fetch('/api/parcels'),
      fetch('/api/analysis'),
    ]);
    surveyData = await ptsRes.json();
    parcelsData = await parRes.json();
    analysisData = await anaRes.json();

    // Store status colors
    if (analysisData.status_colors) {
      Object.assign(STATUS_COLORS, analysisData.status_colors);
    }

    addLayers();
    buildLegend();
    buildAnalysis();
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

  // Survey point circles
  map.addLayer({
    id: 'survey-points', type: 'circle', source: 'survey',
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

// ── Layer toggles ───────────────────────────────────────────────────────────
function setupLayerToggles() {
  const toggles = {
    'layer-points': ['survey-points'],
    'layer-parcels': ['parcels-fill', 'parcels-outline'],
    'layer-3d': ['parcels-3d'],
    'layer-heatmap': ['heatmap'],
    'layer-clusters': ['cluster-circles', 'cluster-count'],
    'layer-labels': ['survey-labels'],
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
    document.getElementById('sidebar').classList.toggle('collapsed');
    setTimeout(() => map.resize(), 350);
  });

  // Analysis panel toggle
  document.getElementById('analysis-toggle').addEventListener('click', () => {
    const panel = document.getElementById('analysis-panel');
    panel.classList.toggle('open');
    setTimeout(() => map.resize(), 350);
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

async function uploadFile(zone, endpoint, file) {
  const origHtml = zone.innerHTML;
  zone.innerHTML = '<h4>Uploading...</h4><p>Processing your data</p>';

  const fd = new FormData();
  fd.append('file', file);

  try {
    const res = await fetch(endpoint, { method: 'POST', body: fd });
    const data = await res.json();
    if (res.ok) {
      zone.classList.add('success');
      zone.innerHTML = `<h4>Success!</h4><p>${file.name} uploaded</p><p style="font-size:11px;color:var(--muted)">${JSON.stringify(data)}</p>`;
      // Reload data
      setTimeout(async () => {
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
      }, 500);
    } else {
      throw new Error(data.detail || 'Upload failed');
    }
  } catch (e) {
    zone.classList.remove('success');
    zone.innerHTML = `<h4 style="color:var(--red)">Error</h4><p>${e.message}</p>`;
    setTimeout(() => { zone.innerHTML = origHtml; zone.classList.remove('success'); }, 3000);
  }
}

// ── Init ────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  setupUI();
  initMap();
});
