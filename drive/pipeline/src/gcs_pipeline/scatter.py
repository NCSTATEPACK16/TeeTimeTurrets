"""Trees: a jittered grid over the woods nodes, species from the aerial's winter colors.

The aerial is a leaf-off (winter) image, so evergreen loblolly pines are green and the
hardwoods are brown. Placement uses integer hashes only (rng.hash01), like gce-dummy.
"""

from __future__ import annotations

import math

import numpy as np
import rasterio
from scipy import ndimage

from .layout import StageGrid
from .rng import hash01


def scatter(
    woods: np.ndarray,
    clear: np.ndarray,
    grid: StageGrid,
    cfg: dict,
    ortho_path,
    tees: np.ndarray | None = None,
) -> tuple[bytes, list[dict]]:
    c = cfg["scatter"]
    s = c["spacing_m"]
    seed = c["seed"]
    # Grid cells in the course frame, so a stage window never reshuffles trees that both stages share.
    i0, i1 = math.floor(grid.x0 / s), math.ceil((grid.x0 + grid.width - 1) / s)
    j0, j1 = math.floor(grid.z0 / s), math.ceil((grid.z0 + grid.height - 1) / s)
    ii, jj = np.meshgrid(np.arange(i0, i1 + 1, dtype=np.int64), np.arange(j0, j1 + 1, dtype=np.int64))
    ii, jj = ii.ravel(), jj.ravel()
    x = (ii + hash01(ii, jj, seed)) * s
    z = (jj + hash01(ii, jj, seed + 1)) * s
    col = np.rint(x - grid.x0).astype(np.int64)
    row = np.rint(z - grid.z0).astype(np.int64)
    inside = (col >= 0) & (col < grid.width) & (row >= 0) & (row < grid.height)
    col, row = np.clip(col, 0, grid.width - 1), np.clip(row, 0, grid.height - 1)
    far = ndimage.distance_transform_edt(~clear) > c["clear_of_play_m"]
    if tees is not None and tees.any():  # canopies stay off the tee boxes
        far &= ndimage.distance_transform_edt(~tees) > c["clear_of_tee_m"]
    sel = inside & woods[row, col] & far[row, col] & (hash01(ii, jj, seed + 2) < c["keep_fraction"])
    loc = cfg["location"]
    with rasterio.open(ortho_path) as src:
        e = loc["easting"] + x[sel]
        n = loc["northing"] - z[sel]
        rgb = np.array([v for v in src.sample(zip(e, n, strict=True))], dtype=np.float64).reshape(-1, 3)
    pine = np.zeros(len(x), dtype=bool)
    pine[np.flatnonzero(sel)] = (rgb[:, 1] - rgb[:, 0]) > c["pine_green_over_red"]
    scale = 0.8 + 0.4 * hash01(ii, jj, seed + 3)
    rot = hash01(ii, jj, seed + 4) * (2.0 * math.pi)
    cx, cz = grid.center
    chunks, species, offset = [], [], 0
    for name, mask in (("loblolly_pine", sel & pine), ("white_oak", sel & ~pine)):
        rec = np.stack([x[mask] - cx, z[mask] - cz, scale[mask], rot[mask]], axis=1).astype("<f4")
        chunks.append(rec.tobytes())
        species.append({"name": name, "count": int(rec.shape[0]), "byteOffset": offset})
        offset += rec.nbytes
    return b"".join(chunks), species
