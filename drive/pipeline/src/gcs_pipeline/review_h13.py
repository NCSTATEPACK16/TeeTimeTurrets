"""gce-review-h13: a synthetic look-dev stand-in for hole 13 (level `review-h13`), for reviewing water.

This is **not** the real hole 13. The real course had no measured packet yet (M2), so this is an
analytic par 4 built from the flyover notes' one water cue for 13: a long pond down the left.
Nothing here is traced from the private reference. It exists so the water shader has a
believable pond to sit in; M2's measured packet replaces it.

- tee at the south end, green to the north, fairway between with a gentle draw
- a long pond along the left of the fairway, with a short wading shelf and a ~2 m bed
- loblolly pines on a low ridge left of the pond, hardwoods right of the cart path
- a cart path up the right side, from behind the tee to behind the green

Determinism matches gce-dummy: integer-hash noise and smoothstep blends only.
"""

from __future__ import annotations

import math

import numpy as np

from . import __version__
from .dummy import (
    GRID,
    HEIGHT_SCALE,
    PALETTE,
    PATH_HALF_WIDTH,
    PATH_SAMPLE,
    Bunker,
    Hole,
    Packet,
    _bearing_code,
    _carve_paths,
    _check_probes,
    _ellipse_sd,
    _fillet,
    _frame,
    _node,
    _profile,
    _rect_sd,
    _resample,
    _segment_distance,
    _xz,
)
from .heightmap import node_coords
from .rng import hash01, lerp, smoothstep, value_noise
from .schema import material_id, material_names

LEVEL_ID = "review-h13"
HOLE = Hole(
    number=13,
    par=4,
    tee=(30.0, 205.0),
    green=(-5.0, -160.0),
    green_semi=(14.0, 11.0),
    fairway=(45.0, 335.0, 16.0),
    bunkers=(Bunker(-6.0, 20.0, 5.5, 3.5, 0.55), Bunker(12.0, -18.0, 4.5, 3.0, 0.5)),
)
# Pond spine, along the hole from the tee and across (negative = left), with its half-width.
POND_SPINE = ((95.0, -40.0, 11.0), (190.0, -44.0, 15.0), (300.0, -36.0, 12.0))
POND_EDGE_NOISE = 4.0
POND_POLY_STEP = 4.0  # outline vertex spacing, m
POND_POLY_MARGIN = 2.0  # outline sits this far outside the shoreline so the shelf stays inside
POND_CAP_RAYS = 12  # rays fanned round each end of the pond
RIDGE_ACROSS = -95.0  # pine ridge rises left of here
RIDGE_HEIGHT = 5.0
HARDWOOD_ACROSS = 70.0  # hardwoods start right of here
TEE_HALF = (6.0, 4.0)
TEE_RAISE = 0.45
TEE_BANK = 4.5
GREEN_TILT = 0.012
GREEN_UNDULATION = 0.10
PATH_ACROSS = 30.0
VALLEY_FALL = 0.012  # ground falls toward the pond, per meter across


def _spine_points() -> list[tuple[float, float]]:
    return [HOLE.at(a, c, origin=HOLE.tee) for a, c, _ in POND_SPINE]


def _pond_field(x: np.ndarray, z: np.ndarray, seed: int) -> np.ndarray:
    """Signed distance into the pond (positive inside), from a two-segment capsule with a wavy edge."""
    pts = _spine_points()
    radii = [r for _, _, r in POND_SPINE]
    best = np.full(x.shape, -np.inf)
    for i in range(len(pts) - 1):
        ax, az = pts[i]
        bx, bz = pts[i + 1]
        ex, ez = bx - ax, bz - az
        t = np.clip(((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez), 0.0, 1.0)
        d = np.sqrt((x - (ax + t * ex)) ** 2 + (z - (az + t * ez)) ** 2)
        r = radii[i] + (radii[i + 1] - radii[i]) * t
        best = np.maximum(best, r - d)
    return best + POND_EDGE_NOISE * (value_noise(x, z, 25.0, seed + 60) - 0.5)


def _base_terrain(x: np.ndarray, z: np.ndarray, seed: int) -> np.ndarray:
    along, across = _frame(x, z, HOLE.tee, HOLE.direction)
    h = 100.0 - 0.006 * along  # the hole plays slightly downhill
    h = h + 4.0 * (value_noise(x, z, 150.0, seed + 1) - 0.5)
    h = h + 0.8 * (value_noise(x, z, 35.0, seed + 2) - 0.5)
    # A shallow valley whose floor is the pond, a pine ridge to the left.
    h = h + VALLEY_FALL * np.abs(across + 40.0)
    return h + RIDGE_HEIGHT * smoothstep(RIDGE_ACROSS, RIDGE_ACROSS - 60.0, across)


def generate(seed: int = 13) -> Packet:
    names = material_names()
    mid = {name: material_id(name) for name in names}
    x, z = node_coords(GRID, GRID)
    h = _base_terrain(x, z, seed)
    mat = np.full(h.shape, mid["rough"], dtype=np.uint8)
    stripe = np.zeros(h.shape, dtype=np.uint8)
    direction = HOLE.direction
    code = _bearing_code(direction)
    _, across = _frame(x, z, HOLE.tee, direction)

    edge = 10.0 * (value_noise(x, z, 45.0, seed + 3) - 0.5)
    woods = (across < RIDGE_ACROSS + edge) | (across > HARDWOOD_ACROSS + edge)
    mat[woods] = mid["woods"]

    # Fairway with a wavy edge; it pinches in where the pond is widest.
    s0, s1, half_width = HOLE.fairway
    a = HOLE.at(s0, 0.0, origin=HOLE.tee)
    b = HOLE.at(s1, 0.0, origin=HOLE.tee)
    width = half_width + 4.0 * (value_noise(x, z, 30.0, seed + 10) - 0.5)
    fairway = _segment_distance(x, z, a, b) < width
    mat[fairway] = mid["fairway"]
    stripe[fairway] = code

    g_along, g_across = _frame(x, z, HOLE.green, direction)
    d = _ellipse_sd(g_along, g_across, *HOLE.green_semi)
    hc = _node(h, *HOLE.green)
    plane = hc + GREEN_TILT * g_along + GREEN_UNDULATION * (value_noise(x, z, 14.0, seed + 20) - 0.5)
    h = lerp(h, plane, smoothstep(-10.0, 0.0, d))
    fringe = (d >= -1.5) & (d < 0.0)
    green = d >= 0.0
    mat[fringe] = mid["fringe"]
    mat[green] = mid["green"]
    stripe[fringe | green] = code

    t_along, t_across = _frame(x, z, HOLE.tee, direction)
    td = _rect_sd(t_along, t_across, *TEE_HALF)
    h = lerp(h, _node(h, *HOLE.tee) + TEE_RAISE, smoothstep(-TEE_BANK, 0.0, td))
    mat[td >= 0.0] = mid["tee"]
    stripe[td >= 0.0] = code

    for bunker in HOLE.bunkers:
        center = HOLE.at(bunker.along, bunker.across)
        b_along, b_across = _frame(x, z, center, direction)
        bd = _ellipse_sd(b_along, b_across, bunker.semi_along, bunker.semi_across)
        h = h - bunker.depth * smoothstep(0.0, 3.5, bd)
        mat[bd >= 0.0] = mid["bunker"]
        stripe[bd >= 0.0] = 0

    # Pond: same bank, shelf and bed profile as dummy-01's pond.
    pd = _pond_field(x, z, seed)
    spine = _spine_points()
    level = round(min(_node(h, sx, sz) for sx, sz in spine) - 0.3, 3)
    depth = (
        -0.25
        + 0.30 * smoothstep(-2.0, 0.0, pd)
        + 0.30 * smoothstep(0.0, 1.5, pd)
        + 1.60 * smoothstep(5.0, 14.0, pd)
    )
    h = lerp(h, level - depth, smoothstep(-18.0, -2.0, pd))

    # Cart path up the right side.
    waypoints = [
        HOLE.at(-12.0, 14.0, origin=HOLE.tee),
        HOLE.at(30.0, PATH_ACROSS, origin=HOLE.tee),
        HOLE.at(180.0, PATH_ACROSS + 6.0, origin=HOLE.tee),
        HOLE.at(-40.0, PATH_ACROSS),
        HOLE.at(-8.0, 26.0),
        HOLE.at(22.0, 10.0),
    ]
    line = _resample(_fillet(waypoints, closed=False), closed=False, step=PATH_SAMPLE)
    profile = _profile(h, line, closed=False)
    h, path_dist = _carve_paths(h, x, z, [(line, profile)])

    water = (pd > -2.5) & (h < level)
    mat[water] = mid["water"]
    stripe[water] = 0
    on_path = path_dist <= PATH_HALF_WIDTH
    mat[on_path] = mid["cartpath"]
    stripe[on_path] = 0

    offset = float(math.floor(float(h.min())) - 1)
    q = np.rint((h - offset) / HEIGHT_SCALE)
    if q.max() > 65535:
        raise ValueError("height range exceeds u16 at the chosen scale")
    height_u16 = q.astype("<u2")
    heights_m = offset + height_u16.astype(np.float64) * HEIGHT_SCALE

    scatter_bytes, species = _scatter(mat, mid["woods"], seed)
    every = round(1.0 / PATH_SAMPLE)
    path_points = [
        [round(float(sx), 3), round(float(sy), 3), round(float(sz), 3)]
        for (sx, sz), sy in zip(line[::every], profile[::every], strict=True)
    ]
    paths = {
        "paths": [
            {
                "id": "h13-right",
                "width": 2 * PATH_HALF_WIDTH,
                "closed": False,
                "source": "authored",
                "points": path_points,
            }
        ],
        "bridges": [],
    }
    holes = {
        "holes": [
            {
                "number": HOLE.number,
                "par": HOLE.par,
                "tee": _xz(HOLE.tee),
                "green": _xz(HOLE.green),
                "pin": _xz(HOLE.at(3.0, -2.0)),
            }
        ]
    }

    # Spawn on the fairway beside the pond, looking up the hole, so the water fills the first view.
    sx, sz = HOLE.at(150.0, -4.0, origin=HOLE.tee)
    heading = round(math.degrees(math.atan2(direction[0], -direction[1])) % 360.0, 3)
    px, pz = line[round(40.0 / PATH_SAMPLE)]
    course = {
        "schemaVersion": "0.2",
        "id": LEVEL_ID,
        "name": "Hole 13 water review (synthetic)",
        "generator": {"name": "gce-review-h13", "version": __version__, "seed": seed},
        "crs": None,
        "grid": {"width": GRID, "height": GRID, "cellSize": 1},
        "height": {"file": "height.u16.bin", "scale": HEIGHT_SCALE, "offset": offset},
        "material": {"file": "material.u8.bin"},
        "stripe": {"file": "stripe.u8.bin"},
        "materials": [{"id": i, "name": n, "color": PALETTE[n]} for i, n in enumerate(names)],
        "spawn": {"x": round(sx, 3), "z": round(sz, 3), "headingDeg": heading},
        "water": [{"id": "pond-13", "level": level, "polygon": _pond_outline(pd)}],
        "scatter": {"file": "scatter.bin", "species": species},
        "holes": "holes.json",
        "paths": "paths.json",
        "attribution": [],
        "files": {},
        "qa": {
            "driveStart": {"x": round(float(px), 3), "z": round(float(pz), 3), "headingDeg": heading},
            "probes": _probes(),
        },
    }
    packet = Packet(
        course=course,
        holes=holes,
        paths=paths,
        height_u16=height_u16,
        material_u8=mat,
        stripe_u8=stripe,
        scatter=scatter_bytes,
        heights_m=heights_m,
    )
    _check_probes(packet)
    return packet


def _pond_outline(pd: np.ndarray) -> list[list[float]]:
    """Pond outline: walk the spine casting to the last pond node on each side, then fan the end caps."""
    inside = pd > -POND_POLY_MARGIN
    rows, cols = inside.shape

    def reach(ox: float, oz: float, ux: float, uz: float) -> float:
        last = 0.0
        for step in range(1, 60):
            c = round(ox + ux * step + (cols - 1) / 2)
            r = round(oz + uz * step + (rows - 1) / 2)
            if 0 <= r < rows and 0 <= c < cols and inside[r, c]:
                last = float(step)
        return last + 1.0

    def cast(ox: float, oz: float, ux: float, uz: float) -> list[float]:
        d = reach(ox, oz, ux, uz)
        return [round(ox + ux * d, 3), round(oz + uz * d, 3)]

    spine = _spine_points()
    seg_lengths = [math.dist(spine[i], spine[i + 1]) for i in range(len(spine) - 1)]
    total = sum(seg_lengths)
    steps = int(total // POND_POLY_STEP)
    right: list[list[float]] = []
    left: list[list[float]] = []
    for k in range(steps + 1):
        s = k * total / steps
        i = 0
        while i < len(seg_lengths) - 1 and s > seg_lengths[i]:
            s -= seg_lengths[i]
            i += 1
        (ax, az), (bx, bz) = spine[i], spine[i + 1]
        t = s / seg_lengths[i]
        ox, oz = ax + (bx - ax) * t, az + (bz - az) * t
        ux, uz = (bx - ax) / seg_lengths[i], (bz - az) / seg_lengths[i]
        right.append(cast(ox, oz, -uz, ux))
        left.append(cast(ox, oz, uz, -ux))

    def cap(end: tuple[float, float], prev: tuple[float, float]) -> list[list[float]]:
        """Rays fanned through the half-plane beyond a spine end, from its right side round to its left."""
        ux, uz = end[0] - prev[0], end[1] - prev[1]
        n = math.hypot(ux, uz)
        ux, uz = ux / n, uz / n
        out = []
        for j in range(1, POND_CAP_RAYS):
            a = math.pi * j / POND_CAP_RAYS - math.pi / 2  # -90..90 degrees off the spine direction
            ca, sa = math.cos(a), math.sin(a)
            # Rotate (ux, uz) by a, so a = -90 is the right side (-uz, ux) at the far end.
            out.append(cast(end[0], end[1], ux * ca + uz * sa, uz * ca - ux * sa))
        return out

    far_cap = cap(spine[-1], spine[-2])  # from the right side round to the left
    near_cap = cap(spine[0], spine[1])
    return right + far_cap + left[::-1] + near_cap


def _probes() -> list[dict]:
    spine = _spine_points()
    out = [
        ("fairway", HOLE.at(150.0, 0.0, origin=HOLE.tee)),
        ("green", HOLE.green),
        ("tee", HOLE.tee),
        ("water", spine[1]),
        ("woods", HOLE.at(180.0, -140.0, origin=HOLE.tee)),
        ("woods", HOLE.at(180.0, 110.0, origin=HOLE.tee)),
        ("cartpath", HOLE.at(120.0, PATH_ACROSS + 4.0, origin=HOLE.tee)),
    ]
    out += [("bunker", HOLE.at(bk.along, bk.across)) for bk in HOLE.bunkers]
    return [{"x": round(p[0], 3), "z": round(p[1], 3), "material": m} for m, p in out]


def _scatter(mat: np.ndarray, woods_id: int, seed: int):
    """Jittered-grid trees in the woods: pines on the left ridge, mostly hardwoods on the right."""
    spacing = 7.0
    n = int(GRID // spacing) + 1
    ii, jj = np.meshgrid(np.arange(n, dtype=np.int64), np.arange(n, dtype=np.int64))
    ii = ii.ravel()
    jj = jj.ravel()
    lo = -(GRID - 1) / 2
    px = lo + (ii + hash01(ii, jj, seed + 40)) * spacing
    pz = lo + (jj + hash01(ii, jj, seed + 41)) * spacing
    inside = (px <= -lo) & (pz <= -lo)
    keep = hash01(ii, jj, seed + 42) < 0.8
    rows, cols = mat.shape
    c = np.clip(np.floor(px + (cols - 1) / 2 + 0.5).astype(np.int64), 0, cols - 1)
    r = np.clip(np.floor(pz + (rows - 1) / 2 + 0.5).astype(np.int64), 0, rows - 1)
    sel = inside & keep & (mat[r, c] == woods_id)
    _, across = _frame(px, pz, HOLE.tee, HOLE.direction)
    oak_share = np.where(across > 0.0, 0.85, 0.08)
    is_oak = hash01(ii, jj, seed + 43) < oak_share
    scale = 0.8 + 0.4 * hash01(ii, jj, seed + 44)
    rot = hash01(ii, jj, seed + 45) * (2.0 * math.pi)
    chunks = []
    species = []
    offset = 0
    for name, mask in (("loblolly_pine", sel & ~is_oak), ("white_oak", sel & is_oak)):
        rec = np.stack([px[mask], pz[mask], scale[mask], rot[mask]], axis=1).astype("<f4")
        chunks.append(rec.tobytes())
        species.append({"name": name, "count": int(rec.shape[0]), "byteOffset": offset})
        offset += rec.nbytes
    return b"".join(chunks), species
