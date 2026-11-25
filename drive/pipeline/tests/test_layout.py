"""The dummy course already meets the PRD's sculpt limits, so M0 tests mirror M2's checks."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from gcs_pipeline.heightmap import sample_height, triangle_slopes
from gcs_pipeline.packet import read_packet
from gcs_pipeline.schema import material_id, material_names


@pytest.fixture(scope="module")
def packet(generated: Path) -> dict:
    return read_packet(generated)


def _cells_all(mask: np.ndarray) -> np.ndarray:
    """Cells whose four corner nodes all satisfy mask."""
    return mask[:-1, :-1] & mask[:-1, 1:] & mask[1:, :-1] & mask[1:, 1:]


def _cells_any(mask: np.ndarray) -> np.ndarray:
    return mask[:-1, :-1] | mask[:-1, 1:] | mask[1:, :-1] | mask[1:, 1:]


def _material_at(packet: dict, x: float, z: float) -> str:
    m = packet["material"]
    rows, cols = m.shape
    c = int(np.floor(x + (cols - 1) / 2 + 0.5))
    r = int(np.floor(z + (rows - 1) / 2 + 0.5))
    return material_names()[int(m[r, c])]


def test_required_surfaces(packet: dict) -> None:
    present = {material_names()[i] for i in np.unique(packet["material"])}
    required = {"rough", "fairway", "fringe", "green", "tee", "bunker", "water", "cartpath", "woods"}
    assert required <= present, f"missing: {required - present}"


def test_green_slope_le_3pct(packet: dict) -> None:
    lower, upper = triangle_slopes(packet["heights"])
    cells = _cells_all(packet["material"] == material_id("green"))
    assert cells.any()
    worst = max(lower[cells].max(), upper[cells].max())
    assert worst <= 0.03, f"green slope {worst:.4f}"


def test_drivable_slope_le_35pct(packet: dict) -> None:
    lower, upper = triangle_slopes(packet["heights"])
    steep_ok = _cells_any(packet["material"] == material_id("embankment"))
    worst = max(lower[~steep_ok].max(), upper[~steep_ok].max())
    assert worst <= 0.35, f"drivable slope {worst:.4f}"


def test_path_grade_le_12pct_cross_le_2pct(packet: dict) -> None:
    h = packet["heights"]
    for path in packet["paths"]["paths"]:
        pts = np.array(path["points"], dtype=np.float64)
        x, z = pts[:, 0], pts[:, 2]
        if path["closed"]:
            x, z = np.r_[x, x[:1]], np.r_[z, z[:1]]
        ground = sample_height(h, x, z)
        step = np.sqrt(np.diff(x) ** 2 + np.diff(z) ** 2)
        grade = np.abs(np.diff(ground)) / step
        assert grade.max() <= 0.12, f"{path['id']} grade {grade.max():.4f}"
        # Cross-slope across the flattened corridor, using a central-difference tangent.
        tx = np.roll(x, -1) - np.roll(x, 1)
        tz = np.roll(z, -1) - np.roll(z, 1)
        if not path["closed"]:
            tx[0], tz[0] = x[1] - x[0], z[1] - z[0]
            tx[-1], tz[-1] = x[-1] - x[-2], z[-1] - z[-2]
        n = np.sqrt(tx * tx + tz * tz)
        nx, nz = -tz / n, tx / n
        cross = np.abs(sample_height(h, x + nx, z + nz) - sample_height(h, x - nx, z - nz)) / 2.0
        assert cross.max() <= 0.02, f"{path['id']} cross-slope {cross.max():.4f}"


def test_path_points_on_cartpath(packet: dict) -> None:
    for path in packet["paths"]["paths"]:
        for x, _, z in path["points"]:
            assert _material_at(packet, x, z) == "cartpath", (x, z)


def test_path_profile_matches_terrain(packet: dict) -> None:
    for path in packet["paths"]["paths"]:
        pts = np.array(path["points"], dtype=np.float64)
        ground = sample_height(packet["heights"], pts[:, 0], pts[:, 2])
        assert np.abs(ground - pts[:, 1]).max() < 0.05


def _water_body(packet: dict, body_id: str) -> dict:
    return next(b for b in packet["course"]["water"] if b["id"] == body_id)


def _inside_polygon(poly: np.ndarray, x: np.ndarray, z: np.ndarray) -> np.ndarray:
    inside = np.zeros(len(x), dtype=bool)
    j = len(poly) - 1
    for i in range(len(poly)):  # even-odd ray casting
        xi, zi = poly[i]
        xj, zj = poly[j]
        crosses = ((zi > z) != (zj > z)) & (x < (xj - xi) * (z - zi) / (zj - zi + 1e-300) + xi)
        inside ^= crosses
        j = i
    return inside


def _water_cells(packet: dict) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    m = packet["material"]
    rows, cols = m.shape
    r, c = np.nonzero(m == material_id("water"))
    return r, c, c - (cols - 1) / 2, r - (rows - 1) / 2


def test_water_bed_below_level(packet: dict) -> None:
    h = packet["heights"]
    pond = _water_body(packet, "pond-1")
    r, c, x, z = _water_cells(packet)
    in_pond = _inside_polygon(np.array(pond["polygon"]), x, z)
    assert in_pond.any()
    depth = pond["level"] - h[r[in_pond], c[in_pond]]
    assert (depth > 0).all()
    assert 1.5 <= depth.max() <= 2.5, f"max depth {depth.max():.3f}"
    shelf = (depth > 0.2) & (depth < 0.5)
    assert shelf.sum() > 100, "wading shelf missing"


def test_water_cells_inside_a_polygon(packet: dict) -> None:
    _, _, x, z = _water_cells(packet)
    inside = np.zeros(len(x), dtype=bool)
    for body in packet["course"]["water"]:
        inside |= _inside_polygon(np.array(body["polygon"]), x, z)
    assert inside.all()


def test_wading_pool_is_flat_half_meter(packet: dict) -> None:
    h = packet["heights"]
    pool = _water_body(packet, "pool-2")
    poly = np.array(pool["polygon"])
    x0, z0 = poly.min(axis=0)
    x1, z1 = poly.max(axis=0)
    rows, cols = h.shape
    # The floor proper: everything at least 4.5 m inside the edge (the banks take 4 m).
    xs = np.arange(int(np.ceil(x0 + 4.5)), int(np.floor(x1 - 4.5)) + 1)
    zs = np.arange(int(np.ceil(z0 + 4.5)), int(np.floor(z1 - 4.5)) + 1)
    floor = h[np.ix_(zs + (rows - 1) // 2, xs + (cols - 1) // 2)]
    depth = pool["level"] - floor
    assert floor.size >= 150
    assert np.abs(depth - 0.5).max() <= 0.02, f"depth {depth.min():.3f}..{depth.max():.3f}"
    for px, pz in poly:  # the rim stays above the water so it can't spill
        assert sample_height(h, np.array([px]), np.array([pz]))[0] >= pool["level"]


def test_water_entry_heads_into_the_pool(packet: dict) -> None:
    entry = packet["course"]["qa"]["waterEntry"]
    assert entry["headingDeg"] == 90.0
    assert _material_at(packet, entry["x"], entry["z"]) != "water"
    for ahead in (12.0, 23.0, 34.0):
        assert _material_at(packet, entry["x"] + ahead, entry["z"]) == "water"


def test_qa_probes_match_grid(packet: dict) -> None:
    probes = packet["course"]["qa"]["probes"]
    assert {p["material"] for p in probes} >= {
        "rough",
        "fairway",
        "green",
        "tee",
        "bunker",
        "water",
        "cartpath",
        "woods",
    }
    for probe in probes:
        assert _material_at(packet, probe["x"], probe["z"]) == probe["material"], probe


def test_holes_on_their_surfaces(packet: dict) -> None:
    for hole in packet["holes"]["holes"]:
        assert _material_at(packet, hole["tee"]["x"], hole["tee"]["z"]) == "tee"
        assert _material_at(packet, hole["green"]["x"], hole["green"]["z"]) == "green"
        assert _material_at(packet, hole["pin"]["x"], hole["pin"]["z"]) == "green"


def test_wheel_pad_quadrants(packet: dict) -> None:
    pad = packet["course"]["qa"]["wheelPad"]
    # Heading 0 = north: front wheels at -z, left wheels at -x. Offsets cover any cart within 0.4 m.
    for wheel, (dx, dz) in {
        "FL": (-0.5, -0.8),
        "FR": (0.5, -0.8),
        "RL": (-0.5, 0.8),
        "RR": (0.5, 0.8),
    }.items():
        for jx in (-0.3, 0.0, 0.3):
            for jz in (-0.3, 0.0, 0.3):
                got = _material_at(packet, pad["x"] + dx + jx, pad["z"] + dz + jz)
                assert got == pad["expected"][wheel], (wheel, jx, jz, got)
    lower, upper = triangle_slopes(packet["heights"])
    rows, cols = packet["heights"].shape
    c0 = int(pad["x"] + (cols - 1) / 2) - 8
    r0 = int(pad["z"] + (rows - 1) / 2) - 8
    assert max(lower[r0 : r0 + 16, c0 : c0 + 16].max(), upper[r0 : r0 + 16, c0 : c0 + 16].max()) < 1e-9


def test_proving_straight_is_flat_cartpath(packet: dict) -> None:
    start = packet["course"]["qa"]["driveStart"]
    assert start["headingDeg"] == 90.0
    xs = start["x"] + np.arange(0.0, 230.0, 1.0)
    zs = np.full_like(xs, start["z"])
    h = sample_height(packet["heights"], xs, zs)
    assert np.abs(np.diff(h)).max() <= 0.02
    assert all(_material_at(packet, x, z) == "cartpath" for x, z in zip(xs, zs, strict=True))
