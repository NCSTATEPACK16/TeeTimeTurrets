"""Grid conventions and height sampling shared by generators and tests.

Grids are W x H node samples, row-major, row 0 = north. Node (row, col) sits at world
x = col - (W-1)/2, z = row - (H-1)/2 (1 m spacing, north = -Z). Each cell is split into
two triangles along the diagonal from (row, col+1) to (row+1, col), which is how Rapier's
heightfield triangulates; sampling here matches the game's collider exactly.
"""

from __future__ import annotations

import numpy as np


def node_coords(width: int, height: int) -> tuple[np.ndarray, np.ndarray]:
    """World x and z of every node as (height, width) float64 arrays."""
    xs = np.arange(width, dtype=np.float64) - (width - 1) / 2
    zs = np.arange(height, dtype=np.float64) - (height - 1) / 2
    x, z = np.meshgrid(xs, zs)
    return x, z


def sample_height(h: np.ndarray, x: np.ndarray | float, z: np.ndarray | float) -> np.ndarray:
    """Height at world (x, z) by triangle interpolation; clamps to the grid edge."""
    rows, cols = h.shape
    col = np.clip(np.asarray(x, dtype=np.float64) + (cols - 1) / 2, 0.0, cols - 1.0)
    row = np.clip(np.asarray(z, dtype=np.float64) + (rows - 1) / 2, 0.0, rows - 1.0)
    c0 = np.minimum(np.floor(col).astype(np.int64), cols - 2)
    r0 = np.minimum(np.floor(row).astype(np.int64), rows - 2)
    u = col - c0
    v = row - r0
    h00 = h[r0, c0]
    h01 = h[r0, c0 + 1]
    h10 = h[r0 + 1, c0]
    h11 = h[r0 + 1, c0 + 1]
    lower = h00 + u * (h01 - h00) + v * (h10 - h00)
    upper = h11 + (1.0 - u) * (h10 - h11) + (1.0 - v) * (h01 - h11)
    return np.where(u + v <= 1.0, lower, upper)


def triangle_slopes(h: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Slope (rise over run) of the two triangles in every cell, each shaped (H-1, W-1).

    Lower triangle: (r, c), (r, c+1), (r+1, c). Upper: (r, c+1), (r+1, c+1), (r+1, c).
    """
    h00 = h[:-1, :-1]
    h01 = h[:-1, 1:]
    h10 = h[1:, :-1]
    h11 = h[1:, 1:]
    lower = np.sqrt((h01 - h00) ** 2 + (h10 - h00) ** 2)
    upper = np.sqrt((h11 - h10) ** 2 + (h11 - h01) ** 2)
    return lower, upper
