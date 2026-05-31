# sidecar/lib/encode.py
"""Value normalization utilities."""
import numpy as np


def winsorize(arr: np.ndarray, pct: float = 0.02) -> np.ndarray:
    """Clip to [pct, 1-pct] quantiles."""
    lo, hi = np.quantile(arr, [pct, 1 - pct])
    return np.clip(arr, lo, hi)


def zscore(arr: np.ndarray) -> np.ndarray:
    """Standardize to mean=0, std=1. Returns zeros if std == 0."""
    std = arr.std()
    if std == 0:
        return np.zeros_like(arr, dtype=float)
    return (arr - arr.mean()) / std
