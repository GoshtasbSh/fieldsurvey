"""
V2 Spatial Regression Diagnostics
===================================
OLS baseline → Moran I residual test → Spatial Lag (2SLS) → Spatial Error (FGLS).

Algorithm
---------
1. OLS: y = Xβ + ε  via numpy.linalg.lstsq
2. Moran's I on OLS residuals  (esda.Moran, permutation test)
   → if significant, OLS is misspecified — spatial model needed
3. Spatial Lag (2SLS / Kelejian-Prucha):
     y = ρ·Wy + Xβ + ε
   First stage: Wy ~ [X, WX] → get Ŵy
   Second stage: y ~ [Ŵy, X]
4. Spatial Error (FGLS Cochrane-Orcutt):
     y = Xβ + u,  u = λ·Wu + ε
   Estimate λ from OLS residuals, filter y and X, then OLS on filtered.
5. Compare models by AIC; recommend best.

References
----------
Anselin (1988) "Spatial Econometrics"
Kelejian & Prucha (1998) Two-Stage Least Squares for Spatial Lag
Moran (1950) for residual test
"""
import numpy as np
from scipy import stats
import libpysal
from esda.moran import Moran
from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional

from ..lib.cache import write_cache

router = APIRouter()


# ── OLS ──────────────────────────────────────────────────────────────────────

def _ols_fit(X: np.ndarray, y: np.ndarray) -> dict:
    """OLS regression. X must include a constant column."""
    n, k = X.shape
    beta, _, _, _ = np.linalg.lstsq(X, y, rcond=None)
    y_hat = X @ beta
    residuals = y - y_hat
    ss_res = float(np.dot(residuals, residuals))
    ss_tot = float(np.dot(y - y.mean(), y - y.mean()))
    r2 = max(0.0, 1.0 - ss_res / ss_tot) if ss_tot > 1e-12 else 0.0
    sigma2 = ss_res / max(n - k, 1)
    aic = float(n * np.log(ss_res / n + 1e-15) + 2.0 * k)
    # Standard errors via (X'X)^-1
    XtXinv = np.linalg.pinv(X.T @ X)
    se = np.sqrt(np.maximum(np.diag(sigma2 * XtXinv), 0.0))
    t_stats = beta / (se + 1e-15)
    p_vals = [float(2.0 * (1.0 - stats.t.cdf(abs(t), df=max(n - k, 1)))) for t in t_stats]
    return {
        "beta": beta.tolist(),
        "se": se.tolist(),
        "t_stats": t_stats.tolist(),
        "p_vals": p_vals,
        "r2": float(r2),
        "aic": float(aic),
        "residuals": residuals.tolist(),
        "y_hat": y_hat.tolist(),
    }


# ── Spatial Lag (2SLS) ───────────────────────────────────────────────────────

def _spatial_lag_2sls(X: np.ndarray, y: np.ndarray, W: np.ndarray) -> dict:
    """
    Kelejian-Prucha 2SLS estimator for  y = ρWy + Xβ + ε.
    Instruments for Wy: the columns of [X, WX].
    """
    Wy = W @ y
    WX = W @ X
    # Instrument matrix (drop constant duplicate if present)
    Z = np.hstack([X, WX[:, 1:]])   # avoid duplicate intercept
    # First stage: project Wy onto Z
    beta_fs, _, _, _ = np.linalg.lstsq(Z, Wy, rcond=None)
    Wy_hat = Z @ beta_fs
    # Second stage
    X_aug = np.hstack([Wy_hat.reshape(-1, 1), X])
    result = _ols_fit(X_aug, y)
    rho = float(result["beta"][0])
    beta_x = result["beta"][1:]
    se_x = result["se"][1:]
    p_x = result["p_vals"][1:]
    return {
        "rho": rho,
        "beta": beta_x,
        "se": se_x,
        "p_vals": p_x,
        "r2": result["r2"],
        "aic": result["aic"],
        "residuals": result["residuals"],
    }


# ── Spatial Error (FGLS) ─────────────────────────────────────────────────────

def _spatial_error_fgls(X: np.ndarray, y: np.ndarray, W: np.ndarray) -> dict:
    """
    Cochrane-Orcutt FGLS for  y = Xβ + u,  u = λWu + ε.
    Estimate λ via moment condition: λ̂ = (e'We) / (e'W'We)
    Filter: y* = y - λ̂Wy,  X* = X - λ̂WX, then OLS on filtered system.
    """
    ols = _ols_fit(X, y)
    e = np.array(ols["residuals"])
    We = W @ e
    WtWe = W.T @ We
    denom = float(np.dot(WtWe, WtWe))
    lam = float(np.dot(e, WtWe)) / (denom + 1e-15)
    lam = float(np.clip(lam, -0.99, 0.99))

    y_star = y - lam * (W @ y)
    X_star = X - lam * (W @ X)
    result = _ols_fit(X_star, y_star)
    return {
        "lambda": lam,
        "beta": result["beta"],
        "se": result["se"],
        "p_vals": result["p_vals"],
        "r2": result["r2"],
        "aic": result["aic"],
        "residuals": result["residuals"],
    }


# ── Main compute ─────────────────────────────────────────────────────────────

class MultiCell(BaseModel):
    id: str
    lat: float
    lon: float
    values: dict[str, Optional[float]]


class Req(BaseModel):
    project_id: str
    cells: list[MultiCell]
    y_key: str
    x_keys: list[str]
    weights_type: str = "knn8"
    n_permutations: int = 499


def compute(
    cells: list[dict],
    y_key: str,
    x_keys: list[str],
    weights_type: str = "knn8",
    n_permutations: int = 499,
) -> dict:
    if len(cells) < 30:
        return {"error": "insufficient_data", "n": len(cells), "n_min": 30}

    # Build arrays with listwise deletion
    all_keys = [y_key] + x_keys
    valid_mask = np.ones(len(cells), dtype=bool)
    for k in all_keys:
        col = np.array([c["values"].get(k) for c in cells])
        valid_mask &= np.array([v is not None and np.isfinite(float(v)) for v in col])

    cells_v = [c for c, m in zip(cells, valid_mask) if m]
    n = len(cells_v)
    if n < 30:
        return {"error": "insufficient_data_after_nan", "n": n, "n_min": 30}

    coords = np.array([[c["lon"], c["lat"]] for c in cells_v])
    y = np.array([float(c["values"][y_key]) for c in cells_v])
    X_cols = [np.array([float(c["values"][xk]) for c in cells_v]) for xk in x_keys]
    # Standardise predictors for numeric stability
    X_std_cols = []
    x_means, x_stds = [], []
    for col in X_cols:
        mu, sd = col.mean(), col.std()
        x_means.append(float(mu))
        x_stds.append(float(sd) if sd > 1e-10 else 1.0)
        X_std_cols.append((col - mu) / (sd if sd > 1e-10 else 1.0))
    X = np.column_stack([np.ones(n)] + X_std_cols)

    # Spatial weights
    k = min(8, n - 1)
    w = libpysal.weights.KNN(coords, k=k)
    w.transform = "r"

    # OLS
    ols_raw = _ols_fit(X, y)
    ols_residuals = np.array(ols_raw["residuals"])

    # Moran I on OLS residuals
    moran = Moran(ols_residuals, w, permutations=n_permutations)
    moran_I = float(moran.I)
    moran_p = float(moran.p_sim)

    coeff_names = ["Intercept"] + x_keys
    ols_out = {
        "r2": ols_raw["r2"],
        "aic": ols_raw["aic"],
        "coefficients": [
            {
                "name": coeff_names[i],
                "beta": float(ols_raw["beta"][i]),
                "se": float(ols_raw["se"][i]),
                "t": float(ols_raw["t_stats"][i]),
                "p": float(ols_raw["p_vals"][i]),
            }
            for i in range(len(coeff_names))
        ],
        "moran_I_residuals": moran_I,
        "moran_p_residuals": moran_p,
    }

    # Spatial models (only for n ≤ 1000 to keep dense W memory reasonable)
    spatial_lag_out: Optional[dict] = None
    spatial_error_out: Optional[dict] = None
    spatial_models_computed = n <= 1000

    if spatial_models_computed:
        # Build dense row-standardised W
        W_dense = np.zeros((n, n))
        for i, nb_list in w.neighbors.items():
            for j, wij in zip(nb_list, w.weights[i]):
                W_dense[i, j] = wij

        try:
            sl = _spatial_lag_2sls(X, y, W_dense)
            spatial_lag_out = {
                "rho": sl["rho"],
                "r2": sl["r2"],
                "aic": sl["aic"],
                "coefficients": [
                    {"name": x_keys[i], "beta": float(sl["beta"][i]),
                     "se": float(sl["se"][i]), "p": float(sl["p_vals"][i])}
                    for i in range(len(x_keys))
                ],
            }
        except Exception as ex:
            spatial_lag_out = {"error": str(ex)}

        try:
            se = _spatial_error_fgls(X, y, W_dense)
            spatial_error_out = {
                "lambda": se["lambda"],
                "r2": se["r2"],
                "aic": se["aic"],
                "coefficients": [
                    {"name": x_keys[i], "beta": float(se["beta"][i + 1]),
                     "se": float(se["se"][i + 1]), "p": float(se["p_vals"][i + 1])}
                    for i in range(len(x_keys))
                ],
            }
        except Exception as ex:
            spatial_error_out = {"error": str(ex)}

    # Best model by AIC
    aic_map: dict[str, float] = {"OLS": ols_raw["aic"]}
    if spatial_lag_out and "aic" in spatial_lag_out:
        aic_map["Spatial Lag"] = float(spatial_lag_out["aic"])
    if spatial_error_out and "aic" in spatial_error_out:
        aic_map["Spatial Error"] = float(spatial_error_out["aic"])
    best_model = min(aic_map, key=lambda k: aic_map[k])
    aic_delta = {m: round(v - aic_map[best_model], 2) for m, v in aic_map.items()}

    sa_sig = moran_p < 0.05

    # Per-location residuals for visualisation (capped at 500 rows)
    loc_residuals = [
        {
            "id": cells_v[i]["id"],
            "lat": cells_v[i]["lat"],
            "lon": cells_v[i]["lon"],
            "residual": round(float(ols_residuals[i]), 4),
            "y_hat": round(float(ols_raw["y_hat"][i]), 4),
        }
        for i in range(min(n, 500))
    ]

    # Human-readable verdict
    if sa_sig:
        verdict = (
            f"Significant spatial autocorrelation in OLS residuals "
            f"(Moran I = {moran_I:.3f}, p = {moran_p:.3f}). "
            f"{best_model} gives the lowest AIC — spatial model recommended."
        )
    else:
        verdict = (
            f"No significant spatial autocorrelation in residuals "
            f"(Moran I = {moran_I:.3f}, p = {moran_p:.3f}). "
            "OLS appears adequate for this data."
        )

    return {
        "ols": ols_out,
        "spatial_lag": spatial_lag_out,
        "spatial_error": spatial_error_out,
        "best_model": best_model,
        "aic_delta": aic_delta,
        "moran_I": moran_I,
        "moran_p": moran_p,
        "spatial_autocorrelation_significant": sa_sig,
        "spatial_models_computed": spatial_models_computed,
        "verdict": verdict,
        "n": n,
        "n_total": len(cells),
        "y_key": y_key,
        "x_keys": x_keys,
        "x_means": x_means,
        "x_stds": x_stds,
        "location_residuals": loc_residuals,
    }


@router.post("")
def post(req: Req):
    cells_d = [c.model_dump() for c in req.cells]
    out = compute(cells_d, req.y_key, req.x_keys, req.weights_type, req.n_permutations)
    write_cache(req.project_id, "V2_gwr", out)
    return out
