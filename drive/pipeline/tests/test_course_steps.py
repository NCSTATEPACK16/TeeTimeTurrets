"""Course pipeline steps on small synthetic fixtures: layout, sculpt, paths and QA poses."""

from __future__ import annotations

import math

import numpy as np
import pytest
from scipy import ndimage
from shapely.geometry import LineString, Polygon

from gcs_pipeline import layout, paths, qa, sculpt
from gcs_pipeline.heightmap import sample_height, triangle_slopes
from gcs_pipeline.schema import material_id

CFG_SCULPT = {
    "base_sigma_m": 0.8,
    "feather_m": 6.0,
    "fairway_sigma_m": 3.0,
    "rough_sigma_m": 1.5,
    "green_max_slope": 0.027,
    "green_max_tilt": 0.02,
    "green_undulation_sigma_m": 3.0,
    "green_pad_m": 3.0,
    "tee_max_tilt": 0.01,
    "tee_pad_m": 1.5,
    "bunker_depth_m": 0.5,
    "bunker_ramp_m": 2.0,
    "bunker_lip_sigma_m": 4.0,
    "water_freeboard_m": 0.25,
    "water_shelf_depth_m": 0.35,
    "water_shelf_width_m": 2.0,
    "water_max_depth_m": 2.0,
    "water_deep_from_m": 6.0,
    "drivable_max_slope": 0.33,
    "relax_iterations": 60,
}
CFG_PATHS = {
    "width_m": 2.4,
    "flat_half_m": 1.5,
    "sample_m": 0.25,
    "max_grade": 0.09,
    "profile_smooth_m": 8.0,
    "spline_step_m": 1.0,
    "edge_margin_m": 3.0,
    "join_snap_m": 4.0,
    "junction_pad_m": 4.0,
}


def _bumpy(n: int = 121, seed: int = 3) -> np.ndarray:
    """A tilted plane (6%) with bumps up to ~1 m, the sort of ground lidar gives."""
    rng = np.random.default_rng(seed)
    z, x = np.mgrid[0:n, 0:n].astype(float)
    h = 100.0 + 0.06 * x + 0.02 * z
    for _ in range(12):
        cx, cz, r, a = rng.uniform(0, n), rng.uniform(0, n), rng.uniform(6, 15), rng.uniform(-1, 1)
        h += a * np.exp(-((x - cx) ** 2 + (z - cz) ** 2) / (2 * r * r))
    return h


def _disc(n: int, cx: float, cz: float, r: float) -> np.ndarray:
    z, x = np.mgrid[0:n, 0:n]
    return (x - cx) ** 2 + (z - cz) ** 2 <= r * r


def _cells(mask: np.ndarray) -> np.ndarray:
    return mask[:-1, :-1] & mask[:-1, 1:] & mask[1:, :-1] & mask[1:, 1:]


# --- layout -------------------------------------------------------------------------------


def test_stage_grid_has_odd_sizes_and_node_centers() -> None:
    g = layout.StageGrid.from_bounds([-10.0, 5.0, 10.0, 26.0])
    assert (g.width % 2, g.height % 2) == (1, 1)
    assert g.transform() @ (0.5, 0.5) == (-10.0, 5.0)
    x, z = g.coords()
    assert x[0, 0] == -10 and z[-1, 0] == 5 + g.height - 1


def test_rasterize_priority_and_fringe() -> None:
    g = layout.StageGrid.from_bounds([0.0, 0.0, 40.0, 40.0])
    feats = [
        layout.Feature("fw", "fairway", 1, Polygon([(2, 2), (38, 2), (38, 38), (2, 38)])),
        layout.Feature("gr", "green", 1, Polygon([(10, 10), (20, 10), (20, 20), (10, 20)])),
        layout.Feature("bk", "bunker", 1, Polygon([(18, 12), (24, 12), (24, 18), (18, 18)])),
    ]
    masks = layout.surface_masks(feats, g)
    woods = np.zeros((g.height, g.width), bool)
    woods[30:, 30:] = True  # under the fairway: authored ground wins
    woods[0, 0] = True
    cfg = {"layout": {"priority": ["fairway", "tee", "green", "bunker", "water"], "fringe_m": 1.5}}
    mat = layout.materials(masks, woods, cfg, (g.height, g.width))
    assert mat[15, 15] == material_id("green")
    assert mat[15, 20] == material_id("bunker")  # bunker beats green where they overlap
    first = int(np.flatnonzero(masks["green"][15])[0])
    assert mat[15, first - 1] == material_id("fringe")
    assert mat[15, 25] == material_id("fairway")  # bunker edge: no fringe ring over sand
    assert mat[35, 35] == material_id("fairway")
    assert mat[0, 0] == material_id("woods")
    assert mat[0, 40] == material_id("rough")


# --- sculpt -------------------------------------------------------------------------------


def test_greens_meet_the_slope_cap_on_steep_ground() -> None:
    h = _bumpy()
    green = _disc(121, 60, 60, 12)
    out = sculpt.sculpt(h, {"green": green}, CFG_SCULPT).heights
    assert sculpt.max_cell_slope(out, green) <= 0.027
    assert sculpt.max_cell_slope(h, green) > 0.03  # it really had to work


def test_tees_are_nearly_flat_and_bunkers_are_bowls() -> None:
    h = _bumpy()
    tee = np.zeros(h.shape, bool)
    tee[20:30, 20:50] = True
    bunker = _disc(121, 90, 90, 5)
    out = sculpt.sculpt(h, {"tee": tee, "bunker": bunker}, CFG_SCULPT).heights
    assert sculpt.max_cell_slope(out, tee) <= 0.0101
    rim = (~bunker) & _disc(121, 90, 90, 8)
    assert out[90, 90] < out[rim].mean() - 0.3


def test_water_is_flat_under_its_shore_with_a_shelf() -> None:
    n = 121
    _, x = np.mgrid[0:n, 0:n].astype(float)
    h = 100.0 + 0.02 * x  # gentle slope
    water = _disc(n, 60, 60, 18)
    r = sculpt.sculpt(h, {"water": water}, CFG_SCULPT)
    (level,) = r.water_levels
    shore = (~water) & _disc(n, 60, 60, 20)
    assert (r.heights[shore] > level).all()
    depth = level - r.heights[water]
    assert (depth > 0).all()
    assert 1.5 <= depth.max() <= 2.5
    assert ((depth > 0.2) & (depth < 0.5)).sum() > 50  # a wading shelf


def test_relax_removes_cliffs_but_never_moves_fixed_nodes() -> None:
    h = np.zeros((40, 40))
    h[:, 20:] = 3.0  # a 3 m step
    fixed = np.zeros(h.shape, bool)
    fixed[:5] = True
    out, steep = sculpt.relax(h, fixed, 0.33, 200)
    lower, upper = triangle_slopes(out)
    free = ~(fixed[:-1, :-1] | fixed[:-1, 1:] | fixed[1:, :-1] | fixed[1:, 1:])
    assert max(lower[free].max(), upper[free].max()) <= 0.33 or steep.any()
    assert np.array_equal(out[fixed], h[fixed])


def test_sculpt_leaves_nothing_drivable_over_the_cap() -> None:
    h = _bumpy(seed=9)
    h[40:45, :] += np.linspace(0, 2.5, 5)[:, None]  # a bank
    r = sculpt.sculpt(h, {"green": _disc(121, 80, 30, 10)}, CFG_SCULPT)
    lower, upper = triangle_slopes(r.heights)
    ok = ~(r.embankment[:-1, :-1] | r.embankment[:-1, 1:] | r.embankment[1:, :-1] | r.embankment[1:, 1:])
    assert max(lower[ok].max(), upper[ok].max()) <= 0.33


# --- paths --------------------------------------------------------------------------------


def _path_checks(h: np.ndarray, entry: dict) -> tuple[float, float, float]:
    p = np.array(entry["points"])
    x, z = p[:, 0], p[:, 2]
    ground = sample_height(h, x, z)
    step = np.hypot(np.diff(x), np.diff(z))
    grade = np.abs(np.diff(ground)) / step
    tx, tz = np.gradient(x), np.gradient(z)
    n = np.hypot(tx, tz)
    nx, nz = -tz / n, tx / n
    cross = np.abs(sample_height(h, x + nx, z + nz) - sample_height(h, x - nx, z - nz)) / 2
    return float(grade.max()), float(cross.max()), float(np.abs(ground - p[:, 1]).max())


def test_catmull_rom_passes_through_vertices() -> None:
    pts = np.array([[0.0, 0.0], [10.0, 0.0], [20.0, 10.0], [20.0, 30.0]])
    curve = paths.catmull_rom(pts, 0.5)
    for p in pts:
        assert np.min(np.hypot(*(curve - p).T)) < 1e-9


def test_paths_meet_grade_and_cross_slope_with_a_branch() -> None:
    g = layout.StageGrid.from_bounds([0.0, 0.0, 160.0, 160.0])
    h = _bumpy(161, seed=5)
    feats = [
        layout.Feature("a-main", "cartpath", 1, LineString([(10, 80), (60, 70), (100, 90), (150, 85)])),
        layout.Feature("b-branch", "cartpath", 1, LineString([(61, 72), (70, 120), (80, 150)])),
    ]
    out, dist, entries = paths.build(h, feats, g, CFG_PATHS)
    assert [e["id"] for e in entries] == ["a-main", "b-branch"]
    for e in entries:
        grade, cross, dev = _path_checks(out, e)
        assert grade <= 0.12, (e["id"], grade)
        assert cross <= 0.02, (e["id"], cross)
        assert dev < 0.05, (e["id"], dev)
    assert np.isfinite(dist).any() and dist.min() < 0.5


@pytest.mark.parametrize(
    ("name", "trunk", "branch"),
    [
        # A T: the branch leaves square off the trunk, across the 6% tilt.
        ("tee", [(10, 40), (150, 40)], [(80, 41), (80, 150)]),
        # A Y: the branch leaves at about 35 degrees, running down the slope.
        ("wye", [(10, 40), (150, 40)], [(70, 41), (110, 70), (140, 150)]),
        # End to end: the connector carries on from the trunk's end and turns away.
        ("end", [(10, 40), (80, 40)], [(80, 40), (120, 60), (130, 150)]),
        # A crossing: the second path runs straight over the first.
        ("cross", [(10, 80), (150, 80)], [(80, 10), (80, 150)]),
        # A near miss (hole 6 by hole 7): the second path runs ~3 m beside the first, then leaves.
        ("near", [(10, 40), (150, 40)], [(30, 150), (50, 50), (60, 43.2), (95, 43.2), (110, 60), (120, 150)]),
    ],
)
def test_junction_pads_keep_both_paths_level_across(name, trunk, branch) -> None:
    """Junctions on a tilted, bumpy plane: grade <= 12% and cross-slope <= 2% on both paths, and
    the branch carries on from the trunk (no gap, no step) wherever the two meet."""
    g = layout.StageGrid.from_bounds([0.0, 0.0, 160.0, 160.0])
    h = _bumpy(161, seed=11)
    feats = [
        layout.Feature("h01-trunk", "cartpath", 1, LineString(trunk)),
        layout.Feature("conn-branch", "cartpath", None, LineString(branch)),
    ]
    out, _, entries = paths.build(h, feats, g, CFG_PATHS)
    assert [e["id"] for e in entries] == ["h01-trunk", "conn-branch"], name
    for e in entries:
        grade, cross, dev = _path_checks(out, e)
        assert grade <= 0.12, (name, e["id"], grade)
        assert cross <= 0.02, (name, e["id"], cross)
        assert dev < 0.05, (name, e["id"], dev)
    # The branch's first kept point is within a few meters of the trunk's corridor, at its height.
    a = np.array(entries[0]["points"])
    b = np.array(entries[1]["points"])
    gap = np.min(np.hypot(*(a[:, [0, 2]][:, None, :] - b[:, [0, 2]][None, :, :]).T), axis=0)
    first = int(np.argmin(gap))
    assert gap[first] <= 3.5, (name, gap[first])
    assert abs(sample_height(out, b[first, 0], b[first, 2]) - b[first, 1]) < 0.05


def test_hole_paths_build_before_connectors() -> None:
    """A connector sorts before 'h..' by id, but must still be the branch."""
    g = layout.StageGrid.from_bounds([0.0, 0.0, 160.0, 160.0])
    h = _bumpy(161, seed=2)
    feats = [
        layout.Feature("conn-a", "cartpath", None, LineString([(80, 41), (80, 150)])),
        layout.Feature("h02-path", "cartpath", 2, LineString([(10, 40), (150, 40)])),
    ]
    _, _, entries = paths.build(h, feats, g, CFG_PATHS)
    assert [e["id"] for e in entries] == ["h02-path", "conn-a"]


# --- qa -----------------------------------------------------------------------------------


def test_drive_start_finds_the_long_flat_straight() -> None:
    n = 201
    _, x = np.mgrid[0:n, 0:n].astype(float)
    h = 100.0 + 0.08 * np.sin(x / 9.0) * 10  # rolling everywhere...
    h[95:106, 20:190] = 100.0  # ...except a flat east-west strip
    mat = np.full(h.shape, material_id("rough"), np.uint8)
    mat[90:111, :] = material_id("fairway")
    pose = qa.drive_start(
        h,
        mat,
        {
            "drive_surfaces": ["fairway"],
            "drive_max_grade": 0.03,
            "drive_max_cross": 0.02,
            "drive_cross_half_m": 1.5,
            "drive_headings_deg": 5.0,
            "drive_start_step_m": 4.0,
        },
    )
    assert pose["runM"] >= 150
    assert pose["headingDeg"] in (90.0, 270.0)
    assert abs(pose["z"]) <= 5


def test_probes_sit_inside_their_material() -> None:
    mat = np.full((50, 50), material_id("rough"), np.uint8)
    mat[10:30, 10:30] = material_id("green")
    mat[40:48, 5:9] = material_id("bunker")
    probes = qa.probes(mat)
    assert {p["material"] for p in probes} == {"rough", "green", "bunker"}
    for p in probes:
        r, c = int(p["z"] + 24.5), int(p["x"] + 24.5)
        assert mat[r, c] == material_id(p["material"])


@pytest.mark.parametrize("heading", [0.0, 90.0])
def test_drive_start_heading_convention(heading: float) -> None:
    """Heading 0 runs north (-z, up the rows); 90 runs east (+x)."""
    n = 101
    h = np.full((n, n), 100.0)
    mat = np.full(h.shape, material_id("rough"), np.uint8)
    if heading == 0.0:
        mat[:, 48:53] = material_id("fairway")
    else:
        mat[48:53, :] = material_id("fairway")
    pose = qa.drive_start(
        h,
        mat,
        {
            "drive_surfaces": ["fairway"],
            "drive_max_grade": 0.03,
            "drive_max_cross": 0.02,
            "drive_cross_half_m": 1.0,
            "drive_headings_deg": 90.0,
            "drive_start_step_m": 1.0,
        },
    )
    dx, dz = math.sin(math.radians(pose["headingDeg"])), -math.cos(math.radians(pose["headingDeg"]))
    assert (abs(dx), abs(dz)) == pytest.approx((1.0, 0.0) if heading == 90.0 else (0.0, 1.0), abs=1e-9)


def _pond_with_shelf(n: int = 161):
    """Flat ground, a 30 m pond in the middle and a 24 m wading shelf on its west side."""
    h = np.full((n, n), 100.0)
    water = _disc(n, 80, 80, 30)
    wade = water & (np.mgrid[0:n, 0:n][1] < 80 - 2) & _disc(n, 60, 80, 22)
    cfg = CFG_SCULPT | {"water_wade_depth_m": 0.5, "water_wade_feather_m": 4.0}
    r = sculpt.shape_water(h, water, cfg, wade)
    return r, water, wade


QA_WATER = {
    "drive_headings_deg": 5.0,
    "drive_max_grade": 0.04,
    "water_entry_before_m": 4.0,
    "water_entry_probe_m": 20.0,
    "water_entry_depth": [0.45, 0.55],
    "deep_water_min_m": 1.2,
}


def test_wading_shelf_is_flat_at_half_a_meter() -> None:
    (out, levels, _labels), water, wade = _pond_with_shelf()
    depth = levels[0] - out
    inner = ndimage.binary_erosion(wade, iterations=6)
    assert inner.any()
    assert depth[inner] == pytest.approx(0.5, abs=0.02)
    assert (
        depth[water & ~ndimage.binary_dilation(wade, iterations=8)].max() > 1.5
    )  # the rest keeps its deep bed


def test_water_entry_reads_half_a_meter_twenty_meters_in() -> None:
    (out, levels, labels), _, wade = _pond_with_shelf()
    pose = qa.water_entry(out, labels, levels, wade, QA_WATER)
    assert pose is not None
    n = out.shape[0]
    col, row = round(pose["x"] + (n - 1) / 2), round(pose["z"] + (n - 1) / 2)
    assert labels[row, col] == 0  # starts dry
    assert 0.45 <= pose["depthAhead"] <= 0.55
    assert 45.0 <= pose["headingDeg"] <= 135.0  # from the west shore, heading roughly east


def test_deep_water_is_the_deepest_point_or_none() -> None:
    (out, levels, labels), _, _ = _pond_with_shelf()
    pose = qa.deep_water(out, labels, levels, QA_WATER)
    assert pose is not None
    n = out.shape[0]
    assert levels[0] - out[round(pose["z"] + (n - 1) / 2), round(pose["x"] + (n - 1) / 2)] >= 1.2
    assert qa.deep_water(out, labels, levels, QA_WATER | {"deep_water_min_m": 9.0}) is None
