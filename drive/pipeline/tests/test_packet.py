"""Packet format: schema, hashes, sizes."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import numpy as np
from jsonschema import Draft202012Validator

from gcs_pipeline.packet import read_packet
from gcs_pipeline.schema import load_schema, material_names


def test_schema_valid(generated: Path) -> None:
    for name in ("course", "holes", "paths"):
        doc = json.loads((generated / f"{name}.json").read_text(encoding="utf-8"))
        errors = sorted(Draft202012Validator(load_schema(name)).iter_errors(doc), key=str)
        assert not errors, f"{name}.json: {[e.message for e in errors]}"


def test_hashes_match(generated: Path) -> None:
    course = json.loads((generated / "course.json").read_text(encoding="utf-8"))
    files = course["files"]
    others = sorted(p.name for p in generated.iterdir() if p.name != "course.json")
    assert sorted(files) == others
    for name, digest in files.items():
        assert hashlib.sha256((generated / name).read_bytes()).hexdigest() == digest, name


def test_sizes_dtypes(generated: Path) -> None:
    course = json.loads((generated / "course.json").read_text(encoding="utf-8"))
    w, h = course["grid"]["width"], course["grid"]["height"]
    assert (generated / "height.u16.bin").stat().st_size == w * h * 2
    assert (generated / "material.u8.bin").stat().st_size == w * h
    assert (generated / "stripe.u8.bin").stat().st_size == w * h
    species = course["scatter"]["species"]
    total = sum(s["count"] for s in species)
    assert (generated / "scatter.bin").stat().st_size == total * 16
    offset = 0
    for s in species:
        assert s["byteOffset"] == offset
        offset += s["count"] * 16


def test_palette_covers_every_material(generated: Path) -> None:
    course = json.loads((generated / "course.json").read_text(encoding="utf-8"))
    assert [m["name"] for m in course["materials"]] == list(material_names())
    assert [m["id"] for m in course["materials"]] == list(range(len(material_names())))


def test_files_are_lf_json_without_nan(generated: Path) -> None:
    for name in ("course.json", "holes.json", "paths.json"):
        raw = (generated / name).read_bytes()
        assert b"\r" not in raw and raw.endswith(b"\n")
        assert b"NaN" not in raw and b"Infinity" not in raw


def test_scatter_is_finite_and_inside(generated: Path) -> None:
    p = read_packet(generated)
    sc = p["scatter"]
    half = (p["course"]["grid"]["width"] - 1) / 2
    assert np.isfinite(sc).all()
    assert (np.abs(sc[:, 0]) <= half).all() and (np.abs(sc[:, 1]) <= half).all()
    assert len(sc) > 100
