"""gce-author: compile hand-authored course-frame layout specs into overrides.geojson.

Specs live in `pipeline/courses/<course>/authoring/*.json`: lists of features written in the
course frame (meters east `x` and south `z` of the pin), which is how they are read off the
aerial and hillshade review crops. Each feature has `id`, `surface`, optional `hole`, `tee`,
`wade`, `source`, and exactly one geometry:

- `xz`: [[x, z], ...]: a polygon outline, or a line for cart paths;
- `ellipse`: [cx, cz, semi_a, semi_b, bearing_deg]: semi-axis a along the bearing (clockwise from north);
- `rect`: [cx, cz, length, width, bearing_deg]: length along the bearing.

The output keeps overrides.geojson's format: WGS84, 7 decimals, one feature per line, sorted by id.
Hand-drafted features in overrides.geojson are kept as they are (hole 1 was drafted directly);
ones gce-route generated are replaced by the current specs.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

from pyproj import Transformer

from .fetch import load_course

ELLIPSE_POINTS = 24
GENERATED = "draft (gce-route)"  # route.SOURCE's prefix


def ellipse(cx: float, cz: float, a: float, b: float, bearing: float) -> list[list[float]]:
    t = math.radians(bearing)
    ux, uz = math.sin(t), -math.cos(t)  # along the bearing
    vx, vz = -uz, ux  # 90° clockwise of it
    pts = []
    for k in range(ELLIPSE_POINTS):
        p = 2 * math.pi * k / ELLIPSE_POINTS
        ca, sb = a * math.cos(p), b * math.sin(p)
        pts.append([cx + ux * ca + vx * sb, cz + uz * ca + vz * sb])
    return pts


def rect(cx: float, cz: float, length: float, width: float, bearing: float) -> list[list[float]]:
    t = math.radians(bearing)
    ux, uz = math.sin(t), -math.cos(t)
    vx, vz = -uz, ux
    hl, hw = length / 2, width / 2
    return [
        [cx + ux * sl + vx * sw, cz + uz * sl + vz * sw]
        for sl, sw in ((hl, -hw), (hl, hw), (-hl, hw), (-hl, -hw))
    ]


def outline(spec: dict) -> tuple[str, list[list[float]]]:
    keys = [k for k in ("xz", "ellipse", "rect") if k in spec]
    if len(keys) != 1:
        raise ValueError(f"{spec.get('id')}: needs exactly one of xz, ellipse, rect")
    if "ellipse" in spec:
        return "Polygon", ellipse(*spec["ellipse"])
    if "rect" in spec:
        return "Polygon", rect(*spec["rect"])
    kind = "LineString" if spec["surface"] == "cartpath" else "Polygon"
    return kind, [list(map(float, p)) for p in spec["xz"]]


def to_feature(spec: dict, loc: dict) -> dict:
    to_ll = Transformer.from_crs(loc["epsg"], 4326, always_xy=True)
    kind, pts = outline(spec)
    ll = [[round(v, 7) for v in to_ll.transform(loc["easting"] + x, loc["northing"] - z)] for x, z in pts]
    if kind == "Polygon":
        ll.append(ll[0])
        geometry = {"type": "Polygon", "coordinates": [ll]}
    else:
        geometry = {"type": "LineString", "coordinates": ll}
    props = {"id": spec["id"], "surface": spec["surface"]}
    for k in ("hole", "tee", "wade"):
        if k in spec:
            props[k] = spec[k]
    props["source"] = spec.get("source", "draft: 2024 NC orthoimagery + 2024 QL1 lidar")
    return {"type": "Feature", "properties": props, "geometry": geometry}


def write_overrides(path: Path, features: list[dict]) -> None:
    lines = [json.dumps(f, separators=(",", ":"), ensure_ascii=False) for f in features]
    text = (
        '{"type": "FeatureCollection", "name": "tee-time-links overrides","features":[\n'
        + ",\n".join(lines)
        + "\n]}\n"
    )
    path.write_text(text, encoding="utf-8")


def compile_specs(folder: Path, cfg: dict) -> list[dict]:
    path = folder / cfg["layout"]["overrides"]
    # Hand-drafted features are kept; anything gce-route generated is replaced wholesale, so a
    # feature dropped from the routing table (a bunker, a connector) leaves overrides.geojson too.
    existing = {
        f["properties"]["id"]: f
        for f in json.loads(path.read_text(encoding="utf-8"))["features"]
        if not f["properties"].get("source", "").startswith(GENERATED)
    }
    authored: dict[str, dict] = {}
    for spec_file in sorted((folder / "authoring").glob("*.json")):
        for spec in json.loads(spec_file.read_text(encoding="utf-8")):
            if spec["id"] in authored:
                raise ValueError(f"{spec['id']}: defined twice in authoring/")
            authored[spec["id"]] = to_feature(spec, cfg["location"])
    merged = existing | authored
    return [merged[k] for k in sorted(merged)]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="gce-author", description=__doc__.splitlines()[0])
    parser.add_argument("--course", required=True)
    args = parser.parse_args(argv)
    cfg, folder = load_course(args.course)
    features = compile_specs(folder, cfg)
    write_overrides(folder / cfg["layout"]["overrides"], features)
    print(f"gce-author: {len(features)} features -> {cfg['layout']['overrides']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
