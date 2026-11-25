"""Elevation: NC 2024 QL1 lidar DEMs to the packet's 1 m node grid in meters.

Source rasters are NC State Plane (EPSG:6543, US survey feet) with NAVD88 heights in US survey
feet. Output grids follow the packet convention: W x H node samples centered on the course
origin, row 0 north (-Z), column 0 west (-X), heights in meters.

Steps: crop a square around the pin in the source CRS (so the 5 GB county raster never has to be
held in memory), reproject to UTM 17N on the node grid with bilinear sampling, convert feet to
meters, fill nodata from the nearest valid node, and take a 3x3 median to knock out single-node
spikes and pits (vegetation or bridge returns the ground filter missed). Real depressions such
as ponds and bunkers are wider than 3 nodes, so the median keeps them.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import rasterio
from pyproj import Transformer
from rasterio.transform import Affine
from rasterio.warp import Resampling, reproject
from rasterio.windows import Window, from_bounds
from scipy import ndimage

US_SURVEY_FOOT = 1200.0 / 3937.0  # meters
SOURCE_EPSG = 6543  # NAD83(2011) / North Carolina (ftUS)


@dataclass(frozen=True)
class NodeGrid:
    """A packet node grid: width x height nodes, `cell` meters apart, centered on (easting, northing)."""

    epsg: int
    easting: float
    northing: float
    width: int
    height: int
    cell: float = 1.0

    def transform(self) -> Affine:
        """Pixel-is-area transform whose pixel centers are the nodes; row 0 is the north edge."""
        west = self.easting - (self.width - 1) / 2 * self.cell - self.cell / 2
        north = self.northing + (self.height - 1) / 2 * self.cell + self.cell / 2
        return Affine(self.cell, 0.0, west, 0.0, -self.cell, north)

    def bounds(self, margin: float = 0.0) -> tuple[float, float, float, float]:
        """(west, south, east, north) of the node extent plus margin, in the grid's CRS."""
        hx = (self.width - 1) / 2 * self.cell + margin
        hz = (self.height - 1) / 2 * self.cell + margin
        return self.easting - hx, self.northing - hz, self.easting + hx, self.northing + hz


def crop_source(src_path: Path, dst_path: Path, grid: NodeGrid, margin: float = 50.0) -> Window:
    """Copy the part of a source DEM that covers `grid` (plus margin, meters) to a new GeoTIFF."""
    to_src = Transformer.from_crs(grid.epsg, SOURCE_EPSG, always_xy=True)
    west, south, east, north = grid.bounds(margin)
    xs, ys = to_src.transform([west, east, east, west], [south, south, north, north])
    with rasterio.open(src_path) as src:
        f = from_bounds(min(xs), min(ys), max(xs), max(ys), src.transform)
        c0, r0 = max(math.floor(f.col_off), 0), max(math.floor(f.row_off), 0)
        c1 = min(math.ceil(f.col_off + f.width), src.width)
        r1 = min(math.ceil(f.row_off + f.height), src.height)
        if c1 <= c0 or r1 <= r0:
            raise ValueError(f"{src_path} does not cover the requested grid")
        win = Window(c0, r0, c1 - c0, r1 - r0)
        data = src.read(1, window=win)
        profile = src.profile | {
            "width": int(win.width),
            "height": int(win.height),
            "transform": src.window_transform(win),
            "compress": "deflate",
            "predictor": 3,
            "tiled": True,
            "blockxsize": 256,
            "blockysize": 256,
            "BIGTIFF": "IF_SAFER",
        }
    dst_path.parent.mkdir(parents=True, exist_ok=True)
    with rasterio.open(dst_path, "w", **profile) as dst:
        dst.write(data, 1)
    return win


def to_node_grid(src_path: Path, grid: NodeGrid, vertical_scale: float = US_SURVEY_FOOT) -> np.ndarray:
    """Heights in meters on the node grid (float64, row 0 north). Raises if the source misses it."""
    with rasterio.open(src_path) as src:
        src_crs = src.crs if src.crs is not None else rasterio.crs.CRS.from_epsg(SOURCE_EPSG)
        nodata = src.nodata
        dst = np.full((grid.height, grid.width), np.nan, dtype=np.float64)
        reproject(
            source=rasterio.band(src, 1),
            destination=dst,
            src_crs=src_crs,
            src_nodata=nodata,
            dst_transform=grid.transform(),
            dst_crs=rasterio.crs.CRS.from_epsg(grid.epsg),
            dst_nodata=np.nan,
            resampling=Resampling.bilinear,
        )
    valid = np.isfinite(dst)
    if not valid.any():
        raise ValueError(f"{src_path} does not cover the requested grid")
    if valid.mean() < 0.99:
        raise ValueError(f"{src_path} covers only {valid.mean():.1%} of the requested grid")
    return clean(dst * vertical_scale)


def clean(heights: np.ndarray) -> np.ndarray:
    """Fill NaN nodes from the nearest valid node, then a 3x3 median."""
    missing = ~np.isfinite(heights)
    if missing.any():
        _, (rows, cols) = ndimage.distance_transform_edt(missing, return_indices=True)
        heights = heights[rows, cols]
    return ndimage.median_filter(heights, size=3, mode="nearest")
