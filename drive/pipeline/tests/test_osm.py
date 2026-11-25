"""OSM layer: Overpass query, `out geom` parsing, coverage summary, and the snapshot fetch."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from gcs_pipeline import fetch, osm

SAMPLE = {
    "osm3s": {"timestamp_osm_base": "2026-10-18T00:00:00Z"},
    "elements": [
        {"type": "node", "id": 5, "lat": 36.44, "lon": -79.32},  # untagged vertex: dropped
        {"type": "node", "id": 7, "lat": 36.441, "lon": -79.321, "tags": {"golf": "pin", "ref": "1"}},
        {
            "type": "way",
            "id": 20,
            "tags": {"golf": "green"},
            "geometry": [
                {"lat": 36.0, "lon": -79.0},
                {"lat": 36.0, "lon": -79.001},
                {"lat": 36.001, "lon": -79.001},
                {"lat": 36.0, "lon": -79.0},
            ],
        },
        {"type": "way", "id": 11, "tags": {"golf": "hole", "ref": "13", "par": "4"}, "geometry": []},
        {"type": "way", "id": 12, "tags": {"golf": "hole", "ref": "1"}, "geometry": []},
        {"type": "way", "id": 30, "tags": {"highway": "path", "golf_cart": "designated"}, "geometry": []},
        {"type": "way", "id": 31, "tags": {"highway": "residential"}, "geometry": []},
        {"type": "way", "id": 32, "tags": {"natural": "water", "water": "pond"}, "geometry": []},
        {"type": "way", "id": 33, "tags": {"golf": "water_hazard", "natural": "water"}, "geometry": []},
        {
            "type": "relation",
            "id": 40,
            "tags": {"leisure": "golf_course", "name": "Example Golf Club"},
            "members": [
                {"type": "way", "role": "outer", "geometry": [{"lat": 1, "lon": 2}, {"lat": 3, "lon": 4}]},
                {"type": "node", "role": "", "lat": 0, "lon": 0},
            ],
        },
    ],
}


def test_query_targets_the_pin() -> None:
    q = osm.build_query(36.43859037, -79.31937903, 2500, 180)
    assert q.startswith("[out:json][timeout:180];")
    assert "(around:2500,36.43859037,-79.31937903)" in q
    assert 'nwr["golf"]' in q and 'nwr["leisure"="golf_course"]' in q
    assert q.rstrip().endswith("out geom;")


@pytest.mark.parametrize(
    ("tags", "kind"),
    [
        ({"golf": "fairway"}, "fairway"),
        ({"golf": "water_hazard", "natural": "water"}, "water_hazard"),
        ({"golf": "something_new"}, "golf:something_new"),
        ({"highway": "service", "golf_cart": "designated"}, "cartpath"),
        ({"highway": "footway"}, "path"),
        ({"highway": "residential", "bridge": "yes"}, "bridge"),
        ({"highway": "residential"}, "road"),
        ({"landuse": "forest"}, "woods"),
        ({"natural": "water"}, "water"),
        ({"waterway": "stream"}, "waterway"),
        ({"building": "yes"}, "building"),
        ({"man_made": "mast"}, "tower"),
    ],
)
def test_classify(tags: dict, kind: str) -> None:
    assert osm.classify(tags) == kind


def test_parse_and_coverage() -> None:
    features = osm.parse(SAMPLE)
    assert [(f.osm_type, f.osm_id) for f in features][:2] == [("node", 7), ("way", 11)]
    green = next(f for f in features if f.osm_id == 20)
    assert green.kind == "green" and green.closed and green.coords[1] == (-79.001, 36.0)
    boundary = next(f for f in features if f.osm_id == 40)
    assert boundary.members == [("outer", [(2.0, 1.0), (4.0, 3.0)])]
    cov = osm.coverage(features)
    assert cov["holes"] == [1, 13]
    assert cov["courseNames"] == ["Example Golf Club"]
    assert cov["counts"]["cartpath"] == 1 and cov["counts"]["water"] == 1
    assert cov["counts"]["water_hazard"] == 1


def test_course_config_loads() -> None:
    cfg, folder = fetch.load_course("tee-time-links")
    assert cfg["id"] == "tee-time-links"
    assert folder.name == "tee-time-links"
    assert 2000 <= cfg["osm"]["radius_m"] <= 3000
    assert "GolfCartSimulator" in cfg["osm"]["user_agent"]


def _cfg() -> dict:
    cfg, _ = fetch.load_course("tee-time-links")
    return cfg


def test_overpass_fetch_writes_snapshot_and_manifest(tmp_path: Path) -> None:
    calls: list[list[str]] = []

    def fake_curl(cmd: list[str]) -> None:
        calls.append(cmd)
        Path(cmd[cmd.index("-o") + 1]).write_text(json.dumps(SAMPLE), encoding="utf-8")

    out, manifest = fetch.overpass(_cfg(), tmp_path, run=fake_curl)
    cmd = calls[0]
    assert cmd[0] == "curl" and cmd[cmd.index("-A") + 1].startswith("GolfCartSimulator/")
    assert cmd[-1] == "https://overpass-api.de/api/interpreter"
    assert out == tmp_path / "osm" / "overpass.json" and out.exists()
    assert not out.with_suffix(".part").exists()
    assert (tmp_path / "osm" / "overpass.overpassql").read_text().startswith("[out:json]")
    saved = json.loads((tmp_path / "osm" / "manifest.json").read_text())
    assert saved == manifest
    assert manifest["elements"] == len(SAMPLE["elements"])
    assert manifest["osmBase"] == "2026-10-18T00:00:00Z"
    assert "ODbL" in manifest["license"]


def test_overpass_html_error_page_is_not_saved(tmp_path: Path) -> None:
    def fake_curl(cmd: list[str]) -> None:
        Path(cmd[cmd.index("-o") + 1]).write_text("<html>rate limited</html>", encoding="utf-8")

    with pytest.raises(json.JSONDecodeError):
        fetch.overpass(_cfg(), tmp_path, run=fake_curl)
    assert not (tmp_path / "osm" / "overpass.json").exists()


def test_resumable_retries_until_complete(tmp_path: Path) -> None:
    calls = []

    def flaky(cmd: list[str]) -> None:
        calls.append(cmd)
        dest = Path(cmd[cmd.index("-o") + 1])
        with dest.open("ab") as f:
            f.write(b"x" * 4)  # each attempt resumes and adds a chunk
        if len(calls) < 3:
            raise fetch.subprocess.CalledProcessError(18, cmd)

    fetch.resumable("https://example.invalid/big.zip", tmp_path / "big.zip", 12, "ua", run=flaky)
    assert len(calls) == 3 and (tmp_path / "big.zip").stat().st_size == 12
    assert all("-C" in c and c[c.index("-C") + 1] == "-" for c in calls)
