"""gce-author: course-frame specs to WGS84 overrides, merged by id."""

from __future__ import annotations

import json
import math
from pathlib import Path

import pytest
from shapely.geometry import Polygon

from gcs_pipeline import author, layout

CFG = {
    "location": {
        "lat": 36.43859037,
        "lon": -79.31937903,
        "epsg": 32617,
        "easting": 650634,
        "northing": 4033909,
    },
    "layout": {"overrides": "overrides.geojson"},
}


def test_ellipse_and_rect_shapes() -> None:
    e = Polygon(author.ellipse(10.0, 20.0, 15.0, 8.0, 90.0))
    assert e.area == pytest.approx(math.pi * 15 * 8, rel=0.02)
    xs = [p[0] for p in author.ellipse(10.0, 20.0, 15.0, 8.0, 90.0)]
    assert max(xs) == pytest.approx(25.0)  # bearing 90 = east: semi-axis a runs along x
    r = Polygon(author.rect(0.0, 0.0, 30.0, 10.0, 0.0))
    assert r.area == pytest.approx(300.0)
    assert r.bounds == pytest.approx((-5.0, -15.0, 5.0, 15.0))  # bearing 0 = north: length along z


def test_compile_round_trips_through_load_overrides(tmp_path: Path) -> None:
    (tmp_path / "overrides.geojson").write_text(
        json.dumps({"type": "FeatureCollection", "features": []}), encoding="utf-8"
    )
    (tmp_path / "authoring").mkdir()
    specs = [
        {"id": "h02-green", "surface": "green", "hole": 2, "ellipse": [300.0, 590.0, 16.0, 12.0, 80.0]},
        {
            "id": "h02-tee-blue",
            "surface": "tee",
            "hole": 2,
            "tee": "blue",
            "rect": [-40.0, 570.0, 14.0, 9.0, 85.0],
        },
        {
            "id": "h02-path",
            "surface": "cartpath",
            "hole": 2,
            "xz": [[0.0, 560.0], [100.0, 575.0], [200.0, 580.0]],
        },
        {"id": "pond-a", "surface": "water", "wade": 0.5, "xz": [[0, 0], [20, 0], [20, 10], [0, 10]]},
    ]
    (tmp_path / "authoring" / "h02.json").write_text(json.dumps(specs), encoding="utf-8")
    feats = author.compile_specs(tmp_path, CFG)
    author.write_overrides(tmp_path / "overrides.geojson", feats)
    loaded = {f.id: f for f in layout.load_overrides(CFG, tmp_path)}
    assert set(loaded) == {"h02-green", "h02-tee-blue", "h02-path", "pond-a"}
    g = loaded["h02-green"].geom
    assert g.centroid.x == pytest.approx(300.0, abs=0.05) and g.centroid.y == pytest.approx(590.0, abs=0.05)
    assert loaded["h02-tee-blue"].props["tee"] == "blue"
    assert loaded["pond-a"].props["wade"] == 0.5
    assert loaded["h02-path"].geom.geom_type == "LineString"
    assert loaded["h02-path"].geom.length == pytest.approx(101.1 + 100.1, abs=0.2)


def test_duplicate_ids_are_rejected(tmp_path: Path) -> None:
    (tmp_path / "overrides.geojson").write_text(
        '{"type": "FeatureCollection", "features": []}', encoding="utf-8"
    )
    (tmp_path / "authoring").mkdir()
    spec = {"id": "x", "surface": "green", "ellipse": [0, 0, 5, 5, 0]}
    (tmp_path / "authoring" / "a.json").write_text(json.dumps([spec]), encoding="utf-8")
    (tmp_path / "authoring" / "b.json").write_text(json.dumps([spec]), encoding="utf-8")
    with pytest.raises(ValueError):
        author.compile_specs(tmp_path, CFG)


def test_generated_features_are_replaced_and_hand_ones_kept(tmp_path: Path) -> None:
    """A feature gce-route no longer emits (a dropped bunker, connector) must leave overrides."""
    (tmp_path / "overrides.geojson").write_text(
        json.dumps({"type": "FeatureCollection", "features": []}), encoding="utf-8"
    )
    (tmp_path / "authoring").mkdir()
    gen = author.GENERATED + ": test"
    first = [
        {"id": "h02-bunker-a", "surface": "bunker", "hole": 2, "ellipse": [0, 0, 5, 3, 0], "source": gen},
        {"id": "hand", "surface": "rough", "xz": [[0, 0], [9, 0], [9, 9]], "source": "draft: by hand"},
    ]
    (tmp_path / "authoring" / "a.json").write_text(json.dumps(first), encoding="utf-8")
    author.write_overrides(tmp_path / "overrides.geojson", author.compile_specs(tmp_path, CFG))
    # The hand feature moves into overrides only (as hole 1 did); the bunker is dropped from the specs.
    (tmp_path / "authoring" / "a.json").write_text(json.dumps([]), encoding="utf-8")
    ids = [f["properties"]["id"] for f in author.compile_specs(tmp_path, CFG)]
    assert ids == ["hand"]
