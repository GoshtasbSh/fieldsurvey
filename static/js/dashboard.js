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
let currentBasemap = 'satellite';
let map, surveyData, parcelsData, analysisData;
// ── Field points (real-time from Supabase field_survey_points) ──
let sbClient = null;
let currentUserId = null;
let currentDisplayName = 'Teammate';
let fieldPointsData = { type: 'FeatureCollection', features: [] };
let teamChatMessages  = [];        // [{id, user_id, display_name, body, sent_at, attachment_url, attachment_type}]
let chatUnreadCount   = 0;
let activeTeamSubtab  = 'activity'; // 'activity' | 'chats'
let pendingAttachment = null;       // { file, type } | null
let fieldPresence = {}; // user_id → { display_name, last_active_at }
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

function showToast(msg, durationMs = 5000) {
  let el = document.getElementById('ks-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'ks-toast';
    el.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);' +
      'background:var(--card,#1e293b);color:var(--text,#e2e8f0);padding:10px 18px;' +
      'border-radius:8px;font-size:13px;box-shadow:0 4px 16px rgba(0,0,0,.45);' +
      'z-index:9999;pointer-events:none;opacity:0;transition:opacity .25s;max-width:420px;text-align:center;';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.opacity = '1';
  clearTimeout(el._timer);
  el._timer = setTimeout(() => { el.style.opacity = '0'; }, durationMs);
}

// Return a GeoJSON copy with matched IAQ points removed.
// When an IAQ response was merged into the community-contact layer (iaq_matched=true),
// the contact already shows as "Completed" green — no duplicate IAQ circle needed.
function iaqUnmatched(data) {
  if (!data || !data.features) return data;
  return { ...data, features: data.features.filter(f => !f.properties.iaq_matched) };
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

// IAQ points come in two flavours:
//   - /api/iaq-points       (public, per-respondent answers stripped)
//   - /api/iaq-points-full  (auth-gated, includes answers for the popup tab)
// Try the full endpoint first when the user has a Supabase session, fall
// back to the public one otherwise. Anonymous viewers still get the map
// dots + risk scores; only the per-question popup tab is blank.
async function fetchIaqPoints() {
  try {
    const session = (sbClient && sbClient.auth)
      ? (await sbClient.auth.getSession()).data?.session
      : null;
    if (session?.access_token) {
      const r = await fetch('/api/iaq-points?full=1', {
        headers: { 'Authorization': `Bearer ${session.access_token}` },
      });
      if (r.ok) return r;
    }
  } catch (e) { /* fall through to public */ }
  return fetch('/api/iaq-points');
}

// ── Data loading ────────────────────────────────────────────────────────────
async function loadData() {
  try {
    const [ptsRes, parRes, anaRes, iaqPtsRes, iaqAnaRes] = await Promise.all([
      fetch('/api/survey-points'),
      fetch('/api/parcels'),
      fetch('/api/analysis'),
      fetchIaqPoints(),
      fetch('/api/analysis?type=iaq'),
    ]);
    const EMPTY_GJ = { type: 'FeatureCollection', features: [] };
    const _safeJson = async (res, fallback) => {
      if (!res.ok) {
        console.warn(`API ${res.url} → HTTP ${res.status}`);
        showToast(`Warning: could not load ${res.url.split('/').pop()} (${res.status})`, 7000);
        return fallback;
      }
      try { return await res.json(); } catch { return fallback; }
    };
    surveyData   = await _safeJson(ptsRes,    EMPTY_GJ);
    parcelsData  = await _safeJson(parRes,    EMPTY_GJ);
    analysisData = await _safeJson(anaRes,    {});
    iaqData      = await _safeJson(iaqPtsRes, EMPTY_GJ);
    // Backfill match_status on any feature that came from a pre-v3
    // upload (no server-side tagger had run yet). This makes the new
    // stroke encoding work without forcing a re-upload.
    _backfillContactMatchStatus(surveyData);
    _backfillIaqMatchStatus(iaqData);
    const iaqAnaData = await _safeJson(iaqAnaRes, {});
    if (iaqAnaData.loaded) iaqAnalysis = iaqAnaData;

    if (analysisData.status_colors) {
      Object.assign(STATUS_COLORS, analysisData.status_colors);
    }

    addLayers();
    addIAQLayers();
    buildLegend();
    buildAnalysis();
    // Real-time field points + presence (fire-and-forget, no await — lets the rest render)
    initFieldPoints();

    // Auto-show contact data if it was restored from Supabase (no upload needed)
    if (surveyData && surveyData.features && surveyData.features.length) {
      map.setLayoutProperty('survey-points', 'visibility', 'visible');
      const toggle = document.getElementById('layer-points');
      if (toggle) toggle.checked = true;
      markStep1Done();
      unlockIAQStep();
    }

    // Auto-show IAQ data if it was restored from Supabase
    if (iaqData && iaqData.features && iaqData.features.length) {
      updateIAQOnMap();
      buildSurveyResultsTab(iaqAnalysis);
    }

    fitBounds();
    loadAnalysisMeta();   // show "Analyzed: [date]" badge in header
    document.getElementById('loading').classList.add('hide');
  } catch (e) {
    console.error('Data load error:', e);
    document.querySelector('#loading p').textContent = 'Error loading data. Is the server running?';
  }
}

// ── Re-fetch all dashboard data and re-render in place ─────────────────────
// Used after uploads / version restores / cron-triggered refreshes so the
// dashboard reflects the latest Supabase state without a full page reload.
// Preserves viewport (center/zoom) and active layer toggles.
async function refreshAllData() {
  const center = map.getCenter();
  const zoom   = map.getZoom();
  const EMPTY_GJ = { type: 'FeatureCollection', features: [] };

  try {
    // Cache-buster query param + `cache: 'no-cache'` on the fetch
    // options. Belt-and-suspenders so any intermediate proxy / CDN /
    // browser cache must revalidate. The endpoints themselves now use
    // Cache-Control: no-store, but adding this on the client side
    // means we'll be safe even if a future CDN config gets it wrong.
    const _b = `_=${Date.now()}`;
    const noCache = { cache: 'no-cache' };
    const [ptsRes, parRes, anaRes, iaqPtsRes, iaqAnaRes] = await Promise.all([
      fetch(`/api/survey-points?${_b}`, noCache),
      fetch(`/api/parcels?${_b}`, noCache),
      fetch(`/api/analysis?${_b}`, noCache),
      fetchIaqPoints(),
      fetch(`/api/analysis?type=iaq&${_b}`, noCache),
    ]);
    const safe = async (res, fb) => {
      if (!res || !res.ok) return fb;
      try { return await res.json(); } catch { return fb; }
    };
    surveyData    = await safe(ptsRes, EMPTY_GJ);
    parcelsData   = await safe(parRes, EMPTY_GJ);
    analysisData  = await safe(anaRes, {});
    iaqData       = await safe(iaqPtsRes, EMPTY_GJ);
    _backfillContactMatchStatus(surveyData);
    _backfillIaqMatchStatus(iaqData);
    const iaqAna  = await safe(iaqAnaRes, {});
    if (iaqAna.loaded) iaqAnalysis = iaqAna;

    if (analysisData.status_colors) Object.assign(STATUS_COLORS, analysisData.status_colors);

    map.getSource('survey')?.setData(surveyData);
    map.getSource('survey-clustered')?.setData(surveyData);
    map.getSource('parcels')?.setData(parcelsData);

    // Refresh replaced surveyData wholesale, so the has_field_point flags
    // stamped earlier are gone. Re-stamp before the legend is rebuilt so the
    // unified counts and the survey-points filter both reflect the current
    // CSV ↔ field-point dedup state.
    if (typeof stampCoincidentContacts === 'function') stampCoincidentContacts();

    updateIAQOnMap();
    buildLegend();
    buildAnalysis();
    if (iaqData?.features?.length) buildSurveyResultsTab(iaqAnalysis);

    // Stale chatbot IAQ symptom filter would highlight wrong points on fresh data.
    if (currentIAQFilter && typeof clearIAQHighlights === 'function') clearIAQHighlights();

    // Re-apply current status filter / search query to the freshly-loaded data
    // so the user's filter state survives an upload-triggered refresh.
    if (typeof applyFilters === 'function') applyFilters();
    // Re-apply legend row dimming — buildLegend() resets all rows to full opacity.
    if (typeof updateStatusRowHighlights === 'function') updateStatusRowHighlights();

    // Restore viewport without animation so it feels like an in-place refresh.
    map.jumpTo({ center, zoom });
  } catch (e) {
    console.warn('refreshAllData failed:', e);
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

  // Survey point circles (hidden by default — user uploads or toggles on).
  //
  // Stroke encodes the v3 IAQ match-status group (see
  // docs/superpowers/specs/2026-05-05-iaq-match-status-visual.md):
  //   match_status='matched'      → white   (G1 — contact + Qualtrics)
  //   match_status='contact_only' → yellow  (G2 — Completed but no
  //                                          Qualtrics; data gap to
  //                                          investigate)
  //   anything else (No Answer / Inaccessible / etc. or pre-v3 data)
  //                                → translucent white (existing look)
  // G2 also gets a thicker stroke so the yellow rim is unmistakable
  // even at low zoom.
  map.addLayer({
    id: 'survey-points', type: 'circle', source: 'survey',
    layout: { visibility: 'none' },
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 5, 16, 9, 19, 14],
      'circle-color': ['get', 'color'],
      // Defence-in-depth: require BOTH status='Completed' AND
      // match_status to apply the G1/G2 stroke. Belt-and-suspenders
      // against a stale match_status persisting on a contact whose
      // status has since changed (rare but possible during a partial
      // re-upload).
      //
      // G2 stroke = #fde047 (bright pure yellow). The earlier amber
      // #f59e0b was visually too close to the "No Answer" orange
      // (#f97316) in the status palette — at low zoom and with the
      // dot stacking that occurs when two CSV rows resolve to the
      // same parcel, users couldn't tell whether a yellow rim was a
      // genuine G2 marker or just an orange No-Answer dot leaking.
      // Pure yellow is unique in the palette.
      'circle-stroke-width': [
        'case',
        ['all',
          ['==', ['get', 'status'], 'Completed'],
          ['==', ['get', 'match_status'], 'contact_only']],   2.8,
        ['all',
          ['==', ['get', 'status'], 'Completed'],
          ['==', ['get', 'match_status'], 'matched']],        1.5,
        2,
      ],
      'circle-stroke-color': [
        'case',
        ['all',
          ['==', ['get', 'status'], 'Completed'],
          ['==', ['get', 'match_status'], 'contact_only']],   '#fde047',
        ['all',
          ['==', ['get', 'status'], 'Completed'],
          ['==', ['get', 'match_status'], 'matched']],        '#ffffff',
        'rgba(255,255,255,0.5)',
      ],
      'circle-opacity': 0.9,
    },
  });

  // IAQ Risk overlay — same source as survey-points, hidden by default.
  // Shows contacts that have a matched Qualtric survey, colored by IAQ risk tier.
  // Toggle via the "Air Quality Risk" checkbox in the Layers panel.
  map.addLayer({
    id: 'survey-iaq-risk', type: 'circle', source: 'survey',
    layout: { visibility: 'none' },
    filter: ['==', ['get', 'has_iaq_survey'], true],
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 6, 16, 11, 19, 16],
      'circle-color': [
        'match', ['get', 'iaq_risk_tier'],
        'High',   '#ef4444',
        'Medium', '#f97316',
        'Low',    '#10b981',
        '#6b7280'
      ],
      'circle-stroke-width': 2,
      'circle-stroke-color': 'rgba(255,255,255,0.7)',
      'circle-opacity': 0.92,
    },
  });
  map.on('click', 'survey-iaq-risk', onPointClick);
  map.on('mouseenter', 'survey-iaq-risk', () => map.getCanvas().style.cursor = 'pointer');
  map.on('mouseleave', 'survey-iaq-risk', () => map.getCanvas().style.cursor = '');

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

  // ── Field points (live from Supabase) — always on top ──
  map.addSource('field-points', { type: 'geojson', data: fieldPointsData });
  map.addLayer({
    id: 'field-points-glow', type: 'circle', source: 'field-points',
    paint: {
      'circle-radius': 16,
      'circle-color': ['get', 'color'],
      'circle-opacity': ['case', ['==', ['get','is_mine'], true], 0.20, 0.07],
      'circle-blur': 0.85,
    },
  });
  map.addLayer({
    id: 'field-points-dots', type: 'circle', source: 'field-points',
    paint: {
      'circle-radius': [
        'interpolate', ['linear'], ['zoom'],
        11, ['case', ['==', ['get','is_mine'], true], 6, 4.5],
        17, ['case', ['==', ['get','is_mine'], true], 13, 10],
      ],
      'circle-color': ['get', 'color'],
      'circle-opacity': ['case', ['==', ['get','is_mine'], true], 1.0, 0.45],
      'circle-stroke-width': ['case', ['==', ['get','is_mine'], true], 2, 0.6],
      'circle-stroke-color': ['case', ['==', ['get','is_mine'], true], '#ffffff', '#9ca3af'],
    },
  });
  map.on('click', 'field-points-dots', onFieldPointClick);
  map.on('mouseenter', 'field-points-dots', () => map.getCanvas().style.cursor = 'pointer');
  map.on('mouseleave', 'field-points-dots', () => map.getCanvas().style.cursor = '');
}

// ── Field-points helpers (Supabase-driven, real-time) ──
function fieldPointFeature(p, myId) {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
    properties: {
      id: p.id,
      status: p.status || 'Unknown',
      notes: p.notes || '',
      collector: p.collector_name || 'Surveyor',
      collector_id: p.collector_id || null,
      is_mine: !!(myId && p.collector_id && p.collector_id === myId),
      collected_at: p.collected_at,
      color: STATUS_COLORS[p.status] || '#9ca3af',
    },
  };
}

function setFieldPointsData() {
  const src = map && map.getSource && map.getSource('field-points');
  if (src) src.setData(fieldPointsData);
}

// Pull every field-collected point from the public dashboard endpoint
// (/api/field-points uses the service-role key so it works even when the
// browser has no Supabase session and would be blocked by RLS). Returns
// true when at least one feature was loaded so callers can decide whether
// to merge / overwrite the in-memory dataset.
async function loadFieldPointsFromServer() {
  try {
    const r = await fetch('/api/field-points', { cache: 'no-store' });
    if (!r.ok) return false;
    const fc = await r.json();
    const feats = (fc && Array.isArray(fc.features)) ? fc.features : [];
    fieldPointsData = {
      type: 'FeatureCollection',
      features: feats.map(f => {
        // Server returns ready-made GeoJSON; rebuild via fieldPointFeature so
        // is_mine + the cached color stay consistent with realtime upserts.
        const g = f.geometry || {};
        const c = Array.isArray(g.coordinates) ? g.coordinates : [null, null];
        const p = f.properties || {};
        return fieldPointFeature({
          id: p.id,
          lat: c[1], lon: c[0],
          status: p.status,
          notes: p.notes,
          collector_id: p.collector_id,
          collector_name: p.collector,
          collected_at: p.collected_at,
        }, currentUserId);
      }).filter(f => Number.isFinite(f.geometry.coordinates[0]) && Number.isFinite(f.geometry.coordinates[1])),
    };
    setFieldPointsData();
    return fieldPointsData.features.length > 0;
  } catch (e) {
    console.warn('GET /api/field-points failed:', e);
    return false;
  }
}

function upsertFieldPoint(p) {
  const feat = fieldPointFeature(p, currentUserId);
  const idx = fieldPointsData.features.findIndex(f => f.properties.id === feat.properties.id);
  if (idx >= 0) fieldPointsData.features[idx] = feat;
  else fieldPointsData.features.unshift(feat);
  setFieldPointsData();
}

function removeFieldPoint(id) {
  fieldPointsData.features = fieldPointsData.features.filter(f => f.properties.id !== id);
  setFieldPointsData();
}

function onFieldPointClick(e) {
  e.preventDefault();
  const f = e.features[0];
  const p = f.properties;
  const coords = f.geometry.coordinates;
  const mine = p.is_mine === true || p.is_mine === 'true';
  const badge = mine
    ? '<span style="margin-left:auto;font-size:9px;font-weight:700;padding:2px 6px;border-radius:6px;background:rgba(16,185,129,.18);color:#10b981;border:1px solid rgba(16,185,129,.4);text-transform:uppercase;letter-spacing:.4px;">You</span>'
    : '<span style="margin-left:auto;font-size:9px;font-weight:700;padding:2px 6px;border-radius:6px;background:rgba(148,163,184,.18);color:#94a3b8;border:1px solid rgba(148,163,184,.35);text-transform:uppercase;letter-spacing:.4px;">Team</span>';
  const when = p.collected_at ? new Date(p.collected_at).toLocaleString() : '';
  // p.color is bounded to STATUS_COLORS values (server-controlled palette);
  // every other field point property is attacker-controlled (collector
  // name supplied by guests, free-text notes, and statuses written by
  // any team member) so each interpolation MUST go through escapeHtml.
  const colorSafe = /^#[0-9a-fA-F]{3,8}$/.test(String(p.color || '')) ? p.color : '#9ca3af';
  new maplibregl.Popup({ offset: 14, maxWidth: '260px' })
    .setLngLat(coords)
    .setHTML(`
      <div style="padding:10px 12px;font-family:var(--font);">
        <div style="display:flex;align-items:center;gap:7px;margin-bottom:6px;">
          <div style="width:10px;height:10px;border-radius:50%;background:${colorSafe};box-shadow:0 0 6px ${colorSafe}66;"></div>
          <div style="font-size:13px;font-weight:700;color:${colorSafe};">${escapeHtml(p.status)}</div>
          ${badge}
        </div>
        <div style="font-size:11px;color:var(--muted);">👤 ${escapeHtml(p.collector)}</div>
        <div style="font-size:11px;color:var(--muted);">🕐 ${escapeHtml(when)}</div>
        ${p.notes ? `<div style="font-size:11px;font-style:italic;margin-top:7px;padding-top:7px;border-top:1px solid var(--border);">"${escapeHtml(p.notes)}"</div>` : ''}
      </div>
    `)
    .addTo(map);
}

async function initFieldPoints() {
  // Always pull the live total from the server first — this works even for
  // anon viewers / users not yet in team_members (RLS would silently block
  // a direct Supabase read), so the analysis panel and legend reflect real
  // field activity from the very first frame.
  const serverLoaded = await loadFieldPointsFromServer();
  if (serverLoaded) {
    if (typeof stampCoincidentContacts === 'function') stampCoincidentContacts();
    if (typeof buildLegend === 'function') buildLegend();
    if (typeof applyFilters === 'function') applyFilters();
    if (typeof buildAnalysis === 'function') {
      try { buildAnalysis(); } catch (e) { /* analysisData may not be ready */ }
    }
  }

  // Poll the same endpoint every 30 s so unauthenticated viewers — who
  // don't get Supabase realtime — still see new field points within half
  // a minute. When a Supabase realtime subscription is alive (signed-in
  // team members) this is just a low-cost safety net.
  if (window.__keystoneFieldPointsPoll) clearInterval(window.__keystoneFieldPointsPoll);
  window.__keystoneFieldPointsPoll = setInterval(async () => {
    if (document.hidden) return;
    const ok = await loadFieldPointsFromServer();
    if (ok && typeof onFieldPointsChanged === 'function') onFieldPointsChanged();
  }, 30000);

  // Boot Supabase client from /api/config (dashboard runs authenticated as viewer;
  // field_survey_points has public read, so unauthenticated SDK can still subscribe
  // and read under the anon RLS policy's effective behavior).
  let cfg = null;
  try {
    const r = await fetch('/api/config');
    if (r.ok) cfg = await r.json();
  } catch (e) { /* ignore — viewer-only mode works without Supabase */ }
  if (!cfg || !cfg.supabase_url || !cfg.supabase_anon_key || !window.supabase) {
    console.info('Supabase not configured for desktop dashboard; skipping real-time field points.');
    return;
  }
  sbClient = window.supabase.createClient(cfg.supabase_url, cfg.supabase_anon_key);

  // Guest-mode handling: a guest surveyor session in sessionStorage gives
  // ephemeral, time-boxed access. Guests can VIEW the desktop dashboard
  // read-only — admin/team-only UI (Update Data, Daily Refresh, Team
  // panel, AI Chat, per-respondent Survey Answers) is hidden by
  // applyRoleGatedUI() because _myRole='guest' is outside {admin,member}.
  // (Earlier this path bounced guests to /field/ entirely; that broke
  // Test 10 — Anon read-only sanity, since there's no truly-anon route
  // and guests are the closest equivalent.)
  let isGuestSession = false;
  try {
    const guestRaw = sessionStorage.getItem('keystone_guest_session');
    if (guestRaw) {
      isGuestSession = true;
      try {
        const g = JSON.parse(guestRaw);
        if (g && g.name) currentDisplayName = `${g.name} (guest)`;
      } catch { currentDisplayName = 'Guest'; }
    }
  } catch { /* sessionStorage blocked — fall through */ }

  // Identify the user if they have an existing session (cookie/localStorage shared
  // with the field PWA subdomain). Viewer-only is fine — is_mine simply stays false.
  let currentSession = null;
  try {
    const { data: { session } } = await sbClient.auth.getSession();
    currentSession = session;
    currentUserId      = session?.user?.id || null;
    if (!isGuestSession) {
      currentDisplayName = session?.user?.user_metadata?.full_name
        || (session?.user?.email || '').split('@')[0]
        || 'Teammate';
    }
  } catch (e) { /* ignore */ }

  // Bootstrap the user-menu chip + Team modal handlers if signed in.
  if (currentSession?.user) initUserMenu(currentSession.user);
  initTeamModal();
  // Guest / anon path: initUserMenu is skipped, so refreshMyRole() never
  // fires. Set _myRole explicitly so applyRoleGatedUI hides admin/team-only
  // UI; 'guest' label distinguishes from null (true anon) for any future
  // code that wants to special-case guests.
  if (!currentSession?.user) {
    if (isGuestSession) _myRole = 'guest';
    applyRoleGatedUI();
  }

  // Presence heartbeat (only when authenticated)
  if (currentSession?.user?.id) {
    const uid = currentSession.user.id;
    const name = currentSession.user.user_metadata?.full_name || (currentSession.user.email || '').split('@')[0];
    const beat = async () => {
      try {
        await sbClient.from('user_presence').upsert({
          user_id: uid, display_name: name,
          last_active_at: new Date().toISOString(), last_page: 'dashboard',
        }, { onConflict: 'user_id' });
      } catch (e) { /* ignore */ }
    };
    beat();
    setInterval(() => { if (!document.hidden) beat(); }, 30000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) beat(); });
  }

  // Initial load via Supabase direct (paginated). Skipped when the server
  // endpoint already populated the dataset above — direct reads can be
  // blocked by RLS and would clobber good data with an empty array.
  if (!fieldPointsData.features.length) {
    try {
      const PAGE = 1000;
      const HARD_CAP = 100000;
      const all = [];
      let from = 0;
      while (from < HARD_CAP) {
        const { data, error } = await sbClient
          .from('field_survey_points')
          .select('id, lat, lon, status, notes, collector_id, collector_name, collected_at')
          .order('collected_at', { ascending: false })
          .range(from, from + PAGE - 1);
        if (error || !Array.isArray(data) || data.length === 0) break;
        all.push(...data);
        if (data.length < PAGE) break;
        from += PAGE;
      }
      if (all.length >= HARD_CAP) {
        console.warn(`field_survey_points: pagination capped at ${HARD_CAP} rows`);
      }
      if (all.length) {
        fieldPointsData = {
          type: 'FeatureCollection',
          features: all.map(p => fieldPointFeature(p, currentUserId)),
        };
        setFieldPointsData();
        // First-load: surveyData is usually loaded by now; stamp coincident
        // contacts so the survey-points layer hides duplicate CSV dots from
        // the very first frame. onFieldPointsChanged() handles all later updates.
        if (typeof stampCoincidentContacts === 'function') stampCoincidentContacts();
        if (typeof buildLegend === 'function') buildLegend();
        if (typeof applyFilters === 'function') applyFilters();
      }
    } catch (e) { console.warn('Initial field-points fetch failed:', e); }
  }

  // Presence
  try {
    const { data: pres } = await sbClient
      .from('user_presence')
      .select('user_id, display_name, last_active_at');
    if (Array.isArray(pres)) {
      fieldPresence = {};
      for (const r of pres) fieldPresence[r.user_id] = r;
    }
  } catch (e) { /* table may not exist yet — ignore */ }

  // Load today's chat messages
  await loadTodayMessages();

  // Realtime
  sbClient.channel('keystone-dashboard-live')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'field_survey_points' },
      ({ new: p }) => { upsertFieldPoint(p); onFieldPointsChanged(); })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'field_survey_points' },
      ({ new: p }) => { upsertFieldPoint(p); onFieldPointsChanged(); })
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'field_survey_points' },
      ({ old: p }) => { if (p && p.id) { removeFieldPoint(p.id); onFieldPointsChanged(); } })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'user_presence' },
      ({ new: p, old: o }) => {
        const r = p || o;
        if (r && r.user_id) fieldPresence[r.user_id] = r;
        if (typeof renderPerUserPanel === 'function') renderPerUserPanel();
      })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'team_chat_messages' },
      ({ new: msg }) => { if (msg?.id) onChatMessage(msg); })
    .subscribe();
}

// Hook: called whenever field-points data changes (realtime or initial load).
// Safe-no-op if per-user panel not yet rendered.
function onFieldPointsChanged() {
  if (typeof renderPerUserPanel === 'function') renderPerUserPanel();
  // Field-collected points share the community-contact status namespace, so
  // every insert/update/delete must refresh the unified legend counts,
  // re-stamp CSV contacts that have a coincident field point (so the survey-
  // points layer hides the duplicate CSV dot), and re-apply any active
  // status filter to the field-points layer too.
  if (typeof stampCoincidentContacts === 'function') stampCoincidentContacts();
  if (typeof buildLegend === 'function') buildLegend();
  if (typeof updateStatusRowHighlights === 'function') updateStatusRowHighlights();
  if (typeof applyFilters === 'function') applyFilters();
  // Bottom analysis panel + Update Data modal community-contact card both
  // need to reflect the new live total. Guard each call so a partially-
  // initialised page (e.g. before /api/analysis returns) doesn't throw.
  if (typeof buildAnalysis === 'function') {
    try { buildAnalysis(); } catch (e) { console.warn('buildAnalysis on field-point change failed:', e); }
  }
  // Only re-render the modal if it's currently open — renderDataSummary()
  // hits Supabase, no need to do that on every realtime tick.
  const updModal = document.getElementById('import-modal');
  if (updModal && updModal.classList.contains('show') && typeof renderDataSummary === 'function') {
    try { renderDataSummary(); } catch (e) { console.warn('renderDataSummary on field-point change failed:', e); }
  }
}

// ── Team panel (desktop) ──
function presenceLabel(iso) {
  if (!iso) return { label: 'offline', cls: 'offline' };
  const diff = (Date.now() - new Date(iso).getTime()) / 60000;
  if (diff < 2) return { label: 'active now', cls: 'active-now' };
  if (diff < 60) return { label: `${Math.round(diff)}m ago`, cls: 'idle' };
  if (diff < 24*60) return { label: `${Math.round(diff/60)}h ago`, cls: 'idle' };
  return { label: `${Math.round(diff/1440)}d ago`, cls: 'offline' };
}

function renderPerUserPanel() {
  const rowsEl = document.getElementById('team-rows');
  const subEl  = document.getElementById('team-sub');
  const empty  = document.getElementById('team-empty');
  if (!rowsEl) return;

  const todayUtc = new Date().toISOString().slice(0, 10);
  const byId = {};

  // Seed from presence (so idle-but-signed-in teammates still appear)
  for (const [uid, pr] of Object.entries(fieldPresence || {})) {
    byId[uid] = {
      id: uid, name: pr.display_name || 'Teammate',
      total: 0, today: 0, statuses: {},
      last_active_at: pr.last_active_at,
    };
  }
  // Fold in field points
  for (const f of (fieldPointsData.features || [])) {
    const p = f.properties;
    const key = p.collector_id || ('name:' + (p.collector || 'Unknown'));
    if (!byId[key]) {
      byId[key] = { id: key, name: p.collector || 'Unknown',
        total:0, today:0, statuses:{}, last_active_at: null };
    }
    const m = byId[key];
    if (!m.name || m.name === 'Teammate') m.name = p.collector || m.name;
    m.total++;
    if ((p.collected_at || '').slice(0, 10) === todayUtc) m.today++;
    m.statuses[p.status] = (m.statuses[p.status] || 0) + 1;
  }

  const rows = Object.values(byId).map(m => {
    m.initials = (m.name || '?').split(' ').map(w => w[0]).join('').toUpperCase().slice(0,2);
    m.is_mine = currentUserId && m.id === currentUserId;
    const pres = presenceLabel(m.last_active_at);
    m.presence_label = pres.label; m.presence_cls = pres.cls;
    return m;
  }).sort((a,b) => {
    if (a.is_mine !== b.is_mine) return a.is_mine ? -1 : 1;
    if (b.today !== a.today) return b.today - a.today;
    return (new Date(b.last_active_at || 0)) - (new Date(a.last_active_at || 0));
  });

  if (!rows.length) {
    if (subEl) subEl.textContent = 'Waiting for field data…';
    if (empty) empty.style.display = 'block';
    rowsEl.innerHTML = '';
    return;
  }
  if (empty) empty.style.display = 'none';

  const todayTotal = rows.reduce((a,m)=>a+m.today,0);
  if (subEl) subEl.textContent = `${todayTotal} today · ${rows.length} surveyor${rows.length === 1 ? '' : 's'}`;

  rowsEl.innerHTML = rows.map(m => {
    // Status names come from any team member's writes — escape both the
    // label and the count, and clamp the colour to a real hex value so a
    // crafted status can't break out of the inline-style attribute.
    const topStatuses = Object.entries(m.statuses || {}).sort((a,b)=>b[1]-a[1]).slice(0,3)
      .map(([s,n]) => {
        const c = STATUS_COLORS[s] || '#9ca3af';
        const colorSafe = /^#[0-9a-fA-F]{3,8}$/.test(String(c)) ? c : '#9ca3af';
        return `<span style="color:${colorSafe}">${escapeHtml(s)} ${Number(n) || 0}</span>`;
      })
      .join(' · ');
    return `
      <div class="team-row ${m.is_mine ? 'mine' : ''}">
        <div class="team-av">${escapeHtml(m.initials || '?')}</div>
        <div class="team-main">
          <div class="team-row-name">${escapeHtml(m.name)}${m.is_mine ? '<span class="team-row-you">You</span>' : ''}</div>
          <div class="team-row-presence ${m.presence_cls}">● ${escapeHtml(m.presence_label)}</div>
          <div class="team-row-stats">${topStatuses || '<span style="color:var(--muted)">no points yet</span>'}</div>
        </div>
        <div class="team-row-right">
          <div class="team-row-today">${Number(m.today) || 0}</div>
          <div class="team-row-total">${Number(m.total) || 0} all-time</div>
        </div>
      </div>`;
  }).join('');
}

// ── Team Chat ──────────────────────────────────────────────────────────────

async function loadTodayMessages() {
  if (!sbClient) return;
  const todayUtc = new Date().toISOString().slice(0, 10);
  try {
    const { data, error } = await sbClient
      .from('team_chat_messages')
      .select('id, user_id, display_name, body, sent_at, attachment_url, attachment_type')
      .gte('sent_at', todayUtc + 'T00:00:00Z')
      .order('sent_at', { ascending: true })
      .limit(200);
    if (error) throw error;
    teamChatMessages = data || [];
    renderChatMessages();
  } catch (e) { console.warn('Team chat load failed:', e); }
}

function renderChatMessages() {
  const el = document.getElementById('team-chat-messages');
  if (!el) return;
  if (!teamChatMessages.length) {
    el.innerHTML = '<div style="color:var(--muted);font-size:12px;text-align:center;padding:20px 0">No messages today yet. Say hi!</div>';
    return;
  }
  el.innerHTML = teamChatMessages.map(m => {
    const mine = m.user_id === currentUserId;
    const time = new Date(m.sent_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    // Validate scheme + escape — never trust DB-stored URLs in template strings.
    const attUrl = safeUrl(m.attachment_url);
    const attHrefEsc = escapeHtml(attUrl);
    const attachHtml = attUrl
      ? (m.attachment_type === 'image'
          ? `<img src="${attHrefEsc}" class="tchat-img" onclick="window.open(this.src,'_blank')" alt="attachment">`
          : `<a href="${attHrefEsc}" target="_blank" rel="noopener" class="tchat-file">📄 View attachment</a>`)
      : '';
    return `<div class="tchat-msg ${mine ? 'mine' : 'theirs'}">
      ${!mine ? `<div class="tchat-meta">${escapeHtml(m.display_name)}</div>` : ''}
      <div class="tchat-bubble">${m.body ? escapeHtml(m.body) : ''}${attachHtml}</div>
      <div class="tchat-meta">${time}</div>
    </div>`;
  }).join('');
  el.scrollTop = el.scrollHeight;
}

async function sendTeamMessage() {
  if (!sbClient || !currentUserId) {
    showToast('Sign in to chat with the team', 5000);
    return;
  }
  const input = document.getElementById('team-chat-input');
  const body  = (input?.value || '').trim();
  if (!body && !pendingAttachment) return;
  input.value = '';

  let attachmentUrl = null, attachmentType = null;
  if (pendingAttachment) {
    try {
      const ext  = pendingAttachment.file.name.split('.').pop().toLowerCase();
      const path = `${currentUserId}/${Date.now()}.${ext}`;
      const { data: up, error: upErr } = await sbClient.storage
        .from('team-chat-attachments').upload(path, pendingAttachment.file);
      if (upErr) throw upErr;
      const { data: pub } = sbClient.storage
        .from('team-chat-attachments').getPublicUrl(up.path);
      attachmentUrl  = pub.publicUrl;
      attachmentType = pendingAttachment.type;
    } catch (e) { console.warn('Attachment upload failed:', e); }
    clearAttachment();
  }

  try {
    const { data, error } = await sbClient.from('team_chat_messages').insert({
      user_id: currentUserId, display_name: currentDisplayName,
      body: body || '', attachment_url: attachmentUrl, attachment_type: attachmentType,
    }).select('id,user_id,display_name,body,sent_at,attachment_url,attachment_type').single();
    if (error) throw error;
    if (data && !teamChatMessages.some(m => m.id === data.id)) {
      teamChatMessages.push(data);
      renderChatMessages();
    }
  } catch (e) {
    console.warn('Team chat send failed:', e);
    if (input) input.value = body;
    const el = document.getElementById('team-chat-messages');
    if (el) {
      const errDiv = document.createElement('div');
      errDiv.style.cssText = 'color:#ef4444;font-size:11px;text-align:center;padding:4px 0';
      errDiv.textContent = 'Message failed to send';
      el.appendChild(errDiv);
      setTimeout(() => errDiv.remove(), 3000);
    }
  }
}

function onFileSelected(input) {
  const file = input.files?.[0];
  if (!file) return;
  pendingAttachment = { file, type: file.type.startsWith('image/') ? 'image' : 'document' };
  const prev = document.getElementById('attach-preview');
  const name = document.getElementById('attach-name');
  if (prev && name) { name.textContent = file.name; prev.style.display = 'flex'; }
}

function clearAttachment() {
  pendingAttachment = null;
  const fi = document.getElementById('team-chat-file');
  if (fi) fi.value = '';
  const prev = document.getElementById('attach-preview');
  if (prev) prev.style.display = 'none';
}

function onChatMessage(newRow) {
  if (teamChatMessages.some(m => m.id === newRow.id)) return;
  teamChatMessages.push(newRow);
  const teamTabActive = document.querySelector('.analysis-tab[data-tab="team"]')?.classList.contains('active');
  const panelOpen     = document.getElementById('analysis-panel')?.classList.contains('open');
  const chatsVisible  = teamTabActive && panelOpen && activeTeamSubtab === 'chats';
  if (chatsVisible) {
    renderChatMessages();
  } else {
    chatUnreadCount++;
    const badge = document.getElementById('chat-badge');
    if (badge) {
      badge.textContent = chatUnreadCount > 9 ? '9+' : String(chatUnreadCount);
      // tbadge is only visible when its parent .team-toggle-btn has .active —
      // force the Chats button to show it even when inactive
      badge.style.display = 'inline-block';
      badge.style.background = '#ef4444';
      const chatsBtn = document.getElementById('ttog-chats');
      if (chatsBtn) chatsBtn.style.color = '#ef4444';
    }
  }
}

function clearChatBadge() {
  chatUnreadCount = 0;
  const badge = document.getElementById('chat-badge');
  if (badge) { badge.textContent = ''; badge.style.display = ''; badge.style.background = ''; }
  const chatsBtn = document.getElementById('ttog-chats');
  if (chatsBtn) chatsBtn.style.color = '';
  renderChatMessages();
}

function switchTeamSubtab(tab) {
  activeTeamSubtab = tab;
  document.getElementById('team-activity-view').style.display = tab === 'activity' ? '' : 'none';
  document.getElementById('team-chats-view').style.display    = tab === 'chats'    ? '' : 'none';
  document.getElementById('ttog-activity').classList.toggle('active', tab === 'activity');
  document.getElementById('ttog-chats').classList.toggle('active', tab === 'chats');
  if (tab === 'chats')    { clearChatBadge(); loadTodayMessages(); }
  if (tab === 'activity' && typeof renderPerUserPanel === 'function') renderPerUserPanel();
}

// ── Match-status backfill (legacy data without v3 server-side tags) ────
// Re-derives `match_status` on every load from the underlying source of
// truth so stale server-side tags cannot persist:
//   contact: 'matched' (G1) when status='Completed' AND has_iaq_survey
//            'contact_only' (G2) when status='Completed' AND !has_iaq_survey
//            unset for any other status
//   iaq:     'matched' (G1) when iaq_matched
//            'iaq_only' (G3) otherwise
//
// Why we re-derive (instead of skipping rows that already have a tag):
// the cached community-contact blob was written by an older code path
// that set match_status='contact_only' on first CSV upload (before any
// IAQ upload). When IAQ was uploaded later, the contact's
// has_iaq_survey flipped to true but the original match_status='contact_only'
// stuck in the cache. Result: popup shows "Qualtric matched" (has_iaq_survey=true)
// while the dot's rim is yellow (match_status='contact_only'). Re-deriving
// every load makes has_iaq_survey/iaq_matched the single source of truth
// and lets the cache self-heal without a re-upload.
function _backfillContactMatchStatus(featureCollection) {
  const feats = featureCollection?.features;
  if (!Array.isArray(feats)) return;
  for (const f of feats) {
    const p = f.properties || (f.properties = {});
    if (p.status === 'Completed') {
      p.match_status = p.has_iaq_survey ? 'matched' : 'contact_only';
    } else {
      // A non-Completed dot (No Answer / Inaccessible / etc.) must not
      // carry G1/G2 — strip a stale tag from a prior Completed snapshot.
      delete p.match_status;
    }
  }
}
function _backfillIaqMatchStatus(featureCollection) {
  const feats = featureCollection?.features;
  if (!Array.isArray(feats)) return;
  for (const f of feats) {
    const p = f.properties || (f.properties = {});
    p.match_status = p.iaq_matched ? 'matched' : 'iaq_only';
  }
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

// Validate a URL is http(s); otherwise return '' so a javascript:/data:
// payload can never reach an href / src attribute. CRITICAL: returns
// empty for empty input — `new URL('', origin)` is technically valid
// and resolves to the origin's root, which used to render as a fake
// "📄 View attachment" link in chat for messages that had no attachment.
function safeUrl(u) {
  const s = String(u || '').trim();
  if (!s) return '';
  try {
    const url = new URL(s, window.location.origin);
    return (url.protocol === 'http:' || url.protocol === 'https:') ? url.href : '';
  } catch { return ''; }
}

// ── Data-summary panel in the Update Data modal ──────────────────────────────
function _fmtRelative(iso) {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (!t) return '';
  const diff = (Date.now() - t) / 60000;
  if (diff < 1) return 'just now';
  if (diff < 60) return `${Math.round(diff)} min ago`;
  if (diff < 60*24) return `${Math.round(diff/60)} h ago`;
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month:'short', day:'numeric' });
}

async function renderDataSummary() {
  const cards = {
    community_contact: { count: 'ds-community-count', file: 'ds-community-file', when: 'ds-community-when', countPath: 'features' },
    iaq_survey:        { count: 'ds-iaq-count',       file: 'ds-iaq-file',       when: 'ds-iaq-when',       countPath: 'geojson.features' },
    parcels:           { count: 'ds-parcels-count',   file: 'ds-parcels-file',   when: 'ds-parcels-when',   countPath: 'features' },
  };
  const parent = {
    community_contact: document.querySelector('[data-dataset="community_contact"]'),
    iaq_survey:        document.querySelector('[data-dataset="iaq_survey"]'),
    parcels:           document.querySelector('[data-dataset="parcels"]'),
  };
  if (!sbClient) {
    for (const key of Object.keys(cards)) {
      const countEl = document.getElementById(cards[key].count);
      if (countEl) { countEl.textContent = '—'; countEl.classList.add('empty'); }
    }
    return;
  }
  for (const key of Object.keys(cards)) {
    const c = cards[key]; const el = parent[key];
    const countEl = document.getElementById(c.count);
    const whenEl  = document.getElementById(c.when);
    if (countEl) countEl.textContent = '…';
    if (whenEl) whenEl.textContent = '';
    if (el) { el.classList.remove('fresh','empty'); }
  }
  try {
    const { data, error } = await sbClient
      .from('keystone_dashboard_data')
      .select('data_type, payload, updated_at');
    if (error) throw error;
    const byType = Object.fromEntries((data || []).map(r => [r.data_type, r]));
    for (const [key, c] of Object.entries(cards)) {
      const row = byType[key];
      const countEl = document.getElementById(c.count);
      const whenEl  = document.getElementById(c.when);
      const fileEl  = document.getElementById(c.file);
      const el = parent[key];
      if (!row) {
        if (countEl) { countEl.textContent = '—'; countEl.classList.add('empty'); }
        if (whenEl) whenEl.textContent = '';
        if (el) el.classList.add('empty');
        continue;
      }
      // Count
      let n = 0;
      const payload = row.payload || {};
      if (c.countPath === 'features') n = (payload.features || []).length;
      else if (c.countPath === 'geojson.features') n = ((payload.geojson || {}).features || []).length;
      // For community contacts, fold in real-time field-collected points so
      // the card reflects what's on the map, not just the CSV upload.
      // Unified count = sum of unified status counts (CSV + standalone field
      // points, deduped by 30 m proximity).
      if (key === 'community_contact') {
        const live = computeUnifiedStatusCounts();
        const liveTotal = Object.values(live).reduce((s, v) => s + v, 0);
        if (liveTotal > n) n = liveTotal;
      }
      if (countEl) { countEl.textContent = n.toLocaleString(); countEl.classList.remove('empty'); }
      if (whenEl) whenEl.textContent = `Updated ${_fmtRelative(row.updated_at)}`;
      if (fileEl && key !== 'parcels') fileEl.textContent = payload.source_filename || 'Processed dataset';
      if (el) {
        el.classList.remove('empty');
        if (row.updated_at && (Date.now() - new Date(row.updated_at).getTime()) < 60*60*1000) {
          el.classList.add('fresh');
        }
      }
    }
  } catch (e) {
    console.warn('data-summary load failed:', e);
  }
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
  const iaqRiskColor = p.iaq_risk_tier === 'High' ? '#ef4444'
    : p.iaq_risk_tier === 'Medium' ? '#f97316' : '#10b981';
  // p.color is bounded to STATUS_COLORS but defence-in-depth: only allow
  // a real hex string — any other shape becomes the default gray.
  const colorSafe = /^#[0-9a-fA-F]{3,8}$/.test(String(p.color || '')) ? p.color : '#9ca3af';
  // Risk and score values are server-computed numbers; coerce so a
  // crafted string in the geojson can never break HTML/CSS context.
  const overallRisk = Number(p.iaq_overall_risk) || 0;
  const healthScore = Number(p.iaq_health_score) || 0;
  const iaqScore    = Number(p.iaq_iaq_score)    || 0;
  const structScore = Number(p.iaq_struct_score) || 0;
  return `
    <div class="popup-body">
      ${p.status_detail ? `<div class="popup-row"><span class="popup-label">First Attempt</span><span class="popup-value">${escapeHtml(p.status_detail)}</span></div>` : ''}
      ${p.second_attempt ? `<div class="popup-row"><span class="popup-label">Second Attempt</span><span class="popup-value">${escapeHtml(p.second_attempt)}</span></div>` : ''}
      ${p.date ? `<div class="popup-row"><span class="popup-label">Date</span><span class="popup-value">${escapeHtml(p.date)}</span></div>` : ''}
      ${p.notes ? `<div class="popup-row"><span class="popup-label">Notes</span><span class="popup-value">${escapeHtml(p.notes)}</span></div>` : ''}
      <div class="popup-row"><span class="popup-label">Street</span><span class="popup-value">${escapeHtml(p.street_name)}</span></div>
      <div class="popup-row"><span class="popup-label">Status</span><span class="popup-value"><span class="popup-badge" style="background:${colorSafe}22;color:${colorSafe};border:1px solid ${colorSafe}44">${escapeHtml(p.status)}</span></span></div>
      ${p.has_iaq_survey ? `
      <div class="popup-row" style="margin-top:6px;padding-top:6px;border-top:1px solid rgba(255,255,255,.08)">
        <span class="popup-label">IAQ Survey</span>
        <span class="popup-value" style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
          <span class="popup-badge" style="background:#10b98122;color:#10b981;border:1px solid #10b98144">✓ Qualtric matched</span>
          <span style="font-size:11px;color:var(--muted)">Risk&nbsp;<strong style="color:${iaqRiskColor}">${overallRisk}/100</strong> · <span style="color:${iaqRiskColor}">${escapeHtml(p.iaq_risk_tier)}</span></span>
        </span>
      </div>
      <div style="display:flex;gap:8px;margin-top:6px;font-size:11px;color:var(--muted)">
        <span>Health&nbsp;<strong>${healthScore}</strong></span>
        <span>IAQ&nbsp;<strong>${iaqScore}</strong></span>
        <span>Struct&nbsp;<strong>${structScore}</strong></span>
      </div>` : ''}
      ${(Array.isArray(p.coincident_contacts) && p.coincident_contacts.length) ? `
      <div style="margin-top:8px;padding-top:6px;border-top:1px solid rgba(255,255,255,.08)">
        <div class="popup-label" style="margin-bottom:4px">Other visits at this parcel</div>
        ${p.coincident_contacts.map(cc => `
          <div style="font-size:11px;color:var(--muted);line-height:1.45">
            <span class="popup-badge" style="background:rgba(255,255,255,.06);color:var(--text2);border:1px solid rgba(255,255,255,.1);padding:1px 6px;border-radius:4px">${escapeHtml(cc.status || 'Unknown')}</span>
            ${cc.collected_at ? `<span style="margin-left:6px">${escapeHtml(String(cc.collected_at).slice(0,10))}</span>` : ''}
            ${cc.notes ? `<div style="margin-top:2px;color:var(--text2)">${escapeHtml(cc.notes)}</div>` : ''}
          </div>
        `).join('')}
      </div>` : ''}
    </div>`;
}

// Find the IAQ-survey feature closest to (lon, lat) within `maxMeters`.
// Used to attach a per-respondent "Survey Answers" tab to a contact popup
// when the contact has has_iaq_survey: true. Returns null if no match.
function findMatchedIaqFeature(lon, lat, maxMeters) {
  const feats = iaqData?.features || [];
  if (!feats.length) return null;
  const r = (maxMeters || 60);
  let best = null, bestD = Infinity;
  for (const f of feats) {
    const c = f.geometry?.coordinates;
    if (!c) continue;
    const dy = (c[1] - lat) * 111320;
    const dx = (c[0] - lon) * 111320 * Math.cos(lat * Math.PI / 180);
    const d  = Math.sqrt(dx*dx + dy*dy);
    if (d < bestD && d <= r) { bestD = d; best = f; }
  }
  return best;
}

// Build the "Survey Answers" popup tab from an IAQ feature. Walks the
// SURVEY_QUESTIONS metadata baked into the analysis blob (chart_sources +
// survey_questions) so question text always tracks the canonical Qualtrics
// labels. Items without a recorded answer are skipped to keep the popup
// readable.
// Internal / non-answer fields stripped from the Survey Answers tab.
// Anything outside this set is treated as a real survey response.
// Denylist (not allowlist) so new Qualtrics questions show up
// automatically under "Other" without code changes.
const _IAQ_NON_ANSWER_FIELDS = new Set([
  // Display / geometry
  'street_name', 'address', 'color', 'risk_tier',
  // Scoring (already in Survey Summary tab — would just duplicate)
  'overall_risk', 'health_score', 'iaq_score', 'struct_score',
  // Match-status / merge internals
  'match_status', 'iaq_matched', 'has_iaq_survey',
  'iaq_match_lon', 'iaq_match_lat',
  // Qualtrics export metadata
  'response_id', 'recorded_date', 'recordeddate',
  'startdate', 'enddate', 'progress', 'duration',
  'finished', 'distributionchannel', 'userlanguage',
  'ipaddress', 'locationlatitude', 'locationlongitude',
  'id',
  // Contact-side fields that may bleed in via _upgrade_contacts_from_iaq
  'iaq_overall_risk', 'iaq_health_score', 'iaq_iaq_score', 'iaq_struct_score',
  'iaq_risk_tier', 'date', 'status', 'notes', 'collector',
  'collector_id', 'collected_at', 'collector_name', 'has_field_point',
  'matched_address', 'coord_source', 'second_attempt',
  'status_detail', 'parcel_id', 'parcel_lon', 'parcel_lat',
  'source', 'field_point_id', 'coincident_contacts',
]);

// Survey-question category structure — mirrors the analysis charts'
// taxonomy (api/_processing.py:SURVEY_QUESTIONS comments + CHART_SOURCES).
// Each `keys` array is the canonical list rendered in the popup —
// EVERY listed question is shown, with "—" for unanswered fields, so
// the popup is a complete snapshot of the survey-question set rather
// than a sparse view that only includes answered ones. Categories
// match the analysis sub-tabs (Health → IAQ → Structural → Residency
// & Housing → Relocation → Interventions → Experiences → Mobility →
// Demographics) so a clinician / PI sees the same mental layout in
// the popup as in the Analysis panel.
const _IAQ_CATEGORIES = [
  ['Health & Symptoms', [
    'respiratory_ill', 'asthma_freq', 'wheeze_freq',
    'headache_freq', 'tired_freq',
    'hospital_visit',
  ]],
  ['Indoor Air Quality', [
    'has_mold',
    'leakage_roof', 'leakage_walls', 'leakage_windows', 'leakage_floor',
    'cooling_central_ac', 'cooling_window_unit', 'cooling_fan', 'cooling_none',
    'cooking_method',
  ]],
  ['Structural & Housing Type', [
    'year_built', 'housing_type', 'condition', 'ownership',
  ]],
  ['Residency & Affordability', [
    'years_in_hre', 'anticipated_stay', 'mh_skirting',
    'safety_env', 'safety_social',
    'afford_urgency', 'afford_strategy',
  ]],
  ['Relocation Factors', [
    'reloc_factor_emp', 'reloc_factor_aff', 'reloc_factor_qol',
    'reloc_factor_fam', 'reloc_factor_ret', 'reloc_factor_env',
    'reloc_factor_inh', 'reloc_factor_oth',
  ]],
  ['Resilience Interventions', [
    'intv_roof_walls', 'intv_windows_doors', 'intv_rain_gardens',
    'intv_hvac', 'intv_plumbing_elec', 'intv_well_septic',
    'intv_ccua_water', 'intv_fence', 'intv_trees_shade',
    'intv_trim_trees', 'intv_drainage',
  ]],
  ['Experiences in HRE', [
    'exp_flooding', 'exp_flood_help', 'exp_extreme_heat',
    'exp_school_change', 'exp_law_enf', 'exp_insurance_loss',
    'exp_well_dry', 'exp_pests', 'exp_water_leaks', 'exp_loose_animals',
  ]],
  ['Well-being & Mobility', [
    'car_access', 'hurricane_transport',
  ]],
  ['Demographics', [
    'education', 'employment',
  ]],
];

// Readable labels for raw IAQ scorer fields not in SURVEY_QUESTIONS.
const _RAW_IAQ_LABELS = {
  tired_freq:          'How often do you feel tired or fatigued in your home?',
  leakage_roof:        'Water leakage — Roof',
  leakage_walls:       'Water leakage — Walls',
  leakage_windows:     'Water leakage — Windows',
  leakage_floor:       'Water leakage — Floor',
  cooling_central_ac:  'Cooling system — Central AC',
  cooling_window_unit: 'Cooling system — Window unit',
  cooling_fan:         'Cooling system — Fan only',
  cooling_none:        'Cooling system — No cooling',
  cooking_method:      'Cooking fuel / method',
};

function buildSurveyAnswersTab(iaqProps) {
  // Pull canonical question text from the analysis blob (loaded once
  // into iaqAnalysis at boot). Falls back to a humanised key when the
  // mapping is missing — that way even brand-new Qualtrics columns
  // render with a readable label.
  const qtext = { ..._RAW_IAQ_LABELS, ...(iaqAnalysis?.survey_questions || {}) };
  const friendly = (k) => k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  const props = iaqProps || {};

  // Render the COMPLETE survey-question set per category, including
  // unanswered fields ("—"). This is intentional — the popup is meant
  // as a full snapshot of the question instrument applied to this
  // respondent, not just the rows they happened to fill out. Skipping
  // empties would obscure the difference between "didn't ask" and
  // "asked, declined to answer".
  // Qualtrics emits placeholder text when a question's scale labels
  // were never customised — e.g. "Click to write Scale Point 1",
  // "Click to write Choice 4". Those are NOT real respondent answers,
  // so treat them as unanswered. Also filters obvious "no-data"
  // sentinels (n/a, none, skip) that can leak through CSV cleaning.
  const _PLACEHOLDER_RE = /^(click to write (scale point|choice)\s*\d*|n\/?a|none|skip(ped)?|no answer|--)$/i;
  const isAnswered = (v) => {
    if (v == null) return false;
    const s = String(v).trim();
    if (!s) return false;
    if (_PLACEHOLDER_RE.test(s)) return false;
    return true;
  };
  const renderRow = (q, v) => {
    const answered = isAnswered(v);
    const display  = answered ? String(v) : '—';
    return `<div class="popup-row" style="align-items:flex-start;gap:8px;padding:3px 0">
      <span class="popup-label" style="max-width:58%;font-size:10.5px;line-height:1.35;color:var(--text2);font-weight:400" title="${escapeHtml(q)}">${escapeHtml(q.length > 90 ? q.slice(0, 87) + '…' : q)}</span>
      <span class="popup-value" style="max-width:42%;text-align:right;font-size:11px;color:${answered ? 'var(--text)' : 'var(--muted)'};font-weight:${answered ? '500' : '400'};font-style:${answered ? 'normal' : 'italic'}">${escapeHtml(display)}</span>
    </div>`;
  };

  // Render each curated category. Sections always appear, even when
  // every answer in them is blank, so the field team can see what
  // the instrument covers at a glance.
  const knownKeys = new Set();
  _IAQ_CATEGORIES.forEach(([, keys]) => keys.forEach(k => knownKeys.add(k)));

  const curatedSections = _IAQ_CATEGORIES.map(([title, keys]) => {
    const rows = keys.map(k => renderRow(qtext[k] || friendly(k), props[k])).join('');
    const answeredCount = keys.reduce((n, k) => n + (isAnswered(props[k]) ? 1 : 0), 0);
    return `<div style="margin-top:12px;padding-top:8px;border-top:1px solid rgba(34,211,238,.15)">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
        <span style="font-size:10.5px;font-weight:800;color:var(--accent);text-transform:uppercase;letter-spacing:.08em">${escapeHtml(title)}</span>
        <span style="font-size:9.5px;color:var(--muted);font-family:var(--mono)">${answeredCount}/${keys.length}</span>
      </div>
      ${rows}
    </div>`;
  }).join('');

  // Anything else on the feature that isn't internal and isn't already
  // claimed by a curated category goes under "Other" — only rendered
  // when it has at least one non-empty value, so brand-new Qualtrics
  // columns surface automatically without polluting the layout.
  const otherEntries = Object.keys(props)
    .filter(k => !_IAQ_NON_ANSWER_FIELDS.has(k))
    .filter(k => !k.startsWith('_'))
    .filter(k => !knownKeys.has(k))
    .filter(k => isAnswered(props[k]));
  const otherSection = otherEntries.length
    ? `<div style="margin-top:12px;padding-top:8px;border-top:1px solid rgba(34,211,238,.15)">
        <div style="font-size:10.5px;font-weight:800;color:var(--accent);text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px">Other</div>
        ${otherEntries.map(k => renderRow(qtext[k] || friendly(k), props[k])).join('')}
      </div>`
    : '';

  // Top scoreboard repeats the Survey Summary numbers for at-a-glance
  // context (the user might land on this tab without seeing the
  // Summary tab first). Sections are scrollable so the full instrument
  // doesn't overflow the popup.
  return `<div class="popup-body" style="max-height:380px;overflow-y:auto;padding-right:4px">
    <div class="popup-row">
      <span class="popup-label">Risk score</span>
      <span class="popup-value" style="font-family:var(--mono)"><strong>${Number(props.overall_risk) || 0}</strong>/100 · ${escapeHtml(props.risk_tier || '—')}</span>
    </div>
    <div class="popup-row"><span class="popup-label">Health</span><span class="popup-value" style="font-family:var(--mono)">${Number(props.health_score) || 0}</span></div>
    <div class="popup-row"><span class="popup-label">IAQ</span><span class="popup-value" style="font-family:var(--mono)">${Number(props.iaq_score) || 0}</span></div>
    <div class="popup-row"><span class="popup-label">Structural</span><span class="popup-value" style="font-family:var(--mono)">${Number(props.struct_score) || 0}</span></div>
    ${curatedSections}
    ${otherSection}
  </div>`;
}

function buildParcelTab(p) {
  // fmt() returns the raw value when the input isn't a number, so any
  // string field (parcel_id, owner, land_use) reaches the DOM unescaped.
  // Wrap each non-numeric field in escapeHtml. Currency/area outputs go
  // through fmtCurrency/Math.round/Number — those are intrinsically safe.
  return `
    <div class="popup-body">
      <div class="popup-row"><span class="popup-label">Parcel ID</span><span class="popup-value" style="font-family:var(--mono)">${escapeHtml(fmt(p.parcel_id))}</span></div>
      <div class="popup-row"><span class="popup-label">Owner</span><span class="popup-value">${escapeHtml(fmt(p.owner))}</span></div>
      <div class="popup-row"><span class="popup-label">Land Use</span><span class="popup-value">${escapeHtml(fmt(p.land_use || p.use_code))}</span></div>
      <div class="popup-row"><span class="popup-label">Just Value</span><span class="popup-value" style="color:var(--green)">${fmtCurrency(p.just_value)}</span></div>
      <div class="popup-row"><span class="popup-label">Land Value</span><span class="popup-value">${fmtCurrency(p.land_value)}</span></div>
      <div class="popup-row"><span class="popup-label">Assessed</span><span class="popup-value">${fmtCurrency(p.assessed_value)}</span></div>
      <div class="popup-row"><span class="popup-label">Living Area</span><span class="popup-value">${p.living_area ? escapeHtml(fmt(p.living_area)) + ' sqft' : '—'}</span></div>
      <div class="popup-row"><span class="popup-label">Year Built</span><span class="popup-value">${escapeHtml(fmt(p.year_built))}</span></div>
      <div class="popup-row"><span class="popup-label">Buildings</span><span class="popup-value">${escapeHtml(fmt(p.num_buildings))}</span></div>
      <div class="popup-row"><span class="popup-label">Lot Size</span><span class="popup-value">${p.lot_sqft ? fmt(Math.round(p.lot_sqft)) + ' sqft' : '—'}</span></div>
      <div class="popup-row"><span class="popup-label">Last Sale</span><span class="popup-value">${p.last_sale_price > 0 ? fmtCurrency(p.last_sale_price) + (p.last_sale_year ? ' (' + (Number(p.last_sale_year) || '') + ')' : '') : '—'}</span></div>
    </div>`;
}

function buildTabbedPopup(address, tabs, activeTab) {
  // Tab labels are call-site literals; escape defensively in case a
  // future caller passes a dynamic value. Pane content already comes
  // pre-built from the tab builders, which escape user fields themselves.
  const tabHeaders = tabs.map((t, i) =>
    `<div class="popup-tab ${i === activeTab ? 'active' : ''}" data-idx="${i}">${escapeHtml(t.label)}</div>`
  ).join('');
  const tabPanes = tabs.map((t, i) =>
    `<div class="popup-pane ${i === activeTab ? 'active' : ''}" data-idx="${i}">${t.content}</div>`
  ).join('');

  return `<div class="popup-card">
    <div class="popup-header">
      <h3>${escapeHtml(address)}</h3>
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
async function onPointClick(e) {
  // survey-points and survey-iaq-risk share the same source. When both layers are
  // visible at the same location, MapLibre fires click events for each layer
  // separately — both call this handler. Mark the underlying DOM event so the
  // second call is a no-op. (MapLibre wraps the same DOM event for all layers.)
  if (e.originalEvent && e.originalEvent._ksPopupHandled) return;
  if (e.originalEvent) e.originalEvent._ksPopupHandled = true;

  e.preventDefault && e.preventDefault();
  const f = e.features[0];
  const sp = f.properties;
  const coords = f.geometry.coordinates.slice();
  // Diagnostic log so the user can verify exactly what's under any
  // pin they click. Open DevTools → Console → click the dot → see
  // status, match_status, has_iaq_survey, and which layer fired.
  console.log('[click] survey-points', {
    address:       sp.address,
    status:        sp.status,
    match_status:  sp.match_status,
    has_iaq_survey: sp.has_iaq_survey,
    coords,
  });

  // Query parcel underneath this point
  const parcelFeats = map.queryRenderedFeatures(e.point, { layers: ['parcels-fill'] });
  const pp = parcelFeats.length > 0 ? parcelFeats[0].properties : null;

  const tabs = [
    { label: 'Survey Contact', content: buildSurveyTab(sp) },
  ];
  // Survey Answers tab: gated to team members + admins (per the access
  // matrix; anon viewers never see per-respondent answers because
  // /api/iaq-points strips them server-side anyway, but we hide the
  // tab to avoid showing an empty pane).
  //
  // v3 (2026-05-05): server-side parcel-rep-point matching has now
  // stored the matched IAQ's coords on the contact (`iaq_match_lon` /
  // `iaq_match_lat`). Use those for an O(1)-ish lookup at the exact
  // coord — no more 100 m radius scan that could pick a neighbour's
  // Qualtrics response.
  //
  // Fall back to a *very* small 5 m search around the contact's own
  // coord only when the contact predates the v3 match (no
  // iaq_match_lon set) but somehow has has_iaq_survey=true. After
  // re-uploading the IAQ CSV this fallback is no longer reachable.
  // If the user just signed in, _myRole may still be null while refreshMyRole()
  // is in flight. Wait for it to resolve (max ~3 s) so the Survey Answers tab
  // is not missed on the very first click after login.
  if (_myRole === null && sbClient) {
    await refreshMyRole();
  }
  const isTeamMember = _myRole === 'admin' || _myRole === 'member';
  if (isTeamMember) {
    let iaqFeat = null;
    if (sp.iaq_match_lon != null && sp.iaq_match_lat != null) {
      iaqFeat = findMatchedIaqFeature(+sp.iaq_match_lon, +sp.iaq_match_lat, 1);
    } else if (sp.has_iaq_survey) {
      iaqFeat = findMatchedIaqFeature(coords[0], coords[1], 5);
    }
    if (iaqFeat && iaqFeat.properties) {
      tabs.push({ label: 'Survey Answers', content: buildSurveyAnswersTab(iaqFeat.properties) });
    }
  }
  if (pp) {
    tabs.push({ label: 'Parcel Data (FL DOR)', content: buildParcelTab(pp) });
  }

  const html = buildTabbedPopup(sp.address, tabs, 0);
  const popup = new maplibregl.Popup({ offset: 15, maxWidth: '400px' })
    .setLngLat(coords)
    .setHTML(html)
    .addTo(map);
  attachPopupTabEvents(popup);
}

function onParcelClick(e) {
  // Don't open a second parcel popup when ANY contact / IAQ marker
  // was clicked at the same pixel. Both the contact (onPointClick)
  // and IAQ (onIAQPointClick) handlers attach the parcel as their
  // own "Parcel Data (FL DOR)" tab, so a separate parcels-fill popup
  // would just duplicate that info. Includes the IAQ symbol layers
  // (iaq-points = G3 house-with-wifi, iaq-points-g1 = G1 plain house,
  // iaq-highlighted = street-highlight halo) so a click on a Qualtric-
  // only marker no longer triggers a second popup.
  const pointLayers = [
    'survey-points', 'survey-iaq-risk',
    'iaq-points', 'iaq-points-g1', 'iaq-highlighted',
  ].filter(l => map.getLayer(l));
  const pointFeats = pointLayers.length
    ? map.queryRenderedFeatures(e.point, { layers: pointLayers })
    : [];
  if (pointFeats.length > 0) return; // let the marker handler own it

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
      <h3 style="font-size:13px">${total} Community Contacts</h3>
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
      btn.addEventListener('click', async () => {
        popup.remove();
        try {
          const zoom = await map.getSource('survey-clustered').getClusterExpansionZoom(p.cluster_id);
          map.easeTo({ center: coords, zoom: zoom + 1, duration: 500 });
        } catch { /* source may have been removed */ }
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

  // Re-apply active filters so heatmap and cluster sources reflect the current
  // filter state after the basemap swap (handles the orphaned-source case).
  if (typeof applyFilters === 'function') applyFilters();
  if (typeof applyHeatmapClusterFilter === 'function') applyHeatmapClusterFilter();
}

// ── Unified community-contact spatial helpers ───────────────────────────────
// CSV-imported community contacts and field-collected points represent the
// SAME real-world thing — one household visit. The pair within ~30 m must
// (1) count once in the legend, (2) be filtered together, and (3) render as
// a single dot on the map (the field-point dot, since it carries the more
// recent ground-truth status). These helpers do all three.
const _UNIFIED_DEDUP_RADIUS_M = 30;
const _UNIFIED_CELL = 0.00040; // ~44 m grid cell at this latitude
function _cellKey(lat, lon) {
  return `${Math.round(lat / _UNIFIED_CELL)}|${Math.round(lon / _UNIFIED_CELL)}`;
}
function _fieldCellIndex() {
  const idx = new Map();
  for (const f of (fieldPointsData?.features || [])) {
    const [lon, lat] = f.geometry.coordinates;
    const k = _cellKey(lat, lon);
    if (!idx.has(k)) idx.set(k, []);
    idx.get(k).push(f);
  }
  return idx;
}
function _distMeters(lat1, lon1, lat2, lon2) {
  const dy = (lat2 - lat1) * 111320;
  const dx = (lon2 - lon1) * 111320 * Math.cos(lat1 * Math.PI / 180);
  return Math.sqrt(dx * dx + dy * dy);
}
function _nearestFieldFeature(lat, lon, fieldByCell) {
  const ky = Math.round(lat / _UNIFIED_CELL), kx = Math.round(lon / _UNIFIED_CELL);
  let best = null, bestD = Infinity;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const list = fieldByCell.get(`${ky + dy}|${kx + dx}`);
      if (!list) continue;
      for (const f of list) {
        const [flon, flat] = f.geometry.coordinates;
        const d = _distMeters(lat, lon, flat, flon);
        if (d <= _UNIFIED_DEDUP_RADIUS_M && d < bestD) { bestD = d; best = f; }
      }
    }
  }
  return best;
}

// Mark CSV contacts that are coincident with a field-collected point so the
// map filter can hide the CSV dot (the field-point dot stays visible). Pushes
// updated geojson back to the map source if anything changed. Returns true
// when a re-render is needed.
function stampCoincidentContacts() {
  const csv = surveyData?.features || [];
  if (!csv.length) return false;
  const fieldByCell = _fieldCellIndex();
  let changed = false;
  for (const f of csv) {
    const [lon, lat] = f.geometry.coordinates;
    const matched = _nearestFieldFeature(lat, lon, fieldByCell);
    const has = !!matched;
    if (!!f.properties.has_field_point !== has) {
      f.properties.has_field_point = has;
      changed = true;
    }
  }
  if (changed) {
    // The geojson source is registered as 'survey' (line ~268); 'survey-points'
    // is the LAYER id, not the source. Pushing setData on the source forces
    // MapLibre to re-evaluate the has_field_point filter against fresh data.
    const src = (typeof map !== 'undefined') && map.getSource && map.getSource('survey');
    if (src) src.setData(surveyData);
  }
  return changed;
}

// Live unified per-status counts. CSV contacts coincident with a field point
// inherit the field point's status (more recent ground truth) and the pair
// counts once. Standalone field points count on their own.
function computeUnifiedStatusCounts() {
  const counts = {};
  const csv   = (surveyData?.features || []);
  const field = (fieldPointsData?.features || []);
  if (!csv.length && !field.length) return counts;

  // Spatial index for field points: ~40 m cell so the 30 m radius is covered
  // by checking the cell + 8 neighbours.
  const CELL = 0.00040;
  const cellKey = (lat, lon) => `${Math.round(lat / CELL)}|${Math.round(lon / CELL)}`;
  const fieldByCell = new Map();
  field.forEach((f, i) => {
    const [lon, lat] = f.geometry.coordinates;
    const k = cellKey(lat, lon);
    if (!fieldByCell.has(k)) fieldByCell.set(k, []);
    fieldByCell.get(k).push(i);
  });

  const fieldUsed = new Set();
  const distM = (lat1, lon1, lat2, lon2) => {
    const dy = (lat2 - lat1) * 111320;
    const dx = (lon2 - lon1) * 111320 * Math.cos(lat1 * Math.PI / 180);
    return Math.sqrt(dx * dx + dy * dy);
  };

  csv.forEach(f => {
    const [lon, lat] = f.geometry.coordinates;
    const ky = Math.round(lat / CELL), kx = Math.round(lon / CELL);
    const candidates = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const c = fieldByCell.get(`${ky + dy}|${kx + dx}`);
        if (c) candidates.push(...c);
      }
    }
    let matched = -1;
    let bestDist = Infinity;
    for (const idx of candidates) {
      if (fieldUsed.has(idx)) continue;
      const [flon, flat] = field[idx].geometry.coordinates;
      const d = distM(lat, lon, flat, flon);
      if (d <= 30 && d < bestDist) { bestDist = d; matched = idx; }
    }
    const status = matched >= 0
      ? (field[matched].properties.status || f.properties.status || 'Unknown')
      : (f.properties.status || 'Unknown');
    if (matched >= 0) fieldUsed.add(matched);
    counts[status] = (counts[status] || 0) + 1;
  });

  // Unmatched field points: count as standalone contacts.
  field.forEach((fp, i) => {
    if (fieldUsed.has(i)) return;
    const s = fp.properties.status || 'Unknown';
    counts[s] = (counts[s] || 0) + 1;
  });
  return counts;
}

// ── Legend (unified: color picker + filter) ─────────────────────────────────
function buildUnifiedStatusControls() {
  const container = document.getElementById('unified-status-controls');
  if (!container) return;
  // Live unified counts (CSV contacts + field points, deduped by proximity).
  // Falls back to the cached analysis blob only if both live sources are
  // empty — covers the brief window before the first GET /api/* completes.
  const live = computeUnifiedStatusCounts();
  const counts = Object.keys(live).length ? live : (analysisData?.status_counts || {});
  container.innerHTML = '';

  Object.entries(STATUS_COLORS).forEach(([status, color]) => {
    const count = counts[status] || 0;
    if (count === 0 && status === 'Unknown') return;
    const row = document.createElement('div');
    row.className = 'legend-item';
    row.dataset.status = status;
    row.setAttribute('data-status-row', status);
    row.style.cssText = 'display:flex;align-items:center;gap:6px;padding:4px 0;font-size:12px;color:var(--text2);transition:opacity .15s';

    // STATUS_COLORS may be extended at runtime with keys from
    // analysisData.status_colors (server-derived from CSV statuses), so
    // both the key and the colour can be attacker-shaped — escape and
    // validate each.
    const colorSafe = /^#[0-9a-fA-F]{3,8}$/.test(String(color || '')) ? color : '#9ca3af';
    row.innerHTML = `
      <input type="color" value="${colorSafe}" data-status="${escapeHtml(status)}"
        style="width:20px;height:16px;border:1px solid var(--border);border-radius:3px;background:none;cursor:pointer;padding:0;flex-shrink:0;-webkit-appearance:none">
      <span class="sym-label" style="flex:1;cursor:pointer;user-select:none">${escapeHtml(status)}</span>
      <span class="legend-count" style="font-family:var(--mono);color:var(--muted);font-size:11px">${Number(count) || 0}</span>`;

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
  updateMatchStatusPanel();
}

// ── Match-status sidebar panel (G1 / G2 / G3 stroke encoding) ───────────
//
// activeMatchFilter:
//   null            → show all groups (default)
//   'matched'       → only G1 (white-stroke contacts)
//   'contact_only'  → only G2 (amber-stroke contacts)
//   'iaq_only'      → only G3 (purple-stroke IAQ-only)
//
// When a filter is active, the OTHER two layers' MapLibre filters are
// tightened so only the chosen group renders. Clicking the active row
// again clears the filter back to "show all".
let activeMatchFilter = null;

function _countMatchGroups() {
  const counts = { matched: 0, contact_only: 0, iaq_only: 0 };
  for (const f of (surveyData?.features || [])) {
    const ms = f.properties?.match_status;
    if (ms === 'matched' || ms === 'contact_only') counts[ms]++;
  }
  for (const f of (iaqData?.features || [])) {
    if (f.properties?.match_status === 'iaq_only') counts.iaq_only++;
  }
  return counts;
}

function updateMatchStatusPanel() {
  const c = _countMatchGroups();
  const setCount = (id, n) => {
    const el = document.getElementById(id);
    if (el) el.textContent = n.toLocaleString();
  };
  setCount('ms-count-matched',      c.matched);
  setCount('ms-count-contact_only', c.contact_only);
  setCount('ms-count-iaq_only',     c.iaq_only);

  const rows = document.querySelectorAll('#match-status-rows .match-row');
  rows.forEach(r => {
    r.classList.toggle('dimmed',
      activeMatchFilter !== null && r.dataset.group !== activeMatchFilter);
    r.style.background = (activeMatchFilter === r.dataset.group)
      ? 'rgba(56,189,248,.10)' : '';
  });
}

// Remember the user's manual layer toggles before we auto-flip them on
// behalf of a Match Status filter, so clearing the filter restores
// exactly what the user had visible.
let _msLayerSnapshot = null;

function _setLayerVisibility(layerId, visible) {
  if (!map?.getLayer(layerId)) return;
  map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none');
  // Mirror the change in the corresponding sidebar toggle if present.
  const toggleId = ({
    'survey-points':    'layer-points',
    'iaq-points':       'layer-iaq',
    'survey-iaq-risk':  'layer-iaq-risk',
  })[layerId];
  if (toggleId) {
    const cb = document.getElementById(toggleId);
    if (cb) cb.checked = visible;
  }
}

function applyMatchStatusFilter() {
  // Translate activeMatchFilter into per-sub-layer visibility. Sub-layers:
  //   survey-points    -> G1 + G2 (community contact circles)
  //   survey-iaq-risk  -> G1 only (contacts coloured by IAQ risk)
  //   iaq-points-g1    -> G1 IAQ plain house (peeks out behind contact)
  //   iaq-points       -> G3 IAQ house-with-wifi + purple halo
  // When the filter is cleared (null), defer to applyFilters() so the
  // user's existing status / search filter is restored — never bash
  // setFilter(null) blindly or we'd lose context.
  const want = activeMatchFilter; // null | 'matched' | 'contact_only' | 'iaq_only'

  if (want === null) {
    // Restore via the existing status-filter pipeline.
    if (typeof applyFilters === 'function') applyFilters();
    _setIaqFilter(null); // reset to base match_status filters on each sub-layer
    // Restore the layer-visibility snapshot we captured when the filter
    // was first activated.
    if (_msLayerSnapshot) {
      _setLayerVisibility('survey-points',   _msLayerSnapshot['survey-points']);
      _setLayerVisibility('survey-iaq-risk', _msLayerSnapshot['survey-iaq-risk']);
      _setIaqVisibility(_msLayerSnapshot['iaq-points']);
      _msLayerSnapshot = null;
    }
    updateMatchStatusPanel();
    return;
  }

  // First-time activation: snapshot current visibility so a later
  // "clear filter" can put it back exactly the way the user had it.
  // 'iaq-points' (the wifi G3 sub-layer) represents the user-facing
  // Qualtric IAQ Survey layer state.
  if (_msLayerSnapshot === null) {
    const vis = (id) => map?.getLayer(id)
      ? map.getLayoutProperty(id, 'visibility') !== 'none'
      : false;
    _msLayerSnapshot = {
      'survey-points':    vis('survey-points'),
      'iaq-points':       vis('iaq-points'),
      'survey-iaq-risk':  vis('survey-iaq-risk'),
    };
  }

  // survey-points layer: G1 + G2 live here. Filter to the picked group,
  // or hide entirely if the user picked G3.
  if (map?.getLayer('survey-points')) {
    map.setFilter('survey-points',
      (want === 'matched' || want === 'contact_only')
        ? ['==', ['get', 'match_status'], want]
        : ['==', ['get', 'match_status'], '__none__']);
    _setLayerVisibility('survey-points', want !== 'iaq_only');
  }
  // survey-iaq-risk: G1 only. Hide for non-G1 picks.
  if (map?.getLayer('survey-iaq-risk')) {
    map.setFilter('survey-iaq-risk',
      (want === 'matched')
        ? ['==', ['get', 'has_iaq_survey'], true]
        : ['==', ['get', 'match_status'], '__none__']);
  }
  // IAQ sub-layers — show only the relevant shape per pick:
  //   matched      -> show house (peeks behind contact circle)
  //   contact_only -> hide all IAQ shapes (G2 has no IAQ)
  //   iaq_only     -> show wifi + ring
  if (map?.getLayer('iaq-points-g1')) {
    map.setLayoutProperty('iaq-points-g1', 'visibility',
      want === 'matched' ? 'visible' : 'none');
  }
  if (map?.getLayer('iaq-points')) {
    map.setLayoutProperty('iaq-points', 'visibility',
      want === 'iaq_only' ? 'visible' : 'none');
  }
  updateMatchStatusPanel();
}

function bindMatchStatusRows() {
  const rows = document.querySelectorAll('#match-status-rows .match-row');
  rows.forEach(row => {
    row.addEventListener('click', () => {
      const g = row.dataset.group;
      activeMatchFilter = (activeMatchFilter === g) ? null : g;
      applyMatchStatusFilter();
    });
  });
}

// `activeFilters` is the set of statuses the user wants to SHOW. Empty = show all.
// Clicking a status toggles it in/out of the shown set; when the set becomes empty
// we revert to showing everything (so the user can clear all filters by re-clicking).
function toggleStatusFilter(status, el) {
  if (activeFilters.has(status)) {
    activeFilters.delete(status);
  } else {
    activeFilters.add(status);
  }
  updateStatusRowHighlights();
  applyFilters();
}

function updateStatusRowHighlights() {
  // When nothing is selected, no dimming (show-all). When something is selected,
  // dim the rows that aren't in the selection.
  const rows = document.querySelectorAll('[data-status-row]');
  const anySelected = activeFilters.size > 0;
  rows.forEach(row => {
    const s = row.getAttribute('data-status-row');
    if (!anySelected) { row.style.opacity = '1'; return; }
    row.style.opacity = activeFilters.has(s) ? '1' : '0.35';
  });
}

function applyFilters() {
  const search = (document.getElementById('search-input')?.value || '').toLowerCase();
  let filter = ['all'];

  // Status filter: show only selected; if nothing selected, no status filter
  if (activeFilters.size > 0) {
    filter.push(['in', ['get', 'status'], ['literal', [...activeFilters]]]);
  }

  // Search filter
  if (search) {
    filter.push(['any',
      ['in', search, ['downcase', ['get', 'address']]],
      ['in', search, ['downcase', ['get', 'street_name']]],
    ]);
  }

  // De-duplicate same-address points: when the IAQ risk overlay is visible,
  // the merged contact is already drawn by `survey-iaq-risk` (colored by
  // IAQ risk tier). Hide it from `survey-points` so the user sees ONE
  // point per address, not two stacked circles. ALSO: hide CSV contacts
  // that are coincident with a field-collected point (stamped by
  // stampCoincidentContacts) so the field-point dot is the only one shown
  // for that household.
  const iaqRiskVisible = map.getLayer('survey-iaq-risk') &&
    map.getLayoutProperty('survey-iaq-risk', 'visibility') === 'visible';
  const exclusions = [['!=', ['get', 'has_field_point'], true]];
  if (iaqRiskVisible) exclusions.push(['!=', ['get', 'has_iaq_survey'], true]);
  const pointsFilter = [...filter, ...exclusions];

  // Guard each setFilter with a getLayer check — early toggles before
  // loadData/addLayers finishes can otherwise throw on missing layers.
  if (map.getLayer('survey-points'))
    map.setFilter('survey-points', pointsFilter.length > 1 ? pointsFilter : null);
  if (map.getLayer('survey-labels'))
    map.setFilter('survey-labels', filter.length > 1 ? filter : null);
  if (map.getLayer('survey-iaq-risk'))
    map.setFilter('survey-iaq-risk', filter.length > 1
      ? [...filter, ['==', ['get', 'has_iaq_survey'], true]]
      : ['==', ['get', 'has_iaq_survey'], true]);
  // Field-collected points are the same conceptual thing as CSV contacts —
  // apply the same status filter to both layers so 'Completed' / 'Follow Up'
  // etc. show ALL contacts of that status, regardless of source.
  if (map.getLayer('field-points-dots')) {
    const fieldFilter = activeFilters.size > 0
      ? ['in', ['get', 'status'], ['literal', [...activeFilters]]]
      : null;
    map.setFilter('field-points-dots', fieldFilter);
    map.setFilter('field-points-glow', fieldFilter);
  }
}

// ── Central layer definition map ─────────────────────────────────────────────
const LAYER_DEFS = {
  field_points:   { toggle: 'layer-field-points',     mapLayers: ['field-points-glow', 'field-points-dots'] },
  iaq_points:     { toggle: 'layer-iaq',              mapLayers: ['iaq-points', 'iaq-points-g1'] },
  iaq_highlights: { toggle: 'layer-iaq-highlighted',  mapLayers: ['iaq-highlighted', 'iaq-street-line', 'iaq-street-line-core'] },
  iaq_risk:       { toggle: 'layer-iaq-risk',         mapLayers: ['survey-iaq-risk'] },
  contact_survey: { toggle: 'layer-points',           mapLayers: ['survey-points'] },
  parcels:        { toggle: 'layer-parcels',          mapLayers: ['parcels-fill', 'parcels-outline'] },
  clusters:       { toggle: 'layer-clusters',         mapLayers: ['cluster-circles', 'cluster-count'] },
  heatmap:        { toggle: 'layer-heatmap',          mapLayers: ['heatmap'] },
  labels:         { toggle: 'layer-labels',           mapLayers: ['survey-labels'] },
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
  if (name === 'heatmap') {
    const leg = document.getElementById('heatmap-legend');
    if (leg) leg.style.display = visible ? 'block' : 'none';
  }
  if (name === 'clusters') {
    const leg = document.getElementById('cluster-legend');
    if (leg) leg.style.display = visible ? 'block' : 'none';
    if (visible) setLayerVisibility('contact_survey', false);
  }
  // survey-iaq-risk shares the survey source — hide it whenever contact_survey is hidden
  // so the chatbot set_layer_visibility action is fully consistent.
  if (name === 'contact_survey' && !visible) {
    if (map.getLayer('survey-iaq-risk'))
      map.setLayoutProperty('survey-iaq-risk', 'visibility', 'none');
    const rt = document.getElementById('layer-iaq-risk');
    if (rt) rt.checked = false;
  }
  // Refresh dedup filters whenever the iaq_risk or contact_survey state
  // changes (chatbot path also goes through here).
  if (name === 'iaq_risk' || name === 'contact_survey') {
    if (typeof applyFilters === 'function') applyFilters();
  }
}

// ── Layer toggles ───────────────────────────────────────────────────────────
function setupLayerToggles() {
  const toggles = {
    'layer-points': ['survey-points'],
    'layer-parcels': ['parcels-fill', 'parcels-outline'],
    'layer-heatmap': ['heatmap'],
    'layer-clusters': ['cluster-circles', 'cluster-count'],
    'layer-labels': ['survey-labels'],
    'layer-iaq': ['iaq-points', 'iaq-points-g1'],
    'layer-iaq-highlighted': ['iaq-highlighted', 'iaq-street-line', 'iaq-street-line-core'],
    'layer-iaq-risk': ['survey-iaq-risk'],
    'layer-field-points': ['field-points-glow', 'field-points-dots'],
  };

  Object.entries(toggles).forEach(([id, layers]) => {
    document.getElementById(id).addEventListener('change', (e) => {
      const vis = e.target.checked ? 'visible' : 'none';
      layers.forEach(l => { if (map.getLayer(l)) map.setLayoutProperty(l, 'visibility', vis); });

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
      // When contact layer is hidden, also hide the IAQ-risk overlay (it reads the same source)
      if (id === 'layer-points' && !e.target.checked) {
        if (map.getLayer('survey-iaq-risk'))
          map.setLayoutProperty('survey-iaq-risk', 'visibility', 'none');
        const riskToggle = document.getElementById('layer-iaq-risk');
        if (riskToggle) riskToggle.checked = false;
      }

      // Show/hide layer-specific legends
      if (id === 'layer-heatmap') {
        document.getElementById('heatmap-legend').style.display = e.target.checked ? 'block' : 'none';
      }
      if (id === 'layer-clusters') {
        document.getElementById('cluster-legend').style.display = e.target.checked ? 'block' : 'none';
      }

      // Re-run filters so dedup (hide IAQ-merged contacts from survey-points
      // when IAQ-risk overlay is on) activates immediately.
      if (id === 'layer-iaq-risk' || id === 'layer-points') {
        applyFilters();
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

    // Update parcel color legend
    if (typeof buildParcelColorLegend === 'function') buildParcelColorLegend();
  });
}

// ── Analysis ────────────────────────────────────────────────────────────────
function buildAnalysis() {
  if (!analysisData) return;
  const a = analysisData;

  // Unified totals: CSV community contacts + standalone field-collected
  // points (deduped by 30 m proximity). This matches the legend so the
  // analysis panel reflects real-time field activity, not the stale
  // CSV-only snapshot from /api/analysis.
  const live = computeUnifiedStatusCounts();
  const haveLive = (surveyData?.features?.length || 0) + (fieldPointsData?.features?.length || 0) > 0;
  const status_counts = haveLive ? live : (a.status_counts || {});
  const total_points  = haveLive
    ? Object.values(status_counts).reduce((s, n) => s + n, 0)
    : (a.total_points || 0);
  const completed     = status_counts.Completed || 0;
  const completion_rate = total_points > 0
    ? +((completed / total_points) * 100).toFixed(1)
    : 0;

  // Summary bar text
  document.getElementById('analysis-summary').textContent =
    `${total_points} points | ${completion_rate}% completed | ${a.parcel_stats?.total || 0} parcels`;

  // Stat cards
  const cards = document.getElementById('stat-cards');
  cards.innerHTML = `
    <div class="stat-card"><div class="label">Total Addresses</div><div class="value">${total_points}</div></div>
    <div class="stat-card"><div class="label">Completed</div><div class="value" style="color:var(--green)">${status_counts.Completed || 0}</div><div class="sub">${completion_rate}% rate</div></div>
    <div class="stat-card"><div class="label">No Answer</div><div class="value" style="color:var(--orange)">${status_counts['No Answer'] || 0}</div></div>
    <div class="stat-card"><div class="label">Inaccessible</div><div class="value" style="color:var(--red)">${status_counts.Inaccessible || 0}</div></div>
    <div class="stat-card"><div class="label">Follow Up</div><div class="value" style="color:var(--cyan)">${status_counts['Follow Up'] || 0}</div></div>
    <div class="stat-card"><div class="label">Parcels Loaded</div><div class="value">${fmt(a.parcel_stats?.total || 0)}</div></div>
  `;

  // Status pie chart uses unified counts; streets/parcels stay CSV-derived
  // (per-street and per-parcel breakdowns come from analysisData and don't
  // include unmatched field points yet).
  buildStatusChart({ status_counts });
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
      <td>${escapeHtml(s.name)}</td>
      <td style="font-family:var(--mono)">${Number(s.count) || 0}</td>
      <td style="color:var(--green)">${Number(s.statuses.Completed) || 0}</td>
      <td style="color:var(--orange)">${Number(s.statuses['No Answer']) || 0}</td>
      <td style="color:var(--red)">${Number(s.statuses.Inaccessible) || 0}</td>
      <td>${(Number(s.count)||0) - (Number(s.statuses.Completed)||0) - (Number(s.statuses['No Answer'])||0) - (Number(s.statuses.Inaccessible)||0)}</td>
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
      if (tab.dataset.tab === 'team') {
        switchTeamSubtab('activity');
      }
    });
  });

  // Team chat send button + Enter key
  document.getElementById('team-chat-send')?.addEventListener('click', sendTeamMessage);
  document.getElementById('team-chat-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendTeamMessage(); }
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

  // Import modal — check survey status so Step 2 unlocks if data already loaded
  document.getElementById('btn-import').addEventListener('click', async () => {
    document.getElementById('import-modal').classList.add('show');
    renderDataSummary();  // populate current-data panel from Supabase
    try {
      const res = await fetch('/api/survey-points');
      const data = await res.json();
      if (data.features?.length > 0) { markStep1Done(); unlockIAQStep(); }
    } catch {}
  });
  document.getElementById('modal-close').addEventListener('click', () => {
    document.getElementById('import-modal').classList.remove('show');
  });
  document.getElementById('import-modal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) {
      document.getElementById('import-modal').classList.remove('show');
    }
  });

  // History modal
  document.getElementById('btn-history').addEventListener('click', openHistoryModal);
  document.getElementById('history-modal-close').addEventListener('click', () => {
    document.getElementById('history-modal').classList.remove('show');
  });
  document.getElementById('history-modal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) document.getElementById('history-modal').classList.remove('show');
  });
  document.getElementById('btn-daily-refresh').addEventListener('click', runDailyRefresh);

  // Upload zones
  setupUploadZones();
  setupLayerToggles();
  setupParcelColorBy();
  bindMatchStatusRows();
  setupSymbology();
  initChat();
}

// ── Version / History ────────────────────────────────────────────────────────

async function loadAnalysisMeta() {
  try {
    const res = await fetch('/api/analysis?meta=1');
    if (!res.ok) return;
    const meta = await res.json();
    const badge = document.getElementById('analyzed-badge');
    if (!badge) return;
    const v = meta.contact;
    if (v) {
      const d = new Date(v.created_at);
      const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      badge.textContent = `Analyzed: ${label}`;
      badge.style.display = '';
      badge.title = v.label || '';
    }
  } catch {}
}

async function openHistoryModal() {
  document.getElementById('history-modal').classList.add('show');
  const body = document.getElementById('history-modal-body');
  body.innerHTML = '<div class="version-empty">Loading...</div>';
  try {
    const res = await fetch('/api/versions');
    const data = await res.json();
    const contactVersions = data.community_contact || [];
    const iaqVersions     = data.iaq_survey || [];
    let html = '';

    if (contactVersions.length === 0 && iaqVersions.length === 0) {
      html = '<div class="version-empty">No history yet — data will appear here after the first upload or daily refresh.</div>';
    } else {
      // Render via DOM API instead of string interpolation — labels (sourced
      // from CSV filenames) are user-supplied data and could contain markup
      // or quotes that would otherwise XSS or break the inline onclick.
      const renderSection = (title, versions, kind) => {
        if (!versions.length) return '';
        const sec = document.createElement('div');
        const h = document.createElement('div');
        h.className = 'version-section-title';
        if (kind === 'iaq') h.style.marginTop = '20px';
        h.textContent = title;
        sec.appendChild(h);
        const list = document.createElement('div');
        list.className = 'version-list';
        versions.forEach((v, i) => {
          const d = new Date(v.created_at);
          const dateStr = d.toLocaleString('en-US', { month:'short', day:'numeric', year:'numeric', hour:'2-digit', minute:'2-digit' });
          const isCurrent = i === 0;
          const item = document.createElement('div'); item.className = 'version-item';
          const left = document.createElement('div');
          const labelEl = document.createElement('div');
          labelEl.className = 'version-item-label';
          labelEl.textContent = v.label || (kind === 'iaq' ? 'IAQ snapshot' : 'Analysis snapshot');
          const metaEl = document.createElement('div');
          metaEl.className = 'version-item-meta';
          metaEl.textContent = dateStr;
          left.append(labelEl, metaEl);
          const pts = document.createElement('span');
          pts.className = 'version-item-pts';
          pts.textContent = `${(v.n_points || 0).toLocaleString()} pts`;
          item.append(left, pts);
          if (isCurrent) {
            const cur = document.createElement('span');
            cur.style.cssText = 'font-size:11px;color:var(--green);font-weight:600;padding:3px 8px;border-radius:6px;background:rgba(16,185,129,.1)';
            cur.textContent = 'Current';
            item.appendChild(cur);
          } else if (_myRole === 'admin') {
            // Restore is admin-only — server enforces this too. Hide the
            // button for everyone else so non-admins don't click into a
            // guaranteed-401 toast.
            const btn = document.createElement('button');
            btn.className = 'btn btn-sm';
            btn.textContent = 'Restore';
            btn.addEventListener('click', () => restoreVersion(v.id, v.label || '', kind));
            item.appendChild(btn);
          }
          list.appendChild(item);
        });
        sec.appendChild(list);
        return sec;
      };
      const sec1 = renderSection('Community Contact Data', contactVersions, 'contact');
      const sec2 = renderSection('IAQ Survey Data',         iaqVersions,     'iaq');
      body.innerHTML = '';
      if (sec1) body.appendChild(sec1);
      if (sec2) body.appendChild(sec2);
      if (!sec1 && !sec2) {
        body.innerHTML = '<div class="version-empty">No history yet — data will appear here after the first upload or daily refresh.</div>';
      }
      return;
    }
    body.innerHTML = html;
  } catch (e) {
    body.innerHTML = `<div class="version-empty" style="color:var(--red)">Failed to load history: ${escapeHtml(e?.message || String(e))}</div>`;
  }
}

async function restoreVersion(id, label, type) {
  if (!confirm(`Restore "${label}"?\n\nThis will set it as the active dataset. The current data is already saved in history.`)) return;
  try {
    // Restore endpoint requires auth — pass the Supabase JWT.
    let token = null;
    try {
      if (sbClient) {
        const { data: { session } } = await sbClient.auth.getSession();
        token = session?.access_token || null;
      }
    } catch { /* server will 401 */ }
    const res = await fetch(`/api/versions?id=${id}`, {
      method: 'POST',
      headers: token ? { 'Authorization': `Bearer ${token}` } : {},
    });
    const data = await res.json();
    if (!data.restored) throw new Error('Restore failed');

    // Reload the affected layer
    if (type === 'contact') {
      const pts = await (await fetch('/api/survey-points')).json();
      surveyData = pts;
      _backfillContactMatchStatus(surveyData);
      map.getSource('survey')?.setData(surveyData);
      map.getSource('survey-clustered')?.setData(surveyData);
      if (pts.features?.length) {
        map.setLayoutProperty('survey-points', 'visibility', 'visible');
        markStep1Done(); unlockIAQStep();
      }
      const ana = await (await fetch('/api/analysis')).json();
      analysisData = ana;
      buildAnalysis();
      fitBounds();
    } else {
      const iaqPts = await (await fetchIaqPoints()).json();
      iaqData = iaqPts;
      _backfillIaqMatchStatus(iaqData);
      const iaqAna = await (await fetch('/api/analysis?type=iaq')).json();
      if (iaqAna.loaded) iaqAnalysis = iaqAna;
      updateIAQOnMap();
      buildSurveyResultsTab(iaqAnalysis);
    }

    await loadAnalysisMeta();
    document.getElementById('history-modal').classList.remove('show');
    showToast(`Restored: ${label}`, 5000);
  } catch (e) {
    alert(`Restore failed: ${e.message}`);
  }
}

async function runDailyRefresh() {
  const btn = document.getElementById('btn-daily-refresh');
  btn.disabled = true;
  btn.textContent = 'Running...';
  try {
    // Send the user's Supabase JWT — daily-refresh accepts admin role as
    // an alternative to the cron secret so PIs can trigger a refresh from
    // the dashboard.
    const session = (sbClient && sbClient.auth)
      ? (await sbClient.auth.getSession()).data?.session
      : null;
    const headers = session?.access_token
      ? { 'Authorization': `Bearer ${session.access_token}` }
      : {};
    const res = await fetch('/api/daily-refresh', { method: 'POST', headers });
    if (res.status === 401 || res.status === 403) {
      throw new Error('Admin role required to run daily refresh.');
    }
    const data = await res.json();
    if (data.refreshed) {
      // Reload contact points with merged field data + refresh the live
      // field layer so the unified count (which dedupes CSV-appended
      // field-as-features against fieldPointsData) reflects everything
      // the cron just merged.
      const pts = await (await fetch('/api/survey-points')).json();
      surveyData = pts;
      _backfillContactMatchStatus(surveyData);
      map.getSource('survey')?.setData(surveyData);
      map.getSource('survey-clustered')?.setData(surveyData);
      await loadFieldPointsFromServer();
      const ana = await (await fetch('/api/analysis')).json();
      analysisData = ana;
      // stamp + filters keep CSV/field layers from rendering the same
      // pin twice now that field rows live in both sources.
      if (typeof stampCoincidentContacts === 'function') stampCoincidentContacts();
      if (typeof applyFilters === 'function') applyFilters();
      buildAnalysis();
      await loadAnalysisMeta();
      // Quote the unified count the panel actually shows so the alert
      // and the panel match (the cached blob's length and the live
      // dedup-count can differ by ±1 when field points were newly
      // merged but their /api/field-points entries still exist).
      const live = (typeof computeUnifiedStatusCounts === 'function')
        ? Object.values(computeUnifiedStatusCounts()).reduce((s,n)=>s+n,0)
        : data.total_points;
      // Pull the date out of the server label and drop the parenthetical
      // "(N total)" the server appends — that N is the cached-blob feature
      // count which can differ from `live` (the deduped panel count) by
      // the number of field points that exist in BOTH the cached blob
      // AND /api/field-points. Showing both in one alert reads as a
      // contradiction; the panel and the unified `live` are the user-
      // facing truth, so we surface those and quote the date only.
      const labelDate = (data.label || '').match(/(\d{4}-\d{2}-\d{2})/)?.[1] || '';
      alert(
        `Refresh complete: ${data.new_field_points} new field visit${data.new_field_points === 1 ? '' : 's'} merged.\n` +
        `Total community contacts: ${live}.\n\n` +
        `Snapshot saved as Daily Update ${labelDate}.`
      );
    } else {
      alert(`No new field data found since last analysis.\n\n${data.reason}`);
    }
    // Refresh the version list only if the modal is currently open.
    if (document.getElementById('history-modal').classList.contains('show')) openHistoryModal();
  } catch (e) {
    alert(`Refresh failed: ${e.message}`);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg> Run Daily Refresh Now';
  }
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
    // Rebuild the match-status expression so the G2 yellow-rim encoding is
    // preserved — a flat override would erase the case expression entirely.
    map.setPaintProperty('survey-points', 'circle-stroke-width', [
      'case',
      ['all', ['==', ['get', 'status'], 'Completed'], ['==', ['get', 'match_status'], 'contact_only']], Math.max(1, v + 0.8),
      ['all', ['==', ['get', 'status'], 'Completed'], ['==', ['get', 'match_status'], 'matched']], Math.max(0.5, v - 0.5),
      v,
    ]);
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
        // Update legend info — clusterStatus may originate from server-
        // derived status_colors keys, escape both label and colour.
        const info = document.getElementById('cluster-legend-info');
        const cc = STATUS_COLORS[clusterStatus];
        const ccSafe = /^#[0-9a-fA-F]{3,8}$/.test(String(cc || '')) ? cc : '#9ca3af';
        if (info) info.innerHTML = `<div style="font-size:11px;color:var(--text2)">Showing <strong style="color:${ccSafe}">${escapeHtml(clusterStatus)}</strong> points only</div>`;
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
      // PARCEL_LU_COLORS is a static dictionary today, but escape both
      // sides defensively in case future code seeds it from server data.
      const c = customParcelColors[lu] || color;
      const cSafe = /^#[0-9a-fA-F]{3,8}$/.test(String(c || '')) ? c : '#9ca3af';
      row.innerHTML = `
        <input type="color" value="${cSafe}" data-lu="${escapeHtml(lu)}">
        <span class="sym-label">${escapeHtml(lu)}</span>`;
      row.querySelector('input').addEventListener('input', (e) => {
        customParcelColors[lu] = e.target.value;
        PARCEL_LU_COLORS[lu] = e.target.value;
        const expr = buildParcelColorExpr('land_use');
        map.setPaintProperty('parcels-fill', 'fill-color', expr);
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

    zone.addEventListener('click', () => {
      if (zone.classList.contains('locked')) return;
      input.click();
    });
    zone.addEventListener('dragover', (e) => {
      if (zone.classList.contains('locked')) return;
      e.preventDefault(); zone.classList.add('dragover');
    });
    zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('dragover');
      if (zone.classList.contains('locked')) return;
      if (e.dataTransfer.files.length) uploadFile(zone, endpoint, e.dataTransfer.files[0]);
    });
    input.addEventListener('change', () => {
      if (input.files.length) uploadFile(zone, endpoint, input.files[0]);
    });
  });
}

function unlockIAQStep() {
  const zone = document.getElementById('upload-iaq');
  zone?.classList.remove('locked');
  const badge = document.getElementById('step2-badge');
  if (badge) { badge.classList.remove('locked'); badge.classList.add('done'); }
  const tag = document.getElementById('step2-tag');
  if (tag) { tag.textContent = 'Ready'; tag.className = 'step-status-tag done'; }
}

function markStep1Done() {
  const badge = document.getElementById('step1-badge');
  if (badge) badge.classList.add('done');
  const tag = document.getElementById('step1-tag');
  if (tag) { tag.textContent = 'Loaded'; tag.className = 'step-status-tag done'; }
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
    // v3 reason buckets — under parcel-rep-point matching, "unmatched"
    // means the IAQ's parcel either has no community contact (flyer
    // respondent) or the IAQ failed to snap to any parcel at all.
    // We re-label the buckets accordingly:
    //   neighborParcel: nearest contact <300m → IAQ landed in a
    //                   different parcel from any contact (often a
    //                   neighbour, or a contact whose parcel record
    //                   we don't have).
    //   notInList:      nearest contact 300m–1km → respondent address
    //                   not in the canvas list (we never went there).
    //   noContact:      nearest contact ≥1km or unknown → respondent
    //                   outside the contact database (flyer / QR).
    gpsOffset:   unmatchedDetails.filter(d => d.nearest_contact_m != null && d.nearest_contact_m < 300).length,
    notInList:   unmatchedDetails.filter(d => d.nearest_contact_m != null && d.nearest_contact_m >= 300 && d.nearest_contact_m < 1000).length,
    noContact:   unmatchedDetails.filter(d => d.nearest_contact_m == null || d.nearest_contact_m >= 1000).length,
    geocoded:    unmatchedDetails.filter(d => d.coord_source === 'geocoded').length,
  };
  const unmatchedByStreet = {};
  unmatchedDetails.forEach(d => {
    if (!unmatchedByStreet[d.street_name]) unmatchedByStreet[d.street_name] = { count: 0, reasons: [] };
    unmatchedByStreet[d.street_name].count++;
    const r = (d.nearest_contact_m != null && d.nearest_contact_m < 300) ? 'Different parcel'
            : (d.nearest_contact_m != null && d.nearest_contact_m < 1000) ? 'Not in canvassing list'
            : 'Flyer / QR respondent';
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
      <div style="font-size:11px;font-weight:700;color:var(--green);margin-bottom:12px;text-transform:uppercase;letter-spacing:.06em">Community Contacts — Mapping &amp; Geocoding</div>
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
            <div style="font-size:10px;color:var(--muted);margin-top:2px">same parcel</div>
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
          Different parcel: ${unmatchedByReason.gpsOffset} — IAQ resolved to a parcel without a community contact</span>` : ''}
        ${unmatchedByReason.notInList ? `<span style="padding:3px 10px;border-radius:10px;background:rgba(249,115,22,.12);border:1px solid rgba(249,115,22,.3);color:#ea580c;font-size:10px;font-weight:600">
          Not in canvassing list: ${unmatchedByReason.notInList} — respondent address not canvassed</span>` : ''}
        ${unmatchedByReason.noContact ? `<span style="padding:3px 10px;border-radius:10px;background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.3);color:var(--red);font-size:10px;font-weight:600">
          Flyer / QR respondent: ${unmatchedByReason.noContact} — outside contact database</span>` : ''}
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
              <td style="font-weight:500">${escapeHtml(street)}</td>
              <td style="text-align:center;font-family:var(--mono);color:var(--red)">${d.count}</td>
              <td style="color:var(--muted)">${escapeHtml(d.reasons.join(', '))}</td>
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
              <td style="font-weight:500">${escapeHtml(street)}</td>
              <td style="font-family:var(--mono)">${d.n}</td>
              <td style="font-family:var(--mono);font-weight:700;color:${rc}">${d.mean_risk}</td>
              <td style="font-size:11px;color:var(--text2)">${escapeHtml(concern)}</td>
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
  const isIAQ = endpoint.includes('type=iaq');

  // Client-side validation before any network request
  const MAX_MB = 15;
  if (file.size > MAX_MB * 1024 * 1024) {
    showToast(`File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum is ${MAX_MB} MB.`, 7000);
    return;
  }
  if (isIAQ && file.name.split('.').pop().toLowerCase() !== 'csv') {
    showToast('IAQ upload requires a CSV file. Re-export from Qualtrics as CSV.', 7000);
    return;
  }

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

  // Fetch the Supabase JWT once up front — upload endpoints now require auth.
  let accessToken = null;
  try {
    if (sbClient) {
      const { data: { session } } = await sbClient.auth.getSession();
      accessToken = session?.access_token || null;
    }
  } catch { /* no session — server will 401 */ }

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
      if (accessToken) xhr.setRequestHeader('Authorization', `Bearer ${accessToken}`);
      xhr.send(fd);
    });

    // ── Success ──
    if (isIAQ) {
      if (xhrRef.pulse) clearInterval(xhrRef.pulse);
      finishOverlaySteps();
      setOverlayProgress(100, 'Analysis complete!');
      await new Promise(r => setTimeout(r, 700));
      hideAnalysisOverlay();

      // Single in-place refresh — fetches every layer + rebuilds analysis sidebar.
      await refreshAllData();

      // Auto-show IAQ points immediately after a fresh upload
      _setIaqVisibility(true);
      const iaqToggle = document.getElementById('layer-iaq');
      if (iaqToggle) iaqToggle.checked = true;
      document.getElementById('chat-btn')?.classList.add('has-data');

      if (data.n_upgraded > 0) {
        showToast(`${data.n_upgraded} community contact${data.n_upgraded > 1 ? 's' : ''} automatically marked Completed (Qualtric survey matched)`);
      }
      if (data.n_field_upgraded > 0) {
        showToast(`${data.n_field_upgraded} field survey point${data.n_field_upgraded > 1 ? 's' : ''} upgraded to Completed`);
      }
      if (data.validation && data.validation.missing_columns) {
        showToast(`Warning: missing Qualtrics columns — affected scores default to 0. See console.`, 9000);
        console.warn('IAQ upload missing columns:', data.validation.missing_columns);
      }

      zone.classList.add('success');
      // Coerce every interpolated value to a number so the success toast
      // can never echo attacker-shaped HTML out of the upload response.
      zone.innerHTML = `<h4>IAQ Data Loaded!</h4>
        <p>${Number(data.points) || 0} responses mapped · ${Number(data.streets_analyzed) || 0} streets</p>
        <p style="font-size:11px;color:var(--muted)">Mean risk score: ${Number(data.mean_risk) || 0}/100</p>`;

      // Show summary popup
      showSummaryPopup(data, iaqAnalysis);

    } else {
      zone.classList.add('success');
      // file.name comes from the user's chosen upload — escape so a
      // crafted filename like `<img src=x onerror=...>.csv` can't inject.
      zone.innerHTML = `<h4>Uploaded!</h4><p>${escapeHtml(file.name)}</p><p style="font-size:11px;color:var(--muted)">Loading data…</p>`;

      await refreshAllData();

      // Auto-enable survey points layer so the user can see the data immediately
      if (surveyData?.features?.length) {
        map.setLayoutProperty('survey-points', 'visibility', 'visible');
        const toggle = document.getElementById('layer-points');
        if (toggle) toggle.checked = true;
        fitBounds();
      }

      // Mark Step 1 done and unlock the IAQ upload zone (Step 2)
      markStep1Done();
      unlockIAQStep();

      // Auto-close the modal after a short pause
      await new Promise(r => setTimeout(r, 1200));
      document.getElementById('import-modal')?.classList.remove('show');
    }

  } catch (e) {
    xhrRef.done = true;
    if (xhrRef.pulse) clearInterval(xhrRef.pulse);
    if (isIAQ) hideAnalysisOverlay();
    zone.classList.remove('success');
    // Server error message can include user-supplied input echoed back
    // (e.g. malformed CSV column names). Escape before injecting.
    zone.innerHTML = `<h4 style="color:var(--red)">Upload failed</h4><p style="font-size:12px">${escapeHtml(e?.message || String(e))}</p><p style="font-size:11px;color:var(--muted);margin-top:6px">Check the Vercel function logs for details.</p>`;
    setTimeout(() => { zone.innerHTML = origHtml; zone.classList.remove('success'); }, 8000);
  }
}

// ── IAQ layers ──────────────────────────────────────────────────────────────
//
// Two related shapes for the Qualtric IAQ Survey layer — same house
// silhouette, with G3 "drawn line by line" inside:
//   • HOUSE (iaq-points-g1) — matched (G1) IAQ. Solid filled house,
//     renders BEHIND the community-contact circle so its roof +
//     corners peek out as the "this contact also has IAQ data +
//     in-person visit complete" cue.
//   • HOUSE-WITH-SCANLINES + purple SDF halo (iaq-points) — G3
//     (Qualtric only; no in-person visit at this parcel). Same house
//     silhouette but with three curved horizontal cut-outs in the body,
//     so the result is filled bands alternating with empty bands —
//     a half-painted house. Reads as "we have the survey but not the
//     full in-person fill". Purple icon-halo wraps the entire shape
//     so "Qualtric only" is unmistakable regardless of risk-tier tint.
//
// Why a shape (not just a colour) carries the data-source signal:
// IAQ risk-tier fill colours (orange / red) overlap with community-
// contact status colours (No-Answer orange / Inaccessible red). A pure
// rim-colour distinction blurs at small zoom, but a structurally
// different shape (house vs circle, then house-with-wifi vs plain
// house) reads at any zoom and is robust to future palette changes.
// See docs/superpowers/specs/2026-05-05-iaq-match-status-visual.md.

// House silhouette — peak roof, flat sides, flat bottom. Pentagonal
// with a clear "I am a house" gestalt at any size ≥ 12 px.
function _makeHouseIcon(px = 32) {
  const c = document.createElement('canvas');
  c.width = c.height = px;
  const ctx = c.getContext('2d');
  const s = px / 32;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(16 * s,  4 * s);   // peak
  ctx.lineTo(28 * s, 14 * s);   // right eave
  ctx.lineTo(28 * s, 28 * s);   // bottom-right
  ctx.lineTo( 4 * s, 28 * s);   // bottom-left
  ctx.lineTo( 4 * s, 14 * s);   // left eave
  ctx.closePath();
  ctx.fill();
  return ctx.getImageData(0, 0, px, px);
}

// House-with-scanlines (G3) — same house silhouette as G1, but the
// body is "drawn line by line": three curved horizontal stripes are
// punched out of the body so the result is filled bands alternating
// with empty bands (like a half-painted house). When the icon is
// tinted by icon-color, only the solid bands carry the risk-tier
// fill; the punch-outs are transparent. Reads as "this respondent
// answered online — the in-person visit is incomplete, drawn in
// scanlines like a wifi/signal pattern".
//
// Implementation note: destination-out composite "erases" the cuts
// from the previously-filled silhouette so the SDF is a single
// channel of solid + cut-out shapes. icon-halo wraps the outer
// perimeter (purple = "Qualtric only") and traces the inner cut
// edges, making the bands feel like a scanned/printed pattern.
function _makeHouseScanIcon(px = 32) {
  const c = document.createElement('canvas');
  c.width = c.height = px;
  const ctx = c.getContext('2d');
  const s = px / 32;

  // 1. Solid house silhouette (same proportions as iaq-house).
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(16 * s,  4 * s);   // peak
  ctx.lineTo(28 * s, 14 * s);   // right eave
  ctx.lineTo(28 * s, 28 * s);   // bottom-right
  ctx.lineTo( 4 * s, 28 * s);   // bottom-left
  ctx.lineTo( 4 * s, 14 * s);   // left eave
  ctx.closePath();
  ctx.fill();

  // 2. Punch out three curved horizontal "scanline" cuts in the body
  //    (y ≈ 17, 21, 25). Inset 4 px from each side so the perimeter
  //    stays intact and the house outline reads cleanly. Curves bow
  //    upward like wifi arcs to echo the "online signal" story.
  ctx.globalCompositeOperation = 'destination-out';
  ctx.lineCap   = 'round';
  ctx.lineWidth = 1.8 * s;
  for (const yc of [17, 21, 25]) {
    ctx.beginPath();
    ctx.moveTo( 8 * s, yc * s);
    ctx.quadraticCurveTo(16 * s, (yc - 1.6) * s, 24 * s, yc * s);
    ctx.stroke();
  }
  ctx.globalCompositeOperation = 'source-over';
  return ctx.getImageData(0, 0, px, px);
}

// Apply a filter to both IAQ symbol sub-layers, combined with each
// layer's match_status base filter so the house renders only matched
// (G1) and the house-wifi renders only iaq_only (G3).
function _setIaqFilter(userFilter) {
  const sub = {
    'iaq-points-g1': ['==', ['get', 'match_status'], 'matched'],
    'iaq-points':    ['==', ['get', 'match_status'], 'iaq_only'],
  };
  Object.entries(sub).forEach(([id, base]) => {
    if (!map.getLayer(id)) return;
    map.setFilter(id, userFilter == null ? base : ['all', base, userFilter]);
  });
}

function _setIaqVisibility(visible) {
  const v = visible ? 'visible' : 'none';
  ['iaq-points', 'iaq-points-g1'].forEach(id => {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', v);
  });
}

// Apply a tint expression to both house and house-wifi. Used by the
// chatbot's choropleth re-color paths.
function _setIaqColor(expr) {
  ['iaq-points', 'iaq-points-g1'].forEach(id => {
    if (map.getLayer(id)) map.setPaintProperty(id, 'icon-color', expr);
  });
}

function addIAQLayers() {
  // Source contains the FULL Qualtric IAQ dataset (matched + unmatched).
  // Earlier versions filtered out matched IAQ via iaqUnmatched(), which
  // hid G1 markers entirely — toggling the layer only affected G3 dots.
  // Now G1 renders as a house behind the community-contact circle, so
  // toggling the layer has an obvious visual effect on every parcel that
  // has IAQ data, not just standalone G3 ones.
  map.addSource('iaq-source', {
    type: 'geojson',
    data: iaqData || { type: 'FeatureCollection', features: [] },
  });

  // Register both icons once, sdf:true so MapLibre can tint them via
  // icon-color and draw an SDF halo via icon-halo-color (which the G3
  // layer uses for the purple outline). hasImage() guards against
  // double-registration if addIAQLayers is called twice.
  if (!map.hasImage('iaq-house')) {
    map.addImage('iaq-house', _makeHouseIcon(32), { sdf: true });
  }
  if (!map.hasImage('iaq-house-scan')) {
    map.addImage('iaq-house-scan', _makeHouseScanIcon(32), { sdf: true });
  }

  // ── Layer 1: G1 matched IAQ — plain HOUSE ───────────────────────
  // Renders BEHIND the community-contact circle (survey-points is
  // moveLayer-ed to the top below). Roof peak + wall corners peek
  // out as the "this contact also has IAQ data" cue.
  map.addLayer({
    id: 'iaq-points-g1',
    type: 'symbol',
    source: 'iaq-source',
    filter: ['==', ['get', 'match_status'], 'matched'],
    layout: {
      'icon-image': 'iaq-house',
      'icon-size': ['interpolate', ['linear'], ['zoom'],
                    12, 0.55, 14, 0.78, 16, 1.0, 19, 1.4],
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
      visibility: 'none',
    },
    paint: {
      'icon-color': ['get', 'color'],
      'icon-opacity': 0.92,
    },
  });

  // ── Layer 2: G3 Qualtric-only — HOUSE-WITH-SCANLINES + purple halo ─
  // Same house silhouette as G1 with three curved horizontal cut-outs
  // in the body, so the icon reads as a half-painted house — solid
  // bands alternating with empty bands. The metaphor: "we have the
  // online survey but not the full in-person visit, so the house is
  // drawn line by line". Purple SDF halo wraps the entire silhouette
  // and traces the inner cuts. Keeps the layer id 'iaq-points' so
  // existing setFilter / queryRenderedFeatures call sites work
  // unchanged.
  map.addLayer({
    id: 'iaq-points',
    type: 'symbol',
    source: 'iaq-source',
    filter: ['==', ['get', 'match_status'], 'iaq_only'],
    layout: {
      'icon-image': 'iaq-house-scan',
      'icon-size': ['interpolate', ['linear'], ['zoom'],
                    12, 0.55, 14, 0.78, 16, 1.05, 19, 1.5],
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
      visibility: 'none',
    },
    paint: {
      'icon-color': ['get', 'color'],
      'icon-halo-color': '#8b5cf6',
      'icon-halo-width': 2,
      'icon-halo-blur': 0.4,
      'icon-opacity': 0.95,
    },
  });

  // Highlighted-streets overlay — yellow circle halo behind/around any
  // IAQ marker on a highlighted street. Reverted to a circle (was a
  // diamond symbol in the v3 design) since with house+wifi shapes a
  // generic circular halo wraps both equally well.
  map.addLayer({
    id: 'iaq-highlighted',
    type: 'circle',
    source: 'iaq-source',
    filter: ['==', ['get', 'street_name'], '__none__'],
    layout: { visibility: 'none' },
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 11, 16, 16, 19, 20],
      'circle-color': '#facc15',
      'circle-stroke-width': 3,
      'circle-stroke-color': 'rgba(0,0,0,0.45)',
      'circle-opacity': 1,
    },
  });

  // Click + cursor handlers on every IAQ sub-layer so a click anywhere
  // on the marker (house corners, wifi waves, or purple ring) opens
  // the popup.
  ['iaq-points-g1', 'iaq-points', 'iaq-highlighted'].forEach(id => {
    if (!map.getLayer(id)) return;
    map.on('click',      id, onIAQPointClick);
    map.on('mouseenter', id, () => map.getCanvas().style.cursor = 'pointer');
    map.on('mouseleave', id, () => map.getCanvas().style.cursor = '');
  });

  // Move community-contact layers ABOVE the IAQ layers so the contact
  // circle wins the visual stack at a matched parcel — only the house's
  // roof peak and corners peek out from behind the circle. survey-points
  // is moved last so it ends up at the very top of the IAQ-related stack.
  try {
    if (map.getLayer('survey-iaq-risk'))  map.moveLayer('survey-iaq-risk');
    if (map.getLayer('survey-points'))    map.moveLayer('survey-points');
  } catch (e) { /* layer ordering best-effort */ }

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
    // Push the FULL Qualtric IAQ dataset (matched + unmatched) into the
    // source. The two sub-layers (iaq-points-g1 plain house, iaq-points
    // house-with-wifi + purple halo) each filter by match_status to
    // render the right shape per feature.
    map.getSource('iaq-source').setData(iaqData);
    // Do NOT auto-show the layer — the sidebar toggle controls visibility.
    // Only show if the toggle checkbox is already checked (e.g. warm-state reload).
    const toggle = document.getElementById('layer-iaq');
    if (toggle && toggle.checked) {
      _setIaqVisibility(true);
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
  // Mark the underlying DOM event so the parcels-fill click handler
  // doesn't ALSO fire and open a second popup. Same pattern
  // onPointClick uses for the contact + parcel double-fire case.
  if (e.originalEvent && e.originalEvent._ksPopupHandled) return;
  if (e.originalEvent) e.originalEvent._ksPopupHandled = true;

  e.preventDefault && e.preventDefault();
  const f = e.features[0];
  const p = f.properties;
  const coords = f.geometry.coordinates.slice();
  // Diagnostic log — open DevTools → Console → click any G3 dot.
  console.log('[click] iaq-points (G3 / Qualtric-only)', {
    street_name:    p.street_name,
    risk_tier:      p.risk_tier,
    overall_risk:   p.overall_risk,
    match_status:   p.match_status,
    iaq_matched:    p.iaq_matched,
    coords,
  });

  // Query the parcel underneath so the Parcel Data tab can attach to
  // this same popup (matches the matched-contact UX).
  const parcelFeats = map.queryRenderedFeatures(e.point, { layers: ['parcels-fill'] });
  const pp = parcelFeats.length ? parcelFeats[0].properties : null;

  // Build a tabbed popup like onPointClick. There's no Survey Contact
  // tab here because — by definition — G3 has no contact in the canvas
  // list. Instead the lead tab is "Survey Summary" (scores) followed
  // by per-question Survey Answers (members + admins only) and the
  // parcel tab when a parcel underlies the click.
  const tabs = [
    { label: 'Survey Summary', content: _buildIaqSummaryTab(p) },
  ];
  const isTeamMember = (typeof _myRole !== 'undefined') &&
                       (_myRole === 'admin' || _myRole === 'member');
  if (isTeamMember) {
    tabs.push({ label: 'Survey Answers', content: buildSurveyAnswersTab(p) });
  }
  if (pp) {
    tabs.push({ label: 'Parcel Data (FL DOR)', content: buildParcelTab(pp) });
  }

  const headerLabel = p.street_name || 'Qualtric respondent';
  const html = buildTabbedPopup(headerLabel, tabs, 0);
  const popup = new maplibregl.Popup({ offset: 15, maxWidth: '400px' })
    .setLngLat(coords)
    .setHTML(html)
    .addTo(map);
  attachPopupTabEvents(popup);
}

// Pulled out so the IAQ summary content can live alongside the
// per-question answers and parcel tabs in a single tabbed popup.
function _buildIaqSummaryTab(p) {
  const rc = p.color || '#9ca3af';
  const colorSafe = /^#[0-9a-fA-F]{3,8}$/.test(String(rc)) ? rc : '#9ca3af';
  return `
    <div class="popup-body">
      <div style="display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap">
        <span class="popup-badge" style="background:${colorSafe}22;color:${colorSafe};border:1px solid ${colorSafe}44">${escapeHtml(p.risk_tier || '—')} Risk</span>
        <span class="popup-badge" style="background:rgba(255,255,255,.05);color:var(--text2);border:1px solid var(--border)">Overall: ${Number(p.overall_risk) || 0}/100</span>
      </div>
      <div class="popup-row"><span class="popup-label">Health Score</span><span class="popup-value">${Number(p.health_score) || 0}/100</span></div>
      <div class="popup-row"><span class="popup-label">IAQ Score</span><span class="popup-value">${Number(p.iaq_score) || 0}/100</span></div>
      <div class="popup-row"><span class="popup-label">Structural Score</span><span class="popup-value">${Number(p.struct_score) || 0}/100</span></div>
      <div class="popup-row"><span class="popup-label">Ownership</span><span class="popup-value">${escapeHtml(p.ownership || '—')}</span></div>
      <div class="popup-row"><span class="popup-label">Housing Type</span><span class="popup-value">${escapeHtml(p.housing_type || '—')}</span></div>
      <div class="popup-row"><span class="popup-label">Year Built</span><span class="popup-value">${escapeHtml(p.year_built || '—')}</span></div>
      <div class="popup-row"><span class="popup-label">Mold Present</span><span class="popup-value">${p.has_mold ? '<span style="color:var(--orange)">Yes</span>' : 'No'}</span></div>
      <div class="popup-row"><span class="popup-label">Hospital Visit</span><span class="popup-value">${p.hospital_visit === 'yes' ? '<span style="color:var(--red)">Yes</span>' : 'No'}</span></div>
    </div>`;
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
  // New survey-question blocks (R/C/W/D). Empty defaults so older analysis
  // blobs persisted before the upgrade still render without errors.
  const residency      = a.residency        || {};
  const housingSafety  = a.housing_safety   || {};
  const affordability  = a.affordability    || {};
  const interventions  = a.interventions    || { pct_want: {}, highlights: [], order: [] };
  const experiences    = a.experiences      || { pct_yes:  {}, highlights: [], order: [] };
  const mobility       = a.mobility         || {};
  const demoExt        = a.demographics_ext || {};
  const surveyQs       = a.survey_questions || {};
  const chartSources   = a.chart_sources    || {};
  // Helper: build "<h4>Title</h4><div class='chart-source'>...</div>"
  // Renders silently (no caption) when the source key is absent.
  const head = (title, srcKey) => {
    const src = chartSources[srcKey];
    return `<h4>${title}</h4>` + (src ? `<div class="chart-source">Source: ${escapeHtml(src)}</div>` : '');
  };

  const rankedStreets = Object.entries(streetStats)
    .filter(([, d]) => !d.insufficient_data)
    .sort(([, a2], [, b]) => b.mean_risk - a2.mean_risk);

  const matchDetails = v.match_details || [];
  const gpsCount    = matchDetails.filter(d => d.coord_source === 'gps').length;
  const addrCount   = matchDetails.filter(d => d.coord_source === 'address_matched').length;
  const geocodedCount = matchDetails.filter(d => d.coord_source === 'geocoded').length;
  const totalMapped = a.n_responses || 0;

  const _ctx = {
    scores, riskTiers, health, housing, ownership, rankedStreets, v,
    gpsCount, addrCount, geocodedCount, totalMapped,
    residency, housingSafety, affordability, interventions, experiences,
    mobility, demoExt, surveyQs, chartSources,
  };

  const TABS = [
    'Overview','Health','IAQ','Structural','Streets','Validation',
    'Residency','Community','Well-being','Demographics+',
  ];
  // data-rtab key per tab (some labels contain hyphens etc.)
  const TAB_KEYS = [
    'overview','health','iaq','structural','streets','validation',
    'residency','community','wellbeing','demographics',
  ];

  container.innerHTML = `
    <div style="display:flex;border-bottom:1px solid var(--border);margin-bottom:10px;overflow-x:auto;flex-shrink:0">
      ${TABS.map((t, i) =>
        `<div class="res-tab" data-rtab="${TAB_KEYS[i]}"
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
        <div class="chart-box" style="flex:2;min-width:160px">${head('Mean Scores by Domain', 'mean_risk')}<canvas id="rc-scores" height="110"></canvas></div>
        <div class="chart-box" style="flex:1;min-width:110px">${head('Ownership', 'ownership')}<canvas id="rc-ownership" height="110"></canvas></div>
        <div class="chart-box" style="flex:1;min-width:110px">${head('Risk Tiers', 'risk_tiers')}<canvas id="rc-risk" height="110"></canvas></div>
      </div>
    </div>

    <!-- Health -->
    <div id="res-pane-health" class="res-pane" style="display:none">
      <div style="display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap">
        <div class="chart-box" style="flex:1.4;min-width:160px">${head('Symptom Prevalence — All Households (%)', 'symptoms')}<canvas id="rc-symptoms" height="110"></canvas></div>
        <div class="chart-box" style="flex:1.6;min-width:180px">${head('Respiratory &amp; Mold by Street (top 8 by risk)', 'mold_by_street')}<canvas id="rc-resp-street" height="110"></canvas></div>
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
        <div class="chart-box" style="flex:1.5;min-width:160px">${head('Mold Prevalence by Street — top 8 (%)', 'mold_by_street')}<canvas id="rc-mold-street" height="110"></canvas></div>
        <div class="chart-box" style="flex:1;min-width:110px">${head('Housing Age', 'year_built')}<canvas id="rc-yearbuilt" height="110"></canvas></div>
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
        <div class="chart-box" style="flex:1;min-width:120px">${head('Housing Types', 'housing_types')}<canvas id="rc-htypes" height="110"></canvas></div>
        <div class="chart-box" style="flex:1;min-width:120px">${head('Home Condition', 'conditions')}<canvas id="rc-cond" height="110"></canvas></div>
        <div class="chart-box" style="flex:1.6;min-width:160px">${head('Structural Score by Street (top 8)', 'struct_by_street')}<canvas id="rc-struct-street" height="110"></canvas></div>
      </div>
      <div class="stat-grid" style="grid-template-columns:repeat(auto-fit,minmax(100px,1fr))">
        ${Object.entries(housing.types||{}).map(([k,v3])=>`<div class="stat-card"><div class="label">${k}</div><div class="value" style="font-size:16px">${v3}</div></div>`).join('')}
      </div>
    </div>

    <!-- Streets -->
    <div id="res-pane-streets" class="res-pane" style="display:none">
      <div style="display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap">
        <div class="chart-box" style="flex:1">${head('Overall Risk Score by Street', 'risk_by_street')}<canvas id="rc-risk-street" height="110"></canvas></div>
        <div class="chart-box" style="flex:1">${head('Health vs IAQ vs Structural (top 6)', 'compare_street')}<canvas id="rc-compare-street" height="110"></canvas></div>
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
        <div class="stat-card"><div class="label">Confirmed</div><div class="value" style="font-size:18px;color:var(--green)">${v.matched_iaq_responses||'—'}</div><div class="sub">same parcel</div></div>
        <div class="stat-card"><div class="label">Match Rate</div>
          <div class="value" style="font-size:18px;color:${(v.match_rate_pct||0)>60?'var(--green)':(v.match_rate_pct||0)>30?'var(--orange)':'var(--red)'}">${v.match_rate_pct||'—'}%</div>
          <div class="sub">${v.unmatched_iaq||0} not confirmed</div></div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <div class="chart-box" style="flex:1;min-width:110px">${head('Coord Source', 'coord_source')}<canvas id="rc-coord-src" height="110"></canvas></div>
        ${v.unmatched_by_street && Object.keys(v.unmatched_by_street).length ? `
        <div class="chart-box" style="flex:2;min-width:160px">${head('Unmatched Responses by Street', 'unmatched')}
          <div style="display:flex;flex-wrap:wrap;gap:5px;padding-top:4px">
            ${Object.entries(v.unmatched_by_street).sort(([,a2],[,b2])=>b2-a2).slice(0,15).map(([street,cnt])=>
              `<span style="padding:2px 8px;border-radius:6px;font-size:11px;font-family:var(--mono);background:rgba(239,68,68,.12);color:var(--red);border:1px solid rgba(239,68,68,.25)">${escapeHtml(street)} <b>${Number(cnt) || 0}</b></span>`
            ).join('')}
          </div>
          <p style="font-size:10px;color:var(--muted);margin-top:8px">Not confirmed = IAQ resolved to a parcel without a community contact (flyer / QR respondent or address not canvassed)</p>
        </div>` : ''}
      </div>
    </div>

    <!-- Residency & Housing -->
    <div id="res-pane-residency" class="res-pane" style="display:none">
      <div class="stat-grid" style="grid-template-columns:repeat(4,1fr);margin-bottom:8px">
        <div class="stat-card"><div class="label">Years in HRE — mean</div><div class="value" style="font-size:18px">${(residency.years_in_hre||{}).mean ?? '—'}</div><div class="sub">n=${(residency.years_in_hre||{}).n_valid||0} parsed</div></div>
        <div class="stat-card"><div class="label">Years in HRE — median</div><div class="value" style="font-size:18px">${(residency.years_in_hre||{}).median ?? '—'}</div><div class="sub">free-text → numeric</div></div>
        <div class="stat-card"><div class="label">Mobile-home skirting</div><div class="value" style="font-size:18px">${Object.values(residency.mh_skirting||{}).reduce((s,n)=>s+(n||0),0)}</div><div class="sub">responses (skip-logic)</div></div>
        <div class="stat-card"><div class="label">Affordability strategy</div><div class="value" style="font-size:18px">${Object.keys(affordability.strategy||{}).length}</div><div class="sub">distinct answers</div></div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">
        <div class="chart-box" style="flex:1;min-width:200px">${head('Years lived in HRE — distribution', 'years_in_hre')}<canvas id="rc-residency-years" height="120"></canvas><div class="chart-source">Source: ${escapeHtml(surveyQs.years_in_hre || 'How long have you lived in High Ridge Estates?')}</div></div>
        <div class="chart-box" style="flex:1;min-width:200px">${head('Anticipated stay in current house', 'anticipated_stay')}<canvas id="rc-residency-stay" height="120"></canvas><div class="chart-source">Source: ${escapeHtml(surveyQs.anticipated_stay || 'How long do you anticipate continuing to live in your current house?')}</div></div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">
        <div class="chart-box" style="flex:1;min-width:200px">${head('Housing safety — environmental threats', 'safety_env')}<canvas id="rc-residency-env" height="120"></canvas><div class="chart-source">Source: ${escapeHtml(surveyQs.safety_env || '')}</div></div>
        <div class="chart-box" style="flex:1;min-width:200px">${head('Housing safety — social threats', 'safety_social')}<canvas id="rc-residency-social" height="120"></canvas><div class="chart-source">Source: ${escapeHtml(surveyQs.safety_social || '')}</div></div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">
        <div class="chart-box" style="flex:1;min-width:200px">${head('Affordable-housing urgency', 'afford_urgency')}<canvas id="rc-residency-urgency" height="120"></canvas><div class="chart-source">Source: ${escapeHtml(surveyQs.afford_urgency || '')}</div></div>
        <div class="chart-box" style="flex:1.2;min-width:240px">${head('Most effective affordability strategy', 'afford_strategy')}<canvas id="rc-residency-strategy" height="120"></canvas><div class="chart-source">Source: ${escapeHtml(surveyQs.afford_strategy || '')}</div></div>
      </div>
      <div class="chart-box">${head('Importance of relocation factors (count of "important / very important")', 'reloc_factors')}<div id="rc-reloc-bars" class="matrix-bars"></div><div class="chart-source">Source: ${escapeHtml((surveyQs.reloc_factor_qol || '').replace(/^Relocation factor — /, '') ? 'If you lived in another place before, how important were the following factors in relocating to HRE?' : '')}</div></div>
      <div style="margin-top:8px;padding:10px;background:var(--card);border:1px solid var(--border);border-radius:var(--r)">
        <div style="font-size:12px;font-weight:600;color:var(--text2);margin-bottom:6px">Mobile-home skirting intact?</div>
        <div class="chart-source" style="font-style:italic;color:var(--muted);font-size:10px;margin-bottom:6px">Source: ${escapeHtml(surveyQs.mh_skirting || '')}</div>
        <div id="rc-mh-skirting" style="font-size:11px;color:var(--text)"></div>
      </div>
    </div>

    <!-- Community Living (interventions + experiences) -->
    <div id="res-pane-community" class="res-pane" style="display:none">
      <div class="chart-box" style="margin-bottom:8px">${head('Home-resilience interventions — % of respondents wanting each', 'interventions_pct')}<div class="chart-source">Source: ${escapeHtml('Please indicate whether you would like or would not like to have the following interventions to improve your home’s resilience and quality in HRE.')}</div><div id="rc-intv-bars" class="matrix-bars"></div><div style="font-size:10px;color:var(--muted);margin-top:6px;font-style:italic">Highlighted in cyan: items flagged for priority research focus.</div></div>
      <div class="chart-box">${head("Experiences in HRE — % of respondents reporting 'yes'", 'experiences_pct')}<div class="chart-source">Source: ${escapeHtml('Since you’ve lived in High Ridge Estates, have you experienced…')}</div><div id="rc-exp-bars" class="matrix-bars"></div><div style="font-size:10px;color:var(--muted);margin-top:6px;font-style:italic">Highlighted in cyan: law enforcement · insurance loss · well drying up · pests · water leaks · loose animals.</div></div>
    </div>

    <!-- Well-being & Mobility -->
    <div id="res-pane-wellbeing" class="res-pane" style="display:none">
      <div class="stat-grid" style="grid-template-columns:repeat(4,1fr);margin-bottom:8px">
        <div class="stat-card"><div class="label">Car access — Yes</div><div class="value" style="font-size:18px;color:var(--green)">${(mobility.car_access||{}).yes||0}</div><div class="sub">households</div></div>
        <div class="stat-card"><div class="label">Car access — No</div><div class="value" style="font-size:18px;color:var(--orange)">${(mobility.car_access||{}).no||0}</div><div class="sub">households</div></div>
        <div class="stat-card"><div class="label">Hurricane transport problems — Yes</div><div class="value" style="font-size:18px;color:var(--red)">${(mobility.hurricane_transport||{}).yes||0}</div><div class="sub">households</div></div>
        <div class="stat-card"><div class="label">Hurricane — Not sure</div><div class="value" style="font-size:18px;color:var(--muted)">${(mobility.hurricane_transport||{}).not_sure||0}</div><div class="sub">households</div></div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <div class="chart-box" style="flex:1;min-width:200px">${head('Regular access to a car', 'car_access')}<canvas id="rc-car-access" height="120"></canvas><div class="chart-source">Source: ${escapeHtml(surveyQs.car_access || '')}</div></div>
        <div class="chart-box" style="flex:1;min-width:200px">${head('Transportation problems during hurricanes', 'hurricane_transport')}<canvas id="rc-hurricane" height="120"></canvas><div class="chart-source">Source: ${escapeHtml(surveyQs.hurricane_transport || '')}</div></div>
      </div>
    </div>

    <!-- Demographics+ -->
    <div id="res-pane-demographics" class="res-pane" style="display:none">
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <div class="chart-box" style="flex:1;min-width:240px">${head('Highest level of education', 'education')}<canvas id="rc-education" height="140"></canvas><div class="chart-source">Source: ${escapeHtml(surveyQs.education || '')}</div></div>
        <div class="chart-box" style="flex:1;min-width:240px">${head('Employment status', 'employment')}<canvas id="rc-employment" height="140"></canvas><div class="chart-source">Source: ${escapeHtml(surveyQs.employment || '')}</div></div>
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

function _initResultsCharts(tab, ctx) {
  const { scores, riskTiers, health, housing, rankedStreets, v,
          gpsCount, addrCount, geocodedCount, ownership,
          residency, housingSafety, affordability, interventions,
          experiences, mobility, demoExt, surveyQs } = ctx;
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

  // ── Helper: render a horizontal bar chart from a {label: count} dict ─────
  function _binBar(canvasId, dict, color) {
    const items = Object.entries(dict || {}).filter(([k]) => k);
    if (!items.length) {
      const el = document.getElementById(canvasId);
      if (el && el.parentElement) {
        el.style.display = 'none';
        const empty = document.createElement('div');
        empty.style.cssText = 'font-size:11px;color:var(--muted);font-style:italic;padding:8px 0';
        empty.textContent = 'No responses recorded for this question.';
        el.parentElement.insertBefore(empty, el.nextSibling);
      }
      return;
    }
    items.sort(([,a2],[,b2]) => b2 - a2);
    mk(canvasId, {
      type: 'bar',
      data: {
        labels: items.map(([k]) => k.length > 50 ? k.slice(0, 47) + '…' : k),
        datasets: [{
          label: 'count',
          data: items.map(([,n]) => n),
          backgroundColor: color || 'rgba(59,130,246,.7)',
          borderRadius: 3,
          barThickness: 16,
        }],
      },
      options: { ...OPTS, indexAxis: 'y', plugins: { legend: { display: false } },
                 scales: { x: AXIS, y: { ...AXIS, ticks: { ...AXIS.ticks, autoSkip: false, font: { size: 9 } } } } },
    });
  }

  // ── Helper: render a {label: pct} matrix as horizontal bars in HTML ──────
  function _matrixBars(containerId, fieldsOrdered, pctMap, highlights, labelMap) {
    const el = document.getElementById(containerId);
    if (!el) return;
    const hl = new Set(highlights || []);
    // Sort by pct desc but preserve full list (stable for canonical compare).
    const ranked = [...fieldsOrdered].sort((a, b) => (pctMap[b] || 0) - (pctMap[a] || 0));
    el.innerHTML = ranked.map(f => {
      const pct  = Math.max(0, Math.min(100, Number(pctMap[f] || 0)));
      const isHl = hl.has(f);
      // Strip the "Intervention — " / "Experience — " prefix from the label.
      const raw  = labelMap[f] || f;
      const lbl  = raw.replace(/^(Intervention|Experience|Relocation factor) — /, '');
      return `<div class="full">
        <div class="row"><div class="label${isHl ? ' hl' : ''}" title="${escapeHtml(raw)}">${escapeHtml(lbl)}</div><div style="font-family:var(--mono);font-size:10px;color:var(--text2);text-align:right">${pct}%</div></div>
        <div class="bar${isHl ? ' hl' : ''}"><span style="width:${pct}%"></span></div>
      </div>`;
    }).join('');
  }

  if (tab === 'residency') {
    const yrs = (residency.years_in_hre || {}).distribution || {};
    const yrsOrder = ['<1 yr','1–4','5–9','10–19','20–29','30+'];
    mk('rc-residency-years', {
      type: 'bar',
      data: { labels: yrsOrder,
        datasets: [{ label: 'respondents', barThickness: 22,
          data: yrsOrder.map(k => yrs[k] || 0),
          backgroundColor: 'rgba(6,182,212,.75)', borderRadius: 4 }] },
      options: { ...OPTS, plugins: { legend: { display: false } }, scales: { x: AXIS, y: AXIS } },
    });
    _binBar('rc-residency-stay', residency.anticipated_stay, 'rgba(139,92,246,.7)');
    _binBar('rc-residency-env',   (housingSafety.env || {}),    'rgba(16,185,129,.7)');
    _binBar('rc-residency-social',(housingSafety.social || {}), 'rgba(245,158,11,.7)');
    _binBar('rc-residency-urgency',  affordability.urgency,  'rgba(239,68,68,.7)');
    _binBar('rc-residency-strategy', affordability.strategy, 'rgba(59,130,246,.7)');

    // Relocation factors: count "important / very important" per factor.
    const reloc = (residency.reloc_factors || {});
    const relocFields = [
      'reloc_factor_emp','reloc_factor_aff','reloc_factor_qol','reloc_factor_fam',
      'reloc_factor_ret','reloc_factor_env','reloc_factor_inh','reloc_factor_oth',
    ];
    const relocPct = {};
    relocFields.forEach(f => {
      const counts = reloc[f] || {};
      let imp = 0, n = 0;
      Object.entries(counts).forEach(([k, c]) => {
        n += c;
        const kl = String(k).toLowerCase().trim();
        // Numeric scale: count above midpoint (handles Qualtrics recode exports).
        const num = parseFloat(k);
        if (!isNaN(num)) {
          // Detect scale ceiling from the full counts dict.
          const allNums = Object.keys(counts).map(parseFloat).filter(x => !isNaN(x));
          const scaleMax = Math.max(...allNums);
          if (num > scaleMax / 2) imp += c;
          return;
        }
        // Text labels: exclude anything prefixed with "not" or "not at all".
        // "Not Important" contains "important" so must be checked first.
        const isNegative = kl.startsWith('not ') || kl.startsWith('not at');
        if (!isNegative && (
          kl.includes('important') || kl === 'very' ||
          kl.includes('high') || kl.includes('strongly')
        )) imp += c;
      });
      relocPct[f] = n > 0 ? Math.round(imp / n * 100) : 0;
    });
    _matrixBars('rc-reloc-bars', relocFields, relocPct, [], surveyQs);

    const sk = residency.mh_skirting || {};
    const skEl = document.getElementById('rc-mh-skirting');
    if (skEl) {
      const skItems = Object.entries(sk).filter(([k]) => k);
      skEl.innerHTML = skItems.length
        ? skItems.map(([k, c]) => `<div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid var(--border)"><span>${escapeHtml(k)}</span><b style="font-family:var(--mono)">${c}</b></div>`).join('')
        : '<span style="color:var(--muted);font-style:italic">No mobile-home respondents reported.</span>';
    }
  }

  if (tab === 'community') {
    _matrixBars('rc-intv-bars',
      interventions.order || [],
      interventions.pct_want || {},
      interventions.highlights || [],
      surveyQs);
    _matrixBars('rc-exp-bars',
      experiences.order || [],
      experiences.pct_yes || {},
      experiences.highlights || [],
      surveyQs);
  }

  if (tab === 'wellbeing') {
    const ca = mobility.car_access || {};
    const ht = mobility.hurricane_transport || {};
    mk('rc-car-access', {
      type: 'doughnut',
      data: { labels: ['Yes','No','Not sure','Other','No answer'],
        datasets: [{ data: [ca.yes||0, ca.no||0, ca.not_sure||0, ca.other||0, ca.na||0],
          backgroundColor: ['#10b981','#ef4444','#94a3b8','#8b5cf6','#475569'], borderWidth: 0 }] },
      options: { ...OPTS, cutout: '55%' },
    });
    mk('rc-hurricane', {
      type: 'doughnut',
      data: { labels: ['Yes','No','Not sure','Other','No answer'],
        datasets: [{ data: [ht.yes||0, ht.no||0, ht.not_sure||0, ht.other||0, ht.na||0],
          backgroundColor: ['#ef4444','#10b981','#94a3b8','#8b5cf6','#475569'], borderWidth: 0 }] },
      options: { ...OPTS, cutout: '55%' },
    });
  }

  if (tab === 'demographics') {
    _binBar('rc-education',  demoExt.education,  'rgba(59,130,246,.75)');
    _binBar('rc-employment', demoExt.employment, 'rgba(139,92,246,.75)');
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
  // Reset IAQ sub-layers (house G1, wifi G3, ring G3) to their base
  // match_status filters and default tinting.
  _setIaqFilter(null);
  _setIaqColor(['get', 'color']);
  if (map.getLayer('survey-points')) map.setFilter('survey-points', null);
  if (map.getLayer('iaq-highlighted'))
    map.setFilter('iaq-highlighted', ['==', ['get', 'street_name'], '__none__']);
  if (map.getSource('iaq-street-line-source'))
    map.getSource('iaq-street-line-source').setData({ type: 'FeatureCollection', features: [] });
  currentIAQFilter = null;
  currentContactFilter = null;
  activeStreetHighlight = null;
  // Clear the legend status filter so chatbot actions are not silently scoped
  // to whatever the user had checked in the status legend.
  if (activeFilters.size) {
    activeFilters.clear();
    if (typeof updateStatusRowHighlights === 'function') updateStatusRowHighlights();
    if (map.getLayer('survey-points')) map.setFilter('survey-points', null);
    if (map.getLayer('survey-labels')) map.setFilter('survey-labels', null);
  }
}

async function executeMapActions(actions) {
  if (!actions || !actions.length) return;
  // Snapshot every user-controlled layer before clearing so we can restore
  // them after chatbot actions complete. clearMapForChatbot() hides everything;
  // the chatbot actions then selectively re-enable what they need.
  const _layerSnap = {};
  for (const name of Object.keys(LAYER_DEFS)) {
    const def = LAYER_DEFS[name];
    const probeId = Array.isArray(def) ? def[0] : def;
    try {
      _layerSnap[name] = map.getLayer(probeId) &&
        map.getLayoutProperty(probeId, 'visibility') !== 'none';
    } catch { _layerSnap[name] = false; }
  }
  clearMapForChatbot();
  // Restore all layers the user had on before the chatbot took over.
  for (const [name, wasOn] of Object.entries(_layerSnap)) {
    if (wasOn) setLayerVisibility(name, true);
  }
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
        _setIaqFilter(combined);
        setLayerVisibility('iaq_points', true);
        break;
      }

      case 'show_iaq_choropleth': {
        const valid = ['overall_risk', 'iaq_score', 'health_score', 'struct_score'];
        const f = valid.includes(params.field) ? params.field : 'overall_risk';
        _setIaqColor(['interpolate', ['linear'], ['get', f],
          0, '#10b981', 33, '#10b981', 34, '#f97316', 66, '#f97316', 67, '#ef4444', 100, '#ef4444']);
        setLayerVisibility('iaq_points', true);
        break;
      }

      case 'clear_filters':
        if (map.getLayer('iaq-points')) {
          _setIaqFilter(null);
          _setIaqColor(['get', 'color']);
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
    _setIaqVisibility(true);
    _setIaqFilter(null);
    _setIaqColor(['get', 'color']);
  }
  // Hide contact survey points so only the IAQ filter layer shows
  _hideContactLayers();

  const activeLayers = {
    iaq_points:  () => { /* show all IAQ points — already cleared filter above */ },
    respiratory: () => filterIAQPoints('respiratory_ill', ['weekly', 'month', 'season']),
    asthma:      () => filterIAQPoints('asthma_freq',    ['weekly', 'month', 'season']),
    mold:        () => _setIaqFilter(['==', ['get', 'has_mold'], true]),
    high_risk:   () => _setIaqFilter(['>=', ['get', 'overall_risk'], 67]),
    owners_only: () => _setIaqFilter(['==', ['get', 'ownership'], 'Owner']),
    renters_only:() => _setIaqFilter(['==', ['get', 'ownership'], 'Renter']),
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

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15_000);
  try {
    for (const name of candidates) {
      const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // Strategy 1: exact case-insensitive match
      const exactQuery = `[out:json][timeout:12];way["name"~"^${esc}$",i]["highway"](${bbox});out geom;`;
      const r1 = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(exactQuery),
        signal: controller.signal,
      });
      if (r1.ok) {
        const d1 = await r1.json();
        const feats = _toFeatures(d1.elements, streetName);
        if (feats.length) { console.log(`[OSM] matched "${name}" (exact)`); clearTimeout(timeoutId); return feats; }
      }
    }

    // Strategy 2: partial match on first word (e.g. "Harvard" inside "Harvard Avenue")
    const firstWord = streetName.split(/\s+/)[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const partialQuery = `[out:json][timeout:12];way["name"~"${firstWord}","i"]["highway"](${bbox});out geom;`;
    const r2 = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'data=' + encodeURIComponent(partialQuery),
      signal: controller.signal,
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
        clearTimeout(timeoutId);
        return _toFeatures(filtered, streetName);
      }
    }

    console.warn(`[OSM] No road geometry found for "${streetName}"`);
    clearTimeout(timeoutId);
    return [];
  } catch (e) {
    clearTimeout(timeoutId);
    if (e.name === 'AbortError') {
      console.warn('[OSM] Road fetch timed out for', streetName);
    } else {
      console.warn('[OSM] Road fetch failed for', streetName, ':', e.message);
    }
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
    _setIaqFilter(streetFilter);
    _setIaqVisibility(true);
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
      // iaq-highlighted is now a circle layer (was a diamond symbol in
      // the v3 design; reverted because the new house+wifi shapes are
      // wrapped equally well by a generic circular halo).
      map.setPaintProperty('iaq-highlighted', 'circle-color', lineColor);
      map.setPaintProperty('iaq-highlighted', 'circle-stroke-color', '#ffffff');
      map.setLayoutProperty('iaq-highlighted', 'visibility', 'visible');
      console.warn(`[highlightStreets] OSM returned no geometry for ${names.join(', ')}; highlighting IAQ points on that street instead`);
      showToast(`Street line not available from map data — showing survey points on ${names.join(', ')} instead`, 5000);
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
      _setIaqFilter(streetOnly);
    } else {
      _setIaqFilter(null);
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
  _setIaqFilter(finalFilter);
  _setIaqVisibility(true);
}

function showStreetChoropleth(field) {
  if (!map.getLayer('iaq-points')) return;
  // Always snapshot and hide contact layer before showing choropleth so that
  // _restoreContactLayers() has a fresh, accurate _contactWasVisible flag.
  _hideContactLayers();
  const rampExpr = (f) => ['interpolate', ['linear'], ['get', f],
    0, '#10b981', 33, '#10b981', 34, '#f97316', 66, '#f97316', 67, '#ef4444', 100, '#ef4444'];
  const valid = ['overall_risk', 'health_score', 'iaq_score', 'struct_score'];
  _setIaqColor(valid.includes(field) ? rampExpr(field) : ['get', 'color']);
  _setIaqVisibility(true);
}

function clearIAQHighlights() {
  if (map.getLayer('iaq-points')) {
    _setIaqFilter(null);
    _setIaqColor(['get', 'color']);
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
    // Phase 1 gated /api/chat behind require_team_member; this fetch must
    // forward the Supabase JWT or the server replies 401 and the bubble
    // renders "undefined". Anon viewers will get a friendly toast instead.
    const session = (sbClient && sbClient.auth)
      ? (await sbClient.auth.getSession()).data?.session
      : null;
    if (!session?.access_token) {
      removeTyping(typingId);
      appendChatBubble('assistant', 'Sign in as a team member to use the AI chat.');
      chatInFlight = false;
      sendBtn.disabled = false;
      return;
    }
    const res  = await fetch('/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ message, history: chatHistory.slice(-8), map_state: getCurrentMapState() }),
    });
    const data = await res.json().catch(() => ({}));
    removeTyping(typingId);
    // Surface the real server error instead of a generic toast so the
    // PI can tell whether it was 401 (missing auth / not a team
    // member), 502 (Groq itself failing — usually GROQ_API_KEY missing
    // or wrong), 413 (message too long), etc.
    if (!res.ok) {
      const detail = data?.error || data?.detail || `HTTP ${res.status}`;
      const hint = res.status === 401
        ? ' — sign in as a team member.'
        : res.status === 502
          ? ' — check GROQ_API_KEY in Vercel project settings.'
          : '';
      appendChatBubble('assistant', `AI chat failed: ${String(detail)}${hint}`);
      return;
    }

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

    // await so chatInFlight stays true through all OSM fetches inside
    // executeMapActions — prevents a second message from slipping through
    // while async map actions are still in flight.
    if (map_actions && map_actions.length) await executeMapActions(map_actions);
    appendChatBubble('assistant', text, map_actions);
    chatHistory.push({ role: 'assistant', content: text });
    if (chatHistory.length > 20) chatHistory = chatHistory.slice(-16);
  } catch (e) {
    removeTyping(typingId);
    // Network-level failure (server unreachable, CORS, etc.). Show the
    // raw error so production debugging works without DevTools.
    appendChatBubble('assistant', `AI chat network error: ${escapeHtml(e?.message || String(e))}`);
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
  // HTML-escape FIRST so any <script> or attribute injection from the LLM
  // (or chat history that was stored unescaped) becomes inert. Then re-introduce
  // only the markdown markup we actually want.
  const safe = String(text).replace(/[&<>"']/g, c =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let html = safe
    // Tables (header | divider | rows) — operates on already-escaped text.
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

// ── Team modal + user menu (Phase 1 admin UI) ───────────────────────────────
let _myRole = null;

function initUserMenu(user) {
  const menu = document.getElementById('user-menu');
  if (!menu) return;
  const email = user.email || 'unknown';
  const name  = user.user_metadata?.full_name || email.split('@')[0];
  const initials = (name || '?').split(/\s+/).map(s => s[0]).filter(Boolean).join('').slice(0, 2).toUpperCase() || '??';
  document.getElementById('user-menu-initials').textContent = initials;
  document.getElementById('user-menu-label').textContent    = name;
  document.getElementById('user-menu-email').textContent    = email;
  menu.style.display = '';

  const btn = document.getElementById('btn-user-menu');
  const pop = document.getElementById('user-menu-pop');
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    pop.style.display = pop.style.display === 'none' ? '' : 'none';
  });
  document.addEventListener('click', (e) => {
    if (!menu.contains(e.target)) pop.style.display = 'none';
  });
  document.getElementById('btn-signout').addEventListener('click', async () => {
    try { await sbClient?.auth.signOut(); } catch {}
    window.location.replace('/login');
  });

  // Resolve role and update the chip + gate the Team button.
  refreshMyRole();
}

async function refreshMyRole() {
  if (!sbClient) { applyRoleGatedUI(); return; }
  try {
    const { data, error } = await sbClient.rpc('my_team_role');
    if (error) return;
    _myRole = (data && data.role) || null;
    const roleEl = document.getElementById('user-menu-role');
    if (roleEl) {
      roleEl.textContent = _myRole || 'no role yet';
      roleEl.style.color = _myRole === 'admin' ? 'var(--accent)' : 'var(--muted)';
    }
    applyRoleGatedUI();
  } catch {}
}

// Show / hide UI controls based on the current user's role. Anon viewers
// (no Supabase session at all) see the dashboard read-only — no Team /
// Update Data / Daily Refresh / AI Chat buttons. Members see Team
// (read-only roster) but no upload/refresh/chat. Admins see everything.
// Server-side enforcement still owns the security boundary; this is UX
// only so non-privileged users don't click into a guaranteed-401 modal.
function applyRoleGatedUI() {
  const isAdmin  = _myRole === 'admin';
  const isMember = _myRole === 'admin' || _myRole === 'member';
  const setVis = (id, show) => {
    const el = document.getElementById(id);
    if (el) el.style.display = show ? '' : 'none';
  };
  setVis('btn-team',          isMember);
  setVis('btn-import',        isAdmin);
  setVis('btn-daily-refresh', isAdmin);
  // AI chat panel + floating button: team-member only (matches /api/chat
  // require_team_member). Anon viewers still see all the data; just no
  // chat panel button to give them a 401 surprise.
  setVis('chat-btn',          isMember);
  // Restore-version buttons inside the History modal are rebuilt every
  // time the modal opens — openHistoryModal() reads _myRole and only
  // renders restore controls for admins. Nothing to toggle here.
}

function _esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function _teamMsg(text, kind) {
  const el = document.getElementById('team-msg');
  if (!el) return;
  if (!text) { el.style.display = 'none'; return; }
  el.textContent = text;
  el.style.display = '';
  el.style.background = kind === 'err' ? 'rgba(239,68,68,.1)' : 'rgba(52,211,153,.1)';
  el.style.color      = kind === 'err' ? '#ef4444' : '#34d399';
  el.style.border     = kind === 'err' ? '1px solid rgba(239,68,68,.25)' : '1px solid rgba(52,211,153,.25)';
}

function initTeamModal() {
  const overlay = document.getElementById('team-modal');
  const openBtn = document.getElementById('btn-team');
  const close   = document.getElementById('team-modal-close');
  if (!overlay || !openBtn) return;

  openBtn.addEventListener('click', async () => {
    if (!sbClient) { alert('Sign in first.'); return; }
    if (_myRole === null) await refreshMyRole();
    const isAdmin = _myRole === 'admin';
    document.getElementById('team-code-row').style.display          = isAdmin ? 'flex' : 'none';
    document.getElementById('guest-sessions-section').style.display = isAdmin ? '' : 'none';
    document.getElementById('team-modal-sub').textContent = isAdmin
      ? "Generate today's invite code for new surveyors. Promote teammates to admin."
      : 'Roster of your team. Ask an admin if you need an invite code or role change.';
    // Show the "make admin by email" form only for admins.
    const promoteRow = document.getElementById('team-promote-row');
    if (promoteRow) promoteRow.style.display = isAdmin ? 'flex' : 'none';
    overlay.classList.add('show');
    overlay.style.display = 'flex';
    _teamMsg('');
    loadTeamRoster();
    if (isAdmin) loadGuestSessionsForToday();
  });

  close.addEventListener('click', () => {
    overlay.classList.remove('show');
    overlay.style.display = 'none';
  });
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      overlay.classList.remove('show');
      overlay.style.display = 'none';
    }
  });

  document.getElementById('team-btn-code').addEventListener('click', getTodayInviteCode);
  document.getElementById('team-btn-refresh-guests').addEventListener('click', loadGuestSessionsForToday);
  document.getElementById('team-btn-promote-email').addEventListener('click', promoteByEmailFromInput);
  document.getElementById('team-promote-email').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); promoteByEmailFromInput(); }
  });
}

async function promoteByEmailFromInput() {
  const input = document.getElementById('team-promote-email');
  const btn   = document.getElementById('team-btn-promote-email');
  const email = (input.value || '').trim().toLowerCase();
  if (!email || !email.includes('@')) {
    _teamMsg('Enter a valid email.', 'err');
    return;
  }
  btn.disabled = true; btn.textContent = 'Promoting…';
  try {
    const { data, error } = await sbClient.rpc('promote_by_email', { p_email: email });
    if (error) throw error;
    if (!data?.ok) throw new Error(data?.error || 'Promote failed');
    if (data.already) {
      _teamMsg(`${email} is already an admin.`, 'ok');
    } else if (data.created) {
      _teamMsg(`${email} added as admin (skipped invite-code claim).`, 'ok');
    } else {
      _teamMsg(`${email} promoted to admin.`, 'ok');
    }
    input.value = '';
    await loadTeamRoster();
  } catch (e) {
    _teamMsg(e.message || 'Promote failed.', 'err');
  } finally {
    btn.disabled = false; btn.textContent = 'Make admin';
  }
}

async function loadTeamRoster() {
  const list = document.getElementById('team-list');
  if (!sbClient) return;
  try {
    // Admins see ALL signed-up users (whether or not they've claimed
    // today's invite code) via list_all_signups, so they can promote
    // anyone with one click. Members fall back to the team-only roster.
    let members = [];
    if (_myRole === 'admin') {
      const { data, error } = await sbClient.rpc('list_all_signups');
      if (error) throw error;
      members = data || [];
    } else {
      const { data, error } = await sbClient.rpc('list_team');
      if (error) throw error;
      members = data || [];
    }
    if (!members.length) {
      list.innerHTML = '<div style="font-size:12px;color:var(--muted)">No users yet.</div>';
      return;
    }
    const myUid = currentUserId;

    const rowsHtml = members.map(m => {
      const isMe    = m.id === myUid;
      const isAdmin = m.role === 'admin';
      const isMember = m.role === 'member';
      let tag;
      if (isAdmin) {
        tag = '<span style="font-size:10px;font-weight:700;padding:2px 7px;border-radius:5px;font-family:\'IBM Plex Mono\',monospace;background:rgba(56,189,248,.15);color:var(--accent);border:1px solid rgba(56,189,248,.28)">ADMIN</span>';
      } else if (isMember) {
        tag = '<span style="font-size:10px;font-weight:700;padding:2px 7px;border-radius:5px;font-family:\'IBM Plex Mono\',monospace;background:rgba(139,148,158,.15);color:var(--muted);border:1px solid var(--border)">MEMBER</span>';
      } else {
        tag = '<span style="font-size:10px;font-weight:700;padding:2px 7px;border-radius:5px;font-family:\'IBM Plex Mono\',monospace;background:rgba(245,158,11,.12);color:#f59e0b;border:1px solid rgba(245,158,11,.28)" title="Signed up but has not yet claimed today\'s invite code">NOT JOINED</span>';
      }
      // Admin actions: promote anyone who isn't already admin (members
      // and not-joined users alike). Demote only existing admins.
      const promote = (_myRole === 'admin' && !isAdmin)
        ? `<button class="btn btn-sm" onclick="dashboardPromoteByEmail('${_esc(m.email)}')" style="font-size:11px;padding:4px 10px">Make admin</button>` : '';
      const demote  = (_myRole === 'admin' && isAdmin && !isMe)
        ? `<button class="btn btn-sm" onclick="dashboardDemote('${_esc(m.id)}')" style="font-size:11px;padding:4px 10px;background:rgba(239,68,68,.1);color:#ef4444;border:1px solid rgba(239,68,68,.25)">Demote</button>` : '';
      return `
        <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--border);border-radius:9px;background:var(--panel-2,#0d1117)">
          <div style="flex:1;font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_esc(m.email)}${isMe ? ' <span style="color:var(--muted);font-weight:400">(you)</span>' : ''}</div>
          ${tag}
          ${promote}${demote}
        </div>`;
    }).join('');

    list.innerHTML = rowsHtml;
  } catch (e) {
    list.innerHTML = `<div style="font-size:12px;color:#ef4444">Failed to load: ${_esc(e.message || e)}</div>`;
  }
}
window.loadTeamRoster = loadTeamRoster;

// Single-click promote-by-email path used by the team roster row buttons.
// Routes through promote_by_email so we don't need to know the target's
// team_members status (admin / member / not joined yet) — the RPC handles
// all three cases uniformly.
async function dashboardPromoteByEmail(email) {
  if (!confirm(`Make ${email} an admin?`)) return;
  try {
    const { data, error } = await sbClient.rpc('promote_by_email', { p_email: email });
    if (error) throw error;
    if (!data?.ok) throw new Error(data?.error || 'Promote failed');
    if (data.already)      _teamMsg(`${email} is already an admin.`, 'ok');
    else if (data.created) _teamMsg(`${email} added as admin (skipped invite-code claim).`, 'ok');
    else                   _teamMsg(`${email} promoted to admin.`, 'ok');
    await loadTeamRoster();
  } catch (e) {
    _teamMsg(e.message || 'Promote failed.', 'err');
  }
}
window.dashboardPromoteByEmail = dashboardPromoteByEmail;

async function getTodayInviteCode() {
  const btn  = document.getElementById('team-btn-code');
  const out  = document.getElementById('team-code-display');
  const meta = document.getElementById('team-code-meta');
  if (!sbClient) return;
  btn.disabled = true; btn.textContent = 'Generating…';
  try {
    const { data, error } = await sbClient.rpc('get_or_create_today_code');
    if (error) throw error;
    if (!data?.ok) throw new Error(data?.error || 'Failed to get code');
    out.textContent = data.code;
    meta.textContent = `for ${data.date} (UTC) · share verbally`;
    _teamMsg('Code copied to clipboard', 'ok');
    try { await navigator.clipboard.writeText(data.code); } catch {}
  } catch (e) {
    _teamMsg(e.message || 'Failed to get code', 'err');
  } finally {
    btn.disabled = false; btn.textContent = "Get today's code";
  }
}

async function dashboardPromote(uid) {
  if (!confirm('Promote this user to admin? They gain full upload + delete + team-management privileges.')) return;
  try {
    const { data, error } = await sbClient.rpc('promote_member', { p_target: uid });
    if (error) throw error;
    if (!data?.ok) throw new Error(data?.error || 'Promote failed');
    _teamMsg('User promoted to admin', 'ok');
    await loadTeamRoster();
  } catch (e) { _teamMsg(e.message || 'Promote failed', 'err'); }
}

async function dashboardDemote(uid) {
  if (!confirm('Demote this admin to member?')) return;
  try {
    const { data, error } = await sbClient.rpc('demote_member', { p_target: uid });
    if (error) throw error;
    if (!data?.ok) throw new Error(data?.error || 'Demote failed');
    _teamMsg('User demoted to member', 'ok');
    await loadTeamRoster();
  } catch (e) { _teamMsg(e.message || 'Demote failed', 'err'); }
}

async function loadGuestSessionsForToday() {
  const list = document.getElementById('guest-list');
  if (!sbClient || _myRole !== 'admin') return;
  list.innerHTML = '<div style="font-size:12px;color:var(--muted)">Loading…</div>';
  try {
    const today = new Date().toISOString().slice(0, 10);
    const { data, error } = await sbClient.rpc('list_guest_sessions', { p_date: today });
    if (error) throw error;
    const sessions = data || [];
    if (!sessions.length) {
      list.innerHTML = '<div style="font-size:12px;color:var(--muted)">No guest sessions today.</div>';
      return;
    }
    list.innerHTML = sessions.map(g => {
      const revoked = !!g.revoked_at;
      const expired = g.expires_at && new Date(g.expires_at) < new Date();
      const status  = revoked ? 'revoked' : (expired ? 'expired' : 'active');
      const color   = revoked ? '#ef4444' : (expired ? '#9ca3af' : '#34d399');
      const isLive  = status === 'active';
      const revokeBtn = isLive
        ? `<button class="btn btn-sm" onclick="dashboardRevokeGuest('${_esc(g.id)}')" style="font-size:11px;padding:4px 10px;background:rgba(239,68,68,.1);color:#ef4444;border:1px solid rgba(239,68,68,.25)">Revoke</button>` : '';
      return `
        <div style="display:flex;align-items:center;gap:10px;padding:8px 12px;border:1px solid var(--border);border-radius:8px">
          <div style="flex:1;font-size:13px;font-weight:600">${_esc(g.name)}</div>
          <span style="font-size:10px;font-weight:700;padding:2px 7px;border-radius:5px;font-family:'IBM Plex Mono',monospace;background:${color}22;color:${color};border:1px solid ${color}44">${status}</span>
          <span style="font-size:11px;color:var(--muted)">${g.point_count ?? 0} pin(s)</span>
          ${revokeBtn}
        </div>`;
    }).join('');
  } catch (e) {
    list.innerHTML = `<div style="font-size:12px;color:#ef4444">Failed: ${_esc(e.message || e)}</div>`;
  }
}

async function dashboardRevokeGuest(sid) {
  if (!confirm('Revoke this guest session? Their next save attempt will fail.')) return;
  try {
    const { data, error } = await sbClient.rpc('revoke_guest_session', { p_session: sid });
    if (error) throw error;
    if (!data?.ok) throw new Error(data?.error || 'Revoke failed');
    _teamMsg('Guest session revoked', 'ok');
    await loadGuestSessionsForToday();
  } catch (e) { _teamMsg(e.message || 'Revoke failed', 'err'); }
}

// Expose handlers used in inline onclick.
window.dashboardPromote     = dashboardPromote;
window.dashboardDemote      = dashboardDemote;
window.dashboardRevokeGuest = dashboardRevokeGuest;

// ── Init ────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  setupUI();
  initMap();
  initResizeHandles();
});
