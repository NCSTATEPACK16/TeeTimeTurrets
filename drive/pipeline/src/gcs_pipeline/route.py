"""gce-route: turn the routing table (authoring/routing.toml) into authoring specs for gce-author.

The routing table is the short, reviewable description of holes 2-18: a fairway centerline per
hole, the scorecard yardages, the cart path side and bunker hints from the flyover notes. This
module expands it into features, all in the course frame (meters east `x`, south `z` of the pin):

- greens: the turf-color trace of the aerial (the hole-1 method), picked by the green center;
- tees: pads on the centerline at each tee's scorecard distance from the green center;
- fairway: the centerline, offset by a half-width that widens in the landing zone;
- bunkers: ellipses at [along, side] offsets from the green center along the line, pushed clear
  of the green's edge;
- cart path: the centerline offset to the hole's path side, outside the fairway;
- ponds: dark-water traces of the aerial, or hand outlines; one may carry a wading shelf;
- connectors: cart paths between hole paths (green to next tee) and to the clubhouse.

Everything it writes is a draft, marked as such in `source`, for review over the aerial in QGIS.
"""

from __future__ import annotations

import argparse
import itertools
import json
import math
import sys
import tomllib
from pathlib import Path

import numpy as np
import rasterio
from rasterio import features as rfeatures
from scipy import ndimage
from shapely.geometry import LineString, Point, Polygon, shape
from shapely.ops import unary_union

from .fetch import load_course

SOURCE = "draft (gce-route): 2024 NC orthoimagery + 2024 QL1 lidar + scorecard; review in QGIS"
TEE_ORDER = ("blue", "white", "yellow", "red")
KEEP_OUT_SURFACES = ("cartpath", "tee", "green", "bunker")


def _aerial(cfg: dict, folder: Path) -> tuple[np.ndarray, rasterio.Affine]:
    with rasterio.open(folder / cfg["aerial"]["out"]) as src:
        return src.read([1, 2, 3]).astype(np.float32), src.transform


def _traces(mask: np.ndarray, transform, loc: dict, min_area: float, simplify: float) -> list[Polygon]:
    lab, _ = ndimage.label(mask)
    out = []
    for geom, _v in rfeatures.shapes(lab.astype(np.int32), mask=lab > 0, transform=transform):
        g = shape(geom)
        if g.area < min_area:
            continue
        g = g.simplify(simplify)
        out.append(Polygon([(e - loc["easting"], loc["northing"] - n) for e, n in g.exterior.coords]))
    return out


def green_traces(rgb: np.ndarray, transform, loc: dict) -> list[Polygon]:
    """Greens read green in the winter image: G - B > 42, G >= R - 10, bright and smooth."""
    r, g, b = rgb
    lum = (r + g + b) / 3
    tex = ndimage.uniform_filter(np.abs(ndimage.laplace(lum)), 7)
    m = (g - b > 42) & (g >= r - 10) & (lum > 105) & (tex < 14)
    m = ndimage.binary_fill_holes(
        ndimage.binary_closing(ndimage.binary_opening(m, iterations=2), iterations=3)
    )
    return _traces(m, transform, loc, 150.0, 0.6)


def water_traces(rgb: np.ndarray, transform, loc: dict) -> list[Polygon]:
    """Open water is the darkest, smoothest surface in the image."""
    lum = rgb.mean(axis=0)
    tex = ndimage.uniform_filter(np.abs(ndimage.laplace(ndimage.gaussian_filter(lum, 1))), 9)
    m = (lum < 62) & (tex < 4.0)
    m = ndimage.binary_fill_holes(
        ndimage.binary_closing(ndimage.binary_opening(m, iterations=3), iterations=4)
    )
    return _traces(m, transform, loc, 250.0, 1.0)


def pick(traces: list[Polygon], at: tuple[float, float], what: str) -> Polygon:
    p = Point(at)
    hits = [t for t in traces if t.buffer(3.0).contains(p)]
    if not hits:
        raise ValueError(f"no {what} trace at {at}")
    return max(hits, key=lambda t: t.area)


def point_back(line: LineString, dist: float) -> tuple[Point, float]:
    """The point `dist` meters back along the line from its end, and the bearing of play there."""
    s = max(0.0, min(line.length, line.length - dist))
    p = line.interpolate(s)
    q = line.interpolate(min(line.length, s + 2.0))
    if q.distance(p) < 1e-6:
        q, p = p, line.interpolate(max(0.0, s - 2.0))
    bearing = math.degrees(math.atan2(q.x - p.x, -(q.y - p.y))) % 360.0
    return p, bearing


def extend_back(line: LineString, dist: float) -> LineString:
    """Extend the line backwards past its start so a tee can sit beyond the drawn start."""
    (x0, z0), (x1, z1) = line.coords[0], line.coords[1]
    d = math.hypot(x1 - x0, z1 - z0)
    ux, uz = (x0 - x1) / d, (z0 - z1) / d
    return LineString([(x0 + ux * dist, z0 + uz * dist), *line.coords])


def _side(line: LineString, s: float, off: float) -> tuple[float, float]:
    """Point at arc length s, offset `off` meters to the right of play (negative = left)."""
    p = line.interpolate(s)
    a = line.interpolate(max(0.0, s - 1.0))
    b = line.interpolate(min(line.length, s + 1.0))
    dx, dz = b.x - a.x, b.y - a.y
    n = math.hypot(dx, dz) or 1.0
    # Right of a heading (dx, dz) in x-east, z-south: (-dz, dx).
    return p.x - dz / n * off, p.y + dx / n * off


def fairway(line: LineString, s0: float, s1: float, blue_s: float, t: dict) -> list[list[float]]:
    a, b, c = t["fairway_half_m"]
    l0, l1 = (blue_s + v for v in t["landing_m"])
    ss = np.arange(s0, s1 + 1e-9, 5.0)
    if ss[-1] < s1:
        ss = np.append(ss, s1)

    def half(s: float) -> float:
        if s < l0:
            return a + (b - a) * max(0.0, (s - s0)) / max(1.0, l0 - s0)
        if s <= l1:
            return b
        return b + (c - b) * (s - l1) / max(1.0, s1 - l1)

    right = [_side(line, s, half(s)) for s in ss]
    left = [_side(line, s, -half(s)) for s in ss[::-1]]
    poly = Polygon(right + left).buffer(0)  # inside a tight dogleg the offsets cross; untangle them
    if poly.geom_type == "MultiPolygon":
        poly = max(poly.geoms, key=lambda g: g.area)
    poly = poly.simplify(0.3)
    return [[round(x, 1), round(z, 1)] for x, z in list(poly.exterior.coords)[:-1]]


def clear_of_green(
    x: float, z: float, sa: float, sb: float, bearing: float, green: Polygon, clear: float
) -> tuple[float, float]:
    """Push a bunker straight out from the green's center until it sits `clear` meters off the
    green's edge (a bunker cut into the green leaves a steep lip on the putting surface)."""
    from .author import ellipse

    c = green.centroid
    dx, dz = x - c.x, z - c.y
    n = math.hypot(dx, dz) or 1.0
    ux, uz = dx / n, dz / n
    for _ in range(80):
        if Polygon(ellipse(x, z, sa, sb, bearing)).distance(green) >= clear:
            break
        x, z = x + 0.5 * ux, z + 0.5 * uz
    return x, z


def hole_specs(n: int, h: dict, t: dict, greens: list[Polygon]) -> list[dict]:
    m = t["yards_to_m"]
    g = pick(greens, tuple(h["green"]), f"hole {n} green")
    tag = f"h{n:02d}"
    common = {"hole": n, "source": SOURCE}
    specs = [
        {
            "id": f"{tag}-green",
            "surface": "green",
            "xz": [[round(x, 1), round(z, 1)] for x, z in list(g.exterior.coords)[:-1]],
            **common,
        }
    ]
    dists = {k: h["tees"][k] * m for k in TEE_ORDER}
    line = LineString(h["line"])
    longest = max(dists.values()) + t["path_start_back_m"] + 10.0
    if longest > line.length:
        line = extend_back(line, longest - line.length)
    for k in TEE_ORDER:
        p, bearing = point_back(line, dists[k])
        specs.append(
            {
                "id": f"{tag}-tee-{k}",
                "surface": "tee",
                "tee": k,
                "rect": [round(p.x, 1), round(p.y, 1), *t["tee_size_m"], round(bearing, 1)],
                **common,
            }
        )
    blue_s = line.length - dists["blue"]
    red_s = line.length - dists["red"]
    if not h.get("par3"):
        s0 = red_s + t["fairway_from_forward_tee_m"]
        s1 = line.length - t["fairway_end_short_m"]
        specs.append(
            {"id": f"{tag}-fairway", "surface": "fairway", "xz": fairway(line, s0, s1, blue_s, t), **common}
        )
    for k, (along, side, sa, sb) in enumerate(h.get("bunkers", [])):
        if along >= 0:
            x, z = _side(line, line.length - along, side)
            _, bearing = point_back(line, along)
        else:  # behind the green: carry on past the line's end in the last direction of play
            _, bearing = point_back(line, 0.0)
            t_ = math.radians(bearing)
            ex, ez = _side(line, line.length, side)
            x, z = ex + math.sin(t_) * -along, ez - math.cos(t_) * -along
        x, z = clear_of_green(x, z, sa, sb, bearing, g, t["bunker_clear_green_m"])
        specs.append(
            {
                "id": f"{tag}-bunker-{chr(97 + k)}",
                "surface": "bunker",
                "ellipse": [round(x, 1), round(z, 1), sa, sb, round(bearing, 1)],
                **common,
            }
        )
    sign = 1.0 if h["path"] == "right" else -1.0
    off = sign * (t["fairway_half_m"][1] + t["path_offset_m"])
    s_start = max(0.0, blue_s - t["path_start_back_m"]) + h.get("path_from_m", 0.0)
    past = h.get("path_end_past_m", t["path_end_past_m"])
    pts = [_side(line, s, off) for s in np.arange(s_start, line.length, 10.0)]
    gx, gz = _side(line, line.length, off)
    pts.append((gx, gz))
    end = line.interpolate(line.length)
    # Run on past the green, beside it.
    if past > 0:
        back = line.interpolate(line.length - 5.0)
        pts.append((gx + (end.x - back.x) / 5.0 * past, gz + (end.y - back.y) / 5.0 * past))
    specs.append(
        {
            "id": f"{tag}-path",
            "surface": "cartpath",
            "xz": [[round(x, 1), round(z, 1)] for x, z in pts],
            **common,
        }
    )
    return specs


def pond_specs(route: dict, waters: list[Polygon]) -> list[dict]:
    out = []
    for pid, p in sorted(route.get("ponds", {}).items()):
        if "trace" in p:
            poly = pick(waters, tuple(p["trace"]), pid)
            xz = [[round(x, 1), round(z, 1)] for x, z in list(poly.exterior.coords)[:-1]]
        else:
            xz = p["xz"]
        out.append({"id": pid, "surface": "water", "xz": xz, "source": SOURCE})
    wade = route.get("wade")
    if wade:
        out.append(
            {
                "id": f"{wade['pond']}-wade",
                "surface": "water",
                "wade": 0.5,
                "ellipse": wade["ellipse"],
                "source": SOURCE,
            }
        )
    return out


def build(cfg: dict, folder: Path) -> tuple[list[dict], dict]:
    route = tomllib.loads((folder / "authoring" / "routing.toml").read_text(encoding="utf-8"))
    t = {k: v for k, v in route.items() if k not in ("holes", "ponds", "wade", "clubhouse", "connectors")}
    rgb, transform = _aerial(cfg, folder)
    greens = green_traces(rgb, transform, cfg["location"])
    waters = water_traces(rgb, transform, cfg["location"])
    specs: list[dict] = []
    for key in sorted(route["holes"], key=int):
        specs += hole_specs(int(key), route["holes"][key], t, greens)
    specs += pond_specs(route, waters)
    specs = clear_paths(specs, t)
    specs += connector_specs(route, specs + hand_specs(cfg, folder), t)
    check_parallel_paths(specs, t)
    return specs, route


def hand_specs(cfg: dict, folder: Path) -> list[dict]:
    """Cart paths, tees and greens drafted straight into overrides.geojson (hole 1), as specs."""
    from . import layout
    from .author import GENERATED

    out = []
    for f in layout.load_overrides(cfg, folder):
        if f.props.get("source", "").startswith(GENERATED) or f.surface not in KEEP_OUT_SURFACES:
            continue
        coords = f.geom.coords if f.surface == "cartpath" else list(f.geom.exterior.coords)[:-1]
        out.append({"id": f.id, "surface": f.surface, "hole": f.hole, "xz": [list(c) for c in coords]})
    return out


def _end(ref: str | list, paths: dict[str, LineString], route: dict, toward: tuple | None = None) -> tuple:
    """A connector end: [x, z], "clubhouse", "<path id>:start" / "<path id>:end", or a bare
    "<path id>": the point on that path nearest `toward` (a T-junction)."""
    if isinstance(ref, list):
        return float(ref[0]), float(ref[1])
    if ref == "clubhouse":
        return _end(route["clubhouse"]["at"], paths, route, toward)
    pid, _, which = ref.partition(":")
    if pid not in paths or which not in ("start", "end", ""):
        raise ValueError(f"connector end {ref!r}: no such path end")
    line = paths[pid]
    if not which:
        if toward is None:
            raise ValueError(f"connector end {ref!r}: a bare path needs a fixed other end or `via`")
        q = line.interpolate(line.project(Point(toward)))
        return q.x, q.y
    c = line.coords
    return tuple(c[0] if which == "start" else c[-1])


def connector_specs(route: dict, specs: list[dict], t: dict) -> list[dict]:
    """Cart paths that join the holes into one network (green to next tee, clubhouse to 1 and 10,
    9 and 18 back). Ends name hole-path ends, so they follow routing edits. A connector may not
    touch a green, tee, bunker or pond; without `via` points it is routed round them by
    `auto_route`, which also shies away from fairways and other hole paths."""
    from .author import outline

    paths = {s["id"]: LineString(s["xz"]) for s in specs if s["surface"] == "cartpath"}
    clear = {
        "green": t["path_clear_green_m"],
        "water": t["path_clear_water_m"],
        "tee": t["path_clear_tee_m"],
        "bunker": t["path_clear_bunker_m"],
    }
    keep_out = [
        # A hair inside the clearance clear_paths cut to, so a cut path end may start a connector.
        (s["id"], Polygon(outline(s)[1]).buffer(clear[s["surface"]] - 0.3))
        for s in specs
        if s["surface"] in clear and not s.get("wade")
    ]
    fairways = [Polygon(outline(s)[1]) for s in specs if s["surface"] == "fairway"]
    out, errors = [], []
    for c in route.get("connectors", []):
        via = [tuple(v) for v in c.get("via", [])]
        fixed = [r for r in (c["from"], c["to"]) if ":" in str(r) or isinstance(r, list) or r == "clubhouse"]
        hint = _end(fixed[0], paths, route) if fixed else None
        a = _end(c["from"], paths, route, via[0] if via else hint)
        b = _end(c["to"], paths, route, via[-1] if via else a)
        if not via:
            via = auto_route(a, b, [poly for _, poly in keep_out], fairways, list(paths.values()), t)
        line = LineString([a, *via, b])
        if line.length < 10.0:  # the paths already meet (paths.build drops anything this short)
            continue
        hits = [i for i, poly in keep_out if line.intersects(poly)]
        if hits:
            span = f"({a[0]:.0f},{a[1]:.0f})->({b[0]:.0f},{b[1]:.0f})"
            errors.append(f"{c['id']} {span} crosses {', '.join(sorted(hits))}")
        spec = {
            "id": c["id"],
            "surface": "cartpath",
            "xz": [[round(x, 1), round(z, 1)] for x, z in line.coords],
        }
        out.append(spec | {"source": SOURCE})
        paths[c["id"]] = line
    if errors:
        raise ValueError("connectors need `via` points:\n  " + "\n  ".join(errors))
    return out


def auto_route(
    a: tuple, b: tuple, hard: list[Polygon], fairways: list[Polygon], others: list[LineString], t: dict
) -> list[tuple[float, float]]:
    """Waypoints for a connector from a to b: the cheapest path on a visibility graph round the
    `hard` keep-outs (their corners, pushed out a little more). Cost is length, plus extra per meter
    over a fairway or alongside another cart path, plus a fixed cost per path crossed."""
    import heapq

    from shapely.ops import unary_union
    from shapely.prepared import prep

    c = t["connector"]
    span = LineString([a, b]).buffer(max(c["search_m"], 0.6 * math.dist(a, b)))
    local = [h for h in hard if h.intersects(span)]
    blocked = unary_union(local) if local else Polygon()
    hard_p = prep(blocked)
    fair = prep(unary_union([f for f in fairways if f.intersects(span)] or [Polygon()]))
    fair_u = unary_union([f for f in fairways if f.intersects(span)] or [Polygon()])
    # The paths this connector joins are free to touch by its ends; everywhere else they count.
    ends = Point(a).buffer(2 * t["path_min_gap_m"]).union(Point(b).buffer(2 * t["path_min_gap_m"]))
    near = [o.difference(ends) for o in others if o.intersects(span)]
    near = [o for o in near if not o.is_empty]
    beside = unary_union([o.buffer(t["path_min_gap_m"]) for o in near] or [Polygon()])

    nodes = [a, b]
    for g in getattr(blocked, "geoms", [blocked]):
        if g.is_empty:
            continue
        ring = g.buffer(c["corner_m"], join_style="mitre").simplify(c["corner_m"])
        for part in getattr(ring, "geoms", [ring]):
            nodes += [tuple(q) for q in list(part.exterior.coords)[:-1]]
    nodes = [n for n in nodes if not hard_p.contains(Point(n))]

    def cost(p: tuple, q: tuple) -> float | None:
        seg = LineString([p, q])
        if seg.length == 0 or hard_p.intersects(seg):
            return None
        extra = 0.0
        if fair.intersects(seg):
            extra += c["fairway_cost"] * seg.intersection(fair_u).length
        if near:
            extra += c["beside_path_cost"] * seg.intersection(beside).length
            extra += c["crossing_cost"] * sum(seg.intersects(o) for o in near)
        return seg.length + extra

    best = {0: 0.0}
    back: dict[int, int] = {}
    heap = [(math.dist(a, b), 0.0, 0)]
    while heap:
        _, g, i = heapq.heappop(heap)
        if i == 1:
            break
        if g > best.get(i, math.inf):
            continue
        for j in range(len(nodes)):
            if j == i:
                continue
            w = cost(nodes[i], nodes[j])
            if w is None or g + w >= best.get(j, math.inf):
                continue
            best[j] = g + w
            back[j] = i
            heapq.heappush(heap, (g + w + math.dist(nodes[j], b), g + w, j))
    if 1 not in back:
        return []  # no way round: the keep-out check reports the straight line
    route, i = [], back[1]
    while i != 0:
        route.append(nodes[i])
        i = back[i]
    pts = [a, *reversed(route), b]
    # Corners closer than corner_gap_m make the path spline loop; merge them where still clear.
    k = 1
    while k < len(pts) - 2:
        if math.dist(pts[k], pts[k + 1]) < c["corner_gap_m"]:
            mid = ((pts[k][0] + pts[k + 1][0]) / 2, (pts[k][1] + pts[k + 1][1]) / 2)
            if not hard_p.intersects(LineString([pts[k - 1], mid, pts[k + 2]])):
                pts[k : k + 2] = [mid]
                continue
        k += 1
    return [(round(x, 1), round(z, 1)) for x, z in pts[1:-1]]


def check_parallel_paths(specs: list[dict], t: dict) -> None:
    """Two paths side by side get carved to different profiles, leaving a step between them."""
    lines = [(s["id"], LineString(s["xz"])) for s in specs if s["surface"] == "cartpath"]
    for i, (ia, a) in enumerate(lines):
        for ib, b in lines[i + 1 :]:
            if ia.startswith("conn-") or ib.startswith("conn-"):
                # A connector leaves the path it joins: skip the stretch by each junction.
                # Several paths can meet at one junction, so the stretch by either end is free.
                conn, other = (a, b) if ia.startswith("conn-") else (b, a)
                conn = conn.difference(
                    unary_union([e.buffer(3 * t["path_min_gap_m"]) for e in conn.boundary.geoms])
                )
                run = conn.intersection(other.buffer(t["path_min_gap_m"])).length
            else:
                run = a.intersection(b.buffer(t["path_min_gap_m"])).length
            if run > t["path_max_parallel_m"]:
                raise ValueError(f"{ia} runs {run:.0f} m within {t['path_min_gap_m']} m of {ib}")


def clear_paths(specs: list[dict], t: dict) -> list[dict]:
    """Keep each cart path clear of greens and ponds (cut back; the longest piece stays) and of tees
    and bunkers (skirted round their edge, since a path often runs right past them)."""
    from .author import outline

    def zone(surface: str, clear: float):
        return [
            Polygon(outline(s)[1]).buffer(clear)
            for s in specs
            if s["surface"] == surface and not s.get("wade")
        ]

    cut = unary_union(zone("green", t["path_clear_green_m"]) + zone("water", t["path_clear_water_m"]))
    skirt = unary_union(zone("tee", t["path_clear_tee_m"]) + zone("bunker", t["path_clear_bunker_m"]))
    out = []
    for s in specs:
        if s["surface"] != "cartpath":
            out.append(s)
            continue
        rest = LineString(s["xz"]).difference(cut)
        parts = [g for g in getattr(rest, "geoms", [rest]) if not g.is_empty]
        if not parts:
            continue
        best = _detour(max(parts, key=lambda g: g.length), skirt)
        if best is None:
            continue
        out.append(s | {"xz": [[round(x, 1), round(z, 1)] for x, z in best.coords]})
    return out


def _detour(line: LineString, keep_out) -> LineString | None:
    """The path with its ends trimmed out of `keep_out`, and every keep-out it runs into midway
    skirted round its edge the shorter way. A skirt much longer than the stretch it replaces splits
    the path there instead; the longest run wins."""
    from shapely.ops import substring

    rest = line.difference(keep_out)
    parts = sorted(
        (g for g in getattr(rest, "geoms", [rest]) if not g.is_empty and g.length > 0),
        key=lambda g: line.project(Point(g.coords[0])),
    )
    if not parts:
        return None
    runs = [[list(parts[0].coords)]]
    blobs = list(getattr(keep_out, "geoms", [keep_out]))
    for prev, nxt in itertools.pairwise(parts):
        p, q = Point(prev.coords[-1]), Point(nxt.coords[0])
        blob = next((b for b in blobs if b.distance(p) < 0.05 and b.distance(q) < 0.05), None)
        arc = None
        if blob is not None:
            ring = LineString(blob.exterior.coords)
            a, b = ring.project(p), ring.project(q)
            lo, hi = min(a, b), max(a, b)
            inner = substring(ring, lo, hi)
            outer = LineString(
                list(substring(ring, hi, ring.length).coords) + list(substring(ring, 0.0, lo).coords)[1:]
            )
            arc = min((inner, outer), key=lambda g: g.length)
            if Point(arc.coords[0]).distance(p) > Point(arc.coords[-1]).distance(p):
                arc = LineString(arc.coords[::-1])
        straight = p.distance(q)
        if arc is not None and arc.length <= max(3.0 * straight, straight + 60.0):
            runs[-1].append(list(arc.coords)[1:-1] + list(nxt.coords))
        else:
            runs.append([list(nxt.coords)])
    best = max((LineString([c for piece in run for c in piece]) for run in runs), key=lambda g: g.length)
    return best


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="gce-route", description=__doc__.splitlines()[0])
    parser.add_argument("--course", required=True)
    args = parser.parse_args(argv)
    cfg, folder = load_course(args.course)
    specs, _ = build(cfg, folder)
    out = folder / "authoring" / "holes.json"
    out.write_text(
        "[\n" + ",\n".join(json.dumps(s, separators=(",", ":")) for s in specs) + "\n]\n", encoding="utf-8"
    )
    print(f"gce-route: {len(specs)} features -> {out.relative_to(folder)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
