"""Cart paths from traced polylines: spline, clip to the stage, grade-capped profile, carved corridor.

Traced vertices are rough clicks on an aerial, so the line goes through a centripetal-free
uniform Catmull-Rom spline first, then the same profile and corridor carving gce-dummy uses
(dummy._profile, dummy._carve_paths). Where two paths meet they share a level junction pad (see
`build`); the corridor is then carved for all paths at once, each node following its nearest path.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
import shapely
from shapely.geometry import LineString, Point, box

from .dummy import _carve_paths, _profile, _resample
from .layout import Feature, StageGrid
from .rng import smoothstep


def catmull_rom(points: np.ndarray, step: float) -> np.ndarray:
    """Uniform Catmull-Rom through every point (ends duplicated), sampled about every `step` meters."""
    p = np.vstack([points[0], points, points[-1]])
    out = [points[0]]
    for i in range(1, len(p) - 2):
        p0, p1, p2, p3 = p[i - 1], p[i], p[i + 1], p[i + 2]
        n = max(int(np.ceil(np.linalg.norm(p2 - p1) / step)), 1)
        t = np.arange(1, n + 1)[:, None] / n
        t2, t3 = t * t, t * t * t
        seg = 0.5 * (
            2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3
        )
        out.extend(seg)
    return np.array(out)


@dataclass
class _Path:
    id: str
    traced: LineString  # course frame, for snapping later ends
    line: LineString  # packet world, through the samples
    samples: np.ndarray  # (n, 2) packet world x, z every sample_m
    prof: np.ndarray  # (n,) heights
    pinned: np.ndarray  # (n,) bool: held at a junction pad's height


def build(
    h: np.ndarray, features: list[Feature], grid: StageGrid, c: dict
) -> tuple[np.ndarray, np.ndarray, list[dict]]:
    """Carve every cartpath feature into h. Returns heights, distance to nearest path, paths.json entries.

    Hole paths go first, then connectors (features without a hole), so a connector is always the
    branch at a junction. Where a path ends on, or crosses, an earlier one, both get a level
    junction pad (`junction_pad_m` radius at the earlier path's height there) and ease into it, so
    neither path's corridor tilts across the other. Where a later path only passes close to an
    earlier one, it follows the earlier one's heights along that stretch (`_follow`).
    """
    cx, cz = grid.center
    x, z = grid.coords()
    xw, zw = x - cx, z - cz  # packet world: grid-centered
    m = c["edge_margin_m"]
    clip = box(grid.x0 + m, grid.z0 + m, grid.x0 + grid.width - 1 - m, grid.z0 + grid.height - 1 - m)
    built: list[_Path] = []
    order = sorted((f for f in features if f.surface == "cartpath"), key=lambda f: (f.hole is None, f.id))
    for f in order:
        smooth = LineString(catmull_rom(np.asarray(f.geom.coords), c["spline_step_m"]))
        part = smooth if clip.contains(smooth) else smooth.intersection(clip)
        if part.is_empty:
            continue
        lines = list(part.geoms) if hasattr(part, "geoms") else [part]
        for k, line in enumerate(sorted(lines, key=lambda g: -g.length)):
            if line.length < 10.0:
                continue
            line = _snap_ends(line, [b.traced for b in built], c["join_snap_m"])
            pts = np.asarray(line.coords) - [cx, cz]
            samples = _resample([tuple(p) for p in pts], closed=False, step=c["sample_m"])
            prof = _profile(h, samples, False, c["sample_m"], c["max_grade"], c["profile_smooth_m"])
            new = _Path(
                f.id if k == 0 else f"{f.id}-{k}",
                line,
                LineString(samples),
                samples,
                prof.astype(np.float64),
                np.zeros(len(samples), dtype=bool),
            )
            reach = 2.0 * c["flat_half_m"] + 1.5  # corridors closer than this would share nodes
            for old in built:
                pads = _junctions(new.line, old.line, reach)
                for jx, jz in pads:
                    _pad(old, new, jx, jz, c)
                if pads:  # settle the eased profiles before anything copies them
                    for p in (old, new):
                        p.prof = _pin_cap(p.prof, p.pinned, c["sample_m"], c["max_grade"])
                    _follow(old, new, reach)
            built.append(new)
    for p in built:
        p.prof = np.round(_pin_cap(p.prof, p.pinned, c["sample_m"], c["max_grade"]), 3)
        steps = np.abs(np.diff(p.prof)) / c["sample_m"]
        if len(steps) and steps.max() > c["max_grade"] + 0.01:
            i = int(np.argmax(steps))
            sx, sz = p.samples[i] + [cx, cz]
            raise ValueError(
                f"{p.id}: junction pads need a {steps[i]:.1%} grade at ({sx:.0f}, {sz:.0f}); reroute it"
            )
    out, dist = _carve_paths(h, xw, zw, [(p.samples, p.prof) for p in built], flat=c["flat_half_m"])
    every = round(1.0 / c["sample_m"])
    entries = []
    for i, p in enumerate(built):
        # Points on an earlier path's corridor belong to that path (a junction), so leave them out.
        own = _off_earlier(p.samples, [(b.samples, b.prof) for b in built[:i]], c["flat_half_m"])
        entries.append(
            {
                "id": p.id,
                "width": c["width_m"],
                "closed": False,
                "source": "authored",
                "points": [
                    [round(float(sx), 3), round(float(sy), 3), round(float(sz), 3)]
                    for (sx, sz), sy, keep in zip(
                        p.samples[::every], p.prof[::every], own[::every], strict=True
                    )
                    if keep
                ],
            }
        )
    return out, dist, entries


def _junctions(new: LineString, old: LineString, reach: float) -> list[tuple[float, float]]:
    """Pad centers on `old` where `new` meets it: for each stretch of `new` within `reach` of old,
    where the stretch begins and ends and where it crosses old (an end on old is both)."""
    near = new.intersection(old.buffer(reach))
    if near.is_empty:
        return []
    out: list[tuple[float, float]] = []
    for g in getattr(near, "geoms", [near]):
        if g.length <= 0:
            continue
        crossing = g.intersection(old)
        marks = [Point(g.coords[0]), Point(g.coords[-1])]
        marks += [
            q for q in getattr(crossing, "geoms", [crossing]) if not q.is_empty and q.geom_type == "Point"
        ]
        for m in marks:
            q = old.interpolate(old.project(m))
            if all(math.hypot(q.x - x, q.y - z) > 1.0 for x, z in out):
                out.append((q.x, q.y))
    return out


def _pad(old: _Path, new: _Path, jx: float, jz: float, c: dict) -> None:
    """Level both paths at the old path's height within `junction_pad_m` of (jx, jz), easing in."""
    r, ease = c["junction_pad_m"], c["profile_smooth_m"]
    d_old = np.hypot(old.samples[:, 0] - jx, old.samples[:, 1] - jz)
    j = int(np.argmin(d_old))
    # Along the old path by arc length (it may curve back near the pad); the new one by distance.
    arc = np.abs(np.arange(len(old.prof)) - j) * c["sample_m"]
    # A pad overlapping one already on the old path joins it, at its height.
    held = np.flatnonzero(old.pinned & (arc <= r))
    height = float(old.prof[held[np.argmin(arc[held])]] if len(held) else old.prof[j])
    d_new = np.hypot(new.samples[:, 0] - jx, new.samples[:, 1] - jz)
    if not len(held):
        # Keep the level pad reachable from every pad already on either path at the grade cap.
        arc_new = np.abs(np.arange(len(new.prof)) - int(np.argmin(d_new))) * c["sample_m"]
        lo, hi = -np.inf, np.inf
        for p, a in ((old, arc), (new, arc_new)):
            k = p.pinned & (a > r)
            slack = 0.95 * c["max_grade"] * (a[k] - r)
            lo = max(lo, float(np.max(p.prof[k] - slack, initial=-np.inf)))
            hi = min(hi, float(np.min(p.prof[k] + slack, initial=np.inf)))
        if lo <= hi:
            height = min(max(height, lo), hi)
    for p, d in ((old, arc), (new, d_new)):
        w = 1.0 - smoothstep(r, r + ease, d)
        free = ~p.pinned
        p.prof[free] = p.prof[free] * (1.0 - w[free]) + height * w[free]
        pin = free & (d <= r)
        p.prof[pin] = height
        p.pinned |= pin


def _follow(old: _Path, new: _Path, reach: float) -> None:
    """Where `new` runs within `reach` of `old`, it takes old's height at its nearest point on old and
    both are pinned there, so the corridor nodes between them agree whichever path they follow."""
    free = np.flatnonzero(~new.pinned)
    if not len(free):
        return
    pts = shapely.points(new.samples[free])
    hit = shapely.distance(pts, old.line) <= reach
    if not hit.any():
        return
    idx = free[hit]
    arc = shapely.line_locate_point(old.line, pts[hit])
    old_arc = np.arange(len(old.prof)) * old.line.length / max(len(old.prof) - 1, 1)
    new.prof[idx] = np.interp(arc, old_arc, old.prof)
    new.pinned[idx] = True
    # Pin the old samples each followed point reads from, a meter either side.
    step = old_arc[1] if len(old_arc) > 1 else 1.0
    near = np.rint(arc / step).astype(int)[:, None] + np.arange(-round(1.0 / step), round(1.0 / step) + 1)
    old.pinned[np.clip(near, 0, len(old.prof) - 1).ravel()] = True


def _pin_cap(values: np.ndarray, pinned: np.ndarray, step: float, grade: float) -> np.ndarray:
    """Cap the grade between neighbors without moving pinned samples (forward/backward to a fixpoint)."""
    v = values.astype(np.float64).copy()
    d = step * grade
    n = len(v)
    for _ in range(50):
        before = v.copy()
        for i in range(1, n):
            if not pinned[i]:
                v[i] = min(max(v[i], v[i - 1] - d), v[i - 1] + d)
        for i in range(n - 2, -1, -1):
            if not pinned[i]:
                v[i] = min(max(v[i], v[i + 1] - d), v[i + 1] + d)
        if np.array_equal(v, before):
            break
    return v


def _off_earlier(
    samples: np.ndarray, earlier: list[tuple[np.ndarray, np.ndarray]], flat: float
) -> np.ndarray:
    keep = np.ones(len(samples), dtype=bool)
    for other, _ in earlier:
        d = np.min(
            np.hypot(samples[:, None, 0] - other[None, ::4, 0], samples[:, None, 1] - other[None, ::4, 1]),
            axis=1,
        )
        keep &= d > flat + 0.5
    return keep


def _snap_ends(line: LineString, built: list[LineString], snap: float) -> LineString:
    """Move an end that stops near an earlier path onto that path, so the two share a junction."""
    pts = [tuple(p) for p in line.coords]
    for end in (0, -1):
        p = Point(pts[end])
        near = min(built, key=lambda b: b.distance(p), default=None)
        if near is not None and 0.0 < near.distance(p) <= snap:
            q = near.interpolate(near.project(p))
            if end == 0:
                pts.insert(0, (q.x, q.y))
            else:
                pts.append((q.x, q.y))
    return LineString(pts)
