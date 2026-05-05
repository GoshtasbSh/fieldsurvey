# IAQ Match Status — Visual Distinction on the Map

**Date:** 2026-05-05
**Status:** Approved (pending implementation)
**Owner:** dashboard team

## Purpose

After the v3 parcel-rep-point IAQ↔contact matcher landed, three distinct
"completed" populations exist in the data but the desktop dashboard map
renders them indistinguishably. This spec adds a visual encoding so a PI
can scan the map and instantly tell which households are in which group,
plus a sidebar legend with click-to-filter toggles.

## The three groups

| Group | Definition | Example cause |
|---|---|---|
| **G1 — Matched** | Community contact `status='Completed'` AND `has_iaq_survey=true` | Surveyor visited in person, resident filled the Qualtrics survey, both records resolved to the same parcel rep-point |
| **G2 — Contact only** | Community contact `status='Completed'` AND `has_iaq_survey=false` (or unset) | Surveyor marked Completed but no Qualtrics on record. Most common cause: resident agreed verbally but never followed through (data-quality gap, not a bug) |
| **G3 — Qualtrics only** | IAQ feature with `iaq_matched=false` | Flyer / QR / online respondent whose typed address resolves to a parcel that has no community contact in our canvas list |

G2 + G3 together expose every "data gap" between the two collection paths,
which is exactly what the PI needs to follow up on.

## Out of scope

- Auto-suggesting a status downgrade for G2 (deferred — option (b) from
  the brainstorm). Visual highlight only for now.
- Bulk re-matching with a wider radius (existing 100 m / parcel-rep-point
  v3 logic stands).
- Multi-respondent households (one IAQ → multiple contacts in the same
  parcel). Edge case; punt until we see one in the wild.

## Architecture

### Data model — new derived property `match_status`

Set server-side on every feature **after** the v3 matcher runs, before
the cached blob is upserted:

```
contact_features:
  status='Completed' + has_iaq_survey=true   → match_status='matched'
  status='Completed' + has_iaq_survey=false  → match_status='contact_only'
  status≠'Completed'                          → match_status absent

iaq_features:
  iaq_matched=true   → match_status='matched'
  iaq_matched=false  → match_status='iaq_only'
```

No DB schema change. The property persists through the cached blobs
(`keystone_dashboard_data['community_contact'].features[].properties`
and `…['iaq_survey'].geojson.features[].properties`).

### Visual encoding

Strokes only — fill colour stays as today (status for contacts, risk-tier
for IAQ).

| Group | Layer | Stroke colour | Stroke width | Radius modifier |
|---|---|---|---|---|
| G1 | `survey-points` | `#ffffff` (white) | 1.5 | — |
| G2 | `survey-points` | `#f59e0b` (amber) | 2.5 | — |
| G3 | `iaq-points` | `#8b5cf6` (purple) | 2.0 | +1 px at zoom ≥ 14 |

Other contact statuses (No Answer / Inaccessible / etc.) keep current
strokes unchanged. The G1/G2 distinction only applies to the green
"Completed" subset.

MapLibre paint expression for `survey-points`:

```js
'circle-stroke-color': [
  'match', ['get', 'match_status'],
  'matched',      '#ffffff',
  'contact_only', '#f59e0b',
  /* default */   '#ffffff',
],
'circle-stroke-width': [
  'match', ['get', 'match_status'],
  'contact_only', 2.5,
  /* default */   1.5,
],
```

### Sidebar UI

New collapsible section "MATCH STATUS" between "IAQ SURVEY POINTS" and
"RISK TIERS":

```
MATCH STATUS                         (collapsible header)
●  Matched (contact + Qualtrics)  47 [✓]
◉  Completed, no Qualtrics        15 [✓]
◆  Qualtrics only (flyer / QR)    18 [✓]

  Click a row to show only that group on the map.
```

Click behaviour identical to the existing per-status legend rows: click
toggles a filter that hides everything outside that group (single-row
exclusive filter, or shift-click for multi-select). Counts are computed
client-side from `surveyData.features` and `iaqData.features` whenever
the data changes.

### Popup unchanged

Already correct under v3 — the **Survey Answers** tab shows for matched
contacts (G1) and absent for contact_only (G2). The new visual indicator
just makes the underlying state visible at a glance without clicking.

## Files to change

| File | Change |
|---|---|
| `api/_processing.py` | Add `_tag_match_status(contacts, iaq_features)` helper. Call after `_upgrade_contacts_from_iaq` in `process_iaq_bytes`. |
| `app.py` | Mirror the same helper + call site (local source-of-truth). |
| `api/daily-refresh.py` | Set `match_status` on appended field-as-features. |
| `static/js/dashboard.js` | (a) update `survey-points` paint expression to switch stroke by `match_status`; (b) update `iaq-points` paint to use purple stroke + larger radius at zoom; (c) add "Match Status" sidebar block + filter handlers; (d) recompute counts on data refresh. |
| `static/index.html` | Add the sidebar Match Status section (placeholder div + header). |

## Edge cases

1. **Legacy data with no `match_status` property** (cached blob from
   before this change): client-side fallback uses
   `has_iaq_survey ? 'matched' : (status === 'Completed' ? 'contact_only' : null)`
   so the new visual still works for old uploads without forcing a
   re-upload.
2. **Anon viewers**: see the same visuals. `match_status` is not sensitive.
3. **Daily-refresh appended field-as-features**: tagged at append time
   using the same v3 logic.
4. **Multi-respondent households**: the "winner" gets `match_status='matched'`,
   the rest stay `contact_only`. Acceptable; flagged as out of scope.

## Testing

1. **Re-upload IAQ** → confirm G1 dots (white stroke), G2 dots (amber
   stroke), G3 dots (purple ring + larger).
2. **Click an amber dot** → popup shows `Completed` + no Survey Answers
   tab. Confirms G2 is what we think it is.
3. **Click a purple dot** → popup shows IAQ data only. Confirms G3.
4. **Sidebar toggle** "Completed, no Qualtrics" → only amber dots remain.
5. **Cross-check with `verify_iaq_matches.py`**: G1 count matches script
   output; G3 count matches the script's "flyer" count.

## Risk surface

- **Low.** Pure visual + filter additions; no data writes change. Worst
  case if a paint expression is wrong: dots render with default stroke
  (no semantic loss).
- A future MapLibre upgrade could change `match` paint expression
  semantics; standard regression check on existing `match` expressions
  for `circle-color` already covers this.

## Out-of-scope follow-ups

If G2 turns out to be > 10 % of all Completed contacts, build option (b)
from the brainstorm: "Re-evaluate this contact" admin action that calls
the v3 matcher with a wider radius for one specific household, or
flips the status back to `Follow Up`. Defer until we see the data.
