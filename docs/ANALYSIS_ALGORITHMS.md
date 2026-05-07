# KeyStone IAQ Survey — Analysis Algorithms Reference

**Status:** Authoritative. The implementation in `api/_processing.py` and
`api/survey_logic.py` is the single source of truth; this document
describes what those files do and points to the exact lines that
compute every number you see in the dashboard.

**Repo:** `KeyStone_project`
**Generated for:** company / PI handoff. Read this before changing any
score formula, weight, or aggregation.

---

## 1. Pipeline Overview

```
  Qualtrics CSV (numeric or text export)
              │
              ▼
  api/_processing._read_qualtric_csv()
    ├── encoding auto-detection (utf-8-sig → utf-16 → cp1252 → latin-1)
    ├── ImportId metadata row → qid_to_col_idx map
    └── strips question-text + ImportId metadata rows from data frame
              │
              ▼
  api/_processing._is_numeric_recode_export()
    └── samples Headache / QID195_1 / QID124_1 / QID178 columns;
        ≥60% bare-int values → numeric_recode_mode=True
              │
              ▼
  api/_processing._apply_qsf_recode_labels()
    └── translates numeric Qualtrics codes ('1','6',…) into the human
        labels Qualtrics would have produced in a TEXT export, using
        `_QSF_RECODE_LABELS` (QID-keyed) and `_COLNAME_RECODE_LABELS`
        (column-name keyed). After this step BOTH formats look
        identical to all downstream consumers.
              │
              ▼
  per-row scoring loop (api/_processing.process_iaq_bytes)
    ├── _compute_health_score(row)        → 0..100
    ├── _compute_iaq_score(row)           → 0..100
    ├── _compute_struct_score(row)        → 0..100  (api/survey_logic.py)
    ├── overall_risk = round(0.35*H + 0.35*I + 0.30*S)
    ├── risk_tier ∈ {Low, Medium, High}  + colour
    └── _extract_survey_extras(row, qid_to_col_idx, df_columns)
              │
              ▼
  feature collection + analysis blob
    ├── _compute_iaq_analysis(features)   → residency / interventions /
    │                                       experiences / mobility /
    │                                       demographics_ext aggregations
    ├── _compute_street_stats(features)   → per-street ranking & means
    └── _build_validation_summary(...)    → IAQ↔contact match metrics
              │
              ▼
  upload writes to Supabase
    ├── iaq_surveys                       → per-feature row (cols listed below)
    ├── survey_responses                  → raw_answers + computed_scores JSONB
    ├── keystone_dashboard_data           → cached payload (data_type='iaq_survey')
    └── keystone_analysis_versions        → versioned snapshot of the analysis
```

## 2. Health Vulnerability Score (`health_score`, 0–100)

**Inputs (column names; canonicalised by `_apply_qsf_recode_labels`):**

| Column | Type |
|---|---|
| `Headache` | Likert frequency |
| `RespIll` | Likert frequency |
| `asthma` | Likert frequency |
| `wheeze` | Likert frequency |
| `Tired` | Likert frequency |
| `Hospital Respiratory` | Yes/No |

**Frequency mapping** (`api/survey_logic.py:67-96` — `symptom_frequency_score`):

```
"weekly"            → 4
"month" / "monthly" → 3
"season"            → 2
"year" / "annual"   → 1
else / never        → 0
```

**Formula** (`api/_processing.py:742-751`, mirrored in `app.py:364-376`):

```
raw = 0.5*f(Headache) + 1.0*f(RespIll) + 1.0*f(asthma)
    + 0.8*f(wheeze)   + 0.3*f(Tired)

normalized = min(raw / 14.4 * 80, 80)

if "yes" in Hospital Respiratory:
    health = min(normalized + 20, 100)
else:
    health = normalized
```

**Stored as:** `iaq_surveys.health_score (INT)`,
`survey_responses.computed_scores.health_score`, GeoJSON
`feature.properties.health_score`. **Aggregated as:**
`analysis['scores']['mean_health']`.

## 3. Indoor Air Quality Score (`iaq_score`, 0–100)

**Inputs:**

| Column | Meaning |
|---|---|
| `Mold` | non-empty → mold visible |
| `Leakage 2_1` … `_4` | roof, walls, windows, floor leakage |
| `Cooling System _1` … `_4` | central AC, window unit, fan, none — age band |
| `Cooking ` | cooking fuel (note trailing space — Qualtrics quirk) |

**Formula** (`api/_processing.py:754-775`; `app.py:379-405`):

```
score = 0
if mold present:                                      score += 30
for area in {roof, walls, windows, floor}:
    if leakage reported and not "none":               score +=  7.5
for zone in {central_ac, window_unit, fan, none}:
    if "more than 15 years":                          score +=  4
    elif "don't know" or "not applicable":            score +=  2
if cooking method contains "gas" or "propane":        score += 10
iaq = round(min(score, 100))
```

**Component flags** (`has_mold`, `leakage_*`, `cooling_*`, `cooking_method`)
are also persisted on the feature so the dashboard popup can break the
score down without re-reading the source CSV.

## 4. Structural Vulnerability Score (`struct_score`, 0–100)

**Inputs:**

| QID | Column meaning |
|---|---|
| `QID192` | year-built band |
| `QID128` | housing type (Single Wide / Double Wide / Site Built / …) |
| `QID141` | self-reported condition (Excellent → Critical) |

**Formula** (`api/survey_logic.py:26-65`; mirrored in `app.py:408-432`):

```
score = 0

# Year-built
if "Before 1960":                                     score += 30
elif "1960" in label  (i.e. 1960–1979):               score += 20
elif "1980" in label  (i.e. 1980–1999):               score += 10

# Housing type
if "Single Wide":                                     score += 25
elif "Double Wide":                                   score += 15
elif "non-traditional" or "camper":                   score += 20

# Condition
if "Poor":                                            score += 25
elif "Fair":                                          score += 15
elif "Critical" or "Uninhabitable":                   score += 35

struct = round(min(score, 100))
```

`QID141` recodes are taken from the QSF (`api/_processing.py:225-298`),
so a numeric '5' from a numeric export translates to "Critical" before
the keyword check runs.

## 5. Overall Risk + Risk Tier

**Formula** (`api/_processing.py:1886`, `app.py:1296`):

```
overall_risk = round(0.35*health + 0.35*iaq + 0.30*struct)

risk_tier = "Low"    if overall_risk < 34
            "Medium" if overall_risk < 67
            "High"   otherwise

colour    = "#10b981" (Low) | "#f97316" (Medium) | "#ef4444" (High)
```

Used by the choropleth, the legend, and the contact-status upgrade
that promotes a "Completed" contact to inherit a matched IAQ's tier
when the contact has no IAQ payload of its own
(`api/_processing.py:1272-1276`).

## 6. Per-Question Survey Extras

`SURVEY_QUESTIONS` (`api/_processing.py:92-143`) is the canonical map
from internal field name → `(fallback_csv_idx, primary_qid, canonical_text)`.

`_extract_survey_extras` (`api/_processing.py:810+`, hardened in this
release) resolves each field through three lookup tiers, in order:

1. **QID via ImportId metadata** (`qid_to_col_idx` built from CSV row 2;
   numeric exports always have it).
2. **QID embedded in the column header** (`_build_colname_qid_map` —
   added in the format-parity fix). Many TEXT exports drop the
   ImportId row but keep e.g. `…QID195_1` at the end of the header
   text.
3. **Hardcoded `fallback_csv_idx`** — used only as a last resort and
   logged in `analysis['_qid_fallback_qids']` so admins can spot a
   format drift.

This three-tier resolution is why both numeric and text Qualtrics
exports now produce identical Survey-Answers popups and aggregations.

### 6.1 Aggregations

**Likert / Yes-No counts** (`_bin_counts`, `_yes_no_counts` in
`api/_processing.py`): straightforward dict-of-counts with a
"not_sure"/"other"/"na" partitioning for free-text answers.

**Intervention matrix** (`QID195_1..11` → `intv_*`): `_pct_want`
(`api/_processing.py` ~lines 1450-1490). For each item:

```
threshold = max(scale_max(item) / 2.0, 3.5)

positive = count(answer where:
    answer is numeric and answer > threshold
    OR answer is text and any positive_token in answer
                       and no negative_token in answer)

pct_want[item] = round(positive / n_total * 100, 1)
```

`positive_tokens = {"want", "like", "agree", …}`,
`negative_tokens = {"not", "dislike", "disagree", …}`. Threshold-floor
3.5 prevents 1–5 Likert from being too lenient (a "neutral" 3 must not
count as positive).

**Experience matrix** (`QID124_1..10` → `exp_*`): `_pct_yes` — same
shape as `_pct_want` but with frequency-token positives ("daily",
"weekly", "monthly", "yearly") and Yes/Agree.

**Mobility / Demographics extension**: bin counts per field; thin
wrappers in `_compute_iaq_analysis`.

## 7. Street-Level Aggregation

`_compute_street_stats` (`api/_processing.py:1628-1677`):

```
group features by canonicalised street_name
for each street:
    if n_responses < 3:    flag insufficient_data and skip ranking
    else:
        mean_risk      = mean(overall_risk)
        mean_health    = mean(health_score)
        mean_iaq       = mean(iaq_score)
        mean_struct    = mean(struct_score)
        pct_mold       = 100 * (#has_mold / n)
        pct_respiratory = 100 * (#respiratory_freq != "never" / n)
        housing_types  = histogram by category
        owner_count, renter_count   = ownership split

rank streets by mean_risk descending; risk_rank = position (1 = worst)
```

Stored in `analysis['streets']`; consumed by the dashboard's "Streets"
tab and the choropleth fallback when a feature has no individual
overall_risk (rare).

## 8. QSF Recode Translation

The QSF JSON (Qualtrics survey definition) expresses every choice as
`{"recode": "<int>", "choiceText": "<label>"}`. The repo bakes the
relevant recode maps into Python at `api/_processing.py:225-298`:

- `_QSF_RECODE_LABELS` — keyed by base QID (`QID195`, `QID124`, …).
- `_COLNAME_RECODE_LABELS` — keyed by Qualtrics column name (used for
  custom-named columns: `Headache`, `RespIll`, `Cooling System _1`, …).

Translation runs on every upload (`api/_processing.py:1869`):

```
_normalize_qualtrics_recode_key(v) → "6"     (handles 6, "6", 6.0, " 6 ", etc.)
_translate_recode_cell(v, label_map) → "Like" | unchanged passthrough
_apply_qsf_recode_labels(df, qid_to_col_idx) → in-place column rewrite
```

Diagnostics:

- `analysis['input_format']` ∈ `{numeric_recode, text_labels}`.
- `analysis['recode_translation_applied']` always `true`
  (the call is unconditional).
- `analysis['_qid_map_size']` — number of QIDs the metadata row
  exposed; 0 indicates a legacy export.
- `analysis['_qid_fallback_qids']` — list of QIDs that fell through to
  the hardcoded column index. **Empty list = full QID resolution for
  every survey-question field** (the goal after the format-parity
  fix).
- `analysis['_qid_fallback_count']` — total fallback hits across all
  rows.

## 9. `survey_responses` (migration 18) and `computed_scores` JSONB

| Column | Purpose |
|---|---|
| `id` | PK |
| `upload_batch_id` | groups every row from one CSV upload |
| `qualtrics_resp_id` | original `ResponseId` |
| `address`, `parcel_id`, `street_name` | matched identity |
| `geocode_source` | `address_matched` / `geocoded` / `gps` (last-resort) |
| `raw_answers` JSONB | full QID-keyed answer map verbatim |
| `computed_scores` JSONB | `{health_score, iaq_score, struct_score, overall_risk, risk_tier}` |
| `recorded_at` | Qualtrics `EndDate` / `RecordedDate` |
| `created_at` | server insertion time |
| `uploaded_by_user_id` | who uploaded this batch (added in migration 19) |

This table is the audit trail: a re-analysis with a different weight
vector or a new derived column never needs the original CSV — replay
from `raw_answers` instead.

## 10. Versioning (`keystone_analysis_versions`, migration 03)

Every successful upload publishes a snapshot:

| Column | Purpose |
|---|---|
| `id` | SERIAL PK |
| `data_type` | `community_contact` or `iaq_survey` |
| `payload` JSONB | the entire analysis blob |
| `label` | human-readable label (e.g. `Daily Update 2026-04-22`) |
| `n_points` | row count at snapshot time |
| `created_at` | snapshot time |

`api/analysis.py:_latest_version` returns the most recent matching
snapshot for the dashboard's header badge; older snapshots remain
available for rollback / diff.

## 11. Match-Validation Summary

`build_validation_summary` (`api/survey_logic.py:112-161`,
called at `api/_processing.py:1093-1094`):

```
for each iaq_feature:
    matched = props['iaq_matched']        # set during the contact-merge step
    if not matched and feature has coords:
        nearest_distance = haversine(iaq, closest contact)
        unmatched_by_street[street_name] += 1
match_details.append({street, coord_source, matched, nearest_contact_m})

return {
  total_iaq_responses, matched_iaq_responses,
  unmatched_iaq, total_completed_contacts,
  match_rate_pct, coverage_pct,
  match_details, unmatched_by_street
}
```

Stored in `analysis['validation']`. Surfaces directly in the dashboard
"Validation" tab.

## 12. End-to-end correctness checks

Run from the repo root:

```bash
python -m pytest tests/test_processing_analysis.py
python -m pytest tests/test_qsf_alignment.py
```

`test_qsf_alignment.py` validates that QSF recode codes map to the
expected labels; failures here indicate a Qualtrics survey edit that
the codebase hasn't caught up with.

---

*Authoritative pointers (kept here so a future maintainer doesn't have
to grep the repo):*

- Health: `api/_processing.py:742-751`, `app.py:364-376`,
  `api/survey_logic.py:67-96`.
- IAQ: `api/_processing.py:754-775`, `app.py:379-405`.
- Struct: `api/survey_logic.py:26-65`, `app.py:408-432`.
- Overall + tier: `api/_processing.py:1886`, `app.py:1296`.
- Survey extras: `api/_processing.py:92-143` (definition), `:810+`
  (extractor with three-tier QID resolution).
- Street stats: `api/_processing.py:1628-1677`.
- QSF recode: `api/_processing.py:225-435`.
- Validation: `api/survey_logic.py:112-161`,
  `api/_processing.py:1093-1094`.
- Persistence: `supabase/migrations/03_analysis_versions.sql`,
  `supabase/migrations/18_data_model_improvements.sql`.
