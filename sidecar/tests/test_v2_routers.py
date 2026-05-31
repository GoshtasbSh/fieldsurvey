"""Tests for V2 sidecar routers: space-time, spatial-regression, segregation."""
import math
import pytest
from datetime import datetime, timezone, timedelta

from sidecar.routers.v2_space_time import compute as st_compute
from sidecar.routers.v2_spatial_reg import compute as reg_compute
from sidecar.routers.v2_segregation import compute as seg_compute


# ── Helpers ──────────────────────────────────────────────────────────────────

def _make_temporal_grid(n_locations: int = 25, n_weeks: int = 6, seed: int = 42) -> list[dict]:
    """
    Synthetic dataset: points on a 5x5 lat/lon grid, repeated over n_weeks.
    Values increase over time for the top-left quadrant (emerging hot spot).
    """
    import random
    rng = random.Random(seed)
    rows = []
    base_dt = datetime(2025, 1, 6, tzinfo=timezone.utc)  # Monday
    for w in range(n_weeks):
        week_dt = base_dt + timedelta(weeks=w)
        for i in range(n_locations):
            lat = 28.0 + (i // 5) * 0.1
            lon = -82.0 + (i % 5) * 0.1
            # Top-left 4 points get increasing values — emerging hot spot
            is_top_left = (i // 5 < 2) and (i % 5 < 2)
            value = (w + 1) * 2.0 + rng.gauss(0, 0.3) if is_top_left else rng.gauss(3.0, 1.0)
            rows.append({
                "id": f"p{i}",
                "lat": lat, "lon": lon,
                "value": value,
                "created_at": week_dt.isoformat(),
            })
    return rows


def _make_spatial_cells(n: int = 60, seed: int = 0) -> list[dict]:
    """Grid of n points with two question values (y, x)."""
    import random
    rng = random.Random(seed)
    cells = []
    for i in range(n):
        lat = 28.0 + (i // 10) * 0.1
        lon = -82.0 + (i % 10) * 0.1
        x_val = rng.gauss(5.0, 1.5)
        y_val = 0.6 * x_val + rng.gauss(0, 0.8)
        cells.append({
            "id": f"p{i}", "lat": lat, "lon": lon,
            "values": {"y": y_val, "x": x_val},
        })
    return cells


def _make_group_rows(n: int = 80, n_groups: int = 3, seed: int = 0) -> list[dict]:
    """Spatially clustered groups on a grid."""
    import random
    rng = random.Random(seed)
    groups = [f"G{g+1}" for g in range(n_groups)]
    rows = []
    for i in range(n):
        lat = 28.0 + (i // 10) * 0.1
        lon = -82.0 + (i % 10) * 0.1
        # Assign group based on quadrant — creates spatial segregation
        quadrant = (1 if lat < 28.4 else 2) if lon < -81.5 else 3
        group = groups[min(quadrant - 1, n_groups - 1)]
        # Add some noise
        if rng.random() < 0.15:
            group = rng.choice(groups)
        rows.append({"id": f"r{i}", "lat": lat, "lon": lon, "group_value": group})
    return rows


# ── Space-Time tests ──────────────────────────────────────────────────────────

class TestSpaceTime:
    def test_basic_output_shape(self):
        rows = _make_temporal_grid()
        out = st_compute(rows, time_bucket="week", n_permutations=49)
        assert "results" in out
        assert "n_time_steps" in out
        assert out["n_time_steps"] == 6
        assert out["n"] == 25  # unique locations

    def test_all_categories_are_known_strings(self):
        rows = _make_temporal_grid()
        out = st_compute(rows, time_bucket="week", n_permutations=49)
        valid_cats = {
            "New Hot Spot", "Consecutive Hot Spot", "Intensifying Hot Spot",
            "Persistent Hot Spot", "Diminishing Hot Spot", "Sporadic Hot Spot",
            "Oscillating Hot Spot", "Historical Hot Spot",
            "New Cold Spot", "Consecutive Cold Spot", "Intensifying Cold Spot",
            "Persistent Cold Spot", "Diminishing Cold Spot", "Sporadic Cold Spot",
            "Oscillating Cold Spot", "Historical Cold Spot", "No Pattern",
        }
        for r in out["results"]:
            assert r["category"] in valid_cats, f"Unknown category: {r['category']}"

    def test_mk_tau_in_range(self):
        rows = _make_temporal_grid()
        out = st_compute(rows, time_bucket="week", n_permutations=49)
        for r in out["results"]:
            assert -1.0 <= r["mk_tau"] <= 1.0

    def test_insufficient_time_steps_returns_error(self):
        rows = _make_temporal_grid(n_weeks=2)
        out = st_compute(rows, time_bucket="week", n_permutations=49)
        assert out.get("error") == "insufficient_time_steps"
        assert "message" in out

    def test_empty_rows_returns_error(self):
        out = st_compute([], time_bucket="week")
        assert out.get("error") == "no_data"

    def test_month_bucket_works(self):
        rows = _make_temporal_grid(n_weeks=16)
        out = st_compute(rows, time_bucket="month", n_permutations=49)
        assert out.get("n_time_steps", 0) >= 3

    def test_no_timestamps_returns_error(self):
        rows = [{"id": f"p{i}", "lat": 28.0, "lon": -82.0, "value": 1.0, "created_at": None} for i in range(20)]
        out = st_compute(rows, time_bucket="week")
        assert "error" in out

    def test_category_counts_sum_to_n(self):
        rows = _make_temporal_grid()
        out = st_compute(rows, time_bucket="week", n_permutations=49)
        total = sum(out["category_counts"].values())
        assert total == out["n"]


# ── Spatial Regression tests ──────────────────────────────────────────────────

class TestSpatialReg:
    def test_basic_output_shape(self):
        cells = _make_spatial_cells(n=60)
        out = reg_compute(cells, y_key="y", x_keys=["x"], n_permutations=99)
        assert "ols" in out
        assert "moran_I" in out
        assert "best_model" in out
        assert out["n"] == 60

    def test_ols_r2_in_range(self):
        cells = _make_spatial_cells(n=60)
        out = reg_compute(cells, y_key="y", x_keys=["x"], n_permutations=99)
        assert 0.0 <= out["ols"]["r2"] <= 1.0

    def test_ols_has_correct_coefficients(self):
        cells = _make_spatial_cells(n=60)
        out = reg_compute(cells, y_key="y", x_keys=["x"], n_permutations=99)
        coeff_names = [c["name"] for c in out["ols"]["coefficients"]]
        assert "Intercept" in coeff_names
        assert "x" in coeff_names

    def test_moran_p_in_range(self):
        cells = _make_spatial_cells(n=60)
        out = reg_compute(cells, y_key="y", x_keys=["x"], n_permutations=99)
        assert 0.0 <= out["moran_p"] <= 1.0

    def test_aic_delta_zero_for_best(self):
        cells = _make_spatial_cells(n=60)
        out = reg_compute(cells, y_key="y", x_keys=["x"], n_permutations=99)
        best = out["best_model"]
        assert out["aic_delta"][best] == pytest.approx(0.0, abs=0.01)

    def test_spatial_models_computed_for_small_n(self):
        cells = _make_spatial_cells(n=60)
        out = reg_compute(cells, y_key="y", x_keys=["x"], n_permutations=99)
        assert out["spatial_models_computed"] is True
        assert out["spatial_lag"] is not None
        assert out["spatial_error"] is not None

    def test_insufficient_data_returns_error(self):
        cells = _make_spatial_cells(n=10)
        out = reg_compute(cells, y_key="y", x_keys=["x"])
        assert out.get("error") == "insufficient_data"

    def test_verdict_is_string(self):
        cells = _make_spatial_cells(n=60)
        out = reg_compute(cells, y_key="y", x_keys=["x"], n_permutations=99)
        assert isinstance(out["verdict"], str) and len(out["verdict"]) > 10

    def test_location_residuals_capped(self):
        cells = _make_spatial_cells(n=60)
        out = reg_compute(cells, y_key="y", x_keys=["x"], n_permutations=99)
        assert len(out["location_residuals"]) <= 500


# ── Segregation tests ─────────────────────────────────────────────────────────

class TestSegregation:
    def test_basic_output_shape(self):
        rows = _make_group_rows(n=80)
        out = seg_compute(rows, zone_size_deg=0.2)
        for key in ["dissimilarity_D", "isolation_xPx", "interaction_xPy", "entropy_H", "gini"]:
            assert key in out, f"Missing key: {key}"

    def test_indices_in_valid_range(self):
        rows = _make_group_rows(n=80)
        out = seg_compute(rows, zone_size_deg=0.2)
        assert 0.0 <= out["dissimilarity_D"] <= 1.0
        assert 0.0 <= out["isolation_xPx"] <= 1.0
        assert 0.0 <= out["interaction_xPy"] <= 1.0
        assert 0.0 <= out["entropy_H"] <= 1.0
        assert 0.0 <= out["gini"] <= 1.0

    def test_isolation_plus_interaction_approx_1(self):
        # P*aa + P*ab ≈ 1 for binary case (only 2 groups)
        rows = _make_group_rows(n=80, n_groups=2)
        out = seg_compute(rows, zone_size_deg=0.2)
        total = out["isolation_xPx"] + out["interaction_xPy"]
        assert abs(total - 1.0) < 0.02, f"P*aa + P*ab = {total:.4f}, expected ≈ 1"

    def test_perfectly_integrated_low_D(self):
        """Random assignment → low D."""
        import random
        rng = random.Random(999)
        rows = [
            {"id": f"r{i}", "lat": 28.0 + (i // 10) * 0.1, "lon": -82.0 + (i % 10) * 0.1,
             "group_value": "A" if rng.random() > 0.5 else "B"}
            for i in range(100)
        ]
        out = seg_compute(rows, zone_size_deg=0.2)
        assert out["dissimilarity_D"] < 0.4, f"D={out['dissimilarity_D']:.3f} should be low for random mixing"

    def test_perfectly_segregated_high_D(self):
        """Group A only on left, Group B only on right → high D."""
        rows = [
            {"id": f"r{i}", "lat": 28.0, "lon": -82.0 + i * 0.05,
             "group_value": "A" if i < 10 else "B"}
            for i in range(20)
        ]
        out = seg_compute(rows, zone_size_deg=0.2)
        assert out["dissimilarity_D"] > 0.5, f"D={out['dissimilarity_D']:.3f} should be high for perfect segregation"

    def test_insufficient_data_returns_error(self):
        rows = [{"id": f"r{i}", "lat": 28.0, "lon": -82.0 + i * 0.1, "group_value": "A"} for i in range(10)]
        out = seg_compute(rows, zone_size_deg=0.2)
        assert "error" in out

    def test_single_group_returns_error(self):
        rows = [{"id": f"r{i}", "lat": 28.0, "lon": -82.0 + i * 0.05, "group_value": "A"} for i in range(30)]
        out = seg_compute(rows, zone_size_deg=0.2)
        assert "error" in out

    def test_interpretation_present(self):
        rows = _make_group_rows(n=80)
        out = seg_compute(rows, zone_size_deg=0.2)
        assert "interpretation" in out
        assert "summary" in out["interpretation"]
        assert len(out["interpretation"]["summary"]) > 20

    def test_group_props_sum_to_1(self):
        rows = _make_group_rows(n=80)
        out = seg_compute(rows, zone_size_deg=0.2)
        total = sum(out["group_props"].values())
        assert abs(total - 1.0) < 1e-6

    def test_zone_details_present(self):
        rows = _make_group_rows(n=80)
        out = seg_compute(rows, zone_size_deg=0.2)
        assert isinstance(out["zone_details"], list)
        assert len(out["zone_details"]) > 0
        for z in out["zone_details"][:3]:
            assert "zone_id" in z
            assert "composition" in z
            assert "majority_pct" in z
