"""M2 gate checks on the committed Tee Time Links packet (apps/web/public/levels/tee-time-links)."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import numpy as np
import pytest
from conftest import REPO
from jsonschema import Draft202012Validator

from gcs_pipeline import course, fetch
from gcs_pipeline.heightmap import sample_height, triangle_slopes
from gcs_pipeline.packet import packet_bytes, read_packet
from gcs_pipeline.schema import load_schema, material_id, material_names

PACKET = REPO / "apps" / "web" / "public" / "levels" / "tee-time-links"
pytestmark = pytest.mark.skipif(
    not (PACKET / "course.json").exists(), reason="tee-time-links packet not built"
)


@pytest.fixture(scope="module")
def packet() -> dict:
    return read_packet(PACKET)


def _cells(mask: np.ndarray) -> np.ndarray:
    return mask[:-1, :-1] & mask[:-1, 1:] & mask[1:, :-1] & mask[1:, 1:]


def _material_at(p: dict, x: float, z: float) -> str:
    m = p["material"]
    rows, cols = m.shape
    return material_names()[
        int(m[int(np.floor(z + (rows - 1) / 2 + 0.5)), int(np.floor(x + (cols - 1) / 2 + 0.5))])
    ]


def test_schema_and_hashes() -> None:
    for name in ("course", "holes", "paths"):
        doc = json.loads((PACKET / f"{name}.json").read_text(encoding="utf-8"))
        errors = sorted(Draft202012Validator(load_schema(name)).iter_errors(doc), key=str)
        assert not errors, f"{name}.json: {[e.message for e in errors]}"
    files = json.loads((PACKET / "course.json").read_text(encoding="utf-8"))["files"]
    for name, digest in files.items():
        assert hashlib.sha256((PACKET / name).read_bytes()).hexdigest() == digest, name


def test_identity_and_anchor(packet: dict) -> None:
    c = packet["course"]
    assert (c["id"], c["name"]) == ("tee-time-links", "Tee Time Links")
    assert c["crs"]["epsg"] == 32617
    assert c["attribution"], "attribution missing"


def test_greens_le_3pct(packet: dict) -> None:
    lower, upper = triangle_slopes(packet["heights"])
    cells = _cells(packet["material"] == material_id("green"))
    assert cells.any()
    assert max(lower[cells].max(), upper[cells].max()) <= 0.03


def test_nothing_drivable_over_35pct(packet: dict) -> None:
    lower, upper = triangle_slopes(packet["heights"])
    e = packet["material"] == material_id("embankment")
    near = e[:-1, :-1] | e[:-1, 1:] | e[1:, :-1] | e[1:, 1:]
    assert max(lower[~near].max(), upper[~near].max()) <= 0.35


def test_paths_grade_le_12pct_cross_le_2pct(packet: dict) -> None:
    h = packet["heights"]
    assert packet["paths"]["paths"]
    for path in packet["paths"]["paths"]:
        p = np.array(path["points"], dtype=np.float64)
        x, z = p[:, 0], p[:, 2]
        ground = sample_height(h, x, z)
        assert np.abs(ground - p[:, 1]).max() < 0.05, path["id"]
        grade = np.abs(np.diff(ground)) / np.hypot(np.diff(x), np.diff(z))
        assert grade.max() <= 0.12, (path["id"], grade.max())
        tx, tz = np.gradient(x), np.gradient(z)
        n = np.hypot(tx, tz)
        nx, nz = -tz / n, tx / n
        cross = np.abs(sample_height(h, x + nx, z + nz) - sample_height(h, x - nx, z - nz)) / 2.0
        assert cross.max() <= 0.02, (path["id"], cross.max())
        for px, _, pz in path["points"]:
            assert _material_at(packet, px, pz) == "cartpath", (path["id"], px, pz)


JOIN_M = 5.0  # a branch's first point sits past the trunk's flat corridor (2 m) plus 1 m spacing
REACH_M = 35.0  # hole paths run 31 m off the centerline (fairway half 22 + offset 9)
# Routing-draft gaps for John's review: 12's back tees sit by 13's path (draft overlap of 12 and
# 13), and 16's path is cut back by the big pond beside its tee.
DRAFT_TEE_GAPS_M = {12: 70.0, 16: 90.0}


def test_cart_paths_form_one_network_reaching_every_tee_and_green(packet: dict) -> None:
    from scipy.sparse.csgraph import connected_components

    pts = [np.array(p["points"])[:, [0, 2]] for p in packet["paths"]["paths"]]
    n = len(pts)
    adj = np.zeros((n, n), bool)
    for i in range(n):
        for j in range(i + 1, n):
            gap = np.min(np.hypot(*(pts[i][:, None, :] - pts[j][None, :, :]).T))
            adj[i, j] = adj[j, i] = gap <= JOIN_M
    count, labels = connected_components(adj, directed=False)
    ids = [p["id"] for p in packet["paths"]["paths"]]
    assert count == 1, [[ids[i] for i in range(n) if labels[i] == c] for c in range(count)]
    assert any(i.startswith("conn-") for i in ids)
    every = np.vstack(pts)
    for hole in packet["holes"]["holes"]:
        for what in ("tee", "green"):
            d = np.min(np.hypot(every[:, 0] - hole[what]["x"], every[:, 1] - hole[what]["z"]))
            limit = DRAFT_TEE_GAPS_M.get(hole["number"], REACH_M) if what == "tee" else REACH_M
            assert d <= limit, (hole["number"], what, round(float(d), 1))


def test_no_tree_stands_on_or_over_a_tee(packet: dict) -> None:
    """course.toml scatter.clear_of_tee_m keeps canopies off the tee boxes (3 m here, with margin)."""
    from scipy import ndimage

    tee = packet["material"] == material_id("tee")
    assert tee.any()
    dist = ndimage.distance_transform_edt(~tee)
    rows, cols = tee.shape
    sc = packet["scatter"]
    r = np.clip(np.rint(sc[:, 1] + (rows - 1) / 2).astype(int), 0, rows - 1)
    c = np.clip(np.rint(sc[:, 0] + (cols - 1) / 2).astype(int), 0, cols - 1)
    assert dist[r, c].min() >= 3.0, float(dist[r, c].min())


def test_holes_and_probes_on_their_surfaces(packet: dict) -> None:
    for hole in packet["holes"]["holes"]:
        assert _material_at(packet, hole["tee"]["x"], hole["tee"]["z"]) == "tee"
        assert _material_at(packet, hole["green"]["x"], hole["green"]["z"]) == "green"
        assert _material_at(packet, hole["pin"]["x"], hole["pin"]["z"]) == "green"
    for probe in packet["course"]["qa"]["probes"]:
        assert _material_at(packet, probe["x"], probe["z"]) == probe["material"], probe


def test_rebuild_matches_committed_packet() -> None:
    """Same machine, same cached inputs: same bytes (M2 plan, risk 9)."""
    cfg, folder = fetch.load_course("tee-time-links")
    dem = course.REPO / cfg["dem"]["course"]
    if not dem.exists():
        pytest.skip(f"DEM cache {dem} not present (fresh container)")
    stage = json.loads((PACKET / "course.json").read_text(encoding="utf-8"))["grid"]
    name = next(
        s for s, v in cfg["stages"].items() if _size(v["bounds"]) == (stage["width"], stage["height"])
    )
    built, _ = course.build(cfg, folder, name, dem)
    fresh = packet_bytes(built)
    stale = [n for n, data in fresh.items() if data != (PACKET / n).read_bytes()]
    assert not stale, f"committed tee-time-links is stale; rerun gce-course. Differs: {stale}"


def _size(bounds: list[float]) -> tuple[int, int]:
    from gcs_pipeline.layout import StageGrid

    g = StageGrid.from_bounds(bounds)
    return g.width, g.height


def test_report_folder_is_not_shipped() -> None:
    assert not any(p.suffix == ".png" for p in Path(PACKET).iterdir())
