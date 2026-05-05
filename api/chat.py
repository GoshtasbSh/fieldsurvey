"""POST /api/chat — AI survey analyst with full map action support.

Ports the complete chat implementation from app.py including:
- Rich CHAT_SYSTEM_PROMPT with MAP ACTIONS section
- TEXT_ACTION_PROTOCOL for json_actions fenced-block output
- json_actions parser to extract map actions from LLM response
- _infer_map_actions fallback for common queries

Requires GROQ_API_KEY env var on Vercel.
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import re
import urllib.request
import urllib.error

import sys, pathlib
sys.path.append(str(pathlib.Path(__file__).parent))
from _lib import load_cached, json_response, require_team_member


GROQ_MODEL = "llama-3.3-70b-versatile"
GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"

CHAT_SYSTEM_PROMPT = """Analyst for KeyStone Heights, FL housing vulnerability dashboard.
IAQ Survey: {n_iaq} households · Community Contact: {n_contact} visits · Map: {map_state}
Data (streets_by_risk ordered worst→best; risk_rank 1=worst; only streets ≥3 responses shown):
{data}

SCORES (0–100, higher=worse):
overall_risk=35%health+35%iaq+30%struct | Low<34(green) Medium34-66(orange) High≥67(red)
health: symptom freq (resp.ill,asthma,wheeze,headache — weekly/monthly/season="active") + hospital respiratory +20
iaq: mold+30 · leakage+7.5/zone(×4max) · cooling>15yr +4/zone(×4max) · gas/propane cooking+10
struct: yr<1960+30, 1960-79+20, 1980-99+10 · single-wide+25, double-wide+15 · poor+25, fair+15
contacts: Completed=done · No Answer=nobody home · Inaccessible=locked/dog/gate
  Not Interested=declined · Left Info=QR/flyer · Vacant=empty · Follow Up=will complete later

MAP ACTIONS (all layers auto-cleared before each response; activate only what was asked):
highlight_streets {{streets:["Exact"],color:"#hex"}}  — OSM road line only (NO circles/points); pair with zoom_to_street; accepts multiple streets
  color MUST reflect the query context — pick from:
    worst health/risk → "#ef4444"  (red)
    worst structural/age → "#f97316"  (orange)
    worst IAQ/mold → "#8b5cf6"  (purple)
    best/safest → "#10b981"  (green)
    neutral comparison → "#3b82f6"  (blue)
zoom_to_street {{street:"Exact"}}  — always with highlight_streets
filter_iaq_symptom {{field,values}}  — auto-shows iaq_points
  respiratory_ill|asthma_freq|wheeze_freq|headache_freq → ["weekly","month","season"]
  has_mold→[true] · hospital_visit→["yes"] · ownership→["Owner"/"Renter"]
  risk_tier→["High"/"Medium"/"Low"] · housing_type→["Single Wide"/"Double Wide"/"Site Built"]
  coord_source→["geocoded"]
filter_contact_status {{statuses:[...]}}  — auto-shows contact_survey
  "Completed"|"No Answer"|"Inaccessible"|"Not Interested"|"Left Info"|"Vacant"|"Follow Up" · []=all
show_iaq_choropleth {{field}}  — auto-shows iaq_points | overall_risk|health_score|iaq_score|struct_score
set_layer_visibility {{layer,visible}}  — extras only: heatmap|parcels|clusters|labels|3d
clear_filters  — restore default view (both layers on)
show_analysis_tab {{tab}}  — summary|charts|streets|parcels|results

PATTERNS:
worst street (overall) → highlight_streets([risk_rank=1 name], color="#ef4444") + zoom_to_street + detailed report
worst-by-health → highlight_streets([top health_score name], color="#ef4444") + zoom_to_street + detailed report
worst-by-struct/age → highlight_streets([top struct_score name], color="#f97316") + zoom_to_street + detailed report
worst-by-mold/IAQ → highlight_streets([top iaq_score name], color="#8b5cf6") + zoom_to_street + detailed report
best/safest street → highlight_streets([context.best_street — the one with LOWEST mean_risk / HIGHEST risk_rank], color="#10b981") + zoom_to_street + detailed report
compare streets → highlight_streets([A,B,...], color="#3b82f6") + zoom_to_street(A) + markdown table
mold → filter_iaq_symptom(has_mold,[true])
symptom → filter_iaq_symptom(field,["weekly","month","season"])
renters/owners → filter_iaq_symptom(ownership,["Renter"/"Owner"])
mobile homes → filter_iaq_symptom(housing_type,["Single Wide"])
high-risk only → filter_iaq_symptom(risk_tier,["High"])
risk choropleth → show_iaq_choropleth(overall_risk|health_score|iaq_score|struct_score)
contact filter → filter_contact_status(["status"])
clusters → ASK "By contact outcomes or IAQ risk?" then set_layer_visibility(clusters,true) or show_iaq_choropleth
reset → clear_filters
text-only (no action): match rate · validation · overall summary · which streets need follow-up

RULES:
1. ALWAYS write a text response BEFORE or ALONGSIDE every tool call. NEVER return a tool call with no text. Every single response must contain a written analysis.
2. Street cite: "[Name] ranks #N — risk X/100 (health H, IAQ I, struct S, n=N). Primary driver: [reason]."
3. 2+ street comparison: markdown table — Street|N|Risk|Health|IAQ|Struct|Mold%|Resp%
4. Exact street names from streets_by_risk only. If not found, say so and offer closest match.
5. Ambiguous query → ask one clarifying question, do not act yet.
6. End every response: 💡 Follow-up: [specific question about what was shown]
7. ≤200 words for layer toggles · ≤400 words for analysis. Lead with the finding.
8. For best/worst street queries: always write a full report (scores, primary driver, housing types, mold rate, hospital rate) in the text — the map alone is not sufficient."""

TEXT_ACTION_PROTOCOL = """

=== CRITICAL: MAP ACTION OUTPUT ===
ANY response that references a specific street, filter, layer, or view MUST end
with a ```json_actions``` fenced block. NEVER describe actions in prose like
"we need to filter X" — EMIT the action instead. The block is hidden from the
user; your prose is the analysis, the block is the action.

Required format (exact fence tag `json_actions`, NOT `json`):
```json_actions
[{"type":"highlight_streets","params":{"streets":["Harvard Ave"],"color":"#ef4444"}},
 {"type":"zoom_to_street","params":{"street":"Harvard Ave"}}]
```

Examples of user queries and the REQUIRED action block:

Q: "worst street" / "highest risk street" / "show survey points for Harvard Ave"
→ ```json_actions
[{"type":"highlight_streets","params":{"streets":["Harvard Ave"],"color":"#ef4444"}},
 {"type":"zoom_to_street","params":{"street":"Harvard Ave"}}]
```

Q: "show mold cases" / "houses with mold"
→ ```json_actions
[{"type":"filter_iaq_symptom","params":{"field":"has_mold","values":[true]}}]
```

Q: "overall risk choropleth" / "heatmap of risk"
→ ```json_actions
[{"type":"show_iaq_choropleth","params":{"field":"overall_risk"}}]
```

Q: "completed surveys" / "which homes are done"
→ ```json_actions
[{"type":"filter_contact_status","params":{"statuses":["Completed"]}}]
```

Q: "reset" / "clear all"
→ ```json_actions
[{"type":"clear_filters","params":{}}]
```

FORBIDDEN: saying "we need to filter X" or "to do this we would..." or "this
will require the action:" without emitting the block. That leaves the map
unchanged and the user frustrated. Always emit the block when the query
mentions a street/filter/layer — even if you're not 100% sure, ship the most
likely action.
"""


def _build_context() -> dict:
    """Compact dict of numbers the LLM needs. Mirrors app.py's build_llm_context."""
    iaq = load_cached("iaq_survey") or {}
    analysis = iaq.get("analysis") or {}
    street_stats = iaq.get("street_stats") or {}
    survey = load_cached("community_contact") or {"features": []}

    # Coerce mean_risk to a number — it's stored as None for streets with
    # too few responses, and `-None` throws TypeError on sort. Likewise
    # ignore any street whose stats dict isn't actually a dict.
    def _risk(d):
        v = d.get("mean_risk")
        try:
            return float(v) if v is not None else 0.0
        except (TypeError, ValueError):
            return 0.0
    ranked = sorted(
        [(s, d) for s, d in street_stats.items()
         if isinstance(d, dict) and not d.get("insufficient_data")],
        key=lambda x: -_risk(x[1]),
    )
    worst = ranked[0][0] if ranked else None
    best = ranked[-1][0] if ranked else None

    scores = analysis.get("scores") or {}
    health = analysis.get("health") or {}
    ownership = analysis.get("ownership") or {}
    n_responses = analysis.get("n_responses", 0) or 0

    return {
        "dataset": {
            "n_surveyed": n_responses,
            "geocoded": analysis.get("geocoded", 0),
            "n_streets_analyzed": len(ranked),
            "n_community_contacts": len((survey.get("features") or [])),
        },
        "worst_street": worst,
        "best_street": best,
        "overview": {
            "mean_risk":  scores.get("mean_risk"),
            "mean_health": scores.get("mean_health"),
            "mean_iaq":   scores.get("mean_iaq"),
            "risk_tiers_n": analysis.get("risk_tiers"),
            "pct_mold": health.get("mold_pct"),
            "pct_respiratory_active": health.get("respiratory_pct"),
            "pct_asthma_active": health.get("asthma_pct"),
            "pct_hospital": health.get("hospital_pct"),
            "owner_pct":  round((ownership.get("owner", 0) / max(n_responses, 1)) * 100, 1),
            "renter_pct": round((ownership.get("renter", 0) / max(n_responses, 1)) * 100, 1),
        },
        # Trim to top 15 worst + bottom 5 best for token budget
        "streets_by_risk": {s: d for s, d in (ranked[:15] + ranked[-5:])},
        "_street_stats_all": street_stats,  # used by _infer_map_actions fallback
    }


def _infer_map_actions(query: str, street_stats: dict) -> list:
    """Deterministic fallback when LLM doesn't emit a json_actions block."""
    if not query or not street_stats:
        return []

    q = query.lower()

    show_words  = ('show', 'highlight', 'where', 'find', 'display', 'mark',
                   'see', 'locate', 'point', 'info', 'data', 'for the',
                   'on the map', 'on map')
    worst_words = ('worst', 'highest', 'most', 'top', 'dangerous')
    best_words  = ('best', 'safest', 'lowest', 'least')
    reset_words = ('reset', 'clear', 'remove filter', 'all streets', 'show all')

    color = '#3b82f6'
    if any(w in q for w in worst_words):
        color = '#ef4444'
    elif any(w in q for w in best_words):
        color = '#10b981'
    if 'mold' in q or 'iaq' in q:
        color = '#8b5cf6'
    elif 'struct' in q or 'age' in q or 'old' in q or 'year built' in q:
        color = '#f97316'
    elif 'health' in q or 'asthma' in q or 'respiratory' in q:
        color = '#ef4444'

    known_streets = [s for s, d in street_stats.items() if not d.get('insufficient_data')]
    matched_streets = []
    for street in known_streets:
        s_lower = street.lower()
        first_word = street.split()[0].lower()
        if s_lower in q or (len(first_word) >= 4 and re.search(rf'\b{re.escape(first_word)}\b', q)):
            matched_streets.append(street)

    ranked = sorted(
        [(s, d) for s, d in street_stats.items() if not d.get('insufficient_data')],
        key=lambda x: -x[1].get('mean_risk', 0)
    )
    if not matched_streets and ranked:
        if any(w in q for w in worst_words) and 'street' in q:
            matched_streets = [ranked[0][0]]
        elif any(w in q for w in best_words) and 'street' in q:
            matched_streets = [ranked[-1][0]]

    if matched_streets:
        return [
            {"type": "highlight_streets", "params": {"streets": matched_streets, "color": color}},
            {"type": "zoom_to_street",    "params": {"street": matched_streets[0]}},
        ]

    if 'mold' in q and any(w in q for w in show_words + ('with', 'houses', 'homes')):
        return [{"type": "filter_iaq_symptom", "params": {"field": "has_mold", "values": [True]}}]

    if 'choropleth' in q or 'heatmap of risk' in q or 'risk map' in q:
        field = 'overall_risk'
        if 'health' in q:   field = 'health_score'
        elif 'iaq' in q:    field = 'iaq_score'
        elif 'struct' in q: field = 'struct_score'
        return [{"type": "show_iaq_choropleth", "params": {"field": field}}]

    if 'completed' in q and 'surveys' in q:
        return [{"type": "filter_contact_status", "params": {"statuses": ["Completed"]}}]
    if 'no answer' in q:
        return [{"type": "filter_contact_status", "params": {"statuses": ["No Answer"]}}]
    if 'vacant' in q:
        return [{"type": "filter_contact_status", "params": {"statuses": ["Vacant"]}}]

    if 'asthma' in q and any(w in q for w in show_words):
        return [{"type": "filter_iaq_symptom", "params": {"field": "asthma_freq",
                 "values": ["weekly", "month", "season"]}}]
    if 'respiratory' in q and any(w in q for w in show_words):
        return [{"type": "filter_iaq_symptom", "params": {"field": "respiratory_ill",
                 "values": ["weekly", "month", "season"]}}]

    if any(w in q for w in reset_words):
        return [{"type": "clear_filters", "params": {}}]

    return []


def _extract_json_actions(txt: str):
    """Extract ```json_actions [...] ``` block from LLM text. Returns (actions, cleaned_text)."""
    if not txt:
        return [], txt
    m = re.search(r"```json_actions\s*(\[.*?\])\s*```", txt, re.DOTALL)
    if not m:
        return [], txt
    try:
        parsed = json.loads(m.group(1))
        if isinstance(parsed, list):
            cleaned = re.sub(r"```json_actions\s*\[.*?\]\s*```", "", txt, flags=re.DOTALL).strip()
            return parsed, cleaned
    except Exception:
        pass
    return [], txt


def _call_groq(messages: list, api_key: str) -> str:
    body = json.dumps({
        "model": GROQ_MODEL,
        "messages": messages,
        "temperature": 0.2,
        "max_tokens": 900,
    }).encode("utf-8")
    req = urllib.request.Request(
        GROQ_URL,
        data=body,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=40) as r:
        payload = json.loads(r.read())
    return payload["choices"][0]["message"]["content"]


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            return self._handle()
        except Exception as e:
            # Any uncaught exception below would yield BaseHTTPRequestHandler's
            # default HTML 500 page, which the dashboard then renders as
            # "AI chat failed: HTTP 500" with no detail. Catch here so the
            # client always gets a JSON body it can display.
            import traceback as _tb
            print(f"[chat] UNCAUGHT {type(e).__name__}: {e}\n{_tb.format_exc()[:2000]}")
            json_response(self, 500, {
                "error": f"{type(e).__name__}: {e}"[:300],
            })

    def _handle(self):
        # Auth-gate: chat is team-member-only. Anonymous callers cannot
        # drain Groq budget or probe dataset shape.
        if require_team_member(self) is None:
            return
        # Cap the body so a malformed Content-Length or huge payload can't
        # exhaust the function memory. 64 KB is plenty for chat + history.
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except (TypeError, ValueError):
            json_response(self, 400, {"error": "invalid Content-Length"})
            return
        if length < 0 or length > 64 * 1024:
            json_response(self, 413, {"error": "Body too large (max 64 KB)."})
            return
        try:
            body = json.loads(self.rfile.read(length).decode("utf-8")) if length else {}
        except Exception:
            json_response(self, 400, {"error": "invalid JSON body"})
            return

        message = (body.get("message") or "").strip()
        history = body.get("history") or []
        map_state = body.get("map_state") or "unknown"
        if not message:
            json_response(self, 400, {"error": "No message provided"})
            return

        groq_key = os.environ.get("GROQ_API_KEY", "")
        if not groq_key:
            json_response(self, 200, {
                "text": ("AI chatbot is not configured on this deployment. "
                         "Set **GROQ_API_KEY** in Vercel Project Settings → "
                         "Environment Variables to enable the survey analyst."),
                "map_actions": [],
                "model_used": None,
            })
            return

        ctx = _build_context()
        if not ctx["dataset"]["n_surveyed"]:
            json_response(self, 200, {
                "text": ("No IAQ survey data is loaded yet. Upload the Qualtrics "
                         "CSV via the **Update Data** button first."),
                "map_actions": [],
                "model_used": None,
            })
            return

        street_stats = ctx.pop("_street_stats_all", {})

        system = (CHAT_SYSTEM_PROMPT + TEXT_ACTION_PROTOCOL).format(
            n_iaq=ctx["dataset"]["n_surveyed"],
            n_contact=ctx["dataset"]["n_community_contacts"],
            map_state=map_state,
            data=json.dumps(ctx, separators=(",", ":")),
        )
        msgs = [{"role": "system", "content": system}]
        for h in history[-5:]:
            role = h.get("role") or "user"
            content = h.get("content") or ""
            if content:
                msgs.append({"role": role, "content": content})
        msgs.append({"role": "user", "content": message})

        try:
            raw_text = _call_groq(msgs, groq_key)
        except urllib.error.HTTPError as e:
            try:
                detail = e.read().decode("utf-8", errors="ignore")[:400]
                print(f"[chat] Groq HTTPError {e.code}: {detail}")
            except Exception:
                pass
            json_response(self, 502, {"error": "Chat service unavailable. Try again in a moment."})
            return
        except Exception as e:
            print(f"[chat] {type(e).__name__}: {e}")
            json_response(self, 500, {"error": "Chat service unavailable. Try again in a moment."})
            return

        # Extract json_actions block; strip it from the visible text
        map_actions, text = _extract_json_actions(raw_text)

        # Deterministic fallback: keyword + street-name matching
        if not map_actions:
            map_actions = _infer_map_actions(message, street_stats)

        json_response(self, 200, {
            "text": text,
            "map_actions": map_actions,
            "model_used": f"groq/{GROQ_MODEL}",
        })
