"""horizon.py on synthetic fixtures: grid placement, stitching to the course edge, quantization."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest
from test_dem import FT, PIN, _write_source

from gcs_pipeline import horizon
from gcs_pipeline.horizon import HorizonGrid, quantize, stitch


def test_grid_is_centered_and_cell_aligned() -> None:
    hg = HorizonGrid.around(3000.0, 10.0)
    assert hg.n == 601
    assert hg.origin == -3000.0
    x, z = hg.coords()
    assert x[0, 0] == -3000.0 and x[0, -1] == 3000.0 and z[-1, 0] == 3000.0
    assert x[0, 300] == 0.0  # a node on the world origin


def test_stitch_matches_course_inside_and_dem_far_out() -> None:
    hg = HorizonGrid.around(200.0, 10.0)
    course = np.full((41, 61), 180.0)  # 60 x 40 m course, flat at 180 m
    measured = np.full((hg.n, hg.n), 150.0)  # the countryside, 30 m lower
    out = stitch(measured, course, hg, blend_m=100.0, sink_m=0.5)
    x, z = hg.coords()
    inside = (np.abs(x) <= 30) & (np.abs(z) <= 20)
    assert out[inside] == pytest.approx(179.5)
    far = np.hypot(np.maximum(np.abs(x) - 30, 0), np.maximum(np.abs(z) - 20, 0)) >= 100
    assert out[far] == pytest.approx(150.0)
    # Monotone, seam-free ramp east of the course along z = 0.
    row = out[hg.n // 2, hg.n // 2 + 3 :]
    assert np.all(np.diff(row) <= 1e-9)
    assert row[0] == pytest.approx(180.0, abs=0.5)


def test_stitch_follows_course_edge_heights() -> None:
    hg = HorizonGrid.around(100.0, 10.0)
    course = np.tile(np.linspace(170.0, 190.0, 41), (21, 1))  # rises 20 m west to east
    out = stitch(np.full((hg.n, hg.n), 0.0), course, hg, blend_m=1000.0, sink_m=0.0)
    mid = hg.n // 2
    # Just outside the west and east edges the skirt starts at the course's own edge height.
    assert out[mid, mid - 3] == pytest.approx(170.0, abs=0.3)
    assert out[mid, mid + 3] == pytest.approx(190.0, abs=0.3)


def test_quantize_round_trips_and_rejects_overflow() -> None:
    h = np.array([[100.2, 140.0], [180.7, 120.0]])
    q, offset = quantize(h, 0.002)
    assert offset == 99.0
    assert offset + q.astype(float) * 0.002 == pytest.approx(h, abs=0.001)
    with pytest.raises(ValueError):
        quantize(np.array([[0.0, 200.0]]), 0.001)


def test_build_reads_feet_and_writes_schema_entry(tmp_path: Path) -> None:
    src = tmp_path / "dem20.tif"
    _write_source(src, lambda x, y: np.full_like(x, 500.0), size_ft=3000.0, px_ft=20.0)
    course = np.full((21, 21), 152.4)
    cfg = {"radius_m": 300.0, "cell_m": 10.0, "blend_m": 50.0, "sink_m": 0.5, "scale": 0.002}
    loc = {"epsg": 32617, "easting": PIN[0], "northing": PIN[1]}
    u16, info, h = horizon.build(src, loc, (0.0, 0.0), course, cfg)
    assert u16.shape == (61, 61) and u16.dtype == np.dtype("<u2")
    assert info == {
        "file": "horizon.u16.bin",
        "cellSize": 10.0,
        "width": 61,
        "height": 61,
        "originX": -300.0,
        "originZ": -300.0,
        "scale": 0.002,
        "offset": info["offset"],
    }
    assert h[0, 0] == pytest.approx(500.0 * FT, abs=0.002)
    assert h[30, 30] == pytest.approx(152.4 - 0.5, abs=0.002)
