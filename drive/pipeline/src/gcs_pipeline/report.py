"""Sculpt report for review: hillshades before and after, a material map, and stats as JSON."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image

from .dummy import PALETTE, Packet
from .heightmap import triangle_slopes
from .schema import material_id, material_names


def hillshade(h: np.ndarray, exaggeration: float = 3.0) -> np.ndarray:
    gz, gx = np.gradient(h * exaggeration)
    nx, ny, nz = -gx, np.ones_like(h), gz
    n = np.sqrt(nx * nx + ny * ny + nz * nz)
    light = np.array([-1.0, 1.2, -1.0])
    light /= np.linalg.norm(light)
    return (np.clip((nx * light[0] + ny * light[1] + nz * light[2]) / n, 0, 1) * 255).astype(np.uint8)


def stats(packet: Packet) -> dict:
    h = packet.heights_m
    mat = packet.material_u8
    lower, upper = triangle_slopes(h)
    steepest = np.maximum(lower, upper)

    def cells(mask):
        return mask[:-1, :-1] & mask[:-1, 1:] & mask[1:, :-1] & mask[1:, 1:]

    green = cells(mat == material_id("green"))
    embank = mat == material_id("embankment")
    near_embank = embank[:-1, :-1] | embank[:-1, 1:] | embank[1:, :-1] | embank[1:, 1:]
    return {
        "maxGreenSlope": float(steepest[green].max()) if green.any() else None,
        "maxDrivableSlope": float(steepest[~near_embank].max()),
        "cellsOver35pct": int((steepest > 0.35).sum()),
        "materials": {n: int((mat == i).sum()) for i, n in enumerate(material_names())},
    }


def write(out: Path, packet: Packet, report: dict) -> None:
    out.mkdir(parents=True, exist_ok=True)
    Image.fromarray(hillshade(report["dem"])).save(out / "hillshade_before.png")
    Image.fromarray(hillshade(report["heights"])).save(out / "hillshade_after.png")
    pal = np.array([[int(PALETTE[n][i : i + 2], 16) for i in (1, 3, 5)] for n in material_names()], np.uint8)
    Image.fromarray(pal[packet.material_u8]).save(out / "materials.png")
    diff = report["heights"] - report["dem"]
    body = {k: v for k, v in report.items() if k not in ("dem", "heights")}
    body["packet"] = stats(packet)
    body["changeM"] = {
        "mean": float(np.abs(diff).mean()),
        "p99": float(np.percentile(np.abs(diff), 99)),
        "max": float(np.abs(diff).max()),
    }
    (out / "report.json").write_text(json.dumps(body, indent=2) + "\n", encoding="utf-8")
