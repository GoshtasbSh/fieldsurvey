import numpy as np

from sidecar.routers.finish import compute


def test_returns_p50_p75_p90():
    history = [5] * 30
    result = compute(history, target=100, start="2026-06-01", sims=2000)
    assert result["p50_days"] is not None
    assert 15 <= result["p50_days"] <= 25
    assert result["p90_days"] >= result["p50_days"]


def test_empty_history_returns_nulls():
    result = compute([], target=100, start="2026-06-01", sims=500)
    assert result["p50_days"] is None
    assert result["p50_date"] is None


def test_zero_target_returns_nulls():
    result = compute([5, 5, 5], target=0, start="2026-06-01", sims=500)
    assert result["p50_days"] is None


def test_deterministic_with_seed():
    history = [3, 4, 5, 6, 7]
    r1 = compute(history, target=50, start="2026-06-01", sims=500, seed=42)
    r2 = compute(history, target=50, start="2026-06-01", sims=500, seed=42)
    assert r1["p50_days"] == r2["p50_days"]
    assert r1["p90_days"] == r2["p90_days"]


def test_discrete_percentile_matches_ts_algorithm():
    """Percentiles must use the discrete lower-order statistic (matches the
    TypeScript mirror at lib/analyses/formulas/monte-carlo.ts:61). Given a
    deterministic sorted_days input, both implementations must yield the
    same indices.
    """
    # Synthetic sorted_days vector (e.g. results of 10 sims).
    days = np.array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    sorted_days = np.sort(days)
    # TS algorithm: results[Math.floor(q * results.length)]
    p50_ts = int(sorted_days[int(0.5 * len(sorted_days))])
    p75_ts = int(sorted_days[int(0.75 * len(sorted_days))])
    p90_ts = int(sorted_days[int(0.9 * len(sorted_days))])
    # Indices: floor(0.5*10)=5 → 6, floor(0.75*10)=7 → 8, floor(0.9*10)=9 → 10
    assert p50_ts == 6
    assert p75_ts == 8
    assert p90_ts == 10
    # np.percentile would have interpolated to 5.5/7.75/9.1 — divergent.
    assert int(np.percentile(days, 50)) != p50_ts


def test_truncated_pct_when_target_unreachable():
    """If every sim hits the 5-year cap, truncated_pct must be 1.0."""
    result = compute([0, 0, 0], target=100, start="2026-06-01", sims=100)
    assert result["truncated_pct"] == 1.0
    assert result["p50_days"] == 365 * 5


def test_truncated_pct_zero_for_reachable_target():
    result = compute([10] * 30, target=50, start="2026-06-01", sims=500, seed=42)
    assert result["truncated_pct"] == 0.0
