"""dem.py on small synthetic State Plane rasters: units, orientation, cropping and cleanup."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest
import rasterio
from pyproj import Transformer
from rasterio.transform import from_origin

from gcs_pipeline.dem import SOURCE_EPSG, US_SURVEY_FOOT, NodeGrid, clean, crop_source, to_node_grid

PIN = (650634.0, 4033909.0)  # Caswell Pines, UTM 17N
FT = US_SURVEY_FOOT


def _write_source(path: Path, height_ft, size_ft: float = 1200.0, px_ft: float = 3.125, nodata=None) -> None:
    """A square State Plane DEM centered on the pin; height_ft(x_ft, y_ft) in State Plane feet."""
    cx, cy = Transformer.from_crs(32617, SOURCE_EPSG, always_xy=True).transform(*PIN)
    n = int(size_ft / px_ft)
    west, north = cx - size_ft / 2, cy + size_ft / 2
    cols = west + (np.arange(n) + 0.5) * px_ft
    rows = north - (np.arange(n) + 0.5) * px_ft
    xx, yy = np.meshgrid(cols, rows)
    data = height_ft(xx - cx, yy - cy).astype(np.float32)
    profile = {
        "driver": "GTiff",
        "width": n,
        "height": n,
        "count": 1,
        "dtype": "float32",
        "crs": f"EPSG:{SOURCE_EPSG}",
        "transform": from_origin(west, north, px_ft, px_ft),
        "nodata": nodata,
    }
    with rasterio.open(path, "w", **profile) as dst:
        dst.write(data, 1)


def test_node_grid_transform_puts_pixel_centers_on_nodes() -> None:
    g = NodeGrid(32617, *PIN, width=5, height=3, cell=1.0)
    t = g.transform()
    # Node (row 0, col 0) is the north-west node: 2 m west, 1 m north of the center.
    assert t @ (0.5, 0.5) == pytest.approx((PIN[0] - 2.0, PIN[1] + 1.0))
    assert t @ (4.5, 2.5) == pytest.approx((PIN[0] + 2.0, PIN[1] - 1.0))
    assert g.bounds() == pytest.approx((PIN[0] - 2, PIN[1] - 1, PIN[0] + 2, PIN[1] + 1))


def test_flat_source_converts_feet_to_meters(tmp_path: Path) -> None:
    src = tmp_path / "flat.tif"
    _write_source(src, lambda x, y: np.full_like(x, 500.0))
    h = to_node_grid(src, NodeGrid(32617, *PIN, width=101, height=101))
    assert h.shape == (101, 101)
    assert h == pytest.approx(500.0 * FT, abs=1e-4)  # 152.400 m


def test_orientation_row0_north_col0_west(tmp_path: Path) -> None:
    """A plane rising 1 ft per ft to the east and 0.5 ft per ft to the north."""
    src = tmp_path / "plane.tif"
    _write_source(src, lambda x, y: 600.0 + 0.10 * x + 0.05 * y)
    h = to_node_grid(src, NodeGrid(32617, *PIN, width=201, height=201))
    center = h[100, 100]
    east = h[100, 150] - center  # 50 m east
    north = h[50, 100] - center  # 50 m north (row decreases)
    # Slopes are unit-free, so 50 m of run gives 5 m and 2.5 m of rise, give or take the
    # ~1.3 degree grid convergence between State Plane and UTM.
    assert east == pytest.approx(5.0, abs=0.15)
    assert north == pytest.approx(2.5, abs=0.15)
    assert center == pytest.approx(600.0 * FT, abs=0.05)


def test_crop_then_grid_matches_full_source(tmp_path: Path) -> None:
    src = tmp_path / "hill.tif"
    _write_source(src, lambda x, y: 550.0 + 20.0 * np.exp(-(x * x + y * y) / 200.0**2), size_ft=2400.0)
    grid = NodeGrid(32617, *PIN, width=121, height=121)
    crop = tmp_path / "crop.tif"
    win = crop_source(src, crop, grid, margin=20.0)
    with rasterio.open(src) as full:
        assert win.width < full.width and win.height < full.height
    # GDAL warps the two rasters in different chunks, so allow float noise.
    assert np.allclose(to_node_grid(crop, grid), to_node_grid(src, grid), rtol=0, atol=1e-6)


def test_grid_outside_source_raises(tmp_path: Path) -> None:
    src = tmp_path / "small.tif"
    _write_source(src, lambda x, y: np.full_like(x, 500.0), size_ft=300.0)
    with pytest.raises(ValueError, match="covers only"):
        to_node_grid(src, NodeGrid(32617, *PIN, width=201, height=201))


def test_clean_fills_holes_and_removes_spikes_keeps_wide_dips() -> None:
    h = np.full((40, 40), 100.0)
    h[10, 10] = 130.0  # a missed tree return
    h[20, 30] = np.nan
    h[25:35, 5:15] = 98.0  # a 10 m wide pond bed
    out = clean(h)
    assert np.isfinite(out).all()
    assert out[10, 10] == 100.0
    assert out[20, 30] == 100.0
    assert out[30, 10] == 98.0
