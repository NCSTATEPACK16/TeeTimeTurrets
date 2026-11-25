"""M0 gate: the generator is byte-deterministic."""

from __future__ import annotations

from pathlib import Path

import pytest
from conftest import COMMITTED, run_dummy

PACKET_FILES = (
    "course.json",
    "height.u16.bin",
    "material.u8.bin",
    "stripe.u8.bin",
    "scatter.bin",
    "holes.json",
    "paths.json",
)


def _read_all(d: Path) -> dict[str, bytes]:
    return {name: (d / name).read_bytes() for name in PACKET_FILES}


def test_writes_every_packet_file(generated: Path) -> None:
    assert sorted(p.name for p in generated.iterdir()) == sorted(PACKET_FILES)


def test_two_runs_identical(generated: Path, tmp_path: Path) -> None:
    run_dummy(tmp_path)
    first = _read_all(generated)
    second = _read_all(tmp_path)
    for name in PACKET_FILES:
        assert first[name] == second[name], f"{name} differs between runs"


def test_seed_changes_output(generated: Path, tmp_path: Path) -> None:
    run_dummy(tmp_path, seed=2)
    assert (tmp_path / "height.u16.bin").read_bytes() != (generated / "height.u16.bin").read_bytes()


@pytest.mark.skipif(not COMMITTED.exists(), reason="committed packet not present")
def test_committed_packet_matches(generated: Path) -> None:
    """The packet in apps/web/public/levels/dummy-01 is exactly what the generator writes."""
    fresh = _read_all(generated)
    committed = _read_all(COMMITTED)
    stale = [name for name in PACKET_FILES if fresh[name] != committed[name]]
    assert not stale, f"committed packet is stale; rerun gce-dummy. Differs: {stale}"
