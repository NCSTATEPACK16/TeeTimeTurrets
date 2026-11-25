"""Access to the level packet JSON Schemas in packages/level-schema (the format's source of truth)."""

from __future__ import annotations

import json
from functools import cache
from pathlib import Path

SCHEMA_DIR = Path(__file__).resolve().parents[3] / "packages" / "level-schema" / "schema"


@cache
def load_schema(name: str) -> dict:
    """Load `course`, `holes` or `paths` schema."""
    return json.loads((SCHEMA_DIR / f"{name}.schema.json").read_text(encoding="utf-8"))


@cache
def material_names() -> tuple[str, ...]:
    return tuple(load_schema("course")["$defs"]["materialName"]["enum"])


def material_id(name: str) -> int:
    return material_names().index(name)
