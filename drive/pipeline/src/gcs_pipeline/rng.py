"""Deterministic hashing, value noise and shaping helpers.

Everything here uses integer hashing and correctly rounded float operations only
(+ - * / sqrt, floor, clip), so results are byte-identical across CPUs and numpy builds.
"""

from __future__ import annotations

import numpy as np

_GOLDEN = np.uint64(0x9E3779B97F4A7C15)
_MIX1 = np.uint64(0xBF58476D1CE4E5B9)
_MIX2 = np.uint64(0x94D049BB133111EB)
_KX = np.uint64(0xD6E8FEB86659FD93)
_KZ = np.uint64(0xC2B2AE3D27D4EB4F)
_KS = np.uint64(0x165667B19E3779F9)
_INV_2_53 = 1.0 / 9007199254740992.0


def _splitmix64(x: np.ndarray) -> np.ndarray:
    z = x + _GOLDEN
    z = (z ^ (z >> np.uint64(30))) * _MIX1
    z = (z ^ (z >> np.uint64(27))) * _MIX2
    return z ^ (z >> np.uint64(31))


def hash01(ix: np.ndarray | int, iz: np.ndarray | int, seed: int) -> np.ndarray:
    """Uniform [0, 1) value per integer lattice point, stable for a given seed."""
    ax = np.atleast_1d(np.asarray(ix, dtype=np.int64)).astype(np.uint64)
    az = np.atleast_1d(np.asarray(iz, dtype=np.int64)).astype(np.uint64)
    s = np.atleast_1d(np.asarray(seed, dtype=np.int64)).astype(np.uint64)
    h = _splitmix64(_splitmix64(ax * _KX) ^ (az * _KZ) ^ (s * _KS))
    return (h >> np.uint64(11)).astype(np.float64) * _INV_2_53


def smoothstep(e0: float, e1: float, x: np.ndarray) -> np.ndarray:
    """Cubic Hermite step from 0 at e0 to 1 at e1 (e1 < e0 is allowed and reverses it)."""
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def lerp(a: np.ndarray, b: np.ndarray | float, w: np.ndarray) -> np.ndarray:
    return a + (b - a) * w


def value_noise(x: np.ndarray, z: np.ndarray, wavelength: float, seed: int) -> np.ndarray:
    """Smooth value noise in [0, 1) with lattice spacing `wavelength` meters."""
    gx = x / wavelength
    gz = z / wavelength
    x0 = np.floor(gx)
    z0 = np.floor(gz)
    fx = gx - x0
    fz = gz - z0
    sx = fx * fx * (3.0 - 2.0 * fx)
    sz = fz * fz * (3.0 - 2.0 * fz)
    ix = x0.astype(np.int64)
    iz = z0.astype(np.int64)
    v00 = hash01(ix, iz, seed).reshape(x.shape)
    v10 = hash01(ix + 1, iz, seed).reshape(x.shape)
    v01 = hash01(ix, iz + 1, seed).reshape(x.shape)
    v11 = hash01(ix + 1, iz + 1, seed).reshape(x.shape)
    top = v00 + (v10 - v00) * sx
    bottom = v01 + (v11 - v01) * sx
    return top + (bottom - top) * sz


def unit(dx: float, dz: float) -> tuple[float, float]:
    n = float(np.sqrt(dx * dx + dz * dz))
    return dx / n, dz / n


def unit_directions(count_per_side: int) -> list[tuple[float, float]]:
    """Directions around a full turn without trigonometry: normalized points on a square's edge.

    Starts at north (0, -1) and runs clockwise (toward +x first).
    """
    n = count_per_side
    pts: list[tuple[int, int]] = []
    pts += [(i, -n) for i in range(0, n)]  # top edge, x 0..n-1
    pts += [(n, i) for i in range(-n, n)]  # right edge
    pts += [(i, n) for i in range(n, -n, -1)]  # bottom edge
    pts += [(-n, i) for i in range(n, -n, -1)]  # left edge
    pts += [(i, -n) for i in range(-n, 0)]  # back to the top
    return [unit(float(x), float(z)) for x, z in pts]
