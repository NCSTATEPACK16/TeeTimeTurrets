"""QA poses the packet-agnostic web tests drive from: a straight run, and one probe per material."""

from __future__ import annotations

import math

import numpy as np
from scipy import ndimage

from .schema import material_id, material_names


def drive_start(h: np.ndarray, mat: np.ndarray, c: dict) -> dict:
    """The longest straight, nearly flat run on the surfaces in c["drive_surfaces"]. Packet-world pose.

    Flat both ways: along the heading (grade over 5 m) and across it (height difference between
    points `drive_cross_half_m` either side), since side slope skews drift and roll tests.
    """
    rows, cols = h.shape
    ok = np.isin(mat, [material_id(s) for s in c["drive_surfaces"]])
    ok = ndimage.binary_erosion(ok, iterations=2)  # keep the cart's track width on good ground
    k = round(c["drive_start_step_m"])
    rr, cc = np.nonzero(ok[::k, ::k])
    col0, row0 = (cc * k).astype(np.float64), (rr * k).astype(np.float64)
    max_grade = c["drive_max_grade"]
    max_cross = c["drive_max_cross"]
    half = c["drive_cross_half_m"]
    best_run, best_pose = 0.0, None
    candidates = []  # (run, x, z, heading, net grade over the first drive_min_run_m)
    for hd in np.arange(0.0, 360.0, c["drive_headings_deg"]):
        dx, dz = math.sin(math.radians(hd)), -math.cos(math.radians(hd))
        run = np.zeros(col0.size)
        alive = np.ones(col0.size, dtype=bool)
        prev = h[rr * k, cc * k]
        n = 0
        while alive.any():
            n += 1
            ci = np.rint(col0 + dx * n).astype(np.int64)
            ri = np.rint(row0 + dz * n).astype(np.int64)
            inside = (ci >= 0) & (ci < cols) & (ri >= 0) & (ri < rows)
            ci, ri = np.clip(ci, 0, cols - 1), np.clip(ri, 0, rows - 1)
            alive &= inside & ok[ri, ci]
            if n % 5 == 0:  # grade over 5 m steps, cross-slope at the same point
                hn = h[ri, ci]
                alive &= np.abs(hn - prev) / 5.0 <= max_grade
                prev = np.where(alive, hn, prev)
                lc = np.clip(np.rint(ci - dz * half).astype(np.int64), 0, cols - 1)
                lr = np.clip(np.rint(ri + dx * half).astype(np.int64), 0, rows - 1)
                rc = np.clip(np.rint(ci + dz * half).astype(np.int64), 0, cols - 1)
                rr2 = np.clip(np.rint(ri - dx * half).astype(np.int64), 0, rows - 1)
                alive &= np.abs(h[lr, lc] - h[rr2, rc]) / (2 * half) <= max_cross
            run = np.where(alive, n, run)
        i = int(np.argmax(run))
        want = c.get("drive_min_run_m")
        if want:
            for j in np.nonzero(run >= want)[0]:
                c1 = int(np.clip(round(col0[j] + dx * want), 0, cols - 1))
                r1 = int(np.clip(round(row0[j] + dz * want), 0, rows - 1))
                net = (h[r1, c1] - h[int(row0[j]), int(col0[j])]) / want
                candidates.append((float(run[j]), col0[j], row0[j], float(hd), float(net)))
        if run[i] > best_run:
            best_run = float(run[i])
            best_pose = (col0[i] - (cols - 1) / 2, row0[i] - (rows - 1) / 2, float(hd))
    if candidates:
        # Long enough everywhere: take the most level one (net grade near zero), then the longest.
        run_m, col, row, hd, net = min(candidates, key=lambda t: (round(abs(t[4]), 3), -t[0]))
        x, z = col - (cols - 1) / 2, row - (rows - 1) / 2
        pose = {"x": round(float(x), 3), "z": round(float(z), 3), "headingDeg": hd}
        return pose | {"runM": run_m, "netGrade": net}
    if best_pose is None:
        raise ValueError("no drivable straight found")
    x, z, hd = best_pose
    return {"x": round(float(x), 3), "z": round(float(z), 3), "headingDeg": hd, "runM": best_run}


def probes(mat: np.ndarray, per: int = 2) -> list[dict]:
    """For each material present, the deepest interior nodes (farthest from another material)."""
    rows, cols = mat.shape
    out = []
    for i, name in enumerate(material_names()):
        m = mat == i
        if not m.any():
            continue
        d = ndimage.distance_transform_edt(np.pad(m, 1))[1:-1, 1:-1]
        lab, n = ndimage.label(m)
        picks = []
        for k in np.argsort(-ndimage.maximum(d, lab, index=np.arange(1, n + 1)))[:per]:
            comp = lab == k + 1
            r, c = np.unravel_index(np.argmax(np.where(comp, d, -1)), d.shape)
            picks.append((r, c))
        for r, c in picks:
            out.append({"x": float(c - (cols - 1) / 2), "z": float(r - (rows - 1) / 2), "material": name})
    return out


def _world(rows: int, cols: int, r: float, c: float) -> tuple[float, float]:
    return float(c - (cols - 1) / 2), float(r - (rows - 1) / 2)


def deep_water(h: np.ndarray, labels: np.ndarray, levels: list[float], c: dict) -> dict | None:
    """qa.deepWater: the deepest water node at least c["deep_water_min_m"] deep, or None."""
    if labels is None or not levels:
        return None
    lv = np.concatenate([[np.nan], np.asarray(levels, dtype=np.float64)])
    depth = np.where(labels > 0, lv[labels] - h, -np.inf)
    r, col = np.unravel_index(int(np.argmax(depth)), depth.shape)
    if depth[r, col] < c["deep_water_min_m"]:
        return None
    x, z = _world(*h.shape, r, col)
    return {"x": x, "z": z, "headingDeg": 0.0}


def water_entry(
    h: np.ndarray, labels: np.ndarray, levels: list[float], wade: np.ndarray, c: dict
) -> dict | None:
    """qa.waterEntry: a dry pose `water_entry_before_m` short of an authored wading shelf, heading
    straight in, where the water `water_entry_probe_m` ahead is inside c["water_entry_depth"] and
    the run in is drivable (grade within c["drive_max_grade"] * 3 on the dry part). None if no shelf."""
    from .heightmap import sample_height

    if labels is None or wade is None or not (wade & (labels > 0)).any():
        return None
    rows, cols = h.shape
    lo, hi = c["water_entry_depth"]
    target = (lo + hi) / 2
    before, probe = c["water_entry_before_m"], c["water_entry_probe_m"]
    shore = ndimage.binary_dilation(wade & (labels > 0), iterations=1) & (labels == 0)
    rr, cc = np.nonzero(shore)
    best, best_err = None, np.inf
    lv = np.concatenate([[np.nan], np.asarray(levels, dtype=np.float64)])
    for r, col in zip(rr[::2], cc[::2], strict=True):
        sx, sz = _world(rows, cols, r, col)
        for hd in np.arange(0.0, 360.0, c["drive_headings_deg"]):
            dx, dz = math.sin(math.radians(hd)), -math.cos(math.radians(hd))
            px, pz = sx - dx * before, sz - dz * before
            ts = np.arange(0.0, probe + 4.0 + 1e-9, 0.5)
            xs, zs = px + dx * ts, pz + dz * ts
            ci = np.clip(np.rint(xs + (cols - 1) / 2).astype(int), 0, cols - 1)
            ri = np.clip(np.rint(zs + (rows - 1) / 2).astype(int), 0, rows - 1)
            lab = labels[ri, ci]
            if lab[0] != 0 or (lab[ts >= before + 3.0] == 0).any():
                continue
            k = int(lab[ts >= before + 3.0][0])
            if (lab[ts >= before + 3.0] != k).any():
                continue
            hh = sample_height(h, xs, zs)
            dry = ts < before
            if np.abs(np.diff(hh[dry])).max(initial=0.0) / 0.5 > c["drive_max_grade"] * 3:
                continue
            depth = lv[k] - hh
            run = ts >= before + 3.0
            if depth[run].min() < lo - 0.1 or depth[run].max() > hi + 0.1:
                continue
            at = float(lv[k] - sample_height(h, px + dx * probe, pz + dz * probe))
            if not lo <= at <= hi:
                continue
            err = abs(at - target) + float(np.ptp(depth[run]))
            if err < best_err:
                best_err = err
                best = {"x": round(px, 3), "z": round(pz, 3), "headingDeg": float(hd), "depthAhead": at}
    return best
