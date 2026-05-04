# Pre-Deploy Review — Status

**Branch:** main · **Date:** 2026-05-04 · **Working tree:** uncommitted

Two review sessions have now run. Session 1 ran the baseline review (7 original bugs + security hardening).
Session 2 ran the full multi-agent deep review: click-path audit (desktop + mobile), Python backend parity, and new bug discovery.

---

## ✅ Fixed in Session 1

| Bug | File | Status |
|---|---|---|
| BUG-1 — daily-refresh wrote to dead `data_type='survey_points'` | api/daily-refresh.py | ✅ |
| BUG-2 — local app didn't reload contacts from Supabase before IAQ upload | app.py | ✅ |
| BUG-3 — local app had no field-point upgrade after IAQ | app.py | ✅ |
| BUG-4 — Vercel iaq.py silently degraded to spatial-only when contacts missing | api/upload/iaq.py | ✅ |
| BUG-5 — `field_survey_points` truncated at 5000 (silent data loss) | dashboard.js, index.html | ✅ |
| BUG-6 — missing Qualtrics columns silently scored 0 | api/_processing.py, app.py | ✅ |
| BUG-7 — no auto-refresh after upload | dashboard.js | ✅ |
| Security: restore.py unauthenticated | api/versions/restore.py | ✅ |
| Security: upload endpoints unauthenticated | api/upload/*.py | ✅ |
| Security: daily-refresh CRON_SECRET fail-open | api/daily-refresh.py | ✅ |
| Security: no Content-Length cap (DoS) | api/_lib.py | ✅ |
| Security: debug.py leaked URL | api/debug.py | ✅ |
| Click-path: offline queue collector_id re-stamped at sync time | keystone_field_web/index.html | ✅ |
| XSS: chat attachment URL → safeUrl() + escapeHtml() | dashboard.js | ✅ |
| XSS: LLM markdown → HTML-escape-first in renderMarkdown() | dashboard.js | ✅ |
| XSS: CSV street names in streetsTable → escapeHtml() | dashboard.js | ✅ |
| XSS: version label injection → DOM API (textContent + addEventListener) | dashboard.js | ✅ |
| Admin: saveEmail upsert created duplicate rows | keystone_field_web/admin.html | ✅ |
| Chat: sendTeamMessage silently no-ops when not signed in | dashboard.js | ✅ |

---

## ✅ Fixed in Session 2

### Click-path bugs — Desktop Dashboard

| ID | Severity | Issue | Fix |
|---|---|---|---|
| CP-D01 | CRITICAL | `layer-field-points` checkbox not wired in `setupLayerToggles()` — field points permanently visible, cannot be toggled | Added to `toggles` map in `setupLayerToggles()` |
| CP-D02 | CRITICAL | `layer-iaq-highlighted` toggle only hid circle layer, left `iaq-street-line` + `iaq-street-line-core` visible | Added all 3 layers to `toggles` map |
| CP-D03 | HIGH | `restoreVersion()` closed modal then immediately re-opened it (jarring UX) | Replaced with `showToast()` |
| CP-D04 | HIGH | `runDailyRefresh()` always opened history modal after run (user never asked) | Now only reopens if modal was already open |
| CP-D05 | HIGH | `clearMapForChatbot()` never cleared `activeFilters` — legend status filter silently persisted through all chatbot actions | `activeFilters.clear()` + `updateStatusRowHighlights()` + filter reset added |
| CP-D10 | MEDIUM | `refreshAllData()` rebuilt legend but dropped status-row opacity dimming | `updateStatusRowHighlights()` called after `buildLegend()` |
| DS-BUG | MEDIUM | `renderDataSummary()` showed permanent `…` when `sbClient` null at modal open time | Shows `—` (unavailable) when Supabase not ready |

### Click-path bugs — Mobile Field App

| ID | Severity | Issue | Fix |
|---|---|---|---|
| CP-M02 | CRITICAL | Double-tap "Save" within 750 ms window created duplicate DB row (button re-enabled before sheet closed) | `bsCoords = null` immediately after save blocks re-entry |
| CP-M06 | HIGH | Realtime DELETE while user mid-edit: update silently no-ops in DB, then `_allFieldPoints[0]` fallback corrupts unrelated point's map feature | Sheet now closes with warning toast; index-0 fallback removed |
| CP-M13 | MEDIUM | `_allFieldPoints[i >= 0 ? i : 0]` corrupted unrelated point when edited point removed concurrently | Guard replaced with `if (i >= 0) replacePointOnMap(...)` |
| CP-M05 | HIGH | Realtime UPDATE ignored `_editPointId` guard — teammate update could overwrite user's open edit | `if (p.id === _editPointId) return` added to UPDATE handler |
| CP-M16 | MEDIUM | Realtime DELETE/UPDATE of own point did not call `recalcCounts` — sidebar counters went stale | `recalcCounts(_allFieldPoints)` added to both handlers |

### Python Backend

| ID | Severity | Issue | Fix |
|---|---|---|---|
| PY-01 | MEDIUM | `daily-refresh.py` field features had no `street_name` — all cron-added points appeared in "Unknown" street bucket | Added `street_name: "Field Survey"` |
| PY-02 | HIGH | `daily-refresh.py` unpaginated field_survey_points query — silent 1000-row PostgREST cap | Full PAGE/HARD_CAP pagination loop added |
| PY-03 | MEDIUM | `restore.py` didn't update `analysis` blob after restoring community contacts — stale analysis tab | `compute_contact_analysis()` called and upserted after restore |
| PY-04 | HIGH | `app.py` `_compute_iaq_score()` used literal `\xa0` for Cooling System columns while `_processing.py` normalizes first — IAQ score divergence | Fixed: normalize via `{k.replace('\xa0',' '): v}` dict, matching Vercel |
| PY-05 | MEDIUM | `app.py` q212 only stripped whitespace; `_processing.py` collapses all whitespace and also skips "Read to respondent" | Fixed: `' '.join(str(q212).split())` + `'read to respondent'` exclusion |
| PY-06 | HIGH | `process_survey_bytes` used `row['First attempt']` subscript — `KeyError` if column absent in CSV | Changed to `row.get('First attempt', '') or ''` |
| PY-09 | LOW | `_field_row_to_feature()` did not guard NULL lat/lon — could write `[None, None]` into GeoJSON geometry | Added early `return None` + filtered None from new_features list |
| PY-DR | NEW | `daily-refresh.py` didn't update `analysis` blob after field point merge — Analysis tab showed stale stats | `_compute_analysis()` inline function added and called after merge |
| PY-RES | LOW | `api/upload/results.py` missing outer UNCAUGHT exception handler | `do_POST` → try/except delegating to `_handle()` |

---

## ✅ Fixed in Session 3

### Click-path — Mobile Field App

| ID | Severity | Issue | Fix |
|---|---|---|---|
| CP-M01 | CRITICAL | FAB called `enterPlaceMode()` — GPS-first flow was dead code | Changed FAB handler to call `tryGPSFirst()` |
| CP-M03/04 | HIGH | `_activePopupPointId` stale closure — fast double-tap targeted wrong point | Enforce single-popup invariant (close existing popup first); pass `p.id` directly into `onclick` attrs |
| CP-M07 | HIGH | Offline queue sync left ghost `q…` dot until page reload | After successful sync: swap `_allFieldPoints[qi].id` and call `src.setData(pointsToGeoJSON(...))` |
| CP-M08 | HIGH | `ks-queue` localStorage key shared across users on same browser | Added `_qKey()` → `'ks-queue-' + (currentUser?.id \|\| 'anon')`; all 5 usages updated |
| CP-M09 | HIGH | `appendPointToMap/replacePointOnMap/removePointFromMap` used private `src._data` | All three rewritten to derive GeoJSON from `_allFieldPoints` via `pointsToGeoJSON()` |
| CP-M10 | MEDIUM | Reverse-geocode race on rapid open/close overwrote current address | Added `_geocodeAbort` AbortController; stale responses silently dropped |
| CP-M12 | MEDIUM | Permanent sync failure didn't call `recalcCounts` — sidebar inflated | `recalcCounts(_allFieldPoints)` called at end of `syncQueue()`; toast message improved |
| CP-M14 | MEDIUM | `saveEmail()` UPDATE-then-INSERT: INSERT failure left zero active email config | Flipped to INSERT-first then deactivate old rows (`neq('id', newRow.id)`) |
| CP-M15 | MEDIUM | Admin upload zone had no concurrency guard | Added `_uploading` boolean; file inputs disabled during upload; released in `finally` |

### Click-path — Desktop Dashboard

| ID | Severity | Issue | Fix |
|---|---|---|---|
| CP-D06 | HIGH | `showStreetChoropleth` had stale `_contactWasVisible` flag | Added `_hideContactLayers()` call at start of `showStreetChoropleth()` |
| CP-D07 | HIGH | Heatmap source orphaned after basemap switch with active filter | Added `'survey-heat-filtered'` to source list; `applyFilters()` + `applyHeatmapClusterFilter()` called after basemap swap; removed dead `savedSources`/`dataSrcIds`/`savedLayers` variables |
| CP-D09 | MEDIUM | `chatInFlight` reset before OSM fetches in `executeMapActions` finished | Changed to `await executeMapActions(map_actions)` |
| CP-D11 | MEDIUM | `clearMapForChatbot` wiped IAQ risk overlay permanently | Save `iaqRiskWasOn` before clear; restore immediately after in `executeMapActions` |
| CP-D12 | MEDIUM | `iaq-highlighted` initialized `visibility:'visible'` | Changed to `visibility:'none'` |
| CP-D13 | LOW | `refreshAllData()` left stale chatbot IAQ filter on fresh data | Added `if (currentIAQFilter) clearIAQHighlights()` after `buildAnalysis()` |

### Python Backend

| ID | Severity | Issue | Fix |
|---|---|---|---|
| PY-07 | MEDIUM | `_sync_community_contacts()` DELETE-then-INSERT — partial failure emptied contacts table | Flipped to insert-first: INSERT all rows, collect IDs, then `DELETE WHERE id NOT IN (inserted_ids)` |

### Design notes (no code change)

| ID | Notes |
|---|---|
| PY-08 | Two IAQ responses from same household may match different contacts — data-model design decision, not a code bug |

---

## 🚦 Pre-Deploy Gate — Updated Checklist

- [ ] **Set `CRON_SECRET`** in Vercel project settings before next prod deploy
- [ ] **Run `python scripts/verify_parity.py`** — confirm local/Vercel parity holds
- [ ] **Two-surveyor real-time test**: two browsers as different users — add, edit, delete, watch both sides sync in real time
- [ ] **RLS smoke test**: attempt to delete another user's point via DevTools — must return 403
- [ ] **Vercel preview deploy** + smoke-test both upload flows + tail logs for `UNCAUGHT`

---

## Diff summary (Session 2)

```
 api/_processing.py          | fix: row.get('First attempt') — no KeyError
 api/daily-refresh.py        | fix: paginate field_survey_points; street_name; null lat/lon; analysis update
 api/upload/results.py       | fix: outer UNCAUGHT handler
 api/versions/restore.py     | fix: recompute + persist analysis blob on community contact restore
 app.py                      | fix: IAQ score cooling-system normalization; q212 whitespace + exclusion
 keystone_field_web/index.html | fix: double-tap duplicate save; realtime guard + recalcCounts; i>=0 fallback
 static/js/dashboard.js      | fix: field-points + iaq-highlighted toggles; clearMapForChatbot filters; refreshAllData legend; modal UX
 REVIEW_STATUS.md            | updated (this file)
```

## Diff summary (Session 3)

```
 keystone_field_web/index.html | fix: FAB → tryGPSFirst; popup single-invariant + id param; queue-sync ID swap;
                               |      _qKey() user-scoped localStorage; _data→pointsToGeoJSON(); AbortController
                               |      geocode; recalcCounts on sync failure
 keystone_field_web/admin.html | fix: saveEmail INSERT-first; _uploading upload guard
 static/js/dashboard.js       | fix: _hideContactLayers in showStreetChoropleth; heatmap basemap reapply;
                               |      await executeMapActions; iaqRisk save/restore; iaq-highlighted init none;
                               |      clearIAQHighlights on refresh; dead savedSources vars removed
 api/upload/survey.py         | fix: _sync_community_contacts INSERT-first, delete orphans by id
 REVIEW_STATUS.md             | updated (this file)
```

All Python files parse cleanly (`ast.parse`). No test suite to run. Manual smoke testing per Gate checklist is the next step.

---

## Session 4 — Survey-question annotation + new analysis sub-tabs (2026-05-04)

### What changed

The Survey Results tab on the dashboard now (1) shows the source Qualtrics
question under every chart title and (2) has four new sub-tabs covering
14 previously unprocessed survey questions about residency, community
living, occupant well-being, and additional demographics.

### Backend (Python — both `app.py` and `api/_processing.py`)

| Change | Files |
|---|---|
| New `SURVEY_QUESTIONS` constant — 33 fields × `(orig_csv_col_idx, question_text)` | app.py, api/_processing.py |
| New constants `INTERVENTION_HIGHLIGHTS`, `EXPERIENCE_HIGHLIGHTS`, ordered field tuples, and `CHART_SOURCES` (chart_id → caption) | app.py, api/_processing.py |
| New helpers `_val_at_orig_idx`, `_parse_years_numeric`, `_extract_survey_extras` — pull blank/duplicate-header columns by ORIGINAL CSV index from a pre-PII row | app.py, api/_processing.py |
| `process_iaq_survey` / `process_iaq_bytes` keep `df_full` (all 150 cols, PII included) alongside the existing PII-dropped `df` so position-based extraction is robust to PII column shifts | app.py, api/_processing.py |
| Each feature property dict gets the 33 survey-question fields (only used for analysis aggregation; stripped from the persisted geojson before save) | app.py, api/_processing.py |
| `_compute_iaq_analysis` emits 7 new blocks — `residency`, `housing_safety`, `affordability`, `interventions`, `experiences`, `mobility`, `demographics_ext` — plus `survey_questions` and `chart_sources` for the dashboard to render captions | app.py, api/_processing.py |
| **Untouched**: risk-score formulas (health/IAQ/structural), risk tiers, street stats, IAQ↔contact matching, geocoding | — |

### Frontend (`static/js/dashboard.js`, `static/index.html`)

| Change | Where |
|---|---|
| Survey Results sub-tab bar grew 6 → 10: added Residency, Community, Well-being, Demographics+ | `buildSurveyResultsTab()` line ~2860 |
| Every chart title in the existing 6 sub-tabs now has a "Source: …" caption pulled from `analysis.chart_sources` | helper `head(title, srcKey)` injects the muted caption below `<h4>` |
| New panes render real chart aggregations from the new analysis blocks (residency/community/wellbeing/demographics) plus a per-pane subtitle showing the exact Qualtrics question text | `_initResultsCharts()` extended with 4 new branches |
| Two new helpers in the chart-init function: `_binBar` (horizontal bar chart from a `{label: count}` dict) and `_matrixBars` (HTML matrix bars with optional accent-color highlights for flagged items) | dashboard.js |
| New CSS rules: `.chart-source` for source captions, `.matrix-bars`, `.matrix-bars .label.hl`, `.matrix-bars .bar.hl > span` for matrix charts with highlighted rows | static/index.html (Charts section) |

### Highlighted matrix items

- **Resilience interventions (C1)** — 11-item ranked bar chart; "Strengthen
  the roof and walls" and "Connect to city water through CCUA" rendered in
  accent color.
- **Experiences in HRE (C2)** — full-matrix ranked bar chart; the six items
  flagged for priority research focus rendered in accent color: calling
  law enforcement, losing homeowners insurance, well drying up, pests,
  water leaks, loose animals.

### Verification

| Check | Result |
|---|---|
| `python -c "import ast; ast.parse(open('app.py').read())"` | ✅ OK |
| `python -c "import ast; ast.parse(open('api/_processing.py').read())"` | ✅ OK |
| `node --check static/js/dashboard.js` | ✅ OK |
| `python scripts/verify_parity.py --iaq … --contacts …` (local ↔ Vercel) | ✅ **PARITY OK** — 71 features both sides, 0 diffs |
| Live aggregation smoke-test on bundled Qualtrics CSV | 58 respondents have parsed years-in-HRE (mean 11.2 / median 8.0); car-access 59 yes / 11 no; hurricane-transport 7 yes / 55 no / 2 not-sure; education + employment distributions populated; 7 new top-level analysis keys present |
| Risk-score regression | risk-score code path untouched; `_compute_health_score` / `_compute_iaq_score` / `_compute_struct_score` and risk tiers identical pre/post |

### Known caveats

- Several intervention/experience matrix items export from the bundled
  test CSV with placeholder values ("Click to write Scale Point 1",
  "Daily / Weekly" instead of Yes/No). The dashboard renders these as 0%
  on the matrix bars — once the real survey is fielded the heuristics in
  `_pct_want` and `_pct_yes` will populate them automatically; no code
  change needed.
- Mobile-home skirting (R4) is conditional on housing type. The display
  shows the count of respondents who answered with a small breakdown card;
  no respondents in the test CSV have meaningful values yet.
- The truly-blank-header columns (idx 56–59, 133–134) and duplicate
  matrix headers (` _1`…` _11`) are pinned by **original CSV column
  index** and read from a `df_full` snapshot taken before PII drop, so
  pandas's auto-renaming of duplicate headers cannot misroute the data.

### Diff summary

```
 api/_processing.py          | + SURVEY_QUESTIONS, helpers, df_full path,
                             |   7 new analysis blocks, survey-extras strip
 app.py                      | mirror of api/_processing.py changes
 static/index.html           | .chart-source + .matrix-bars CSS
 static/js/dashboard.js      | head() caption helper, 10-tab bar,
                             |   4 new panes, _binBar/_matrixBars helpers,
                             |   4 new chart-init branches
 REVIEW_STATUS.md            | this section
```

