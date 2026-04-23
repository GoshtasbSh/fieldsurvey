"""POST /api/chat — AI survey analyst.

Minimal Vercel port of the Groq-backed chatbot in app.py. Replies to questions
about the IAQ + community survey data using a compact JSON context built live
from Supabase blobs.

Not yet ported: multi-model fallback chain (Gemini), structured json_actions
block parsing for map actions. Responses are text-only for now — the frontend's
existing code gracefully handles an empty map_actions list.

Requires GROQ_API_KEY env var on Vercel.
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import urllib.request
import urllib.error

import sys, pathlib
sys.path.append(str(pathlib.Path(__file__).parent))
from _lib import supabase_admin, supabase_anon, load_cached, json_response


GROQ_MODEL = "llama-3.3-70b-versatile"
GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"


def _build_context() -> dict:
    """Compact dict of numbers the LLM needs. Mirrors app.py's build_llm_context."""
    iaq = load_cached("iaq_survey") or {}
    analysis = iaq.get("analysis") or {}
    street_stats = iaq.get("street_stats") or {}
    survey = load_cached("community_contact") or {"features": []}

    ranked = sorted(
        [(s, d) for s, d in street_stats.items() if not d.get("insufficient_data")],
        key=lambda x: -x[1].get("mean_risk", 0),
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
    }


SYSTEM_PROMPT = """You are the analyst for the KeyStone Heights, FL housing vulnerability dashboard.

You answer questions about two datasets:
1. IAQ (indoor air quality) survey — {n_iaq} responses, grouped by street.
2. Community contact survey — {n_contact} address-level contact records.

Map state: {map_state}

Ground truth data (JSON):
{data}

Rules:
- Use ONLY the data above; never invent numbers.
- "Best" means LOWEST mean_risk (safer). "Worst" = HIGHEST mean_risk.
- If the user asks to show/filter/highlight anything on the map, answer with
  a clear text explanation. (Map actions will be wired up in a later update.)
- Keep responses under 180 words unless the user explicitly asks for detail.
- Cite exact numbers (e.g., "mean_risk = 72") when stating claims."""


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
        length = int(self.headers.get("Content-Length") or 0)
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

        system = SYSTEM_PROMPT.format(
            n_iaq=ctx["dataset"]["n_surveyed"],
            n_contact=ctx["dataset"]["n_community_contacts"],
            map_state=map_state,
            data=json.dumps(ctx, separators=(",", ":")),
        )
        msgs = [{"role": "system", "content": system}]
        # Last 5 turns of history
        for h in history[-5:]:
            role = h.get("role") or "user"
            content = h.get("content") or ""
            if content:
                msgs.append({"role": role, "content": content})
        msgs.append({"role": "user", "content": message})

        try:
            text = _call_groq(msgs, groq_key)
            json_response(self, 200, {
                "text": text,
                "map_actions": [],
                "model_used": f"groq/{GROQ_MODEL}",
            })
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", errors="ignore")[:400]
            json_response(self, 502, {"error": f"Groq API {e.code}: {detail}"})
        except Exception as e:
            json_response(self, 500, {"error": f"{type(e).__name__}: {e}"})
