"""Course layout: authored outlines (overrides.geojson) plus aerial-derived woods, as node grids.

Everything here works in the course frame: meters east (x) and south (z) of the pin, which is
`location.easting/northing` in course.toml. A stage grid has a node at every integer (x, z) in
its bounds, row 0 at z0 (north), column 0 at x0 (west).
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import rasterio
from pyproj import Transformer
from rasterio.features import rasterize
from rasterio.transform import Affine
from rasterio.warp import Resampling, reproject
from scipy import ndimage
from shapely.geometry import LineString, Polygon, shape
from shapely.ops import transform as shp_transform

from .schema import material_id

SURFACES = ("green", "tee", "fairway", "bunker", "water", "cartpath", "woods", "rough")


@dataclass(frozen=True)
class StageGrid:
    x0: int
    z0: int
    width: int
    height: int

    @classmethod
    def from_bounds(cls, bounds: list[float]) -> StageGrid:
        x0, z0, x1, z1 = (round(v) for v in bounds)
        # Odd node counts keep the grid center on a node.
        w = x1 - x0 + 1 + (1 - (x1 - x0 + 1) % 2)
        h = z1 - z0 + 1 + (1 - (z1 - z0 + 1) % 2)
        return cls(x0, z0, w, h)

    @property
    def center(self) -> tuple[float, float]:
        return self.x0 + (self.width - 1) / 2, self.z0 + (self.height - 1) / 2

    def transform(self) -> Affine:
        """Course-frame transform with pixel centers on nodes (rows increase with z, i.e. south)."""
        return Affine(1.0, 0.0, self.x0 - 0.5, 0.0, 1.0, self.z0 - 0.5)

    def coords(self) -> tuple[np.ndarray, np.ndarray]:
        x = self.x0 + np.arange(self.width, dtype=np.float64)
        z = self.z0 + np.arange(self.height, dtype=np.float64)
        return np.meshgrid(x, z)


@dataclass
class Feature:
    id: str
    surface: str
    hole: int | None
    geom: Polygon | LineString
    props: dict = field(default_factory=dict)


def course_frame(cfg: dict):
    """(lon, lat) -> course frame (x east, z south of the pin) as a shapely-compatible function."""
    loc = cfg["location"]
    to_utm = Transformer.from_crs(4326, loc["epsg"], always_xy=True)
    e0, n0 = loc["easting"], loc["northing"]

    def fn(lon, lat, *_):
        e, n = to_utm.transform(lon, lat)
        return np.asarray(e) - e0, n0 - np.asarray(n)

    return fn


def load_overrides(cfg: dict, folder: Path) -> list[Feature]:
    data = json.loads((folder / cfg["layout"]["overrides"]).read_text(encoding="utf-8"))
    fn = course_frame(cfg)
    out = []
    for f in data["features"]:
        p = f["properties"]
        if p["surface"] not in SURFACES:
            raise ValueError(f"{p.get('id')}: unknown surface {p['surface']!r}")
        geom = shp_transform(fn, shape(f["geometry"]))
        if isinstance(geom, Polygon) and not geom.is_valid:
            raise ValueError(f"{p['id']}: invalid polygon")
        out.append(Feature(p["id"], p["surface"], p.get("hole"), geom, p))
    ids = [f.id for f in out]
    if len(ids) != len(set(ids)):
        raise ValueError("duplicate feature ids in overrides")
    return out


def surface_masks(features: list[Feature], grid: StageGrid) -> dict[str, np.ndarray]:
    """Boolean node masks per polygon surface (a node is in when its point is inside)."""
    masks = {}
    for s in {f.surface for f in features if isinstance(f.geom, Polygon)}:
        shapes = [(f.geom, 1) for f in features if f.surface == s and isinstance(f.geom, Polygon)]
        masks[s] = rasterize(
            shapes, out_shape=(grid.height, grid.width), transform=grid.transform(), fill=0, dtype="uint8"
        ).astype(bool)
    return masks


def woods_mask(cfg: dict, folder: Path, grid: StageGrid) -> np.ndarray:
    """Tree canopy at nodes, from the aerial: dark or textured pixels, majority per node."""
    w = cfg["layout"]["woods"]
    loc = cfg["location"]
    with rasterio.open(folder / cfg["aerial"]["out"]) as src:
        a = src.read().astype(np.float64)
        lum = a.mean(axis=0)
        k = w["texture_window_px"]
        mean = ndimage.uniform_filter(lum, k)
        sd = np.sqrt(np.maximum(ndimage.uniform_filter(lum * lum, k) - mean * mean, 0.0))
        canopy = ((lum < w["lum_max"]) | (sd > w["texture_min"])).astype(np.float32)
        # Average canopy fraction onto the node grid (UTM north-up, so flip z to northing).
        dst = np.zeros((grid.height, grid.width), dtype=np.float32)
        west = loc["easting"] + grid.x0 - 0.5
        north = loc["northing"] - (grid.z0 - 0.5)
        reproject(
            canopy,
            dst,
            src_transform=src.transform,
            src_crs=src.crs,
            dst_transform=Affine(1.0, 0.0, west, 0.0, -1.0, north),
            dst_crs=src.crs,
            resampling=Resampling.average,
        )
    mask = dst > 0.5
    mask = ndimage.binary_opening(mask, iterations=1)
    mask = ndimage.binary_closing(mask, iterations=2)
    lab, n = ndimage.label(mask)
    if n:
        sizes = ndimage.sum(mask, lab, index=np.arange(1, n + 1))
        mask = np.isin(lab, 1 + np.flatnonzero(sizes >= w["min_area_m2"]))
    return mask


def materials(
    masks: dict[str, np.ndarray], woods: np.ndarray, cfg: dict, shape_hw: tuple[int, int]
) -> np.ndarray:
    """Material IDs per node: rough, then woods, then authored surfaces by priority, plus a fringe ring."""
    mat = np.full(shape_hw, material_id("rough"), dtype=np.uint8)
    authored = np.zeros(shape_hw, dtype=bool)
    for m in masks.values():
        authored |= m
    mat[woods & ~authored] = material_id("woods")
    for s in cfg["layout"]["priority"]:
        if s in masks:
            mat[masks[s]] = material_id(s)
    if "green" in masks:
        r = cfg["layout"]["fringe_m"]
        dist = ndimage.distance_transform_edt(~masks["green"])
        ring = (dist > 0) & (dist <= r)
        keep = np.isin(mat, [material_id(s) for s in ("rough", "fairway", "woods")])
        mat[ring & keep] = material_id("fringe")
    return mat
