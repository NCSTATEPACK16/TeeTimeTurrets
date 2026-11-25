"""Horizon skirt: a coarse, visual-only height grid around the course, out to a few kilometers.

Source: NC 2024 QL1 lidar, 20 ft county DEM (EPSG:6543 + NAVD88, US survey feet), the same
datum as the course DEM, so the two meet without a vertical shift.

The grid is square, `cell_m` apart, centered on the packet's world origin (the stage grid
center) and aligned so its nodes fall on whole multiples of `cell_m` in world space. Inside the
course rectangle the skirt takes the course's own heights, sunk by `sink_m`, so the course
terrain always draws over it. Outside, it blends from the course edge height to the measured
DEM over `blend_m` with a smoothstep, so there is no seam or cliff where the two meet.

Heights use their own u16 scale and offset, because 3 km of country has more relief than the
course's 1 mm scale allows.
"""

from __future__ import annotations

import math
import subprocess
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from scipy import ndimage

from .dem import NodeGrid, to_node_grid

FILE = "horizon.u16.bin"


@dataclass(frozen=True)
class HorizonGrid:
    """World-space horizon grid: node (row, col) at x = origin + col * cell, z = origin + row * cell."""

    cell: float
    n: int  # nodes per side

    @classmethod
    def around(cls, radius_m: float, cell_m: float) -> HorizonGrid:
        half = math.ceil(radius_m / cell_m)
        return cls(cell_m, 2 * half + 1)

    @property
    def origin(self) -> float:
        return -(self.n - 1) / 2 * self.cell

    def coords(self) -> tuple[np.ndarray, np.ndarray]:
        v = self.origin + np.arange(self.n, dtype=np.float64) * self.cell
        return np.meshgrid(v, v)


def smoothstep(e0: float, e1: float, x: np.ndarray) -> np.ndarray:
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def stitch(
    measured: np.ndarray, course_h: np.ndarray, hg: HorizonGrid, blend_m: float, sink_m: float
) -> np.ndarray:
    """Blend measured skirt heights into the course grid (world-centered, 1 m nodes, row 0 north)."""
    ch, cw = course_h.shape
    half_x, half_z = (cw - 1) / 2, (ch - 1) / 2
    x, z = hg.coords()
    # Course height at the nearest point of the course rectangle (clamped bilinear sample).
    cols = np.clip(x + half_x, 0, cw - 1)
    rows = np.clip(z + half_z, 0, ch - 1)
    edge = ndimage.map_coordinates(course_h, [rows, cols], order=1, mode="nearest")
    # Distance outside the course rectangle (0 inside).
    dx = np.maximum(np.abs(x) - half_x, 0.0)
    dz = np.maximum(np.abs(z) - half_z, 0.0)
    dist = np.hypot(dx, dz)
    w = smoothstep(0.0, blend_m, dist)
    out = edge * (1.0 - w) + measured * w
    inside = dist == 0.0
    out[inside] = edge[inside] - sink_m
    return out


def quantize(h: np.ndarray, scale: float) -> tuple[np.ndarray, float]:
    offset = float(math.floor(float(h.min())) - 1)
    q = np.rint((h - offset) / scale)
    if q.max() > 65535:
        raise ValueError(f"horizon relief {h.max() - h.min():.1f} m exceeds u16 at scale {scale}")
    return q.astype("<u2"), offset


def dem20_path(cfg: dict, repo: Path) -> Path:
    """The extracted 20 ft county raster; unzips it from the cached download on first use."""
    d = cfg["dem"]
    out_dir = repo / cfg["horizon"]["dem_dir"]
    found = sorted(out_dir.glob("*.tif")) if out_dir.exists() else []
    if found:
        return found[0]
    zip_path = repo / d["horizon_zip"]
    if not zip_path.exists():
        raise FileNotFoundError(f"{zip_path} missing: run gce-fetch-dem --course {cfg['id']}")
    out_dir.mkdir(parents=True, exist_ok=True)
    subprocess.run(["unzip", "-o", "-q", str(zip_path), "-d", str(out_dir)], check=True)
    found = sorted(out_dir.rglob("*.tif"))
    if not found:
        raise FileNotFoundError(f"no .tif in {zip_path}")
    return found[0]


def build(
    src: Path, loc: dict, center: tuple[float, float], course_h: np.ndarray, hcfg: dict
) -> tuple[np.ndarray, dict, np.ndarray]:
    """Returns (u16 grid, course.json `horizon` entry, decoded heights in meters).

    `center` is the stage grid center in the course frame (meters east, south of the pin).
    """
    hg = HorizonGrid.around(hcfg["radius_m"], hcfg["cell_m"])
    cx, cz = center
    grid = NodeGrid(loc["epsg"], loc["easting"] + cx, loc["northing"] - cz, hg.n, hg.n, cell=hg.cell)
    measured = to_node_grid(src, grid)
    h = stitch(measured, course_h, hg, hcfg["blend_m"], hcfg["sink_m"])
    u16, offset = quantize(h, hcfg["scale"])
    info = {
        "file": FILE,
        "cellSize": hg.cell,
        "width": hg.n,
        "height": hg.n,
        "originX": hg.origin,
        "originZ": hg.origin,
        "scale": hcfg["scale"],
        "offset": offset,
    }
    return u16, info, offset + u16.astype(np.float64) * hcfg["scale"]
