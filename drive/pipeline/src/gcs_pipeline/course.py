"""gce-course: build a real course's level packet for one stage (hole1, full) from course.toml.

Order: lidar DEM on the stage grid, authored layout, sculpt, cart paths, a last slope relax,
materials, trees, holes and QA poses. Determinism: same machine and the same cached inputs
give the same bytes; the committed packet is the reference (see docs/handoff/M2-plan.md, risk 9).
"""

from __future__ import annotations

import math
from pathlib import Path

import numpy as np
from scipy import ndimage
from shapely.geometry import Polygon

from . import __version__, horizon, layout, paths, qa, sculpt
from .dem import NodeGrid, to_node_grid
from .dummy import PALETTE, Packet, _bearing_code
from .schema import material_id, material_names

HEIGHT_SCALE = 0.001
REPO = Path(__file__).resolve().parents[3]


def build(cfg: dict, folder: Path, stage: str, dem_path: Path) -> tuple[Packet, dict]:
    st = cfg["stages"][stage]
    grid = layout.StageGrid.from_bounds(st["bounds"])
    cx, cz = grid.center
    loc = cfg["location"]
    dem = to_node_grid(
        dem_path, NodeGrid(loc["epsg"], loc["easting"] + cx, loc["northing"] - cz, grid.width, grid.height)
    )
    loaded = [f for f in layout.load_overrides(cfg, folder) if f.hole is None or f.hole in st["holes"]]
    # Wading shelves are water polygons with a `wade` depth; they only shape the bed of a real pond.
    wade_feats = [f for f in loaded if f.surface == "water" and f.props.get("wade")]
    features = [f for f in loaded if f not in wade_feats]
    masks = layout.surface_masks(features, grid)
    woods = layout.woods_mask(cfg, folder, grid)

    wade = None
    if wade_feats and "water" in masks:
        wade = layout.surface_masks(wade_feats, grid)["water"] & masks["water"]
    sc = sculpt.sculpt(dem, masks, cfg["sculpt"], wade)
    h, path_dist, path_entries = paths.build(sc.heights, features, grid, cfg["paths"])
    # Path shoulders blend up to 16 m out; greens keep their sculpted surface (relax eases the edge).
    on_green = masks.get("green", np.zeros(h.shape, bool)) & (path_dist > cfg["paths"]["flat_half_m"] + 1.0)
    h = np.where(on_green, sc.heights, h)
    # Lock the flattened corridor plus a meter, so the cells the cross-slope check reads stay put.
    on_path = path_dist <= cfg["paths"]["flat_half_m"] + 1.0
    green_pad = ndimage.binary_dilation(masks.get("green", np.zeros(h.shape, bool)), iterations=1)
    h, steep = sculpt.relax(
        h, green_pad | on_path, cfg["sculpt"]["drivable_max_slope"], cfg["sculpt"]["relax_iterations"]
    )

    mat = layout.materials(masks, woods, cfg, h.shape)
    mat[steep] = material_id("embankment")
    # The path's own surface wins over an embankment flag from the steep shoulder beside it.
    mat[path_dist <= cfg["paths"]["width_m"] / 2] = material_id("cartpath")

    stripe = np.zeros(h.shape, dtype=np.uint8)
    holes = _holes(features, grid, st["holes"])
    for hole in holes:
        tee = np.array([hole["tee"]["x"], hole["tee"]["z"]])
        green = np.array([hole["green"]["x"], hole["green"]["z"]])
        d = green - tee
        code = _bearing_code(tuple(d / np.linalg.norm(d)))
        for s in ("fairway", "green", "tee"):
            sel = np.zeros(h.shape, bool)
            for f in features:
                if f.surface == s and f.hole == hole["number"]:
                    sel |= layout.surface_masks([f], grid)[s]
            stripe[sel & (mat == material_id(s))] = code
    stripe[np.isin(mat, [material_id("fringe")])] = 0

    offset = float(math.floor(float(h.min())) - 1)
    q = np.rint((h - offset) / HEIGHT_SCALE)
    if q.max() > 65535:
        raise ValueError(f"relief {h.max() - h.min():.1f} m exceeds u16 at scale {HEIGHT_SCALE}")
    height_u16 = q.astype("<u2")
    heights_m = offset + height_u16.astype(np.float64) * HEIGHT_SCALE

    clear = np.isin(
        mat, [material_id(s) for s in ("fairway", "green", "fringe", "tee", "bunker", "cartpath", "water")]
    )
    scatter_bytes, species = _scatter(
        woods & (mat == material_id("woods")), clear, grid, cfg, folder, mat == material_id("tee")
    )

    drive = qa.drive_start(heights_m, mat, cfg["qa"])
    first = holes[0]
    tee = (first["tee"]["x"], first["tee"]["z"])
    green = (first["green"]["x"], first["green"]["z"])
    spawn_heading = round(math.degrees(math.atan2(green[0] - tee[0], -(green[1] - tee[1]))) % 360.0, 3)
    course = {
        "schemaVersion": "0.2",
        "id": cfg["id"],
        "name": cfg["name"],
        "generator": {"name": "gce-course", "version": __version__},
        "crs": {
            "epsg": loc["epsg"],
            "originEasting": loc["easting"] + grid.x0,
            "originNorthing": loc["northing"] - grid.z0,
        },
        "grid": {"width": grid.width, "height": grid.height, "cellSize": 1},
        "height": {"file": "height.u16.bin", "scale": HEIGHT_SCALE, "offset": offset},
        "material": {"file": "material.u8.bin"},
        "stripe": {"file": "stripe.u8.bin"},
        "materials": [{"id": i, "name": n, "color": PALETTE[n]} for i, n in enumerate(material_names())],
        "spawn": {"x": tee[0], "z": tee[1], "headingDeg": spawn_heading},
        "water": _water(features, sc, grid),
        "scatter": {"file": "scatter.bin", "species": species},
        "holes": "holes.json",
        "paths": "paths.json",
        "attribution": cfg["attribution"],
        "files": {},
        "qa": {
            "driveStart": {k: drive[k] for k in ("x", "z", "headingDeg")},
            "probes": qa.probes(mat),
        },
    }
    entry = qa.water_entry(heights_m, sc.water_labels, sc.water_levels, wade, cfg["qa"])
    if entry is not None:
        course["qa"]["waterEntry"] = {k: entry[k] for k in ("x", "z", "headingDeg")}
    deep = qa.deep_water(heights_m, sc.water_labels, sc.water_levels, cfg["qa"])
    if deep is not None:
        course["qa"]["deepWater"] = deep
    horizon_u16 = None
    if st.get("horizon"):
        src = horizon.dem20_path(cfg, REPO)
        horizon_u16, course["horizon"], _ = horizon.build(src, loc, grid.center, heights_m, cfg["horizon"])
    logo = None
    if cfg.get("logo"):
        course["logo"] = {"file": cfg["logo"]}
        logo = (folder / cfg["logo"]).read_bytes()
    packet = Packet(
        course=course,
        holes={"holes": holes},
        paths={"paths": path_entries, "bridges": []},
        height_u16=height_u16,
        material_u8=mat,
        stripe_u8=stripe,
        scatter=scatter_bytes,
        heights_m=heights_m,
        horizon_u16=horizon_u16,
        logo=logo,
    )
    report = {
        "stage": stage,
        "grid": [grid.width, grid.height],
        "originCourseFrame": [grid.x0, grid.z0],
        "relief": [float(h.min()), float(h.max())],
        "sculpt": sc.report,
        "embankmentNodesAfterPaths": int(steep.sum()),
        "driveStart": drive,
        "waterEntry": entry,
        "deepWater": deep,
        "trees": {s["name"]: s["count"] for s in species},
        "materials": {n: int((mat == i).sum()) for i, n in enumerate(material_names())},
    }
    return packet, report | {"dem": dem, "heights": heights_m}


def _scatter(woods, clear, grid, cfg, folder, tees=None):
    from .scatter import scatter

    return scatter(woods, clear, grid, cfg, folder / cfg["aerial"]["out"], tees)


def _holes(features: list[layout.Feature], grid: layout.StageGrid, numbers: list[int]) -> list[dict]:
    """Per hole: the back tee's center, the green's center, a pin on the green. Packet world."""
    cx, cz = grid.center
    order = {"blue": 0, "white": 1, "yellow": 2, "red": 3}
    out = []
    for n in numbers:
        tees = sorted(
            (f for f in features if f.hole == n and f.surface == "tee"),
            key=lambda f: order.get(f.props.get("tee", ""), 9),
        )
        greens = [f for f in features if f.hole == n and f.surface == "green"]
        if not tees or len(greens) != 1:
            raise ValueError(f"hole {n}: needs tees and exactly one green in overrides")
        t = (
            tees[0].geom.representative_point()
            if not isinstance(tees[0].geom, Polygon)
            else tees[0].geom.centroid
        )
        g = greens[0].geom
        pin = g.centroid if g.contains(g.centroid) else g.representative_point()
        out.append(
            {
                "number": n,
                "par": _par(n),
                "tee": {"x": round(t.x - cx, 3), "z": round(t.y - cz, 3)},
                "green": {"x": round(g.centroid.x - cx, 3), "z": round(g.centroid.y - cz, 3)},
                "pin": {"x": round(pin.x - cx, 3), "z": round(pin.y - cz, 3)},
            }
        )
    return out


PARS = {
    1: 5,
    2: 4,
    3: 4,
    4: 3,
    5: 4,
    6: 3,
    7: 4,
    8: 5,
    9: 4,
    10: 3,
    11: 4,
    12: 4,
    13: 4,
    14: 5,
    15: 4,
    16: 4,
    17: 3,
    18: 5,
}


def _par(n: int) -> int:
    return PARS[n]


def _water(features, sc: sculpt.SculptResult, grid: layout.StageGrid) -> list[dict]:
    cx, cz = grid.center
    out = []
    bodies = [f for f in features if f.surface == "water"]
    for f in sorted(bodies, key=lambda f: f.id):
        # The sculpted level of the component under this outline.
        c = f.geom.representative_point()
        col, row = round(c.x - grid.x0), round(c.y - grid.z0)
        k = int(sc.water_labels[row, col]) if sc.water_labels is not None else 0
        if k == 0:
            continue
        ring = f.geom.buffer(2.0).simplify(0.5).exterior.coords
        out.append(
            {
                "id": f.id,
                "level": sc.water_levels[k - 1],
                "polygon": [[round(x - cx, 3), round(z - cz, 3)] for x, z in list(ring)[:-1]],
            }
        )
    return out
