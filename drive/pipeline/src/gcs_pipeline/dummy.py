"""gce-dummy: a synthetic two-hole course for M0 (level `dummy-01`).

The layout is analytic and authored at golf scale, so tests know exactly what is where:

- rolling rough, woods along the north and west edges with tree scatter, a rough mound
- hole 1, par 4: raised tee, fairway, green with fringe ring, two bunkers
- hole 2, par 3 over a pond with a wading shelf; approach fairway, green, one bunker
- a flat-bottomed 0.5 m wading pool on the south strip (`qa.waterEntry` drives into it)
- a cart-path loop whose south leg is a 270 m flat proving straight (`qa.driveStart`)
- a flat proving pad split into four material quadrants (`qa.wheelPad`)

Determinism: see rng.py. All shaping is smoothstep blends of integer-hash value noise.
"""

from __future__ import annotations

import itertools
import math
from dataclasses import dataclass, field

import numpy as np

from . import __version__
from .heightmap import node_coords, sample_height
from .rng import hash01, lerp, smoothstep, unit, unit_directions, value_noise
from .schema import material_id, material_names

GRID = 513
HEIGHT_SCALE = 0.001
PATH_HALF_WIDTH = 1.2  # 2.4 m cart path
PATH_FLAT = 1.5  # flattened half-corridor (PRD: 1.5 m either side)
PATH_SAMPLE = 0.25
PATH_MAX_GRADE = 0.09  # PRD cap is 12%; keep margin for interpolation

PALETTE = {
    "rough": "#5b7f3a",
    "fairway": "#76a947",
    "fringe": "#6c9e3f",
    "green": "#8ec653",
    "tee": "#80b34b",
    "bunker": "#e3d2a1",
    "water": "#3f6f8f",
    "cartpath": "#bab6ae",
    "woods": "#3d5a2d",
    "embankment": "#7a6a4f",
}


@dataclass(frozen=True)
class Bunker:
    along: float  # relative to the green center, along the hole direction
    across: float  # positive = right of the hole direction
    semi_along: float
    semi_across: float
    depth: float


@dataclass(frozen=True)
class Hole:
    number: int
    par: int
    tee: tuple[float, float]
    green: tuple[float, float]
    green_semi: tuple[float, float]  # along, across
    fairway: tuple[float, float, float]  # start and end distance from the tee, half-width
    bunkers: tuple[Bunker, ...] = field(default_factory=tuple)

    @property
    def direction(self) -> tuple[float, float]:
        return unit(self.green[0] - self.tee[0], self.green[1] - self.tee[1])

    @property
    def right(self) -> tuple[float, float]:
        dx, dz = self.direction
        return -dz, dx

    def at(
        self, along: float, across: float, origin: tuple[float, float] | None = None
    ) -> tuple[float, float]:
        ox, oz = origin if origin is not None else self.green
        dx, dz = self.direction
        rx, rz = self.right
        return ox + along * dx + across * rx, oz + along * dz + across * rz


HOLES = (
    Hole(
        number=1,
        par=4,
        tee=(-190.0, 120.0),
        green=(-80.0, -150.0),
        green_semi=(15.0, 12.0),
        fairway=(30.0, 280.0, 17.0),
        bunkers=(Bunker(-10.0, -24.0, 6.0, 4.0, 0.6), Bunker(4.0, 23.0, 5.0, 3.5, 0.5)),
    ),
    Hole(
        number=2,
        par=3,
        tee=(-30.0, 110.0),
        green=(115.0, -40.0),
        green_semi=(13.0, 11.0),
        fairway=(160.0, 200.0, 13.0),
        bunkers=(Bunker(-6.0, 21.0, 6.0, 4.0, 0.55),),
    ),
)

POND_CENTER = (40.0, 30.0)
POND_SEMI = (38.0, 24.0)  # x, z
MOUND = (170.0, -120.0, 40.0, 5.0)  # x, z, radius, height
TEE_HALF = (6.0, 4.0)  # along, across
TEE_RAISE = 0.45
TEE_BANK = 4.5
GREEN_TILT = 0.012
GREEN_UNDULATION = 0.10
PAD_CENTER = (200.5, 215.5)
PAD_HALF = 10.0
# Quadrants seen from above with north up: NW, NE, SW, SE.
PAD_QUADRANTS = {"NW": "bunker", "NE": "cartpath", "SW": "fairway", "SE": "green"}
DRIVE_START = (-135.0, 200.0, 90.0)  # x, z, heading: east along the proving straight
STRIP_PLANE_SLOPE_X = 0.004  # the flat south practice strip rises 0.4% to the east
POOL_CENTER = (-45.0, 223.0)
POOL_HALF = (15.0, 9.0)  # x, z
POOL_DEPTH = 0.5
POOL_RAMP = 4.0  # bank width inside the pool edge; keeps the banks under 35%
POOL_FREEBOARD = 0.05  # water sits this far below the lowest rim node
POOL_ENTRY_RUNUP = 8.0  # qa.waterEntry starts this far west of the pool edge, heading east


def _loop_waypoints() -> list[tuple[float, float]]:
    h1 = HOLES[0]
    return [
        h1.at(15.0, 30.0, origin=h1.tee),
        h1.at(-5.0, 40.0),
        h1.at(30.0, 28.0),
        (40.0, -110.0),
        (138.0, -62.0),
        (165.0, -10.0),
        (165.0, 150.0),
        (140.0, 200.0),
        (-160.0, 200.0),
        (-178.0, 165.0),
    ]


@dataclass
class Packet:
    """In-memory level packet, ready for packet.write_packet."""

    course: dict
    holes: dict
    paths: dict
    height_u16: np.ndarray
    material_u8: np.ndarray
    stripe_u8: np.ndarray
    scatter: bytes
    heights_m: np.ndarray  # decoded, what the game sees
    horizon_u16: np.ndarray | None = None  # optional skirt grid, written when course["horizon"] is set
    logo: bytes | None = None  # optional logo image, written as course["logo"]["file"]


# --- shapes -------------------------------------------------------------------------------


def _frame(x, z, origin, direction):
    ox, oz = origin
    dx, dz = direction
    px = x - ox
    pz = z - oz
    return px * dx + pz * dz, px * (-dz) + pz * dx


def _ellipse_sd(along, across, semi_a, semi_b):
    """Approximate signed distance into an ellipse (positive inside), in meters."""
    q = np.sqrt((along / semi_a) ** 2 + (across / semi_b) ** 2)
    return (1.0 - q) * min(semi_a, semi_b)


def _rect_sd(along, across, half_a, half_b):
    return np.minimum(half_a - np.abs(along), half_b - np.abs(across))


def _rounded_rect_sd(along, across, half_a, half_b, radius):
    """Signed distance into a rectangle with corners rounded by radius (positive inside)."""
    qa = np.abs(along) - (half_a - radius)
    qb = np.abs(across) - (half_b - radius)
    outside = np.sqrt(np.maximum(qa, 0.0) ** 2 + np.maximum(qb, 0.0) ** 2)
    return radius - outside - np.minimum(np.maximum(qa, qb), 0.0)


def _segment_distance(x, z, a, b):
    ax, az = a
    bx, bz = b
    ex = bx - ax
    ez = bz - az
    t = np.clip(((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez), 0.0, 1.0)
    qx = x - (ax + t * ex)
    qz = z - (az + t * ez)
    return np.sqrt(qx * qx + qz * qz)


# --- paths --------------------------------------------------------------------------------


def _fillet(points: list[tuple[float, float]], closed: bool, cut: float = 15.0, steps: int = 12):
    """Round each corner with a quadratic Bezier, keeping long straights straight."""
    n = len(points)
    out: list[tuple[float, float]] = []
    corners = range(n) if closed else range(1, n - 1)
    if not closed:
        out.append(points[0])
    for i in corners:
        px, pz = points[i - 1]
        vx, vz = points[i]
        nx, nz = points[(i + 1) % n]
        lin = math.sqrt((vx - px) ** 2 + (vz - pz) ** 2)
        lout = math.sqrt((nx - vx) ** 2 + (nz - vz) ** 2)
        c = min(cut, 0.4 * lin, 0.4 * lout)
        ax, az = vx + (px - vx) * c / lin, vz + (pz - vz) * c / lin
        bx, bz = vx + (nx - vx) * c / lout, vz + (nz - vz) * c / lout
        for k in range(steps + 1):
            t = k / steps
            s = 1.0 - t
            out.append((s * s * ax + 2 * s * t * vx + t * t * bx, s * s * az + 2 * s * t * vz + t * t * bz))
    if not closed:
        out.append(points[-1])
    return out


def _resample(points: list[tuple[float, float]], closed: bool, step: float) -> np.ndarray:
    pts = [*points, points[0]] if closed else list(points)
    out = [pts[0]]
    carry = 0.0
    for (ax, az), (bx, bz) in itertools.pairwise(pts):
        seg = math.sqrt((bx - ax) ** 2 + (bz - az) ** 2)
        if seg == 0.0:
            continue
        s = step - carry
        while s <= seg:
            t = s / seg
            out.append((ax + (bx - ax) * t, az + (bz - az) * t))
            s += step
        carry = seg - (s - step)
    if closed and len(out) > 1:
        lx, lz = out[-1]
        if math.sqrt((lx - out[0][0]) ** 2 + (lz - out[0][1]) ** 2) < 0.5 * step:
            out.pop()
    return np.array(out, dtype=np.float64)


def _box_smooth(values: np.ndarray, half: int, closed: bool) -> np.ndarray:
    if closed:
        padded = np.concatenate([values[-half:], values, values[:half]])
    else:
        padded = np.concatenate([np.full(half, values[0]), values, np.full(half, values[-1])])
    cs = np.concatenate([[0.0], np.cumsum(padded)])
    width = 2 * half + 1
    return (cs[width:] - cs[:-width]) / width


def _cap_grade(values: np.ndarray, step: float, grade: float, closed: bool) -> np.ndarray:
    v = [float(a) for a in values]
    n = len(v)
    d = step * grade
    for _ in range(3 if closed else 1):
        for i in range(1, n + (1 if closed else 0)):
            prev = v[i - 1]
            cur = v[i % n]
            v[i % n] = min(max(cur, prev - d), prev + d)
        for i in range(n - 2, -1 if not closed else -2, -1):
            nxt = v[(i + 1) % n]
            cur = v[i]
            v[i] = min(max(cur, nxt - d), nxt + d)
    return np.array(v, dtype=np.float64)


def _profile(
    h: np.ndarray,
    samples: np.ndarray,
    closed: bool,
    step: float = PATH_SAMPLE,
    max_grade: float = PATH_MAX_GRADE,
    smooth_m: float = 8.0,
) -> np.ndarray:
    ground = sample_height(h, samples[:, 0], samples[:, 1])
    half = round(smooth_m / step)
    smooth = ground
    for _ in range(3):  # three box passes approximate a Gaussian, sigma ~ 8 m
        smooth = _box_smooth(smooth, half, closed)
    capped = _cap_grade(smooth, step, max_grade, closed)
    return np.round(capped, 3)


def _carve_paths(
    h: np.ndarray,
    x: np.ndarray,
    z: np.ndarray,
    paths: list[tuple[np.ndarray, np.ndarray]],
    flat: float = PATH_FLAT,
):
    """Flatten a corridor to each path profile and blend shoulders; returns distance to nearest path."""
    rows, cols = h.shape
    best_d2 = np.full(h.shape, np.inf)
    best_h = np.zeros(h.shape)
    best_shoulder = np.zeros(h.shape)
    reach = 18
    for samples, prof in paths:
        ground = sample_height(h, samples[:, 0], samples[:, 1])
        shoulders = np.clip(5.5 * np.abs(prof - ground), 4.0, 16.0)
        for (sx, sz), ph, sh in zip(samples, prof, shoulders, strict=True):
            c = round(sx + (cols - 1) / 2)
            r = round(sz + (rows - 1) / 2)
            r0, r1 = max(r - reach, 0), min(r + reach + 1, rows)
            c0, c1 = max(c - reach, 0), min(c + reach + 1, cols)
            dx = x[r0:r1, c0:c1] - sx
            dz = z[r0:r1, c0:c1] - sz
            d2 = dx * dx + dz * dz
            win = best_d2[r0:r1, c0:c1]
            closer = d2 < win
            win[closer] = d2[closer]
            best_h[r0:r1, c0:c1][closer] = ph
            best_shoulder[r0:r1, c0:c1][closer] = sh
    dist = np.sqrt(best_d2)
    near = np.isfinite(best_d2)
    w = np.zeros(h.shape)
    t = np.clip((dist[near] - flat) / best_shoulder[near], 0.0, 1.0)
    w[near] = 1.0 - t * t * (3.0 - 2.0 * t)
    out = h.copy()
    out[near] = lerp(h[near], best_h[near], w[near])
    return out, dist


# --- generation ---------------------------------------------------------------------------


def _base_terrain(x: np.ndarray, z: np.ndarray, seed: int) -> np.ndarray:
    h = 100.0 + STRIP_PLANE_SLOPE_X * x
    h = h + 6.0 * (value_noise(x, z, 160.0, seed + 1) - 0.5)
    h = h + 1.2 * (value_noise(x, z, 40.0, seed + 2) - 0.5)
    mx, mz, mr, mh = MOUND
    r = np.sqrt((x - mx) ** 2 + (z - mz) ** 2)
    h = h + mh * smoothstep(mr, 0.0, r)
    h = h + 4.0 * smoothstep(-150.0, -256.0, z)  # ridge rising toward the north woods
    strip = 100.0 + STRIP_PLANE_SLOPE_X * x
    return lerp(h, strip, smoothstep(160.0, 190.0, z))


def _node(h: np.ndarray, px: float, pz: float) -> float:
    rows, cols = h.shape
    return float(h[round(pz + (rows - 1) / 2), round(px + (cols - 1) / 2)])


def _bearing_code(direction: tuple[float, float]) -> int:
    # atan2 here feeds a u8 quantization, so last-bit libm differences cannot change the result.
    deg = math.degrees(math.atan2(direction[0], -direction[1])) % 180.0
    return round(deg * 256.0 / 180.0) % 256


def generate(seed: int = 1) -> Packet:
    names = material_names()
    mid = {name: material_id(name) for name in names}
    x, z = node_coords(GRID, GRID)
    h = _base_terrain(x, z, seed)
    mat = np.full(h.shape, mid["rough"], dtype=np.uint8)
    stripe = np.zeros(h.shape, dtype=np.uint8)

    # Woods: wavy bands along the north and west edges.
    north_edge = -200.0 + 16.0 * (value_noise(x, np.zeros_like(z), 60.0, seed + 3) - 0.5)
    west_edge = -236.0 + 12.0 * (value_noise(np.zeros_like(x), z, 50.0, seed + 4) - 0.5)
    woods = (z < north_edge) | (x < west_edge)
    mat[woods] = mid["woods"]

    green_masks = []
    for k, hole in enumerate(HOLES):
        direction = hole.direction
        code = _bearing_code(direction)
        # Fairway: a capsule along the tee-green line with a wavy edge.
        s0, s1, half_width = hole.fairway
        a = hole.at(s0, 0.0, origin=hole.tee)
        b = hole.at(s1, 0.0, origin=hole.tee)
        width = half_width + 4.0 * (value_noise(x, z, 30.0, seed + 10 + k) - 0.5)
        fairway = _segment_distance(x, z, a, b) < width
        mat[fairway] = mid["fairway"]
        stripe[fairway] = code

        # Green: plane with a gentle back-to-front tilt plus low undulation, blended into the surround.
        along, across = _frame(x, z, hole.green, direction)
        d = _ellipse_sd(along, across, *hole.green_semi)
        hc = _node(h, *hole.green)
        plane = hc + GREEN_TILT * along + GREEN_UNDULATION * (value_noise(x, z, 14.0, seed + 20 + k) - 0.5)
        h = lerp(h, plane, smoothstep(-10.0, 0.0, d))
        fringe = (d >= -1.5) & (d < 0.0)
        green = d >= 0.0
        mat[fringe] = mid["fringe"]
        mat[green] = mid["green"]
        stripe[fringe | green] = code
        green_masks.append(green)

        # Tee: raised flat box with soft banks.
        t_along, t_across = _frame(x, z, hole.tee, direction)
        td = _rect_sd(t_along, t_across, *TEE_HALF)
        tee_h = _node(h, *hole.tee) + TEE_RAISE
        h = lerp(h, tee_h, smoothstep(-TEE_BANK, 0.0, td))
        tee = td >= 0.0
        mat[tee] = mid["tee"]
        stripe[tee] = code

        # Bunkers: bowls with flat floors.
        for bunker in hole.bunkers:
            center = hole.at(bunker.along, bunker.across)
            b_along, b_across = _frame(x, z, center, direction)
            bd = _ellipse_sd(b_along, b_across, bunker.semi_along, bunker.semi_across)
            h = h - bunker.depth * smoothstep(0.0, 3.5, bd)
            mat[bd >= 0.0] = mid["bunker"]
            stripe[bd >= 0.0] = 0

    # Pond: banks blend down to a shoreline, a wading shelf, then a ~2 m bed.
    px, pz = POND_CENTER
    pa, pb = POND_SEMI
    ring = [(px + pa * ux, pz + pb * uz) for ux, uz in unit_directions(8)]
    level = round(sum(_node(h, rx, rz) for rx, rz in ring) / len(ring) - 0.3, 3)
    pd = _ellipse_sd(x - px, z - pz, pa, pb)
    depth = (
        -0.25
        + 0.30 * smoothstep(-2.0, 0.0, pd)
        + 0.30 * smoothstep(0.0, 1.5, pd)
        + 1.60 * smoothstep(5.0, 14.0, pd)
    )
    h = lerp(h, level - depth, smoothstep(-18.0, -2.0, pd))

    # Wading pool: flat 0.5 m floor with short banks, cut into the south strip.
    qx, qz = POOL_CENTER
    qha, qhb = POOL_HALF
    rim = [(qx + sx * qha, qz + sz * qhb) for sx in (-1.0, 0.0, 1.0) for sz in (-1.0, 0.0, 1.0)]
    pool_level = round(min(_node(h, rx, rz) for rx, rz in rim) - POOL_FREEBOARD, 3)
    pool_sd = _rounded_rect_sd(x - qx, z - qz, qha, qhb, POOL_RAMP)
    floor = round(pool_level - POOL_DEPTH, 3)
    h = np.where(pool_sd > 0.0, lerp(h, floor, smoothstep(0.0, POOL_RAMP, pool_sd)), h)

    # Proving pad: flat square, four material quadrants.
    cx, cz = PAD_CENTER
    pad_h = _node(h, round(cx - 0.5), round(cz - 0.5))
    pad_sd = np.minimum(PAD_HALF - np.abs(x - cx), PAD_HALF - np.abs(z - cz))
    h = lerp(h, pad_h, smoothstep(-6.0, 0.0, pad_sd))

    # Cart paths: authored loop with filleted corners, smoothed and grade-capped profile, carved corridor.
    loop = _resample(_fillet(_loop_waypoints(), closed=True), closed=True, step=PATH_SAMPLE)
    loop_profile = _profile(h, loop, closed=True)
    h, path_dist = _carve_paths(h, x, z, [(loop, loop_profile)])

    # Materials that depend on final heights.
    water = (pd > -2.5) & (h < level)
    mat[water] = mid["water"]
    stripe[water] = 0
    pool = (pool_sd > 0.0) & (h < pool_level)
    mat[pool] = mid["water"]
    stripe[pool] = 0
    on_path = path_dist <= PATH_HALF_WIDTH
    mat[on_path] = mid["cartpath"]
    stripe[on_path] = 0
    pad = pad_sd >= 0.0
    west = x < cx
    north = z < cz
    for key, qmask in (
        ("NW", west & north),
        ("NE", ~west & north),
        ("SW", west & ~north),
        ("SE", ~west & ~north),
    ):
        mat[pad & qmask] = mid[PAD_QUADRANTS[key]]
    stripe[pad] = 0

    # Quantize heights.
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
        for (sx, sz), sy in zip(loop[::every], loop_profile[::every], strict=True)
    ]
    paths = {
        "paths": [
            {
                "id": "loop",
                "width": 2 * PATH_HALF_WIDTH,
                "closed": True,
                "source": "authored",
                "points": path_points,
            }
        ],
        "bridges": [],
    }

    holes = {
        "holes": [
            {
                "number": hole.number,
                "par": hole.par,
                "tee": _xz(hole.tee),
                "green": _xz(hole.green),
                "pin": _xz(hole.at(3.0, -2.0)),
            }
            for hole in HOLES
        ]
    }

    probes = _probes()
    course = {
        "schemaVersion": "0.2",
        "id": "dummy-01",
        "name": "Dummy Links",
        "generator": {"name": "gce-dummy", "version": __version__, "seed": seed},
        "crs": None,
        "grid": {"width": GRID, "height": GRID, "cellSize": 1},
        "height": {"file": "height.u16.bin", "scale": HEIGHT_SCALE, "offset": offset},
        "material": {"file": "material.u8.bin"},
        "stripe": {"file": "stripe.u8.bin"},
        "materials": [{"id": i, "name": n, "color": PALETTE[n]} for i, n in enumerate(names)],
        "spawn": {"x": DRIVE_START[0], "z": DRIVE_START[1], "headingDeg": DRIVE_START[2]},
        "water": [
            {
                "id": "pond-1",
                "level": level,
                "polygon": [
                    [round(px + (pa + 3.0) * ux, 3), round(pz + (pb + 3.0) * uz, 3)]
                    for ux, uz in unit_directions(8)
                ],
            },
            {
                "id": "pool-2",
                "level": pool_level,
                "polygon": [
                    [qx - qha, qz - qhb],
                    [qx + qha, qz - qhb],
                    [qx + qha, qz + qhb],
                    [qx - qha, qz + qhb],
                ],
            },
        ],
        "scatter": {"file": "scatter.bin", "species": species},
        "holes": "holes.json",
        "paths": "paths.json",
        "attribution": [],
        "files": {},
        "qa": {
            "driveStart": {"x": DRIVE_START[0], "z": DRIVE_START[1], "headingDeg": DRIVE_START[2]},
            "wheelPad": {
                "x": PAD_CENTER[0],
                "z": PAD_CENTER[1],
                "headingDeg": 0.0,
                "expected": {
                    "FL": PAD_QUADRANTS["NW"],
                    "FR": PAD_QUADRANTS["NE"],
                    "RL": PAD_QUADRANTS["SW"],
                    "RR": PAD_QUADRANTS["SE"],
                },
            },
            "waterEntry": {"x": qx - qha - POOL_ENTRY_RUNUP, "z": qz, "headingDeg": 90.0},
            "probes": probes,
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


def _xz(p: tuple[float, float]) -> dict:
    return {"x": round(p[0], 3), "z": round(p[1], 3)}


def _probes() -> list[dict]:
    h1, h2 = HOLES
    out = [
        ("rough", (-100.0, 60.0)),
        ("woods", (0.0, -240.0)),
        ("woods", (-250.0, 0.0)),
        ("fairway", h1.at(150.0, 0.0, origin=h1.tee)),
        ("fairway", h2.at(-28.0, 0.0)),
        ("green", h1.green),
        ("green", h2.green),
        ("fringe", h1.at(h1.green_semi[0] + 0.6, 0.0)),
        ("tee", h1.tee),
        ("tee", h2.tee),
        ("water", POND_CENTER),
        ("water", POOL_CENTER),
        ("cartpath", (0.0, 200.0)),
        ("cartpath", (165.0, 60.0)),
    ]
    for hole in HOLES:
        for bunker in hole.bunkers:
            out.append(("bunker", hole.at(bunker.along, bunker.across)))
    return [{"x": round(p[0], 3), "z": round(p[1], 3), "material": m} for m, p in out]


def _check_probes(packet: Packet) -> None:
    names = material_names()
    for probe in packet.course["qa"]["probes"]:
        got = names[_material_at(packet.material_u8, probe["x"], probe["z"])]
        if got != probe["material"]:
            raise AssertionError(
                f"probe at ({probe['x']}, {probe['z']}) expected {probe['material']}, got {got}"
            )


def _material_at(mat: np.ndarray, px: float, pz: float) -> int:
    rows, cols = mat.shape
    c = min(max(math.floor(px + (cols - 1) / 2 + 0.5), 0), cols - 1)
    r = min(max(math.floor(pz + (rows - 1) / 2 + 0.5), 0), rows - 1)
    return int(mat[r, c])


def _scatter(mat: np.ndarray, woods_id: int, seed: int):
    """Jittered-grid trees in the woods: Float32 [x, z, scale, rotation] per tree, grouped by species."""
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
    in_woods = mat[r, c] == woods_id
    sel = inside & keep & in_woods
    is_oak = hash01(ii, jj, seed + 43) < 0.3
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
