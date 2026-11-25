"""Write and read level packets (v0.2). Output is byte-deterministic for identical input."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import numpy as np

from .dummy import Packet

BINARY_FILES = ("height.u16.bin", "material.u8.bin", "stripe.u8.bin", "scatter.bin")
JSON_FILES = ("holes.json", "paths.json")


def dumps(data: object) -> bytes:
    """Canonical JSON: sorted keys, 2-space indent, LF, trailing newline."""
    return (json.dumps(data, sort_keys=True, indent=2, ensure_ascii=False, allow_nan=False) + "\n").encode(
        "utf-8"
    )


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def packet_bytes(packet: Packet) -> dict[str, bytes]:
    """Every file of the packet as bytes, with course.json's hash manifest filled in."""
    files: dict[str, bytes] = {
        "height.u16.bin": packet.height_u16.astype("<u2").tobytes(order="C"),
        "material.u8.bin": packet.material_u8.astype(np.uint8).tobytes(order="C"),
        "stripe.u8.bin": packet.stripe_u8.astype(np.uint8).tobytes(order="C"),
        "scatter.bin": packet.scatter,
        "holes.json": dumps(packet.holes),
        "paths.json": dumps(packet.paths),
    }
    course_in = packet.course
    if (packet.horizon_u16 is None) != ("horizon" not in course_in):
        raise ValueError("course['horizon'] and Packet.horizon_u16 must be set together")
    if packet.horizon_u16 is not None:
        hz = course_in["horizon"]
        if packet.horizon_u16.shape != (hz["height"], hz["width"]):
            raise ValueError(f"horizon grid {packet.horizon_u16.shape} != {hz['height']}x{hz['width']}")
        files[hz["file"]] = packet.horizon_u16.astype("<u2").tobytes(order="C")
    if (packet.logo is None) != ("logo" not in course_in):
        raise ValueError("course['logo'] and Packet.logo must be set together")
    if packet.logo is not None:
        files[course_in["logo"]["file"]] = packet.logo
    course = dict(packet.course)
    course["files"] = {name: sha256(data) for name, data in sorted(files.items())}
    files["course.json"] = dumps(course)
    return files


def write_packet(out_dir: Path, packet: Packet) -> dict[str, bytes]:
    """Write all packet files into out_dir (created if needed). Returns what was written."""
    out_dir.mkdir(parents=True, exist_ok=True)
    files = packet_bytes(packet)
    for name, data in files.items():
        (out_dir / name).write_bytes(data)
    return files


def read_packet(packet_dir: Path) -> dict:
    """Load a packet for inspection: decoded grids plus the parsed JSON documents."""
    course = json.loads((packet_dir / "course.json").read_text(encoding="utf-8"))
    w = course["grid"]["width"]
    h = course["grid"]["height"]
    raw_h = np.frombuffer((packet_dir / "height.u16.bin").read_bytes(), dtype="<u2").reshape(h, w)
    heights = course["height"]["offset"] + raw_h.astype(np.float64) * course["height"]["scale"]
    material = np.frombuffer((packet_dir / "material.u8.bin").read_bytes(), dtype=np.uint8).reshape(h, w)
    stripe = np.frombuffer((packet_dir / "stripe.u8.bin").read_bytes(), dtype=np.uint8).reshape(h, w)
    scatter = np.frombuffer((packet_dir / "scatter.bin").read_bytes(), dtype="<f4").reshape(-1, 4)
    horizon = None
    if "horizon" in course:
        hz = course["horizon"]
        raw = np.frombuffer((packet_dir / hz["file"]).read_bytes(), dtype="<u2").reshape(
            hz["height"], hz["width"]
        )
        horizon = hz["offset"] + raw.astype(np.float64) * hz["scale"]
    return {
        "horizon": horizon,
        "course": course,
        "holes": json.loads((packet_dir / "holes.json").read_text(encoding="utf-8")),
        "paths": json.loads((packet_dir / "paths.json").read_text(encoding="utf-8")),
        "heights": heights,
        "material": material,
        "stripe": stripe,
        "scatter": scatter,
    }
