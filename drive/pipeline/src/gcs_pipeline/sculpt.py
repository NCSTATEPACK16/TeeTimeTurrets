"""Authored-over-measured terrain: smooth by surface, then shape greens, tees, bunkers and water.

Input is the lidar DEM on a stage's 1 m node grid plus boolean node masks per surface. Every
limit is checked on the same two-triangles-per-cell slopes the game's collider uses
(heightmap.triangle_slopes), so what passes here passes in the tests.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
from scipy import ndimage

from .heightmap import triangle_slopes
from .rng import smoothstep


@dataclass
class SculptResult:
    heights: np.ndarray
    embankment: np.ndarray  # nodes left steeper than the drivable cap
    water_levels: list[float] = field(default_factory=list)  # one per water component, label order
    water_labels: np.ndarray | None = None
    report: dict = field(default_factory=dict)


def feather(mask: np.ndarray, width: float) -> np.ndarray:
    """1 inside the mask, easing to 0 at `width` meters outside it."""
    if not mask.any():
        return np.zeros(mask.shape)
    d = ndimage.distance_transform_edt(~mask)
    return 1.0 - smoothstep(0.0, width, d)


def max_cell_slope(h: np.ndarray, nodes: np.ndarray) -> float:
    """Steepest triangle among cells whose four corners are all in `nodes`."""
    lower, upper = triangle_slopes(h)
    cells = nodes[:-1, :-1] & nodes[:-1, 1:] & nodes[1:, :-1] & nodes[1:, 1:]
    if not cells.any():
        return 0.0
    return float(max(lower[cells].max(), upper[cells].max()))


def fit_plane(h: np.ndarray, nodes: np.ndarray, max_tilt: float) -> np.ndarray:
    """Least-squares plane through h at `nodes`, its gradient clamped to max_tilt, over the grid."""
    rr, cc = np.nonzero(nodes)
    a = np.c_[np.ones(rr.size), cc - cc.mean(), rr - rr.mean()]
    coef, *_ = np.linalg.lstsq(a, h[rr, cc], rcond=None)
    g = np.hypot(coef[1], coef[2])
    if g > max_tilt:
        coef[1:] *= max_tilt / g
    rows, cols = np.indices(h.shape)
    return coef[0] + coef[1] * (cols - cc.mean()) + coef[2] * (rows - rr.mean())


def shape_greens(h: np.ndarray, green: np.ndarray, c: dict) -> tuple[np.ndarray, list[float]]:
    """Each green: clamped plane plus scaled lidar undulation, as much as the slope cap allows."""
    lab, n = ndimage.label(green)
    out = h.copy()
    slopes = []
    for k in range(1, n + 1):
        g = lab == k
        pad = ndimage.distance_transform_edt(~g) <= c["green_pad_m"]
        plane = fit_plane(h, pad, c["green_max_tilt"])
        resid = ndimage.gaussian_filter(h, c["green_undulation_sigma_m"]) - plane
        lo, hi = 0.0, 1.0
        for _ in range(20):  # bisection on how much undulation to keep
            mid = (lo + hi) / 2
            if max_cell_slope(plane + mid * resid, pad) <= c["green_max_slope"]:
                lo = mid
            else:
                hi = mid
        surface = plane + lo * resid
        w = feather(pad, c["feather_m"])
        out = out * (1 - w) + surface * w
        slopes.append(max_cell_slope(out, g))
    return out, slopes


def shape_tees(h: np.ndarray, tee: np.ndarray, c: dict) -> np.ndarray:
    lab, n = ndimage.label(tee)
    out = h.copy()
    for k in range(1, n + 1):
        t = lab == k
        pad = ndimage.distance_transform_edt(~t) <= c["tee_pad_m"]
        plane = fit_plane(h, t, c["tee_max_tilt"])
        w = feather(pad, c["feather_m"])
        out = out * (1 - w) + plane * w
    return out


def shape_bunkers(h: np.ndarray, bunker: np.ndarray, c: dict) -> np.ndarray:
    """Bowls: up to bunker_depth below the smoothed surroundings, easing in over bunker_ramp."""
    if not bunker.any():
        return h
    lip = ndimage.gaussian_filter(h, c["bunker_lip_sigma_m"])
    inside = ndimage.distance_transform_edt(bunker)
    bowl = lip - c["bunker_depth_m"] * smoothstep(0.0, c["bunker_ramp_m"], inside)
    return np.where(bunker, np.minimum(h, bowl), h)


def shape_water(
    h: np.ndarray, water: np.ndarray, c: dict, wade: np.ndarray | None = None
) -> tuple[np.ndarray, list[float], np.ndarray]:
    """Flat surface per pond just under its lowest shore node; shelf, then a bed to max depth.

    `wade` marks authored wading shelves (overrides: a water polygon with a `wade` depth): the bed
    there is flat at c["water_wade_depth_m"], easing back to the normal bed over
    c["water_wade_feather_m"], so the cart can drive into 0.5 m water (qa.waterEntry).
    """
    lab, n = ndimage.label(water)
    out = h.copy()
    levels = []
    for k in range(1, n + 1):
        w = lab == k
        ring = (ndimage.distance_transform_edt(~w) <= 2.0) & ~w
        level = round(float(np.percentile(h[ring], 5)) - c["water_freeboard_m"], 3)
        d = ndimage.distance_transform_edt(w)
        depth = c["water_shelf_depth_m"] * smoothstep(0.0, 1.0, d) + (
            c["water_max_depth_m"] - c["water_shelf_depth_m"]
        ) * smoothstep(c["water_shelf_width_m"] + 1.0, c["water_deep_from_m"] + 4.0, d)
        if wade is not None and (wade & w).any():
            ww = feather(wade & w, c["water_wade_feather_m"])
            depth = depth * (1.0 - ww) + c["water_wade_depth_m"] * smoothstep(0.0, 1.0, d) * ww
        out = np.where(w, np.minimum(out, level - depth), out)
        # The shore must stay above the water so it can't spill.
        out = np.where(ring, np.maximum(out, level + 0.05), out)
        levels.append(level)
    return out, levels, lab


def relax(h: np.ndarray, fixed: np.ndarray, limit: float, iterations: int) -> tuple[np.ndarray, np.ndarray]:
    """Average nodes that touch a too-steep triangle, never moving `fixed` nodes. Returns h, steep nodes."""
    out = h.copy()
    steep = np.zeros(h.shape, dtype=bool)
    for _ in range(iterations):
        lower, upper = triangle_slopes(out)
        bad = (lower > limit) | (upper > limit)
        if not bad.any():
            return out, np.zeros(h.shape, dtype=bool)
        steep = np.zeros(h.shape, dtype=bool)
        steep[:-1, :-1] |= bad
        steep[:-1, 1:] |= bad
        steep[1:, :-1] |= bad
        steep[1:, 1:] |= bad
        move = steep & ~fixed
        avg = ndimage.uniform_filter(out, size=3, mode="nearest")
        out = np.where(move, avg, out)
    lower, upper = triangle_slopes(out)
    bad = (lower > limit) | (upper > limit)
    steep = np.zeros(h.shape, dtype=bool)
    steep[:-1, :-1] |= bad
    steep[:-1, 1:] |= bad
    steep[1:, :-1] |= bad
    steep[1:, 1:] |= bad
    return out, steep


def sculpt(
    dem: np.ndarray, masks: dict[str, np.ndarray], c: dict, wade: np.ndarray | None = None
) -> SculptResult:
    empty = np.zeros(dem.shape, dtype=bool)
    m = {s: masks.get(s, empty) for s in ("green", "tee", "fairway", "bunker", "water")}
    h = ndimage.gaussian_filter(dem, c["base_sigma_m"])
    rough = ndimage.gaussian_filter(dem, c["rough_sigma_m"])
    fairway = ndimage.gaussian_filter(dem, c["fairway_sigma_m"])
    w_course = feather(m["fairway"] | m["green"] | m["tee"], c["feather_m"])
    h = h * (1 - w_course) + rough * w_course
    w_fw = feather(m["fairway"], c["feather_m"])
    h = h * (1 - w_fw) + fairway * w_fw
    h = shape_tees(h, m["tee"], c)
    h, _ = shape_greens(h, m["green"], c)
    h = shape_bunkers(h, m["bunker"], c)
    h, levels, wlab = shape_water(h, m["water"], c, wade)
    # Greens keep their shape; tee edges and everything else may be eased.
    fixed = ndimage.binary_dilation(m["green"], iterations=1) | ndimage.binary_erosion(m["tee"], iterations=2)
    shore = ndimage.binary_dilation(m["water"], iterations=2)
    h, steep = relax(h, fixed | shore, c["drivable_max_slope"], c["relax_iterations"])
    green_slopes = [
        max_cell_slope(h, ndimage.label(m["green"])[0] == k)
        for k in range(1, ndimage.label(m["green"])[1] + 1)
    ]
    report = {
        "maxGreenSlope": max(green_slopes, default=0.0),
        "embankmentNodes": int(steep.sum()),
        "meanAbsChangeM": float(np.abs(h - dem).mean()),
        "maxAbsChangeM": float(np.abs(h - dem).max()),
        "waterLevels": levels,
    }
    return SculptResult(h, steep, levels, wlab, report)
