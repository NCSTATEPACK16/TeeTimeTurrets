"""gce-review-h13: the synthetic hole-13 pond used to review the water shader."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import numpy as np
import pytest
from conftest import REPO
from jsonschema import Draft202012Validator

from gcs_pipeline.heightmap import sample_height
from gcs_pipeline.packet import packet_bytes, read_packet
from gcs_pipeline.review_h13 import generate
from gcs_pipeline.schema import load_schema, material_id

COMMITTED = REPO / "apps" / "web" / "public" / "levels" / "review-h13"


@pytest.fixture(scope="module")
def written(tmp_path_factory: pytest.TempPathFactory) -> Path:
    out = tmp_path_factory.mktemp("review-h13")
    subprocess.run(
        [
            sys.executable,
            "-c",
            "import sys; from gcs_pipeline.cli import review_h13_main; sys.exit(review_h13_main())",
            "--out",
            str(out),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    return out


@pytest.fixture(scope="module")
def packet(written: Path) -> dict:
    return read_packet(written)


def _inside(poly: np.ndarray, px: np.ndarray, pz: np.ndarray) -> np.ndarray:
    """Even-odd point-in-polygon, the same rule as the web WaterSampler."""
    out = np.zeros(px.shape, dtype=bool)
    for (ax, az), (bx, bz) in zip(poly, np.roll(poly, -1, axis=0), strict=True):
        crosses = (az > pz) != (bz > pz)
        with np.errstate(divide="ignore", invalid="ignore"):
            xi = (bx - ax) * (pz - az) / (bz - az) + ax
        out ^= crosses & (px < xi)
    return out


def test_schema_valid(written: Path) -> None:
    for name in ("course", "holes", "paths"):
        doc = json.loads((written / f"{name}.json").read_text(encoding="utf-8"))
        errors = sorted(Draft202012Validator(load_schema(name)).iter_errors(doc), key=str)
        assert not errors, f"{name}.json: {[e.message for e in errors]}"


def test_deterministic() -> None:
    assert packet_bytes(generate()) == packet_bytes(generate())


@pytest.mark.skipif(not COMMITTED.exists(), reason="committed packet not present")
def test_committed_packet_matches(written: Path) -> None:
    stale = [p.name for p in written.iterdir() if p.read_bytes() != (COMMITTED / p.name).read_bytes()]
    assert not stale, f"committed review-h13 is stale; rerun gce-review-h13. Differs: {stale}"


def test_labelled_synthetic(packet: dict) -> None:
    course = packet["course"]
    assert "synthetic" in course["name"].lower()
    assert course["crs"] is None


def test_outline_covers_every_water_node(packet: dict) -> None:
    rows, cols = packet["material"].shape
    r, c = np.nonzero(packet["material"] == material_id("water"))
    assert r.size > 3000, "pond is missing or tiny"
    poly = np.array(packet["course"]["water"][0]["polygon"])
    inside = _inside(poly, c - (cols - 1) / 2, r - (rows - 1) / 2)
    assert inside.all(), f"{(~inside).sum()} water nodes fall outside the outline"


def test_outline_sits_on_dry_bank(packet: dict) -> None:
    """The opaque water mesh must meet the ground inside its outline, never hang in the air."""
    body = packet["course"]["water"][0]
    poly = np.array(body["polygon"])
    t = np.linspace(0.0, 1.0, 10, endpoint=False)[:, None, None]
    pts = (poly[None] + (np.roll(poly, -1, axis=0) - poly)[None] * t).reshape(-1, 2)
    ground = sample_height(packet["heights"], pts[:, 0], pts[:, 1])
    assert (ground > body["level"]).all(), f"lowest outline point is {(ground - body['level']).min():.3f} m"


def test_pond_runs_left_of_the_fairway(packet: dict) -> None:
    """Flyover cue for 13: a long pond on the left. Left of a northbound hole is west (-X)."""
    hole = packet["holes"]["holes"][0]
    assert hole["number"] == 13
    poly = np.array(packet["course"]["water"][0]["polygon"])
    span = poly[:, 1].max() - poly[:, 1].min()
    assert span > 150.0, f"pond is only {span:.0f} m long"
    mid_x = 0.5 * (hole["tee"]["x"] + hole["green"]["x"])
    assert poly[:, 0].mean() < mid_x - 20.0
