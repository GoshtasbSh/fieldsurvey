# sidecar/lib/weights.py
"""Shared spatial-weights builder for all S-series routers."""
import numpy as np
import libpysal


def build_weights(coords: np.ndarray, weights_type: str = "knn8") -> libpysal.weights.W:
    """Build a spatial weights matrix from (lon, lat) coords.

    Args:
        coords: shape (n, 2) array of [lon, lat] values.
        weights_type: "knn8" | "knn5" | "dband_500m"

    Returns:
        Row-standardized W matrix.
    """
    n = len(coords)
    if weights_type == "dband_500m":
        try:
            w = libpysal.weights.DistanceBand.from_array(coords, threshold=0.0045, binary=True)
            if w.n_components > 1:
                w = libpysal.weights.KNN.from_array(coords, k=min(8, n - 1))
        except Exception:
            w = libpysal.weights.KNN.from_array(coords, k=min(8, n - 1))
    else:
        k = 5 if weights_type == "knn5" else 8
        w = libpysal.weights.KNN.from_array(coords, k=min(k, n - 1))

    w.transform = "r"
    return w
