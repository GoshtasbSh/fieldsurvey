# app.py ↔ api/* Parity Audit

The PI accesses the dashboard only via Vercel. Local `app.py` and the Vercel
serverless functions in `api/` must produce **identical outputs**. This file
records each function pair and whether they match.

| Concern | Local (`app.py`) | Vercel (`api/`) | Status |
|---|---|---|---|
| Qualtric CSV ingestion | `_read_qualtric_csv` + `process_iaq_survey` | `_read_qualtric_csv` in `api/_processing.py` + `process_iaq_bytes` | ✓ identical helper, same encodings, same two-row-header auto-detect |
| Health score | `_compute_health_score` | `_compute_health_score` (`api/_processing.py`) | ✓ identical formula |
| IAQ score | `_compute_iaq_score` | `_compute_iaq_score` | ✓ identical (incl. `\xa0` no-break-space normalization) |
| Structural score | `_compute_struct_score` | `_compute_struct_score` | ✓ identical |
| Risk weighting | 0.35·health + 0.35·iaq + 0.30·struct | 0.35·health + 0.35·iaq + 0.30·struct | ✓ identical |
| Risk tiers | <34 Low / <67 Medium / ≥67 High | same | ✓ identical |
| GPS bbox check | `KH_LAT_MIN/MAX`, `KH_LON_MIN/MAX` | same constants | ✓ identical |
| Parcel snap (GPS) | radius **80 m** | radius **80 m** ([_processing.py:768](api/_processing.py#L768)) | ✓ identical |
| Parcel snap (default) | 150 m | 150 m ([_processing.py:131](api/_processing.py#L131)) | ✓ identical |
| Address match | `_address_match` via `contact_lookup` | same | ✓ identical |
| Census fallback | `_census_geocode` | `_census_geocode` | ✓ identical (12 s timeout) |
| IAQ ↔ Contact match | `_match_iaq_to_contacts` (50 m) | `_match_iaq_to_contacts(threshold_m=50)` ([_processing.py:432](api/_processing.py#L432)) | ✓ identical 50 m threshold |
| Contact upgrade | `_upgrade_contacts_from_iaq` | `_upgrade_contacts_from_iaq` | ✓ identical (sets `status=Completed`, `has_iaq_survey=True`) |
| Field-survey IAQ apply | `_apply_iaq_to_field_features` | `_apply_iaq_to_field_features` | ✓ identical |
| PII strip | drop `PII_COLS`, drop `raw_address` before persist | same | ✓ identical |
| Community contact ingest | `process_survey` (Excel/CSV) | `process_survey_bytes` | ✓ identical signatures |
| Contact analysis | `compute_analysis` | `compute_contact_analysis` | ✓ identical shape (parcel stats omitted Vercel-side; loaded by browser) |
| Street stats | `_compute_street_stats` | `_compute_street_stats` | ✓ identical |
| Storage | Supabase `keystone_dashboard_data` | same table | ✓ identical |
| Versioning | Supabase `keystone_analysis_versions` | same table | ✓ identical |
| Daily refresh | Manual `_refresh_data()` on startup | `/api/daily-refresh` cron 06:00 UTC | ✓ same logic, scheduled |
| Field-survey version row on IAQ upload | n/a (no field merge in app.py) | inserted in [iaq.py](api/upload/iaq.py) | ➕ Vercel-only enhancement |

## Where Vercel intentionally differs

- **Field-survey table writes**: `api/upload/iaq.py` writes back `status='Completed'` to Supabase `field_survey_points` for every matched live point. `app.py` does not, because field points are not part of the local-only flow (the PI's local instance never collected real-time field surveys).
- **Structured logs**: Vercel functions emit `print(...)` lines for runtime observability via `vercel logs`. `app.py` uses `log.info(...)`.
- **Active CPU pricing on Vercel**: `iaq.py` is configured with `maxDuration: 300s` ([vercel.json:9](vercel.json#L9)); CSV reads, parcel-index build, and STRtree queries all run within that envelope.

## How to re-verify after any future change

1. Run `python -c "import app, api._processing"` — both modules import.
2. Hash the score functions: `git diff app.py api/_processing.py -- '*_compute_*'` should remain ✅ semantically identical.
3. Upload the same Qualtric CSV to local `/api/upload/iaq` (uvicorn) and to Vercel preview, then `diff <(curl local | jq .features | jq -S) <(curl vercel | jq .features | jq -S)` — should be empty.
