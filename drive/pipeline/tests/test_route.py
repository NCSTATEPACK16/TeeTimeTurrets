"""gce-route geometry on small cases: tee placement, fairway, bunkers, path clearing."""

from __future__ import annotations

import math

import pytest
from shapely.geometry import LineString, Point, Polygon

from gcs_pipeline import route
from gcs_pipeline.author import outline

T = {
    "yards_to_m": 0.9144,
    "tee_size_m": [12.0, 8.0],
    "bunker_clear_green_m": 1.5,
    "fairway_from_forward_tee_m": 35.0,
    "fairway_end_short_m": 14.0,
    "fairway_half_m": [16.0, 22.0, 13.0],
    "landing_m": [200.0, 260.0],
    "path_offset_m": 9.0,
    "path_start_back_m": 10.0,
    "path_end_past_m": 25.0,
    "path_clear_green_m": 6.0,
    "path_clear_water_m": 4.0,
    "path_clear_tee_m": 2.0,
    "path_clear_bunker_m": 2.0,
    "path_min_gap_m": 6.0,
    "path_max_parallel_m": 15.0,
}
# A straight par 4 played due north (towards -z) to a round green at the origin.
GREEN = Point(0.0, 0.0).buffer(14.0)
HOLE = {
    "green": [0, 0],
    "line": [[0, 400], [0, 0]],
    "tees": {"blue": 400, "white": 371, "yellow": 348, "red": 312},
    "path": "right",
    "bunkers": [[0, 16, 6, 4], [-20, 0, 5, 3]],
}


def _by_id(specs):
    return {s["id"]: s for s in specs}


def test_tees_sit_at_their_scorecard_distance_on_the_line() -> None:
    specs = _by_id(route.hole_specs(2, HOLE, T, [GREEN]))
    for k, yd in HOLE["tees"].items():
        cx, cz, length, width, bearing = specs[f"h02-tee-{k}"]["rect"]
        assert cx == pytest.approx(0.0, abs=0.1)
        assert cz == pytest.approx(yd * 0.9144, abs=0.2)
        assert bearing == pytest.approx(0.0, abs=0.1) or bearing == pytest.approx(360.0, abs=0.1)
        assert (length, width) == (12.0, 8.0)


def test_line_extends_back_when_the_blue_tee_is_beyond_it() -> None:
    short = HOLE | {"line": [[0, 200], [0, 0]]}
    specs = _by_id(route.hole_specs(2, short, T, [GREEN]))
    assert specs["h02-tee-blue"]["rect"][1] == pytest.approx(400 * 0.9144, abs=0.2)


def test_fairway_stops_short_of_the_green_and_widens_in_the_landing_zone() -> None:
    fw = Polygon(_by_id(route.hole_specs(2, HOLE, T, [GREEN]))["h02-fairway"]["xz"])
    assert fw.is_valid
    assert fw.bounds[1] == pytest.approx(14.0, abs=0.5)  # ends 14 m short of the green center
    landing_z = 400 * 0.9144 - 230
    width = fw.intersection(LineString([(-100, landing_z), (100, landing_z)])).length
    assert width == pytest.approx(44.0, abs=0.5)


def test_bunkers_beside_and_behind_the_green() -> None:
    specs = _by_id(route.hole_specs(2, HOLE, T, [GREEN]))
    # Placed 16 m right and 20 m past, then pushed straight out until 1.5 m off the 14 m green.
    side = specs["h02-bunker-a"]["ellipse"]
    assert side[1] == pytest.approx(0.0, abs=0.1) and side[0] == pytest.approx(19.5, abs=0.3)  # east
    behind = specs["h02-bunker-b"]["ellipse"]
    assert behind[0] == pytest.approx(0.0, abs=0.1) and behind[1] == pytest.approx(-20.5, abs=0.3)  # past


def test_path_runs_on_its_side_and_is_cleared_from_greens() -> None:
    specs = route.clear_paths(route.hole_specs(2, HOLE, T, [GREEN]), T)
    path = LineString(_by_id(specs)["h02-path"]["xz"])
    assert min(x for x, _ in path.coords) == pytest.approx(31.0, abs=0.5)  # 22 + 9 m to the right
    assert path.distance(GREEN) >= 6.0 - 1e-6
    assert outline(_by_id(specs)["h02-green"])[0] == "Polygon"


def test_parallel_paths_are_rejected() -> None:
    a = {"id": "a", "surface": "cartpath", "xz": [[0, 0], [0, 100]]}
    b = {"id": "b", "surface": "cartpath", "xz": [[3, 0], [3, 100]]}
    crossing = {"id": "c", "surface": "cartpath", "xz": [[-50, 50], [50, 50]]}
    route.check_parallel_paths([a, crossing], T)
    with pytest.raises(ValueError, match="runs"):
        route.check_parallel_paths([a, b], T)


def test_point_back_bearing_follows_play() -> None:
    line = LineString([(0, 0), (100, 0)])  # played east
    p, bearing = route.point_back(line, 30.0)
    assert (p.x, p.y) == pytest.approx((70.0, 0.0))
    assert bearing == pytest.approx(90.0)
    assert math.isclose(route.extend_back(line, 10.0).length, 110.0)


ROUTE_T = T | {
    "connector": {
        "search_m": 120.0,
        "corner_m": 2.0,
        "corner_gap_m": 20.0,
        "fairway_cost": 1.0,
        "beside_path_cost": 10.0,
        "crossing_cost": 40.0,
    }
}


def _connector(c: dict, specs: list[dict], extra: dict | None = None) -> LineString:
    out = route.connector_specs({"connectors": [c], **(extra or {})}, specs, ROUTE_T)
    return LineString(out[0]["xz"])


def test_connector_is_routed_round_a_green_in_the_way() -> None:
    a = {"id": "h02-path", "surface": "cartpath", "xz": [[-100, 0], [-60, 0]]}
    b = {"id": "h03-path", "surface": "cartpath", "xz": [[60, 0], [100, 0]]}
    green = {"id": "h02-green", "surface": "green", "ellipse": [0, 0, 15, 15, 0]}
    line = _connector({"id": "conn-02-03", "from": "h02-path:end", "to": "h03-path:start"}, [a, b, green])
    assert line.coords[0] == (-60, 0) and line.coords[-1] == (60, 0)
    assert line.distance(Point(0, 0)) >= 15 + 6.0 - 0.3 - 1e-6
    assert line.length < 1.6 * 120  # goes round, not a long way off


def test_bare_path_end_is_a_t_junction_at_its_nearest_point() -> None:
    a = {"id": "h02-path", "surface": "cartpath", "xz": [[0, -100], [0, 0]]}
    b = {"id": "h03-path", "surface": "cartpath", "xz": [[-50, 80], [50, 80]]}
    line = _connector({"id": "conn-02-03", "from": "h02-path:end", "to": "h03-path"}, [a, b])
    assert line.coords[-1] == pytest.approx((0.0, 80.0))


def test_connector_with_via_through_a_tee_is_refused() -> None:
    a = {"id": "h02-path", "surface": "cartpath", "xz": [[-100, 0], [-60, 0]]}
    b = {"id": "h03-path", "surface": "cartpath", "xz": [[60, 0], [100, 0]]}
    tee = {"id": "h03-tee-blue", "surface": "tee", "rect": [0, 20, 12, 8, 90]}
    c = {"id": "conn-02-03", "from": "h02-path:end", "to": "h03-path:start", "via": [[0, 20]]}
    with pytest.raises(ValueError, match=r"conn-02-03 .* crosses h03-tee-blue"):
        _connector(c, [a, b, tee])


def test_connector_to_the_clubhouse() -> None:
    a = {"id": "h01-path", "surface": "cartpath", "xz": [[0, 0], [0, 200]]}
    b = {"id": "h09-path", "surface": "cartpath", "xz": [[100, 300], [100, 100]]}
    line = _connector(
        {"id": "conn-09-club", "from": "h09-path:end", "to": "clubhouse"},
        [a, b],
        {"clubhouse": {"at": "h01-path:start"}},
    )
    assert line.coords[-1] == (0, 0)


def test_tee_in_the_middle_of_a_path_is_skirted_not_cut() -> None:
    path = {"id": "h05-path", "surface": "cartpath", "xz": [[-100, 0], [100, 0]]}
    tee = {"id": "h06-tee-white", "surface": "tee", "rect": [0, 0, 12, 8, 90]}
    out = _by_id(route.clear_paths([path, tee], T))
    line = LineString(out["h05-path"]["xz"])
    assert line.coords[0] == (-100, 0) and line.coords[-1] == (100, 0)
    assert line.distance(Polygon(outline(tee)[1])) >= 1.9  # 2 m, less buffer facets and 0.1 m rounding
    assert line.length < 220


def test_green_at_a_path_end_still_trims_it() -> None:
    path = {"id": "h05-path", "surface": "cartpath", "xz": [[-100, 0], [10, 0]]}
    out = _by_id(route.clear_paths([path, {"id": "g", "surface": "green", "ellipse": [10, 0, 8, 8, 0]}], T))
    assert max(x for x, _ in out["h05-path"]["xz"]) == pytest.approx(-4.0, abs=0.3)


def test_bunkers_are_pushed_clear_of_the_green_edge() -> None:
    hole = HOLE | {"bunkers": [[0, 12, 6, 4], [5, -10, 5, 3]]}  # both would cut into a 14 m green
    specs = _by_id(route.hole_specs(2, hole, T, [GREEN]))
    for k in "ab":
        b = Polygon(outline(specs[f"h02-bunker-{k}"])[1])
        assert b.distance(GREEN) >= 1.5 - 1e-6
        assert b.distance(GREEN) < 2.1  # pushed just far enough
